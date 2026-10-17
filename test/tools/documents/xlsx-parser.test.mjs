import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import test from "node:test";
import { parseXlsxText, XlsxParserError } from "../../../dist/tools/documents/xlsx-parser.js";

async function createWorkbookBuffer(addContent) {
  const workbook = new ExcelJS.Workbook();
  addContent(workbook);
  return workbook.xlsx.writeBuffer();
}

test("extracts bounded scalar rows from a synthetic XLSX workbook", async () => {
  const bytes = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Summary");
    sheet.addRow(["Name & group", "Count", "Active"]);
    sheet.addRow(["alpha", 2, true]);
    sheet.addRow(["beta", 0, false]);
  });
  const result = await parseXlsxText(bytes);
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0]?.name, "Summary");
  assert.deepEqual(result.sheets[0]?.rows.map((row) => row.cells), [
    ["Name & group", "Count", "Active"],
    ["alpha", 2, true],
    ["beta", 0, false],
  ]);
});

test("follows worksheet relationships with custom part filenames", async () => {
  const bytes = await createWorkbookBuffer((workbook) => {
    workbook.addWorksheet("Overview").addRow(["custom part"]);
  });
  const archive = await JSZip.loadAsync(bytes);
  const worksheet = archive.file("xl/worksheets/sheet1.xml");
  const relationshipsFile = archive.file("xl/_rels/workbook.xml.rels");
  const contentTypesFile = archive.file("[Content_Types].xml");
  assert.ok(worksheet);
  assert.ok(relationshipsFile);
  assert.ok(contentTypesFile);

  archive.file("xl/worksheets/Overview.xml", await worksheet.async("nodebuffer"));
  archive.remove("xl/worksheets/sheet1.xml");
  archive.file(
    "xl/_rels/workbook.xml.rels",
    (await relationshipsFile.async("string")).replace("worksheets/sheet1.xml", "worksheets/Overview.xml"),
  );
  archive.file(
    "[Content_Types].xml",
    (await contentTypesFile.async("string")).replace("/xl/worksheets/sheet1.xml", "/xl/worksheets/Overview.xml"),
  );

  const result = await parseXlsxText(await archive.generateAsync({ type: "nodebuffer" }));
  assert.equal(result.sheets[0]?.name, "Overview");
  assert.deepEqual(result.sheets[0]?.rows[0]?.cells, ["custom part"]);
});

test("accepts explicitly typed numeric cells", async () => {
  const bytes = await createWorkbookBuffer((workbook) => {
    workbook.addWorksheet("Numbers").addRow([1.25]);
  });
  const archive = await JSZip.loadAsync(bytes);
  const worksheet = archive.file("xl/worksheets/sheet1.xml");
  assert.ok(worksheet);
  const xml = await worksheet.async("string");
  const explicitlyTypedXml = xml.replace(/(<c\b[^>]*r="A1")/u, '$1 t="n"');
  assert.notEqual(explicitlyTypedXml, xml);
  archive.file("xl/worksheets/sheet1.xml", explicitlyTypedXml);

  const result = await parseXlsxText(await archive.generateAsync({ type: "nodebuffer" }));
  assert.equal(result.sheets[0]?.rows[0]?.cells[0], 1.25);
});

test("converts Excel date-formatted numeric cells to ISO text", async () => {
  const expected = "2024-06-07T12:34:56.789Z";
  const bytes = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Dates");
    sheet.getCell("A1").value = new Date(expected);
    sheet.getCell("A2").value = new Date(expected);
    sheet.getCell("A2").numFmt = "yyyy-mm-dd hh:mm:ss.000";
  });

  const result = await parseXlsxText(bytes);
  assert.equal(result.sheets[0]?.rows[0]?.cells[0], expected);
  assert.equal(result.sheets[0]?.rows[1]?.cells[0], expected);

  const date1904Bytes = await createWorkbookBuffer((workbook) => {
    workbook.properties.date1904 = true;
    workbook.addWorksheet("Dates").addRow([new Date(expected)]);
  });
  const date1904Result = await parseXlsxText(date1904Bytes);
  assert.equal(date1904Result.sheets[0]?.rows[0]?.cells[0], expected);

  const literalFormatBytes = await createWorkbookBuffer((workbook) => {
    const cell = workbook.addWorksheet("Literals").getCell("A1");
    cell.value = 42;
    cell.numFmt = '0 "days"';
  });
  const literalFormatResult = await parseXlsxText(literalFormatBytes);
  assert.equal(literalFormatResult.sheets[0]?.rows[0]?.cells[0], 42);
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

test("rejects worksheet relationship traversal and oversized declared dimensions", async () => {
  const bytes = await createWorkbookBuffer((workbook) => workbook.addWorksheet("Safe").addRow(["value"]));
  const archive = await JSZip.loadAsync(bytes);
  const relationshipFile = archive.file("xl/_rels/workbook.xml.rels");
  assert.ok(relationshipFile);
  const relationships = await relationshipFile.async("string");
  const escapedRelationships = relationships.replace('Target="worksheets/sheet1.xml"', 'Target="../worksheets/sheet1.xml"');
  assert.notEqual(escapedRelationships, relationships);
  archive.file("xl/_rels/workbook.xml.rels", escapedRelationships);
  await assert.rejects(parseXlsxText(await archive.generateAsync({ type: "nodebuffer" })), XlsxParserError);

  const oversizedArchive = await JSZip.loadAsync(bytes);
  const sheetFile = oversizedArchive.file("xl/worksheets/sheet1.xml");
  assert.ok(sheetFile);
  const sheetXml = await sheetFile.async("string");
  const oversizedSheetXml = sheetXml.replace(/ref="[^"]+"/u, 'ref="A1:XFD1048576"');
  assert.notEqual(oversizedSheetXml, sheetXml);
  oversizedArchive.file("xl/worksheets/sheet1.xml", oversizedSheetXml);
  await assert.rejects(parseXlsxText(await oversizedArchive.generateAsync({ type: "nodebuffer" })), XlsxParserError);
});

test("bounds aggregate sparse row expansion across all worksheets", async () => {
  const bytes = await createWorkbookBuffer((workbook) => {
    for (const sheetName of ["First", "Second"]) {
      const sheet = workbook.addWorksheet(sheetName);
      for (let row = 0; row < 200; row += 1) sheet.addRow(["value"]);
    }
  });
  const archive = await JSZip.loadAsync(bytes);
  for (const sheetNumber of [1, 2]) {
    const filePath = `xl/worksheets/sheet${sheetNumber}.xml`;
    const sheetFile = archive.file(filePath);
    assert.ok(sheetFile);
    const sheetXml = await sheetFile.async("string");
    const sparseXml = sheetXml.replace(/r="A(\d+)"/gu, "r=\"IV$1\"").replace(/ref="A1:A(\d+)"/u, "ref=\"IV1:IV$1\"");
    assert.notEqual(sparseXml, sheetXml);
    archive.file(filePath, sparseXml);
  }
  await assert.rejects(parseXlsxText(await archive.generateAsync({ type: "nodebuffer" })), XlsxParserError);
});

test("rejects rich shared strings rather than silently flattening them", async () => {
  const bytes = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Rich");
    sheet.getCell("A1").value = { richText: [{ text: "formatted" }, { text: " text" }] };
  });
  await assert.rejects(parseXlsxText(bytes), XlsxParserError);
});
