import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("help describes the natural-language boundary and enabled tool", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--help"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /do <instruction>/u);
  assert.match(result.stdout, /CSV analysis is the only currently enabled tool/u);
});

test("natural-language execution refuses noninteractive use before provider setup", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "do", "analyze", "a", "CSV"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    env: { ...process.env, TASKFORGE_PROVIDER: "invalid-provider", TASKFORGE_GROQ_API_KEY: "synthetic-not-a-secret" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal/u);
  assert.doesNotMatch(result.stderr, /synthetic-not-a-secret|invalid-provider/u);
});
