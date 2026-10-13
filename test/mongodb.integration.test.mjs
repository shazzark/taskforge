import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DatabaseConnectionError,
  DatabasePersistenceError,
  MongoStore,
  PersistenceInputError,
  StaleCheckpointError,
} from "../dist/mongo-store.js";
import { parseConfiguration } from "../dist/config.js";
import { resumeCsvAnalysisWorkflow, runCsvAnalysisWorkflow } from "../dist/workflows/csv-analysis-workflow.js";
import { analyzeDocument, resumeDocumentAnalysisWorkflow } from "../dist/workflows/document-analysis-workflow.js";
import { inspectRepository } from "../dist/workflows/repository-inspection-workflow.js";
import { runReviewedCommand } from "../dist/software/reviewed-command.js";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { runBrowserAudit } from "../dist/workflows/browser-audit-workflow.js";

const testUri = process.env.TASKFORGE_TEST_MONGODB_URI;
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function createIsolatedTestUri(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("TASKFORGE_TEST_MONGODB_URI is required for this integration test.");
  }

  let parsedUri;
  try {
    parsedUri = new URL(value);
  } catch {
    throw new Error("The MongoDB integration test URI is invalid.");
  }

  if (
    parsedUri.protocol !== "mongodb:" ||
    parsedUri.hostname !== "127.0.0.1" ||
    !["27017", "27018"].includes(parsedUri.port) ||
    parsedUri.username.length > 0 ||
    parsedUri.password.length > 0
  ) {
    throw new Error("The integration test requires a loopback MongoDB endpoint without credentials.");
  }

  parsedUri.pathname = `/taskforge_test_${randomUUID().replaceAll("-", "")}`;
  return parsedUri.toString();
}

test("unavailable MongoDB produces a generic connection error", async () => {
  await assert.rejects(
    MongoStore.connect({ mongodbUri: "mongodb://127.0.0.1:1/taskforge_test" }),
    (error) => error instanceof DatabaseConnectionError && !error.message.includes("127.0.0.1:1"),
  );
});

test("MongoStore accepts an already normalized provider configuration", async () => {
  const normalizedConfiguration = parseConfiguration({
    mongodbUri: "mongodb://127.0.0.1:1/taskforge_test",
    provider: "groq",
    groqApiKey: "synthetic-test-key",
    groqModel: "openai/gpt-oss-20b",
  });
  await assert.rejects(
    MongoStore.connect(normalizedConfiguration),
    (error) => error instanceof DatabaseConnectionError && !error.message.includes("synthetic-test-key"),
  );
});

test(
  "connects to an isolated MongoDB database and persists a run summary",
  { skip: typeof testUri !== "string" },
  async () => {
    const isolatedUri = createIsolatedTestUri(testUri);
    const configuration = parseConfiguration({ mongodbUri: isolatedUri });
    const store = await MongoStore.connect(configuration);
    const rawClient = new MongoClient(isolatedUri);
    const runId = randomUUID();
    const malformedRunId = randomUUID();
    const repositoryFixturePath = await mkdtemp(join(tmpdir(), "taskforge-repo-db-"));
    const softwareFixturePath = await mkdtemp(join(tmpdir(), "taskforge-software-db-"));

    try {
      await rawClient.connect();
      const readFolderApproval = await store.grantFolderApproval(repositoryFixturePath, "read");
      assert.equal(readFolderApproval.status, "active");
      assert.equal(readFolderApproval.access, "read");
      assert.equal(await store.hasFolderApproval(join(repositoryFixturePath, "src"), "read"), true);
      assert.equal(await store.hasFolderApproval(join(repositoryFixturePath, "..", "outside"), "read"), false);
      assert.equal(await store.hasFolderApproval(repositoryFixturePath, "write"), false);
      await store.grantFolderApproval(repositoryFixturePath, "write");
      for (let index = 0; index < 998; index += 1) {
        await store.grantFolderApproval(join(repositoryFixturePath, `nested-${index}`), "read");
      }
      assert.equal(await store.hasFolderApproval(join(repositoryFixturePath, "nested-997", "child"), "read"), true);
      await store.grantFolderApproval(join(repositoryFixturePath, "one-more-than-one-thousand"), "read");
      assert.equal(await store.hasFolderApproval(join(repositoryFixturePath, "one-more-than-one-thousand", "child"), "read"), true);
      assert.equal((await store.listFolderApprovals(true)).length, 1_001);
      await store.revokeFolderApproval(join(repositoryFixturePath, "nested-0"), "read");
      for (let index = 1; index < 998; index += 1) {
        await store.revokeFolderApproval(join(repositoryFixturePath, `nested-${index}`), "read");
      }
      await store.revokeFolderApproval(join(repositoryFixturePath, "one-more-than-one-thousand"), "read");
      assert.equal((await store.listFolderApprovals()).length, 2);
      assert.equal(await store.revokeFolderApproval(repositoryFixturePath, "read"), true);
      assert.equal(await store.hasFolderApproval(join(repositoryFixturePath, "src"), "read"), false);
      assert.equal(await store.revokeFolderApproval(repositoryFixturePath, "read"), false);
      assert.equal((await store.listFolderApprovals()).length, 1);
      assert.equal((await store.listFolderApprovals(true)).length, 1_001);
      await assert.rejects(store.grantFolderApproval("relative/path", "read"), PersistenceInputError);
      await assert.rejects(store.grantFolderApproval(repositoryFixturePath, "admin"), PersistenceInputError);
      await mkdir(join(repositoryFixturePath, "src"));
      await mkdir(join(repositoryFixturePath, "test"));
      await writeFile(join(repositoryFixturePath, "src", "buggy.ts"), "export const result = 1;", "utf8");
      await writeFile(join(repositoryFixturePath, "test", "buggy.test.ts"), "assert.equal(result, 2);", "utf8");
      const repositoryPolicy = new WorkspacePathPolicy();
      const approvedRepository = await repositoryPolicy.approveRoot(repositoryFixturePath);
      const repositoryInspection = await inspectRepository(store, approvedRepository, repositoryPolicy);
      const persistedRepositoryRun = await store.getRunSummary(repositoryInspection.run.runId);
      const repositoryEvents = await store.getRunEvents(repositoryInspection.run.runId);
      assert.equal(repositoryInspection.inventory.fileCount, 2);
      assert.equal(repositoryInspection.inventory.sourceFileCount, 2);
      assert.equal(repositoryInspection.inventory.testFileCount, 1);
      assert.equal(persistedRepositoryRun?.state, "completed");
      assert.equal(persistedRepositoryRun?.summary.includes(repositoryFixturePath), false);
      assert.equal(repositoryEvents.some((event) => event.type === "run_finished"), true);

      const documentMarker = "private-document-fixture-marker";
      const documentRun = await analyzeDocument(store, ".txt", Buffer.from(documentMarker, "utf8"));
      const persistedDocumentRun = await store.getRunSummary(documentRun.run.runId);
      const documentEvents = await store.getRunEvents(documentRun.run.runId);
      assert.equal(documentRun.analysis.wordCount, 1);
      assert.equal(persistedDocumentRun?.state, "completed");
      assert.equal(persistedDocumentRun?.summary.includes(documentMarker), false);
      assert.equal(documentEvents.some((event) => event.type === "run_finished"), true);
      const documentArtifactInput = {
        artifactId: randomUUID(),
        runId: documentRun.run.runId,
        relativePath: "text-export.txt",
        type: "document-plain-text",
        sha256: createHash("sha256").update(documentMarker).digest("hex"),
        bytes: Buffer.byteLength(documentMarker),
      };
      await store.saveArtifactReference(documentArtifactInput);
      assert.equal((await store.listArtifactReferences(documentRun.run.runId))[0]?.type, "document-plain-text");
      await assert.rejects(store.saveArtifactReference({ ...documentArtifactInput, artifactId: randomUUID(), type: "csv-analysis-json" }), PersistenceInputError);

      const resumableDocumentId = randomUUID();
      const resumableDocumentInput = Buffer.from("resumable approved document fixture", "utf8");
      await store.saveRunSummary({ runId: resumableDocumentId, workflowId: "document-analyze", summary: "Document analysis interrupted safely." });
      await store.updateRunState(resumableDocumentId, "running");
      await store.appendRunEvent({ runId: resumableDocumentId, eventId: randomUUID(), type: "run_started" });
      await store.saveRunCheckpoint({
        runId: resumableDocumentId,
        version: 1,
        inputHash: createHash("sha256").update(resumableDocumentInput).digest("hex"),
        stateHash: createHash("sha256").update("taskforge:document-analyze:v1").digest("hex"),
        completedStepIds: [],
        pendingStepId: "parse",
      });
      await store.updateRunState(resumableDocumentId, "uncertain");
      await assert.rejects(
        resumeDocumentAnalysisWorkflow(store, resumableDocumentId, ".txt", Buffer.from("changed document", "utf8")),
        /checkpoint/,
      );
      const resumedDocument = await resumeDocumentAnalysisWorkflow(store, resumableDocumentId, ".txt", resumableDocumentInput);
      assert.equal(resumedDocument.resumed, true);
      assert.equal(resumedDocument.run.state, "completed");
      assert.equal(resumedDocument.analysis.wordCount, 4);

      const browserMarker = "private-browser-fixture-marker";
      const browserServer = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<html><body><p>${browserMarker}</p></body></html>`);
      });
      await new Promise((resolve, reject) => {
        browserServer.once("error", reject);
        browserServer.listen(0, "127.0.0.1", resolve);
      });
      try {
        const browserAddress = browserServer.address();
        if (browserAddress === null || typeof browserAddress === "string") throw new Error("Browser fixture did not bind a loopback port.");
        const browserRun = await runBrowserAudit(store, `http://127.0.0.1:${browserAddress.port}/`);
        const persistedBrowserRun = await store.getRunSummary(browserRun.run.runId);
        const browserEvents = await store.getRunEvents(browserRun.run.runId);
        assert.equal(persistedBrowserRun?.state, "completed");
        assert.equal(persistedBrowserRun?.summary.includes(browserMarker), false);
        assert.equal(persistedBrowserRun?.summary.includes(String(browserAddress.port)), false);
        assert.equal(browserEvents.some((event) => event.type === "run_finished"), true);
      } finally {
        await new Promise((resolve, reject) => browserServer.close((error) => error === undefined ? resolve() : reject(error)));
      }

      await mkdir(join(softwareFixturePath, "test"));
      const seededTestPath = join(softwareFixturePath, "test", "seeded.test.mjs");
      await writeFile(seededTestPath, "import assert from 'node:assert/strict';\nassert.equal(1, 2);\n", "utf8");
      const softwarePolicy = new WorkspacePathPolicy();
      const approvedSoftwareRoot = await softwarePolicy.approveRoot(softwareFixturePath);
      const reproducedFailure = await runReviewedCommand(store, approvedSoftwareRoot, softwarePolicy, "node-test");
      assert.equal(reproducedFailure.status, "failed");
      assert.equal((await store.getRunSummary(reproducedFailure.run.runId))?.state, "failed");
      await writeFile(seededTestPath, "import assert from 'node:assert/strict';\nassert.equal(1, 1);\n", "utf8");
      const verifiedFix = await runReviewedCommand(store, approvedSoftwareRoot, softwarePolicy, "node-test");
      assert.equal(verifiedFix.status, "passed");
      assert.equal((await store.getRunSummary(verifiedFix.run.runId))?.state, "completed");
      const projectPolicy = new WorkspacePathPolicy();
      const approvedProjectRoot = await projectPolicy.approveRoot(process.cwd());
      const typecheckRun = await runReviewedCommand(store, approvedProjectRoot, projectPolicy, "typescript-check");
      assert.equal(typecheckRun.status, "passed");
      assert.equal((await store.getRunSummary(typecheckRun.run.runId))?.state, "completed");

      const created = await store.saveRunSummary({
        runId,
        workflowId: "phase-1-3-smoke",
        summary: "Disposable persistence integration check with token=fixture-only-value.",
      });
      const loaded = await store.getRunSummary(runId);

      assert.equal(created.runId, runId);
      assert.equal(created.workflowId, "phase-1-3-smoke");
      assert.equal(created.state, "created");
      assert.ok(created.createdAt instanceof Date);
      assert.equal(created.summary.includes("fixture-only-value"), false);
      assert.equal(created.summary.includes("[REDACTED]"), true);
      assert.notEqual(loaded, null);
      assert.equal(loaded?.runId, runId);
      assert.equal(loaded?.summary, "Disposable persistence integration check with token=[REDACTED].");

      const running = await store.updateRunState(runId, "running");
      assert.equal(running.state, "running");
      const firstEventId = randomUUID();
      const firstEvent = await store.appendRunEvent({ runId, eventId: firstEventId, type: "run_started" });
      const duplicateEvent = await store.appendRunEvent({ runId, eventId: firstEventId, type: "run_started" });
      assert.equal(duplicateEvent.sequence, firstEvent.sequence);
      await store.appendRunEvent({
        runId,
        eventId: randomUUID(),
        type: "tool_intent",
        toolName: "read_approved_file",
      });
      await assert.rejects(
        store.appendRunEvent({
          runId,
          eventId: randomUUID(),
          type: "tool_finished",
          message: "password=fixture-only-value",
        }),
        (error) => error instanceof PersistenceInputError && !error.message.includes("fixture-only-value"),
      );
      const events = await store.getRunEvents(runId);
      assert.equal(events.length, 2);
      assert.equal(events.some((event) => "message" in event), false);
      for (let index = 0; index < 298; index += 1) {
        await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished", stepId: `step-${index}` });
      }
      await assert.rejects(
        store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished" }),
        PersistenceInputError,
      );
      assert.equal((await store.getRunEvents(runId)).length, 300);
      const orderedEvents = await store.getRunEvents(runId);
      assert.deepEqual(orderedEvents.map((event) => event.sequence), Array.from({ length: 300 }, (_value, index) => index + 1));

      const checkpoint = await store.saveRunCheckpoint({
        runId,
        version: 1,
        inputHash: "a".repeat(64),
        stateHash: "b".repeat(64),
        completedStepIds: ["inspect", "analyze"],
        pendingStepId: "report",
      });
      assert.deepEqual(checkpoint.completedStepIds, ["inspect", "analyze"]);
      const resumed = await store.loadRunCheckpoint(runId, "a".repeat(64), "b".repeat(64));
      assert.equal(resumed?.pendingStepId, "report");
      await assert.rejects(
        store.loadRunCheckpoint(runId, "c".repeat(64), "b".repeat(64)),
        StaleCheckpointError,
      );
      const completed = await store.updateRunState(runId, "completed");
      assert.equal(completed.state, "completed");
      await assert.rejects(store.updateRunState(runId, "running"), PersistenceInputError);
      await assert.rejects(
        store.loadRunCheckpoint(runId, "a".repeat(64), "b".repeat(64)),
        StaleCheckpointError,
      );
      assert.equal(await store.getRunSummary(randomUUID()), null);

      const csvBytes = Buffer.from("name,count\nalpha,2\nbeta,3\nalpha,2\n", "utf8");
      const csvRun = await runCsvAnalysisWorkflow(store, csvBytes);
      assert.equal(csvRun.run.state, "completed");
      assert.equal(csvRun.analysis.rowCount, 3);
      assert.equal(csvRun.analysis.duplicateRowCount, 1);
      const artifactInput = {
        artifactId: randomUUID(),
        runId: csvRun.run.runId,
        relativePath: "reports/summary.json",
        type: "csv-analysis-json",
        sha256: createHash("sha256").update("aggregate-only").digest("hex"),
        bytes: Buffer.byteLength("aggregate-only"),
      };
      const artifactReference = await store.saveArtifactReference(artifactInput);
      assert.equal(artifactReference.relativePath, "reports/summary.json");
      assert.deepEqual(await store.listArtifactReferences(csvRun.run.runId), [artifactReference]);
      await assert.rejects(store.saveArtifactReference({ ...artifactInput, artifactId: randomUUID(), relativePath: "../secret.csv" }), PersistenceInputError);
      await assert.rejects(store.saveArtifactReference({ ...artifactInput, artifactId: randomUUID(), absolutePath: "C:\\secret.csv" }), PersistenceInputError);
      const storedArtifact = await rawClient.db().collection("artifacts").findOne({ _id: artifactInput.artifactId });
      assert.equal(JSON.stringify(storedArtifact).includes("aggregate-only"), false);
      assert.equal(JSON.stringify(storedArtifact).includes(repositoryFixturePath), false);

      const scheduledRunId = `schedule-test-${randomUUID()}`;
      await store.saveRunSummary({ runId: scheduledRunId, workflowId: "csv-analyze", summary: "Scheduled fixture awaiting approval." });
      await store.updateRunState(scheduledRunId, "awaiting_approval");
      const scheduledCsvRun = await runCsvAnalysisWorkflow(store, csvBytes, scheduledRunId);
      assert.equal(scheduledCsvRun.run.runId, scheduledRunId, "scheduled workflow reuses the canonical occurrence run id");
      assert.equal(scheduledCsvRun.run.state, "completed");
      assert.equal(csvRun.run.summary.includes("alpha"), false);
      assert.equal((await store.getRunEvents(csvRun.run.runId)).some((event) => event.type === "run_finished"), true);

      const pendingRunId = randomUUID();
      const pendingInputHash = createHash("sha256").update(csvBytes).digest("hex");
      const workflowStateHash = createHash("sha256").update("taskforge:csv-analyze:v1").digest("hex");
      await store.saveRunSummary({ runId: pendingRunId, workflowId: "csv-analyze", summary: "Interrupted fixture run." });
      await store.updateRunState(pendingRunId, "running");
      await rawClient.db().collection("runs").updateOne(
        { _id: pendingRunId },
        { $set: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) } },
      );
      await store.saveRunCheckpoint({
        runId: pendingRunId,
        version: 1,
        inputHash: pendingInputHash,
        stateHash: workflowStateHash,
        completedStepIds: [],
        pendingStepId: "analyze",
      });
      await assert.rejects(resumeCsvAnalysisWorkflow(store, pendingRunId, Buffer.from("changed")), StaleCheckpointError);
      const resumedCsvRun = await resumeCsvAnalysisWorkflow(store, pendingRunId, csvBytes);
      assert.equal(resumedCsvRun.resumed, true);
      assert.equal(resumedCsvRun.run.state, "completed");
      assert.equal(resumedCsvRun.analysis.rowCount, 3);

      const history = await store.listRunSummaries();
      assert.equal(history.some((item) => item.runId === csvRun.run.runId), true);
      assert.equal(history.some((item) => item.runId === pendingRunId), true);

      const scheduleStart = new Date("2035-01-01T00:00:00.000Z");
      const scheduleId = randomUUID();
      await store.createSchedule({
        scheduleId,
        workflowId: "csv-analyze",
        inputPath: join(softwareFixturePath, "fixture.csv"),
        nextRunAt: scheduleStart,
        intervalMinutes: 5,
      });
      const firstClaim = await store.claimDueSchedules(scheduleStart, 30_000);
      assert.equal(firstClaim.length, 1);
      assert.equal(firstClaim[0]?.occurrence.status, "awaiting_approval");
      assert.equal((await store.getRunSummary(firstClaim[0].occurrence.runId))?.state, "awaiting_approval", "scheduled work has a canonical pending run record");
      assert.equal((await store.claimPendingScheduleOccurrences("worker-alpha")).length, 1);
      assert.equal((await store.claimPendingScheduleOccurrences("worker-beta")).length, 0, "a pending occurrence is atomically dispatched to one scheduler");
      await assert.rejects(store.setScheduleStatus(scheduleId, "paused"), PersistenceInputError, "claimed work cannot be raced by a pause transition");
      assert.equal((await store.claimDueSchedules(scheduleStart, 30_000)).length, 0, "a due occurrence is atomically claimed once");
      const delayedClaim = await store.claimDueSchedules(new Date("2035-01-01T00:10:00.000Z"), 30_000);
      assert.equal(delayedClaim.length, 1);
      assert.equal(delayedClaim[0]?.occurrence.status, "missed");
      assert.equal(delayedClaim[0]?.occurrence.missedCount, 2);
      assert.equal((await store.listPendingScheduleOccurrences()).length, 1, "missed recurrence does not replace the awaiting approval");
      await store.releaseScheduleOccurrenceClaim(scheduleId, scheduleStart, "worker-alpha");
      await store.setScheduleStatus(scheduleId, "paused");
      assert.equal((await store.listPendingScheduleOccurrences()).length, 0, "paused schedule is not actionable");
      await store.setScheduleStatus(scheduleId, "active");
      await store.finishScheduleOccurrence(scheduleId, scheduleStart, "completed");
      const completedSchedule = (await store.listSchedules()).find((entry) => entry.scheduleId === scheduleId);
      assert.equal(completedSchedule?.occurrences.filter((entry) => entry.status === "missed").length, 1);
      assert.equal(completedSchedule?.occurrences.some((entry) => entry.status === "completed"), true);

      const recoveryScheduleId = randomUUID();
      const recoveryTime = new Date("2035-01-02T00:00:00.000Z");
      await store.createSchedule({
        scheduleId: recoveryScheduleId,
        workflowId: "csv-analyze",
        inputPath: join(softwareFixturePath, "fixture.csv"),
        nextRunAt: recoveryTime,
      });
      await store.claimDueSchedules(recoveryTime, 30_000);
      await store.claimPendingScheduleOccurrences("crashed-runner");
      assert.equal((await store.listSchedules()).find((entry) => entry.scheduleId === recoveryScheduleId)?.dispatchOwner, "crashed-runner");
      assert.equal(await store.recoverScheduleOccurrenceClaim(recoveryScheduleId, recoveryTime), true);
      const recoveredSchedule = (await store.listSchedules()).find((entry) => entry.scheduleId === recoveryScheduleId);
      assert.equal(recoveredSchedule?.dispatchOwner, undefined);
      assert.equal(recoveredSchedule?.pendingOccurrence?.status, "awaiting_approval");
      await store.setScheduleStatus(scheduleId, "deleted");
      assert.equal((await store.listSchedules()).some((entry) => entry.scheduleId === scheduleId), false);
      assert.equal((await store.listSchedules(true)).some((entry) => entry.scheduleId === scheduleId), true);

      const historyEnvironment = {};
      for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
        const value = process.env[key];
        if (typeof value === "string") {
          historyEnvironment[key] = value;
        }
      }
      historyEnvironment.TASKFORGE_MONGODB_URI = isolatedUri;
      const historyCommand = spawnSync(process.execPath, [cliPath, "history", "list"], {
        encoding: "utf8",
        env: historyEnvironment,
        cwd: tmpdir(),
      });
      assert.equal(historyCommand.error, undefined);
      assert.equal(historyCommand.status, 0);
      assert.match(historyCommand.stdout, new RegExp(csvRun.run.runId));
      assert.doesNotMatch(historyCommand.stdout, /alpha/u);

      await rawClient.db().collection("runs").insertOne({
        _id: malformedRunId,
        runId: malformedRunId,
        workflowId: 12,
        summary: "Malformed stored record",
        state: "created",
        createdAt: new Date(),
      });
      await assert.rejects(
        store.getRunSummary(malformedRunId),
        (error) => error instanceof DatabasePersistenceError,
      );
      const doctorEnvironment = {};
      for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
        const value = process.env[key];
        if (typeof value === "string") {
          doctorEnvironment[key] = value;
        }
      }
      doctorEnvironment.TASKFORGE_MONGODB_URI = isolatedUri;
      const doctor = spawnSync(process.execPath, [cliPath, "doctor"], {
        encoding: "utf8",
        env: doctorEnvironment,
        cwd: tmpdir(),
      });
      assert.equal(doctor.error, undefined);
      assert.equal(doctor.status, 0);
      assert.match(doctor.stdout, /MongoDB: available/u);
      assert.match(doctor.stdout, /Model provider: not configured or invalid/u);
      assert.doesNotMatch(doctor.stdout, /mongodb:\/\//u);
    } finally {
      try {
        await store.close();
      } finally {
        try {
          await rawClient.db().dropDatabase();
        } finally {
          try {
            await rawClient.close();
          } finally {
            try {
              await rm(repositoryFixturePath, { recursive: true, force: true });
            } finally {
              await rm(softwareFixturePath, { recursive: true, force: true });
            }
          }
        }
      }
    }
  },
);
