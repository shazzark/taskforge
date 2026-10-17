import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActionApprovalRegistry } from "../../../dist/security/approval-preview.js";
import { WorkspacePathPolicy } from "../../../dist/security/path-policy.js";
import { previewPdfArtifact, PdfArtifactError, writeApprovedPdfArtifact } from "../../../dist/tools/artifacts/approved-pdf-output.js";

const report = { title: "Fixture report", createdAt: "2026-01-01T00:00:00.000Z", sections: [{ heading: "Summary", body: "Verified fixture output." }] };

test("approved PDF artifact is create-only and passes byte/hash integrity checks", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-pdf-artifact-"));
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const approvals = new ActionApprovalRegistry(policy);
    const outputPath = join(rootPath, "report.pdf");
    const pending = await previewPdfArtifact(report, outputPath, root, policy, approvals);
    const approval = approvals.approve(pending.preview.previewId);
    const written = await writeApprovedPdfArtifact(pending, approval, root, policy, approvals);
    const actual = await readFile(outputPath);
    assert.equal(written.byteCount, actual.byteLength);
    assert.equal(written.sha256, pending.digest);
    assert.equal(actual.subarray(0, 5).toString("ascii"), "%PDF-");
    await assert.rejects(previewPdfArtifact(report, outputPath, root, policy, approvals), PdfArtifactError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("PDF artifact refuses stale targets and paths outside the approved root", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-pdf-stale-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-pdf-outside-"));
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const approvals = new ActionApprovalRegistry(policy);
    const outputPath = join(rootPath, "report.pdf");
    const pending = await previewPdfArtifact(report, outputPath, root, policy, approvals);
    await writeFile(outputPath, "owner-created file", "utf8");
    const approval = approvals.approve(pending.preview.previewId);
    await assert.rejects(writeApprovedPdfArtifact(pending, approval, root, policy, approvals), PdfArtifactError);
    await assert.rejects(previewPdfArtifact(report, join(outsidePath, "report.pdf"), root, policy, approvals), PdfArtifactError);
    assert.equal((await readFile(outputPath, "utf8")), "owner-created file");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
