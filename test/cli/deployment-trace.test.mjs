import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function run(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    ...options,
  });
}

test("deployment trace validates scope before terminal and configuration checks", () => {
  const malformed = run(["run", "deployment-trace", "--repository", "owner/repo", "--project-id"]);
  assert.equal(malformed.error, undefined);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Expected --repository <owner\/name> --project-id <prj_id>/u);

  const token = "synthetic-vercel-token-not-for-use";
  const nonInteractive = run(
    ["run", "deployment-trace", "--repository", "owner/repo", "--project-id", "prj_synthetic"],
    { env: { ...process.env, TASKFORGE_VERCEL_TOKEN: token } },
  );
  assert.equal(nonInteractive.error, undefined);
  assert.equal(nonInteractive.status, 2);
  assert.match(nonInteractive.stderr, /requires interactive approval/u);
  assert.doesNotMatch(`${nonInteractive.stdout}\n${nonInteractive.stderr}`, new RegExp(token, "u"));
  assert.doesNotMatch(nonInteractive.stderr, /TASKFORGE_VERCEL_TOKEN/u);
});
