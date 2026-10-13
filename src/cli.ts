#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ConfigurationError, formatConfigurationSummary, loadConfiguration, loadProviderConfiguration } from "./config.js";
import { AgentBudgetLedger, AgentToolError, runToolLoop } from "./agent/tool-loop.js";
import { runSpecialistReview, type SpecialistTask, SpecialistReviewError } from "./agent/specialist-review.js";
import {
  DatabaseConnectionError,
  DatabasePersistenceError,
  DatabaseShutdownError,
  MongoStore,
  PersistenceInputError,
  type ArtifactType,
  type FolderApproval,
} from "./mongo-store.js";
import { createModelProvider } from "./providers/create-provider.js";
import { ModelProviderError } from "./providers/types.js";
import { PathPolicyError, WorkspacePathPolicy } from "./security/path-policy.js";
import { CsvWorkflowError, resumeCsvAnalysisWorkflow, runCsvAnalysisWorkflow, type CsvWorkflowResult } from "./workflows/csv-analysis-workflow.js";
import { inspectRepository, RepositoryInspectionError } from "./workflows/repository-inspection-workflow.js";
import { analyzeDocument, DocumentWorkflowError, resumeDocumentAnalysisWorkflow } from "./workflows/document-analysis-workflow.js";
import { runReviewedCommand, type ReviewedCommandId, ReviewedCommandError } from "./software/reviewed-command.js";
import { redactSourceForDisplay, reviewSourceFiles, SourceReviewError } from "./workflows/source-review-workflow.js";
import { ActionApprovalRegistry, ApprovalError } from "./security/approval-preview.js";
import { previewPdfArtifact, PdfArtifactError, writeApprovedPdfArtifact } from "./artifacts/approved-pdf-output.js";
import { prepareFilePatch, applyPreparedFilePatch, PatchApplicationError } from "./software/patch-application.js";
import { GitDiffReviewError, listGitDiffFiles, readGitDiff } from "./software/git-diff-review.js";
import { investigateSource, ModelInvestigationError } from "./software/model-investigation.js";
import { GitHubReadError, readPublicIssues } from "./integrations/github-public-issues.js";
import { DraftArtifactError, parseLocalDraftInput, previewPlainTextArtifact, previewTextArtifact, writeApprovedTextArtifact } from "./artifacts/drafts.js";
import { csvAnalysisExportFormat, CsvAnalysisExportError, renderCsvAnalysisExport, type CsvAnalysisExportFormat } from "./artifacts/csv-analysis-export.js";
import { convertDocumentToPlainText, DocumentConversionError } from "./documents/plain-text-conversion.js";
import { escapeTerminalControls } from "./security/terminal-text.js";
import { BrowserSearchError, GroqBrowserResearch } from "./integrations/groq-browser-search.js";
import { BrowserAuditError, runBrowserAudit, validateLoopbackBrowserTarget } from "./workflows/browser-audit-workflow.js";
import { runSchedulerTick, runScheduler } from "./scheduling/scheduler.js";
import type { ScheduleRecord, ScheduleWorkflowId } from "./mongo-store.js";

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version | config | doctor | model-check | chat | permissions approve/list/revoke | run csv-analyze --input <path> [--numeric-column <header>]... [--output <new.json|csv|md>] | run document-convert --input <path> --output <new.txt> | run file-move --source <file> --target <new-file> | run ... | resume <run-id> --input <path> [--numeric-column <header>]... | history list | schedule ...]

The config command validates local settings and prints a redacted summary.
The doctor command checks configured MongoDB connectivity and reports available setup areas.
The model-check command makes a synthetic read-only tool call through the selected model provider.
The chat command opens a bounded interactive conversation with the selected provider.
The csv-analyze workflow reads one explicitly approved CSV file, stores redacted run metadata, and can calculate exact selected-column decimal totals with --numeric-column.
The repo-inspect workflow inventories one explicitly approved repository root without reading file contents or running commands.
The source-review workflow reads only explicitly selected source files and displays bounded, locally redacted content; it does not send or persist source.
The file-patch workflow shows redacted current and replacement text, then applies one content-bound replacement only after exact approval.
The file-move workflow moves one supported document or data file after exact approval; source read/write and destination write folder grants are required, and the destination must be on the same filesystem volume.
The git-diff workflow displays a bounded, locally redacted staged diff after exact root and file approval; it does not call a model or persist source.
The model-investigate workflow sends selected, heuristically redacted source to the configured model only after an additional explicit transfer confirmation; it runs no tools and persists no source or findings.
The github-issues workflow reads at most 20 open issue titles from one public repository without a token; it excludes pull requests and writes nothing.
The draft workflow creates a new local Markdown GitHub issue or email draft from an explicitly approved JSON input; it never contacts GitHub or an email service.
The specialist-review workflow sends approved, heuristically redacted source excerpts to up to two read-only specialist prompts and asks the same configured model to review their findings; workers have no tools, cannot spawn workers, share one run-wide request/action budget, and do not persist source or findings.
The research workflow sends only the exact approved query to Groq browser search, then displays bounded source metadata and answer; it makes no project-file access or persistence and requires a supported Groq model.
The browser-audit workflow visits one explicitly approved loopback HTTP URL in an isolated Chromium context, blocks cross-origin requests and non-GET/HEAD methods, checks bounded same-origin links, and stores aggregate counts only.
The document-analyze workflow parses one approved TXT, Markdown, text PDF, DOCX, or XLSX file and stores counts only.
The document-convert workflow extracts one approved document to a new bounded plain-text artifact after preview and hash confirmation.
The schedule command stores one-time or recurring CSV/document workflows; execution occurs only while its foreground scheduler is running and every occurrence requires fresh interactive approval.
The pdf-report workflow renders an approved JSON report and creates a new approved PDF artifact after a content-bound confirmation.
The software-check workflow runs only an explicitly approved Node test or TypeScript no-emit check in one approved root.
The resume command reacquires input-file approval, rechecks input and workflow hashes, then resumes an uncertain CSV or document analysis.
History list prints up to 50 redacted run summaries.
Permissions are stored in the configured local MongoDB database. Approvals are scoped to a canonical folder and exactly read or write access; revoke disables that scope.
`;

const args = process.argv.slice(2);

function inputPathArgument(commandArgs: readonly string[]): string | undefined {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--input") {
    return undefined;
  }
  const value = commandArgs[1];
  return value === undefined || value.trim().length === 0 ? undefined : value;
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

async function readApprovedInputFile(pathValue: string): Promise<Uint8Array | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("File workflows require an interactive terminal for explicit read approval.\n");
    process.exitCode = 2;
    return undefined;
  }
  const absolutePath = resolve(pathValue);
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Allow TaskForge to read this exact file? ${absolutePath} [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("File read cancelled before access.\n");
    return undefined;
  }
  try {
    const policy = new WorkspacePathPolicy();
    await requirePersistentFolderApproval(dirname(absolutePath), "read");
    await policy.approveRoot(dirname(absolutePath));
    const authorized = await policy.authorizePath(absolutePath, "read");
    const canonicalPath = await realpath(authorized.path);
    if (canonicalPath !== authorized.path) {
      throw new Error("The approved file path changed before it could be read.");
    }
    const file = await open(canonicalPath, "r");
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) {
        throw new Error("The approved input must be a regular file within the 8 MiB workflow limit.");
      }
      const buffer = Buffer.alloc(8 * 1024 * 1024 + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > 8 * 1024 * 1024 || (await realpath(authorized.path)) !== canonicalPath) {
        throw new Error("The approved file changed or exceeds the workflow limit.");
      }
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  } catch (error: unknown) {
    const message = error instanceof PathPolicyError ? error.message : "The approved file could not be read safely.";
    process.stderr.write(`File read denied: ${message}\n`);
    process.exitCode = 2;
    return undefined;
  }
}

async function withMongoStore<T>(action: (store: MongoStore) => Promise<T>): Promise<T | undefined> {
  let store: MongoStore;
  try {
    store = await MongoStore.connect(loadConfiguration());
  } catch (error: unknown) {
    process.stderr.write(error instanceof DatabaseConnectionError ? `Database unavailable: ${error.message}\n` : "Unable to open the configured database.\n");
    process.exitCode = 2;
    return undefined;
  }
  try {
    return await action(store);
  } finally {
    await store.close();
  }
}

class PersistentFolderApprovalError extends Error {
  constructor() {
    super("No active persistent folder approval covers this path and access scope. Grant the exact folder scope with the permissions command.");
    this.name = "PersistentFolderApprovalError";
  }
}

async function requirePersistentFolderApproval(pathValue: string, access: "read" | "write"): Promise<void> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolve(pathValue));
  } catch {
    throw new PersistentFolderApprovalError();
  }
  const approved = await withMongoStore((store) => store.hasFolderApproval(canonicalPath, access));
  if (approved !== true) throw new PersistentFolderApprovalError();
}

async function runPermissionsCommand(commandArgs: readonly string[]): Promise<void> {
  const action = commandArgs[0];
  if (action === "list" && (commandArgs.length === 1 || (commandArgs.length === 2 && commandArgs[1] === "--all"))) {
    let approvals: readonly FolderApproval[] | undefined;
    try {
      approvals = await withMongoStore((store) => store.listFolderApprovals(commandArgs[1] === "--all"));
    } catch (error: unknown) {
      const detail = error instanceof DatabasePersistenceError || error instanceof PersistenceInputError
        ? error.message
        : "the approval records could not be read safely";
      process.stderr.write(`Permission list failed: ${detail}.\n`);
      process.exitCode = 2;
      return;
    }
    if (approvals !== undefined) {
      if (approvals.length === 0) process.stdout.write("No folder approvals are stored.\n");
      for (const approval of approvals) process.stdout.write(`${approval.status} ${approval.access} ${escapeTerminalControls(approval.path)}\n`);
    }
    return;
  }
  if ((action !== "approve" && action !== "revoke") || commandArgs.length !== 5 || commandArgs[1] !== "--root" || commandArgs[3] !== "--access" ||
    (commandArgs[4] !== "read" && commandArgs[4] !== "write")) {
    process.stderr.write("Expected permissions list [--all], permissions approve --root <folder> --access <read|write>, or permissions revoke --root <folder> --access <read|write>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Folder permission changes require interactive confirmation.\n");
    process.exitCode = 2;
    return;
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolve(commandArgs[2] ?? ""));
    if (/[\u0000-\u001f\u007f]/u.test(canonicalRoot)) throw new Error("control character in directory path");
    if (!(await stat(canonicalRoot)).isDirectory()) throw new Error("not a directory");
    const validator = new WorkspacePathPolicy();
    await validator.approveRoot(canonicalRoot);
  } catch (error: unknown) {
    process.stderr.write(`Folder permission change rejected: ${error instanceof PathPolicyError ? error.message : "root must be an existing, non-sensitive directory"}\n`);
    process.exitCode = 2;
    return;
  }
  const access = commandArgs[4];
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(action === "approve"
      ? `Persist ${access} access for this exact folder and descendants?\n${escapeTerminalControls(canonicalRoot)}\nThis does not approve individual reads, writes, or actions. [y/N] `
      : `Revoke the persisted ${access} approval for this exact folder?\n${escapeTerminalControls(canonicalRoot)}\n[y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Folder permission change cancelled.\n");
    return;
  }
  let changed: boolean | undefined;
  try {
    changed = await withMongoStore(async (store) => action === "approve"
      ? (await store.grantFolderApproval(canonicalRoot, access), true)
      : store.revokeFolderApproval(canonicalRoot, access));
  } catch (error: unknown) {
    const detail = error instanceof DatabasePersistenceError || error instanceof PersistenceInputError
      ? error.message
      : "the approval change could not be stored safely";
    process.stderr.write(`Permission change failed: ${detail}.\n`);
    process.exitCode = 2;
    return;
  }
  if (changed === true) process.stdout.write(action === "approve" ? `Persisted ${access} approval for ${escapeTerminalControls(canonicalRoot)}.\n` : `Revoked ${access} approval for ${escapeTerminalControls(canonicalRoot)}.\n`);
  else if (action === "revoke" && changed === false) process.stdout.write("No active matching folder approval was found.\n");
}

async function runCsvWorkflowCommand(commandArgs: readonly string[]): Promise<void> {
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
  const input = await readApprovedInputFile(inputPath);
  if (input === undefined) {
    return;
  }
  let result: CsvWorkflowResult | undefined;
  try {
    result = await withMongoStore((store) => runCsvAnalysisWorkflow(store, input, undefined, numericColumns));
  } catch (error: unknown) {
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
    await requirePersistentFolderApproval(outputRoot.path, "write");
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
    const references = await withMongoStore((store) => store.saveArtifactReference({
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

async function resumeWorkflowCommand(runId: string, commandArgs: readonly string[]): Promise<void> {
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
  const input = await readApprovedInputFile(inputPath);
  if (input === undefined) return;
  try {
    const result = await withMongoStore(async (store) => {
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

async function runDocumentAnalysisCommand(commandArgs: readonly string[]): Promise<void> {
  const inputPath = inputPathArgument(commandArgs);
  if (inputPath === undefined) {
    process.stderr.write("Expected --input followed by a file path.\n");
    process.exitCode = 1;
    return;
  }
  const input = await readApprovedInputFile(inputPath);
  if (input === undefined) return;
  try {
    const extension = extname(inputPath).toLowerCase();
    const result = await withMongoStore((store) => analyzeDocument(store, extension, input));
    if (result !== undefined) {
      const analysis = result.analysis;
      process.stdout.write(
        `Run ${result.run.runId} completed: ${analysis.format}, ${analysis.byteCount} bytes, ` +
        `${analysis.wordCount} words, ${analysis.lineCount} lines` +
        (analysis.pageCount === undefined ? "" : `, ${analysis.pageCount} pages`) +
        (analysis.sheetCount === undefined ? "" : `, ${analysis.sheetCount} sheets, ${analysis.rowCount ?? 0} rows, ${analysis.cellCount ?? 0} cells`) +
        `.\n`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof DocumentWorkflowError ? error.message : "Document analysis failed safely.";
    process.stderr.write(`Document analysis failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runDocumentConversionCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 4 || commandArgs[0] !== "--input" || commandArgs[1] === undefined || commandArgs[2] !== "--output" || commandArgs[3] === undefined || extname(commandArgs[3]).toLowerCase() !== ".txt") {
    process.stderr.write("Expected --input <path> --output <new.txt>.\n");
    process.exitCode = 1;
    return;
  }
  const inputPath = commandArgs[1];
  const outputPath = commandArgs[3];
  const input = await readApprovedInputFile(inputPath);
  if (input === undefined) return;
  let createdArtifact: { readonly path: string; readonly byteCount: number; readonly sha256: string } | undefined;
  let attemptedOutputPath: string | undefined;
  try {
    const extension = extname(inputPath).toLowerCase();
    const analysis = await withMongoStore((store) => analyzeDocument(store, extension, input));
    if (analysis === undefined) return;
    const content = await convertDocumentToPlainText(extension, input);
    const requestedOutput = resolve(outputPath);
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await requirePersistentFolderApproval(outputRoot.path, "write");
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
    const reference = await withMongoStore((store) => store.saveArtifactReference({
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

function parseScheduleAddArguments(commandArgs: readonly string[]): {
  readonly workflowId: ScheduleWorkflowId;
  readonly inputPath: string;
  readonly nextRunAt: Date;
  readonly intervalMinutes?: number;
} | undefined {
  if (commandArgs.length !== 7) return undefined;
  if (commandArgs[0] !== "add" || commandArgs[1] !== "--workflow" || commandArgs[3] !== "--input") return undefined;
  const workflowId = commandArgs[2];
  const inputPath = commandArgs[4];
  if ((workflowId !== "csv-analyze" && workflowId !== "document-analyze") || inputPath === undefined || inputPath.trim().length === 0) return undefined;
  const scheduleKind = commandArgs[5];
  const scheduleValue = commandArgs[6];
  if (scheduleKind === "--once" && scheduleValue !== undefined && commandArgs.length === 7) {
    const nextRunAt = new Date(scheduleValue);
    if (!Number.isFinite(nextRunAt.getTime()) || nextRunAt.getTime() <= Date.now() || nextRunAt.toISOString() !== scheduleValue) return undefined;
    return { workflowId, inputPath, nextRunAt };
  }
  if (scheduleKind === "--every-minutes" && scheduleValue !== undefined && commandArgs.length === 7 && /^\d{1,5}$/u.test(scheduleValue)) {
    const intervalMinutes = Number(scheduleValue);
    if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10_080) return undefined;
    return { workflowId, inputPath, nextRunAt: new Date(Date.now() + intervalMinutes * 60_000), intervalMinutes };
  }
  return undefined;
}

async function askScheduleQuestion(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(`${question} [y/N] `)).trim().toLowerCase() === "y";
  } finally {
    terminal.close();
  }
}

async function executeScheduledWorkflow(store: MongoStore, schedule: ScheduleRecord, occurrence: { readonly runId: string }): Promise<boolean> {
  const input = await readApprovedInputFile(schedule.inputPath);
  if (input === undefined) return false;
  if (schedule.workflowId === "csv-analyze") {
    const current = await store.getRunSummary(occurrence.runId);
    const result = current?.state === "uncertain"
      ? await resumeCsvAnalysisWorkflow(store, occurrence.runId, input)
      : await runCsvAnalysisWorkflow(store, input, occurrence.runId);
    process.stdout.write(`Scheduled run ${result.run.runId} completed: ${result.analysis.rowCount} CSV rows.\n`);
  } else {
    const current = await store.getRunSummary(occurrence.runId);
    const result = current?.state === "uncertain"
      ? await resumeDocumentAnalysisWorkflow(store, occurrence.runId, extname(schedule.inputPath).toLowerCase(), input)
      : await analyzeDocument(store, extname(schedule.inputPath).toLowerCase(), input, occurrence.runId);
    process.stdout.write(`Scheduled run ${result.run.runId} completed: ${result.analysis.format}, ${result.analysis.wordCount} words.\n`);
  }
  return true;
}

async function runScheduleCommand(commandArgs: readonly string[]): Promise<void> {
  const action = commandArgs[0];
  if (action === "add") {
    const definition = parseScheduleAddArguments(commandArgs);
    if (definition === undefined) {
      process.stderr.write("Expected schedule add --workflow <csv-analyze|document-analyze> --input <path> (--once <future-UTC-ISO>|--every-minutes <1..10080>).\n");
      process.exitCode = 1;
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write("Adding a schedule requires an interactive terminal for explicit file and future-read approval.\n");
      process.exitCode = 2;
      return;
    }
    const absolutePath = resolve(definition.inputPath);
    try {
      const policy = new WorkspacePathPolicy();
      await requirePersistentFolderApproval(dirname(absolutePath), "read");
      const approvedRoot = await policy.approveRoot(dirname(absolutePath));
      const authorized = await policy.authorizePath(absolutePath, "read");
      const canonicalPath = await realpath(authorized.path);
      const metadata = await stat(canonicalPath);
      if (canonicalPath !== authorized.path || !metadata.isFile()) throw new Error("File path is not a stable regular file.");
      process.stdout.write(`Future executions store and read this exact local file: ${canonicalPath}\n`);
      process.stdout.write(`Approved root: ${approvedRoot}\nThe file will require fresh read approval for every scheduled run.\n`);
      if (!(await askScheduleQuestion("Create this schedule?"))) return;
      const schedule = await withMongoStore((store) => store.createSchedule({
        scheduleId: randomUUID(), workflowId: definition.workflowId, inputPath: canonicalPath,
        nextRunAt: definition.nextRunAt,
        ...(definition.intervalMinutes === undefined ? {} : { intervalMinutes: definition.intervalMinutes }),
      }));
      if (schedule !== undefined) process.stdout.write(`Schedule ${schedule.scheduleId} created; next run ${schedule.nextRunAt.toISOString()}.\n`);
    } catch {
      process.stderr.write("Schedule creation failed safely; no file contents were read.\n");
      process.exitCode = 2;
    }
    return;
  }
  if (action === "list" && commandArgs.length === 1) {
    const schedules = await withMongoStore((store) => store.listSchedules());
    if (schedules === undefined) return;
    if (schedules.length === 0) process.stdout.write("No schedules found.\n");
    for (const schedule of schedules) {
      process.stdout.write(`${schedule.scheduleId}\t${schedule.status}\t${schedule.workflowId}\t${basename(schedule.inputPath)}\t${schedule.nextRunAt.toISOString()}\t${schedule.intervalMinutes === undefined ? "once" : `every ${schedule.intervalMinutes}m`}${schedule.pendingOccurrence === undefined ? "" : schedule.dispatchOwner === undefined ? "\tawaiting approval" : "\tapproval claimed; verify prior runner is stopped before recovery"}\n`);
    }
    return;
  }
  if ((action === "pause" || action === "resume" || action === "delete") && commandArgs.length === 2 && commandArgs[1] !== undefined) {
    if (action === "delete") {
      if (!process.stdin.isTTY || !process.stdout.isTTY || !(await askScheduleQuestion(`Soft-delete schedule ${commandArgs[1]}?`))) return;
    }
    const nextStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "deleted";
    const schedule = await withMongoStore((store) => store.setScheduleStatus(commandArgs[1], nextStatus));
    if (schedule !== undefined) process.stdout.write(`Schedule ${schedule.scheduleId}: ${schedule.status}.\n`);
    return;
  }
  if (action === "recover" && commandArgs.length === 2 && commandArgs[1] !== undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write("Recovering a claimed occurrence requires an interactive terminal.\n");
      process.exitCode = 2;
      return;
    }
    await withMongoStore(async (store) => {
      const schedule = (await store.listSchedules(true)).find((entry) => entry.scheduleId === commandArgs[1]);
      if (schedule?.pendingOccurrence === undefined || schedule.dispatchOwner === undefined) {
        process.stderr.write("No claimed pending occurrence was found for that schedule.\n");
        return;
      }
      const approved = await askScheduleQuestion(
        `Confirm the prior scheduler process is stopped and release its claim for ${schedule.pendingOccurrence.scheduledFor.toISOString()}? A fresh run and file approval will still be required.`,
      );
      if (!approved) return;
      const recovered = await store.recoverScheduleOccurrenceClaim(schedule.scheduleId, schedule.pendingOccurrence.scheduledFor);
      process.stdout.write(recovered ? "Occurrence claim released; the next scheduler run will request fresh approval.\n" : "Occurrence claim changed before recovery; no change made.\n");
    });
    return;
  }
  if (action === "run" && (commandArgs.length === 1 || (commandArgs.length === 2 && commandArgs[1] === "--once"))) {
    const controller = new AbortController();
    const handleInterrupt = (): void => controller.abort();
    process.once("SIGINT", handleInterrupt);
    try {
      await withMongoStore(async (store) => {
        const attempted = new Set<string>();
        const ownerId = randomUUID();
        const tick = async (now = new Date()) => {
          const result = await runSchedulerTick(store, {
            now,
            userPresent: process.stdin.isTTY === true && process.stdout.isTTY === true,
            attemptedOccurrences: attempted,
            ownerId,
            confirm: async (schedule, scheduledFor) => askScheduleQuestion(`Run ${schedule.workflowId} for ${basename(schedule.inputPath)} scheduled at ${scheduledFor.toISOString()}?`),
            execute: (schedule, occurrence) => executeScheduledWorkflow(store, schedule, occurrence),
          });
          if (result.claimed > 0 || result.missed > 0 || result.completed > 0 || result.failed > 0) {
            process.stdout.write(`Scheduler tick: claimed=${result.claimed}, pending=${result.pending}, missed=${result.missed}, completed=${result.completed}, failed=${result.failed}.\n`);
          }
          return result;
        };
        if (commandArgs[1] === "--once") await tick();
        else {
          process.stdout.write("Foreground scheduler running; schedules execute only while this process remains active. Press Ctrl+C to stop.\n");
          await runScheduler(controller.signal, tick);
        }
      });
    } finally {
      process.removeListener("SIGINT", handleInterrupt);
    }
    return;
  }
  process.stderr.write("Expected schedule add|list|pause|resume|delete|recover|run [--once].\n");
  process.exitCode = 1;
}

async function listRunHistory(): Promise<void> {
  let history: { readonly runs: Awaited<ReturnType<MongoStore["listRunSummaries"]>>; readonly artifacts: ReadonlyMap<string, Awaited<ReturnType<MongoStore["listArtifactReferences"]>>> } | undefined;
  try {
    history = await withMongoStore(async (store) => {
      const runs = await store.listRunSummaries();
      const artifacts = new Map<string, Awaited<ReturnType<MongoStore["listArtifactReferences"]>>>();
      for (const run of runs) artifacts.set(run.runId, await store.listArtifactReferences(run.runId));
      return { runs, artifacts };
    });
  } catch {
    process.stderr.write("Unable to read TaskForge run history.\n");
    process.exitCode = 2;
    return;
  }
  if (history === undefined) {
    return;
  }
  if (history.runs.length === 0) {
    process.stdout.write("No TaskForge runs found.\n");
    return;
  }
  for (const run of history.runs) {
    process.stdout.write(`${run.runId}\t${run.state}\t${run.workflowId}\t${run.summary}\n`);
    for (const artifact of history.artifacts.get(run.runId) ?? []) {
      process.stdout.write(`  artifact\t${artifact.type}\t${escapeTerminalControls(artifact.relativePath)}\t${artifact.bytes} bytes\tSHA-256 ${artifact.sha256}\n`);
    }
  }
}

async function runRepositoryInspectionCommand(commandArgs: readonly string[]): Promise<void> {
  if (
    commandArgs.length !== 2 || commandArgs[0] !== "--root" ||
    commandArgs[1] === undefined || commandArgs[1].trim().length === 0
  ) {
    process.stderr.write("Expected --root followed by a repository directory.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Repository inspection requires an interactive terminal for explicit root approval.\n");
    process.exitCode = 2;
    return;
  }

  const requestedRoot = resolve(commandArgs[1]);
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Allow TaskForge to inventory this exact repository root? ${requestedRoot} [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Repository inspection cancelled before access.\n");
    return;
  }

  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(requestedRoot);
    await requirePersistentFolderApproval(approvedRoot.path, "read");
    const result = await withMongoStore((store) => inspectRepository(store, approvedRoot, policy));
    if (result !== undefined) {
      const inventory = result.inventory;
      process.stdout.write(
        `Run ${result.run.runId} completed: ${inventory.fileCount} files, ` +
        `${inventory.sourceFileCount} source files, ${inventory.testFileCount} test-named files; ` +
        `${inventory.skippedLinkCount} links skipped, ${inventory.deniedPathCount} secret paths skipped.\n`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof RepositoryInspectionError || error instanceof PersistentFolderApprovalError ? error.message : "Repository inspection failed safely.";
    process.stderr.write(`Repository inspection failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runSoftwareCheckCommand(commandArgs: readonly string[]): Promise<void> {
  const rootValue = commandArgs[1];
  const checkValue = commandArgs[3];
  if (
    commandArgs.length !== 4 || commandArgs[0] !== "--root" || rootValue === undefined ||
    rootValue.trim().length === 0 || commandArgs[2] !== "--check" ||
    (checkValue !== "node-test" && checkValue !== "typescript-check")
  ) {
    process.stderr.write("Expected --root <directory> --check <node-test|typescript-check>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Software checks require an interactive terminal for explicit approval.\n");
    process.exitCode = 2;
    return;
  }

  const requestedRoot = resolve(rootValue);
  const command: ReviewedCommandId = checkValue;
  const rootConsent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await rootConsent.question(`Allow TaskForge to run a reviewed check in this exact repository root? ${requestedRoot} [y/N] `);
  } finally {
    rootConsent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("Software check cancelled before repository access.\n");
    return;
  }

  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(requestedRoot);
    await requirePersistentFolderApproval(approvedRoot.path, "write");
    const commandLabel = command === "node-test" ? "node --test (runs the repository test code)" : "local TypeScript compiler --noEmit";
    const commandConsent = createInterface({ input: process.stdin, output: process.stdout });
    let commandAnswer: string;
    try {
      commandAnswer = await commandConsent.question(`Run ${commandLabel} in the approved root? [y/N] `);
    } finally {
      commandConsent.close();
    }
    if (commandAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Software check cancelled before command execution.\n");
      return;
    }

    const result = await withMongoStore((store) => runReviewedCommand(store, approvedRoot, policy, command));
    if (result !== undefined) {
      process.stdout.write(
        `Run ${result.run.runId} ${result.status}: ${result.command}; ` +
        `exit=${result.exitCode === null ? "unavailable" : result.exitCode}; ` +
        `duration=${result.durationMs}ms; observed output bytes=${result.observedOutputBytes}` +
        `${result.outputTruncated ? " (capture limit reached)" : ""}. Output was not displayed or persisted.\n`,
      );
      if (result.status !== "passed") process.exitCode = 3;
    }
  } catch (error: unknown) {
    const message = error instanceof ReviewedCommandError || error instanceof PersistentFolderApprovalError ? error.message : "Software check failed safely.";
    process.stderr.write(`Software check failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runSourceReviewCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length < 4 || commandArgs[0] !== "--root" || commandArgs[1] === undefined || commandArgs[1].trim().length === 0) {
    process.stderr.write("Expected --root <directory> --file <relative-path> [--file <relative-path> ...].\n");
    process.exitCode = 1;
    return;
  }
  const paths: string[] = [];
  for (let index = 2; index < commandArgs.length; index += 2) {
    const flag = commandArgs[index];
    const path = commandArgs[index + 1];
    if (flag !== "--file" || path === undefined) {
      process.stderr.write("Each selected file must use --file followed by a relative path.\n");
      process.exitCode = 1;
      return;
    }
    paths.push(path);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Source review requires an interactive terminal for exact root and file-set approval.\n");
    process.exitCode = 2;
    return;
  }
  const requestedRoot = resolve(commandArgs[1]);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(requestedRoot);
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Review these exact files from this resolved repository root?\nRoot: ${canonicalRoot}\nFiles: ${paths.join(", ")}\nContent stays local. Common credential patterns are redacted heuristically; other secrets may remain visible. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Source review cancelled before file access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(canonicalRoot);
    await requirePersistentFolderApproval(approvedRoot.path, "read");
    const files = await reviewSourceFiles(approvedRoot, policy, paths);
    for (const file of files) {
      process.stdout.write(`\n--- ${file.path} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${file.content}\n`);
    }
  } catch (error: unknown) {
    const message = error instanceof SourceReviewError || error instanceof PersistentFolderApprovalError ? error.message : "Source review failed safely.";
    process.stderr.write(`Source review failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runPdfReportCommand(commandArgs: readonly string[]): Promise<void> {
  if (
    commandArgs.length !== 4 || commandArgs[0] !== "--input" || commandArgs[1] === undefined ||
    commandArgs[2] !== "--output" || commandArgs[3] === undefined || commandArgs[3].trim().length === 0
  ) {
    process.stderr.write("Expected --input <report.json> --output <new.pdf>.\n");
    process.exitCode = 1;
    return;
  }
  const input = await readApprovedInputFile(commandArgs[1]);
  if (input === undefined) return;
  let report: unknown;
  try {
    report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)) as unknown;
  } catch {
    process.stderr.write("PDF report input must be valid UTF-8 JSON.\n");
    process.exitCode = 3;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("PDF artifact output requires an interactive terminal for target and content-bound approval.\n");
    process.exitCode = 2;
    return;
  }
  const requestedOutput = resolve(commandArgs[3]);
  try {
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await requirePersistentFolderApproval(outputRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await previewPdfArtifact(report, requestedOutput, outputRoot, policy, approvals);
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(
        `Create this new PDF artifact?\nPath: ${pending.preview.targetPath}\nBytes: ${pending.bytes.byteLength}\nSHA-256: ${pending.digest}\nExisting files will not be replaced. [y/N] `,
      );
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      approvals.discard(pending.preview.previewId);
      process.stdout.write("PDF artifact creation cancelled before writing.\n");
      return;
    }
    const approval = approvals.approve(pending.preview.previewId);
    const written = await writeApprovedPdfArtifact(pending, approval, outputRoot, policy, approvals);
    process.stdout.write(`PDF artifact created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
  } catch (error: unknown) {
    const message = error instanceof PdfArtifactError || error instanceof PersistentFolderApprovalError ? error.message : "PDF artifact creation failed safely.";
    process.stderr.write(`PDF report failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runFilePatchCommand(commandArgs: readonly string[]): Promise<void> {
  if (
    commandArgs.length !== 6 || commandArgs[0] !== "--root" || commandArgs[1] === undefined ||
    commandArgs[2] !== "--target" || commandArgs[3] === undefined ||
    commandArgs[4] !== "--content-file" || commandArgs[5] === undefined
  ) {
    process.stderr.write("Expected --root <directory> --target <relative-path> --content-file <relative-path>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("File patching requires an interactive terminal for exact root, file-set and write approval.\n");
    process.exitCode = 2;
    return;
  }
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(commandArgs[1]));
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const targetRelativePath = commandArgs[3];
  const contentRelativePath = commandArgs[5];
  const rootConsent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await rootConsent.question(
      `Review a replacement for this exact target?\nRoot: ${rootPath}\nTarget: ${targetRelativePath}\nReplacement content file: ${contentRelativePath}\nSource stays local; redaction is heuristic. [y/N] `,
    );
  } finally {
    rootConsent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("File patch cancelled before access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(rootPath);
    await requirePersistentFolderApproval(approvedRoot.path, "read");
    await requirePersistentFolderApproval(approvedRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const prepared = await prepareFilePatch(approvedRoot, policy, approvals, targetRelativePath, contentRelativePath);
    const currentFiles = await reviewSourceFiles(approvedRoot, policy, [targetRelativePath]);
    const current = currentFiles[0];
    if (current === undefined) throw new PatchApplicationError();
    process.stdout.write(`\n--- CURRENT ${current.path} (${current.byteCount} bytes) ---\n${current.content}\n`);
    process.stdout.write(`\n--- REPLACEMENT ${contentRelativePath} (SHA-256 ${prepared.sha256}) ---\n${redactSourceForDisplay(prepared.content)}\n`);
    const patchConsent = createInterface({ input: process.stdin, output: process.stdout });
    let patchAnswer: string;
    try {
      patchAnswer = await patchConsent.question(
        `Apply this exact replacement to ${prepared.preview.targetPath}? The target will be revalidated before write. [y/N] `,
      );
    } finally {
      patchConsent.close();
    }
    if (patchAnswer.trim().toLowerCase() !== "y") {
      approvals.discard(prepared.preview.previewId);
      process.stdout.write("File patch cancelled before writing.\n");
      return;
    }
    const approval = approvals.approve(prepared.preview.previewId);
    await applyPreparedFilePatch(prepared, approval, approvals);
    process.stdout.write(`Replacement applied to ${prepared.preview.targetPath}. Run a reviewed check to verify it.\n`);
  } catch (error: unknown) {
    const message = error instanceof PatchApplicationError || error instanceof PersistentFolderApprovalError ? error.message : "File patch failed safely.";
    process.stderr.write(`File patch failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runFileMoveCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 4 || commandArgs[0] !== "--source" || commandArgs[1] === undefined ||
      commandArgs[2] !== "--target" || commandArgs[3] === undefined) {
    process.stderr.write("Expected --source <file> --target <new-file>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("File moves require an interactive terminal for exact operation approval.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const sourcePath = resolve(commandArgs[1]);
    const targetPath = resolve(commandArgs[3]);
    const extension = extname(sourcePath).toLowerCase();
    const supported = new Set([".txt", ".md", ".markdown", ".csv", ".pdf", ".docx", ".xlsx"]);
    if (!supported.has(extension) || extname(targetPath).toLowerCase() !== extension) {
      process.stderr.write("File move supports matching TXT, Markdown, CSV, PDF, DOCX, or XLSX extensions.\n");
      process.exitCode = 2;
      return;
    }
    const policy = new WorkspacePathPolicy();
    const sourceRoot = await policy.approveRoot(dirname(sourcePath));
    const targetRoot = await policy.approveRoot(dirname(targetPath));
    await requirePersistentFolderApproval(sourceRoot.path, "read");
    await requirePersistentFolderApproval(sourceRoot.path, "write");
    await requirePersistentFolderApproval(targetRoot.path, "write");
    const registry = new ActionApprovalRegistry(policy);
    const preview = await registry.preview({ kind: "move", sourcePath, targetPath });
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(
        `Move this exact file?\nSource: ${escapeTerminalControls(preview.sourcePath ?? "")}\nDestination (must not exist): ${escapeTerminalControls(preview.targetPath)}\nSize: ${preview.sourceBytes ?? 0} bytes\nSHA-256: ${preview.sourceSha256 ?? "unavailable"}\nThe source is removed after a verified same-volume hard link is created. [y/N] `,
      );
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      registry.discard(preview.previewId);
      process.stdout.write("File move cancelled before mutation.\n");
      return;
    }
    await registry.applyApprovedMove(registry.approve(preview.previewId));
    process.stdout.write(`Moved file to ${escapeTerminalControls(preview.targetPath)}.\n`);
  } catch (error: unknown) {
    const detail = error instanceof PersistentFolderApprovalError ? error.message
      : error instanceof ApprovalError ? error.message
        : error instanceof PathPolicyError ? error.message : "the move could not be completed safely";
    process.stderr.write(`File move failed: ${detail}. The source may remain if the destination could not be verified.\n`);
    process.exitCode = 3;
  }
}

async function runGitDiffCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--root" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --root <directory>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Git diff review requires an interactive terminal for exact root and changed-file approval.\n");
    process.exitCode = 2;
    return;
  }
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(commandArgs[1]));
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await consent.question(`Inspect staged Git changes from this exact repository root?\nRoot: ${rootPath}\nNo source is read until the staged-file list is approved. [y/N] `);
  } finally {
    consent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("Git diff review cancelled before content access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await requirePersistentFolderApproval(root.path, "read");
    const files = await listGitDiffFiles(root, policy);
    if (files.length === 0) {
      process.stdout.write("No tracked changes are available for review. Unstaged and untracked files are not included.\n");
      return;
    }
    const fileList = files.map((file) => `  ${JSON.stringify(file)}`).join("\n");
    const fileConsent = createInterface({ input: process.stdin, output: process.stdout });
    let fileAnswer: string;
    try {
      fileAnswer = await fileConsent.question(`Display the locally redacted diff for these exact changed files?\n${fileList}\nMaximum: 20 files and 48 KiB. Redaction is heuristic. [y/N] `);
    } finally {
      fileConsent.close();
    }
    if (fileAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Git diff review cancelled before content access.\n");
      return;
    }
    const review = await readGitDiff(root, policy, files);
    process.stdout.write(review.diff.length === 0 ? "The approved diff is empty.\n" : `${review.diff}\n`);
  } catch (error: unknown) {
    const message = error instanceof GitDiffReviewError || error instanceof PersistentFolderApprovalError ? error.message : "Git diff review failed safely.";
    process.stderr.write(`Git diff review failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runModelInvestigationCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length < 4 || commandArgs[0] !== "--root" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --root <directory> --file <relative-path> [--file <relative-path> ...].\n");
    process.exitCode = 1;
    return;
  }
  const paths: string[] = [];
  for (let index = 2; index < commandArgs.length;) {
    const option = commandArgs[index];
    const path = commandArgs[index + 1];
    if (option !== "--file" || path === undefined) {
      process.stderr.write("Each selected source file must use --file followed by a relative path.\n");
      process.exitCode = 1;
      return;
    }
    paths.push(path);
    index += 2;
  }
  if (paths.length > 5) {
    process.stderr.write("Select no more than five source files for model investigation.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Model investigation requires interactive root, file-set, and provider-transfer approval.\n");
    process.exitCode = 2;
    return;
  }
  let providerConfiguration;
  try {
    providerConfiguration = loadProviderConfiguration();
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "The selected model provider is not configured.";
    process.stderr.write(`Model investigation setup error: ${message}\n`);
    process.exitCode = 2;
    return;
  }
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(commandArgs[1]));
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const rootConsent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await rootConsent.question(`Review these exact files locally before model transfer?\nRoot: ${rootPath}\nFiles: ${paths.join(", ")}\nThe source will be heuristically redacted before display. [y/N] `);
  } finally {
    rootConsent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("Model investigation cancelled before source access.\n");
    return;
  }
  const controller = new AbortController();
  const handleInterrupt = (): void => controller.abort();
  process.once("SIGINT", handleInterrupt);
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await requirePersistentFolderApproval(root.path, "read");
    const files = await reviewSourceFiles(root, policy, paths);
    const sourceBytes = files.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8") + Buffer.byteLength(file.path, "utf8") + 64, 0);
    if (files.length === 0 || files.length > 5 || sourceBytes > 24 * 1024) {
      throw new ModelInvestigationError("Select 1 to 5 redacted source files within the 24 KiB model-input limit.");
    }
    for (const file of files) {
      process.stdout.write(`\n--- REDACTED ${file.path} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${file.content}\n`);
    }
    const selected = createModelProvider(providerConfiguration);
    const transferConsent = createInterface({ input: process.stdin, output: process.stdout });
    let transferAnswer: string;
    try {
      transferAnswer = await transferConsent.question(
        `Send these exact redacted excerpts to ${providerConfiguration.kind} (${selected.model}) for bug investigation? Redaction may miss secrets. No tool actions or persistence will occur. [y/N] `,
      );
    } finally {
      transferConsent.close();
    }
    if (transferAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Model investigation cancelled before provider transfer.\n");
      return;
    }
    const findings = await investigateSource(selected.provider, selected.model, files, controller.signal);
    process.stdout.write(`\nModel investigation result (unverified; no tests were run):\n${findings}\n`);
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError || error instanceof ModelInvestigationError || error instanceof ModelProviderError || error instanceof PersistentFolderApprovalError
      ? error.message
      : "Model investigation failed safely.";
    process.stderr.write(`Model investigation failed: ${message}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
  }
}

async function runSpecialistReviewCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length < 4 || commandArgs[0] !== "--root" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --root <directory> --file <relative-path> [--file <relative-path> ...].\n");
    process.exitCode = 1;
    return;
  }
  const paths: string[] = [];
  for (let index = 2; index < commandArgs.length;) {
    const option = commandArgs[index];
    const path = commandArgs[index + 1];
    if (option !== "--file" || path === undefined) {
      process.stderr.write("Each selected source file must use --file followed by a relative path.\n");
      process.exitCode = 1;
      return;
    }
    paths.push(path);
    index += 2;
  }
  if (paths.length > 5) {
    process.stderr.write("Select no more than five source files for specialist review.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Specialist review requires interactive root, file-set, goal, and provider-transfer approval.\n");
    process.exitCode = 2;
    return;
  }
  let providerConfiguration;
  try {
    providerConfiguration = loadProviderConfiguration();
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "The selected model provider is not configured.";
    process.stderr.write(`Specialist review setup error: ${message}\n`);
    process.exitCode = 2;
    return;
  }
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(commandArgs[1]));
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const rootConsent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await rootConsent.question(`Review these exact files locally before specialist transfer?\nRoot: ${rootPath}\nFiles: ${paths.join(", ")}\nSource is heuristically redacted. [y/N] `);
  } finally {
    rootConsent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("Specialist review cancelled before source access.\n");
    return;
  }
  const controller = new AbortController();
  const handleInterrupt = (): void => controller.abort();
  process.once("SIGINT", handleInterrupt);
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await requirePersistentFolderApproval(root.path, "read");
    const files = await reviewSourceFiles(root, policy, paths);
    const sourceBytes = files.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8") + Buffer.byteLength(file.path, "utf8") + 64, 0);
    if (files.length === 0 || files.length > 5 || sourceBytes > 24 * 1024) {
      throw new SpecialistReviewError("Select 1 to 5 redacted source files within the 24 KiB model-input limit.");
    }
    for (const file of files) {
      process.stdout.write(`\n--- REDACTED ${file.path} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${escapeTerminalControls(file.content)}\n`);
    }
    const goalConsent = createInterface({ input: process.stdin, output: process.stdout });
    let goal: string;
    try {
      goal = (await goalConsent.question("What should the specialists investigate? ")).trim();
    } finally {
      goalConsent.close();
    }
    if (goal.length === 0 || Buffer.byteLength(goal, "utf8") > 2_000) throw new SpecialistReviewError("Provide a non-empty goal within 2,000 bytes.");
    const roles: readonly SpecialistTask[] = [
      { role: "repository-investigator", goal: "Find specific behavior or correctness risks supported by the selected source." },
      { role: "reviewer", goal: "Independently challenge the first specialist's likely assumptions and check relevant boundaries." },
    ];
    const provider = createModelProvider(providerConfiguration);
    const transferConsent = createInterface({ input: process.stdin, output: process.stdout });
    let transferAnswer: string;
    try {
      transferAnswer = await transferConsent.question(
        `Send these exact redacted excerpts and goal to ${providerConfiguration.kind} (${provider.model}) for up to two read-only specialists and one parent review? This command has a fresh run budget of 40 model requests and 30 tool actions (no tool actions are exposed here). No network integrations, persistence, or file writes are available. Redaction may miss secrets. [y/N] `,
      );
    } finally {
      transferConsent.close();
    }
    if (transferAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Specialist review cancelled before provider transfer.\n");
      return;
    }
    const ledger = new AgentBudgetLedger(40, 30);
    const result = await runSpecialistReview(provider.provider, provider.model, goal, files.map((file) => `${file.path}\n${file.content}`).join("\n\n"), roles, ledger, controller.signal);
    for (const worker of result.workers) {
      process.stdout.write(`\nSpecialist ${worker.role}: ${worker.status}${worker.failureKind === undefined ? "" : ` (${worker.failureKind})`}\n${worker.findings ?? "No finding available."}\n`);
    }
    process.stdout.write(`\nParent review (${result.parentReviewStatus}${result.parentFailureKind === undefined ? "" : `, ${result.parentFailureKind}`}; unverified):\n${result.parentReview ?? "Not completed; inspect the specialist reports manually."}\n`);
    process.stdout.write(`Budget used: ${result.budget.modelRequests} model requests, ${result.budget.toolActions} tool actions. No code changes or tests were performed by TaskForge.\n`);
    if (result.parentReviewStatus !== "complete" || result.workers.some((worker) => worker.status !== "complete")) process.exitCode = 3;
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError || error instanceof SpecialistReviewError || error instanceof ModelProviderError || error instanceof PersistentFolderApprovalError
      ? error.message
      : "Specialist review failed safely.";
    process.stderr.write(`Specialist review failed: ${message}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
  }
}

async function runGitHubIssuesCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--repository" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --repository <owner/name>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("GitHub issue reading requires an interactive confirmation for the public repository request.\n");
    process.exitCode = 2;
    return;
  }
  const repository = commandArgs[1];
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Read up to 20 open issue titles from the public repository ${repository}? The request uses no GitHub token and will not write anything. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("GitHub issue read cancelled before network access.\n");
    return;
  }
  try {
    const issues = await readPublicIssues(repository);
    if (issues.length === 0) {
      process.stdout.write("No open issues were returned.\n");
      return;
    }
    for (const issue of issues) {
      process.stdout.write(`#${issue.number} [${issue.state}] ${issue.title}\n${issue.url}\n`);
    }
  } catch (error: unknown) {
    const message = error instanceof GitHubReadError ? error.message : "GitHub issue read failed safely.";
    process.stderr.write(`GitHub issue read failed: ${message}\n`);
    process.exitCode = 3;
  }
}

async function runResearchCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--query" || commandArgs[1] === undefined || commandArgs[1].trim().length === 0 || commandArgs[1].length > 512) {
    process.stderr.write("Expected --query <question> with 1–512 characters.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Research requires interactive approval before sending a query to Groq browser search.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const provider = loadProviderConfiguration();
    if (provider.kind !== "groq") {
      process.stderr.write("Groq browser search requires TASKFORGE_PROVIDER=groq.\n");
      process.exitCode = 2;
      return;
    }
    const query = commandArgs[1].trim();
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(
        `Send this exact query to Groq browser search (${provider.model})? Groq reports search is powered by Exa. No project files are sent and no results are persisted. [y/N]\n${escapeTerminalControls(query)}\n> `,
      );
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      process.stdout.write("Research cancelled before provider transfer.\n");
      return;
    }
    const controller = new AbortController();
    const interrupt = (): void => controller.abort();
    process.once("SIGINT", interrupt);
    try {
      const result = await new GroqBrowserResearch(provider).search(query, controller.signal);
      process.stdout.write(`Research answer (unverified; retrieved ${result.retrievedAt}; model ${result.model}):\n${escapeTerminalControls(result.answer)}\n\nSources (${result.sources.length}):\n`);
      for (const source of result.sources) {
        process.stdout.write(`- ${escapeTerminalControls(source.title)}\n  ${source.url}\n  ${escapeTerminalControls(source.excerpt)}\n`);
      }
    } finally {
      process.removeListener("SIGINT", interrupt);
    }
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message
      : error instanceof BrowserSearchError ? error.message : "Research failed safely.";
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof BrowserSearchError && error.kind === "cancelled" ? 130 : 3;
  }
}

async function runBrowserAuditCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--url" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --url <loopback-http-url>.\n");
    process.exitCode = 1;
    return;
  }
  let target: URL;
  try {
    target = validateLoopbackBrowserTarget(commandArgs[1]);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof BrowserAuditError ? error.message : "Browser audit target was rejected."}\n`);
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Browser audit requires interactive approval before opening a loopback page.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(
      `Open this exact loopback page in an isolated, unauthenticated Chromium context?\n${escapeTerminalControls(target.toString())}\nOnly same-origin GET/HEAD navigation is allowed; cross-origin and unsafe methods are blocked. Aggregate counts only are stored; page text, URL, links and console messages are not. [y/N] `,
    );
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Browser audit cancelled before local navigation.\n");
    return;
  }
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    const result = await withMongoStore((store) => runBrowserAudit(store, target.toString(), controller.signal));
    if (result !== undefined) {
      const metrics = result.metrics;
      process.stdout.write(
        `Run ${result.run.runId} completed: ${metrics.httpErrorCount} HTTP errors, ${metrics.brokenLinkCount}/${metrics.linksChecked} broken local links, ` +
        `${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ` +
        `${metrics.blockedExternalRequestCount} external requests blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ` +
        `${metrics.blockedRequestLimitCount} requests blocked at the limit.\n`,
      );
    }
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof BrowserAuditError ? error.message : "Browser audit failed safely; no page content was persisted."}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

async function runDraftCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 4 || commandArgs[0] !== "--input" || commandArgs[1] === undefined || commandArgs[2] !== "--output" || commandArgs[3] === undefined) {
    process.stderr.write("Expected --input <draft.json> --output <new.md>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Draft creation requires an interactive terminal for input and create-only output approval.\n");
    process.exitCode = 2;
    return;
  }
  const inputBytes = await readApprovedInputFile(commandArgs[1]);
  if (inputBytes === undefined) return;
  let draft: unknown;
  try {
    draft = parseLocalDraftInput(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes)) as unknown);
  } catch (error: unknown) {
    process.stderr.write(`Draft input rejected: ${error instanceof DraftArtifactError ? error.message : "input must be valid UTF-8 JSON"}\n`);
    process.exitCode = 3;
    return;
  }
  const requestedOutput = resolve(commandArgs[3]);
  try {
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await requirePersistentFolderApproval(outputRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await previewTextArtifact(draft, requestedOutput, outputRoot, policy, approvals);
    process.stdout.write(`\n--- LOCAL DRAFT PREVIEW (heuristic redaction) ---\n${escapeTerminalControls(redactSourceForDisplay(pending.content))}\n`);
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(`Create this new local Markdown draft?\nPath: ${pending.preview.targetPath}\nBytes: ${Buffer.byteLength(pending.content, "utf8")}\nSHA-256: ${pending.digest}\nNo network request or email send will occur. [y/N] `);
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      approvals.discard(pending.preview.previewId);
      process.stdout.write("Draft creation cancelled before writing.\n");
      return;
    }
    const approval = approvals.approve(pending.preview.previewId);
    const written = await writeApprovedTextArtifact(pending, approval, outputRoot, policy, approvals);
    process.stdout.write(`Local draft created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
  } catch (error: unknown) {
    process.stderr.write(`Draft creation failed: ${error instanceof DraftArtifactError || error instanceof PersistentFolderApprovalError ? error.message : "the artifact could not be created safely"}\n`);
    process.exitCode = 3;
  }
}

async function runDoctor(): Promise<void> {
  process.stdout.write("TaskForge doctor (early development)\n");
  let providerStatus = "not configured or invalid";
  try {
    providerStatus = `${loadProviderConfiguration().kind} configured (not contacted by doctor)`;
  } catch {
    // Keep provider diagnostics independent from secret values and MongoDB configuration.
  }

  try {
    const configuration = loadConfiguration();
    process.stdout.write(`${formatConfigurationSummary(configuration)}\n`);
    const store = await MongoStore.connect(configuration);
    try {
      await store.close();
    } catch {
      throw new DatabaseShutdownError();
    }
    process.stdout.write("MongoDB: available\n");
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      if (error.message.includes("TASKFORGE_MONGODB_URI")) {
        process.stdout.write(`MongoDB: not configured. ${error.message}\n`);
      } else {
        process.stdout.write(`Configuration: invalid. ${error.message}\n`);
      }
    } else if (error instanceof DatabaseConnectionError) {
      process.stdout.write(`MongoDB: unavailable. ${error.message}\n`);
    } else if (error instanceof DatabaseShutdownError) {
      process.stdout.write(`MongoDB: connection check could not close cleanly. ${error.message}\n`);
    } else {
      process.stdout.write("MongoDB: check failed with an unexpected error.\n");
    }
    process.stdout.write(`Model provider: ${providerStatus}.\n`);
    process.stdout.write("Browser tooling: local loopback audit is available; broader real-site checks remain pending.\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Model provider: ${providerStatus}.\n`);
  process.stdout.write("Browser tooling: local loopback audit is available; broader real-site checks remain pending.\n");
}

async function runModelCheck(): Promise<void> {
  const controller = new AbortController();
  const handleInterrupt = (): void => controller.abort();
  process.once("SIGINT", handleInterrupt);
  try {
    const providerConfiguration = loadProviderConfiguration();
    const selected = createModelProvider(providerConfiguration);
    const result = await runToolLoop(
      selected.provider,
      selected.model,
      [{ role: "user", content: "Use read_fixture_status for record_id fixture-001, then report its status." }],
      [{
        definition: {
          name: "read_fixture_status",
          description: "Read the fixed synthetic status for the fixture record fixture-001.",
          parameters: {
            type: "object",
            properties: { record_id: { type: "string", enum: ["fixture-001"] } },
            required: ["record_id"],
            additionalProperties: false,
          },
        },
        validateArguments(value: unknown): unknown {
          if (
            typeof value !== "object" || value === null || Array.isArray(value) ||
            !("record_id" in value) || value.record_id !== "fixture-001" ||
            Object.keys(value).some((key) => key !== "record_id")
          ) {
            throw new AgentToolError();
          }
          return { record_id: value.record_id };
        },
        async execute(): Promise<string> {
          return "fixture-001 status=ready (synthetic fixture; no files or services accessed)";
        },
      }],
      { maxModelRequests: 3, maxToolActions: 1, signal: controller.signal },
    );
    if (result.toolActions !== 1 || result.toolNames[0] !== "read_fixture_status") {
      process.stderr.write("Model check failed: the provider did not complete the required synthetic tool call.\n");
      process.exitCode = 3;
      return;
    }
    process.stdout.write(`Model check passed: ${providerConfiguration.kind}; tool actions=${result.toolActions}; model requests=${result.modelRequests}.\n`);
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`Model check setup error: ${error.message}\n`);
    } else if (error instanceof ModelProviderError) {
      process.stderr.write(`Model check failed: ${error.message}\n`);
    } else if (error instanceof AgentToolError) {
      process.stderr.write("Model check failed: provider requested an unknown or invalid tool action.\n");
    } else {
      process.stderr.write("Model check failed with an unexpected error.\n");
    }
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
  }
}

async function runChat(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Chat requires an interactive terminal.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const providerConfiguration = loadProviderConfiguration();
    const selected = createModelProvider(providerConfiguration);
    if (providerConfiguration.kind === "groq") {
      process.stdout.write("This session sends the text you enter to the configured Groq service. Continue? [y/N] ");
      const consent = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await consent.question("");
      consent.close();
      if (answer.trim().toLowerCase() !== "y") {
        process.stdout.write("Chat cancelled before sending a request.\n");
        return;
      }
    }

    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const messages: Array<{ readonly role: "user" | "assistant"; readonly content: string }> = [];
    let modelRequestsUsed = 0;
    let activeController: AbortController | undefined;
    let stopRequested = false;
    terminal.on("SIGINT", () => {
      if (activeController !== undefined) {
        activeController.abort();
      } else {
        stopRequested = true;
        terminal.close();
      }
    });
    process.stdout.write("Chat ready. Enter /exit to finish; Ctrl+C cancels the active request.\n");
    try {
      while (!stopRequested && modelRequestsUsed < 40) {
        let input: string;
        try {
          input = await terminal.question("You> ");
        } catch {
          break;
        }
        if (input.trim() === "/exit" || input.trim() === "/quit") {
          break;
        }
        if (input.length === 0) {
          continue;
        }
        if (input.length > 8_000) {
          process.stdout.write("Message too long; the maximum is 8,000 characters.\n");
          continue;
        }
        messages.push({ role: "user", content: input });
        const controller = new AbortController();
        activeController = controller;
        try {
          const result = await runToolLoop(
            selected.provider,
            selected.model,
            messages.slice(-40),
            [],
            { maxModelRequests: 40 - modelRequestsUsed, maxToolActions: 0, signal: controller.signal },
          );
          modelRequestsUsed += result.modelRequests;
          messages.push({ role: "assistant", content: result.content });
          process.stdout.write(`TaskForge> ${result.content}\n`);
        } catch (error: unknown) {
          if (error instanceof ModelProviderError) {
            process.stderr.write(`Chat request failed: ${error.message}\n`);
          } else {
            process.stderr.write("Chat request failed with an unexpected error.\n");
          }
          if (controller.signal.aborted) {
            stopRequested = true;
          }
        } finally {
          activeController = undefined;
        }
      }
      if (modelRequestsUsed >= 40) {
        process.stdout.write("Chat model-request budget reached. Start a new session to continue.\n");
      }
    } finally {
      terminal.close();
    }
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "Unable to start chat with the selected provider.";
    process.stderr.write(`Chat setup error: ${message}\n`);
    process.exitCode = 2;
  }
}

if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) {
  process.stdout.write(helpText);
} else if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) {
  process.stdout.write(`${packageJson.version}\n`);
} else if (args.length === 1 && args[0] === "config") {
  try {
    const configuration = loadConfiguration();
    process.stdout.write(`${formatConfigurationSummary(configuration)}\n`);
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "Unable to load configuration.";
    process.stderr.write(`Configuration error: ${message}\n`);
    process.exitCode = 2;
  }
} else if (args.length === 1 && args[0] === "doctor") {
  await runDoctor();
} else if (args.length === 1 && args[0] === "model-check") {
  await runModelCheck();
} else if (args.length === 1 && args[0] === "chat") {
  await runChat();
} else if (args.length >= 1 && args[0] === "permissions") {
  await runPermissionsCommand(args.slice(1));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "csv-analyze") {
  await runCsvWorkflowCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "repo-inspect") {
  await runRepositoryInspectionCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-analyze") {
  await runDocumentAnalysisCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-convert") {
  await runDocumentConversionCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "software-check") {
  await runSoftwareCheckCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "source-review") {
  await runSourceReviewCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "pdf-report") {
  await runPdfReportCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "file-patch") {
  await runFilePatchCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "file-move") {
  await runFileMoveCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "git-diff") {
  await runGitDiffCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "model-investigate") {
  await runModelInvestigationCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "github-issues") {
  await runGitHubIssuesCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "draft") {
  await runDraftCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "specialist-review") {
  await runSpecialistReviewCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "research") {
  await runResearchCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "browser-audit") {
  await runBrowserAuditCommand(args.slice(2));
} else if (args.length >= 1 && args[0] === "resume") {
  const runId = args[1];
  if (runId === undefined || args.length < 3) {
    process.stderr.write("Expected resume <run-id> --input <path>.\n");
    process.exitCode = 1;
  } else {
    await resumeWorkflowCommand(runId, args.slice(2));
  }
} else if (args.length === 2 && args[0] === "history" && args[1] === "list") {
  await listRunHistory();
} else if (args.length >= 1 && args[0] === "schedule") {
  await runScheduleCommand(args.slice(1));
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
