import { sampleCsv } from "../data/csv-analysis.js";
import { parseDocxText } from "../documents/docx-parser.js";
import { parsePdfText } from "../documents/pdf-text-parser.js";
import { parseTextDocument } from "../documents/text-parser.js";
import { parseXlsxText } from "../documents/xlsx-parser.js";
import { redactSourceForDisplay } from "./source-review-workflow.js";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024;
const MAX_TEXT_CHARACTERS = 12_000;
const MAX_CSV_ROWS = 20;
const MAX_CSV_COLUMNS = 24;
const MAX_XLSX_SHEETS = 3;
const MAX_XLSX_ROWS_PER_SHEET = 15;
const MAX_XLSX_COLUMNS = 20;
const MAX_CELL_CHARACTERS = 512;

export type DataSpecialistFormat = "csv" | "txt" | "markdown" | "pdf" | "docx" | "xlsx";

export interface DataSpecialistEvidence {
  readonly format: DataSpecialistFormat;
  readonly sample: string;
  readonly omittedData: boolean;
  readonly limitations: readonly string[];
  readonly pageCount?: number;
  readonly rowCount?: number;
}

export class DataSpecialistEvidenceError extends Error {
  constructor(message = "The selected document cannot be sampled within supported limits.") {
    super(message);
    this.name = "DataSpecialistEvidenceError";
  }
}

function parseFormat(value: unknown): DataSpecialistFormat {
  if (typeof value !== "string") throw new DataSpecialistEvidenceError("A supported document suffix is required.");
  const suffix = value.toLowerCase();
  if (suffix === ".csv") return "csv";
  if (suffix === ".txt") return "txt";
  if (suffix === ".md" || suffix === ".markdown") return "markdown";
  if (suffix === ".pdf") return "pdf";
  if (suffix === ".docx") return "docx";
  if (suffix === ".xlsx") return "xlsx";
  throw new DataSpecialistEvidenceError("Supported suffixes are CSV, TXT, Markdown, PDF, DOCX, and XLSX.");
}

function decodeUtf8(input: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new DataSpecialistEvidenceError("Text input must use valid UTF-8 encoding.");
  }
}

function clipCell(value: string): { readonly value: string; readonly clipped: boolean } {
  const redacted = redactSourceForDisplay(value.replace(/\r\n?/gu, "\n"));
  if (redacted.length <= MAX_CELL_CHARACTERS) return { value: redacted, clipped: false };
  return { value: `${redacted.slice(0, MAX_CELL_CHARACTERS)}…`, clipped: true };
}

function limitOutput(sample: string): { readonly sample: string; readonly clipped: boolean } {
  let clipped = false;
  let output = sample;
  if (output.length > MAX_TEXT_CHARACTERS) {
    output = output.slice(0, MAX_TEXT_CHARACTERS);
    clipped = true;
  }
  while (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES - 2048) {
    output = output.slice(0, -256);
    clipped = true;
  }
  return { sample: output, clipped };
}

function finish(
  format: DataSpecialistFormat,
  rawSample: string,
  omittedData: boolean,
  limits: readonly string[],
  counts: { readonly pageCount?: number; readonly rowCount?: number } = {},
): DataSpecialistEvidence {
  const bounded = limitOutput(rawSample);
  const limitations = [...limits];
  if (bounded.clipped) limitations.push("The sample was truncated to the output size limit.");
  const result: DataSpecialistEvidence = {
    format,
    sample: redactSourceForDisplay(bounded.sample),
    omittedData: omittedData || bounded.clipped,
    limitations,
    ...(counts.pageCount === undefined ? {} : { pageCount: counts.pageCount }),
    ...(counts.rowCount === undefined ? {} : { rowCount: counts.rowCount }),
  };
  while (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_OUTPUT_BYTES) {
    const shortened = result.sample.slice(0, Math.max(0, result.sample.length - 256));
    return finish(format, shortened, true, [...limits, "The sample was truncated to the output size limit."], counts);
  }
  return result;
}

/** Creates a redacted local evidence excerpt. This helper never reads files, persists data, or calls a provider. */
export async function prepareDataSpecialistEvidence(suffix: unknown, bytes: unknown): Promise<DataSpecialistEvidence> {
  const format = parseFormat(suffix);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_INPUT_BYTES) {
    throw new DataSpecialistEvidenceError("Input must be a Uint8Array no larger than 8 MiB.");
  }
  try {
    if (format === "csv") {
      const sampled = sampleCsv(decodeUtf8(bytes), MAX_CSV_ROWS, MAX_CSV_COLUMNS);
      const headers = sampled.headers.map((cell) => clipCell(cell));
      const rows = sampled.rows.map((row) => row.map((cell) => clipCell(cell)));
      const clipped = headers.some((cell) => cell.clipped) || rows.some((row) => row.some((cell) => cell.clipped));
      const sample = JSON.stringify({ headers: headers.map((cell) => cell.value), rows: rows.map((row) => row.map((cell) => cell.value)) }, null, 2);
      const limits = ["At most 20 leading data rows and 24 columns are included."];
      if (clipped || sampled.omittedColumns > 0) limits.push("One or more cells or columns were truncated.");
      return finish("csv", sample, sampled.omittedRows > 0 || sampled.omittedColumns > 0 || clipped, limits, { rowCount: sampled.rowCount });
    }
    if (format === "txt" || format === "markdown") {
      const parsed = parseTextDocument(decodeUtf8(bytes), format === "txt" ? "txt" : "markdown");
      const omitted = parsed.text.length > MAX_TEXT_CHARACTERS;
      return finish(format, parsed.text, omitted, ["Only a leading text excerpt is included."]);
    }
    if (format === "pdf") {
      const parsed = await parsePdfText(bytes);
      const omitted = parsed.text.length > MAX_TEXT_CHARACTERS;
      return finish("pdf", parsed.text.slice(0, MAX_TEXT_CHARACTERS), omitted, ["Text-only extraction; at most the leading 12,000 characters are included."], { pageCount: parsed.pageCount });
    }
    if (format === "docx") {
      const parsed = await parseDocxText(bytes);
      return finish("docx", parsed, parsed.length > MAX_TEXT_CHARACTERS, ["Text-only extraction; at most the leading 12,000 characters are included."]);
    }
    const workbook = await parseXlsxText(bytes);
    let omitted = workbook.sheets.length > MAX_XLSX_SHEETS;
    const parts: string[] = [];
    for (const sheet of workbook.sheets.slice(0, MAX_XLSX_SHEETS)) {
      const name = clipCell(sheet.name);
      parts.push(`# ${name.value}`);
      if (name.clipped) omitted = true;
      if (sheet.rows.length > MAX_XLSX_ROWS_PER_SHEET) omitted = true;
      for (const row of sheet.rows.slice(0, MAX_XLSX_ROWS_PER_SHEET)) {
        const cells = row.cells.slice(0, MAX_XLSX_COLUMNS).map((cell) => clipCell(cell === null ? "" : String(cell)));
        if (row.cells.length > MAX_XLSX_COLUMNS || cells.some((cell) => cell.clipped)) omitted = true;
        parts.push(`${row.rowNumber}\t${cells.map((cell) => cell.value.replace(/[\t\n]/gu, " ")).join("\t")}`);
      }
    }
    return finish("xlsx", parts.join("\n"), omitted, ["At most 3 sheets, 15 rows per sheet, and 20 columns per row are included."]);
  } catch (error: unknown) {
    if (error instanceof DataSpecialistEvidenceError) throw error;
    throw new DataSpecialistEvidenceError();
  }
}
