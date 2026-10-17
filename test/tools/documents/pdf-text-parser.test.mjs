import assert from "node:assert/strict";
import test from "node:test";
import { renderPdfReport } from "../../../dist/tools/artifacts/pdf-report.js";
import { parsePdfText, PdfTextParserError } from "../../../dist/tools/documents/pdf-text-parser.js";

test("extracts text and page count from a generated PDF report", async () => {
  const bytes = await renderPdfReport({
    title: "Synthetic PDF fixture",
    createdAt: "2026-10-10T12:00:00.000Z",
    sections: [{ heading: "Fixture heading", body: "Synthetic PDF parser content." }],
  });
  const result = await parsePdfText(bytes);
  assert.equal(result.pageCount, 1);
  assert.match(result.text, /Synthetic PDF fixture/u);
  assert.match(result.text, /Fixture heading/u);
  assert.match(result.text, /Synthetic PDF parser content\./u);
});

test("rejects wrong types, unsupported headers, malformed PDFs and oversized input", async () => {
  await assert.rejects(parsePdfText("not bytes"), PdfTextParserError);
  await assert.rejects(parsePdfText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), PdfTextParserError);
  await assert.rejects(parsePdfText(Buffer.from("%PDF-1.7\nnot a real PDF")), PdfTextParserError);
  await assert.rejects(parsePdfText(new Uint8Array(8 * 1024 * 1024 + 1)), PdfTextParserError);
});
