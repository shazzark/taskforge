import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { runReviewedCommand, ReviewedCommandError } from "../dist/software/reviewed-command.js";

function createPersistenceRecorder() {
  const state = { events: [], runs: new Map() };
  return {
    state,
    async saveRunSummary(input) {
      const run = { ...input, state: "created", createdAt: new Date() };
      state.runs.set(input.runId, run);
      return run;
    },
    async updateRunState(runId, status) {
      const run = state.runs.get(runId);
      const updated = { ...run, state: status };
      state.runs.set(runId, updated);
      return updated;
    },
    async updateRunSummary(runId, summary) {
      const run = state.runs.get(runId);
      state.runs.set(runId, { ...run, summary });
    },
    async appendRunEvent(event) {
      state.events.push(event);
      return { ...event, sequence: state.events.length, createdAt: new Date() };
    },
  };
}

test("reviewed node-test reproduces a seeded failure and records only redacted outcomes", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-command-check-"));
  try {
    const testPath = join(rootPath, "test", "seeded.test.mjs");
    await mkdir(join(rootPath, "test"));
    await writeFile(testPath, "import assert from 'node:assert/strict';\nassert.equal(1, 2, 'seeded bug marker');\n", "utf8");

    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const failed = await runReviewedCommand(persistence, approvedRoot, policy, "node-test");
    assert.equal(failed.status, "failed");
    assert.notEqual(failed.exitCode, 0);
    assert.equal(failed.run.state, "failed");
    assert.equal(Object.hasOwn(failed, "stdout"), false);
    assert.equal(JSON.stringify([...persistence.state.runs.values()]).includes("seeded bug marker"), false);
    assert.equal(JSON.stringify(persistence.state.events).includes("seeded bug marker"), false);

    await writeFile(testPath, "import assert from 'node:assert/strict';\nassert.equal(1, 1);\n", "utf8");
    const passed = await runReviewedCommand(persistence, approvedRoot, policy, "node-test");
    assert.equal(passed.status, "passed");
    assert.equal(passed.exitCode, 0);
    assert.equal(passed.run.state, "completed");
    assert.equal(persistence.state.events.some((event) => event.type === "run_finished"), true);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("reviewed command requires exact in-memory root approval and a fixed command id", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-command-unapproved-"));
  try {
    const policy = new WorkspacePathPolicy();
    const persistence = createPersistenceRecorder();
    await assert.rejects(
      runReviewedCommand(persistence, { path: rootPath }, policy, "node-test"),
      ReviewedCommandError,
    );
    const root = await policy.approveRoot(rootPath);
    await assert.rejects(
      runReviewedCommand(persistence, root, policy, "node -e arbitrary"),
      ReviewedCommandError,
    );
    assert.equal(persistence.state.runs.size, 0);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
