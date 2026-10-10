import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { PathPolicyError, WorkspacePathPolicy } from "./path-policy.js";

const MAX_PREVIEW_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_PREVIEWS = 30;

export type PlannedFileAction =
  | { readonly kind: "write"; readonly targetPath: string; readonly content: string }
  | { readonly kind: "move"; readonly sourcePath: string; readonly targetPath: string };

export interface ActionPreview {
  readonly previewId: string;
  readonly kind: PlannedFileAction["kind"];
  readonly sourcePath?: string;
  readonly targetPath: string;
  readonly targetExists: boolean;
}

export interface ApprovedAction {
  readonly previewId: string;
  readonly digest: string;
}

interface InternalPreview {
  readonly publicPreview: ActionPreview;
  readonly action: StoredAction;
  readonly digest: string;
  approved: boolean;
}

type StoredAction =
  | { readonly kind: "write"; readonly targetPath: string; readonly contentHash: string }
  | { readonly kind: "move"; readonly sourcePath: string; readonly targetPath: string };

export type ApprovalErrorKind = "preview_limit" | "unknown_preview" | "not_approved" | "stale_preview" | "unsupported_target" | "invalid_action";

export class ApprovalError extends Error {
  readonly kind: ApprovalErrorKind;

  constructor(kind: ApprovalErrorKind) {
    const messages: Record<ApprovalErrorKind, string> = {
      preview_limit: "Too many pending action previews exist.",
      unknown_preview: "The action preview is unknown or expired.",
      not_approved: "The action has not been approved.",
      stale_preview: "The target changed after preview; a new preview and approval are required.",
      unsupported_target: "This action preview currently supports regular files up to 8 MiB.",
      invalid_action: "The requested file action is invalid.",
    };
    super(messages[kind]);
    this.name = "ApprovalError";
    this.kind = kind;
  }
}

type FileSnapshot =
  | { readonly exists: false }
  | { readonly exists: true; readonly size: number; readonly modifiedAt: number; readonly sha256: string };

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function snapshot(path: string): Promise<FileSnapshot> {
  let fileStats;
  try {
    fileStats = await stat(path);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { exists: false };
    }
    throw new ApprovalError("unsupported_target");
  }
  if (!fileStats.isFile() || fileStats.size > MAX_PREVIEW_CONTENT_BYTES) {
    throw new ApprovalError("unsupported_target");
  }
  try {
    const contents = await readFile(path);
    const afterReadStats = await stat(path);
    if (afterReadStats.size !== fileStats.size || afterReadStats.mtimeMs !== fileStats.mtimeMs) {
      throw new ApprovalError("stale_preview");
    }
    return {
      exists: true,
      size: fileStats.size,
      modifiedAt: fileStats.mtimeMs,
      sha256: hash(contents),
    };
  } catch (error: unknown) {
    if (error instanceof ApprovalError) {
      throw error;
    }
    throw new ApprovalError("unsupported_target");
  }
}

export class ActionApprovalRegistry {
  private readonly pathPolicy: WorkspacePathPolicy;
  private readonly previews = new Map<string, InternalPreview>();

  constructor(pathPolicy: WorkspacePathPolicy) {
    this.pathPolicy = pathPolicy;
  }

  async preview(action: PlannedFileAction): Promise<ActionPreview> {
    if (this.previews.size >= MAX_PENDING_PREVIEWS) {
      throw new ApprovalError("preview_limit");
    }
    if (action.kind === "write" && (typeof action.content !== "string" || Buffer.byteLength(action.content, "utf8") > MAX_PREVIEW_CONTENT_BYTES)) {
      throw new ApprovalError("invalid_action");
    }
    if (action.kind === "move" && action.sourcePath === action.targetPath) {
      throw new ApprovalError("invalid_action");
    }

    try {
      const target = await this.pathPolicy.authorizePath(action.targetPath, "write");
      const targetSnapshot = await snapshot(target.path);
      let sourcePath: string | undefined;
      let sourceSnapshot: FileSnapshot | undefined;
      if (action.kind === "move") {
        const source = await this.pathPolicy.authorizePath(action.sourcePath, "read");
        if (source.path === target.path) {
          throw new ApprovalError("invalid_action");
        }
        sourcePath = source.path;
        sourceSnapshot = await snapshot(source.path);
      }
      const contentHash = action.kind === "write" ? hash(action.content) : undefined;
      const digest = hash(JSON.stringify({
        kind: action.kind,
        sourcePath,
        sourceSnapshot,
        targetPath: target.path,
        targetSnapshot,
        contentHash,
      }));
      const previewId = randomUUID();
      const publicPreview: ActionPreview = Object.freeze({
        previewId,
        kind: action.kind,
        ...(sourcePath === undefined ? {} : { sourcePath }),
        targetPath: target.path,
        targetExists: targetSnapshot.exists,
      });
      const storedAction: StoredAction = action.kind === "write"
        ? { kind: "write", targetPath: target.path, contentHash: contentHash ?? "" }
        : { kind: "move", sourcePath: sourcePath ?? "", targetPath: target.path };
      this.previews.set(previewId, { publicPreview, action: storedAction, digest, approved: false });
      return publicPreview;
    } catch (error: unknown) {
      if (error instanceof PathPolicyError) {
        throw error;
      }
      if (error instanceof ApprovalError) {
        throw error;
      }
      throw new ApprovalError("unsupported_target");
    }
  }

  approve(previewId: string): ApprovedAction {
    const preview = this.previews.get(previewId);
    if (preview === undefined) {
      throw new ApprovalError("unknown_preview");
    }
    preview.approved = true;
    return Object.freeze({ previewId, digest: preview.digest });
  }

  async revalidate(approval: ApprovedAction): Promise<ActionPreview> {
    const preview = this.previews.get(approval.previewId);
    if (preview === undefined || approval.digest !== preview.digest) {
      throw new ApprovalError("unknown_preview");
    }
    if (!preview.approved) {
      throw new ApprovalError("not_approved");
    }
    let current: string;
    try {
      current = await this.previewState(preview.action);
    } catch {
      this.previews.delete(approval.previewId);
      throw new ApprovalError("stale_preview");
    }
    if (current !== preview.digest) {
      this.previews.delete(approval.previewId);
      throw new ApprovalError("stale_preview");
    }
    return preview.publicPreview;
  }

  discard(previewId: string): void {
    this.previews.delete(previewId);
  }

  private async previewState(action: StoredAction): Promise<string> {
    const target = await this.pathPolicy.authorizePath(action.targetPath, "write");
    const targetSnapshot = await snapshot(target.path);
    let sourcePath: string | undefined;
    let sourceSnapshot: FileSnapshot | undefined;
    if (action.kind === "move") {
      const source = await this.pathPolicy.authorizePath(action.sourcePath, "read");
      if (source.path === target.path) {
        throw new ApprovalError("stale_preview");
      }
      sourcePath = source.path;
      sourceSnapshot = await snapshot(source.path);
    }
    const contentHash = action.kind === "write" ? action.contentHash : undefined;
    return hash(JSON.stringify({
      kind: action.kind,
      sourcePath,
      sourceSnapshot,
      targetPath: target.path,
      targetSnapshot,
      contentHash,
    }));
  }
}
