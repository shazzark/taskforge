import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runTasksCommand } from "../../dist/cli/commands/tasks.js";
import { loadLocalTaskRegistry, MAX_LOCAL_TASK_DEFINITION_BYTES } from "../../dist/workflows/local-task-registry.js";

const originalLocalAppData = process.env["LOCALAPPDATA"];
const originalStorage = process.env["TASKFORGE_STORAGE"];
const originalExitCode = process.exitCode;

test("task definition commands pass exact-file reads through the bounded approval dependency", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "taskforge-task-command-"));
  process.env["LOCALAPPDATA"] = dataRoot;
  process.env["TASKFORGE_STORAGE"] = "local";
  const output = [];
  const errors = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk) => {
    output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  process.stderr.write = ((chunk) => {
    errors.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  process.exitCode = 0;
  t.after(async () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (originalLocalAppData === undefined) delete process.env["LOCALAPPDATA"];
    else process.env["LOCALAPPDATA"] = originalLocalAppData;
    if (originalStorage === undefined) delete process.env["TASKFORGE_STORAGE"];
    else process.env["TASKFORGE_STORAGE"] = originalStorage;
    process.exitCode = originalExitCode;
    await rm(dataRoot, { recursive: true, force: true });
  });

  const definition = {
    id: "approved-reader-task",
    version: 1,
    name: "Approved reader fixture",
    description: "A command-level install fixture.",
    instructions: "Use only the validated query input.",
    inputs: [{ name: "query", type: "string", required: true, description: "A synthetic query." }],
    outputs: [{ name: "summary", type: "text", description: "A bounded summary." }],
    requiredTools: ["web.search"],
    examples: [{ prompt: "Summarize a synthetic query.", inputs: { query: "synthetic" }, expectedResult: "A summary." }],
    tests: [{ name: "query required", inputs: { query: "synthetic" }, expectedOutputNames: ["summary"] }],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(definition));
  const requestedPaths = [];
  const requestedLimits = [];
  const dependencies = {
    async readApprovedInputFile(path, _askQuestion, _signal, _reportFailure, maxBytes) {
      requestedPaths.push(path);
      requestedLimits.push(maxBytes);
      return bytes;
    },
  };

  await runTasksCommand(["validate-definition", "--file", "source-definition.json"], dependencies);
  assert.equal((await loadLocalTaskRegistry()).localDefinitionIds.size, 0);
  assert.match(output.join(""), /Validated task definition approved-reader-task/u);
  assert.deepEqual(errors, []);
  assert.equal(process.exitCode, 0);

  await runTasksCommand(["install", "--file", "source-definition.json"], dependencies);
  assert.deepEqual(requestedPaths, ["source-definition.json", "source-definition.json"]);
  assert.deepEqual(requestedLimits, [MAX_LOCAL_TASK_DEFINITION_BYTES, MAX_LOCAL_TASK_DEFINITION_BYTES]);
  assert.equal((await loadLocalTaskRegistry()).localDefinitionIds.has("approved-reader-task"), true);
  assert.match(output.join(""), /Installed local task definition approved-reader-task/u);
  assert.deepEqual(errors, []);
  assert.equal(process.exitCode, 0);
});
