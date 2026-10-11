import assert from "node:assert/strict";
import test from "node:test";
import { runSchedulerTick } from "../dist/scheduling/scheduler.js";

test("scheduler leaves due work awaiting approval when no user is present", async () => {
  let pending = [];
  const store = {
    async claimDueSchedules(now) {
      const occurrence = { scheduledFor: now, status: "awaiting_approval", missedCount: 0, recordedAt: now };
      const schedule = { scheduleId: "schedule-1", workflowId: "csv-analyze", inputPath: "C:\\safe\\input.csv" };
      pending = [{ schedule, occurrence }];
      return pending;
    },
    async claimPendingScheduleOccurrences() { return []; },
    async releaseScheduleOccurrenceClaim() {},
    async listPendingScheduleOccurrences() { return pending; },
    async finishScheduleOccurrence() { pending = []; },
  };
  let confirmations = 0;
  let executions = 0;
  const result = await runSchedulerTick(store, {
    now: new Date("2035-01-01T00:00:00.000Z"),
    userPresent: false,
    attemptedOccurrences: new Set(),
    ownerId: "worker-no-user",
    async confirm() { confirmations += 1; return true; },
    async execute() { executions += 1; return true; },
  });
  assert.equal(result.claimed, 1);
  assert.equal(result.pending, 1);
  assert.equal(confirmations, 0);
  assert.equal(executions, 0);
});

test("scheduler renews approval and executes a pending occurrence once", async () => {
  const time = new Date("2035-01-01T00:00:00.000Z");
  const entry = {
    schedule: { scheduleId: "schedule-2", workflowId: "document-analyze", inputPath: "C:\\safe\\input.docx" },
    occurrence: { scheduledFor: time, status: "awaiting_approval", missedCount: 0, recordedAt: time },
  };
  let pending = [entry];
  let finished = 0;
  let executed = 0;
  const store = {
    async claimDueSchedules() { return []; },
    async claimPendingScheduleOccurrences() { return pending; },
    async releaseScheduleOccurrenceClaim() {},
    async listPendingScheduleOccurrences() { return pending; },
    async finishScheduleOccurrence() { finished += 1; pending = []; },
  };
  const result = await runSchedulerTick(store, {
    now: time,
    userPresent: true,
    attemptedOccurrences: new Set(),
    ownerId: "worker-present",
    async confirm() { return true; },
    async execute() { executed += 1; return true; },
  });
  assert.equal(result.completed, 1);
  assert.equal(result.pending, 0);
  assert.equal(executed, 1);
  assert.equal(finished, 1);
});
