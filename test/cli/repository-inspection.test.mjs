import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    env: {
      ...process.env,
      TASKFORGE_STORAGE: "local",
      LOCALAPPDATA: join(tmpdir(), "taskforge-cli-inspection-test"),
    },
  });
}

test("read-only repository inspection commands preserve argument and interactive-terminal gates", () => {
  const inventory = run("run", "repo-inspect", "--root", ".");
  assert.equal(inventory.error, undefined);
  assert.equal(inventory.status, 2);
  assert.match(inventory.stderr, /requires an interactive terminal/u);

  const sourceReview = run("run", "source-review", "--root", ".", "--file", "src/cli.ts");
  assert.equal(sourceReview.error, undefined);
  assert.equal(sourceReview.status, 2);
  assert.match(sourceReview.stderr, /requires an interactive terminal/u);

  const architectureReport = run("run", "architecture-report", "--root", ".", "--file", "src/cli.ts");
  assert.equal(architectureReport.error, undefined);
  assert.equal(architectureReport.status, 2);
  assert.match(architectureReport.stderr, /require interactive/u);

  const invalidArchitectureReport = run("run", "architecture-report", "--root", ".");
  assert.equal(invalidArchitectureReport.error, undefined);
  assert.equal(invalidArchitectureReport.status, 1);
  assert.match(invalidArchitectureReport.stderr, /Expected --root/u);
});
