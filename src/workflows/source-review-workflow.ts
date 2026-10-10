import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ApprovedRoot, WorkspacePathPolicy } from "../security/path-policy.js";

const ALLOWED_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".jsx", ".json",
  ".md", ".mjs", ".mts", ".php", ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".ts", ".tsx",
  ".cts", ".yaml", ".yml",
]);
const MAX_FILES = 20;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;
const MAX_DISPLAY_CHARS = 48 * 1024;

export class SourceReviewError extends Error {
  constructor(message = "The selected source files could not be reviewed safely.") {
    super(message);
    this.name = "SourceReviewError";
  }
}

export interface SourceReviewFile {
  readonly path: string;
  readonly byteCount: number;
  readonly lineCount: number;
  readonly content: string;
}

function redactLine(line: string): string {
  if (/(?:api[_-]?key|access[_-]?token|secret|password|passwd|private[_-]?key|mongodb(?:\+srv)?:\/\/|authorization)\s*(?:=|:|\s)/iu.test(line)) {
    return "[REDACTED: possible credential]";
  }
  return line
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{16,})\b/giu, "[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[REDACTED]");
}

function redactSource(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, "[REDACTED: private key block]")
    .split("\n").map(redactLine).join("\n");
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function sameFile(left: { readonly dev: number; readonly ino: number }, right: { readonly dev: number; readonly ino: number }): boolean {
  return left.ino !== 0 && left.ino === right.ino && (process.platform === "win32" || left.dev === right.dev);
}

export async function reviewSourceFiles(
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  requestedPaths: unknown,
): Promise<readonly SourceReviewFile[]> {
  if (!isUnknownArray(requestedPaths)) {
    throw new SourceReviewError("Select between 1 and 20 explicit source files.");
  }
  const paths: string[] = [];
  for (const value of requestedPaths) {
    if (typeof value !== "string" || value.trim().length === 0) throw new SourceReviewError("Select between 1 and 20 explicit source files.");
    paths.push(value);
  }
  if (paths.length === 0 || paths.length > MAX_FILES) throw new SourceReviewError("Select between 1 and 20 explicit source files.");
  const approvedRoot = resolve(root.path);
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === approvedRoot)) {
    throw new SourceReviewError("Repository root approval is required before source review.");
  }

  const uniquePaths = new Set<string>();
  const result: SourceReviewFile[] = [];
  let totalBytes = 0;
  let totalChars = 0;
  for (const pathValue of paths) {
    if (pathValue.includes("\u0000") || isAbsolute(pathValue)) throw new SourceReviewError();
    const absolutePath = resolve(approvedRoot, pathValue);
    const relativePath = relative(approvedRoot, absolutePath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new SourceReviewError("Every selected file must remain inside the approved repository root.");
    }
    if (uniquePaths.has(relativePath)) throw new SourceReviewError("Duplicate source paths are not allowed.");
    uniquePaths.add(relativePath);
    if (!ALLOWED_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
      throw new SourceReviewError("One or more selected files use an unsupported source extension.");
    }

    try {
      const authorized = await policy.authorizePath(absolutePath, "read");
      const before = await lstat(absolutePath);
      const canonicalPath = await realpath(absolutePath);
      const pathsMatch = process.platform === "win32"
        ? canonicalPath.toLowerCase() === absolutePath.toLowerCase()
        : canonicalPath === absolutePath;
      if (before.isSymbolicLink() || !before.isFile() || !pathsMatch || authorized.path !== canonicalPath) throw new SourceReviewError();
      if (before.size > MAX_FILE_BYTES || totalBytes + before.size > MAX_TOTAL_BYTES) throw new SourceReviewError("Selected source exceeds the review size limit.");
      const openFlags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
      const handle = await open(absolutePath, openFlags);
      let buffer: Buffer;
      try {
        const currentRealPath = await realpath(absolutePath);
        const currentStats = await handle.stat();
        const currentPathsMatch = process.platform === "win32"
          ? currentRealPath.toLowerCase() === absolutePath.toLowerCase()
          : currentRealPath === absolutePath;
        if (!currentPathsMatch || !currentStats.isFile() || !sameFile(before, currentStats) || currentStats.size !== before.size || currentStats.mtimeMs !== before.mtimeMs) {
          throw new SourceReviewError("A selected source file changed before it could be read.");
        }
        buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
        if (bytesRead !== before.size || bytesRead > MAX_FILE_BYTES) throw new SourceReviewError("A selected source file changed or exceeds the review size limit.");
        buffer = buffer.subarray(0, bytesRead);
        const afterRead = await handle.stat();
        if (afterRead.size !== before.size || afterRead.mtimeMs !== before.mtimeMs) throw new SourceReviewError("A selected source file changed while it was being read.");
      } finally {
        await handle.close();
      }
      if (buffer.byteLength !== before.size || buffer.byteLength > MAX_FILE_BYTES) throw new SourceReviewError();
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (decoded.includes("\u0000")) throw new SourceReviewError("Binary source files are not supported.");
      const content = redactSource(decoded.replace(/\r\n?/gu, "\n"));
      totalBytes += buffer.byteLength;
      totalChars += content.length;
      if (totalChars > MAX_DISPLAY_CHARS) throw new SourceReviewError("Selected source exceeds the review display limit.");
      result.push({ path: relativePath, byteCount: buffer.byteLength, lineCount: decoded.length === 0 ? 0 : decoded.split(/\r\n?|\n/u).length, content });
    } catch (error: unknown) {
      if (error instanceof SourceReviewError) throw error;
      throw new SourceReviewError();
    }
  }
  return result;
}
