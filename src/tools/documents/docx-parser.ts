import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as yauzl from "yauzl";

const MAX_DOCX_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 1_000_000;

export class DocxParserError extends Error {
  constructor(message = "DOCX input is invalid or exceeds supported limits.") {
    super(message);
    this.name = "DocxParserError";
  }
}

function isSafeEntryName(name: string): boolean {
  return name.length > 0 && !name.startsWith("/") && !name.includes("\\") &&
    !name.split("/").some((part) => part === ".." || part === ".");
}

async function readEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry, retain: boolean): Promise<Buffer | undefined> {
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > entry.uncompressedSize || size > MAX_ARCHIVE_ENTRY_BYTES) {
      stream.destroy();
      throw new DocxParserError("DOCX archive entry expanded beyond its declared size.");
    }
    if (retain) {
      chunks.push(bytes);
    }
  }
  if (size !== entry.uncompressedSize) {
    throw new DocxParserError("DOCX archive entry size did not match its contents.");
  }
  return retain ? Buffer.concat(chunks, size) : undefined;
}

async function readDocumentXml(input: Buffer): Promise<Buffer> {
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.fromBufferPromise(input, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount < 1 || zipFile.entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new DocxParserError("DOCX archive contains too many entries.");
    }
    const names = new Set<string>();
    let expandedBytes = 0;
    let documentXml: Buffer | undefined;
    for await (const entry of zipFile.eachEntry()) {
      if (
        !isSafeEntryName(entry.fileName) || names.has(entry.fileName) || entry.isEncrypted() ||
        !entry.canDecodeFileData() || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
        !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
        entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES
      ) {
        throw new DocxParserError("DOCX archive contains an unsupported or oversized entry.");
      }
      if (entry.fileName === "word/document.xml" && entry.uncompressedSize > MAX_DOCUMENT_XML_BYTES) {
        throw new DocxParserError("DOCX document XML exceeds the supported size limit.");
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new DocxParserError("DOCX expanded archive exceeds the supported size limit.");
      }
      names.add(entry.fileName);
      const contents = await readEntry(zipFile, entry, entry.fileName === "word/document.xml");
      if (entry.fileName === "word/document.xml") {
        documentXml = contents;
      }
    }
    if (
      !names.has("[Content_Types].xml") || !names.has("word/document.xml") ||
      names.has("word/vbaProject.bin") || documentXml === undefined
    ) {
      throw new DocxParserError("Input is not a supported DOCX document.");
    }
    return documentXml;
  } catch (error: unknown) {
    if (error instanceof DocxParserError) {
      throw error;
    }
    throw new DocxParserError();
  } finally {
    zipFile?.close();
  }
}

function decodeXmlText(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/giu, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const hex = entity.startsWith("&#x") || entity.startsWith("&#X");
    const digits = entity.slice(hex ? 3 : 2, -1);
    const point = Number.parseInt(digits, hex ? 16 : 10);
    if (!Number.isInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      throw new DocxParserError("DOCX document contains an invalid character reference.");
    }
    return String.fromCodePoint(point);
  });
}

function localTagName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function extractText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const child of value) extractText(child, output);
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    const tag = localTagName(name);
    if (tag === "t") {
      const textValues = Array.isArray(child) ? child : [child];
      for (const textValue of textValues) {
        if (typeof textValue === "object" && textValue !== null && "#text" in textValue && typeof textValue["#text"] === "string") {
          output.push(decodeXmlText(textValue["#text"]));
        }
      }
    } else if (tag === "tab") {
      output.push("\t");
    } else if (tag === "br" || tag === "cr" || tag === "p") {
      extractText(child, output);
      output.push("\n");
    } else {
      extractText(child, output);
    }
  }
}

export async function parseDocxText(value: unknown): Promise<string> {
  if (!(value instanceof Uint8Array) || value.byteLength < 8 || value.byteLength > MAX_DOCX_BYTES) {
    throw new DocxParserError("DOCX must be supplied as bounded Uint8Array data.");
  }
  const xmlBytes = await readDocumentXml(Buffer.from(value));
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes);
  } catch {
    throw new DocxParserError("DOCX document XML must be valid UTF-8.");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new DocxParserError("DOCX document XML is malformed or uses unsupported declarations.");
  }
  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: true,
      processEntities: false,
      maxNestedTags: 64,
    });
    const output: string[] = [];
    extractText(parser.parse(xml), output);
    const text = output.join("");
    if (text.length > MAX_EXTRACTED_CHARACTERS) {
      throw new DocxParserError("Extracted DOCX text exceeds the supported size limit.");
    }
    return text;
  } catch (error: unknown) {
    if (error instanceof DocxParserError) {
      throw error;
    }
    throw new DocxParserError();
  }
}
