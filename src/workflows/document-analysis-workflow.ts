import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import type { MongoStore, RunSummary } from "../mongo-store.js";
import { parseDocxText } from "../documents/docx-parser.js";
import { parsePdfText } from "../documents/pdf-text-parser.js";
import { parseTextDocument } from "../documents/text-parser.js";
import { parseXlsxText } from "../documents/xlsx-parser.js";

const WORKFLOW_ID = "document-analyze";
const STEP_ID = "parse";
const STATE_HASH = createHash("sha256").update("taskforge:document-analyze:v1").digest("hex");
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export type SupportedDocumentFormat = "txt" | "markdown" | "pdf" | "docx" | "xlsx";

export interface DocumentAnalysis {
  readonly format: SupportedDocumentFormat;
  readonly byteCount: number;
  readonly characterCount: number;
  readonly wordCount: number;
  readonly lineCount: number;
  readonly headingCount: number;
  readonly pageCount?: number;
  readonly sheetCount?: number;
  readonly rowCount?: number;
  readonly cellCount?: number;
}

export interface DocumentAnalysisResult {
  readonly run: RunSummary;
  readonly analysis: DocumentAnalysis;
  readonly resumed: boolean;
}

type Persistence = Pick<MongoStore,
  "saveRunSummary" | "updateRunState" | "appendRunEvent" | "updateRunSummary" |
  "saveRunCheckpoint" | "loadRunCheckpoint" | "getRunSummary" | "recoverStaleRun">;

export class DocumentWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentWorkflowError";
  }
}

function parseFormat(value: unknown): SupportedDocumentFormat {
  if (value === ".txt") return "txt";
  if (value === ".md" || value === ".markdown") return "markdown";
  if (value === ".pdf") return "pdf";
  if (value === ".docx") return "docx";
  if (value === ".xlsx") return "xlsx";
  throw new DocumentWorkflowError("Supported formats are TXT, Markdown, text PDF, DOCX, and XLSX.");
}

function decodeUtf8(input: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new DocumentWorkflowError("Document must use valid UTF-8 encoding.");
  }
}

function countText(text: string): Pick<DocumentAnalysis, "characterCount" | "wordCount" | "lineCount"> {
  const normalized = text.replace(/\r\n?/gu, "\n");
  return {
    characterCount: normalized.length,
    wordCount: (normalized.match(WORD_PATTERN) ?? []).length,
    lineCount: normalized.length === 0 ? 0 : normalized.split("\n").length - (normalized.endsWith("\n") ? 1 : 0),
  };
}

async function analyzeBytes(format: SupportedDocumentFormat, input: Uint8Array): Promise<DocumentAnalysis> {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > MAX_INPUT_BYTES) {
    throw new DocumentWorkflowError("Document input is invalid or exceeds the 8 MiB workflow limit.");
  }
  if (format === "txt" || format === "markdown") {
    const parsed = parseTextDocument(decodeUtf8(input), format === "txt" ? "txt" : "markdown");
    return {
      format,
      byteCount: input.byteLength,
      characterCount: parsed.text.length,
      wordCount: parsed.wordCount,
      lineCount: parsed.lineCount,
      headingCount: parsed.headings.length,
    };
  }
  if (format === "pdf") {
    const parsed = await parsePdfText(input);
    return {
      format,
      byteCount: input.byteLength,
      ...countText(parsed.text),
      headingCount: 0,
      pageCount: parsed.pageCount,
    };
  }
  if (format === "docx") {
    const text = await parseDocxText(input);
    return {
      format,
      byteCount: input.byteLength,
      ...countText(text),
      headingCount: 0,
    };
  }
  const parsed = await parseXlsxText(input);
  let rowCount = 0;
  let cellCount = 0;
  for (const sheet of parsed.sheets) {
    for (const row of sheet.rows) {
      rowCount += 1;
      for (const cell of row.cells) {
        if (cell !== null) {
          cellCount += 1;
        }
      }
    }
  }
  return {
    format,
    byteCount: input.byteLength,
    characterCount: 0,
    wordCount: 0,
    lineCount: 0,
    headingCount: 0,
    sheetCount: parsed.sheets.length,
    rowCount,
    cellCount,
  };
}

function summarize(analysis: DocumentAnalysis): string {
  if (analysis.format === "xlsx") {
    return `Document analysis complete: XLSX; ${analysis.sheetCount ?? 0} sheets; ${analysis.rowCount ?? 0} rows; ${analysis.cellCount ?? 0} scalar cells.`;
  }
  return `Document analysis complete: ${analysis.format}; ${analysis.wordCount} words; ${analysis.lineCount} lines; ${analysis.byteCount} bytes.`;
}

export async function analyzeDocument(
  store: Persistence,
  extension: unknown,
  input: Uint8Array,
  scheduledRunId?: string,
): Promise<DocumentAnalysisResult> {
  const format = parseFormat(extension);
  const inputHash = createHash("sha256").update(input).digest("hex");
  const runId = scheduledRunId ?? randomUUID();
  const existing = scheduledRunId === undefined ? null : await store.getRunSummary(runId);
  const run = existing ?? await store.saveRunSummary({
    runId, workflowId: WORKFLOW_ID,
    summary: "Document analysis started; file name, extracted text, sheet names, and cell values are not persisted.",
  });
  if (run.workflowId !== WORKFLOW_ID || (existing !== null && existing.state !== "awaiting_approval")) {
    throw new DocumentWorkflowError("Scheduled document run is not awaiting fresh approval.");
  }
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  return executeAnalysis(store, run, format, input, inputHash, false);
}

async function executeAnalysis(
  store: Persistence,
  run: RunSummary,
  format: SupportedDocumentFormat,
  input: Uint8Array,
  inputHash: string,
  resumed: boolean,
): Promise<DocumentAnalysisResult> {
  try {
    await store.saveRunCheckpoint({
      runId: run.runId,
      version: 1,
      inputHash,
      stateHash: STATE_HASH,
      completedStepIds: [],
      pendingStepId: STEP_ID,
    });
    await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "step_started", stepId: STEP_ID });
    const analysis = await analyzeBytes(format, input);
    await store.saveRunCheckpoint({
      runId: run.runId,
      version: 1,
      inputHash,
      stateHash: STATE_HASH,
      completedStepIds: [STEP_ID],
    });
    await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "step_finished", stepId: STEP_ID });
    await store.updateRunSummary(run.runId, summarize(analysis));
    const completed = await store.updateRunState(run.runId, "completed");
    await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "run_finished" });
    return { run: completed, analysis, resumed };
  } catch (error: unknown) {
    if (error instanceof DocumentWorkflowError) {
      await store.updateRunSummary(run.runId, "Document parsing failed validation; input content was not persisted.");
      await store.updateRunState(run.runId, "failed");
      await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "run_failed" });
      throw error;
    }
    try {
      await store.updateRunState(run.runId, "uncertain");
      await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "run_paused" });
    } catch {
      // Preserve the original persistence error if the database is unavailable.
    }
    throw error;
  }
}

export async function resumeDocumentAnalysisWorkflow(
  store: Persistence,
  runId: unknown,
  extension: unknown,
  input: Uint8Array,
): Promise<DocumentAnalysisResult> {
  if (typeof runId !== "string") throw new DocumentWorkflowError("A run id is required to resume document analysis.");
  const format = parseFormat(extension);
  let existing = await store.getRunSummary(runId);
  if (existing === null || existing.workflowId !== WORKFLOW_ID) {
    throw new DocumentWorkflowError("Only an uncertain document-analyze run can be resumed.");
  }
  if (existing.state === "running") {
    const recovered = await store.recoverStaleRun(runId, new Date(Date.now() - 2 * 60 * 1000));
    if (recovered) {
      await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_paused" });
      existing = await store.getRunSummary(runId);
    }
  }
  if (existing === null || existing.state !== "uncertain") {
    throw new DocumentWorkflowError("Only an uncertain document-analyze run can be resumed.");
  }
  const inputHash = createHash("sha256").update(input).digest("hex");
  const checkpoint = await store.loadRunCheckpoint(runId, inputHash, STATE_HASH);
  if (checkpoint === null || (checkpoint.pendingStepId !== STEP_ID && !checkpoint.completedStepIds.includes(STEP_ID))) {
    throw new DocumentWorkflowError("The run has no resumable document checkpoint for these input bytes.");
  }
  const resumed = await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_resumed" });
  return executeAnalysis(store, resumed, format, input, inputHash, true);
}
