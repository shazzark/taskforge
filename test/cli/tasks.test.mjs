import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function runWithDataRoot(dataRoot, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    env: { ...process.env, TASKFORGE_STORAGE: "local", LOCALAPPDATA: dataRoot },
  });
}

const cliDataRoot = join(tmpdir(), "taskforge-task-registry-cli-test");
function run(...args) {
  return runWithDataRoot(cliDataRoot, ...args);
}

test("tasks list and inspect expose only the built-in validated task catalog", () => {
  const listed = run("tasks", "list");
  assert.equal(listed.error, undefined);
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /csv-summary/u);
  assert.match(listed.stdout, /repository-inventory/u);
  assert.match(listed.stdout, /web-research/u);
  assert.match(listed.stdout, /cannot execute tasks or grant permissions/u);

  const inspected = run("tasks", "inspect", "csv-summary");
  assert.equal(inspected.status, 0);
  assert.match(inspected.stdout, /Inputs:/u);
  assert.match(inspected.stdout, /Outputs:/u);
  assert.match(inspected.stdout, /\u2014/u);
  assert.match(inspected.stdout, /csv\.analyze/u);
});

test("tasks validate reports field names without echoing input values and rejects invalid input", () => {
  const accepted = run("tasks", "validate", "csv-summary", "--inputs-json", '{"input":"synthetic-private-name.csv","numericColumn":"amount"}');
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /input, numericColumn/u);
  assert.doesNotMatch(accepted.stdout, /synthetic-private-name/u);

  const rejected = run("tasks", "validate", "csv-summary", "--inputs-json", "{}");
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /Required task input is missing/u);

  const unknown = run("tasks", "inspect", "not-a-task");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown task id/u);
});

test("tasks commands load a valid local definition without opening selected application storage", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "taskforge-task-registry-cli-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const definitionsDirectory = join(dataRoot, "TaskForge", "task-definitions");
  await mkdir(definitionsDirectory, { recursive: true });
  const definition = {
    id: "local-cli-task",
    version: 1,
    name: "Local CLI task",
    description: "A locally loaded validation fixture.",
    instructions: "Validate the declared input and report its field name only.",
    inputs: [{ name: "query", type: "string", required: true, description: "Synthetic input." }],
    outputs: [{ name: "summary", type: "text", description: "A bounded summary." }],
    requiredTools: ["web.search"],
    examples: [{ prompt: "Validate a synthetic query.", inputs: { query: "synthetic question" }, expectedResult: "A bounded summary." }],
    tests: [{ name: "requires a query", inputs: { query: "synthetic question" }, expectedOutputNames: ["summary"] }],
  };
  await writeFile(join(definitionsDirectory, "local-cli-task.json"), JSON.stringify(definition), "utf8");
  await writeFile(join(definitionsDirectory, "unsafe-display.json"), JSON.stringify({
    ...definition,
    id: "unsafe-display",
    name: "\u001b[31mUnsafe name\u001b[0m\u202e",
  }), "utf8");

  const list = runWithDataRoot(dataRoot, "tasks", "list");
  assert.equal(list.status, 0);
  assert.match(list.stdout, /local-cli-task\tLocal CLI task\tlocal/u);
  assert.match(list.stdout, /\\u001b\[31mUnsafe name\\u001b\[0m\\u\{202e\}/u);
  assert.doesNotMatch(list.stdout, /\u001b/u);
  const inspect = runWithDataRoot(dataRoot, "tasks", "inspect", "local-cli-task");
  assert.equal(inspect.status, 0);
  assert.match(inspect.stdout, /Local CLI task/u);
  const validated = runWithDataRoot(dataRoot, "tasks", "validate", "local-cli-task", "--inputs-json", '{"query":"private fixture value"}');
  assert.equal(validated.status, 0);
  assert.match(validated.stdout, /Inputs accepted for local-cli-task: query/u);
  assert.doesNotMatch(validated.stdout, /private fixture value/u);
  const inspectUnsafe = runWithDataRoot(dataRoot, "tasks", "inspect", "unsafe-display");
  assert.equal(inspectUnsafe.status, 0);
  assert.doesNotMatch(inspectUnsafe.stdout, /\u001b/u);
});

test("task definition validation/install reads require an interactive exact-file approval", () => {
  const result = run("tasks", "install", "--file", "missing-definition.json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal/u);
  assert.doesNotMatch(result.stdout + result.stderr, /missing-definition\.json/u);
});
