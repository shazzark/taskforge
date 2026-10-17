#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { open, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ConfigurationError, formatStoreConfigurationSummary, loadLocalEnvironmentFile, loadProviderConfiguration, loadStoreConfiguration } from "./config/configuration.js";
import { AgentBudgetLedger, AgentToolError, runToolLoop } from "./agent/tool-loop.js";
import { runTasksCommand } from "./cli/commands/tasks.js";
import { runGitHubIssuesCommand } from "./cli/commands/github-issues.js";
import { runDeploymentTraceCommand } from "./cli/commands/deployment-trace.js";
import { runArchitectureReportCommand, runRepositoryInspectionCommand, runSourceReviewCommand } from "./cli/commands/repository-inspection.js";
import { runScheduleCommand } from "./cli/commands/scheduling.js";
import { resumeWorkflowCommand, runCsvWorkflowCommand, runDocumentAnalysisCommand, runDocumentConversionCommand } from "./cli/commands/data-documents.js";
import { runDraftCommand, runPdfReportCommand } from "./cli/commands/artifacts.js";
import { runBrowserAuditCommand } from "./cli/commands/browser-audit.js";
import { runPermissionsCommand } from "./cli/commands/permissions.js";
import { runChat, runNaturalLanguageInstruction } from "./cli/commands/agent-session.js";
import { runAgentFixCommand, runFileMoveCommand, runFilePatchCommand, runGitDiffCommand, runSoftwareCheckCommand } from "./cli/commands/software-workflows.js";
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
import { redactSourceForDisplay, reviewSourceFiles, SourceReviewError } from "./workflows/source-review-workflow.js";
import { investigateSource, ModelInvestigationError } from "./tools/software/model-investigation.js";
import { escapeTerminalControls } from "./security/terminal-text.js";
import { BrowserSearchError, GroqBrowserResearch } from "./integrations/groq-browser-search.js";
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
  await runNaturalLanguageInstruction(args.slice(1).join(" "), { withStore, readApprovedInputFile });
} else if (args.length === 1 && args[0] === "chat") {
  await runChat({ withStore, readApprovedInputFile });
} else if (args.length >= 1 && args[0] === "tasks") {
  runTasksCommand(args.slice(1));
} else if (args.length >= 1 && args[0] === "permissions") {
  await runPermissionsCommand(args.slice(1), { withStore });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "csv-analyze") {
  await runCsvWorkflowCommand(args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "repo-inspect") {
  await runRepositoryInspectionCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-analyze") {
  await runDocumentAnalysisCommand(args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-convert") {
  await runDocumentConversionCommand(args.slice(2), { withStore, readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "software-check") {
  await runSoftwareCheckCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "source-review") {
  await runSourceReviewCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "architecture-report") {
  await runArchitectureReportCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "pdf-report") {
  await runPdfReportCommand(args.slice(2), { readApprovedInputFile, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "file-patch") {
  await runFilePatchCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "agent-fix") {
  await runAgentFixCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "file-move") {
  await runFileMoveCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
} else if (args.length >= 2 && args[0] === "run" && args[1] === "git-diff") {
  await runGitDiffCommand(args.slice(2), { withStore, requirePersistentFolderApproval });
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
  await runBrowserAuditCommand(args.slice(2), { withStore, runEvidenceSpecialistReview });
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
