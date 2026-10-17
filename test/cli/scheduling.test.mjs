import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const localAppData = join(tmpdir(), `taskforge-scheduling-cli-${process.pid}`);

function run(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    env: { ...process.env, TASKFORGE_STORAGE: "local", LOCALAPPDATA: localAppData },
  });
}

test("schedule CLI validates definitions before refusing unattended creation", () => {
  const invalid = run("schedule", "add", "--workflow", "csv-analyze", "--input", "input.csv", "--every-minutes", "0");
  assert.equal(invalid.error, undefined);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Expected schedule add/u);

  const valid = run("schedule", "add", "--workflow", "csv-analyze", "--input", "input.csv", "--once", new Date(Date.now() + 86_400_000).toISOString());
  assert.equal(valid.error, undefined);
  assert.equal(valid.status, 2);
  assert.match(valid.stderr, /requires an interactive terminal/u);
});
