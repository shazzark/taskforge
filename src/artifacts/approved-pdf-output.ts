import { randomUUID, createHash } from "node:crypto";
import { link, open, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ActionApprovalRegistry, ActionPreview, ApprovedAction } from "../security/approval-preview.js";
import type { ApprovedRoot, WorkspacePathPolicy } from "../security/path-policy.js";
import { renderPdfReport } from "./pdf-report.js";

export class PdfArtifactError extends Error {
  constructor(message = "The PDF artifact could not be prepared or written safely.") {
    super(message);
    this.name = "PdfArtifactError";
  }
}

export interface PendingPdfArtifact {
  readonly preview: ActionPreview;
  readonly bytes: Uint8Array;
  readonly digest: string;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function previewPdfArtifact(
  value: unknown,
  targetPath: unknown,
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  approvals: ActionApprovalRegistry,
): Promise<PendingPdfArtifact> {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) throw new PdfArtifactError("A PDF output path is required.");
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === resolve(root.path))) throw new PdfArtifactError("Output root approval is required.");
  try {
    const target = await policy.authorizePath(targetPath, "write");
    if (resolve(target.root) !== resolve(root.path) || target.exists) throw new PdfArtifactError("PDF output must be a new file inside the approved root.");
    const bytes = await renderPdfReport(value);
    const base64Plan = Buffer.from(bytes).toString("base64");
    const preview = await approvals.preview({ kind: "write", targetPath: target.path, content: base64Plan });
    if (preview.targetExists) throw new PdfArtifactError("PDF output already exists; choose a new file path.");
    return { preview, bytes, digest: sha256(bytes) };
  } catch (error: unknown) {
    if (error instanceof PdfArtifactError) throw error;
    throw new PdfArtifactError();
  }
}

export async function writeApprovedPdfArtifact(
  pending: PendingPdfArtifact,
  approval: ApprovedAction,
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  approvals: ActionApprovalRegistry,
): Promise<{ readonly path: string; readonly byteCount: number; readonly sha256: string }> {
  let temporaryPath: string | undefined;
  try {
    const currentPreview = await approvals.revalidate(approval);
    if (currentPreview.previewId !== pending.preview.previewId || currentPreview.kind !== "write" || currentPreview.targetExists) {
      throw new PdfArtifactError("PDF output approval is invalid or stale.");
    }
    const authorized = await policy.authorizePath(currentPreview.targetPath, "write");
    if (resolve(authorized.root) !== resolve(root.path) ||
        !policy.listApprovedRoots().some((entry) => resolve(entry.path) === resolve(root.path)) || authorized.exists) {
      throw new PdfArtifactError("PDF output must remain a new file inside the approved root.");
    }
    const canonicalTarget = await realpath(dirname(authorized.path));
    if (canonicalTarget !== dirname(authorized.path)) throw new PdfArtifactError("PDF output directory changed after approval.");
    const expectedHash = sha256(pending.bytes);
    if (expectedHash !== pending.digest || !Buffer.from(pending.bytes).subarray(0, 5).equals(Buffer.from("%PDF-")) ||
        !Buffer.from(pending.bytes).includes(Buffer.from("%%EOF"))) throw new PdfArtifactError("Rendered PDF integrity validation failed.");
    temporaryPath = resolve(dirname(authorized.path), `.taskforge-${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(pending.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Hard-link creation is atomic and fails if another file occupies the approved target.
    await link(temporaryPath, authorized.path);
    await unlink(temporaryPath);
    temporaryPath = undefined;
    const outputPath = await realpath(authorized.path);
    if (outputPath !== authorized.path) throw new PdfArtifactError("Written PDF path changed during integrity verification.");
    const output = await open(outputPath, "r");
    try {
      const written = await output.readFile();
      const writtenHash = sha256(written);
      if (writtenHash !== expectedHash || written.byteLength !== pending.bytes.byteLength) throw new PdfArtifactError("Written PDF failed hash validation.");
      return { path: authorized.path, byteCount: written.byteLength, sha256: writtenHash };
    } finally {
      await output.close();
    }
  } catch (error: unknown) {
    if (error instanceof PdfArtifactError) throw error;
    throw new PdfArtifactError();
  } finally {
    if (temporaryPath !== undefined) {
      try {
        await unlink(temporaryPath);
      } catch {
        // The temporary file may already have been removed after a successful link.
      }
    }
  }
}
