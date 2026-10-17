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
    env: { ...process.env, TASKFORGE_STORAGE: "local", LOCALAPPDATA: join(tmpdir(), "taskforge-artifact-cli-test") },
  });
}

test("artifact commands preserve interactive read and create-only approval gates", () => {
  const pdf = run("run", "pdf-report", "--input", "missing.json", "--output", "report.pdf");
  assert.equal(pdf.error, undefined);
  assert.equal(pdf.status, 2);
  assert.match(pdf.stderr, /interactive terminal for explicit read approval/u);

  const draft = run("run", "draft", "--input", "missing.json", "--output", "draft.md");
  assert.equal(draft.error, undefined);
  assert.equal(draft.status, 2);
  assert.match(draft.stderr, /interactive terminal for input and create-only output approval/u);
  assert.doesNotMatch(draft.stdout, /created/u);
});
