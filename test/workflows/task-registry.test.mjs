import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_TASKS,
  TaskRegistryError,
  getBuiltInTask,
  resolveTaskTools,
  validateTaskDefinition,
  validateTaskInputs,
} from "../../dist/workflows/task-registry.js";

test("built-in task definitions declare validated inputs, outputs, required tools, examples, and conformance cases", () => {
  assert.deepEqual(BUILT_IN_TASKS.map((task) => task.id), ["csv-summary", "repository-inventory", "web-research"]);
  for (const task of BUILT_IN_TASKS) {
    assert.ok(task.instructions.length > 0);
    assert.ok(task.inputs.length > 0);
    assert.ok(task.outputs.length > 0);
    assert.ok(task.examples.length > 0);
    assert.ok(task.tests.length > 0);
  }
});

test("task input validator accepts declared fields and rejects missing, extra, and mistyped values", () => {
  const task = getBuiltInTask("csv-summary");
  assert.ok(task);
  assert.deepEqual(validateTaskInputs(task.inputs, { input: "fixtures/sample.csv", numericColumn: "amount" }).fieldNames, ["input", "numericColumn"]);
  assert.deepEqual(validateTaskInputs(task.inputs, { input: "fixtures/sample.csv" }).fieldNames, ["input"]);
  assert.throws(() => validateTaskInputs(task.inputs, {}), TaskRegistryError);
  assert.throws(() => validateTaskInputs(task.inputs, { input: " " }), TaskRegistryError);
  assert.throws(() => validateTaskInputs(task.inputs, { input: "fixtures/sample.csv", arbitrary: "value" }), TaskRegistryError);
  assert.throws(() => validateTaskInputs(task.inputs, null), TaskRegistryError);
});

test("definition validation rejects permission fields, executable code, unknown tools, and invalid conformance inputs", () => {
  const definition = {
    id: "safe-task",
    version: 1,
    name: "Safe task",
    description: "A declarative task.",
    instructions: "Use only the declared task data.",
    inputs: [{ name: "query", type: "string", required: true, description: "A bounded query." }],
    outputs: [{ name: "answer", type: "text", description: "A short answer." }],
    requiredTools: ["web.search"],
    examples: [{ prompt: "Find a fact.", inputs: { query: "synthetic" }, expectedResult: "A cited answer." }],
    tests: [{ name: "query is required", inputs: { query: "synthetic" }, expectedOutputNames: ["answer"] }],
  };
  assert.equal(validateTaskDefinition(definition).id, "safe-task");
  assert.throws(() => validateTaskDefinition({ ...definition, permissions: ["write"] }), /unsupported fields/u);
  assert.throws(() => validateTaskDefinition({ ...definition, executable: "process.exit(1)" }), /unsupported fields/u);
  assert.throws(() => validateTaskDefinition({ ...definition, requiredTools: ["shell.exec"] }), /unknown tool/u);
  assert.throws(() => validateTaskDefinition({ ...definition, tests: [{ name: "bad", inputs: {}, expectedOutputNames: ["answer"] }] }), /Required task input/u);
});

test("definition tool requirements are intersected with available tools and explicit approvals", () => {
  const task = getBuiltInTask("web-research");
  assert.ok(task);
  assert.deepEqual(resolveTaskTools(task, ["web.search"], ["web.search"]), ["web.search"]);
  assert.deepEqual(resolveTaskTools(task, ["web.search"], []), []);
  assert.deepEqual(resolveTaskTools(task, [], ["web.search"]), []);
});
