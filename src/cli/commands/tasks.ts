import { BUILT_IN_TASKS, getBuiltInTask, TaskRegistryError, validateTaskInputs } from "../../workflows/task-registry.js";

export function runTasksCommand(commandArgs: readonly string[]): void {
  const action = commandArgs[0];
  if (action === "list" && commandArgs.length === 1) {
    for (const task of BUILT_IN_TASKS) {
      process.stdout.write(`${task.id}\t${task.name}\ttools=${task.requiredTools.join(",") || "none"}\n`);
    }
    process.stdout.write("These local built-in definitions are validated data only; they cannot execute tasks or grant permissions.\n");
    return;
  }
  const taskId = commandArgs[1];
  const task = typeof taskId === "string" ? getBuiltInTask(taskId) : undefined;
  if (action === "inspect" && commandArgs.length === 2) {
    if (!task) {
      process.stderr.write("Unknown built-in task id.\n");
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${task.name} (${task.id}, definition v${task.version})\n${task.description}\nInputs:\n`);
    for (const input of task.inputs) {
      process.stdout.write(`- ${input.name}: ${input.type}${input.required ? " (required)" : " (optional)"} — ${input.description}\n`);
    }
    process.stdout.write("Outputs:\n");
    for (const output of task.outputs) process.stdout.write(`- ${output.name}: ${output.type} — ${output.description}\n`);
    process.stdout.write(`Required tool capabilities: ${task.requiredTools.join(", ") || "none"}\nExamples: ${task.examples.length}; conformance cases: ${task.tests.length}\n`);
    return;
  }
  if (action === "validate" && commandArgs.length === 4 && commandArgs[2] === "--inputs-json") {
    if (!task) {
      process.stderr.write("Unknown built-in task id.\n");
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
  process.stderr.write("Usage: tasks list | tasks inspect <task-id> | tasks validate <task-id> --inputs-json <object>\n");
  process.exitCode = 2;
}
