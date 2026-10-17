import PDFDocument from "pdfkit";

const MAX_REPORT_SECTIONS = 50;
const MAX_REPORT_CHARACTERS = 100_000;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const SUPPORTED_PDF_TEXT = /^[\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]*$/u;

export interface PdfReportSection {
  readonly heading: string;
  readonly body: string;
}

export interface PdfReportInput {
  readonly title: string;
  readonly createdAt: string;
  readonly sections: readonly PdfReportSection[];
}

export class PdfReportError extends Error {
  constructor(message = "PDF report input or rendering is invalid.") {
    super(message);
    this.name = "PdfReportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePdfReportInput(value: unknown): PdfReportInput {
  if (!isRecord(value)) {
    throw new PdfReportError("PDF report must be an object.");
  }
  const title = value["title"];
  const createdAt = value["createdAt"];
  const sectionValues = value["sections"];
  if (
    typeof title !== "string" || title.trim().length === 0 || title.length > 200 ||
    typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) ||
    !Array.isArray(sectionValues) || sectionValues.length > MAX_REPORT_SECTIONS
  ) {
    throw new PdfReportError("PDF report fields are missing or exceed supported limits.");
  }
  const sections: PdfReportSection[] = [];
  let totalCharacters = title.length;
  for (const sectionValue of sectionValues) {
    if (!isRecord(sectionValue)) {
      throw new PdfReportError("PDF report section is invalid.");
    }
    const heading = sectionValue["heading"];
    const body = sectionValue["body"];
    if (
      typeof heading !== "string" || heading.trim().length === 0 || heading.length > 200 ||
      typeof body !== "string" || body.length > MAX_REPORT_CHARACTERS
    ) {
      throw new PdfReportError("PDF report section is invalid or exceeds supported limits.");
    }
    if (!SUPPORTED_PDF_TEXT.test(heading) || !SUPPORTED_PDF_TEXT.test(body)) {
      throw new PdfReportError("PDF report contains characters unsupported by the bundled standard font.");
    }
    totalCharacters += heading.length + body.length;
    if (totalCharacters > MAX_REPORT_CHARACTERS) {
      throw new PdfReportError("PDF report exceeds the supported text limit.");
    }
    sections.push({ heading, body });
  }
  if (!SUPPORTED_PDF_TEXT.test(title)) {
    throw new PdfReportError("PDF report contains characters unsupported by the bundled standard font.");
  }
  return { title, createdAt, sections };
}

export async function renderPdfReport(value: unknown): Promise<Uint8Array> {
  const report = parsePdfReportInput(value);
  const document = new PDFDocument({
    autoFirstPage: true,
    compress: true,
    margin: 54,
    info: {
      Title: report.title,
      Author: "TaskForge",
      Producer: "TaskForge PDF report adapter",
      CreationDate: new Date(report.createdAt),
    },
  });
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    document.on("data", (chunk: Buffer | string) => {
      if (typeof chunk === "string") {
        settled = true;
        document.destroy();
        reject(new PdfReportError());
        return;
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_PDF_BYTES) {
        settled = true;
        document.destroy();
        reject(new PdfReportError("Generated PDF exceeds the supported output size."));
        return;
      }
      chunks.push(chunk);
    });
    document.once("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      const output = Buffer.concat(chunks);
      if (!output.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        reject(new PdfReportError());
        return;
      }
      resolve(output);
    });
    document.once("error", () => {
      if (!settled) {
        settled = true;
        reject(new PdfReportError());
      }
    });

    try {
      document.fontSize(20).text(report.title, { continued: false });
      document.moveDown(0.5);
      document.fontSize(9).fillColor("#555555").text(`Generated: ${report.createdAt}`);
      for (const section of report.sections) {
        document.moveDown(1);
        document.fillColor("#111111").fontSize(13).text(section.heading);
        document.moveDown(0.25);
        document.fillColor("#222222").fontSize(10).text(section.body, { lineGap: 2 });
      }
      document.end();
    } catch {
      if (!settled) {
        settled = true;
        document.destroy();
        reject(new PdfReportError());
      }
    }
  });
}
