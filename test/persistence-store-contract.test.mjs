import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MongoStore } from "../dist/mongo-store.js";
import { SqliteStore } from "../dist/persistence/sqlite-store.js";

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
  assert.equal((await store.getRunSummary(runId))?.state, "completed");
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
