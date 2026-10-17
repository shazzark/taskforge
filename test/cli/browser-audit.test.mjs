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
    env: { ...process.env, TASKFORGE_STORAGE: "local", LOCALAPPDATA: join(tmpdir(), "taskforge-browser-cli-test") },
  });
}

test("browser audit validates target mode, then requires consent before starting the browser", () => {
  const fixture = run("run", "browser-audit", "--url", "http://127.0.0.1:4173");
  assert.equal(fixture.error, undefined);
  assert.equal(fixture.status, 2);
  assert.match(fixture.stderr, /interactive approval/u);

  const manualLogin = run("run", "browser-audit", "--url", "https://example.com", "--journey", '[{"type":"expect-text","text":"Sign in"}]', "--manual-login");
  assert.equal(manualLogin.error, undefined);
  assert.equal(manualLogin.status, 2);
  assert.match(manualLogin.stderr, /interactive approval/u);
  assert.doesNotMatch(manualLogin.stdout, /Run [a-f0-9-]+/u);
});
