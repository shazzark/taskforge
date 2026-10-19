import { createInterface } from "node:readline/promises";
import { ConfigurationError, loadProviderConfiguration } from "../../config/configuration.js";
import { AgentBudgetLedger, runToolLoop } from "../../agent/tool-loop.js";
import { createCsvAnalysisTool, createDocumentAnalysisTool, TASKFORGE_AGENT_SYSTEM_MESSAGE } from "../../agent/session-tools.js";
import { createInstalledCsvTaskTool } from "../../agent/installed-task-tool.js";
import type { TaskForgeStore } from "../../storage/store.js";
import { createModelProvider } from "../../providers/create-provider.js";
import { ModelProviderError, type ProviderMessage } from "../../providers/types.js";
import { runCsvAnalysisWorkflow } from "../../workflows/csv-analysis-workflow.js";
import { analyzeDocument } from "../../workflows/document-analysis-workflow.js";
import { extname } from "node:path";
import { escapeTerminalControls } from "../../security/terminal-text.js";
import { loadLocalTaskRegistry } from "../../workflows/local-task-registry.js";
import type { AgentTool } from "../../agent/tool-loop.js";

type ApprovalQuestion = (prompt: string, signal?: AbortSignal) => Promise<string>;
type InputReadFailure = "cancelled" | "denied";

export interface AgentSessionCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
  readonly readApprovedInputFile: (
    pathValue: string,
    askQuestion?: ApprovalQuestion,
    signal?: AbortSignal,
    reportFailure?: (failure: InputReadFailure) => void,
  ) => Promise<Uint8Array | undefined>;
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function createCliCsvAnalysisTool(question: ApprovalQuestion, dependencies: AgentSessionCommandDependencies) {
  return createCsvAnalysisTool(async (argumentsValue, signal) => {
    process.stdout.write(`Proposed action: analyze one CSV file${argumentsValue.numericColumns.length > 0 ? `; numeric columns: ${argumentsValue.numericColumns.join(", ")}` : ""}.\n`);
    let readFailure: InputReadFailure | undefined;
    const input = await dependencies.readApprovedInputFile(argumentsValue.input, question, signal, (failure) => {
      readFailure = failure;
    });
    if (input === undefined) {
      if (readFailure === "cancelled" || signal?.aborted === true) {
        process.stdout.write("CSV analysis cancelled before reading the file.\n");
        return "CSV analysis was cancelled before the file was read.";
      }
      throw new Error("CSV file access was denied or unavailable.");
    }
    const result = await dependencies.withStore((store) => runCsvAnalysisWorkflow(store, input, undefined, argumentsValue.numericColumns));
    if (result === undefined) throw new Error("CSV analysis could not open configured storage.");
    const missingCellCount = Object.values(result.analysis.missingValues).reduce((total, count) => total + count, 0);
    const totals = Object.entries(result.analysis.numericTotals).map(([column, total]) => `${escapeTerminalControls(column)}=${total}`);
    const summary = `CSV analysis complete: ${result.analysis.rowCount} rows; ${result.analysis.duplicateRowCount} duplicate rows; ${missingCellCount} missing cells.${totals.length === 0 ? "" : ` Numeric totals: ${totals.join(", ")}.`}`;
    process.stdout.write(`${summary}\n`);
    return summary;
  });
}

function createCliDocumentAnalysisTool(question: ApprovalQuestion, dependencies: AgentSessionCommandDependencies) {
  return createDocumentAnalysisTool(async (argumentsValue, signal) => {
    process.stdout.write("Proposed action: analyze one supported document; only format and aggregate counts are sent back to the model.\n");
    let readFailure: InputReadFailure | undefined;
    const input = await dependencies.readApprovedInputFile(argumentsValue.input, question, signal, (failure) => {
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
    const result = await dependencies.withStore((store) => analyzeDocument(store, extension, input));
    if (result === undefined) throw new Error("Document analysis could not open configured storage.");
    const analysis = result.analysis;
    const summary = analysis.format === "xlsx"
      ? `Document analysis complete: XLSX; ${analysis.sheetCount ?? 0} sheets; ${analysis.rowCount ?? 0} rows; ${analysis.cellCount ?? 0} scalar cells.`
      : `Document analysis complete: ${analysis.format}; ${analysis.wordCount} words; ${analysis.lineCount} lines; ${analysis.byteCount} bytes.`;
    process.stdout.write(`${summary}\n`);
    return summary;
  });
}

function createCliAgentTools(
  question: ApprovalQuestion,
  dependencies: AgentSessionCommandDependencies,
  definitions: Awaited<ReturnType<typeof loadLocalTaskRegistry>>["definitions"],
): AgentTool[] {
  const csvTool = createCliCsvAnalysisTool(question, dependencies);
  const installedTaskTool = createInstalledCsvTaskTool(definitions, async (argumentsValue, signal) =>
    csvTool.execute({ input: argumentsValue.input, numericColumns: argumentsValue.numericColumns }, signal));
  return [
    csvTool,
    createCliDocumentAnalysisTool(question, dependencies),
    ...(installedTaskTool === undefined ? [] : [installedTaskTool]),
  ];
}

export async function runNaturalLanguageInstruction(instruction: string, dependencies: AgentSessionCommandDependencies): Promise<void> {
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
    const taskRegistry = await loadLocalTaskRegistry();
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
        createCliAgentTools(question, dependencies, taskRegistry.definitions),
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

export async function runChat(dependencies: AgentSessionCommandDependencies): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Chat requires an interactive terminal.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const taskRegistry = await loadLocalTaskRegistry();
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
    const tools = createCliAgentTools(question, dependencies, taskRegistry.definitions);
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

