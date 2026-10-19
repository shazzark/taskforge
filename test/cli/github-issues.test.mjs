import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", timeout: 15_000, windowsHide: true });
}

test("GitHub issue command validates arguments before checking terminal availability", () => {
  const malformed = run("run", "github-issues", "--repository", "invalid/repository", "--extra");
  assert.equal(malformed.error, undefined);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Expected --repository <owner\/name>/u);
  assert.doesNotMatch(malformed.stderr, /invalid\/repository/u);

  const nonInteractive = run("run", "github-issues", "--repository", "owner/repo");
  assert.equal(nonInteractive.error, undefined);
  assert.equal(nonInteractive.status, 2);
  assert.match(nonInteractive.stderr, /requires an interactive confirmation/u);
  assert.doesNotMatch(nonInteractive.stdout, /Read up to 20 open issue titles/u);
});
