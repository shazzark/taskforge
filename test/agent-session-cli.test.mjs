import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("help describes the natural-language boundary and enabled tool", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--help"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /do <instruction>/u);
  assert.match(result.stdout, /CSV and supported-document analysis require explicit file/u);
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

test("agent-fix help exposes exact target and verification inputs", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--help"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /run agent-fix --root <directory> --target <relative-source> --goal <instruction> --test <relative-test\.mjs>/u);
  assert.match(result.stdout, /full-file candidate.*separate exact approval/u);
});

test("agent-fix refuses noninteractive use before reading a project or starting a provider", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "run", "agent-fix", "--root", ".", "--target", "src/example.ts", "--goal", "fix it", "--test", "test/example.test.mjs"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    env: { ...process.env, TASKFORGE_PROVIDER: "invalid-provider", TASKFORGE_GROQ_API_KEY: "synthetic-not-a-secret" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal/u);
  assert.doesNotMatch(result.stderr, /synthetic-not-a-secret|invalid-provider/u);
});
