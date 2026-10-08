import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import test from "node:test";
import {
  DatabaseConnectionError,
  DatabasePersistenceError,
  MongoStore,
} from "../dist/mongo-store.js";
import { parseConfiguration } from "../dist/config.js";

const testUri = process.env.TASKFORGE_TEST_MONGODB_URI;

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
    parsedUri.port !== "27018" ||
    parsedUri.username.length > 0 ||
    parsedUri.password.length > 0
  ) {
    throw new Error("The integration test requires the dedicated loopback MongoDB test endpoint.");
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
        summary: "Disposable persistence integration check.",
      });
      const loaded = await store.getRunSummary(runId);

      assert.equal(created.runId, runId);
      assert.equal(created.workflowId, "phase-1-3-smoke");
      assert.equal(created.state, "created");
      assert.ok(created.createdAt instanceof Date);
      assert.notEqual(loaded, null);
      assert.equal(loaded?.runId, runId);
      assert.equal(loaded?.summary, "Disposable persistence integration check.");
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
    } finally {
      await store.close();
      await rawClient.close();
    }
  },
);
