import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import test from "node:test";
import { parseXlsxText, XlsxParserError } from "../dist/documents/xlsx-parser.js";

async function createWorkbookBuffer(addContent) {
  const workbook = new ExcelJS.Workbook();
  addContent(workbook);
  return workbook.xlsx.writeBuffer();
}

test("extracts bounded scalar rows from a synthetic XLSX workbook", async () => {
  const bytes = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Summary");
    sheet.addRow(["Name", "Count", "Active"]);
    sheet.addRow(["alpha", 2, true]);
    sheet.addRow(["beta", 0, false]);
  });
  const result = await parseXlsxText(bytes);
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0]?.name, "Summary");
  assert.deepEqual(result.sheets[0]?.rows.map((row) => row.cells), [
    ["Name", "Count", "Active"],
    ["alpha", 2, true],
    ["beta", 0, false],
  ]);
});

test("rejects malformed, oversized, unsupported, and formula-bearing workbooks", async () => {
  await assert.rejects(parseXlsxText("not bytes"), XlsxParserError);
  await assert.rejects(parseXlsxText(new Uint8Array(8 * 1024 * 1024 + 1)), XlsxParserError);
  await assert.rejects(parseXlsxText(Buffer.from("not a zip archive")), XlsxParserError);

  const formulaBytes = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Formulas");
    sheet.getCell("A1").value = { formula: "1+1", result: 2 };
  });
  await assert.rejects(parseXlsxText(formulaBytes), XlsxParserError);
});
