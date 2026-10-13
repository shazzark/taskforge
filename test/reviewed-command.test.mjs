import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
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

test("selected Node test runs only the exact in-root file and rejects unsafe selections", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-selected-test-"));
  try {
    const testDirectory = join(rootPath, "test");
    await mkdir(testDirectory);
    await writeFile(join(testDirectory, "selected.test.mjs"), "import assert from 'node:assert/strict';\nassert.equal(2, 2);\n", "utf8");
    await writeFile(join(testDirectory, "unselected.test.mjs"), "import assert from 'node:assert/strict';\nassert.equal(1, 2, 'must not run');\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const result = await runReviewedCommand(persistence, root, policy, "node-test", "test/selected.test.mjs");
    assert.equal(result.command, "node-test-selected");
    assert.equal(result.status, "passed");
    assert.equal(result.run.state, "completed");
    assert.doesNotMatch(result.run.summary, /selected\.test\.mjs/u);
    for (const invalid of ["../outside.test.mjs", ".\\..\\outside.test.mjs", "test/missing.test.mjs", "test/data.json", join(testDirectory, "selected.test.mjs")]) {
      await assert.rejects(runReviewedCommand(persistence, root, policy, "node-test", invalid), ReviewedCommandError);
    }
    await assert.rejects(runReviewedCommand(persistence, root, policy, "typescript-check", "test/selected.test.mjs"), ReviewedCommandError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("selected Node test revalidates its path after approval and refuses a junction swap", async (context) => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-selected-race-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-selected-outside-"));
  const testDirectory = join(rootPath, "test");
  const selectedPath = join(testDirectory, "selected.test.mjs");
  const markerPath = join(outsidePath, "executed.txt");
  try {
    await mkdir(testDirectory);
    await writeFile(selectedPath, "import assert from 'node:assert/strict';\nassert.ok(true);\n", "utf8");
    await writeFile(join(outsidePath, "selected.test.mjs"), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(markerPath)}, 'escaped');\n`, "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const append = persistence.appendRunEvent.bind(persistence);
    let swapped = false;
    persistence.appendRunEvent = async (event) => {
      const saved = await append(event);
      if (!swapped && event.type === "step_started") {
        swapped = true;
        await rename(testDirectory, join(rootPath, "test-original"));
        try {
          await symlink(outsidePath, testDirectory, "junction");
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && ["EPERM", "EACCES"].includes(error.code)) {
            context.skip("Windows does not permit creating a test junction in this environment.");
            return saved;
          }
          throw error;
        }
      }
      return saved;
    };
    const result = await runReviewedCommand(persistence, root, policy, "node-test", "test/selected.test.mjs");
    assert.equal(result.status, "could_not_start");
    assert.equal(result.run.state, "failed");
    assert.equal(persistence.state.events.at(-1)?.type, "run_failed");
    await assert.rejects(import("node:fs/promises").then(({ access }) => access(markerPath)), (error) => error.code === "ENOENT");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
