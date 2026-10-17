import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionApprovalRegistry, ActionPreview, ApprovedAction } from "../../security/approval-preview.js";
import type { ApprovedRoot, WorkspacePathPolicy } from "../../security/path-policy.js";

const MAX_PATCH_BYTES = 128 * 1024;
const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".jsx", ".mjs", ".mts", ".php", ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".ts", ".tsx", ".cts", ".yaml", ".yml"]);

export class PatchApplicationError extends Error {
  constructor(message = "The reviewed file replacement could not be prepared or applied safely.") {
    super(message);
    this.name = "PatchApplicationError";
  }
}

export interface PreparedFilePatch {
  readonly preview: ActionPreview;
  readonly content: string;
  readonly sha256: string;
}

function isInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

export async function prepareFilePatch(
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  approvals: ActionApprovalRegistry,
  targetValue: unknown,
  contentFileValue: unknown,
): Promise<PreparedFilePatch> {
  if (typeof targetValue !== "string" || typeof contentFileValue !== "string" ||
      targetValue.trim().length === 0 || contentFileValue.trim().length === 0 ||
      isAbsolute(targetValue) || isAbsolute(contentFileValue)) throw new PatchApplicationError("Target and replacement paths must be explicit relative paths.");
  const rootPath = resolve(root.path);
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === rootPath)) throw new PatchApplicationError("Repository root approval is required.");
  const targetPath = resolve(rootPath, targetValue);
  const contentPath = resolve(rootPath, contentFileValue);
  if (!isInside(rootPath, targetPath) || !isInside(rootPath, contentPath) || resolve(targetPath) === resolve(contentPath)) throw new PatchApplicationError("Target and replacement files must be distinct paths inside the approved root.");
  if (!SOURCE_EXTENSIONS.has(extname(targetPath).toLowerCase())) throw new PatchApplicationError("Patch targets must use a supported source extension.");

  try {
    const target = await policy.authorizePath(targetPath, "read");
    const targetStats = await lstat(targetPath);
    const targetPathMatches = process.platform === "win32"
      ? target.path.toLowerCase() === targetPath.toLowerCase()
      : target.path === targetPath;
    if (!targetPathMatches || targetStats.isSymbolicLink() || !targetStats.isFile() || targetStats.size > MAX_PATCH_BYTES) {
      throw new PatchApplicationError("Patch targets must be regular source files no larger than 128 KiB; links are not supported.");
    }
    const originalStats = await lstat(contentPath);
    if (originalStats.isSymbolicLink() || !originalStats.isFile() || originalStats.size > MAX_PATCH_BYTES) throw new PatchApplicationError("Replacement must be a regular UTF-8 file no larger than 128 KiB.");
    const canonicalContent = await realpath(contentPath);
    if (canonicalContent !== contentPath) throw new PatchApplicationError("Replacement file links are not supported.");
    const sameCanonicalPath = process.platform === "win32"
      ? target.path.toLowerCase() === canonicalContent.toLowerCase()
      : target.path === canonicalContent;
    if (sameCanonicalPath) throw new PatchApplicationError("Target and replacement files must be distinct files.");
    const openFlags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
    const handle = await open(contentPath, openFlags);
    let content: string;
    try {
      const current = await handle.stat();
      if (current.ino === 0 || current.ino !== originalStats.ino ||
          (process.platform !== "win32" && current.dev !== originalStats.dev) || current.size !== originalStats.size) {
        throw new PatchApplicationError("Replacement file changed before it could be read.");
      }
      const buffer = Buffer.alloc(MAX_PATCH_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      const afterRead = await handle.stat();
      if (bytesRead !== originalStats.size || bytesRead > MAX_PATCH_BYTES || afterRead.size !== originalStats.size || afterRead.mtimeMs !== originalStats.mtimeMs) {
        throw new PatchApplicationError("Replacement file changed or exceeds the 128 KiB limit.");
      }
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
    if (content.includes("\u0000")) throw new PatchApplicationError("Binary replacement content is not supported.");
    const preview = await approvals.preview({ kind: "write", targetPath, content });
    if (!preview.targetExists) {
      approvals.discard(preview.previewId);
      throw new PatchApplicationError("A patch must replace an existing file.");
    }
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
    return { preview, content, sha256 };
  } catch (error: unknown) {
    if (error instanceof PatchApplicationError) throw error;
    throw new PatchApplicationError();
  }
}

export async function prepareGeneratedFilePatch(
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  approvals: ActionApprovalRegistry,
  targetValue: unknown,
  contentValue: unknown,
): Promise<PreparedFilePatch> {
  if (typeof targetValue !== "string" || targetValue.trim().length === 0 || isAbsolute(targetValue) ||
      typeof contentValue !== "string" || Buffer.byteLength(contentValue, "utf8") > MAX_PATCH_BYTES || contentValue.includes("\u0000")) {
    throw new PatchApplicationError("Generated replacement must be bounded UTF-8 text for one explicit relative target.");
  }
  const rootPath = resolve(root.path);
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === rootPath)) throw new PatchApplicationError("Repository root approval is required.");
  const targetPath = resolve(rootPath, targetValue);
  if (!isInside(rootPath, targetPath) || !SOURCE_EXTENSIONS.has(extname(targetPath).toLowerCase())) {
    throw new PatchApplicationError("Generated patch target must be a supported source file inside the approved root.");
  }
  try {
    const authorized = await policy.authorizePath(targetPath, "read");
    const targetStats = await lstat(targetPath);
    const targetPathMatches = process.platform === "win32"
      ? authorized.path.toLowerCase() === targetPath.toLowerCase()
      : authorized.path === targetPath;
    if (!targetPathMatches || targetStats.isSymbolicLink() || !targetStats.isFile() || targetStats.size > MAX_PATCH_BYTES) {
      throw new PatchApplicationError("Generated patch target must be a regular source file no larger than 128 KiB; links are not supported.");
    }
    const preview = await approvals.preview({ kind: "write", targetPath, content: contentValue });
    if (!preview.targetExists) {
      approvals.discard(preview.previewId);
      throw new PatchApplicationError("A generated patch must replace an existing file.");
    }
    const sha256 = createHash("sha256").update(contentValue, "utf8").digest("hex");
    return { preview, content: contentValue, sha256 };
  } catch (error: unknown) {
    if (error instanceof PatchApplicationError) throw error;
    throw new PatchApplicationError();
  }
}

export async function applyPreparedFilePatch(
  prepared: PreparedFilePatch,
  approval: ApprovedAction,
  approvals: ActionApprovalRegistry,
): Promise<ActionPreview> {
  try {
    const actualHash = createHash("sha256").update(prepared.content, "utf8").digest("hex");
    if (actualHash !== prepared.sha256) throw new PatchApplicationError("Reviewed replacement content changed after approval.");
    return await approvals.applyApprovedWrite(approval, prepared.content);
  } catch (error: unknown) {
    if (error instanceof PatchApplicationError) throw error;
    throw new PatchApplicationError("The patch target changed or the replacement could not be written.");
  }
}
