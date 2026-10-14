import { posix as path } from "node:path";
import { TextDecoder } from "node:util";
import { XMLParser, XMLValidator } from "fast-xml-parser";
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
const MAX_WORKBOOK_OUTPUT_SLOTS = 100_000;
const MAX_EXTRACTED_CHARACTERS = 1_000_000;
const MAX_SHARED_STRINGS = 100_000;
const MAX_CELL_STYLES = 10_000;
const BUILTIN_DATE_FORMAT_IDS = new Set([
  ...Array.from({ length: 9 }, (_unused, index) => index + 14),
  ...Array.from({ length: 10 }, (_unused, index) => index + 27),
  45, 46, 47,
  ...Array.from({ length: 9 }, (_unused, index) => index + 50),
  81,
]);

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
  return name.length > 0 && !name.startsWith("/") && !name.includes("\\") &&
    !name.split("/").some((part) => part === ".." || part === ".");
}

async function readXlsxArchive(input: Buffer): Promise<ReadonlyMap<string, Buffer>> {
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
    const entries = new Map<string, Buffer>();
    for await (const entry of zipFile.eachEntry()) {
      if (
        !safeEntryName(entry.fileName) || entries.has(entry.fileName) || entry.isEncrypted() ||
        !entry.canDecodeFileData() || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
        !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
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

      const stream = await zipFile.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let entryBytes = 0;
      for await (const chunk of stream) {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        entryBytes += buffer.byteLength;
        if (entryBytes > entry.uncompressedSize || entryBytes > MAX_ARCHIVE_ENTRY_BYTES) {
          stream.destroy();
          throw new XlsxParserError("XLSX archive entry expanded beyond its declared size.");
        }
        chunks.push(buffer);
      }
      if (entryBytes !== entry.uncompressedSize) {
        throw new XlsxParserError("XLSX archive entry size did not match its contents.");
      }
      entries.set(entry.fileName, Buffer.concat(chunks, entryBytes));
    }
    if (
      !entries.has("[Content_Types].xml") || !entries.has("xl/workbook.xml") ||
      !entries.has("xl/_rels/workbook.xml.rels") ||
      entries.has("xl/vbaProject.bin")
    ) {
      throw new XlsxParserError("Input is not a supported XLSX workbook.");
    }
    return entries;
  } catch (error: unknown) {
    if (error instanceof XlsxParserError) throw error;
    throw new XlsxParserError();
  } finally {
    zipFile?.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodes(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseXml(bytes: Buffer, maximumBytes: number): Record<string, unknown> {
  if (bytes.byteLength > maximumBytes) throw new XlsxParserError("XLSX XML exceeds the supported size limit.");
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new XlsxParserError("XLSX XML is not valid UTF-8.");
  }
  if (xml.includes("\u0000") || /<!DOCTYPE|<!ENTITY/iu.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new XlsxParserError("XLSX contains invalid or unsupported XML.");
  }
  try {
    const parsed: unknown = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: false,
      maxNestedTags: 64,
    }).parse(xml);
    if (!isRecord(parsed)) throw new XlsxParserError();
    return parsed;
  } catch (error: unknown) {
    if (error instanceof XlsxParserError) throw error;
    throw new XlsxParserError("XLSX contains invalid or unsupported XML.");
  }
}

function childRecord(parent: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = parent[name];
  if (!isRecord(value)) throw new XlsxParserError("XLSX workbook structure is invalid.");
  return value;
}

function attribute(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

function boundedXmlText(value: unknown, maximum: number): string {
  if (typeof value === "string" && value.length <= maximum) return decodeXmlEntities(value, maximum);
  if (isRecord(value) && typeof value["#text"] === "string" && value["#text"].length <= maximum) {
    return decodeXmlEntities(value["#text"], maximum);
  }
  throw new XlsxParserError("XLSX text value is invalid or exceeds the supported limit.");
}

function decodeXmlEntities(value: string, maximum: number): string {
  const referencedEntities = value.match(/&[^;\s]*;/gu) ?? [];
  if (referencedEntities.some((entity) => !/^&(?:lt|gt|amp|apos|quot|#\d{1,7}|#x[0-9A-Fa-f]{1,6});$/u.test(entity))) {
    throw new XlsxParserError("XLSX contains an unsupported XML entity.");
  }
  let decoded = "";
  let cursor = 0;
  const entityPattern = /&(?:lt|gt|amp|apos|quot|#\d{1,7}|#x[0-9A-Fa-f]{1,6});/gu;
  for (const match of value.matchAll(entityPattern)) {
    const index = match.index;
    const token = match[0];
    decoded += value.slice(cursor, index);
    let replacement: string;
    if (token === "&lt;") replacement = "<";
    else if (token === "&gt;") replacement = ">";
    else if (token === "&amp;") replacement = "&";
    else if (token === "&apos;") replacement = "'";
    else if (token === "&quot;") replacement = '"';
    else {
      const hexadecimal = token.startsWith("&#x");
      const digits = token.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      const validXmlCharacter = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) || (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff);
      if (!validXmlCharacter) throw new XlsxParserError("XLSX contains an invalid XML character reference.");
      replacement = String.fromCodePoint(codePoint);
    }
    decoded += replacement;
    cursor = index + token.length;
    if (decoded.length > maximum) throw new XlsxParserError("XLSX text value exceeds the supported limit.");
  }
  decoded += value.slice(cursor);
  if (decoded.length > maximum) {
    throw new XlsxParserError("XLSX text value exceeds the supported limit.");
  }
  return decoded;
}

function textFromSimpleStringItem(value: unknown): string {
  if (!isRecord(value) || value["r"] !== undefined || value["phoneticPr"] !== undefined || value["rPh"] !== undefined) {
    throw new XlsxParserError("XLSX rich text is not supported.");
  }
  return boundedXmlText(value["t"], MAX_EXTRACTED_CHARACTERS);
}

function parseSharedStrings(bytes: Buffer | undefined): readonly string[] {
  if (bytes === undefined) return [];
  const root = childRecord(parseXml(bytes, MAX_ARCHIVE_ENTRY_BYTES), "sst");
  const items = nodes(root["si"]);
  if (items.length > MAX_SHARED_STRINGS) throw new XlsxParserError("XLSX shared-string count exceeds the supported limit.");
  const values: string[] = [];
  let totalCharacters = 0;
  for (const item of items) {
    const text = textFromSimpleStringItem(item);
    totalCharacters += text.length;
    if (totalCharacters > MAX_EXTRACTED_CHARACTERS) throw new XlsxParserError("Extracted XLSX text exceeds the supported limit.");
    values.push(text);
  }
  return values;
}

function isDateFormat(formatCode: string): boolean {
  const withoutLiterals = formatCode
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/"[^"]*"/gu, "")
    .replace(/\\./gu, "")
    .replace(/_.|\*./gu, "");
  return /[ymdhMsb]/u.test(withoutLiterals);
}

function parseDateStyleIndices(bytes: Buffer | undefined): readonly boolean[] {
  if (bytes === undefined) return [false];
  const styleSheet = childRecord(parseXml(bytes, MAX_ARCHIVE_ENTRY_BYTES), "styleSheet");
  const dateFormatIds = new Set(BUILTIN_DATE_FORMAT_IDS);
  const numFmts = styleSheet["numFmts"];
  if (numFmts !== undefined) {
    const numFmtRoot = childRecord(styleSheet, "numFmts");
    for (const node of nodes(numFmtRoot["numFmt"])) {
      if (!isRecord(node)) throw new XlsxParserError("XLSX number formats are invalid.");
      const id = attribute(node, "numFmtId");
      const code = attribute(node, "formatCode");
      if (id === undefined || !/^\d{1,5}$/u.test(id) || code === undefined) {
        throw new XlsxParserError("XLSX number formats are invalid.");
      }
      if (isDateFormat(decodeXmlEntities(code, MAX_EXTRACTED_CHARACTERS))) dateFormatIds.add(Number(id));
    }
  }
  const cellXfs = childRecord(styleSheet, "cellXfs");
  const styleNodes = nodes(cellXfs["xf"]);
  if (styleNodes.length < 1 || styleNodes.length > MAX_CELL_STYLES) {
    throw new XlsxParserError("XLSX cell style count exceeds the supported limit.");
  }
  return styleNodes.map((node) => {
    if (!isRecord(node)) throw new XlsxParserError("XLSX cell styles are invalid.");
    const id = attribute(node, "numFmtId") ?? "0";
    if (!/^\d{1,5}$/u.test(id)) throw new XlsxParserError("XLSX cell style is invalid.");
    return dateFormatIds.has(Number(id));
  });
}

function columnNumber(reference: string): { rowNumber: number; columnNumber: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,4})$/u.exec(reference);
  if (match === null) throw new XlsxParserError("XLSX cell reference is invalid.");
  const columnLabel = match[1];
  const rowLabel = match[2];
  if (columnLabel === undefined || rowLabel === undefined) throw new XlsxParserError();
  let column = 0;
  for (const character of columnLabel) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(rowLabel);
  if (column < 1 || column > MAX_WORKSHEET_COLUMNS || row < 1 || row > MAX_WORKSHEET_ROWS) {
    throw new XlsxParserError("XLSX worksheet dimensions exceed the supported limits.");
  }
  return { rowNumber: row, columnNumber: column };
}

function parseCellValue(
  cell: Record<string, unknown>,
  sharedStrings: readonly string[],
  dateStyleIndices: readonly boolean[],
  date1904: boolean,
): XlsxCellValue {
  if (cell["f"] !== undefined) throw new XlsxParserError("XLSX formula cells are not supported.");
  const type = attribute(cell, "t");
  const style = attribute(cell, "s") ?? "0";
  if (!/^\d{1,5}$/u.test(style) || Number(style) >= dateStyleIndices.length) {
    throw new XlsxParserError("XLSX cell style index is invalid.");
  }
  const isDate = dateStyleIndices[Number(style)] === true;
  if (type === "d") {
    const value = boundedXmlText(cell["v"], MAX_EXTRACTED_CHARACTERS);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new XlsxParserError("XLSX date cell value is invalid.");
    return date.toISOString();
  }
  if (type === "inlineStr") {
    const inline = childRecord(cell, "is");
    if (inline["r"] !== undefined || inline["rPh"] !== undefined) throw new XlsxParserError("XLSX rich text is not supported.");
    return boundedXmlText(inline["t"], MAX_EXTRACTED_CHARACTERS);
  }
  const valueNode = cell["v"];
  if (valueNode === undefined) return null;
  const value = boundedXmlText(valueNode, MAX_EXTRACTED_CHARACTERS);
  if (type === "s") {
    if (!/^(0|[1-9]\d{0,5})$/u.test(value)) throw new XlsxParserError("XLSX shared-string index is invalid.");
    const shared = sharedStrings[Number(value)];
    if (shared === undefined) throw new XlsxParserError("XLSX shared-string index is outside the workbook table.");
    return shared;
  }
  if (type === "b") {
    if (value === "0") return false;
    if (value === "1") return true;
    throw new XlsxParserError("XLSX boolean cell value is invalid.");
  }
  if (type === "str" || type === "n" || type === undefined) {
    if (type === "str") return value;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/u.test(value)) {
      throw new XlsxParserError("XLSX numeric cell value is invalid.");
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new XlsxParserError("XLSX cell contains a non-finite number.");
    if (isDate) {
      const milliseconds = Math.round((numeric - 25569 + (date1904 ? 1462 : 0)) * 24 * 60 * 60 * 1000);
      const date = new Date(milliseconds);
      if (Number.isNaN(date.getTime())) throw new XlsxParserError("XLSX date cell value is invalid.");
      return date.toISOString();
    }
    return numeric;
  }
  throw new XlsxParserError("XLSX formula and rich cell types are not supported.");
}

function resolveWorksheetPath(target: string): string {
  if (target.length === 0 || target.startsWith("/") || target.includes("\\") || target.includes(":") || target.includes("%")) {
    throw new XlsxParserError("XLSX worksheet relationship path is invalid.");
  }
  const resolved = path.normalize(path.join("xl", target));
  if (!resolved.startsWith("xl/worksheets/") || resolved.includes("../") || !/^xl\/worksheets\/[^/]+\.xml$/u.test(resolved)) {
    throw new XlsxParserError("XLSX worksheet relationship escapes the workbook directory.");
  }
  return resolved;
}

function workbookSheets(workbookXml: Buffer, relsXml: Buffer): { sheets: readonly { name: string; path: string }[]; date1904: boolean } {
  const workbook = childRecord(parseXml(workbookXml, MAX_ARCHIVE_ENTRY_BYTES), "workbook");
  const sheetsRoot = childRecord(workbook, "sheets");
  const sheetNodes = nodes(sheetsRoot["sheet"]);
  if (sheetNodes.length < 1 || sheetNodes.length > MAX_WORKBOOK_SHEETS) throw new XlsxParserError("XLSX sheet count exceeds the supported limit.");
  const relationships = childRecord(parseXml(relsXml, MAX_ARCHIVE_ENTRY_BYTES), "Relationships");
  const relationshipNodes = nodes(relationships["Relationship"]);
  const targets = new Map<string, string>();
  for (const node of relationshipNodes) {
    if (!isRecord(node)) throw new XlsxParserError();
    const id = attribute(node, "Id");
    const target = attribute(node, "Target");
    const type = attribute(node, "Type");
    if (type === undefined || !type.endsWith("/worksheet")) continue;
    if (id === undefined || target === undefined || attribute(node, "TargetMode") === "External" || targets.has(id)) {
      throw new XlsxParserError("XLSX workbook relationships are invalid.");
    }
    targets.set(id, resolveWorksheetPath(target));
  }
  const sheets: { name: string; path: string }[] = [];
  const names = new Set<string>();
  for (const node of sheetNodes) {
    if (!isRecord(node)) throw new XlsxParserError();
    const name = attribute(node, "name");
    const relationshipId = attribute(node, "r:id");
    const worksheetPath = relationshipId === undefined ? undefined : targets.get(relationshipId);
    if (name === undefined || name.length === 0 || name.length > 255 || names.has(name) || worksheetPath === undefined) {
      throw new XlsxParserError("XLSX worksheet metadata is invalid.");
    }
    names.add(name);
    sheets.push({ name, path: worksheetPath });
  }
  const properties = workbook["workbookPr"];
  const date1904 = isRecord(properties) && attribute(properties, "date1904") === "1";
  return { sheets, date1904 };
}

interface WorkbookParseBudget {
  totalCells: number;
  totalCharacters: number;
  totalOutputSlots: number;
}

function parseWorksheet(
  bytes: Buffer,
  sharedStrings: readonly string[],
  dateStyleIndices: readonly boolean[],
  date1904: boolean,
  budget: WorkbookParseBudget,
): XlsxExtractedSheet["rows"] {
  const worksheet = childRecord(parseXml(bytes, MAX_WORKSHEET_XML_BYTES), "worksheet");
  const dimension = worksheet["dimension"];
  if (dimension !== undefined) {
    if (!isRecord(dimension)) throw new XlsxParserError("XLSX worksheet dimension is invalid.");
    const reference = attribute(dimension, "ref");
    const range = reference === undefined ? null : /^([A-Z]{1,3}[1-9]\d{0,4})(?::([A-Z]{1,3}[1-9]\d{0,4}))?$/u.exec(reference);
    if (range === null) throw new XlsxParserError("XLSX worksheet dimension is invalid.");
    const first = columnNumber(range[1] ?? "");
    const last = columnNumber(range[2] ?? range[1] ?? "");
    if (last.rowNumber < first.rowNumber || last.columnNumber < first.columnNumber) {
      throw new XlsxParserError("XLSX worksheet dimension is inverted.");
    }
  }
  const sheetData = childRecord(worksheet, "sheetData");
  const rowNodes = nodes(sheetData["row"]);
  if (rowNodes.length > MAX_WORKSHEET_ROWS) throw new XlsxParserError("XLSX worksheet row count exceeds the supported limit.");
  const rows: XlsxExtractedRow[] = [];
  let previousRow = 0;
  for (const rowNode of rowNodes) {
    if (!isRecord(rowNode)) throw new XlsxParserError();
    const rowValue = attribute(rowNode, "r");
    if (rowValue === undefined || !/^[1-9]\d{0,4}$/u.test(rowValue)) throw new XlsxParserError("XLSX row reference is invalid.");
    const rowNumber = Number(rowValue);
    if (rowNumber > MAX_WORKSHEET_ROWS || rowNumber <= previousRow) throw new XlsxParserError("XLSX row ordering or dimensions are invalid.");
    previousRow = rowNumber;
    const values = new Map<number, XlsxCellValue>();
    let previousColumn = 0;
    for (const cellNode of nodes(rowNode["c"])) {
      if (!isRecord(cellNode)) throw new XlsxParserError();
      const reference = attribute(cellNode, "r");
      if (reference === undefined) throw new XlsxParserError("XLSX cell reference is missing.");
      const location = columnNumber(reference);
      if (location.rowNumber !== rowNumber || location.columnNumber <= previousColumn) {
        throw new XlsxParserError("XLSX cell ordering or row membership is invalid.");
      }
      previousColumn = location.columnNumber;
      budget.totalCells += 1;
      if (budget.totalCells > MAX_WORKBOOK_CELLS) throw new XlsxParserError("XLSX cell count exceeds the supported limit.");
      const value = parseCellValue(cellNode, sharedStrings, dateStyleIndices, date1904);
      if (typeof value === "string") {
        budget.totalCharacters += value.length;
        if (budget.totalCharacters > MAX_EXTRACTED_CHARACTERS) throw new XlsxParserError("Extracted XLSX text exceeds the supported limit.");
      }
      values.set(location.columnNumber, value);
    }
    const maxColumn = Math.max(0, ...values.keys());
    budget.totalOutputSlots += maxColumn;
    if (budget.totalOutputSlots > MAX_WORKBOOK_OUTPUT_SLOTS) {
      throw new XlsxParserError("Expanded XLSX row output exceeds the supported limit.");
    }
    rows.push({ rowNumber, cells: Array.from({ length: maxColumn }, (_unused, index) => values.get(index + 1) ?? null) });
  }
  return rows;
}

export async function parseXlsxText(value: unknown): Promise<XlsxTextResult> {
  if (!(value instanceof Uint8Array) || value.byteLength < 8 || value.byteLength > MAX_XLSX_BYTES) {
    throw new XlsxParserError("XLSX must be supplied as bounded Uint8Array data.");
  }
  try {
    const archive = await readXlsxArchive(Buffer.from(value));
    const workbookXml = archive.get("xl/workbook.xml");
    const relationshipsXml = archive.get("xl/_rels/workbook.xml.rels");
    if (workbookXml === undefined || relationshipsXml === undefined) throw new XlsxParserError();
    const sharedStrings = parseSharedStrings(archive.get("xl/sharedStrings.xml"));
    const dateStyleIndices = parseDateStyleIndices(archive.get("xl/styles.xml"));
    const budget: WorkbookParseBudget = { totalCells: 0, totalCharacters: 0, totalOutputSlots: 0 };
    const workbook = workbookSheets(workbookXml, relationshipsXml);
    const sheets = workbook.sheets.map(({ name, path: worksheetPath }) => {
      const worksheetXml = archive.get(worksheetPath);
      if (worksheetXml === undefined) throw new XlsxParserError("XLSX worksheet file is missing.");
      return { name, rows: parseWorksheet(worksheetXml, sharedStrings, dateStyleIndices, workbook.date1904, budget) };
    });
    return { sheets };
  } catch (error: unknown) {
    if (error instanceof XlsxParserError) throw error;
    throw new XlsxParserError();
  }
}
