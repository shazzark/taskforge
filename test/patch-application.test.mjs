import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActionApprovalRegistry, ApprovalError } from "../dist/security/approval-preview.js";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { applyPreparedFilePatch, PatchApplicationError, prepareFilePatch } from "../dist/software/patch-application.js";
import { runReviewedCommand } from "../dist/software/reviewed-command.js";

function createPersistenceRecorder() {
  const runs = new Map();
  const events = [];
  return {
    async saveRunSummary(input) {
      const run = { ...input, state: "created", createdAt: new Date() };
      runs.set(input.runId, run);
      return run;
    },
    async updateRunState(runId, state) {
      const run = { ...runs.get(runId), state };
      runs.set(runId, run);
      return run;
    },
    async updateRunSummary(runId, summary) {
      runs.set(runId, { ...runs.get(runId), summary });
    },
    async appendRunEvent(event) {
      events.push(event);
      return { ...event, sequence: events.length, createdAt: new Date() };
    },
  };
}

test("file patch applies only the replacement bound to its approved preview", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-patch-"));
  try {
    await writeFile(join(rootPath, "target.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(rootPath, "replacement.ts"), "export const value = 2;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await prepareFilePatch(root, policy, approvals, "target.ts", "replacement.ts");
    const approval = approvals.approve(pending.preview.previewId);
    await applyPreparedFilePatch(pending, approval, approvals);
    assert.equal(await readFile(join(rootPath, "target.ts"), "utf8"), "export const value = 2;\n");
    await assert.rejects(applyPreparedFilePatch(pending, approval, approvals), PatchApplicationError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("file patch refuses changed targets, mismatched approval content and paths outside the root", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-patch-stale-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-patch-outside-"));
  try {
    await writeFile(join(rootPath, "target.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(rootPath, "replacement.ts"), "export const value = 2;\n", "utf8");
    await writeFile(join(outsidePath, "outside.ts"), "export const value = 3;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await prepareFilePatch(root, policy, approvals, "target.ts", "replacement.ts");
    const approval = approvals.approve(pending.preview.previewId);
    await writeFile(join(rootPath, "target.ts"), "owner changed target\n", "utf8");
    await assert.rejects(applyPreparedFilePatch(pending, approval, approvals), PatchApplicationError);
    assert.equal(await readFile(join(rootPath, "target.ts"), "utf8"), "owner changed target\n");
    await assert.rejects(prepareFilePatch(root, policy, approvals, "../outside.ts", "replacement.ts"), PatchApplicationError);
    await assert.rejects(prepareFilePatch(root, policy, approvals, "target.ts", "../outside.ts"), PatchApplicationError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test("reviewed patch reproduces a seeded test failure, applies the approved fix, and reruns cleanly", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-patch-seeded-"));
  try {
    await mkdir(join(rootPath, "test"));
    await writeFile(join(rootPath, "value.mjs"), "export const value = 1;\n", "utf8");
    await writeFile(join(rootPath, "test", "value.test.mjs"), "import assert from 'node:assert/strict';\nimport { value } from '../value.mjs';\nassert.equal(value, 2);\n", "utf8");
    await writeFile(join(rootPath, "replacement.mjs"), "export const value = 2;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const store = createPersistenceRecorder();
    const failed = await runReviewedCommand(store, root, policy, "node-test");
    assert.equal(failed.status, "failed");
    const approvals = new ActionApprovalRegistry(policy);
    const prepared = await prepareFilePatch(root, policy, approvals, "value.mjs", "replacement.mjs");
    const approval = approvals.approve(prepared.preview.previewId);
    await applyPreparedFilePatch(prepared, approval, approvals);
    const passed = await runReviewedCommand(store, root, policy, "node-test");
    assert.equal(passed.status, "passed");
    assert.equal(passed.run.state, "completed");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
