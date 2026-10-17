import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_CHARACTERS = 1_000_000;

export interface PdfTextResult {
  readonly pageCount: number;
  readonly text: string;
}

export class PdfTextParserError extends Error {
  constructor(message = "PDF input is invalid or exceeds supported limits.") {
    super(message);
    this.name = "PdfTextParserError";
  }
}

function isTextItem(value: unknown): value is { readonly str: string } {
  return typeof value === "object" && value !== null && "str" in value && typeof value.str === "string";
}

export async function parsePdfText(value: unknown): Promise<PdfTextResult> {
  if (!(value instanceof Uint8Array) || value.byteLength < 8 || value.byteLength > MAX_PDF_BYTES) {
    throw new PdfTextParserError("PDF must be supplied as a Uint8Array within the supported size limit.");
  }
  if (Buffer.from(value.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new PdfTextParserError("Input does not have a supported PDF header.");
  }

  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(value),
      disableFontFace: true,
      stopAtErrors: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > MAX_PDF_PAGES) {
      throw new PdfTextParserError("PDF page count exceeds the supported limit.");
    }

    const pages: string[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        });
        const pageText: string[] = [];
        for (const item of content.items) {
          if (!isTextItem(item)) {
            continue;
          }
          characterCount += item.str.length;
          if (characterCount > MAX_EXTRACTED_CHARACTERS) {
            throw new PdfTextParserError("Extracted PDF text exceeds the supported limit.");
          }
          pageText.push(item.str);
        }
        pages.push(pageText.join(" "));
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: document.numPages, text: pages.join("\n\n") };
  } catch (error) {
    if (error instanceof PdfTextParserError) {
      throw error;
    }
    throw new PdfTextParserError();
  } finally {
    if (loadingTask !== undefined) {
      try {
        await loadingTask.destroy();
      } catch {
        // Cleanup errors must not expose parser internals or replace the result.
      }
    }
  }
}
