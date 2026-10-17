import assert from "node:assert/strict";
import test from "node:test";
import { renderPdfReport, PdfReportError } from "../../../dist/tools/artifacts/pdf-report.js";

test("renders a bounded multi-section PDF in memory with metadata and valid PDF markers", async () => {
  const result = await renderPdfReport({
    title: "Synthetic report",
    createdAt: "2026-10-10T12:00:00.000Z",
    sections: [
      { heading: "Summary", body: "This is synthetic content with a comma, a quote \" and a Latin character é." },
      { heading: "Evidence", body: "No files were opened and no content was sent to an external provider." },
    ],
  });
  const pdf = Buffer.from(result).toString("latin1");
  assert.equal(pdf.startsWith("%PDF-"), true);
  assert.equal(pdf.includes("%%EOF"), true);
  assert.equal(pdf.includes("Synthetic report"), true);
  assert.equal(pdf.includes("TaskForge PDF report adapter"), true);
  assert.equal(result.byteLength < 8 * 1024 * 1024, true);
});

test("rejects malformed reports, unsupported characters, and excessive sections", async () => {
  await assert.rejects(renderPdfReport(null), PdfReportError);
  await assert.rejects(renderPdfReport({ title: "", createdAt: "2026-10-10", sections: [] }), PdfReportError);
  await assert.rejects(renderPdfReport({ title: "Bad emoji 😀", createdAt: "2026-10-10T12:00:00Z", sections: [] }), PdfReportError);
  await assert.rejects(renderPdfReport({ title: "Too many", createdAt: "2026-10-10T12:00:00Z", sections: Array.from({ length: 51 }, () => ({ heading: "h", body: "b" })) }), PdfReportError);
});

test("rejects oversized report bodies before rendering", async () => {
  await assert.rejects(
    renderPdfReport({ title: "Large", createdAt: "2026-10-10T12:00:00Z", sections: [{ heading: "Body", body: "x".repeat(100_001) }] }),
    PdfReportError,
  );
});
