const MAX_TEXT_DOCUMENT_BYTES = 8 * 1024 * 1024;

export type TextDocumentFormat = "txt" | "markdown";

export interface MarkdownHeading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface ParsedTextDocument {
  readonly format: TextDocumentFormat;
  readonly text: string;
  readonly lineCount: number;
  readonly wordCount: number;
  readonly headings: readonly MarkdownHeading[];
}

export class TextDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextDocumentError";
  }
}

function parseMarkdownHeadings(text: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = text.split("\n");
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "";
      const nextCharacter = marker[0];
      if (nextCharacter !== "`" && nextCharacter !== "~") {
        continue;
      }
      if (fenceCharacter === undefined) {
        fenceCharacter = nextCharacter;
        fenceLength = marker.length;
      } else if (nextCharacter === fenceCharacter && marker.length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter !== undefined) {
      continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)\s*#*\s*$/u.exec(line);
    if (heading !== null) {
      const hashes = heading[1] ?? "";
      const headingText = (heading[2] ?? "").trim();
      if (headingText.length > 0) {
        headings.push({ level: hashes.length, text: headingText, line: index + 1 });
      }
    }
  }
  return headings;
}

export function parseTextDocument(input: unknown, format: TextDocumentFormat): ParsedTextDocument {
  if (typeof input !== "string") {
    throw new TextDocumentError("Document input must be text.");
  }
  if (format !== "txt" && format !== "markdown") {
    throw new TextDocumentError("This text parser supports only TXT and Markdown.");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_TEXT_DOCUMENT_BYTES) {
    throw new TextDocumentError("Document exceeds the supported input size.");
  }
  if (input.includes("\u0000")) {
    throw new TextDocumentError("Document contains a NUL byte and may be binary.");
  }
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const text = withoutBom.replace(/\r\n?/gu, "\n");
  const lineCount = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const wordCount = (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const headings = format === "markdown" ? parseMarkdownHeadings(text) : [];
  return { format, text, lineCount, wordCount, headings };
}
