import { escapeTerminalControls } from "../security/terminal-text.js";

const GITHUB_ORIGIN = "https://api.github.com";
const VERCEL_ORIGIN = "https://api.vercel.com";
const MAX_ITEMS = 25;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_API_VERSION = "2026-03-10";

export type TraceSourceStatus = "ok" | "unavailable" | "not_found" | "auth_expired" | "access_denied";

export interface GitHubWorkflowRun {
  readonly id: number;
  readonly title: string;
  readonly branch: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly commitSha: string;
  readonly url: string;
  readonly createdAt: string;
}

export interface VercelDeployment {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly target: string | null;
  readonly commitSha: string | null;
  readonly url: string;
  readonly createdAt: number;
}

export interface DeploymentTraceResult {
  readonly repository: string;
  readonly projectId: string;
  readonly github: { readonly status: TraceSourceStatus; readonly runs: readonly GitHubWorkflowRun[]; readonly message?: string };
  readonly vercel: { readonly status: TraceSourceStatus; readonly deployments: readonly VercelDeployment[]; readonly message?: string };
  readonly commitJoins: readonly { readonly commitSha: string; readonly githubRunUrl: string; readonly deploymentUrl: string }[];
}

export class DeploymentTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentTraceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new DeploymentTraceError(`${label} is invalid.`);
  }
  return value;
}

function parseRepository(value: unknown): { owner: string; name: string; full: string } {
  if (typeof value !== "string") throw new DeploymentTraceError("Use a public GitHub repository in owner/name format.");
  const parts = value.split("/");
  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/iu, "");
  if (parts.length !== 2 || owner === undefined || name === undefined ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/u.test(name) || name === "." || name === "..") {
    throw new DeploymentTraceError("Use a public GitHub repository in owner/name format.");
  }
  return { owner, name, full: `${owner}/${name}` };
}

function parseProjectId(value: unknown): string {
  if (typeof value !== "string" || !/^prj_[A-Za-z0-9_-]{1,120}$/u.test(value)) {
    throw new DeploymentTraceError("Use an explicit Vercel project ID (prj_...).");
  }
  return value;
}

async function readJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new DeploymentTraceError("The integration returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new DeploymentTraceError("The integration response exceeded 256 KiB.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed;
  } catch {
    throw new DeploymentTraceError("The integration returned invalid JSON.");
  }
}

function statusForHttp(status: number, service: "GitHub" | "Vercel"): TraceSourceStatus {
  if (status === 401) return "auth_expired";
  if (status === 403) return "access_denied";
  if (status === 404 && service === "Vercel") return "not_found";
  return "unavailable";
}

function safeFailure(status: TraceSourceStatus): string {
  switch (status) {
    case "not_found": return "The project was not found or is not visible to this account.";
    case "auth_expired": return "The access token is invalid or expired.";
    case "access_denied": return "The account lacks permission or the service denied this request.";
    default: return "The service could not provide deployment data.";
  }
}

function validateResponseOrigin(response: Response, expectedOrigin: string): void {
  if (response.url.length > 0) {
    try {
      if (new URL(response.url).origin !== expectedOrigin) throw new DeploymentTraceError("The integration response came from an unapproved host.");
    } catch (error: unknown) {
      if (error instanceof DeploymentTraceError) throw error;
      throw new DeploymentTraceError("The integration response URL was invalid.");
    }
  }
}

async function requestJson(fetcher: typeof fetch, url: URL, headers: HeadersInit): Promise<{ response?: Response; status?: TraceSourceStatus }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: "unavailable" };
  }
  try {
    validateResponseOrigin(response, url.origin);
  } catch {
    return { status: "unavailable" };
  }
  if (!response.ok) return { status: statusForHttp(response.status, url.origin === GITHUB_ORIGIN ? "GitHub" : "Vercel") };
  return { response };
}

function parseGitHubRuns(value: unknown, owner: string, repo: string): readonly GitHubWorkflowRun[] {
  if (!isRecord(value) || !Array.isArray(value["workflow_runs"]) || value["workflow_runs"].length > MAX_ITEMS) {
    throw new DeploymentTraceError("GitHub returned an unexpected workflow-run list.");
  }
  const runs: GitHubWorkflowRun[] = [];
  for (const item of value["workflow_runs"]) {
    if (!isRecord(item)) throw new DeploymentTraceError("GitHub returned an invalid workflow-run record.");
    const id = item["id"];
    const sha = item["head_sha"];
    const rawUrl = item["html_url"];
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 ||
        typeof sha !== "string" || !/^[a-f0-9]{40}$/iu.test(sha) || typeof rawUrl !== "string") {
      throw new DeploymentTraceError("GitHub returned an invalid workflow-run record.");
    }
    const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${id}`;
    let candidate: URL;
    try { candidate = new URL(rawUrl); } catch { throw new DeploymentTraceError("GitHub returned an invalid workflow-run link."); }
    if (candidate.origin !== "https://github.com" || candidate.pathname !== new URL(url).pathname) {
      throw new DeploymentTraceError("GitHub returned a workflow-run link outside the requested repository.");
    }
    const conclusion = item["conclusion"];
    const createdAt = boundedText(item["created_at"], "GitHub run timestamp", 40);
    if (!Number.isFinite(Date.parse(createdAt))) throw new DeploymentTraceError("GitHub returned an invalid workflow-run timestamp.");
    const title = boundedText(item["display_title"], "GitHub run title", 300);
    const branch = boundedText(item["head_branch"], "GitHub branch", 250);
    const status = boundedText(item["status"], "GitHub run status", 40);
    if (conclusion !== null && typeof conclusion !== "string") throw new DeploymentTraceError("GitHub returned an invalid workflow conclusion.");
    runs.push({ id, title: escapeTerminalControls(title), branch: escapeTerminalControls(branch),
      status: escapeTerminalControls(status), conclusion: typeof conclusion === "string" ? escapeTerminalControls(conclusion) : null,
      commitSha: sha.toLowerCase(), url, createdAt });
  }
  return runs;
}

function parseVercelDeployments(value: unknown): readonly VercelDeployment[] {
  if (!isRecord(value) || !Array.isArray(value["deployments"]) || value["deployments"].length > MAX_ITEMS) {
    throw new DeploymentTraceError("Vercel returned an unexpected deployment list.");
  }
  const deployments: VercelDeployment[] = [];
  for (const item of value["deployments"]) {
    if (!isRecord(item)) throw new DeploymentTraceError("Vercel returned an invalid deployment record.");
    const id = boundedText(item["uid"], "Vercel deployment ID", 160);
    if (!/^dpl_[A-Za-z0-9_-]{1,150}$/u.test(id)) throw new DeploymentTraceError("Vercel returned an invalid deployment ID.");
    const name = boundedText(item["name"], "Vercel project name", 100);
    const rawState = item["readyState"] ?? item["state"];
    const state = escapeTerminalControls(boundedText(rawState, "Vercel deployment state", 40));
    const targetValue = item["target"];
    if (targetValue !== undefined && targetValue !== null && typeof targetValue !== "string") {
      throw new DeploymentTraceError("Vercel returned an invalid deployment target.");
    }
    const rawSha = isRecord(item["meta"]) ? item["meta"]["githubCommitSha"] : undefined;
    if (rawSha !== undefined && (typeof rawSha !== "string" || !/^[a-f0-9]{40}$/iu.test(rawSha))) {
      throw new DeploymentTraceError("Vercel returned an invalid commit reference.");
    }
    const rawUrl = boundedText(item["url"], "Vercel deployment URL", 250);
    const deploymentUrl = new URL(`https://${rawUrl}`);
    if (deploymentUrl.protocol !== "https:" || deploymentUrl.username !== "" || deploymentUrl.password !== "" ||
        deploymentUrl.port !== "" || deploymentUrl.pathname !== "/" || deploymentUrl.search !== "" || deploymentUrl.hash !== "" ||
        !(deploymentUrl.hostname.endsWith(".vercel.app") || deploymentUrl.hostname === "vercel.app")) {
      throw new DeploymentTraceError("Vercel returned an unapproved deployment link.");
    }
    const createdAt = item["created"];
    if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
      throw new DeploymentTraceError("Vercel returned an invalid deployment timestamp.");
    }
    deployments.push({ id, name: escapeTerminalControls(name), state,
      target: typeof targetValue === "string" ? escapeTerminalControls(targetValue) : null,
      commitSha: typeof rawSha === "string" ? rawSha.toLowerCase() : null, url: deploymentUrl.origin, createdAt });
  }
  return deployments;
}

export async function traceDeployments(
  repositoryValue: unknown,
  projectIdValue: unknown,
  vercelTokenValue: unknown,
  fetcher: typeof fetch = fetch,
  teamIdValue?: unknown,
): Promise<DeploymentTraceResult> {
  const { owner, name: repo, full: repository } = parseRepository(repositoryValue);
  const projectId = parseProjectId(projectIdValue);
  let teamId: string | undefined;
  if (teamIdValue !== undefined) {
    if (typeof teamIdValue !== "string" || !/^team_[A-Za-z0-9_-]{1,120}$/u.test(teamIdValue)) {
      throw new DeploymentTraceError("Use a valid Vercel team ID when selecting a team account.");
    }
    teamId = teamIdValue;
  }
  const token = boundedText(vercelTokenValue, "Vercel access token", 4096);
  if (/[\u0000-\u001f\u007f]/u.test(token)) throw new DeploymentTraceError("Vercel access token is invalid.");

  const githubUrl = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs`, GITHUB_ORIGIN);
  githubUrl.searchParams.set("per_page", String(MAX_ITEMS));
  const vercelUrl = new URL("/v7/deployments", VERCEL_ORIGIN);
  vercelUrl.searchParams.set("projectId", projectId);
  vercelUrl.searchParams.set("limit", String(MAX_ITEMS));
  if (teamId !== undefined) vercelUrl.searchParams.set("teamId", teamId);

  const [githubRequest, vercelRequest] = await Promise.all([
    requestJson(fetcher, githubUrl, { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION }),
    requestJson(fetcher, vercelUrl, { Authorization: `Bearer ${token}`, Accept: "application/json" }),
  ]);

  let github: DeploymentTraceResult["github"];
  if (githubRequest.response === undefined) {
    const status = githubRequest.status ?? "unavailable";
    github = { status, runs: [], message: safeFailure(status) };
  } else {
    try { github = { status: "ok", runs: parseGitHubRuns(await readJson(githubRequest.response), owner, repo) }; }
    catch { github = { status: "unavailable", runs: [], message: "GitHub returned data that could not be validated." }; }
  }

  let vercel: DeploymentTraceResult["vercel"];
  if (vercelRequest.response === undefined) {
    const status = vercelRequest.status ?? "unavailable";
    vercel = { status, deployments: [], message: safeFailure(status) };
  } else {
    try { vercel = { status: "ok", deployments: parseVercelDeployments(await readJson(vercelRequest.response)) }; }
    catch { vercel = { status: "unavailable", deployments: [], message: "Vercel returned data that could not be validated." }; }
  }

  const runsBySha = new Map(github.runs.map((run) => [run.commitSha, run]));
  const commitJoins = vercel.deployments.flatMap((deployment) => {
    const run = deployment.commitSha === null ? undefined : runsBySha.get(deployment.commitSha);
    return run === undefined || deployment.commitSha === null ? [] : [{ commitSha: deployment.commitSha, githubRunUrl: run.url, deploymentUrl: deployment.url }];
  });
  return { repository, projectId, github, vercel, commitJoins };
}
