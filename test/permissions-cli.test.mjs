import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("persistent folder permission changes require an interactive confirmation", () => {
  const result = spawnSync(process.execPath, [cliPath, "permissions", "approve", "--root", tmpdir(), "--access", "read"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive confirmation/u);
  assert.doesNotMatch(result.stdout + result.stderr, /TASKFORGE_MONGODB_URI=.*\S/u);
});

test("file move refuses noninteractive execution before path access", () => {
  const result = spawnSync(process.execPath, [cliPath, "run", "file-move", "--source", "missing.txt", "--target", "moved.txt"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal/u);
});

test("software check refuses a selected test in noninteractive mode before path access", () => {
  const result = spawnSync(process.execPath, [cliPath, "run", "software-check", "--root", "missing-root", "--check", "node-test", "--test", "test/example.test.mjs"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal/u);
  assert.doesNotMatch(result.stderr, /missing-root/u);
});

test("permission list reports database unavailability without exposing a stack trace", () => {
  const result = spawnSync(process.execPath, [cliPath, "permissions", "list"], {
    encoding: "utf8",
    timeout: 8_000,
    windowsHide: true,
    env: { ...process.env, TASKFORGE_MONGODB_URI: "mongodb://127.0.0.1:1/taskforge_test" },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Database unavailable/u);
  assert.doesNotMatch(result.stderr, /\n\s+at\s/u);
  assert.doesNotMatch(result.stdout + result.stderr, /mongodb:\/\/127\.0\.0\.1:1/u);
});

