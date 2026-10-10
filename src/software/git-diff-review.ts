import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ApprovedRoot, WorkspacePathPolicy } from "../security/path-policy.js";
import { redactSourceForDisplay } from "../workflows/source-review-workflow.js";

const MAX_CHANGED_FILES = 20;
const MAX_DIFF_BYTES = 48 * 1024;

export class GitDiffReviewError extends Error {
  constructor(message = "The local Git diff could not be reviewed safely.") {
    super(message);
    this.name = "GitDiffReviewError";
  }
}

export interface GitDiffReview {
  readonly root: string;
  readonly files: readonly string[];
  readonly diff: string;
}

function redactDiff(value: string): string {
  let insidePrivateKey = false;
  return value.split("\n").map((line) => {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || !/^[ +\-]/u.test(line)) return line;
    const prefix = line[0] ?? " ";
    const content = line.slice(1);
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u.test(content)) {
      insidePrivateKey = !/-----END [A-Z0-9 ]*PRIVATE KEY-----/u.test(content);
      return `${prefix}[REDACTED: private key block]`;
    }
    if (insidePrivateKey) {
      if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/u.test(content)) insidePrivateKey = false;
      return `${prefix}[REDACTED]`;
    }
    return redactSourceForDisplay(line);
  }).join("\n");
}

function runGit(root: string, args: readonly string[], byteLimit: number): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", [...args], {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH ?? "",
        ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
        ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
        ...(process.env.USERPROFILE === undefined ? {} : { USERPROFILE: process.env.USERPROFILE }),
        ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
        ...(process.env.TEMP === undefined ? {} : { TEMP: process.env.TEMP }),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let settled = false;
    const fail = (): void => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectPromise(new GitDiffReviewError());
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteCount += buffer.byteLength;
      if (byteCount > byteLimit) {
        fail();
        return;
      }
      chunks.push(buffer);
    });
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        rejectPromise(new GitDiffReviewError());
        return;
      }
      resolvePromise(Buffer.concat(chunks, byteCount));
    });
  });
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function listGitDiffFiles(root: ApprovedRoot, policy: WorkspacePathPolicy): Promise<readonly string[]> {
  const rootPath = resolve(root.path);
  if (!policy.listApprovedRoots().some((approved) => samePath(resolve(approved.path), rootPath))) {
    throw new GitDiffReviewError("An approved repository root is required.");
  }
  try {
    const topLevel = new TextDecoder("utf-8", { fatal: true })
      .decode(await runGit(rootPath, ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "rev-parse", "--show-toplevel"], 8 * 1024))
      .trim();
    if (!samePath(resolve(topLevel), rootPath)) throw new GitDiffReviewError("Approve the Git repository root itself before reviewing its diff.");
    const names = new TextDecoder("utf-8", { fatal: true })
      .decode(await runGit(rootPath, ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "diff", "--cached", "--name-only", "--no-ext-diff", "--no-textconv", "--no-color", "-z", "HEAD", "--"], MAX_CHANGED_FILES * 4096))
      .split("\u0000")
      .filter((name) => name.length > 0);
    if (names.length > MAX_CHANGED_FILES) throw new GitDiffReviewError("The local diff includes more than 20 changed files.");
    for (const name of names) {
      if (name.includes("\u0000") || isAbsolute(name)) throw new GitDiffReviewError();
      const absolute = resolve(rootPath, name);
      const relativePath = relative(rootPath, absolute);
      if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new GitDiffReviewError();
      }
      try {
        await policy.authorizePath(absolute, "write");
      } catch {
        throw new GitDiffReviewError("The diff contains a path that is not eligible for local review.");
      }
    }
    return names;
  } catch (error: unknown) {
    if (error instanceof GitDiffReviewError) throw error;
    throw new GitDiffReviewError();
  }
}

export async function readGitDiff(root: ApprovedRoot, policy: WorkspacePathPolicy, requestedFiles: readonly string[]): Promise<GitDiffReview> {
  const files = await listGitDiffFiles(root, policy);
  if (files.length === 0 || files.length !== requestedFiles.length || files.some((file, index) => file !== requestedFiles[index])) {
    throw new GitDiffReviewError("The local diff changed after its file list was approved.");
  }
  const rootPath = resolve(root.path);
  try {
    const output = await runGit(rootPath, ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=2", "HEAD", "--", ...files], MAX_DIFF_BYTES);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(output);
    return { root: rootPath, files, diff: redactDiff(decoded.replace(/\r\n?/gu, "\n")) };
  } catch (error: unknown) {
    if (error instanceof GitDiffReviewError) throw error;
    throw new GitDiffReviewError();
  }
}
