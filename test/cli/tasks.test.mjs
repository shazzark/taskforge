import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", timeout: 5_000, windowsHide: true });
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
  assert.match(unknown.stderr, /Unknown built-in task id/u);
});
