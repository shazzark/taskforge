import assert from "node:assert/strict";
import test from "node:test";
import { CsvAnalysisExportError, csvAnalysisExportFormat, renderCsvAnalysisExport } from "../dist/artifacts/csv-analysis-export.js";
import { analyzeCsv } from "../dist/tools/data/csv-analysis.js";

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

test("selected exact numeric totals are included only when requested and CSV labels are formula guarded", () => {
  const analysis = analyzeCsv("=SUM(A1:A2),amount\nignored,2\nignored,3\n", { numericColumns: ["amount"] });
  assert.equal(analysis.numericTotals["amount"], "5");
  assert.match(renderCsvAnalysisExport(analysis, "json"), /"amount": "5"/u);
  assert.match(renderCsvAnalysisExport(analysis, "csv"), /"numeric_total:amount",5/u);
  assert.match(renderCsvAnalysisExport(analysis, "markdown"), /Numeric total: amount \| 5/u);
  for (const format of ["json", "csv", "markdown"]) assert.doesNotMatch(renderCsvAnalysisExport(analysis, format), /ignored/u);
});

test("selected Markdown labels cannot create links, images, or raw HTML", () => {
  const header = "![image](https://example.test/pixel) <img src=x onerror=alert(1)>";
  const analysis = analyzeCsv(`${header}\n1\n`, { numericColumns: [header] });
  const markdown = renderCsvAnalysisExport(analysis, "markdown");
  assert.doesNotMatch(markdown, /!\[image\]|<img/u);
  assert.match(markdown, /&lt;img/u);
  assert.match(markdown, /Numeric total:/u);
});
