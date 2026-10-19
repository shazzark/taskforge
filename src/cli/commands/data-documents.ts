import { randomUUID } from "node:crypto";
import { basename, dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { CsvWorkflowCancelledError, CsvWorkflowError, resumeCsvAnalysisWorkflow, runCsvAnalysisWorkflow, type CsvWorkflowResult } from "../../workflows/csv-analysis-workflow.js";
import { analyzeDocument, DocumentWorkflowCancelledError, DocumentWorkflowError, resumeDocumentAnalysisWorkflow } from "../../workflows/document-analysis-workflow.js";
import { csvAnalysisExportFormat, CsvAnalysisExportError, renderCsvAnalysisExport, type CsvAnalysisExportFormat } from "../../tools/artifacts/csv-analysis-export.js";
import { documentAnalysisExportFormat, DocumentAnalysisExportError, renderDocumentAnalysisExport, type DocumentAnalysisExportFormat } from "../../tools/artifacts/document-analysis-export.js";
import { convertDocumentToPlainText, DocumentConversionError } from "../../tools/documents/plain-text-conversion.js";
import { ActionApprovalRegistry } from "../../security/approval-preview.js";
import { previewPlainTextArtifact, writeApprovedTextArtifact, DraftArtifactError } from "../../tools/artifacts/drafts.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";
import { DatabasePersistenceError, PersistenceInputError, type ArtifactType } from "../../storage/types.js";
import type { TaskForgeStore } from "../../storage/store.js";
import { WorkspacePathPolicy } from "../../security/path-policy.js";
import { PersistentFolderApprovalError } from "../command-errors.js";

export interface DataDocumentCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
  readonly readApprovedInputFile: (pathValue: string, signal?: AbortSignal) => Promise<Uint8Array | undefined>;
  readonly requirePersistentFolderApproval: (pathValue: string, access: "read" | "write") => Promise<void>;
  readonly registerInterrupt?: (handler: () => void) => () => void;
}

function registerInterrupt(dependencies: DataDocumentCommandDependencies, controller: AbortController): () => void {
  const handler = (): void => controller.abort();
  if (dependencies.registerInterrupt !== undefined) return dependencies.registerInterrupt(handler);
  process.once("SIGINT", handler);
  return () => process.removeListener("SIGINT", handler);
}

interface ParsedCsvCommandArguments {
  readonly inputPath: string;
  readonly outputPath?: string;
  readonly numericColumns: readonly string[];
}

function parseCsvCommandArguments(commandArgs: readonly string[]): ParsedCsvCommandArguments | undefined {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  const numericColumns: string[] = [];
  for (let index = 0; index < commandArgs.length; index += 2) {
    const option = commandArgs[index];
    const value = commandArgs[index + 1];
    if (value === undefined || value.trim().length === 0) return undefined;
    if (option === "--input" && inputPath === undefined) inputPath = value;
    else if (option === "--output" && outputPath === undefined) outputPath = value;
    else if (option === "--numeric-column" && value.length <= 256) numericColumns.push(value);
    else return undefined;
  }
  if (inputPath === undefined || new Set(numericColumns).size !== numericColumns.length) return undefined;
  return { inputPath, ...(outputPath === undefined ? {} : { outputPath }), numericColumns };
}

async function runCsvWorkflowCommandInner(commandArgs: readonly string[], dependencies: DataDocumentCommandDependencies, signal: AbortSignal, stopListening: () => void): Promise<void> {
  const parsed = parseCsvCommandArguments(commandArgs);
  if (parsed === undefined) {
    process.stderr.write("Expected --input <path> [--numeric-column <header>]... [--output <new.json|new.csv|new.md>].\n");
    process.exitCode = 1;
    return;
  }
  const { inputPath, outputPath, numericColumns } = parsed;
  let exportFormat: CsvAnalysisExportFormat | undefined;
  if (outputPath !== undefined) {
    try {
      exportFormat = csvAnalysisExportFormat(outputPath);
    } catch (error: unknown) {
      process.stderr.write(`${error instanceof CsvAnalysisExportError ? error.message : "CSV export path was rejected."}\n`);
      process.exitCode = 1;
      return;
    }
  }
  const input = await dependencies.readApprovedInputFile(inputPath, signal);
  if (input === undefined) {
    if (signal.aborted) process.exitCode = 130;
    return;
  }
  let result: CsvWorkflowResult | undefined;
  try {
    result = await dependencies.withStore((store) => runCsvAnalysisWorkflow(store, input, undefined, numericColumns, signal));
    stopListening();
  } catch (error: unknown) {
    if (error instanceof CsvWorkflowCancelledError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 130;
      return;
    }
    process.stderr.write(error instanceof CsvWorkflowError ? `CSV workflow failed: ${error.message}\n` : "CSV workflow failed; run state was preserved where possible.\n");
    process.exitCode = 3;
    return;
  }
  if (result === undefined) return;
  const totals = Object.entries(result.analysis.numericTotals).map(([column, total]) => `${escapeTerminalControls(column)}=${total}`);
  process.stdout.write(`Run ${result.run.runId} ${result.resumed ? "resumed" : "completed"}: ${result.analysis.rowCount} rows, ${result.analysis.duplicateRowCount} duplicate rows.\n`);
  if (totals.length > 0) process.stdout.write(`Numeric totals: ${totals.join(", ")}\n`);
  if (outputPath === undefined || exportFormat === undefined) return;
  let createdArtifact: { readonly path: string; readonly byteCount: number; readonly sha256: string } | undefined;
  try {
    const requestedOutput = resolve(outputPath);
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await dependencies.requirePersistentFolderApproval(outputRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const content = renderCsvAnalysisExport(result.analysis, exportFormat);
    const pending = await previewPlainTextArtifact(content, requestedOutput, outputRoot, policy, approvals);
    process.stdout.write(`\n--- CSV AGGREGATE EXPORT PREVIEW ---\n${escapeTerminalControls(pending.content)}\n`);
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(`Create this new ${exportFormat} aggregate report?\nPath: ${escapeTerminalControls(pending.preview.targetPath)}\nBytes: ${Buffer.byteLength(pending.content, "utf8")}\nSHA-256: ${pending.digest}\nUnselected headers and source cell values are excluded; selected column labels and totals are included. [y/N] `);
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      approvals.discard(pending.preview.previewId);
      process.stdout.write("CSV analysis completed; export cancelled before writing.\n");
      return;
    }
    const written = await writeApprovedTextArtifact(pending, approvals.approve(pending.preview.previewId), outputRoot, policy, approvals);
    createdArtifact = written;
    const artifactType: ArtifactType = exportFormat === "json" ? "csv-analysis-json" : exportFormat === "csv" ? "csv-analysis-csv" : "csv-analysis-markdown";
    const references = await dependencies.withStore((store) => store.saveArtifactReference({
      artifactId: randomUUID(),
      runId: result.run.runId,
      relativePath: basename(written.path),
      type: artifactType,
      sha256: written.sha256,
      bytes: written.byteCount,
    }));
    if (references === undefined) {
      process.stderr.write(`Aggregate report was created at ${escapeTerminalControls(written.path)}, but its database reference could not be saved.\n`);
      process.exitCode = 3;
      return;
    }
    process.stdout.write(`Aggregate report created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
  } catch (error: unknown) {
    if (createdArtifact !== undefined) {
      process.stderr.write(`Aggregate report exists at ${escapeTerminalControls(createdArtifact.path)}, but its database reference could not be saved.\n`);
      process.exitCode = 3;
      return;
    }
    const detail = error instanceof CsvAnalysisExportError || error instanceof DraftArtifactError || error instanceof PersistentFolderApprovalError || error instanceof PersistenceInputError || error instanceof DatabasePersistenceError
      ? error.message
      : "the aggregate report could not be created safely";
    process.stderr.write(`CSV export failed: ${detail}\n`);
    process.exitCode = 3;
  }
}

export async function runCsvWorkflowCommand(commandArgs: readonly string[], dependencies: DataDocumentCommandDependencies): Promise<void> {
  const controller = new AbortController();
  const removeInterrupt = registerInterrupt(dependencies, controller);
  try {
    await runCsvWorkflowCommandInner(commandArgs, dependencies, controller.signal, removeInterrupt);
  } finally {
    removeInterrupt();
  }
}

export async function resumeWorkflowCommand(runId: string, commandArgs: readonly string[], dependencies: DataDocumentCommandDependencies): Promise<void> {
  const inputPath = commandArgs.length >= 2 && commandArgs[0] === "--input" ? commandArgs[1] : undefined;
  const numericColumns: string[] = [];
  for (let index = 2; index < commandArgs.length; index += 2) {
    if (commandArgs[index] !== "--numeric-column" || commandArgs[index + 1] === undefined || commandArgs[index + 1]?.trim().length === 0 || (commandArgs[index + 1]?.length ?? 257) > 256) {
      process.stderr.write("Expected --input <path> [--numeric-column <header>]...\n");
      process.exitCode = 1;
      return;
    }
    numericColumns.push(commandArgs[index + 1] ?? "");
  }
  if (inputPath === undefined || inputPath.trim().length === 0 || new Set(numericColumns).size !== numericColumns.length) {
    process.stderr.write("Expected --input <path> [--numeric-column <header>]...\n");
    process.exitCode = 1;
    return;
  }
  const input = await dependencies.readApprovedInputFile(inputPath);
  if (input === undefined) return;
  try {
    const result = await dependencies.withStore(async (store) => {
      const existing = await store.getRunSummary(runId);
      if (existing?.workflowId === "csv-analyze") {
        return { kind: "csv" as const, value: await resumeCsvAnalysisWorkflow(store, runId, input, numericColumns) };
      }
      if (existing?.workflowId === "document-analyze") {
        if (numericColumns.length > 0) throw new Error("Numeric column options apply only to CSV runs.");
        return {
          kind: "document" as const,
          value: await resumeDocumentAnalysisWorkflow(store, runId, extname(inputPath).toLowerCase(), input),
        };
      }
      throw new Error("This run type cannot be resumed by the current CLI.");
    });
    if (result === undefined) return;
    if (result.kind === "csv") {
      const analysis = result.value.analysis;
      const totals = Object.entries(analysis.numericTotals).map(([column, total]) => `${column}=${total}`);
      process.stdout.write(`Run ${result.value.run.runId} resumed: ${analysis.rowCount} rows, ${analysis.duplicateRowCount} duplicate rows.\n`);
      if (totals.length > 0) process.stdout.write(`Numeric totals: ${totals.join(", ")}\n`);
    } else {
      const analysis = result.value.analysis;
      process.stdout.write(`Run ${result.value.run.runId} resumed: ${analysis.format}, ${analysis.byteCount} bytes, ${analysis.wordCount} words.\n`);
    }
  } catch (error: unknown) {
    const message = error instanceof CsvWorkflowError || error instanceof DocumentWorkflowError
      ? error.message
      : "Resume failed; run state was preserved where possible.";
    process.stderr.write(`Resume failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runDocumentAnalysisCommandInner(commandArgs: readonly string[], dependencies: DataDocumentCommandDependencies, signal: AbortSignal, stopListening: () => void): Promise<void> {
  const parsed = parseCsvCommandArguments(commandArgs);
  if (parsed === undefined || parsed.numericColumns.length > 0) {
    process.stderr.write("Expected --input <path> [--output <new.json|new.csv|new.md>].\n");
    process.exitCode = 1;
    return;
  }
  const { inputPath, outputPath } = parsed;
  let exportFormat: DocumentAnalysisExportFormat | undefined;
  if (outputPath !== undefined) {
    try {
      exportFormat = documentAnalysisExportFormat(outputPath);
    } catch (error: unknown) {
      process.stderr.write(`${error instanceof DocumentAnalysisExportError ? error.message : "Document export path was rejected."}\n`);
      process.exitCode = 1;
      return;
    }
  }
  const input = await dependencies.readApprovedInputFile(inputPath, signal);
  if (input === undefined) {
    if (signal.aborted) process.exitCode = 130;
    return;
  }
  let createdArtifact: { readonly path: string; readonly byteCount: number; readonly sha256: string } | undefined;
  let attemptedOutputPath: string | undefined;
  try {
    const extension = extname(inputPath).toLowerCase();
    const result = await dependencies.withStore((store) => analyzeDocument(store, extension, input, undefined, signal));
    stopListening();
    if (result !== undefined) {
      const analysis = result.analysis;
      process.stdout.write(
        `Run ${result.run.runId} completed: ${analysis.format}, ${analysis.byteCount} bytes, ` +
        `${analysis.wordCount} words, ${analysis.lineCount} lines` +
        (analysis.pageCount === undefined ? "" : `, ${analysis.pageCount} pages`) +
        (analysis.sheetCount === undefined ? "" : `, ${analysis.sheetCount} sheets, ${analysis.rowCount ?? 0} rows, ${analysis.cellCount ?? 0} cells`) +
        `.\n`,
      );
      if (outputPath !== undefined && exportFormat !== undefined) {
        const content = renderDocumentAnalysisExport(analysis, exportFormat);
        const requestedOutput = resolve(outputPath);
        const policy = new WorkspacePathPolicy();
        const outputRoot = await policy.approveRoot(dirname(requestedOutput));
        await dependencies.requirePersistentFolderApproval(outputRoot.path, "write");
        const approvals = new ActionApprovalRegistry(policy);
        const pending = await previewPlainTextArtifact(content, requestedOutput, outputRoot, policy, approvals);
        process.stdout.write(`\n--- DOCUMENT AGGREGATE EXPORT PREVIEW ---\n${escapeTerminalControls(pending.content)}\n`);
        const consent = createInterface({ input: process.stdin, output: process.stdout });
        let answer: string;
        try {
          answer = await consent.question(`Create this new ${exportFormat} aggregate report?\nPath: ${escapeTerminalControls(pending.preview.targetPath)}\nBytes: ${Buffer.byteLength(content, "utf8")}\nSHA-256: ${pending.digest}\nDocument text, file paths, sheet names, and cell values are excluded. [y/N] `);
        } finally { consent.close(); }
        if (answer.trim().toLowerCase() !== "y") {
          approvals.discard(pending.preview.previewId);
          process.stdout.write("Document analysis completed; aggregate export cancelled before writing.\n");
          return;
        }
        attemptedOutputPath = pending.preview.targetPath;
        const written = await writeApprovedTextArtifact(pending, approvals.approve(pending.preview.previewId), outputRoot, policy, approvals);
        createdArtifact = written;
        const artifactType: ArtifactType = exportFormat === "json" ? "document-analysis-json" : exportFormat === "csv" ? "document-analysis-csv" : "document-analysis-markdown";
        const reference = await dependencies.withStore((store) => store.saveArtifactReference({
          artifactId: randomUUID(), runId: result.run.runId, relativePath: basename(written.path), type: artifactType,
          sha256: written.sha256, bytes: written.byteCount,
        }));
        if (reference === undefined) {
          process.stderr.write(`Aggregate report was created at ${escapeTerminalControls(written.path)}, but its database reference could not be saved.\n`);
          process.exitCode = 3;
          return;
        }
        process.stdout.write(`Document aggregate report created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
      }
    }
  } catch (error: unknown) {
    if (error instanceof DocumentWorkflowCancelledError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 130;
      return;
    }
    if (createdArtifact !== undefined) {
      process.stderr.write(`Aggregate report exists at ${escapeTerminalControls(createdArtifact.path)}, but its database reference could not be saved.\n`);
      process.exitCode = 3;
      return;
    }
    if (attemptedOutputPath !== undefined) {
      process.stderr.write(`Document aggregate report writing or verification failed. Check whether a file exists at ${escapeTerminalControls(attemptedOutputPath)} before retrying; existing files are never replaced.\n`);
      process.exitCode = 3;
      return;
    }
    const message = error instanceof DocumentWorkflowError || error instanceof DocumentAnalysisExportError || error instanceof DraftArtifactError || error instanceof PersistentFolderApprovalError || error instanceof DatabasePersistenceError || error instanceof PersistenceInputError
      ? error.message : "Document analysis failed safely.";
    process.stderr.write(`Document analysis failed: ${message}\n`);
    process.exitCode = 3;
  }
}

export async function runDocumentAnalysisCommand(commandArgs: readonly string[], dependencies: DataDocumentCommandDependencies): Promise<void> {
  const controller = new AbortController();
  const removeInterrupt = registerInterrupt(dependencies, controller);
  try {
    await runDocumentAnalysisCommandInner(commandArgs, dependencies, controller.signal, removeInterrupt);
  } finally {
    removeInterrupt();
  }
}

export async function runDocumentConversionCommand(commandArgs: readonly string[], dependencies: DataDocumentCommandDependencies): Promise<void> {
  if (commandArgs.length !== 4 || commandArgs[0] !== "--input" || commandArgs[1] === undefined || commandArgs[2] !== "--output" || commandArgs[3] === undefined || extname(commandArgs[3]).toLowerCase() !== ".txt") {
    process.stderr.write("Expected --input <path> --output <new.txt>.\n");
    process.exitCode = 1;
    return;
  }
  const inputPath = commandArgs[1];
  const outputPath = commandArgs[3];
  const input = await dependencies.readApprovedInputFile(inputPath);
  if (input === undefined) return;
  let createdArtifact: { readonly path: string; readonly byteCount: number; readonly sha256: string } | undefined;
  let attemptedOutputPath: string | undefined;
  try {
    const extension = extname(inputPath).toLowerCase();
    const analysis = await dependencies.withStore((store) => analyzeDocument(store, extension, input));
    if (analysis === undefined) return;
    const content = await convertDocumentToPlainText(extension, input);
    const requestedOutput = resolve(outputPath);
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await dependencies.requirePersistentFolderApproval(outputRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await previewPlainTextArtifact(content, requestedOutput, outputRoot, policy, approvals);
    process.stdout.write(`\n--- DOCUMENT TEXT EXPORT PREVIEW ---\n${escapeTerminalControls(pending.content)}\n`);
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(`Create this new plain-text export?\nPath: ${escapeTerminalControls(pending.preview.targetPath)}\nBytes: ${Buffer.byteLength(pending.content, "utf8")}\nSHA-256: ${pending.digest}\nSource text will be copied into this local file. [y/N] `);
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      approvals.discard(pending.preview.previewId);
      process.stdout.write("Document analysis completed; text export cancelled before writing.\n");
      return;
    }
    attemptedOutputPath = pending.preview.targetPath;
    const written = await writeApprovedTextArtifact(pending, approvals.approve(pending.preview.previewId), outputRoot, policy, approvals);
    createdArtifact = written;
    const reference = await dependencies.withStore((store) => store.saveArtifactReference({
      artifactId: randomUUID(),
      runId: analysis.run.runId,
      relativePath: basename(written.path),
      type: "document-plain-text",
      sha256: written.sha256,
      bytes: written.byteCount,
    }));
    if (reference === undefined) {
      process.stderr.write(`Plain-text export was created at ${escapeTerminalControls(written.path)}, but its database reference could not be saved.\n`);
      process.exitCode = 3;
      return;
    }
    process.stdout.write(`Plain-text export created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
  } catch (error: unknown) {
    if (createdArtifact !== undefined) {
      process.stderr.write(`Plain-text export exists at ${escapeTerminalControls(createdArtifact.path)}, but its database reference could not be saved.\n`);
      process.exitCode = 3;
      return;
    }
    if (attemptedOutputPath !== undefined) {
      process.stderr.write(`Document export writing or verification failed. Check whether a file exists at ${escapeTerminalControls(attemptedOutputPath)} before retrying; existing files are never replaced.\n`);
      process.exitCode = 3;
      return;
    }
    const detail = error instanceof DocumentConversionError || error instanceof DocumentWorkflowError || error instanceof DraftArtifactError || error instanceof PersistentFolderApprovalError || error instanceof DatabasePersistenceError || error instanceof PersistenceInputError
      ? error.message
      : "document conversion failed safely";
    process.stderr.write(`Document conversion failed: ${detail}\n`);
    process.exitCode = 3;
  }
}

