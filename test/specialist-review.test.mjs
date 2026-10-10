import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudgetError, AgentBudgetLedger, runToolLoop } from "../dist/agent/tool-loop.js";
import { runSpecialistReview, SpecialistReviewError } from "../dist/agent/specialist-review.js";

const tasks = [
  { role: "repository-investigator", goal: "Find correctness risks." },
  { role: "reviewer", goal: "Check boundaries independently." },
];

test("specialists share the parent run request and action ledger and have no tools", async () => {
  const ledger = new AgentBudgetLedger(5, 1);
  const parentTool = {
    definition: { name: "fixture", description: "fixture", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
    validateArguments: (value) => value,
    execute: async () => "read-only result",
  };
  let parentRequests = 0;
  const parentProvider = {
    complete: async () => {
      parentRequests += 1;
      return parentRequests === 1
        ? { content: null, toolCalls: [{ id: "parent-1", name: "fixture", arguments: {} }], finishReason: "tool_calls" }
        : { content: "parent", toolCalls: [], finishReason: "stop" };
    },
  };
  await runToolLoop(parentProvider, "fixture", [{ role: "user", content: "start" }], [parentTool], {
    maxModelRequests: 2,
    maxToolActions: 1,
    budget: ledger,
  });
  const workerRequests = [];
  const provider = {
    complete: async (request) => {
      workerRequests.push(request);
      const content = request.messages[0].content.includes("parent reviewer") ? "Reviewed findings." : "Evidence-based finding.";
      return { content, toolCalls: [], finishReason: "stop" };
    },
  };
  const result = await runSpecialistReview(provider, "fixture", "Review the parser", "const value = 1;", tasks, ledger);
  assert.equal(workerRequests.length, 3);
  assert.ok(workerRequests.every((request) => request.tools.length === 0));
  assert.deepEqual(result.workers.map((worker) => worker.status), ["complete", "complete"]);
  assert.equal(result.parentReview, "Reviewed findings.");
  assert.equal(result.parentReviewStatus, "complete");
  assert.deepEqual(result.budget, { modelRequests: 5, toolActions: 1, modelRequestsRemaining: 0, toolActionsRemaining: 0 });
});

test("worker tool calls are denied and do not execute; excess delegation is rejected", async () => {
  let called = 0;
  const maliciousProvider = {
    complete: async () => ({
      content: null,
      toolCalls: [{ id: "1", name: "write-file", arguments: {} }],
      finishReason: "tool_calls",
    }),
  };
  const failed = await runSpecialistReview(maliciousProvider, "fixture", "Review", "source", [tasks[0]], new AgentBudgetLedger(2, 0));
  assert.equal(failed.workers[0].status, "failed");
  assert.equal(failed.parentReview, null);
  assert.equal(failed.parentReviewStatus, "not-run");
  assert.equal(called, 0);
  await assert.rejects(runSpecialistReview(
    maliciousProvider,
    "fixture",
    "Review",
    "source",
    [...tasks, { role: "data-analyst", goal: "Extra worker." }],
    new AgentBudgetLedger(5, 0),
  ), SpecialistReviewError);
  await assert.rejects(runSpecialistReview(maliciousProvider, "fixture", "Review", "source", [{ role: "reviewer", goal: "nested", spawn: true }], new AgentBudgetLedger()), SpecialistReviewError);
});

test("specialists cannot exceed remaining shared request budget", async () => {
  const ledger = new AgentBudgetLedger(1, 0);
  const provider = { complete: async () => ({ content: "finding", toolCalls: [], finishReason: "stop" }) };
  const results = await runSpecialistReview(provider, "fixture", "Review", "source", tasks, ledger);
  assert.equal(results.workers.filter((worker) => worker.status === "complete").length, 1);
  assert.equal(results.workers.filter((worker) => worker.status === "budget-exhausted").length, 1);
  assert.equal(results.parentReview, null);
  assert.equal(results.parentReviewStatus, "budget-exhausted");
  assert.equal(results.budget.modelRequests, 1);
});

test("provider failures are preserved as sanitized status and parent-review failure is visible", async () => {
  let requestCount = 0;
  const provider = {
    complete: async () => {
      requestCount += 1;
      if (requestCount === 1) return { content: "worker finding", toolCalls: [], finishReason: "stop" };
      if (requestCount === 2) return { content: "second finding", toolCalls: [], finishReason: "stop" };
      throw new Error("fixture transport details must not be surfaced");
    },
  };
  const result = await runSpecialistReview(provider, "fixture", "Review", "source", tasks, new AgentBudgetLedger(3, 0));
  assert.equal(result.workers.every((worker) => worker.status === "complete"), true);
  assert.equal(result.parentReview, null);
  assert.equal(result.parentReviewStatus, "failed");
  assert.equal(result.parentFailureKind, "unavailable");
  assert.equal(JSON.stringify(result).includes("fixture transport details"), false);
});

test("a wholly failed specialist review reports failure without leaking provider error text", async () => {
  const provider = { complete: async () => { throw new Error("secret-like provider detail"); } };
  const result = await runSpecialistReview(provider, "fixture", "Review", "source", tasks, new AgentBudgetLedger(3, 0));
  assert.equal(result.workers.every((worker) => worker.status === "failed" && worker.failureKind === "unavailable"), true);
  assert.equal(result.parentReviewStatus, "not-run");
  assert.equal(JSON.stringify(result).includes("secret-like provider detail"), false);
});

test("shared tool-action ledger prevents a worker-adjacent parent action from exceeding budget", async () => {
  const ledger = new AgentBudgetLedger(1, 0);
  const tool = {
    definition: { name: "fixture", description: "fixture", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
    validateArguments: (value) => value,
    execute: async () => "should not run",
  };
  const provider = { complete: async () => ({ content: null, toolCalls: [{ id: "1", name: "fixture", arguments: {} }], finishReason: "tool_calls" }) };
  await assert.rejects(runToolLoop(provider, "fixture", [{ role: "user", content: "start" }], [tool], {
    maxModelRequests: 1,
    maxToolActions: 1,
    budget: ledger,
  }), AgentBudgetError);
  assert.equal(ledger.snapshot().toolActions, 0);
});
