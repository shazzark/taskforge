import ExcelJS from "exceljs";
import * as yauzl from "yauzl";

const MAX_XLSX_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_WORKSHEET_XML_BYTES = 1024 * 1024;
const MAX_WORKBOOK_SHEETS = 20;
const MAX_WORKSHEET_ROWS = 10_000;
const MAX_WORKSHEET_COLUMNS = 256;
const MAX_WORKBOOK_CELLS = 100_000;
const MAX_EXTRACTED_CHARACTERS = 1_000_000;

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxExtractedRow {
  readonly rowNumber: number;
  readonly cells: readonly XlsxCellValue[];
}

export interface XlsxExtractedSheet {
  readonly name: string;
  readonly rows: readonly XlsxExtractedRow[];
}

export interface XlsxTextResult {
  readonly sheets: readonly XlsxExtractedSheet[];
}

export class XlsxParserError extends Error {
  constructor(message = "XLSX input is invalid or exceeds supported limits.") {
    super(message);
    this.name = "XlsxParserError";
  }
}

function safeEntryName(name: string): boolean {
  return name.length > 0 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.split("/").some((part) => part === ".." || part === ".");
}

async function preflightXlsxArchive(input: Buffer): Promise<ReadonlySet<string>> {
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.fromBufferPromise(input, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount < 1 || zipFile.entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new XlsxParserError("XLSX archive contains too many entries.");
    }
    let expandedBytes = 0;
    const names = new Set<string>();
    for await (const entry of zipFile.eachEntry()) {
      if (
        !safeEntryName(entry.fileName) ||
        names.has(entry.fileName) ||
        entry.isEncrypted() ||
        !entry.canDecodeFileData() ||
        ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES
      ) {
        throw new XlsxParserError("XLSX archive contains an unsupported or oversized entry.");
      }
      if (entry.fileName.startsWith("xl/worksheets/") && entry.uncompressedSize > MAX_WORKSHEET_XML_BYTES) {
        throw new XlsxParserError("XLSX worksheet XML exceeds the supported size limit.");
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new XlsxParserError("XLSX expanded archive exceeds the supported size limit.");
      }
      names.add(entry.fileName);

      const stream = await zipFile.openReadStreamPromise(entry);
      let entryBytes = 0;
      for await (const chunk of stream) {
        const chunkBytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
        entryBytes += chunkBytes;
        if (entryBytes > entry.uncompressedSize || entryBytes > MAX_ARCHIVE_ENTRY_BYTES) {
          stream.destroy();
          throw new XlsxParserError("XLSX archive entry expanded beyond its declared size.");
        }
      }
      if (entryBytes !== entry.uncompressedSize) {
        throw new XlsxParserError("XLSX archive entry size did not match its contents.");
      }
    }
    if (
      !names.has("[Content_Types].xml") ||
      !names.has("xl/workbook.xml") ||
      !Array.from(names).some((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name)) ||
      names.has("xl/vbaProject.bin")
    ) {
      throw new XlsxParserError("Input is not a supported XLSX workbook.");
    }
    return names;
  } catch (error) {
    if (error instanceof XlsxParserError) {
      throw error;
    }
    throw new XlsxParserError();
  } finally {
    zipFile?.close();
  }
}

function normalizeCellValue(value: unknown): XlsxCellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new XlsxParserError("XLSX cell contains a non-finite number.");
    }
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  throw new XlsxParserError("XLSX formula and rich cell types are not supported.");
}

export async function parseXlsxText(value: unknown): Promise<XlsxTextResult> {
  if (!(value instanceof Uint8Array) || value.byteLength < 8 || value.byteLength > MAX_XLSX_BYTES) {
    throw new XlsxParserError("XLSX must be supplied as bounded Uint8Array data.");
  }
  const bytes = Buffer.from(value);
  await preflightXlsxArchive(bytes);

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    if (workbook.worksheets.length < 1 || workbook.worksheets.length > MAX_WORKBOOK_SHEETS) {
      throw new XlsxParserError("XLSX sheet count exceeds the supported limit.");
    }
    const sheets: XlsxExtractedSheet[] = [];
    let totalCells = 0;
    let totalCharacters = 0;
    for (const worksheet of workbook.worksheets) {
      if (
        worksheet.rowCount > MAX_WORKSHEET_ROWS ||
        worksheet.columnCount > MAX_WORKSHEET_COLUMNS
      ) {
        throw new XlsxParserError("XLSX worksheet dimensions exceed the supported limits.");
      }
      const rows: XlsxExtractedRow[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const valuesByColumn = new Map<number, XlsxCellValue>();
        row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
          totalCells += 1;
          if (totalCells > MAX_WORKBOOK_CELLS || columnNumber > MAX_WORKSHEET_COLUMNS) {
            throw new XlsxParserError("XLSX cell count or column index exceeds the supported limit.");
          }
          const cellValue = normalizeCellValue(cell.value);
          if (typeof cellValue === "string") {
            totalCharacters += cellValue.length;
            if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
              throw new XlsxParserError("Extracted XLSX text exceeds the supported limit.");
            }
          }
          valuesByColumn.set(columnNumber, cellValue);
        });
        const maxColumn = Math.max(0, ...valuesByColumn.keys());
        rows.push({
          rowNumber,
          cells: Array.from({ length: maxColumn }, (_unused, index) => valuesByColumn.get(index + 1) ?? null),
        });
      });
      sheets.push({ name: worksheet.name, rows });
    }
    return { sheets };
  } catch (error) {
    if (error instanceof XlsxParserError) {
      throw error;
    }
    throw new XlsxParserError();
  }
}
