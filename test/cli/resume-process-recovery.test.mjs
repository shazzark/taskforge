import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("CSV resume recovers a process-exited run once and rejects a second resume in a new CLI process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "taskforge-resume-process-"));
  const databasePath = join(directory, "taskforge.sqlite3");
  const inputPath = join(directory, "amounts.csv");
  const input = Buffer.from("item,amount\nNotebook,12\nPen,8\n", "utf8");
  const runId = `crash-resume-${randomUUID()}`;
  await writeFile(inputPath, input);
  const childEnv = {
    ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    TEMP: directory,
    TMP: directory,
    TASKFORGE_TEST_DB_PATH: databasePath,
    TASKFORGE_TEST_INPUT_PATH: inputPath,
    TASKFORGE_TEST_RUN_ID: runId,
  };

  const seedInterruptedProcess = `
    import { createHash } from "node:crypto";
    import { SqliteStore } from "./dist/storage/sqlite-store.js";
    const store = await SqliteStore.connect({ path: process.env.TASKFORGE_TEST_DB_PATH });
    const runId = process.env.TASKFORGE_TEST_RUN_ID;
    const bytes = Buffer.from(await (await import("node:fs/promises")).readFile(process.env.TASKFORGE_TEST_INPUT_PATH));
    await store.saveRunSummary({ runId, workflowId: "csv-analyze", summary: "CSV analysis started; input content is not persisted." });
    await store.updateRunState(runId, "running");
    await store.appendRunEvent({ runId, eventId: "process-start", type: "run_started" });
    await store.saveRunCheckpoint({
      runId, version: 1,
      inputHash: createHash("sha256").update(bytes).digest("hex"),
      stateHash: createHash("sha256").update('taskforge:csv-analyze:v2:["amount"]').digest("hex"),
      completedStepIds: [], pendingStepId: "analyze",
    });
    process.exit(23);
  `;

  try {
    const interrupted = spawnSync(process.execPath, ["--input-type=module", "-e", seedInterruptedProcess], {
      cwd: repositoryRoot, encoding: "utf8", env: childEnv, timeout: 15_000,
    });
    assert.equal(interrupted.error, undefined, interrupted.stderr);
    assert.equal(interrupted.status, 23, interrupted.stderr);

    const database = new DatabaseSync(databasePath);
    try {
      const row = database.prepare("SELECT value FROM runs WHERE id = ?").get(runId);
      assert.ok(row && typeof row.value === "string", "the interrupted process must have committed its running run");
      const stored = JSON.parse(row.value);
      stored.updatedAt = { $date: new Date(Date.now() - 3 * 60 * 1000).toISOString() };
      database.prepare("UPDATE runs SET value = ? WHERE id = ?").run(JSON.stringify(stored), runId);
    } finally {
      database.close();
    }

    const resumeInNewProcess = `
      import { readFile } from "node:fs/promises";
      import { resolve } from "node:path";
      import { resumeWorkflowCommand } from "./dist/cli/commands/data-documents.js";
      import { SqliteStore } from "./dist/storage/sqlite-store.js";
      const inputPath = resolve(process.env.TASKFORGE_TEST_INPUT_PATH);
      const dependencies = {
        readApprovedInputFile: async (candidatePath) => resolve(candidatePath) === inputPath ? new Uint8Array(await readFile(inputPath)) : undefined,
        requirePersistentFolderApproval: async () => {},
        withStore: async (action) => {
          const store = await SqliteStore.connect({ path: process.env.TASKFORGE_TEST_DB_PATH });
          try { return await action(store); } finally { await store.close(); }
        },
      };
      const args = ["--input", inputPath, "--numeric-column", "amount"];
      await resumeWorkflowCommand(process.env.TASKFORGE_TEST_RUN_ID, args, dependencies);
      process.exitCode = undefined;
      await resumeWorkflowCommand(process.env.TASKFORGE_TEST_RUN_ID, args, dependencies);
      const secondResumeExitCode = process.exitCode ?? 0;
      process.exitCode = undefined;
      const store = await SqliteStore.connect({ path: process.env.TASKFORGE_TEST_DB_PATH });
      try {
        const run = await store.getRunSummary(process.env.TASKFORGE_TEST_RUN_ID);
        const events = await store.getRunEvents(process.env.TASKFORGE_TEST_RUN_ID);
        console.log(JSON.stringify({ state: run?.state, events: events.map((event) => event.type), secondResumeExitCode }));
      } finally { await store.close(); }
    `;
    const resumed = spawnSync(process.execPath, ["--input-type=module", "-e", resumeInNewProcess], {
      cwd: repositoryRoot, encoding: "utf8", env: childEnv, timeout: 15_000,
    });
    assert.equal(resumed.error, undefined, resumed.stderr);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /resumed: 2 rows/u);
    assert.match(resumed.stdout, /amount=20/u);
    const persistedStateLine = resumed.stdout.trim().split("\n").at(-1);
    assert.ok(persistedStateLine);
    const persisted = JSON.parse(persistedStateLine);
    assert.equal(persisted.state, "completed");
    assert.equal(persisted.secondResumeExitCode, 3);
    assert.deepEqual(persisted.events, ["run_started", "run_paused", "run_resumed", "step_started", "step_finished", "run_finished"]);
    assert.equal(persisted.events.filter((event) => event === "run_resumed").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
