import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AgentBudgetLedger } from "../dist/agent/tool-loop.js";
import { runSpecialistReview } from "../dist/agent/specialist-review.js";
import { renderPdfReport } from "../dist/artifacts/pdf-report.js";
import { DataSpecialistEvidenceError, prepareDataSpecialistEvidence } from "../dist/workflows/data-specialist-evidence.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function docxFixture(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("word/document.xml", `<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function xlsxFixture() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Safe sheet").addRows([["name", "value"], ["alpha", 2]]);
  return workbook.xlsx.writeBuffer();
}

test("samples supported local formats through their bounded parsers", async () => {
  const fixtures = [
    [".csv", Buffer.from("name,value\nalpha,2\nbeta,3")],
    [".txt", Buffer.from("Local text sample")],
    [".md", Buffer.from("# Local heading\nText")],
    [".pdf", await renderPdfReport({ title: "Local PDF", createdAt: "2026-10-14T00:00:00.000Z", sections: [{ heading: "Evidence", body: "Local PDF sample" }] })],
    [".docx", await docxFixture("Local DOCX sample")],
    [".xlsx", await xlsxFixture()],
  ];
  for (const [suffix, bytes] of fixtures) {
    const evidence = await prepareDataSpecialistEvidence(suffix, bytes);
    assert.equal(evidence.format, suffix === ".md" ? "markdown" : suffix.slice(1));
    assert.ok(evidence.sample.length > 0);
    assert.doesNotMatch(JSON.stringify(evidence), /C:\\\\sensitive\\\\local\\\\private|private\.csv/u);
    assert.ok(Buffer.byteLength(JSON.stringify(evidence), "utf8") <= 20 * 1024);
  }
});

test("redacts credential-like text locally before returning a bounded sample", async () => {
  const evidence = await prepareDataSpecialistEvidence(".txt", Buffer.from("api_key = gsk_abcdefghijklmnopqrstuvwxyz0123456789\nordinary note"));
  assert.doesNotMatch(evidence.sample, /gsk_abcdefghijklmnopqrstuvwxyz0123456789/u);
  assert.match(evidence.sample, /REDACTED/u);
  assert.match(evidence.sample, /ordinary note/u);
});

test("marks row, column, and character truncation without exceeding the output cap", async () => {
  const csv = `a,b,c\n${Array.from({ length: 30 }, (_unused, index) => `${index},${"x".repeat(800)},z`).join("\n")}`;
  const evidence = await prepareDataSpecialistEvidence(".csv", Buffer.from(csv));
  assert.equal(evidence.rowCount, 30);
  assert.equal(evidence.omittedData, true);
  assert.ok(evidence.limitations.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(evidence), "utf8") <= 20 * 1024);
});

test("rejects unsupported suffixes, malformed inputs, and oversized bytes with bounded errors", async () => {
  await assert.rejects(prepareDataSpecialistEvidence(".exe", Buffer.from("x")), DataSpecialistEvidenceError);
  await assert.rejects(prepareDataSpecialistEvidence(".csv", Buffer.from([0xff])), DataSpecialistEvidenceError);
  await assert.rejects(prepareDataSpecialistEvidence(".xlsx", Buffer.from("not a zip archive")), DataSpecialistEvidenceError);
  await assert.rejects(prepareDataSpecialistEvidence(".txt", new Uint8Array(8 * 1024 * 1024 + 1)), DataSpecialistEvidenceError);
  await assert.rejects(prepareDataSpecialistEvidence(".csv", Buffer.from('a,b\n"unterminated,2')), DataSpecialistEvidenceError);
});

test("integrates approved-format sampling with the data specialist and parent review without adding file paths", async () => {
  const evidence = await prepareDataSpecialistEvidence(".csv", Buffer.from("team,value\nblue,4\nblue,5"));
  const requests = [];
  const provider = {
    async complete(request) {
      requests.push(request);
      return {
        content: request.messages[0].content.includes("parent reviewer") ? "Parent verified this only describes the sample." : "Two sampled rows show the team value twice.",
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
  const result = await runSpecialistReview(provider, "fixture", "Describe repeated team values.", JSON.stringify(evidence), [
    { role: "data-specialist", goal: "Summarize supported patterns and coverage limits." },
  ], new AgentBudgetLedger(4, 2));
  assert.equal(result.workers[0].status, "complete");
  assert.equal(result.parentReviewStatus, "complete");
  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[1].content, /blue/u);
  assert.doesNotMatch(requests[0].messages[1].content, /private\.csv|C:\\\\sensitive/u);
  assert.deepEqual(result.budget, { modelRequests: 2, toolActions: 0, modelRequestsRemaining: 2, toolActionsRemaining: 2 });
});

test("data specialist CLI refuses non-interactive operation before reading a file", () => {
  const result = spawnSync(process.execPath, [cliPath, "run", "data-specialist", "--input", "C:\\sensitive\\private.csv", "--goal", "summarize"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive exact-file and provider-transfer approval/u);
  assert.doesNotMatch(result.stdout + result.stderr, /C:\\sensitive\\private\.csv/u);
});
