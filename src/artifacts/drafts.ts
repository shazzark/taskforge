import { createHash, randomUUID } from "node:crypto";
import { link, open, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ActionApprovalRegistry, ActionPreview, ApprovedAction } from "../security/approval-preview.js";
import type { ApprovedRoot, WorkspacePathPolicy } from "../security/path-policy.js";

const MAX_DRAFT_BYTES = 64 * 1024;

export type LocalDraftInput =
  | {
      readonly kind: "github-issue";
      readonly repository: string;
      readonly title: string;
      readonly body: string;
      readonly sourceIssueUrl?: string;
    }
  | {
      readonly kind: "email";
      readonly to?: string;
      readonly subject: string;
      readonly body: string;
    };

export interface PendingTextArtifact {
  readonly preview: ActionPreview;
  readonly content: string;
  readonly digest: string;
}

export class DraftArtifactError extends Error {
  constructor(message = "The local draft artifact could not be prepared or written safely.") {
    super(message);
    this.name = "DraftArtifactError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum || value.includes("\0")) {
    throw new DraftArtifactError(`Draft ${field} must be non-empty text within ${maximum} characters.`);
  }
  return value;
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field, maximum);
}

function parseIssueUrl(value: string, repository: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DraftArtifactError("Source issue URL must be a valid public GitHub issue URL.");
  }
  if (url.origin !== "https://github.com" || url.pathname.split("/").length !== 5 ||
      url.username.length > 0 || url.password.length > 0 ||
      url.pathname.split("/")[1] !== repository.split("/")[0] ||
      url.pathname.split("/")[2] !== repository.split("/")[1] ||
      url.pathname.split("/")[3] !== "issues" || !/^\d+$/u.test(url.pathname.split("/")[4] ?? "") ||
      url.search.length > 0 || url.hash.length > 0) {
    throw new DraftArtifactError("Source issue URL must point to an issue in the named public repository.");
  }
  return url.toString();
}

export function parseLocalDraftInput(value: unknown): LocalDraftInput {
  if (!isRecord(value)) throw new DraftArtifactError("Draft input must be a JSON object.");
  if (value["kind"] === "github-issue") {
    if (!hasOnlyKeys(value, ["kind", "repository", "title", "body", "sourceIssueUrl"])) throw new DraftArtifactError("Draft input contains unsupported fields.");
    const repository = requiredText(value["repository"], "repository", 140);
    const parts = repository.split("/");
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/u.test(part))) {
      throw new DraftArtifactError("Repository must use owner/name format.");
    }
    const sourceIssueUrl = optionalText(value["sourceIssueUrl"], "sourceIssueUrl", 500);
    return {
      kind: "github-issue",
      repository,
      title: requiredText(value["title"], "title", 200),
      body: requiredText(value["body"], "body", 32_000),
      ...(sourceIssueUrl === undefined ? {} : { sourceIssueUrl: parseIssueUrl(sourceIssueUrl, repository) }),
    };
  }
  if (value["kind"] === "email") {
    if (!hasOnlyKeys(value, ["kind", "to", "subject", "body"])) throw new DraftArtifactError("Draft input contains unsupported fields.");
    const to = optionalText(value["to"], "to", 320);
    const subject = requiredText(value["subject"], "subject", 200);
    const body = requiredText(value["body"], "body", 32_000);
    if (to !== undefined && /[\r\n]/u.test(to)) throw new DraftArtifactError("Email recipient must be a single line.");
    if (/[\r\n]/u.test(subject)) throw new DraftArtifactError("Email subject must be a single line.");
    return { kind: "email", ...(to === undefined ? {} : { to }), subject, body };
  }
  throw new DraftArtifactError("Draft kind must be github-issue or email.");
}

export function renderLocalDraft(value: unknown): string {
  const draft = parseLocalDraftInput(value);
  const content = draft.kind === "github-issue"
    ? [
        "TaskForge GitHub Issue Draft",
        `Repository: ${draft.repository}`,
        ...(draft.sourceIssueUrl === undefined ? [] : [`Related issue: ${draft.sourceIssueUrl}`]),
        `Title: ${draft.title}`,
        "",
        draft.body,
        "",
        "This is a local draft. TaskForge did not contact GitHub or publish it.",
        "",
      ].join("\n")
    : [
        "TaskForge Email Draft",
        ...(draft.to === undefined ? [] : [`To: ${draft.to}`]),
        `Subject: ${draft.subject}`,
        "",
        draft.body,
        "",
        "This is a local draft. TaskForge did not contact an email service or send it.",
        "",
      ].join("\n");
  if (Buffer.byteLength(content, "utf8") > MAX_DRAFT_BYTES) throw new DraftArtifactError("Rendered draft exceeds the 64 KiB artifact limit.");
  return content;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function previewTextArtifact(
  input: unknown,
  targetPath: unknown,
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  approvals: ActionApprovalRegistry,
): Promise<PendingTextArtifact> {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) throw new DraftArtifactError("An output path is required.");
  try {
    if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === resolve(root.path))) throw new DraftArtifactError("Output root approval is required.");
    const target = await policy.authorizePath(targetPath, "write");
    if (resolve(target.root) !== resolve(root.path) || target.exists) throw new DraftArtifactError("Draft output must be a new file inside the approved root.");
    const content = renderLocalDraft(input);
    const preview = await approvals.preview({ kind: "write", targetPath: target.path, content });
    if (preview.targetExists) throw new DraftArtifactError("Draft output already exists; choose a new file path.");
    return { preview, content, digest: sha256(content) };
  } catch (error: unknown) {
    if (error instanceof DraftArtifactError) throw error;
    throw new DraftArtifactError();
  }
}

export async function writeApprovedTextArtifact(
  pending: PendingTextArtifact,
  approval: ApprovedAction,
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  approvals: ActionApprovalRegistry,
): Promise<{ readonly path: string; readonly byteCount: number; readonly sha256: string }> {
  let temporaryPath: string | undefined;
  try {
    const currentPreview = await approvals.revalidate(approval);
    if (currentPreview.previewId !== pending.preview.previewId || currentPreview.kind !== "write" || currentPreview.targetExists) {
      throw new DraftArtifactError("Draft output approval is invalid or stale.");
    }
    const authorized = await policy.authorizePath(currentPreview.targetPath, "write");
    if (resolve(authorized.root) !== resolve(root.path) ||
        !policy.listApprovedRoots().some((entry) => resolve(entry.path) === resolve(root.path)) || authorized.exists) {
      throw new DraftArtifactError("Draft output must remain a new file inside the approved root.");
    }
    const canonicalDirectory = await realpath(dirname(authorized.path));
    if (canonicalDirectory !== dirname(authorized.path) || sha256(pending.content) !== pending.digest) throw new DraftArtifactError("Draft output changed after preview.");
    temporaryPath = resolve(canonicalDirectory, `.taskforge-${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(pending.content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, authorized.path);
    await unlink(temporaryPath);
    temporaryPath = undefined;
    const outputPath = await realpath(authorized.path);
    if (outputPath !== authorized.path) throw new DraftArtifactError("Written draft path changed during verification.");
    const output = await open(outputPath, "r");
    try {
      const bytes = await output.readFile();
      if (sha256(bytes) !== pending.digest) throw new DraftArtifactError("Written draft failed hash verification.");
      approvals.discard(pending.preview.previewId);
      return { path: outputPath, byteCount: bytes.byteLength, sha256: pending.digest };
    } finally {
      await output.close();
    }
  } catch (error: unknown) {
    if (error instanceof DraftArtifactError) throw error;
    throw new DraftArtifactError();
  } finally {
    if (temporaryPath !== undefined) {
      try { await unlink(temporaryPath); } catch { /* The temporary artifact may already be gone. */ }
    }
  }
}
