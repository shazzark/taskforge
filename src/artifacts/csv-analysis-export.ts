import type { CsvAnalysisResult } from "../tools/data/csv-analysis.js";

export type CsvAnalysisExportFormat = "json" | "csv" | "markdown";

export class CsvAnalysisExportError extends Error {
  constructor() {
    super("CSV analysis export format or aggregate result is invalid.");
    this.name = "CsvAnalysisExportError";
  }
}

function missingCellCount(analysis: CsvAnalysisResult): number {
  const counts = Object.values(analysis.missingValues);
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) throw new CsvAnalysisExportError();
  return counts.reduce((total, count) => total + count, 0);
}

function numericTotals(analysis: CsvAnalysisResult): readonly (readonly [string, string])[] {
  const entries = Object.entries(analysis.numericTotals);
  if (entries.some(([column, total]) => !analysis.headers.includes(column) || column.length === 0 || column.length > 256 ||
      typeof total !== "string" || total.length > 256 || !/^-?\d+(?:\.\d+)?$/u.test(total))) {
    throw new CsvAnalysisExportError();
  }
  return entries;
}

function csvCell(value: string, label: boolean): string {
  const protectedValue = label && /^[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function markdownCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/[\r\n\u0000-\u001f\u007f]/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([`*_{}\[\]()#+.!-])/gu, "\\$1");
}

export function csvAnalysisExportFormat(pathValue: unknown): CsvAnalysisExportFormat {
  if (typeof pathValue !== "string") throw new CsvAnalysisExportError();
  const extension = pathValue.slice(pathValue.lastIndexOf(".")).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".csv") return "csv";
  if (extension === ".md") return "markdown";
  throw new CsvAnalysisExportError();
}

export function renderCsvAnalysisExport(analysis: CsvAnalysisResult, format: CsvAnalysisExportFormat): string {
  if (!Number.isSafeInteger(analysis.rowCount) || analysis.rowCount < 0 ||
      !Number.isSafeInteger(analysis.duplicateRowCount) || analysis.duplicateRowCount < 0 ||
      analysis.duplicateRowCount > analysis.rowCount) {
    throw new CsvAnalysisExportError();
  }
  const metrics = {
    rows: analysis.rowCount,
    duplicateRows: analysis.duplicateRowCount,
    missingCells: missingCellCount(analysis),
  };
  const totals = numericTotals(analysis);
  if (format === "json") return `${JSON.stringify({ workflow: "csv-analyze", schemaVersion: 1, ...metrics, ...(totals.length === 0 ? {} : { numericTotals: Object.fromEntries(totals) }) }, null, 2)}\n`;
  if (format === "csv") return [
    "metric,value",
    `rows,${metrics.rows}`,
    `duplicate_rows,${metrics.duplicateRows}`,
    `missing_cells,${metrics.missingCells}`,
    ...totals.map(([column, total]) => `${csvCell(`numeric_total:${column}`, true)},${total}`),
    "",
  ].join("\n");
  if (format === "markdown") {
    return [
      "# CSV Analysis Summary",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      `| Rows | ${metrics.rows} |`,
      `| Duplicate rows | ${metrics.duplicateRows} |`,
      `| Missing cells | ${metrics.missingCells} |`,
      ...totals.map(([column, total]) => `| Numeric total: ${markdownCell(column)} | ${total} |`),
      "",
      "This report contains aggregate counts and only explicitly selected column labels and totals; source cell values are excluded.",
      "",
    ].join("\n");
  }
  throw new CsvAnalysisExportError();
}
