import type { DocumentAnalysis } from "../workflows/document-analysis-workflow.js";

export type DocumentAnalysisExportFormat = "json" | "csv" | "markdown";

export class DocumentAnalysisExportError extends Error {
  constructor() {
    super("Document analysis export format or aggregate result is invalid.");
    this.name = "DocumentAnalysisExportError";
  }
}

const COUNT_FIELDS = ["byteCount", "characterCount", "wordCount", "lineCount", "headingCount", "pageCount", "sheetCount", "rowCount", "cellCount"] as const;

export function documentAnalysisExportFormat(pathValue: unknown): DocumentAnalysisExportFormat {
  if (typeof pathValue !== "string") throw new DocumentAnalysisExportError();
  const extension = pathValue.slice(pathValue.lastIndexOf(".")).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".csv") return "csv";
  if (extension === ".md") return "markdown";
  throw new DocumentAnalysisExportError();
}

export function renderDocumentAnalysisExport(analysis: DocumentAnalysis, format: DocumentAnalysisExportFormat): string {
  if (typeof analysis !== "object" || analysis === null || !["txt", "markdown", "pdf", "docx", "xlsx"].includes(analysis.format)) {
    throw new DocumentAnalysisExportError();
  }
  const metrics: Record<string, number> = {};
  for (const field of COUNT_FIELDS) {
    const count = analysis[field];
    if (count !== undefined) {
      if (!Number.isSafeInteger(count) || count < 0) throw new DocumentAnalysisExportError();
      metrics[field] = count;
    }
  }
  if (format === "json") return `${JSON.stringify({ workflow: "document-analyze", schemaVersion: 1, format: analysis.format, ...metrics }, null, 2)}\n`;
  const entries = Object.entries(metrics);
  if (format === "csv") return ["metric,value", `format,${analysis.format}`, ...entries.map(([key, value]) => `${key},${value}`), ""].join("\n");
  if (format === "markdown") return [
    "# Document Analysis Summary", "", "| Metric | Value |", "| --- | ---: |", `| Format | ${analysis.format} |`,
    ...entries.map(([key, value]) => `| ${key.replace(/[A-Z]/gu, (letter) => ` ${letter.toLowerCase()}`)} | ${value} |`), "",
    "This report contains aggregate counts only; document text, file paths, sheet names, and cell values are excluded.", "",
  ].join("\n");
  throw new DocumentAnalysisExportError();
}
