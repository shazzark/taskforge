import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import type { MongoStore, RunSummary } from "../mongo-store.js";
import { parseDocxText } from "../documents/docx-parser.js";
import { parsePdfText } from "../documents/pdf-text-parser.js";
import { parseTextDocument } from "../documents/text-parser.js";
import { parseXlsxText } from "../documents/xlsx-parser.js";

const WORKFLOW_ID = "document-analyze";
const STEP_ID = "parse";
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
}

type Persistence = Pick<MongoStore, "saveRunSummary" | "updateRunState" | "appendRunEvent" | "updateRunSummary">;

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
): Promise<DocumentAnalysisResult> {
  const format = parseFormat(extension);
  let analysis: DocumentAnalysis;
  try {
    analysis = await analyzeBytes(format, input);
  } catch (error: unknown) {
    if (error instanceof DocumentWorkflowError) throw error;
    throw new DocumentWorkflowError("Document parsing failed; input content was not persisted.");
  }

  const runId = randomUUID();
  const run = await store.saveRunSummary({
    runId,
    workflowId: WORKFLOW_ID,
    summary: "Document analysis started; file name, extracted text, sheet names, and cell values are not persisted.",
  });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_started", stepId: STEP_ID });
  await store.updateRunSummary(runId, summarize(analysis));
  const completed = await store.updateRunState(runId, "completed");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished", stepId: STEP_ID });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_finished" });
  return { run: completed, analysis };
}
