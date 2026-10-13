import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("CSV export rejects unsupported output formats before reading input", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "run", "csv-analyze", "--input", "missing.csv", "--output", "report.txt"], {
    encoding: "utf8",
    env: { ...process.env, TASKFORGE_MONGODB_URI: undefined },
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CSV analysis export format/u);
  assert.doesNotMatch(result.stderr, /missing\.csv|TASKFORGE_MONGODB_URI/u);
});

test("CSV workflow accepts an explicit numeric-column option before requesting input approval", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "run", "csv-analyze", "--input", "missing.csv", "--numeric-column", "amount"], {
    encoding: "utf8",
    env: { ...process.env, TASKFORGE_MONGODB_URI: undefined },
    timeout: 10_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal for explicit read approval/u);
  assert.doesNotMatch(result.stderr, /Expected --input/u);
});

test("CSV export does not proceed without interactive exact-file approval", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "run", "csv-analyze", "--input", "missing.csv", "--output", "report.json"], {
    encoding: "utf8",
    env: { ...process.env, TASKFORGE_MONGODB_URI: undefined },
    timeout: 10_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal for explicit read approval/u);
  assert.doesNotMatch(result.stdout, /Aggregate report created/u);
});

test("document conversion does not read a file without interactive approval", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "run", "document-convert", "--input", "missing.docx", "--output", "report.txt"], {
    encoding: "utf8",
    env: { ...process.env, TASKFORGE_MONGODB_URI: undefined },
    timeout: 10_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive terminal for explicit read approval/u);
  assert.doesNotMatch(result.stdout, /export created/u);
});
