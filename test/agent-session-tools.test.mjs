import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudgetLedger, AgentToolError, runToolLoop } from "../dist/agent/tool-loop.js";
import { createCsvAnalysisTool, TASKFORGE_AGENT_SYSTEM_MESSAGE } from "../dist/agent/session-tools.js";

test("CSV agent tool has a fixed schema and rejects malformed or extra arguments", () => {
  const tool = createCsvAnalysisTool(async () => "not reached");
  assert.equal(tool.definition.name, "analyze_csv");
  assert.equal(tool.definition.parameters.additionalProperties, false);
  assert.deepEqual(tool.validateArguments({ input: "fixtures/sales.csv", numericColumns: ["amount"] }), {
    input: "fixtures/sales.csv",
    numericColumns: ["amount"],
  });
  assert.deepEqual(tool.validateArguments({ input: "fixtures/sales.csv" }), {
    input: "fixtures/sales.csv",
    numericColumns: [],
  });
  for (const value of [
    { input: "fixtures/sales.csv", permissions: ["read"] },
    { input: "fixtures/sales.csv", numericColumns: ["amount", "amount"] },
    { input: "fixtures/sales.csv", numericColumns: [4] },
    { input: " " },
    { input: "x".repeat(2_049) },
  ]) assert.throws(() => tool.validateArguments(value), AgentToolError);
});

test("one-shot agent uses only its host-supplied CSV tool and returns its real result", async () => {
  let requestCount = 0;
  let observedToolResult = "";
  let executed = 0;
  const provider = {
    async complete(request) {
      requestCount += 1;
      assert.match(request.messages[0].content, /model tool call is not user approval/u);
      assert.deepEqual(request.tools.map((item) => item.name), ["analyze_csv"]);
      if (requestCount === 1) {
        return { content: null, toolCalls: [{ id: "csv-1", name: "analyze_csv", arguments: { input: "fixtures/sales.csv", numericColumns: ["amount"] } }], finishReason: "tool_calls" };
      }
      observedToolResult = request.messages.find((message) => message.role === "tool")?.content ?? "";
      return { content: "The approved fixture has three rows.", toolCalls: [], finishReason: "stop" };
    },
  };
  const tool = createCsvAnalysisTool(async (argumentsValue) => {
    executed += 1;
    assert.deepEqual(argumentsValue, { input: "fixtures/sales.csv", numericColumns: ["amount"] });
    return "CSV analysis complete: 3 rows; 0 duplicate rows; 0 missing cells. Numeric totals: amount=18.";
  });
  const budget = new AgentBudgetLedger(3, 1);
  const result = await runToolLoop(provider, "mock", [
    { role: "system", content: TASKFORGE_AGENT_SYSTEM_MESSAGE },
    { role: "user", content: "Analyze fixtures/sales.csv and total amount." },
  ], [tool], { maxModelRequests: 3, maxToolActions: 1, budget });
  assert.equal(result.content, "The approved fixture has three rows.");
  assert.match(observedToolResult, /amount=18/u);
  assert.equal(requestCount, 2);
  assert.equal(executed, 1);
  assert.deepEqual(budget.snapshot(), { modelRequests: 2, toolActions: 1, modelRequestsRemaining: 1, toolActionsRemaining: 0 });
});

test("agent cannot execute an unprovided tool or run after shared tool budget is exhausted", async () => {
  let executed = 0;
  const tool = createCsvAnalysisTool(async () => { executed += 1; return "unexpected"; });
  const provider = {
    async complete() {
      return { content: null, toolCalls: [{ id: "bad", name: "delete_file", arguments: {} }], finishReason: "tool_calls" };
    },
  };
  await assert.rejects(runToolLoop(provider, "mock", [], [tool], { maxModelRequests: 1, maxToolActions: 1 }), AgentToolError);
  assert.equal(executed, 0);
});
