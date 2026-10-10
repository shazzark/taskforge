#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { open, realpath } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ConfigurationError, formatConfigurationSummary, loadConfiguration, loadProviderConfiguration } from "./config.js";
import { AgentToolError, runToolLoop } from "./agent/tool-loop.js";
import {
  DatabaseConnectionError,
  DatabaseShutdownError,
  MongoStore,
} from "./mongo-store.js";
import { createModelProvider } from "./providers/create-provider.js";
import { ModelProviderError } from "./providers/types.js";
import { PathPolicyError, WorkspacePathPolicy } from "./security/path-policy.js";
import { CsvWorkflowError, resumeCsvAnalysisWorkflow, runCsvAnalysisWorkflow } from "./workflows/csv-analysis-workflow.js";
import { inspectRepository, RepositoryInspectionError } from "./workflows/repository-inspection-workflow.js";
import { analyzeDocument, DocumentWorkflowError } from "./workflows/document-analysis-workflow.js";
import { runReviewedCommand, type ReviewedCommandId, ReviewedCommandError } from "./software/reviewed-command.js";
import { reviewSourceFiles, SourceReviewError } from "./workflows/source-review-workflow.js";

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version | config | doctor | model-check | chat | run csv-analyze --input <path> | run document-analyze --input <path> | run repo-inspect --root <directory> | run source-review --root <directory> --file <relative-path> [...] | run software-check --root <directory> --check <node-test|typescript-check> | resume <run-id> --input <path> | history list]

The config command validates local settings and prints a redacted summary.
The doctor command checks configured MongoDB connectivity and reports available setup areas.
The model-check command makes a synthetic read-only tool call through the selected model provider.
The chat command opens a bounded interactive conversation with the selected provider.
The csv-analyze workflow reads one explicitly approved CSV file and stores redacted run metadata.
The repo-inspect workflow inventories one explicitly approved repository root without reading file contents or running commands.
The source-review workflow reads only explicitly selected source files and displays bounded, locally redacted content; it does not send or persist source.
The document-analyze workflow parses one approved TXT, Markdown, text PDF, DOCX, or XLSX file and stores counts only.
The software-check workflow runs only an explicitly approved Node test or TypeScript no-emit check in one approved root.
The resume command rechecks the input and workflow hashes, then resumes an uncertain CSV analysis.
History list prints up to 50 redacted run summaries.
`;

const args = process.argv.slice(2);

function inputPathArgument(commandArgs: readonly string[]): string | undefined {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--input") {
    return undefined;
  }
  const value = commandArgs[1];
  return value === undefined || value.trim().length === 0 ? undefined : value;
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

async function runCsvWorkflowCommand(commandArgs: readonly string[], runId?: string): Promise<void> {
  const inputPath = inputPathArgument(commandArgs);
  if (inputPath === undefined) {
    process.stderr.write("Expected --input followed by a file path.\n");
    process.exitCode = 1;
    return;
  }
  const input = await readApprovedInputFile(inputPath);
  if (input === undefined) {
    return;
  }
  try {
    const result = await withMongoStore(async (store) => runId === undefined
      ? runCsvAnalysisWorkflow(store, input)
      : resumeCsvAnalysisWorkflow(store, runId, input));
    if (result !== undefined) {
      const totals = Object.entries(result.analysis.numericTotals).map(([column, total]) => `${column}=${total}`);
      process.stdout.write(`Run ${result.run.runId} ${result.resumed ? "resumed" : "completed"}: ${result.analysis.rowCount} rows, ${result.analysis.duplicateRowCount} duplicate rows.\n`);
      if (totals.length > 0) {
        process.stdout.write(`Numeric totals: ${totals.join(", ")}\n`);
      }
    }
  } catch (error: unknown) {
    process.stderr.write(error instanceof CsvWorkflowError ? `CSV workflow failed: ${error.message}\n` : "CSV workflow failed; run state was preserved where possible.\n");
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

async function listRunHistory(): Promise<void> {
  let runs: Awaited<ReturnType<MongoStore["listRunSummaries"]>> | undefined;
  try {
    runs = await withMongoStore((store) => store.listRunSummaries());
  } catch {
    process.stderr.write("Unable to read TaskForge run history.\n");
    process.exitCode = 2;
    return;
  }
  if (runs === undefined) {
    return;
  }
  if (runs.length === 0) {
    process.stdout.write("No TaskForge runs found.\n");
    return;
  }
  for (const run of runs) {
    process.stdout.write(`${run.runId}\t${run.state}\t${run.workflowId}\t${run.summary}\n`);
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
    const message = error instanceof RepositoryInspectionError ? error.message : "Repository inspection failed safely.";
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
    const message = error instanceof ReviewedCommandError ? error.message : "Software check failed safely.";
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
    const files = await reviewSourceFiles(approvedRoot, policy, paths);
    for (const file of files) {
      process.stdout.write(`\n--- ${file.path} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${file.content}\n`);
    }
  } catch (error: unknown) {
    const message = error instanceof SourceReviewError ? error.message : "Source review failed safely.";
    process.stderr.write(`Source review failed: ${message}\n`);
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
    process.stdout.write("Browser tooling: not implemented yet.\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Model provider: ${providerStatus}.\n`);
  process.stdout.write("Browser tooling: not implemented yet.\n");
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
} else if (args.length >= 2 && args[0] === "run" && args[1] === "csv-analyze") {
  await runCsvWorkflowCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "repo-inspect") {
  await runRepositoryInspectionCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "document-analyze") {
  await runDocumentAnalysisCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "software-check") {
  await runSoftwareCheckCommand(args.slice(2));
} else if (args.length >= 2 && args[0] === "run" && args[1] === "source-review") {
  await runSourceReviewCommand(args.slice(2));
} else if (args.length >= 1 && args[0] === "resume") {
  const runId = args[1];
  if (runId === undefined || args.length < 3) {
    process.stderr.write("Expected resume <run-id> --input <path>.\n");
    process.exitCode = 1;
  } else {
    await runCsvWorkflowCommand(args.slice(2), runId);
  }
} else if (args.length === 2 && args[0] === "history" && args[1] === "list") {
  await listRunHistory();
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
