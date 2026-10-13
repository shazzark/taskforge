import type { CsvAnalysisResult } from "../data/csv-analysis.js";

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
  if (format === "json") return `${JSON.stringify({ workflow: "csv-analyze", schemaVersion: 1, ...metrics }, null, 2)}\n`;
  if (format === "csv") return `metric,value\nrows,${metrics.rows}\nduplicate_rows,${metrics.duplicateRows}\nmissing_cells,${metrics.missingCells}\n`;
  if (format === "markdown") {
    return [
      "# CSV Analysis Summary",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      `| Rows | ${metrics.rows} |`,
      `| Duplicate rows | ${metrics.duplicateRows} |`,
      `| Missing cells | ${metrics.missingCells} |`,
      "",
      "This report contains aggregate counts only; source headers and cell values are excluded.",
      "",
    ].join("\n");
  }
  throw new CsvAnalysisExportError();
}
