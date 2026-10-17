import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MongoStore } from "../dist/mongo-store.js";
import { SqliteStore } from "../dist/persistence/sqlite-store.js";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { runCsvAnalysisWorkflow } from "../dist/workflows/csv-analysis-workflow.js";
import { analyzeDocument } from "../dist/workflows/document-analysis-workflow.js";
import { inspectRepository } from "../dist/workflows/repository-inspection-workflow.js";

const mongoBase = process.env.TASKFORGE_TEST_MONGODB_URI;

function createIsolatedMongoUri(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("TASKFORGE_TEST_MONGODB_URI is required.");
  const uri = new URL(value);
  if (uri.protocol !== "mongodb:" || uri.hostname !== "127.0.0.1" || !["27017", "27018"].includes(uri.port) ||
      uri.username.length > 0 || uri.password.length > 0) {
    throw new Error("The adapter contract requires a credential-free loopback MongoDB base URI.");
  }
  uri.pathname = `/taskforge_contract_${randomUUID().replaceAll("-", "")}`;
  return uri.toString();
}

async function exerciseCommonContract(store, scopePath, prefix) {
  const runId = `${prefix}-contract-run`;
  const inputHash = "1".repeat(64);
  const stateHash = "2".repeat(64);

  const run = await store.saveRunSummary({ runId, workflowId: "document-analyze", summary: "api_key=adapter-contract-secret" });
  assert.equal(run.state, "created");
  assert.match(run.summary, /\[REDACTED\]/u);
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: "start", type: "run_started" });
  await store.saveRunCheckpoint({ runId, version: 1, inputHash, stateHash, completedStepIds: ["parse"] });
  assert.equal((await store.getRunSummary(runId))?.state, "running");
  assert.deepEqual((await store.getRunEvents(runId)).map((event) => [event.sequence, event.type]), [[1, "run_started"]]);
  assert.deepEqual((await store.loadRunCheckpoint(runId, inputHash, stateHash))?.completedStepIds, ["parse"]);
  await assert.rejects(store.loadRunCheckpoint(runId, "3".repeat(64), stateHash), /stale/u);
  await store.updateRunState(runId, "completed");

  const artifact = await store.saveArtifactReference({
    artifactId: `${prefix}-artifact`, runId, relativePath: "reports/summary.txt", type: "document-plain-text",
    sha256: "a".repeat(64), bytes: 128,
  });
  assert.deepEqual(await store.listArtifactReferences(runId), [artifact]);

  await store.grantFolderApproval(scopePath, "read");
  assert.equal(await store.hasFolderApproval(join(scopePath, "child"), "read"), true);
  assert.equal(await store.hasFolderApproval(scopePath, "write"), false);
  assert.equal(await store.revokeFolderApproval(scopePath, "read"), true);
  assert.equal(await store.hasFolderApproval(scopePath, "read"), false);

  const nextRunAt = new Date(Date.now() + 60_000);
  await store.createSchedule({ scheduleId: `${prefix}-schedule`, workflowId: "csv-analyze", inputPath: resolve(scopePath, "input.csv"), nextRunAt });
  assert.equal((await store.listSchedules())[0]?.status, "active");
  assert.equal((await store.setScheduleStatus(`${prefix}-schedule`, "paused"))?.status, "paused");
  assert.equal((await store.listSchedules())[0]?.status, "paused");

  const dueAt = new Date();
  const recurringScheduleId = `${prefix}-recurring-schedule`;
  await store.createSchedule({
    scheduleId: recurringScheduleId,
    workflowId: "csv-analyze",
    inputPath: resolve(scopePath, "recurring.csv"),
    nextRunAt: dueAt,
    intervalMinutes: 5,
  });
  const due = await store.claimDueSchedules(dueAt, 30_000);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.schedule.scheduleId, recurringScheduleId);
  assert.equal(due[0]?.occurrence.status, "awaiting_approval");
  assert.equal((await store.getRunSummary(due[0].occurrence.runId))?.state, "awaiting_approval");
  const dispatch = await store.claimPendingScheduleOccurrences(`${prefix}-worker`);
  assert.equal(dispatch.length, 1);
  assert.equal((await store.claimPendingScheduleOccurrences(`${prefix}-other-worker`)).length, 0);
  await store.releaseScheduleOccurrenceClaim(recurringScheduleId, dueAt, `${prefix}-worker`);
  assert.equal((await store.claimPendingScheduleOccurrences(`${prefix}-retry-worker`)).length, 1);
  assert.equal(await store.recoverScheduleOccurrenceClaim(recurringScheduleId, dueAt), true);
  assert.equal((await store.claimPendingScheduleOccurrences(`${prefix}-recovered-worker`)).length, 1);
  await store.finishScheduleOccurrence(recurringScheduleId, dueAt, "failed", `${prefix}-recovered-worker`);
  const finishedSchedule = (await store.listSchedules()).find((schedule) => schedule.scheduleId === recurringScheduleId);
  assert.equal(finishedSchedule?.pendingOccurrence, undefined);
  assert.equal(finishedSchedule?.occurrences.some((occurrence) => occurrence.status === "failed"), true);

  assert.equal((await store.getRunSummary(runId))?.state, "completed");

  const csv = await runCsvAnalysisWorkflow(store, Buffer.from("name,amount\nA,2\nB,3\n", "utf8"), undefined, ["amount"]);
  assert.equal(csv.run.state, "completed");
  assert.equal(csv.analysis.rowCount, 2);
  assert.equal((await store.getRunSummary(csv.run.runId))?.state, "completed");

  const document = await analyzeDocument(store, ".txt", Buffer.from("synthetic private marker", "utf8"));
  assert.equal(document.run.state, "completed");
  assert.equal(document.analysis.wordCount, 3);
  assert.equal((await store.getRunSummary(document.run.runId))?.summary.includes("synthetic private marker"), false);

  const workspace = join(scopePath, `${prefix}-workspace`);
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(join(workspace, "test"), { recursive: true });
  await writeFile(join(workspace, "src", "entry.ts"), "export const entry = true;\n", "utf8");
  await writeFile(join(workspace, "test", "entry.test.mjs"), "// synthetic test file\n", "utf8");
  const policy = new WorkspacePathPolicy();
  const approvedRoot = await policy.approveRoot(workspace);
  const repository = await inspectRepository(store, approvedRoot, policy);
  assert.equal(repository.run.state, "completed");
  assert.equal(repository.inventory.sourceFileCount, 2);
  assert.equal((await store.getRunSummary(repository.run.runId))?.summary.includes(workspace), false);
}

test("SQLite implements the shared persistence adapter contract", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "taskforge-store-contract-sqlite-"));
  const store = await SqliteStore.connect({ path: join(directory, "contract.sqlite3") });
  try {
    await exerciseCommonContract(store, directory, "sqlite");
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("MongoDB implements the shared persistence adapter contract", { skip: typeof mongoBase !== "string" }, async () => {
  const uri = createIsolatedMongoUri(mongoBase);
  const store = await MongoStore.connect({ mongodbUri: uri });
  const client = new MongoClient(uri);
  const scopePath = await mkdtemp(join(tmpdir(), "taskforge-store-contract-mongo-"));
  try {
    await client.connect();
    await exerciseCommonContract(store, scopePath, "mongo");
  } finally {
    try { await store.close(); }
    finally {
      try { await client.db().dropDatabase(); }
      finally {
        try { await client.close(); }
        finally { await rm(scopePath, { recursive: true, force: true }); }
      }
    }
  }
});

test("CLI doctor opens local storage only under the isolated LOCALAPPDATA root", async () => {
  const localAppData = await mkdtemp(join(tmpdir(), "taskforge-local-doctor-contract-"));
  try {
    const result = spawnSync(process.execPath, ["dist/cli.js", "doctor"], {
      encoding: "utf8",
      env: { ...process.env, TASKFORGE_STORAGE: "local", LOCALAPPDATA: localAppData, TASKFORGE_MONGODB_URI: undefined },
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Storage: local SQLite database \(path redacted\)/u);
    assert.match(result.stdout, /Local storage: available/u);
    assert.equal(result.stdout.includes(localAppData), false);
  } finally {
    await rm(localAppData, { recursive: true, force: true });
  }
});
