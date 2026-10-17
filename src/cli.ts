#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { mkdtemp, open, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { ConfigurationError, formatStoreConfigurationSummary, loadLocalEnvironmentFile, loadProviderConfiguration, loadStoreConfiguration } from "./config/configuration.js";
import { AgentBudgetLedger, AgentToolError, runToolLoop } from "./agent/tool-loop.js";
import { createCsvAnalysisTool, createDocumentAnalysisTool, createPatchProposalTool, TASKFORGE_AGENT_SYSTEM_MESSAGE } from "./agent/session-tools.js";
import { runTasksCommand } from "./cli/commands/tasks.js";
import { runGitHubIssuesCommand } from "./cli/commands/github-issues.js";
import { runDeploymentTraceCommand } from "./cli/commands/deployment-trace.js";
import { runArchitectureReportCommand, runRepositoryInspectionCommand, runSourceReviewCommand } from "./cli/commands/repository-inspection.js";
import { runScheduleCommand } from "./cli/commands/scheduling.js";
import { resumeWorkflowCommand, runCsvWorkflowCommand, runDocumentAnalysisCommand, runDocumentConversionCommand } from "./cli/commands/data-documents.js";
import { runDraftCommand, runPdfReportCommand } from "./cli/commands/artifacts.js";
import { PersistentFolderApprovalError } from "./cli/command-errors.js";
import { runSpecialistReview, type SpecialistTask, SpecialistReviewError } from "./agent/specialist-review.js";
import {
  DatabasePersistenceError,
  DatabaseShutdownError,
  PersistenceInputError,
  type FolderApproval,
} from "./storage/types.js";
import type { TaskForgeStore } from "./storage/store.js";
import { connectTaskForgeStore } from "./storage/store-factory.js";
import { createModelProvider } from "./providers/create-provider.js";
import { ModelProviderError, type ProviderMessage } from "./providers/types.js";
import { PathPolicyError, WorkspacePathPolicy } from "./security/path-policy.js";
import { runCsvAnalysisWorkflow } from "./workflows/csv-analysis-workflow.js";
import { analyzeDocument } from "./workflows/document-analysis-workflow.js";
import { runReviewedCommand, validateSelectedNodeTestPath, type ReviewedCommandId, ReviewedCommandError } from "./tools/software/reviewed-command.js";
import { redactSourceForDisplay, reviewSourceFiles, SourceReviewError } from "./workflows/source-review-workflow.js";
import { ActionApprovalRegistry, ApprovalError } from "./security/approval-preview.js";
import { prepareFilePatch, prepareGeneratedFilePatch, applyPreparedFilePatch, PatchApplicationError } from "./tools/software/patch-application.js";
import { GitDiffReviewError, listGitDiffFiles, readGitDiff } from "./tools/software/git-diff-review.js";
import { investigateSource, ModelInvestigationError } from "./tools/software/model-investigation.js";
import { escapeTerminalControls } from "./security/terminal-text.js";
import { BrowserSearchError, GroqBrowserResearch } from "./integrations/groq-browser-search.js";
import {
  BrowserAuditError, browserAuditExitCode, runBrowserAudit, runPublicBrowserAudit,
  validateApprovedBrowserOrigin, validateBrowserJourney, validateLoopbackBrowserTarget, validatePublicBrowserTarget,
  type BrowserAuditResult, type BrowserJourneyStep,
} from "./workflows/browser-audit-workflow.js";
import { DataSpecialistEvidenceError, prepareDataSpecialistEvidence } from "./workflows/data-specialist-evidence.js";

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version | config | doctor | model-check | do <instruction> | chat | tasks list | tasks inspect <task-id> | tasks validate <task-id> --inputs-json <object> | permissions approve/list/revoke | run architecture-report --root <directory> --file <relative-path>... | run deployment-trace --repository <owner/name> --project-id <prj_id> [--team-id <team_id>] | run csv-analyze --input <path> [--numeric-column <header>]... [--output <new.json|csv|md>] | run document-analyze --input <path> [--output <new.json|csv|md>] | run agent-fix --root <directory> --target <relative-source> --goal <instruction> --test <relative-test.mjs> | run data-specialist --input <path> --goal <question> | run browser-audit --url <url> [--journey <json-array>] [--origin <https-origin>]... [--specialist] | run document-convert --input <path> --output <new.txt> | run file-move --source <file> --target <new-file> | run ... | resume <run-id> --input <path> [--numeric-column <header>]... | history list | schedule ...]

The config command validates local settings and prints a redacted summary.
The doctor command checks the selected local SQLite or MongoDB storage and reports available setup areas.
The model-check command makes a synthetic read-only tool call through the selected model provider.
The chat command opens a bounded interactive conversation with the selected provider.
The do command sends one natural-language instruction to the selected provider. Agent-directed CSV and supported-document analysis require explicit file and stored-folder read approval.
The tasks command lists or inspects built-in validated declarative task definitions; validate checks one definition's JSON inputs. These definitions cannot grant permissions or execute code, and tasks are not yet executable.
The csv-analyze workflow reads one explicitly approved CSV file, stores redacted run metadata, and can calculate exact selected-column decimal totals with --numeric-column.
The repo-inspect workflow inventories one explicitly approved repository root without reading file contents or running commands.
The source-review workflow reads only explicitly selected source files and displays bounded, locally redacted content; it does not send or persist source.
The architecture-report workflow analyzes only an exact approved set of explicitly selected files, reports line evidence and labeled inferences, and never executes source or walks the repository.
The file-patch workflow shows redacted current and replacement text, then applies one content-bound replacement only after exact approval.
The agent-fix workflow sends one explicitly approved, heuristically redacted source file and goal to the selected model, previews a full-file candidate, applies it only after a separate exact approval, then asks permission to run one selected Node test. It cannot read other files or create commits.
The file-move workflow moves one supported document or data file after exact approval; source read/write and destination write folder grants are required, and the destination must be on the same filesystem volume.
The git-diff workflow displays a bounded, locally redacted staged diff after exact root and file approval; it does not call a model or persist source.
The model-investigate workflow sends selected, heuristically redacted source to the configured model only after an additional explicit transfer confirmation; it runs no tools and persists no source or findings.
The github-issues workflow reads at most 20 open issue titles from one public repository without a token; it excludes pull requests and writes nothing.
The deployment-trace workflow reads up to 25 GitHub Actions runs and Vercel deployments for an exact repository and project, makes only bounded GET requests, and joins matching commit SHAs. Vercel access uses TASKFORGE_VERCEL_TOKEN from the local environment; no deployment action is performed.
The draft workflow creates a new local Markdown GitHub issue or email draft from an explicitly approved JSON input; it never contacts GitHub or an email service.
The specialist-review workflow sends approved, heuristically redacted source excerpts to bounded read-only workers and asks the same configured model to review their findings; repository workers can use only literal search over those excerpts, the browser-specialist receives aggregate audit evidence, and the data-specialist receives a locally redacted sample from one approved file. Every local-content transfer requires a separate disclosure and confirmation.
The research workflow sends an approved query to Groq browser search, then displays bounded source metadata and an unverified answer; --compare <question> --against <question> runs two searches and shows source excerpts and exact shared URLs side by side without inferring source agreement.
The browser-audit workflow preserves approved loopback HTTP fixtures and supports public HTTPS audits only after exact target, read-only journey, and resource-origin approval. Public audits use fresh unauthenticated Chromium behind DNS-pinned egress controls; they block private/internal addresses, non-GET/HEAD methods, WebSockets, unapproved origins, and over-budget requests. The bounded journey supports exact visible text, a same-origin GET search with exactly one named search field, classified read-only same-origin link navigation, and browser back; arbitrary form submissions remain blocked. Each audit also collects bounded screenshots, DOM, console/network, auth-gate, responsiveness, accessibility, visual-style, and same-origin route evidence. Blocked-resource inventory is distinct from valid public HTTPS data-origin candidates, and neither is accessed without explicit approval. Page-based GET classification is heuristic and cannot establish server-side behavior; audits do not certify that every GET is side-effect-free. Findings and coverage limitations are reported without claiming a comprehensive security or accessibility certification. --specialist optionally sends only aggregate evidence to the configured specialist after a separate provider disclosure and confirmation.
The document-analyze workflow parses one approved TXT, Markdown, text PDF, DOCX, or XLSX file and stores counts only; optional JSON, CSV, or Markdown exports contain counts only and require separate output approval.
The document-convert workflow extracts one approved document to a new bounded plain-text artifact after preview and hash confirmation.
The schedule command stores one-time or recurring CSV/document workflows; execution occurs only while its foreground scheduler is running and every occurrence requires fresh interactive approval.
The pdf-report workflow renders an approved JSON report and creates a new approved PDF artifact after a content-bound confirmation.
The software-check workflow runs only an explicitly approved Node test suite, one explicitly selected in-root JavaScript test file, TypeScript no-emit check, or local TypeScript build in one approved root.
The resume command reacquires input-file approval, rechecks input and workflow hashes, then resumes an uncertain CSV or document analysis.
History list prints up to 50 redacted run summaries.
Permissions are stored in the selected TaskForge database. New installations use local SQLite; a configured MongoDB URI preserves the existing MongoDB selection unless TASKFORGE_STORAGE explicitly chooses a backend. Approvals are scoped to a canonical folder and exactly read or write access; revoke disables that scope.
`;

const args = process.argv.slice(2);

function inputPathArgument(commandArgs: readonly string[]): string | undefined {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--input") {
    return undefined;
  }
  const value = commandArgs[1];
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

type ApprovalQuestion = (prompt: string, signal?: AbortSignal) => Promise<string>;
type InputReadFailure = "cancelled" | "denied";

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function readApprovedInputFile(
  pathValue: string,
  askQuestion?: ApprovalQuestion,
  signal?: AbortSignal,
  reportFailure?: (failure: InputReadFailure) => void,
): Promise<Uint8Array | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("File workflows require an interactive terminal for explicit read approval.\n");
    process.exitCode = 2;
    reportFailure?.("denied");
    return undefined;
  }
  const absolutePath = resolve(pathValue);
  let answer: string;
  if (askQuestion !== undefined) {
    try {
      answer = await askQuestion(`Allow TaskForge to read this exact file? ${absolutePath} [y/N] `, signal);
    } catch {
      if (isSignalAborted(signal)) {
        reportFailure?.("cancelled");
        return undefined;
      }
      process.stderr.write("File read cancelled before access.\n");
      reportFailure?.("cancelled");
      return undefined;
    }
  } else {
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    try {
      answer = await consent.question(`Allow TaskForge to read this exact file? ${absolutePath} [y/N] `);
    } finally {
      consent.close();
    }
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("File read cancelled before access.\n");
    reportFailure?.("cancelled");
    return undefined;
  }
  if (isSignalAborted(signal)) {
    reportFailure?.("cancelled");
    return undefined;
  }
  try {
    const policy = new WorkspacePathPolicy();
    await requirePersistentFolderApproval(dirname(absolutePath), "read");
    if (isSignalAborted(signal)) {
      reportFailure?.("cancelled");
      return undefined;
    }
    await policy.approveRoot(dirname(absolutePath));
    const authorized = await policy.authorizePath(absolutePath, "read");
    if (isSignalAborted(signal)) {
      reportFailure?.("cancelled");
      return undefined;
    }
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
      if (isSignalAborted(signal)) {
        reportFailure?.("cancelled");
        return undefined;
      }
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
    reportFailure?.("denied");
    return undefined;
  }
}

async function withStore<T>(action: (store: TaskForgeStore) => Promise<T>): Promise<T | undefined> {
  let store: TaskForgeStore;
  try {
    store = await connectTaskForgeStore(loadStoreConfiguration());
  } catch {
    process.stderr.write("Unable to open the configured TaskForge storage. Check configuration and availability.\n");
    process.exitCode = 2;
    return undefined;
  }
  try {
    return await action(store);
  } finally {
    await store.close();
  }
}

async function requirePersistentFolderApproval(pathValue: string, access: "read" | "write"): Promise<void> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolve(pathValue));
  } catch {
    throw new PersistentFolderApprovalError();
  }
  const approved = await withStore((store) => store.hasFolderApproval(canonicalPath, access));
  if (approved !== true) throw new PersistentFolderApprovalError();
}

async function runPermissionsCommand(commandArgs: readonly string[]): Promise<void> {
  const action = commandArgs[0];
  if (action === "list" && (commandArgs.length === 1 || (commandArgs.length === 2 && commandArgs[1] === "--all"))) {
    let approvals: readonly FolderApproval[] | undefined;
    try {
      approvals = await withStore((store) => store.listFolderApprovals(commandArgs[1] === "--all"));
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
    changed = await withStore(async (store) => action === "approve"
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

async function listRunHistory(): Promise<void> {
  let history: { readonly runs: Awaited<ReturnType<TaskForgeStore["listRunSummaries"]>>; readonly artifacts: ReadonlyMap<string, Awaited<ReturnType<TaskForgeStore["listArtifactReferences"]>>> } | undefined;
  try {
    history = await withStore(async (store) => {
      const runs = await store.listRunSummaries();
      const artifacts = new Map<string, Awaited<ReturnType<TaskForgeStore["listArtifactReferences"]>>>();
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

async function runSoftwareCheckCommand(commandArgs: readonly string[]): Promise<void> {
  const rootValue = commandArgs[1];
  const checkValue = commandArgs[3];
  const selectedTestFile = commandArgs.length === 6 && commandArgs[4] === "--test" ? commandArgs[5] : undefined;
  if (
    (commandArgs.length !== 4 && selectedTestFile === undefined) || commandArgs[0] !== "--root" || rootValue === undefined ||
    rootValue.trim().length === 0 || commandArgs[2] !== "--check" ||
    (checkValue !== "node-test" && checkValue !== "typescript-check" && checkValue !== "typescript-build") ||
    (selectedTestFile !== undefined && checkValue !== "node-test")
  ) {
    process.stderr.write("Expected --root <directory> --check <node-test|typescript-check|typescript-build> [--test <relative-file for node-test>].\n");
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
    const commandLabel = command === "node-test"
      ? selectedTestFile === undefined
        ? "node --test (runs the repository test code)"
        : `node --test for ${escapeTerminalControls(selectedTestFile)} (runs that repository test file)`
      : command === "typescript-check" ? "local TypeScript compiler --noEmit" : "local TypeScript compiler build (temporary output is removed after the check; configured outFile is rejected)";
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

    const controller = new AbortController();
    const handleInterrupt = (): void => controller.abort();
    process.once("SIGINT", handleInterrupt);
    let result: Awaited<ReturnType<typeof runReviewedCommand>> | undefined;
    try {
      result = await withStore((store) => runReviewedCommand(store, approvedRoot, policy, command, selectedTestFile, controller.signal));
    } finally {
      process.removeListener("SIGINT", handleInterrupt);
    }
    if (result !== undefined) {
      process.stdout.write(
        `Run ${result.run.runId} ${result.status}: ${result.command}; ` +
        `exit=${result.exitCode === null ? "unavailable" : result.exitCode}; ` +
        `duration=${result.durationMs}ms; observed output bytes=${result.observedOutputBytes}` +
        `${result.outputTruncated ? " (capture limit reached)" : ""}. Output was not displayed or persisted.\n`,
      );
      if (result.status === "cancelled") process.exitCode = 130;
      else if (result.status !== "passed") process.exitCode = 3;
    }
  } catch (error: unknown) {
    const message = error instanceof ReviewedCommandError || error instanceof PersistentFolderApprovalError ? error.message : "Software check failed safely.";
    process.stderr.write(`Software check failed: ${message}\n`);
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

async function runAgentFixCommand(commandArgs: readonly string[]): Promise<void> {
  const values = new Map<string, string>();
  for (let index = 0; index < commandArgs.length;) {
    const key = commandArgs[index];
    const value = commandArgs[index + 1];
    if ((key !== "--root" && key !== "--target" && key !== "--goal" && key !== "--test") ||
        value === undefined || values.has(key)) {
      process.stderr.write("Expected --root <directory> --target <relative-source-file> --goal <instruction> --test <relative-test-file>.\n");
      process.exitCode = 1;
      return;
    }
    values.set(key, value);
    index += 2;
  }
  const rootValue = values.get("--root");
  const target = values.get("--target");
  const goal = values.get("--goal");
  const testFile = values.get("--test");
  if (values.size !== 4 || rootValue === undefined || target === undefined || goal === undefined || testFile === undefined ||
      goal.trim().length === 0 || Buffer.byteLength(goal, "utf8") > 2_000) {
    process.stderr.write("Provide a root, one relative source target, a goal up to 2,000 bytes, and one relative Node test file.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Agent fixes require an interactive terminal for source transfer, patch, and check approval.\n");
    process.exitCode = 2;
    return;
  }

  let rootPath: string;
  let providerConfiguration;
  try {
    rootPath = await realpath(resolve(rootValue));
    providerConfiguration = loadProviderConfiguration();
  } catch (error: unknown) {
    process.stderr.write(error instanceof ConfigurationError ? `Agent fix setup error: ${error.message}\n` : "The approved repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Read this exact target and check path in the approved root?\nRoot: ${escapeTerminalControls(rootPath)}\nTarget: ${escapeTerminalControls(target)}\nGoal: ${escapeTerminalControls(goal)}\nVerification test: ${escapeTerminalControls(testFile)}\nOnly a locally heuristically redacted target excerpt may be sent to the selected provider. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Agent fix cancelled before repository access.\n");
    return;
  }

  const controller = new AbortController();
  const handleInterrupt = (): void => controller.abort();
  process.once("SIGINT", handleInterrupt);
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await requirePersistentFolderApproval(root.path, "read");
    await requirePersistentFolderApproval(root.path, "write");
    const selectedTest = await validateSelectedNodeTestPath(root, policy, testFile);
    const targetPath = resolve(root.path, target);
    const targetIsTest = process.platform === "win32"
      ? targetPath.toLowerCase() === selectedTest.canonicalPath.toLowerCase()
      : targetPath === selectedTest.canonicalPath;
    if (targetIsTest) throw new ReviewedCommandError("The patch target and verification test must be different files.");
    const files = await reviewSourceFiles(root, policy, [target]);
    const file = files[0];
    if (file === undefined || file.content.includes("[REDACTED:")) {
      throw new SourceReviewError("The selected source contains redacted credential-like text; full-file generated replacement is refused to avoid copying or deleting hidden material.");
    }
    const transferText = `${file.path}\n${file.content}\n\nGoal: ${goal}`;
    if (Buffer.byteLength(transferText, "utf8") > 24 * 1024) throw new SourceReviewError("The target and goal exceed the 24 KiB model-input limit.");
    process.stdout.write(`\n--- REDACTED SOURCE ${file.path} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${escapeTerminalControls(file.content)}\n`);
    const provider = createModelProvider(providerConfiguration);
    const transferConsent = createInterface({ input: process.stdin, output: process.stdout });
    let transferAnswer: string;
    try {
      transferAnswer = await transferConsent.question(`Send this exact redacted source and goal to ${providerConfiguration.kind} (${provider.model}) to generate a full-file replacement? Redaction can miss secrets. The model has only a replacement-proposal tool; it cannot read files, run commands, or write. [y/N] `);
    } finally {
      transferConsent.close();
    }
    if (transferAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Agent fix cancelled before provider transfer.\n");
      return;
    }

    let replacement: string | undefined;
    const result = await runToolLoop(
      provider.provider,
      provider.model,
      [
        { role: "system", content: "You are TaskForge's code change proposer. You may only call propose_replacement with a complete replacement for the single supplied source file. Do not claim changes were applied or tests run. If the request is unclear, explain the ambiguity without calling the tool. Preserve unrelated behavior and avoid adding dependencies or permission expansion." },
        { role: "user", content: `Target: ${file.path}\nGoal: ${goal}\nCurrent redacted source:\n${file.content}` },
      ],
      [createPatchProposalTool((value) => { replacement = value; })],
      { maxModelRequests: 8, maxToolActions: 1, signal: controller.signal },
    );
    if (replacement === undefined) {
      if (result.content.length > 0) process.stdout.write(`TaskForge> ${escapeTerminalControls(result.content)}\n`);
      process.stdout.write("No replacement preview was generated; the target was not changed.\n");
      return;
    }
    if (redactSourceForDisplay(replacement) !== replacement) {
      throw new PatchApplicationError("The generated replacement contains credential-like text that would be hidden in the review; candidate refused.");
    }
    const approvals = new ActionApprovalRegistry(policy);
    const prepared = await prepareGeneratedFilePatch(root, policy, approvals, target, replacement);
    const current = await reviewSourceFiles(root, policy, [target]);
    const currentFile = current[0];
    if (currentFile === undefined || currentFile.content.includes("[REDACTED:")) {
      approvals.discard(prepared.preview.previewId);
      throw new SourceReviewError("The target changed or contains credential-like text; generated preview discarded.");
    }
    process.stdout.write(`\n--- CURRENT ${escapeTerminalControls(currentFile.path)} (SHA-256 of replacement ${prepared.sha256}) ---\n${escapeTerminalControls(currentFile.content)}\n`);
    process.stdout.write(`\n--- GENERATED REPLACEMENT (SHA-256 ${prepared.sha256}) ---\n${escapeTerminalControls(redactSourceForDisplay(prepared.content))}\n`);
    const patchConsent = createInterface({ input: process.stdin, output: process.stdout });
    let patchAnswer: string;
    try {
      patchAnswer = await patchConsent.question(`Apply this exact generated replacement to ${prepared.preview.targetPath}? The current target snapshot is bound to this preview and revalidated before writing. [y/N] `);
    } finally {
      patchConsent.close();
    }
    if (patchAnswer.trim().toLowerCase() !== "y") {
      approvals.discard(prepared.preview.previewId);
      process.stdout.write("Generated patch declined; target unchanged.\n");
      return;
    }
    const approval = approvals.approve(prepared.preview.previewId);
    await applyPreparedFilePatch(prepared, approval, approvals);
    process.stdout.write(`Generated replacement applied to ${prepared.preview.targetPath}. Now approve the relevant fixed Node test.\n`);
    await runSoftwareCheckCommand(["--root", root.path, "--check", "node-test", "--test", testFile]);
  } catch (error: unknown) {
    const message = error instanceof PatchApplicationError || error instanceof SourceReviewError || error instanceof PersistentFolderApprovalError
      ? error.message
      : error instanceof ModelProviderError ? error.message : "Agent fix failed safely; inspect the target before retrying.";
    process.stderr.write(`Agent fix failed: ${message}\n`);
    process.exitCode = controller.signal.aborted || (error instanceof ModelProviderError && error.kind === "cancelled") ? 130 : 3;
  } finally {
    process.off("SIGINT", handleInterrupt);
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
    const approvedSourceText = files.map((file) => `${file.path}\n${file.content}`).join("\n\n");
    const sourceLookup: import("./agent/tool-loop.js").AgentTool = {
      definition: {
        name: "search_approved_source",
        description: "Search the already approved, heuristically redacted source excerpts for literal text and return a few matching lines. This tool cannot access other files.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", minLength: 1, maxLength: 200 } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      validateArguments(value: unknown): unknown {
        if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 ||
            !("query" in value) || typeof value.query !== "string" || value.query.trim().length === 0 || value.query.length > 200) {
          throw new SpecialistReviewError("The source search query must be 1–200 characters.");
        }
        return { query: value.query };
      },
      async execute(value: unknown): Promise<string> {
        if (typeof value !== "object" || value === null || Array.isArray(value) || !("query" in value) || typeof value.query !== "string") {
          throw new SpecialistReviewError();
        }
        const needle = value.query.toLocaleLowerCase("en-US");
        const matches: string[] = [];
        for (const file of files) {
          const lines = file.content.split(/\r?\n/u);
          for (let index = 0; index < lines.length && matches.length < 20; index += 1) {
            const line = lines[index];
            if (line !== undefined && line.toLocaleLowerCase("en-US").includes(needle)) {
              matches.push(`${file.path}:${index + 1}: ${line.slice(0, 500)}`);
            }
          }
          if (matches.length >= 20) break;
        }
        return matches.length === 0 ? "No matching lines in the approved excerpts." : matches.join("\n").slice(0, 8_000);
      },
    };
    const transferConsent = createInterface({ input: process.stdin, output: process.stdout });
    let transferAnswer: string;
    try {
      transferAnswer = await transferConsent.question(
        `Send these exact redacted excerpts and goal to ${providerConfiguration.kind} (${provider.model}) for up to two specialists and one parent review? Workers can use only a literal search tool over these excerpts (40 model requests, 30 search actions maximum); no other file, network, persistence, or write tools are available. Redaction may miss secrets. [y/N] `,
      );
    } finally {
      transferConsent.close();
    }
    if (transferAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Specialist review cancelled before provider transfer.\n");
      return;
    }
    const ledger = new AgentBudgetLedger(40, 30);
    const result = await runSpecialistReview(provider.provider, provider.model, goal, approvedSourceText, roles, ledger, controller.signal, [sourceLookup]);
    for (const worker of result.workers) {
      process.stdout.write(`\nSpecialist ${worker.role}: ${worker.status}${worker.failureKind === undefined ? "" : ` (${worker.failureKind})`}${worker.toolNames === undefined ? "" : `; tools=${worker.toolNames.join(",")}`}\n${worker.findings ?? "No finding available."}\n`);
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

async function runResearchCommand(commandArgs: readonly string[]): Promise<void> {
  const comparison = commandArgs.length === 4 && commandArgs[0] === "--compare" && commandArgs[2] === "--against";
  const queryMode = commandArgs.length === 2 && commandArgs[0] === "--query";
  if ((!comparison && !queryMode) || commandArgs[1] === undefined || commandArgs[1].trim().length === 0 || commandArgs[1].length > 512 ||
      (comparison && (commandArgs[3] === undefined || commandArgs[3].trim().length === 0 || commandArgs[3].length > 512))) {
    process.stderr.write("Expected --query <question> or --compare <question> --against <question>, each 1–512 characters.\n");
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
    const leftQuery = commandArgs[1].trim();
    const rightQuery = comparison ? commandArgs[3]?.trim() : undefined;
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(
        comparison
          ? `Send these exact queries as two separate searches to Groq browser search (${provider.model})? Results will show inline citations mapped to retrieved excerpts, flag uncited sentences, and identify exact shared source URLs. Citation mapping does not prove semantic support or whether sources agree. No project files are sent and no results are persisted. [y/N]\nA: ${escapeTerminalControls(leftQuery)}\nB: ${escapeTerminalControls(rightQuery ?? "")}\n> `
          : `Send this exact query to Groq browser search (${provider.model})? Groq reports search is powered by Exa. No project files are sent and no results are persisted. [y/N]\n${escapeTerminalControls(leftQuery)}\n> `,
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
      const research = new GroqBrowserResearch(provider);
      if (comparison && rightQuery !== undefined) {
        const result = await research.compare(leftQuery, rightQuery, controller.signal);
        const printSide = (label: string, side: typeof result.left): void => {
          process.stdout.write(`\n${label} answer (model synthesis; unverified; retrieved ${side.retrievedAt}):\n${escapeTerminalControls(side.answer)}\n\n${label} sources and excerpts (${side.sources.length}):\n`);
          for (const source of side.sources) {
            process.stdout.write(`- ${escapeTerminalControls(source.title)}\n  ${escapeTerminalControls(source.url)}\n  ${escapeTerminalControls(source.excerpt)}\n`);
          }
          printResearchCitationStatus(label, side);
        };
        printSide("A", result.left);
        printSide("B", result.right);
        process.stdout.write(`\nShared source URLs (${result.sharedSourceUrls.length}; exact URL matches only):\n${result.sharedSourceUrls.map((url) => `- ${url}`).join("\n") || "None"}\nCompare the excerpts directly; no claim-level agreement or contradiction was inferred.\n`);
      } else {
        const result = await research.search(leftQuery, controller.signal);
        process.stdout.write(`Research answer (unverified; retrieved ${result.retrievedAt}; model ${result.model}):\n${escapeTerminalControls(result.answer)}\n\nSources (${result.sources.length}):\n`);
        for (const source of result.sources) {
          process.stdout.write(`- ${escapeTerminalControls(source.title)}\n  ${escapeTerminalControls(source.url)}\n  ${escapeTerminalControls(source.excerpt)}\n`);
        }
        printResearchCitationStatus("", result);
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

function printResearchCitationStatus(label: string, result: Awaited<ReturnType<GroqBrowserResearch["search"]>>): void {
  const prefix = label.length === 0 ? "" : `${label} `;
  process.stdout.write(`\n${prefix}Citation mapping: ${result.citations.length} inline reference(s) mapped to validated retrieved URLs; this validates provenance only, not semantic support.\n`);
  for (const citation of result.citations) {
    process.stdout.write(`- ${citation.marker} -> ${escapeTerminalControls(citation.source.url)} (${escapeTerminalControls(citation.source.title)}): ${escapeTerminalControls(citation.source.excerpt)}\n`);
  }
  if (result.unmappedCitations.length > 0) {
    process.stdout.write(`${prefix}Unmapped citation marker(s): ${result.unmappedCitations.map(escapeTerminalControls).join(", ")}\n`);
  }
  if (result.uncitedStatements.length > 0) {
    process.stdout.write(`${prefix}Sentence(s) without an inline citation (heuristic): ${result.uncitedStatements.slice(0, 8).map(escapeTerminalControls).join(" | ")}\n`);
  }
}

async function runEvidenceSpecialistReview(
  role: "browser-specialist" | "data-specialist",
  goal: string,
  evidence: string,
  providerConfiguration: ReturnType<typeof loadProviderConfiguration>,
  signal: AbortSignal,
): Promise<boolean> {
  if (Buffer.byteLength(goal, "utf8") > 2_000 || Buffer.byteLength(evidence, "utf8") > 24 * 1024) {
    throw new SpecialistReviewError("Specialist goal or evidence exceeds its bounded transfer limit.");
  }
  const selected = createModelProvider(providerConfiguration);
  const isOnline = providerConfiguration.kind !== "ollama";
  const transferKind = isOnline
    ? `send this exact evidence and goal to the configured online ${providerConfiguration.kind} model (${selected.model})`
    : `send this exact evidence and goal to the configured local Ollama model (${selected.model}); the content stays on this device`;
  process.stdout.write(`\nExact goal proposed for transfer:\n${escapeTerminalControls(goal)}\nExact evidence proposed for transfer (${Buffer.byteLength(evidence, "utf8")} bytes; no filesystem path or website URL is included):\n${escapeTerminalControls(evidence)}\n`);
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(
      `Approve ${transferKind} for one ${role} and one parent review? The specialist has no tools; both share at most 40 model requests, 30 tool actions, a 120-second runtime, and zero automatic retries. Redaction and evidence are bounded but may still contain sensitive page or file values. Results are unverified and are not persisted. [y/N] `,
    );
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Specialist review cancelled before provider transfer.\n");
    return false;
  }
  const ledger = new AgentBudgetLedger(40, 30);
  const result = await runSpecialistReview(selected.provider, selected.model, goal, evidence,
    [{ role, goal: role === "browser-specialist" ? "Review the supplied audit findings and coverage limitations." : "Analyze the supplied bounded sample and state its limitations." }],
    ledger, signal);
  const worker = result.workers[0];
  process.stdout.write(`\nSpecialist ${role}: ${worker?.status ?? "failed"}${worker?.failureKind === undefined ? "" : ` (${worker.failureKind})`}\n${worker?.findings ?? "No finding available."}\n`);
  process.stdout.write(`\nParent review (${result.parentReviewStatus}${result.parentFailureKind === undefined ? "" : `, ${result.parentFailureKind}`}; unverified):\n${result.parentReview ?? "Not completed; inspect the supplied evidence and specialist result manually."}\n`);
  process.stdout.write(`Budget used: ${result.budget.modelRequests} model requests, ${result.budget.toolActions} tool actions. No tools were available and no files or browser pages were reread.\n`);
  return worker?.status === "complete" && result.parentReviewStatus === "complete";
}

async function runDataSpecialistCommand(commandArgs: readonly string[]): Promise<void> {
  let inputPath: string | undefined;
  let goal: string | undefined;
  for (let index = 0; index < commandArgs.length; index += 2) {
    const option = commandArgs[index];
    const value = commandArgs[index + 1];
    if (value === undefined || value.trim().length === 0) {
      process.stderr.write("Expected --input <file> --goal <analysis-question>.\n");
      process.exitCode = 1;
      return;
    }
    if (option === "--input" && inputPath === undefined) inputPath = value;
    else if (option === "--goal" && goal === undefined && Buffer.byteLength(value, "utf8") <= 2_000) goal = value;
    else {
      process.stderr.write("Expected one --input and one --goal within 2,000 UTF-8 bytes.\n");
      process.exitCode = 1;
      return;
    }
  }
  if (inputPath === undefined || goal === undefined) {
    process.stderr.write("Expected --input <file> --goal <analysis-question>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Data specialist analysis requires interactive exact-file and provider-transfer approval.\n");
    process.exitCode = 2;
    return;
  }
  let providerConfiguration: ReturnType<typeof loadProviderConfiguration>;
  try { providerConfiguration = loadProviderConfiguration(); } catch (error: unknown) {
    process.stderr.write(`Data specialist setup error: ${error instanceof ConfigurationError ? error.message : "the selected model provider is not configured"}\n`);
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    const input = await readApprovedInputFile(inputPath);
    if (input === undefined) return;
    const evidence = await prepareDataSpecialistEvidence(extname(inputPath).toLowerCase(), input);
    const evidenceText = JSON.stringify(evidence);
    const complete = await runEvidenceSpecialistReview("data-specialist", goal, evidenceText, providerConfiguration, controller.signal);
    if (!complete) process.exitCode = 3;
  } catch (error: unknown) {
    const message = error instanceof DataSpecialistEvidenceError || error instanceof PersistentFolderApprovalError ||
      error instanceof ConfigurationError || error instanceof ModelProviderError || error instanceof SpecialistReviewError
      ? error.message
      : "Data specialist analysis failed safely; file content and findings were not persisted.";
    process.stderr.write(`Data specialist analysis failed: ${message}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

async function saveBrowserAuditScreenshots(
  screenshots: BrowserAuditResult["metrics"]["pageDiagnostics"]["screenshots"],
): Promise<readonly string[]> {
  if (screenshots.length === 0) return [];
  const directory = await mkdtemp(join(tmpdir(), "taskforge-browser-audit-"));
  const paths: string[] = [];
  for (const screenshot of screenshots) {
    const path = join(directory, `${screenshot.stage}.png`);
    await writeFile(path, screenshot.png, { flag: "wx" });
    paths.push(path);
  }
  return paths;
}

function escapeBrowserAuditDisplay(value: string): string {
  return escapeTerminalControls(value).replace(/\p{Cf}/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
  });
}

async function runBrowserAuditCommand(commandArgs: readonly string[]): Promise<void> {
  let targetValue: string | undefined;
  let journeyValue: string | undefined;
  const rawOrigins: string[] = [];
  let withSpecialist = false;
  let manualLogin = false;
  for (let index = 0; index < commandArgs.length;) {
    const option = commandArgs[index];
    if (option === "--specialist" && !withSpecialist) {
      withSpecialist = true;
      index += 1;
      continue;
    }
    if (option === "--manual-login" && !manualLogin) {
      manualLogin = true;
      index += 1;
      continue;
    }
    const value = commandArgs[index + 1];
    if (value === undefined || value.trim().length === 0) {
      process.stderr.write("Browser audit option values must be supplied.\n");
      process.exitCode = 1;
      return;
    }
    if (option === "--url" && targetValue === undefined) targetValue = value;
    else if (option === "--journey" && journeyValue === undefined) journeyValue = value;
    else if (option === "--origin" && rawOrigins.length < 7) rawOrigins.push(value);
    else {
      process.stderr.write("Expected --url <url> [--journey <json-array>] [--origin <https-origin>]... [--manual-login] [--specialist].\n");
      process.exitCode = 1;
      return;
    }
    index += 2;
  }
  if (targetValue === undefined) {
    process.stderr.write("Expected --url <loopback-http-url> or --url <public-https-url> --journey <json-array>.\n");
    process.exitCode = 1;
    return;
  }
  let target: URL;
  let isPublic = false;
  try {
    target = validateLoopbackBrowserTarget(targetValue);
  } catch (error: unknown) {
    try {
      target = validatePublicBrowserTarget(targetValue);
      isPublic = true;
    } catch (publicError: unknown) {
      process.stderr.write(`${publicError instanceof BrowserAuditError ? publicError.message : error instanceof BrowserAuditError ? error.message : "Browser audit target was rejected."}\n`);
      process.exitCode = 1;
      return;
    }
  }
  let approvedOrigins: readonly string[] = [];
  let journey: readonly BrowserJourneyStep[] | undefined;
  if (isPublic) {
    if (journeyValue === undefined) {
      process.stderr.write("Public-site browser audits require an explicit --journey JSON array.\n");
      process.exitCode = 1;
      return;
    }
    let rawJourney: unknown;
    try { rawJourney = JSON.parse(journeyValue); } catch {
      process.stderr.write("The browser journey must be valid JSON.\n");
      process.exitCode = 1;
      return;
    }
    try {
      journey = validateBrowserJourney(rawJourney);
      approvedOrigins = [...new Set(rawOrigins.map(validateApprovedBrowserOrigin))];
      if (approvedOrigins.includes(target.origin)) {
        process.stderr.write("The target origin is approved automatically; pass only additional resource origins.\n");
        process.exitCode = 1;
        return;
      }
    } catch (error: unknown) {
      process.stderr.write(`${error instanceof BrowserAuditError ? error.message : "Browser journey or origins were rejected."}\n`);
      process.exitCode = 1;
      return;
    }
  } else if (journeyValue !== undefined || rawOrigins.length > 0) {
    process.stderr.write("Journey and additional-origin options are only valid for public HTTPS audits.\n");
    process.exitCode = 1;
    return;
  }
  if (manualLogin && (!isPublic || withSpecialist)) {
    process.stderr.write("--manual-login requires a public HTTPS audit and cannot be combined with --specialist.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Browser audit requires interactive approval of the exact target, journey, and origins before navigation.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    const approvalDetails = isPublic
      ? `Target URL: ${escapeTerminalControls(target.toString())}\nJourney: ${escapeTerminalControls(JSON.stringify(journey))}\nAdditional resource origins: ${approvedOrigins.length === 0 ? "none" : approvedOrigins.map(escapeTerminalControls).join(", ")}\n${manualLogin ? "Mode: dedicated headed Chromium for owner-entered login; origins and exact authentication POST requests require separate prompts; the journey is approved again after login. No screenshots, DOM text, page content, profile, cookies, or session state are retained or sent to a specialist.\n" : ""}`
      : `Target URL: ${escapeTerminalControls(target.toString())}\n`;
    answer = await consent.question(
      `${approvalDetails}${manualLogin
        ? "Open this target in a fresh dedicated Chromium window with no personal profile or imported state? You will enter login data directly in the browser. TaskForge does not read or log credential fields or request bodies. Every additional origin and authentication POST needs exact owner approval, then the read-only journey needs separate approval. Browser memory and cookies are discarded when it closes. Page screenshots, DOM text, page content, and specialist handoff are disabled. WebSockets, other mutating methods, private-address DNS answers, and unapproved requests are blocked. [y/N] "
        : "Open this exact target in a fresh unauthenticated Chromium context? TaskForge will also run bounded page-load diagnostics, capture up to two local screenshots, inspect a capped DOM summary/text sample, observe console/network failures, and probe same-origin links with HEAD. Only the approved journey may navigate or search. No form is submitted. Non-GET/HEAD methods, WebSockets, unapproved origins, and private-address DNS answers are blocked. The browser is limited to 100 requests, 20 MiB network traffic, 8 tunnels, 45 seconds, 2 screenshots of at most 4 MiB each, and 2,000 inspected DOM elements per snapshot. No personal browser session or stored credentials are used. Screenshots and DOM samples stay local in temporary files/output; only aggregate findings are persisted. Page content cannot approve access or change the origin allowlist. [y/N] "}`,
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
  const manualConsent = manualLogin ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  let manualPromptQueue: Promise<void> = Promise.resolve();
  const askManual = async (prompt: string): Promise<boolean> => {
    if (manualConsent === undefined || controller.signal.aborted) return false;
    const answer = manualPromptQueue.then(async () => {
      if (controller.signal.aborted) return false;
      try {
        return (await manualConsent.question(prompt, { signal: controller.signal })).trim().toLowerCase() === "y";
      } catch {
        return false;
      }
    });
    manualPromptQueue = answer.then(() => undefined, () => undefined);
    return answer;
  };
  try {
    const manualInteraction = manualLogin ? {
      approveOrigin: (origin: string) => askManual(
        `Approve network access to this exact additional HTTPS origin before it is accessed? ${escapeBrowserAuditDisplay(origin)} [y/N] `,
      ),
      approveLoginPost: (origin: string, pathname: string) => askManual(
        `Approve this single authentication POST? ${escapeBrowserAuditDisplay(origin + pathname)} Request body and headers are not inspected or recorded. [y/N] `,
      ),
      completeLogin: () => askManual(
        "Dedicated Chromium is open. Sign in there locally, then return here. Credentials stay in the browser and are not captured. Press y when done to close the authentication-request window; requests already paused still require their own approval, and new non-GET/HEAD requests will be blocked. [y/N] ",
      ),
      approveJourney: (approvedJourney: readonly BrowserJourneyStep[]) => askManual(
        `Approve this exact read-only journey after login? ${escapeTerminalControls(JSON.stringify(approvedJourney))} No screenshots, DOM text, page content, or specialist handoff will be captured. [y/N] `,
      ),
    } : undefined;
    const result = await withStore((store) => isPublic
      ? runPublicBrowserAudit(store, target.toString(), { approvedOrigins, journey, ...(manualLogin ? { manualLogin: true } : {}) }, controller.signal, manualInteraction)
      : runBrowserAudit(store, target.toString(), controller.signal));
    if (result !== undefined) {
      const metrics = result.metrics;
      let screenshotPaths: readonly string[] = [];
      try { screenshotPaths = manualLogin ? [] : await saveBrowserAuditScreenshots(metrics.pageDiagnostics.screenshots); }
      catch { process.stderr.write("Screenshot bytes were captured but could not be saved to the local temporary folder.\n"); }
      process.stdout.write(
        `Run ${result.run.runId} ${metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed || metrics.journeyStepsFailed > 0 || metrics.runtimeLimitReached ? "incomplete" : "completed"}: navigation failed=${metrics.navigationFailed}, authentication gate detected=${metrics.authenticationGateDetected}, authentication gate scan incomplete=${metrics.authenticationGateDetectionIncomplete}, page inspection failed=${metrics.pageInspectionFailed}, design inspection failed=${metrics.designInspectionFailed}, journey=${metrics.journeyStepsCompleted}/${metrics.journeyStepsCompleted + metrics.journeyStepsFailed}, ` +
        `${metrics.httpErrorCount} HTTP errors, ${metrics.networkFailureCount} failed approved-origin requests excluding policy blocks, ${metrics.brokenLinkCount}/${metrics.linksChecked} same-origin links broken, ` +
        `${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ${metrics.missingAltCount} images without alt text, ` +
        `${metrics.unnamedControlCount} unnamed controls, mobile overflow=${metrics.mobileHorizontalOverflow}, desktop overflow=${metrics.desktopHorizontalOverflow}, ` +
        `${metrics.missingSecurityHeaderCount}/${metrics.securityHeadersChecked} passive headers missing, mixed-content=${metrics.mixedContentCheck} (${metrics.mixedContentRequestCount} requests), ` +
        `${metrics.blockedExternalRequestCount} unapproved resources blocked, ${metrics.blockedNavigationCount} out-of-scope document navigations or HTTP redirects blocked, ${metrics.blockedMutatingRouteCount} suspicious mutating-route requests blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ${metrics.blockedWebSocketCount} WebSockets blocked, ` +
        `${metrics.blockedPrivateAddressRequestCount} private DNS answers blocked, ${metrics.blockedRequestLimitCount} requests blocked at the limit, runtime-limit=${metrics.runtimeLimitReached}.\n`,
      );
      if (manualLogin) process.stdout.write("Manual-login privacy boundary: no authenticated-page screenshots, DOM snapshots/text, page text, responsive/accessibility/design inspection, or specialist handoff were captured. The temporary browser context was closed; cookies and in-memory session state were discarded.\n");
      const finalPathWithoutFormatControls = (manualLogin ? undefined : metrics.finalPath)?.replace(/\p{Cf}/gu, (character) => {
        const codePoint = character.codePointAt(0);
        return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
      });
      process.stdout.write(`Navigation evidence (local only): last approved-origin navigation status=${metrics.navigationHttpStatus ?? "unavailable"}, final path=${escapeTerminalControls(finalPathWithoutFormatControls ?? "unavailable")}, navigation redirects=${metrics.navigationRedirectCount}, bounded render wait=${metrics.renderWaitMs}ms (maximum ${2_500 * (journey === undefined ? 0 : journey.length * 2) + 2_500}ms across inspected page states), network-settle wait=${metrics.networkSettleWaitMs}ms (maximum 1,500ms per navigation state).\n`);
      process.stdout.write(`Autonomous page diagnostics (local only): ${metrics.pageDiagnostics.snapshots.length} bounded DOM snapshots; ${metrics.pageDiagnostics.screenshots.length} screenshots captured${metrics.pageDiagnostics.screenshotLimitReached ? " (a screenshot/evidence bound was reached)" : ""}.\n`);
      for (const snapshot of metrics.pageDiagnostics.snapshots) {
        process.stdout.write(`- ${snapshot.stage}: state=${snapshot.state}, HTTP=${snapshot.status ?? "unavailable"}, path=${escapeBrowserAuditDisplay(snapshot.path ?? "unavailable")}, title=${escapeBrowserAuditDisplay(snapshot.title || "(empty)")}, sampled text length=${snapshot.bodyTextLength}; headings=${snapshot.headings}, main=${snapshot.mainLandmarks}, forms=${snapshot.forms}, search=${snapshot.searchControls}, visible inputs/buttons/links=${snapshot.visibleInputs}/${snapshot.visibleButtons}/${snapshot.visibleLinks}, card-like elements=${snapshot.cardLikeElements}.\n`);
        if (snapshot.bodyTextSample.length > 0) process.stdout.write(`  Text sample (untrusted page content): ${escapeBrowserAuditDisplay(snapshot.bodyTextSample)}\n`);
      }
      if (screenshotPaths.length > 0) {
        process.stdout.write("Local screenshot evidence (not persisted or sent to a provider):\n");
        for (const screenshotPath of screenshotPaths) process.stdout.write(`- ${escapeBrowserAuditDisplay(screenshotPath)}\n`);
      }
      if (metrics.pageDiagnostics.observedFailures.length > 0) {
        process.stdout.write("Observed failures (request/DOM evidence only):\n");
        for (const failure of metrics.pageDiagnostics.observedFailures) process.stdout.write(`- ${escapeBrowserAuditDisplay(failure)}\n`);
      }
      if (metrics.pageDiagnostics.suspectedCauses.length > 0) {
        process.stdout.write("Suspected causes (not confirmed):\n");
        for (const cause of metrics.pageDiagnostics.suspectedCauses) process.stdout.write(`- ${escapeBrowserAuditDisplay(cause)}\n`);
      }
      if (metrics.pageDiagnostics.blockedDataResourceOrigins.length > 0 &&
          !metrics.authenticationGateDetected &&
          metrics.pageDiagnostics.snapshots.length > 0 &&
          metrics.pageDiagnostics.snapshots.every((snapshot) => snapshot.cardLikeElements === 0 && snapshot.state !== "incomplete" && snapshot.state !== "authentication-gated")) {
        process.stdout.write("Possible data-resource origin for owner review (not accessed; untrusted page activity cannot authorize it). Only consider a valid public HTTPS origin. To investigate, start a new run with this exact origin supplied using --origin; the CLI will ask for approval again:\n");
        for (const origin of metrics.pageDiagnostics.blockedDataResourceOrigins) process.stdout.write(`- ${escapeBrowserAuditDisplay(origin)}\n`);
      }
      process.stdout.write(manualLogin
        ? "Manual-login checks: separately approved authentication POST requests and approved-origin network failures are counted; authenticated page content, screenshots, DOM text, accessibility, responsiveness, and design are not inspected or retained.\n"
        : "Implemented checks: approved-origin HTTP/request failures, console/page errors, bounded same-origin HEAD link probes, missing image alt text, visible accessible-name heuristics, 360px/1280px horizontal overflow, selected passive response headers, sampled visual-style consistency heuristics, bounded DOM snapshots/screenshots, and capped observed/suspected diagnosis. Journey actions are limited to visible-text checks, one-field same-origin GET search, explicitly approved same-origin links, and browser back.\n");
      process.stdout.write(manualLogin
        ? "Manual-login limitations: authentication endpoint names do not establish server semantics; each exact query-free HTTPS POST still needs owner approval. Additional origins require approval before access. The browser context is temporary, but the website may retain server-side authentication state. This is not a security audit.\n"
        : "Coverage limitations: this is not a comprehensive security audit or WCAG assessment; visual consistency is inferred from sampled controls, without cross-page comparison. Approved cross-origin resources are observed but not followed unless their exact origin was approved. HTTP document redirects are blocked before following; redirect-based login/CDN flows are unsupported. No credentials are used; an observed authentication gate stops the journey. Arbitrary form submissions, button workflows, and dynamic content beyond bounded waits are unsupported. GET route heuristics cannot prove server-side handlers are side-effect-free. Page content and blocked origins are untrusted evidence and do not expand permissions; additional origins are requested only when blocked data requests plausibly relate to missing results.\n");
      if (metrics.journeyEvidence.length > 0) {
        process.stdout.write(manualLogin ? "Read-only journey step status (no page content):\n" : "Read-only journey evidence (page text is shown locally and not persisted):\n");
        for (const evidence of metrics.journeyEvidence) process.stdout.write(`- ${escapeTerminalControls(evidence)}\n`);
      }
      if (metrics.journeyFailureReasons.length > 0) {
        process.stdout.write("Journey steps not completed (bounded reason codes):\n");
        for (const reason of metrics.journeyFailureReasons) process.stdout.write(`- ${reason}\n`);
      }
      if (metrics.blockedResourceOrigins.length > 0) {
        process.stdout.write("Blocked resource inventory (not accessed; may include origins that cannot be approved):\n");
        for (const origin of metrics.blockedResourceOrigins) process.stdout.write(`- ${escapeTerminalControls(origin)}\n`);
      }
      if (!manualLogin) {
        process.stdout.write("Design observations (inferred; not original design tokens):\n");
        for (const observation of metrics.designObservations) process.stdout.write(`- ${escapeTerminalControls(observation)}\n`);
      }
      process.exitCode = browserAuditExitCode(result.run.state);
      if (withSpecialist && !controller.signal.aborted) {
        const providerConfiguration = loadProviderConfiguration();
        const findingsWithoutPrivateEvidence = (({ blockedResourceOrigins: _blockedResourceOrigins, journeyEvidence: _journeyEvidence, journeyFailureReasons: _journeyFailureReasons, finalPath: _finalPath, pageDiagnostics: _pageDiagnostics, ...shareableMetrics }) => shareableMetrics)(metrics);
        const evidence = JSON.stringify({
          findings: findingsWithoutPrivateEvidence,
          coverageLimitations: [
            "No page text, target URL, origin list, credentials, or session data is included.",
            "Browser observations are aggregate and heuristic; comprehensive security and WCAG checks were not performed.",
          ],
        });
        const complete = await runEvidenceSpecialistReview("browser-specialist", "Review these measured browser findings and explicitly reported coverage limitations.", evidence, providerConfiguration, controller.signal);
        if (!complete) process.exitCode = 3;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof BrowserAuditError || error instanceof ConfigurationError || error instanceof ModelProviderError || error instanceof SpecialistReviewError
      ? error.message
      : "Browser audit failed safely; no page content was persisted.";
    process.stderr.write(`${message}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    manualConsent?.close();
    process.removeListener("SIGINT", interrupt);
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
    const configuration = loadStoreConfiguration();
    process.stdout.write(`${formatStoreConfigurationSummary(configuration)}\n`);
    const store = await connectTaskForgeStore(configuration);
    try {
      await store.close();
    } catch {
      throw new DatabaseShutdownError();
    }
    process.stdout.write(`${configuration.kind === "local" ? "Local storage" : "MongoDB"}: available\n`);
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      process.stdout.write(`Storage configuration: invalid or incomplete. ${error.message}\n`);
    } else if (error instanceof DatabaseShutdownError) {
      process.stdout.write(`Storage check could not close cleanly. ${error.message}\n`);
    } else {
      process.stdout.write("Configured storage: unavailable or could not be checked.\n");
    }
    process.stdout.write(`Model provider: ${providerStatus}.\n`);
    process.stdout.write("Browser tooling: loopback fixtures and approval-controlled public HTTPS audits are available; live owner-approved acceptance remains pending.\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Model provider: ${providerStatus}.\n`);
  process.stdout.write("Browser tooling: loopback fixtures and approval-controlled public HTTPS audits are available; live owner-approved acceptance remains pending.\n");
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

function createCliCsvAnalysisTool(question: ApprovalQuestion) {
  return createCsvAnalysisTool(async (argumentsValue, signal) => {
    process.stdout.write(`Proposed action: analyze one CSV file${argumentsValue.numericColumns.length > 0 ? `; numeric columns: ${argumentsValue.numericColumns.join(", ")}` : ""}.\n`);
    let readFailure: InputReadFailure | undefined;
    const input = await readApprovedInputFile(argumentsValue.input, question, signal, (failure) => {
      readFailure = failure;
    });
    if (input === undefined) {
      if (readFailure === "cancelled" || signal?.aborted === true) {
        process.stdout.write("CSV analysis cancelled before reading the file.\n");
        return "CSV analysis was cancelled before the file was read.";
      }
      throw new Error("CSV file access was denied or unavailable.");
    }
    const result = await withStore((store) => runCsvAnalysisWorkflow(store, input, undefined, argumentsValue.numericColumns));
    if (result === undefined) throw new Error("CSV analysis could not open configured storage.");
    const missingCellCount = Object.values(result.analysis.missingValues).reduce((total, count) => total + count, 0);
    const totals = Object.entries(result.analysis.numericTotals).map(([column, total]) => `${escapeTerminalControls(column)}=${total}`);
    const summary = `CSV analysis complete: ${result.analysis.rowCount} rows; ${result.analysis.duplicateRowCount} duplicate rows; ${missingCellCount} missing cells.${totals.length === 0 ? "" : ` Numeric totals: ${totals.join(", ")}.`}`;
    process.stdout.write(`${summary}\n`);
    return summary;
  });
}

function createCliDocumentAnalysisTool(question: ApprovalQuestion) {
  return createDocumentAnalysisTool(async (argumentsValue, signal) => {
    process.stdout.write("Proposed action: analyze one supported document; only format and aggregate counts are sent back to the model.\n");
    let readFailure: InputReadFailure | undefined;
    const input = await readApprovedInputFile(argumentsValue.input, question, signal, (failure) => {
      readFailure = failure;
    });
    if (input === undefined) {
      if (readFailure === "cancelled" || isSignalAborted(signal)) {
        process.stdout.write("Document analysis cancelled before reading the file.\n");
        return "Document analysis was cancelled before the file was read.";
      }
      throw new Error("Document file access was denied or unavailable.");
    }
    const extension = extname(argumentsValue.input).toLowerCase();
    const result = await withStore((store) => analyzeDocument(store, extension, input));
    if (result === undefined) throw new Error("Document analysis could not open configured storage.");
    const analysis = result.analysis;
    const summary = analysis.format === "xlsx"
      ? `Document analysis complete: XLSX; ${analysis.sheetCount ?? 0} sheets; ${analysis.rowCount ?? 0} rows; ${analysis.cellCount ?? 0} scalar cells.`
      : `Document analysis complete: ${analysis.format}; ${analysis.wordCount} words; ${analysis.lineCount} lines; ${analysis.byteCount} bytes.`;
    process.stdout.write(`${summary}\n`);
    return summary;
  });
}

async function runNaturalLanguageInstruction(instruction: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Natural-language execution requires an interactive terminal.\n");
    process.exitCode = 2;
    return;
  }
  if (instruction.trim().length === 0 || instruction.length > 8_000) {
    process.stderr.write("Provide one instruction up to 8,000 characters.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const providerConfiguration = loadProviderConfiguration();
    const selected = createModelProvider(providerConfiguration);
    if (providerConfiguration.kind === "groq") {
      const consent = createInterface({ input: process.stdin, output: process.stdout });
      let answer: string;
      try {
        answer = await consent.question("This instruction and approved CSV/document aggregates, including any selected column labels but not source rows or extracted document text, will be sent to the configured Groq service. Continue? [y/N] ");
      } finally {
        consent.close();
      }
      if (answer.trim().toLowerCase() !== "y") {
        process.stdout.write("Instruction cancelled before sending a request.\n");
        return;
      }
    }
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const controller = new AbortController();
    const handleInterrupt = (): void => controller.abort();
    terminal.on("SIGINT", handleInterrupt);
    const question: ApprovalQuestion = (prompt, signal) => signal === undefined
      ? terminal.question(prompt)
      : terminal.question(prompt, { signal });
    try {
      process.stdout.write("TaskForge is interpreting one instruction. Approved CSV or supported-document analysis are the currently enabled agent actions.\n");
      const result = await runToolLoop(
        selected.provider,
        selected.model,
        [
          { role: "system", content: TASKFORGE_AGENT_SYSTEM_MESSAGE },
          { role: "user", content: instruction },
        ],
        [createCliCsvAnalysisTool(question), createCliDocumentAnalysisTool(question)],
        { maxModelRequests: 8, maxToolActions: 2, signal: controller.signal },
      );
      if (result.content.length > 0) process.stdout.write(`TaskForge> ${result.content}\n`);
    } catch (error: unknown) {
      if (controller.signal.aborted || (error instanceof ModelProviderError && error.kind === "cancelled")) {
        process.stdout.write("Instruction cancelled; no further actions will run.\n");
        process.exitCode = 130;
      } else if (error instanceof ModelProviderError) {
        process.stderr.write(`Instruction failed: ${error.message}\n`);
        process.exitCode = 3;
      } else {
        process.stderr.write("Instruction failed; the requested action was rejected or could not be completed.\n");
        process.exitCode = 3;
      }
    } finally {
      terminal.close();
    }
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "Unable to start natural-language execution with the selected provider.";
    process.stderr.write(`Instruction setup error: ${message}\n`);
    process.exitCode = 2;
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
      process.stdout.write("This session sends your messages and approved CSV/document aggregates, including selected column labels but not source rows or extracted document text, to the configured Groq service. Continue? [y/N] ");
      const consent = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await consent.question("");
      consent.close();
      if (answer.trim().toLowerCase() !== "y") {
        process.stdout.write("Chat cancelled before sending a request.\n");
        return;
      }
    }

    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const systemMessage: ProviderMessage = { role: "system", content: TASKFORGE_AGENT_SYSTEM_MESSAGE };
    const messages: ProviderMessage[] = [systemMessage];
    const sessionBudget = new AgentBudgetLedger(40, 10);
    const question: ApprovalQuestion = (prompt, signal) => signal === undefined
      ? terminal.question(prompt)
      : terminal.question(prompt, { signal });
    const tools = [createCliCsvAnalysisTool(question), createCliDocumentAnalysisTool(question)];
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
      while (!stopRequested && sessionBudget.snapshot().modelRequestsRemaining > 0 && sessionBudget.snapshot().toolActionsRemaining > 0) {
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
          const budget = sessionBudget.snapshot();
          const result = await runToolLoop(
            selected.provider,
            selected.model,
            messages.slice(0, 1).concat(messages.slice(1).slice(-39)),
            tools,
            {
              maxModelRequests: budget.modelRequestsRemaining,
              maxToolActions: budget.toolActionsRemaining,
              budget: sessionBudget,
              signal: controller.signal,
            },
          );
          messages.push({ role: "assistant", content: result.content });
          if (result.content.length > 0) process.stdout.write(`TaskForge> ${result.content}\n`);
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
      const remaining = sessionBudget.snapshot();
      if (remaining.modelRequestsRemaining === 0 || remaining.toolActionsRemaining === 0) {
        process.stdout.write("Chat session budget reached. Start a new session to continue.\n");
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
    const configuration = loadStoreConfiguration();
    process.stdout.write(`${formatStoreConfigurationSummary(configuration)}\n`);
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "Unable to load configuration.";
    process.stderr.write(`Configuration error: ${message}\n`);
    process.exitCode = 2;
  }
} else if (args.length === 1 && args[0] === "doctor") {
  await runDoctor();
} else if (args.length === 1 && args[0] === "model-check") {
  await runModelCheck();
} else if (args.length >= 1 && args[0] === "do") {
  await runNaturalLanguageInstruction(args.slice(1).join(" "));
} else if (args.length === 1 && args[0] === "chat") {
  await runChat();
} else if (args.length >= 1 && args[0] === "tasks") {
  runTasksCommand(args.slice(1));
} else if (args.length >= 1 && args[0] === "permissions") {
  await runPermissionsCommand(args.slice(1));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "csv-analyze") {
  await runCsvWorkflowCommand(args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "repo-inspect") {
  await runRepositoryInspectionCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-analyze") {
  await runDocumentAnalysisCommand(args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-convert") {
  await runDocumentConversionCommand(args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "software-check") {
  await runSoftwareCheckCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "source-review") {
  await runSourceReviewCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "architecture-report") {
  await runArchitectureReportCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "pdf-report") {
  await runPdfReportCommand(args.slice(2), { readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "file-patch") {
  await runFilePatchCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "agent-fix") {
  await runAgentFixCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "file-move") {
  await runFileMoveCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "git-diff") {
  await runGitDiffCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "model-investigate") {
  await runModelInvestigationCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "github-issues") {
  await runGitHubIssuesCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "deployment-trace") {
  await runDeploymentTraceCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "draft") {
  await runDraftCommand(args.slice(2), { readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "specialist-review") {
  await runSpecialistReviewCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "data-specialist") {
  await runDataSpecialistCommand(args.slice(2));
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
    await resumeWorkflowCommand(runId, args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
  }
} else if (args.length === 2 && args[0] === "history" && args[1] === "list") {
  await listRunHistory();
} else if (args.length >= 1 && args[0] === "schedule") {
  await runScheduleCommand(args.slice(1), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
