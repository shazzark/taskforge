import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type PathAccess = "read" | "write";

export interface ApprovedRoot {
  readonly path: string;
}

export interface AuthorizedPath {
  readonly path: string;
  readonly root: string;
  readonly access: PathAccess;
  readonly exists: boolean;
}

export type PathPolicyErrorKind = "invalid_path" | "root_not_found" | "root_not_directory" | "not_approved" | "secret_denied" | "target_not_found" | "path_unavailable";

export class PathPolicyError extends Error {
  readonly kind: PathPolicyErrorKind;

  constructor(kind: PathPolicyErrorKind) {
    const messages: Record<PathPolicyErrorKind, string> = {
      invalid_path: "The requested path is invalid.",
      root_not_found: "The approved root does not exist or cannot be resolved.",
      root_not_directory: "An approved root must be a directory.",
      not_approved: "The requested path is outside every approved root.",
      secret_denied: "The requested path matches a protected secret-file rule.",
      target_not_found: "The requested file does not exist.",
      path_unavailable: "The requested path cannot be safely resolved.",
    };
    super(messages[kind]);
    this.name = "PathPolicyError";
    this.kind = kind;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function isDeniedSegment(segment: string): boolean {
  const name = segment.toLowerCase();
  if (name === ".env.example") {
    return false;
  }
  return (
    /^\.env(?:$|[._-])/u.test(name) ||
    [".ssh", ".aws", ".azure", ".gnupg", ".npmrc", ".netrc", "credentials", "secrets"].includes(name) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/u.test(name) ||
    /(?:^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/u.test(name) ||
    /\.(?:pem|key|p12|pfx|kdbx)$/u.test(name)
  );
}

function assertNotSecretPath(root: string, candidate: string): void {
  const segments = resolve(candidate).split(/[\\/]/u).filter((segment) => segment.length > 0);
  if (segments.some(isDeniedSegment)) {
    throw new PathPolicyError("secret_denied");
  }
  if (!isWithinRoot(root, candidate)) {
    throw new PathPolicyError("not_approved");
  }
}

async function resolveAllowMissingTarget(candidate: string): Promise<{ readonly path: string; readonly exists: boolean }> {
  const missingSegments: string[] = [];
  let cursor = candidate;
  while (true) {
    try {
      const canonicalCursor = await realpath(cursor);
      const ancestorStats = await stat(canonicalCursor);
      if (missingSegments.length > 0 && !ancestorStats.isDirectory()) {
        throw new PathPolicyError("path_unavailable");
      }
      const resolvedCandidate = join(canonicalCursor, ...missingSegments.reverse());
      let exists = true;
      try {
        await stat(resolvedCandidate);
      } catch (error: unknown) {
        if (!isMissingPathError(error)) {
          throw error;
        }
        exists = false;
      }
      return { path: resolvedCandidate, exists };
    } catch (error: unknown) {
      if (error instanceof PathPolicyError) {
        throw error;
      }
      if (!isMissingPathError(error)) {
        throw new PathPolicyError("path_unavailable");
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new PathPolicyError("path_unavailable");
      }
      missingSegments.push(basename(cursor));
      cursor = parent;
    }
  }
}

export class WorkspacePathPolicy {
  private readonly roots = new Set<string>();

  async approveRoot(rootPath: unknown): Promise<ApprovedRoot> {
    if (typeof rootPath !== "string" || rootPath.trim().length === 0 || rootPath.includes("\u0000")) {
      throw new PathPolicyError("invalid_path");
    }
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(resolve(rootPath));
    } catch {
      throw new PathPolicyError("root_not_found");
    }
    try {
      const rootStats = await stat(canonicalRoot);
      if (!rootStats.isDirectory()) {
        throw new PathPolicyError("root_not_directory");
      }
    } catch (error: unknown) {
      if (error instanceof PathPolicyError) {
        throw error;
      }
      throw new PathPolicyError("root_not_found");
    }
    assertNotSecretPath(canonicalRoot, canonicalRoot);
    this.roots.add(canonicalRoot);
    return { path: canonicalRoot };
  }

  listApprovedRoots(): readonly ApprovedRoot[] {
    return [...this.roots].map((path) => ({ path }));
  }

  async authorizePath(pathValue: unknown, access: PathAccess): Promise<AuthorizedPath> {
    if (typeof pathValue !== "string" || pathValue.trim().length === 0 || pathValue.includes("\u0000")) {
      throw new PathPolicyError("invalid_path");
    }
    const candidate = resolve(pathValue);
    let lastError: PathPolicyErrorKind = "not_approved";
    for (const root of this.roots) {
      try {
        assertNotSecretPath(root, candidate);
        const resolved = access === "read"
          ? { path: await realpath(candidate), exists: true }
          : await resolveAllowMissingTarget(candidate);
        assertNotSecretPath(root, resolved.path);
        if (!isWithinRoot(root, resolved.path)) {
          throw new PathPolicyError("not_approved");
        }
        if (access === "read" && !resolved.exists) {
          throw new PathPolicyError("target_not_found");
        }
        return { path: resolved.path, root, access, exists: resolved.exists };
      } catch (error: unknown) {
        if (error instanceof PathPolicyError) {
          if (error.kind === "secret_denied" || error.kind === "target_not_found" || error.kind === "invalid_path") {
            throw error;
          }
          lastError = error.kind;
          continue;
        }
        lastError = isMissingPathError(error) ? "target_not_found" : "path_unavailable";
      }
    }
    throw new PathPolicyError(lastError);
  }
}
