import { TaskRegistryError, validateTaskInputs, type TaskDefinition } from "../../workflows/task-registry.js";
import {
  installLocalTaskDefinition,
  loadLocalTaskRegistry,
  MAX_LOCAL_TASK_DEFINITION_BYTES,
  parseLocalTaskDefinitionText,
  validateLocalTaskDefinition,
} from "../../workflows/local-task-registry.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";

type ApprovalQuestion = (prompt: string, signal?: AbortSignal) => Promise<string>;
type InputReadFailure = "cancelled" | "denied" | "storage-unavailable";

function escapeTaskDisplay(value: string): string {
  return escapeTerminalControls(value).replace(/\p{Cf}/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
  });
}

export interface TasksCommandDependencies {
  readonly readApprovedInputFile: (
    pathValue: string,
    askQuestion?: ApprovalQuestion,
    signal?: AbortSignal,
    reportFailure?: (failure: InputReadFailure) => void,
    maxBytes?: number,
  ) => Promise<Uint8Array | undefined>;
}

function printInvalidDefinitions(files: readonly { readonly fileName: string; readonly reason: string }[]): void {
  if (files.length === 0) return;
  process.stderr.write(`Ignored ${files.length} invalid local task definition entr${files.length === 1 ? "y" : "ies"}:\n`);
  for (const file of files) {
    process.stderr.write(`- ${escapeTaskDisplay(file.fileName)}: ${escapeTaskDisplay(file.reason)}\n`);
  }
}

async function readDefinitionFile(pathValue: string, dependencies: TasksCommandDependencies): Promise<TaskDefinition | undefined> {
  const bytes = await dependencies.readApprovedInputFile(pathValue, undefined, undefined, undefined, MAX_LOCAL_TASK_DEFINITION_BYTES);
  if (bytes === undefined) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseLocalTaskDefinitionText(text);
  } catch (error: unknown) {
    process.stderr.write(`Task definition rejected: ${error instanceof TaskRegistryError ? error.message : "definition file is not valid UTF-8"}\n`);
    process.exitCode = 2;
    return undefined;
  }
}

export async function runTasksCommand(commandArgs: readonly string[], dependencies: TasksCommandDependencies): Promise<void> {
  const action = commandArgs[0];
  if ((action === "install" || action === "validate-definition") && commandArgs.length === 3 && commandArgs[1] === "--file") {
    const definition = await readDefinitionFile(commandArgs[2] ?? "", dependencies);
    if (definition === undefined) return;
    if (action === "validate-definition") {
      try {
        await validateLocalTaskDefinition(definition);
        process.stdout.write(`Validated task definition ${definition.id}; it is data only and cannot execute tasks or grant permissions.\n`);
      } catch (error: unknown) {
        process.stderr.write(`Task definition rejected: ${error instanceof TaskRegistryError ? error.message : "the local registry is unavailable"}\n`);
        process.exitCode = 2;
      }
      return;
    }
    try {
      await installLocalTaskDefinition(definition);
      process.stdout.write(`Installed local task definition ${definition.id}. It is validated data only and cannot execute tasks or grant permissions.\n`);
    } catch (error: unknown) {
      process.stderr.write(`Task definition installation failed: ${error instanceof TaskRegistryError ? error.message : "the local registry is unavailable"}\n`);
      process.exitCode = 2;
    }
    return;
  }

  let registry: Awaited<ReturnType<typeof loadLocalTaskRegistry>>;
  try {
    registry = await loadLocalTaskRegistry();
  } catch {
    process.stderr.write("Local task definitions could not be loaded safely.\n");
    process.exitCode = 2;
    return;
  }
  printInvalidDefinitions(registry.invalidFiles);
  if (action === "list" && commandArgs.length === 1) {
    for (const task of registry.definitions) {
      const source = registry.localDefinitionIds.has(task.id) ? "local" : "built-in";
      process.stdout.write(`${task.id}\t${escapeTaskDisplay(task.name)}\t${source}\ttools=${task.requiredTools.join(",") || "none"}\n`);
    }
    process.stdout.write("Definitions are validated data only; they cannot execute tasks or grant permissions.\n");
    return;
  }
  const taskId = commandArgs[1];
  const task = typeof taskId === "string" ? registry.definitions.find((definition) => definition.id === taskId) : undefined;
  if (action === "inspect" && commandArgs.length === 2) {
    if (!task) {
      process.stderr.write("Unknown task id.\n");
      process.exitCode = 2;
      return;
    }
    const source = registry.localDefinitionIds.has(task.id) ? "local" : "built-in";
    process.stdout.write(`${escapeTaskDisplay(task.name)} (${task.id}, definition v${task.version}, ${source})\n${escapeTaskDisplay(task.description)}\nInputs:\n`);
    for (const input of task.inputs) {
      process.stdout.write(`- ${input.name}: ${input.type}${input.required ? " (required)" : " (optional)"} — ${escapeTaskDisplay(input.description)}\n`);
    }
    process.stdout.write("Outputs:\n");
    for (const output of task.outputs) process.stdout.write(`- ${output.name}: ${output.type} — ${escapeTaskDisplay(output.description)}\n`);
    process.stdout.write(`Required tool capabilities: ${task.requiredTools.join(", ") || "none"}\nExamples: ${task.examples.length}; conformance cases: ${task.tests.length}\n`);
    return;
  }
  if (action === "validate" && commandArgs.length === 4 && commandArgs[2] === "--inputs-json") {
    if (!task) {
      process.stderr.write("Unknown task id.\n");
      process.exitCode = 2;
      return;
    }
    try {
      const rawInputs: unknown = JSON.parse(commandArgs[3] ?? "");
      const validated = validateTaskInputs(task.inputs, rawInputs);
      process.stdout.write(`Inputs accepted for ${task.id}: ${validated.fieldNames.join(", ")}\n`);
    } catch (error: unknown) {
      process.stderr.write(`Task inputs rejected: ${error instanceof TaskRegistryError ? error.message : "invalid JSON"}\n`);
      process.exitCode = 2;
    }
    return;
  }
  process.stderr.write("Usage: tasks list | tasks inspect <task-id> | tasks validate <task-id> --inputs-json <object> | tasks validate-definition --file <definition.json> | tasks install --file <definition.json>\n");
  process.exitCode = 2;
}
