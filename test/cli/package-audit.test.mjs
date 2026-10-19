import assert from "node:assert/strict";
import test from "node:test";
import { validatePackageInventory } from "../../scripts/package-audit.mjs";

function inventory(files) {
  return [{ id: "taskforge@0.1.0", entryCount: files.length, files: files.map((path) => ({ path })) }];
}

const compiledFiles = ["dist/cli.js", "dist/workflows/csv-analysis-workflow.js"];

test("package audit accepts only the current npm allowlist and CLI entrypoint", () => {
  const result = validatePackageInventory(inventory([
    "package.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "dist/cli.js",
    "dist/workflows/csv-analysis-workflow.js",
  ]), "taskforge", "0.1.0", compiledFiles);
  assert.equal(result.fileCount, 6);
});

test("package audit rejects extra directories, credentials, private data, and unsafe paths", () => {
  for (const prohibitedPath of [
    "private/customer.csv",
    "test/fixture.json",
    "dist/.env.production",
    "dist/api-token.txt",
    "dist/session/private.json",
    "dist/customer-export.csv",
    "dist/session-data.json",
    "dist/unexpected.js",
    "dist/../outside.txt",
    "other-file.txt",
  ]) {
    assert.throws(
      () => validatePackageInventory(inventory(["package.json", ...compiledFiles, prohibitedPath]), "taskforge", "0.1.0", compiledFiles),
      /Package inventory/u,
      prohibitedPath,
    );
  }
});

test("package audit rejects inconsistent package identity, duplicate entries, and missing CLI", () => {
  assert.throws(() => validatePackageInventory(inventory(["package.json", "dist/cli.js"]), "other", "0.1.0", compiledFiles), /metadata/u);
  assert.throws(() => validatePackageInventory(inventory(["package.json", "package.json", ...compiledFiles]), "taskforge", "0.1.0", compiledFiles), /duplicate/u);
  assert.throws(() => validatePackageInventory(inventory(["package.json"]), "taskforge", "0.1.0", compiledFiles), /missing/u);
});
