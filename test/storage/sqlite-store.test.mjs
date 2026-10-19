import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteStore } from "../../dist/storage/sqlite-store.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "taskforge-sqlite-"));
  const path = join(directory, "test.db");
  const store = await SqliteStore.connect({ path });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { path, store };
}
const hash = "a".repeat(64);

function runSqliteChild(source, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`SQLite child exited ${code}: ${stderr}`)));
  });
}

test("run records, transitions, bounded events, and checkpoints persist across restart", async t => {
  const { path, store } = await fixture(t);
  const run = await store.saveRunSummary({ runId: "run-a", workflowId: "test-flow", summary: "safe" });
  assert.equal(run.state, "created");
  await store.updateRunState(run.runId, "running");
  const event = await store.appendRunEvent({ runId: run.runId, eventId: "start", type: "run_started" });
  assert.equal(event.sequence, 1);
  await store.saveRunCheckpoint({ runId: run.runId, version: 1, inputHash: hash, stateHash: hash, completedStepIds: ["step-1"] });
  await store.close();
  const reopened = await SqliteStore.connect({ path });
  assert.equal((await reopened.getRunSummary(run.runId))?.state, "running");
  assert.equal((await reopened.getRunEvents(run.runId)).length, 1);
  assert.deepEqual((await reopened.loadRunCheckpoint(run.runId, hash, hash))?.completedStepIds, ["step-1"]);
  await reopened.close();
});

test("a closed disposable SQLite store can be backed up and restored with run, event, checkpoint, and grant data", async t => {
  const directory = await mkdtemp(join(tmpdir(), "taskforge-sqlite-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "source.db");
  const backupPath = join(directory, "source.db.backup");
  const displacedPath = join(directory, "source.db.before-restore");
  const runId = "backup-restore-run";
  const store = await SqliteStore.connect({ path });
  await store.saveRunSummary({ runId, workflowId: "synthetic-backup", summary: "synthetic data" });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: "backup-event", type: "run_started" });
  await store.saveRunCheckpoint({ runId, version: 1, inputHash: hash, stateHash: hash, completedStepIds: ["backup-step"] });
  assert.equal((await store.grantFolderApproval(directory, "read")).status, "active");
  await store.close();

  // A raw SQLite file copy is used only after all store handles close and WAL data is checkpointed.
  const checkpoint = new DatabaseSync(path);
  try { checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
  await copyFile(path, backupPath);
  const backupDigest = createHash("sha256").update(await readFile(backupPath)).digest("hex");

  const changed = await SqliteStore.connect({ path });
  await changed.saveRunSummary({ runId: "created-after-backup", workflowId: "synthetic-backup", summary: "must disappear after restore" });
  await changed.close();
  await rename(path, displacedPath);
  await copyFile(backupPath, path);
  assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), backupDigest);

  const integrity = new DatabaseSync(path);
  try { assert.equal(integrity.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); }
  finally { integrity.close(); }

  const restored = await SqliteStore.connect({ path });
  try {
    assert.equal((await restored.getRunSummary(runId))?.state, "running");
    assert.equal((await restored.getRunEvents(runId))[0]?.eventId, "backup-event");
    assert.deepEqual((await restored.loadRunCheckpoint(runId, hash, hash))?.completedStepIds, ["backup-step"]);
    assert.equal(await restored.hasFolderApproval(directory, "read"), true);
    assert.equal(await restored.getRunSummary("created-after-backup"), null);
  } finally { await restored.close(); }
});

test("SQLite recovers committed data and rolls back an interrupted transaction after process exit", async t => {
  const { path, store } = await fixture(t);
  await store.saveRunSummary({ runId: "before-interruption", workflowId: "synthetic", summary: "committed" });
  await store.close();
  const child = spawnSync(process.execPath, ["-e", [
    'const { DatabaseSync } = require("node:sqlite");',
    'const db = new DatabaseSync(process.argv[1]);',
    'db.exec("BEGIN IMMEDIATE");',
    'db.prepare("INSERT INTO runs(id,value) VALUES (?,?)").run("interrupted-write", "{}")',
    'process.exit(71);',
  ].join(";"), path], { encoding: "utf8", timeout: 10_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 71, child.stderr);

  const reopened = await SqliteStore.connect({ path });
  try {
    assert.equal((await reopened.getRunSummary("before-interruption"))?.summary, "committed");
    assert.equal(await reopened.getRunSummary("interrupted-write"), null);
    const integrity = new DatabaseSync(path);
    try {
      assert.equal(integrity.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally {
      integrity.close();
    }
  } finally {
    await reopened.close();
  }
});

test("input validation, secret redaction, approvals, and state transitions hold", async t => {
  const { store } = await fixture(t);
  const run = await store.saveRunSummary({ runId: "run-safe", workflowId: "workflow", summary: "token=secret-value" });
  assert.match(run.summary, /\[REDACTED\]/u);
  await assert.rejects(store.updateRunState(run.runId, "completed"), /transition/u);
  await store.updateRunState(run.runId, "running");
  await store.updateRunState(run.runId, "completed");
  await assert.rejects(store.saveRunSummary({ runId: "password-value", workflowId: "workflow", summary: "x" }), /bounded identifier/u);
  assert.equal(await store.grantFolderApproval(process.cwd(), "read").then(x => x.status), "active");
  assert.equal(await store.hasFolderApproval(join(process.cwd(), "nested"), "read"), true);
  assert.equal(await store.revokeFolderApproval(process.cwd(), "read"), true);
});

test("history lists only the newest fifty run summaries while preserving older stored records", async t => {
  const { store } = await fixture(t);
  const firstRunId = "history-run-00";
  for (let index = 0; index < 55; index += 1) {
    await store.saveRunSummary({
      runId: `history-run-${String(index).padStart(2, "0")}`,
      workflowId: "synthetic-history",
      summary: index === 54 ? "token=synthetic-history-secret" : `Synthetic history item ${index}`,
    });
  }
  const visible = await store.listRunSummaries();
  assert.equal(visible.length, 50);
  assert.match(visible.find((run) => run.runId === "history-run-54")?.summary ?? "", /\[REDACTED\]/u);
  assert.ok(await store.getRunSummary(firstRunId), "older history is still retained outside the 50-item list window");
});

test("two connections atomically claim one pending occurrence once", async t => {
  const { path, store } = await fixture(t);
  const second = await SqliteStore.connect({ path });
  t.after(() => second.close());
  const at = new Date(Date.now() + 5_000);
  await store.createSchedule({ scheduleId: "schedule-a", workflowId: "csv-analyze", inputPath: join(process.cwd(), "sample.csv"), nextRunAt: at });
  const claims = await Promise.all([store.claimDueSchedules(new Date(at.getTime() + 1), 30_000), second.claimDueSchedules(new Date(at.getTime() + 1), 30_000)]);
  assert.equal(claims.flat().length, 1);
  const [firstClaim] = await Promise.all([store.claimPendingScheduleOccurrences("owner-a"), second.claimPendingScheduleOccurrences("owner-b")]);
  assert.equal(firstClaim.length, 1);
  assert.equal((await store.claimPendingScheduleOccurrences("owner-c")).length, 0);
  await store.finishScheduleOccurrence("schedule-a", at, "completed", "owner-a");
  assert.equal((await store.listPendingScheduleOccurrences()).length, 0);
  await second.close();
});

test("separate SQLite processes contend safely for one schedule claim", async t => {
  const { path, store } = await fixture(t);
  const dueAt = new Date(Date.now() - 5_000);
  await store.createSchedule({ scheduleId: "cross-process-schedule", workflowId: "csv-analyze", inputPath: join(process.cwd(), "synthetic.csv"), nextRunAt: dueAt });
  const moduleUrl = new URL("../../dist/storage/sqlite-store.js", import.meta.url).href;
  const source = [
    `const { SqliteStore } = await import(${JSON.stringify(moduleUrl)});`,
    "const store = await SqliteStore.connect({ path: process.argv[1] });",
    "const claims = await store.claimDueSchedules(new Date(Number(process.argv[2])), 30000);",
    "process.stdout.write(String(claims.length));",
    "await store.close();",
  ].join("\n");
  const results = await Promise.all([
    runSqliteChild(source, [path, String(dueAt.getTime())]),
    runSqliteChild(source, [path, String(dueAt.getTime())]),
  ]);
  assert.deepEqual(results.map(Number).sort(), [0, 1]);
  assert.equal((await store.listPendingScheduleOccurrences()).length, 1);
});

test("separate processes can initialize a new SQLite database without losing writes", async t => {
  const { path, store } = await fixture(t);
  await store.close();
  const freshPath = join(dirname(path), "concurrent-first-open.sqlite3");
  const moduleUrl = new URL("../../dist/storage/sqlite-store.js", import.meta.url).href;
  const source = [
    `const { SqliteStore } = await import(${JSON.stringify(moduleUrl)});`,
    "const store = await SqliteStore.connect({ path: process.argv[1] });",
    "await store.saveRunSummary({ runId: process.argv[2], workflowId: 'cross-process-init', summary: 'saved' });",
    "await store.close();",
  ].join("\n");
  await Promise.all([
    runSqliteChild(source, [freshPath, "concurrent-init-a"]),
    runSqliteChild(source, [freshPath, "concurrent-init-b"]),
  ]);
  const reopened = await SqliteStore.connect({ path: freshPath });
  try {
    assert.equal((await reopened.getRunSummary("concurrent-init-a"))?.summary, "saved");
    assert.equal((await reopened.getRunSummary("concurrent-init-b"))?.summary, "saved");
  } finally {
    await reopened.close();
  }
});

test("missed repeated occurrences preserve a pending approval and failed completion is recorded", async t => {
  const { store } = await fixture(t);
  const firstAt = new Date(Date.now() + 5_000);
  await store.createSchedule({
    scheduleId: "repeated-schedule",
    workflowId: "csv-analyze",
    inputPath: join(process.cwd(), "synthetic.csv"),
    nextRunAt: firstAt,
    intervalMinutes: 1,
  });
  const firstClaim = await store.claimDueSchedules(new Date(firstAt.getTime() + 1), 30_000);
  assert.equal(firstClaim.length, 1);

  const secondDue = new Date(firstAt.getTime() + 3 * 60_000 + 1);
  assert.deepEqual(await store.claimDueSchedules(secondDue, 30_000), []);
  const schedule = (await store.listSchedules())[0];
  assert.ok(schedule);
  assert.equal(schedule.occurrences.length, 2);
  assert.equal(schedule.occurrences[1]?.status, "missed");
  assert.equal(schedule.occurrences[1]?.missedCount, 3);
  assert.equal(schedule.pendingOccurrence?.scheduledFor.getTime(), firstAt.getTime());

  const pending = await store.claimPendingScheduleOccurrences("retry-owner");
  assert.equal(pending.length, 1);
  await store.finishScheduleOccurrence("repeated-schedule", firstAt, "failed", "retry-owner");
  const finished = (await store.listSchedules())[0];
  assert.equal(finished?.occurrences[0]?.status, "failed");
  assert.equal(finished?.pendingOccurrence, undefined);
});

test("scheduler rejects grace below MongoStore minimum and closed stores fail as persistence errors", async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.claimDueSchedules(new Date(), 999), /1 to 60 seconds/u);
  await store.close();
  await assert.rejects(store.listRunSummaries(), /persist|read/u);
});

test("malformed persisted run fails closed", async t => {
  const { path, store } = await fixture(t);
  await store.saveRunSummary({ runId: "corrupt-me", workflowId: "workflow", summary: "ok" });
  const direct = new DatabaseSync(path);
  direct.prepare("UPDATE runs SET value=? WHERE id=?").run(JSON.stringify({ _id: "corrupt-me", runId: "corrupt-me", workflowId: "workflow", summary: "bad", state: "mystery", createdAt: { $date: new Date().toISOString() } }), "corrupt-me");
  direct.close();
  await assert.rejects(store.getRunSummary("corrupt-me"), /persist|read/u);
});

test("unknown or non-TaskForge SQLite schemas are rejected without alteration", async t => {
  const directory = await mkdtemp(join(tmpdir(), "taskforge-sqlite-version-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const unknownVersionPath = join(directory, "unknown-version.db");
  const versioned = new DatabaseSync(unknownVersionPath);
  versioned.exec("CREATE TABLE owner_data(value TEXT); PRAGMA user_version=99;");
  versioned.close();
  await assert.rejects(SqliteStore.connect({ path: unknownVersionPath }), /compatible local TaskForge database/u);
  const stillVersioned = new DatabaseSync(unknownVersionPath);
  assert.equal(stillVersioned.prepare("PRAGMA user_version").get().user_version, 99);
  assert.equal(stillVersioned.prepare("SELECT count(*) AS count FROM owner_data").get().count, 0);
  stillVersioned.close();

  const unversionedPath = join(directory, "unversioned.db");
  const unversioned = new DatabaseSync(unversionedPath);
  unversioned.exec("CREATE TABLE unrelated_owner_data(value TEXT);");
  unversioned.close();
  await assert.rejects(SqliteStore.connect({ path: unversionedPath }), /compatible local TaskForge database/u);
  const stillUnversioned = new DatabaseSync(unversionedPath);
  assert.equal(stillUnversioned.prepare("SELECT name FROM sqlite_master WHERE name='unrelated_owner_data'").get().name, "unrelated_owner_data");
  stillUnversioned.close();
});
