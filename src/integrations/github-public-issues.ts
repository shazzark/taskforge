import { escapeTerminalControls } from "../security/terminal-text.js";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULTS = 20;

export interface PublicIssueSummary {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly url: string;
}

export class GitHubReadError extends Error {
  constructor(message = "GitHub public issue data could not be read safely.") {
    super(message);
    this.name = "GitHubReadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRepository(value: unknown): { readonly owner: string; readonly repository: string } {
  if (typeof value !== "string") throw new GitHubReadError("Use a public repository in owner/name format.");
  const parts = value.split("/");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]{1,100}$/u.test(parts[1]) || parts[1] === "." || parts[1] === "..") {
    throw new GitHubReadError("Use a public repository in owner/name format.");
  }
  const repository = parts[1].replace(/\.git$/iu, "");
  if (repository.length === 0) throw new GitHubReadError("Use a public repository in owner/name format.");
  return { owner: parts[0], repository };
}

async function readBoundedBody(response: Response): Promise<unknown> {
  if (response.body === null) throw new GitHubReadError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteCount += part.value.byteLength;
      if (byteCount > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GitHubReadError("The public issue response exceeded 256 KiB.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new GitHubReadError("GitHub returned an invalid issue response.");
  }
}

function parseIssues(value: unknown, owner: string, repository: string): readonly PublicIssueSummary[] {
  if (!Array.isArray(value) || value.length > MAX_RESULTS) throw new GitHubReadError("GitHub returned an unexpected issue list.");
  const output: PublicIssueSummary[] = [];
  for (const item of value) {
    if (!isRecord(item) || "pull_request" in item) continue;
    const number = item["number"];
    const title = item["title"];
    const state = item["state"];
    const url = item["html_url"];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || typeof title !== "string" || title.length > 500 ||
        (state !== "open" && state !== "closed") || typeof url !== "string") {
      throw new GitHubReadError("GitHub returned an invalid issue record.");
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new GitHubReadError("GitHub returned an invalid issue link.");
    }
    const expectedPath = `/${owner}/${repository}/issues/${number}`;
    if (parsedUrl.origin !== "https://github.com" || parsedUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()) {
      throw new GitHubReadError("GitHub returned an issue link outside the requested repository.");
    }
    output.push({ number, title: escapeTerminalControls(title), state, url: parsedUrl.toString() });
  }
  return output;
}

export async function readPublicIssues(repositoryValue: unknown, fetcher: typeof fetch = fetch): Promise<readonly PublicIssueSummary[]> {
  const { owner, repository } = parseRepository(repositoryValue);
  const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues`, GITHUB_API_ORIGIN);
  url.searchParams.set("state", "open");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("per_page", String(MAX_RESULTS));
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GitHubReadError("GitHub could not be reached or the request timed out.");
  }
  if (response.url.length > 0 && new URL(response.url).origin !== GITHUB_API_ORIGIN) throw new GitHubReadError();
  if (!response.ok) {
    if (response.status === 404) throw new GitHubReadError("The repository is unavailable or is not public.");
    if (response.status === 403 || response.status === 429) throw new GitHubReadError("GitHub rate limits or access policy prevented the request.");
    throw new GitHubReadError();
  }
  return parseIssues(await readBoundedBody(response), owner, repository);
}
