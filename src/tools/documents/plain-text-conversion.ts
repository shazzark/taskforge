import { parseDocxText } from "./docx-parser.js";
import { parsePdfText } from "./pdf-text-parser.js";
import { parseTextDocument } from "./text-parser.js";
import { parseXlsxText, type XlsxCellValue } from "./xlsx-parser.js";

const MAX_CONVERTED_BYTES = 64 * 1024;

export class DocumentConversionError extends Error {
  constructor(message = "The document cannot be converted within the supported text limits.") {
    super(message);
    this.name = "DocumentConversionError";
  }
}

function escapeCell(value: XlsxCellValue): string {
  if (value === null) return "";
  return String(value).replace(/[\\\t\r\n\u0000-\u001f\u007f]/gu, (character) => {
    if (character === "\\") return "\\\\";
    if (character === "\t") return "\\t";
    if (character === "\r") return "\\r";
    if (character === "\n") return "\\n";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

export async function convertDocumentToPlainText(extensionValue: unknown, input: unknown): Promise<string> {
  if (typeof extensionValue !== "string" || !(input instanceof Uint8Array)) throw new DocumentConversionError();
  let output: string;
  if (extensionValue === ".txt" || extensionValue === ".md" || extensionValue === ".markdown") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new DocumentConversionError("Text conversion requires valid UTF-8 input.");
    }
    output = parseTextDocument(text, extensionValue === ".txt" ? "txt" : "markdown").text;
  } else if (extensionValue === ".pdf") {
    output = (await parsePdfText(input)).text;
  } else if (extensionValue === ".docx") {
    output = await parseDocxText(input);
  } else if (extensionValue === ".xlsx") {
    const workbook = await parseXlsxText(input);
    output = workbook.sheets.map((sheet) => [
      `# ${escapeCell(sheet.name)}`,
      ...sheet.rows.map((row) => `${row.rowNumber}\t${row.cells.map(escapeCell).join("\t")}`),
    ].join("\n")).join("\n\n");
  } else {
    throw new DocumentConversionError("Supported sources are TXT, Markdown, text PDF, DOCX, and XLSX.");
  }
  if (output.length === 0 || Buffer.byteLength(output, "utf8") > MAX_CONVERTED_BYTES) {
    throw new DocumentConversionError("Converted text must be non-empty and no larger than 64 KiB.");
  }
  return output;
}
