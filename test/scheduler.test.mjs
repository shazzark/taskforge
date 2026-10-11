import assert from "node:assert/strict";
import test from "node:test";
import { runSchedulerTick } from "../dist/scheduling/scheduler.js";

test("scheduler leaves due work awaiting approval when no user is present", async () => {
  let pending = [];
  const store = {
    async claimDueSchedules(now) {
      const occurrence = { runId: "run-unattended", scheduledFor: now, status: "awaiting_approval", missedCount: 0, recordedAt: now };
      const schedule = { scheduleId: "schedule-1", workflowId: "csv-analyze", inputPath: "C:\\safe\\input.csv" };
      pending = [{ schedule, occurrence }];
      return pending;
    },
    async claimPendingScheduleOccurrences() { return []; },
    async releaseScheduleOccurrenceClaim() {},
    async listPendingScheduleOccurrences() { return pending; },
    async finishScheduleOccurrence() { pending = []; },
    async getRunSummary() { return { state: "awaiting_approval" }; },
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
    occurrence: { runId: "run-approved", scheduledFor: time, status: "awaiting_approval", missedCount: 0, recordedAt: time },
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
    async getRunSummary() { return { state: "awaiting_approval" }; },
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

test("scheduler finalizes an already completed occurrence without asking or executing again", async () => {
  const time = new Date("2035-01-01T00:00:00.000Z");
  let finished = 0;
  let executed = 0;
  const store = {
    async claimDueSchedules() { return []; },
    async claimPendingScheduleOccurrences() {
      return [{
        schedule: { scheduleId: "schedule-recovery", workflowId: "csv-analyze", inputPath: "C:\\safe\\input.csv" },
        occurrence: { runId: "run-completed", scheduledFor: time, status: "awaiting_approval", missedCount: 0, recordedAt: time },
      }];
    },
    async releaseScheduleOccurrenceClaim() {},
    async listPendingScheduleOccurrences() { return []; },
    async finishScheduleOccurrence() { finished += 1; },
    async getRunSummary() { return { state: "completed" }; },
  };
  const result = await runSchedulerTick(store, {
    now: time,
    userPresent: true,
    attemptedOccurrences: new Set(),
    ownerId: "worker-recovery",
    async confirm() { assert.fail("completed run recovery must not request execution approval"); return false; },
    async execute() { executed += 1; return true; },
  });
  assert.equal(result.completed, 1);
  assert.equal(finished, 1);
  assert.equal(executed, 0);
});

test("scheduler recovers a stale linked run only after the stale cutoff and reapproves before resume", async () => {
  const time = new Date("2035-01-01T00:10:00.000Z");
  const occurrence = { runId: "run-stale", scheduledFor: new Date(time.getTime() - 10_000), status: "awaiting_approval", missedCount: 0, recordedAt: time };
  let executed = 0;
  let confirmed = 0;
  let staleBefore;
  const store = {
    async claimDueSchedules() { return []; },
    async claimPendingScheduleOccurrences() { return [{ schedule: { scheduleId: "schedule-stale", workflowId: "csv-analyze", inputPath: "C:\\safe\\input.csv" }, occurrence }]; },
    async releaseScheduleOccurrenceClaim() {},
    async listPendingScheduleOccurrences() { return []; },
    async finishScheduleOccurrence() {},
    async getRunSummary() { return { state: "running" }; },
    async recoverStaleRun(_runId, cutoff) { staleBefore = cutoff; return true; },
  };
  const result = await runSchedulerTick(store, {
    now: time,
    userPresent: true,
    attemptedOccurrences: new Set(),
    ownerId: "worker-stale",
    async confirm() { confirmed += 1; return true; },
    async execute(_schedule, receivedOccurrence) { assert.equal(receivedOccurrence.runId, occurrence.runId); executed += 1; return true; },
  });
  assert.equal(staleBefore.getTime(), time.getTime() - 120_000);
  assert.equal(confirmed, 1);
  assert.equal(executed, 1);
  assert.equal(result.completed, 1);
});

test("scheduler preserves an uncertain run occurrence for later resume", async () => {
  const time = new Date("2035-01-01T00:00:00.000Z");
  const entry = {
    schedule: { scheduleId: "schedule-uncertain", workflowId: "csv-analyze", inputPath: "C:\\safe\\input.csv" },
    occurrence: { runId: "run-uncertain", scheduledFor: time, status: "awaiting_approval", missedCount: 0, recordedAt: time },
  };
  let runReads = 0;
  let released = 0;
  let finished = 0;
  const store = {
    async claimDueSchedules() { return []; },
    async claimPendingScheduleOccurrences() { return [entry]; },
    async releaseScheduleOccurrenceClaim() { released += 1; },
    async listPendingScheduleOccurrences() { return [entry]; },
    async finishScheduleOccurrence() { finished += 1; },
    async getRunSummary() { runReads += 1; return { state: runReads === 1 ? "awaiting_approval" : "uncertain" }; },
  };
  const result = await runSchedulerTick(store, {
    now: time,
    userPresent: true,
    attemptedOccurrences: new Set(),
    ownerId: "worker-uncertain",
    async confirm() { return true; },
    async execute() { throw new Error("resume checkpoint is not ready"); },
  });
  assert.equal(released, 1);
  assert.equal(finished, 0);
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 0);
});
