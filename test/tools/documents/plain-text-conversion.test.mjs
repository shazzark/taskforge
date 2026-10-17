import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import test from "node:test";
import { convertDocumentToPlainText, DocumentConversionError } from "../../../dist/tools/documents/plain-text-conversion.js";
import { renderPdfReport } from "../../../dist/tools/artifacts/pdf-report.js";

test("converts TXT, Markdown, PDF, and DOCX using the bounded extractors", async () => {
  assert.equal(await convertDocumentToPlainText(".txt", Buffer.from("\uFEFFalpha\r\nbeta\r")), "alpha\nbeta\n");
  assert.equal(await convertDocumentToPlainText(".md", Buffer.from("# Heading\r\nText")), "# Heading\nText");
  const pdf = await renderPdfReport({ title: "Fixture", createdAt: new Date().toISOString(), sections: [{ heading: "Summary", body: "PDF text" }] });
  assert.match(await convertDocumentToPlainText(".pdf", pdf), /PDF text/u);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("word/document.xml", "<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>DOCX text</w:t></w:r></w:p></w:body></w:document>");
  assert.match(await convertDocumentToPlainText(".docx", await zip.generateAsync({ type: "nodebuffer" })), /DOCX text/u);
});

test("converts XLSX scalar rows into escaped TSV and enforces output boundaries", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Data").addRows([["Name", "Value"], ["A\tB", 7]]);
  const content = await convertDocumentToPlainText(".xlsx", await workbook.xlsx.writeBuffer());
  assert.match(content, /# Data\n1\tName\tValue\n2\tA\\tB\t7/u);
  await assert.rejects(convertDocumentToPlainText(".csv", Buffer.from("a,b\n1,2")), DocumentConversionError);
  await assert.rejects(convertDocumentToPlainText(".txt", Buffer.from("x".repeat(65 * 1024))), DocumentConversionError);
});
