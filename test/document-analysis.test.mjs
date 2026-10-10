import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import test from "node:test";
import { renderPdfReport } from "../dist/artifacts/pdf-report.js";
import { analyzeDocument, DocumentWorkflowError, resumeDocumentAnalysisWorkflow } from "../dist/workflows/document-analysis-workflow.js";

function createPersistenceRecorder() {
  const state = { events: [], runs: new Map(), checkpoints: new Map() };
  return {
    state,
    async saveRunSummary(input) {
      state.runs.set(input.runId, { ...input, state: "created", createdAt: new Date() });
      return state.runs.get(input.runId);
    },
    async updateRunState(runId, status) {
      const run = state.runs.get(runId);
      const updated = { ...run, state: status, createdAt: run.createdAt };
      state.runs.set(runId, updated);
      return updated;
    },
    async updateRunSummary(runId, summary) {
      const run = state.runs.get(runId);
      state.runs.set(runId, { ...run, summary });
    },
    async appendRunEvent(event) {
      state.events.push(event);
      return { ...event, sequence: state.events.length, createdAt: new Date() };
    },
    async saveRunCheckpoint(checkpoint) {
      state.checkpoints.set(checkpoint.runId, checkpoint);
      return { ...checkpoint, updatedAt: new Date() };
    },
    async loadRunCheckpoint(runId, inputHash, stateHash) {
      const checkpoint = state.checkpoints.get(runId);
      const run = state.runs.get(runId);
      return run?.state === "uncertain" && checkpoint?.inputHash === inputHash && checkpoint?.stateHash === stateHash
        ? { ...checkpoint, updatedAt: new Date() }
        : null;
    },
    async getRunSummary(runId) {
      return state.runs.get(runId) ?? null;
    },
    async recoverStaleRun() {
      return false;
    },
  };
}

async function createDocx(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("word/document.xml", `<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function createXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Private Sheet Name");
  sheet.addRow(["Private Header", "Value"]);
  sheet.addRow(["private-synthetic-cell-marker", 7]);
  return workbook.xlsx.writeBuffer();
}

test("approved document workflow parses supported formats and persists metadata only", async () => {
  const persistence = createPersistenceRecorder();
  const pdf = await renderPdfReport({
    title: "Synthetic report",
    createdAt: "2026-10-10T00:00:00.000Z",
    sections: [{ heading: "Evidence", body: "PDF private synthetic marker" }],
  });
  const docx = await createDocx("DOCX private synthetic marker");
  const xlsx = await createXlsx();
  const inputs = [
    [".txt", Buffer.from("Hello private-synthetic-text\nLine two", "utf8")],
    [".md", Buffer.from("## Private heading\nBody text", "utf8")],
    [".pdf", pdf],
    [".docx", docx],
    [".xlsx", xlsx],
  ];

  const results = [];
  for (const [extension, bytes] of inputs) {
    results.push(await analyzeDocument(persistence, extension, bytes));
  }

  assert.deepEqual(results.map((result) => result.analysis.format), ["txt", "markdown", "pdf", "docx", "xlsx"]);
  assert.equal(results[0]?.analysis.wordCount, 4);
  assert.equal(results[1]?.analysis.headingCount, 1);
  assert.equal(results[2]?.analysis.pageCount, 1);
  assert.equal(results[3]?.analysis.wordCount, 4);
  assert.equal(results[4]?.analysis.sheetCount, 1);
  assert.equal(results[4]?.analysis.rowCount, 2);
  assert.equal(results[4]?.analysis.cellCount, 4);
  assert.equal(results.every((result) => result.run.state === "completed"), true);
  const persistedText = JSON.stringify([...persistence.state.runs.values()]);
  assert.equal(persistedText.includes("private-synthetic"), false);
  assert.equal(persistedText.includes("Private Sheet Name"), false);
  assert.equal(persistedText.includes("Private Header"), false);
  assert.equal(JSON.stringify(persistence.state.events).includes("private-synthetic"), false);
  assert.equal(persistence.state.events.length, 20);
});

test("document workflow rejects unsupported formats and records malformed UTF-8 as failed metadata", async () => {
  const persistence = createPersistenceRecorder();
  await assert.rejects(analyzeDocument(persistence, ".exe", Buffer.from("data")), DocumentWorkflowError);
  await assert.rejects(analyzeDocument(persistence, ".txt", Buffer.from([0xff, 0xfe])), DocumentWorkflowError);
  assert.equal(persistence.state.runs.size, 1);
  assert.equal([...persistence.state.runs.values()][0]?.state, "failed");
  assert.equal(persistence.state.events.some((event) => event.type === "run_failed"), true);
});

test("document resume rejects changed bytes and deterministically completes the checkpoint", async () => {
  const persistence = createPersistenceRecorder();
  const runId = randomUUID();
  const input = Buffer.from("same input bytes", "utf8");
  await persistence.saveRunSummary({ runId, workflowId: "document-analyze", summary: "Interrupted." });
  await persistence.updateRunState(runId, "uncertain");
  const inputHash = createHash("sha256").update(input).digest("hex");
  const stateHash = createHash("sha256").update("taskforge:document-analyze:v1").digest("hex");
  await persistence.saveRunCheckpoint({ runId, version: 1, inputHash, stateHash, completedStepIds: [], pendingStepId: "parse" });

  await assert.rejects(resumeDocumentAnalysisWorkflow(persistence, runId, ".txt", Buffer.from("changed")), /checkpoint/);
  const result = await resumeDocumentAnalysisWorkflow(persistence, runId, ".txt", input);
  assert.equal(result.resumed, true);
  assert.equal(result.run.state, "completed");
  assert.equal(result.analysis.wordCount, 3);
});
