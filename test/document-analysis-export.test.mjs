import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { DocumentAnalysisExportError, documentAnalysisExportFormat, renderDocumentAnalysisExport } from "../dist/artifacts/document-analysis-export.js";

const analysis = { format: "xlsx", byteCount: 2048, characterCount: 0, wordCount: 0, lineCount: 0, headingCount: 0, sheetCount: 2, rowCount: 7, cellCount: 19 };

test("document aggregate exports include only validated counts in JSON, CSV, and Markdown", () => {
  const outputs = ["json", "csv", "markdown"].map((format) => renderDocumentAnalysisExport(analysis, format));
  assert.match(outputs[0], /"workflow": "document-analyze"/u);
  assert.match(outputs[0], /"cellCount": 19/u);
  assert.match(outputs[1], /sheetCount,2/u);
  assert.match(outputs[2], /\| row count \| 7 \|/u);
  for (const output of outputs) {
    assert.doesNotMatch(output, /private-synthetic-marker|Private Sheet Name|Private Header|C:\\\\Users/u);
  }
});

test("document aggregate export rejects invalid suffixes and malformed metric values", () => {
  assert.equal(documentAnalysisExportFormat("counts.JSON"), "json");
  assert.equal(documentAnalysisExportFormat("counts.csv"), "csv");
  assert.equal(documentAnalysisExportFormat("counts.md"), "markdown");
  assert.throws(() => documentAnalysisExportFormat("counts.txt"), DocumentAnalysisExportError);
  assert.throws(() => renderDocumentAnalysisExport({ ...analysis, cellCount: -1 }, "json"), DocumentAnalysisExportError);
  assert.throws(() => renderDocumentAnalysisExport({ ...analysis, rowCount: 1.5 }, "csv"), DocumentAnalysisExportError);
});

test("CLI rejects unsupported document export suffixes before requesting input access", () => {
  const result = spawnSync(process.execPath, [resolve("dist/cli.js"), "run", "document-analyze", "--input", "source.txt", "--output", "report.txt"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /export format/u);
  assert.doesNotMatch(result.stderr, /interactive terminal|read approval/u);
});
