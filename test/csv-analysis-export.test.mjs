import assert from "node:assert/strict";
import test from "node:test";
import { CsvAnalysisExportError, csvAnalysisExportFormat, renderCsvAnalysisExport } from "../dist/artifacts/csv-analysis-export.js";
import { analyzeCsv } from "../dist/data/csv-analysis.js";

test("CSV analysis exports JSON, CSV, and Markdown aggregate counts without source data", () => {
  const analysis = analyzeCsv("private_name,private_value\nAlice,secret\nAlice,secret\nBob,\n", { numericColumns: [] });
  const formats = ["json", "csv", "markdown"];
  const outputs = formats.map((format) => renderCsvAnalysisExport(analysis, format));
  for (const output of outputs) {
    assert.match(output, /3|rows/u);
    assert.doesNotMatch(output, /private_name|private_value|Alice|secret|Bob/u);
  }
  assert.match(outputs[0] ?? "", /"duplicateRows": 1/u);
  assert.match(outputs[0] ?? "", /"missingCells": 1/u);
  assert.match(outputs[1] ?? "", /duplicate_rows,1/u);
  assert.match(outputs[2] ?? "", /\| Missing cells \| 1 \|/u);
});

test("CSV aggregate export accepts only supported suffixes and valid metrics", () => {
  assert.equal(csvAnalysisExportFormat("report.JSON"), "json");
  assert.equal(csvAnalysisExportFormat("report.csv"), "csv");
  assert.equal(csvAnalysisExportFormat("report.md"), "markdown");
  assert.throws(() => csvAnalysisExportFormat("report.txt"), CsvAnalysisExportError);
  const analysis = analyzeCsv("name\nvalue\n", { numericColumns: [] });
  assert.throws(() => renderCsvAnalysisExport({ ...analysis, rowCount: -1 }, "json"), CsvAnalysisExportError);
});
