import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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

    try {
      await rawClient.connect();
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
          await rawClient.close();
        }
      }
    }
  },
);
