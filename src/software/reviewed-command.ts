import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { MongoStore, RunSummary } from "../mongo-store.js";
import type { ApprovedRoot, WorkspacePathPolicy } from "../security/path-policy.js";

const MAX_RUNTIME_MS = 120_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const MAX_SELECTED_TEST_BYTES = 2 * 1024 * 1024;
const WORKFLOW_ID = "software-check";

export type ReviewedCommandId = "node-test" | "node-test-selected" | "typescript-check";
export type ReviewedCommandStatus = "passed" | "failed" | "timed_out" | "could_not_start";

export interface ReviewedCommandResult {
  readonly run: RunSummary;
  readonly command: ReviewedCommandId;
  readonly status: ReviewedCommandStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly outputTruncated: boolean;
  readonly observedOutputBytes: number;
}

export class ReviewedCommandError extends Error {
  constructor(message = "The reviewed command could not run in the approved repository.") {
    super(message);
    this.name = "ReviewedCommandError";
  }
}

type Persistence = Pick<MongoStore, "saveRunSummary" | "updateRunState" | "appendRunEvent" | "updateRunSummary">;

interface ProcessResult {
  readonly exitCode: number | null;
  readonly status: Exclude<ReviewedCommandStatus, "passed" | "failed"> | "completed";
  readonly durationMs: number;
  readonly outputTruncated: boolean;
  readonly observedOutputBytes: number;
}

interface SelectedTestIdentity {
  readonly relativePath: string;
  readonly canonicalPath: string;
  readonly size: number;
  readonly modifiedAt: number;
  readonly ino: number;
  readonly dev: number;
  readonly sha256: string;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function approvedTscPath(root: ApprovedRoot, policy: WorkspacePathPolicy): Promise<string> {
  const candidate = join(root.path, "node_modules", "typescript", "bin", "tsc");
  try {
    const authorized = await policy.authorizePath(candidate, "read");
    const canonicalPath = await realpath(authorized.path);
    if (canonicalPath !== authorized.path) throw new ReviewedCommandError();
    return canonicalPath;
  } catch {
    throw new ReviewedCommandError("TypeScript is not installed under the approved repository root.");
  }
}

function runChildProcess(executable: string, arguments_: readonly string[], cwd: string): Promise<ProcessResult> {
  const startedAt = Date.now();
  let outputBytes = 0;
  let outputTruncated = false;
  return new Promise((resolveResult) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, [...arguments_], {
        cwd,
        env: safeEnvironment(),
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolveResult({
        exitCode: null,
        status: "could_not_start",
        durationMs: Date.now() - startedAt,
        outputTruncated: false,
        observedOutputBytes: 0,
      });
      return;
    }

    const countOutput = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_CAPTURED_OUTPUT_BYTES) outputTruncated = true;
    };
    child.stdout?.on("data", countOutput);
    child.stderr?.on("data", countOutput);
    let finished = false;
    let timedOut = false;
    const finish = (result: ProcessResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, MAX_RUNTIME_MS);
    child.once("error", () => {
      finish({
        exitCode: null,
        status: "could_not_start",
        durationMs: Date.now() - startedAt,
        outputTruncated,
        observedOutputBytes: Math.min(outputBytes, MAX_CAPTURED_OUTPUT_BYTES),
      });
    });
    child.once("close", (code) => {
      finish({
        exitCode: timedOut ? null : code,
        status: timedOut ? "timed_out" : "completed",
        durationMs: Date.now() - startedAt,
        outputTruncated,
        observedOutputBytes: Math.min(outputBytes, MAX_CAPTURED_OUTPUT_BYTES),
      });
    });
  });
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (systemRoot === undefined) {
      child.kill();
      return;
    }
    const taskkill = spawn(join(systemRoot, "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], {
      env: safeEnvironment(), shell: false, windowsHide: true, stdio: "ignore",
    });
    taskkill.once("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function statusFor(result: ProcessResult): ReviewedCommandStatus {
  if (result.status !== "completed") return result.status;
  return result.exitCode === 0 ? "passed" : "failed";
}

function summary(command: ReviewedCommandId, status: ReviewedCommandStatus, exitCode: number | null): string {
  return `Reviewed ${command} check ${status.replaceAll("_", " ")}; exit code ${exitCode === null ? "unavailable" : exitCode}. Output and repository paths were not persisted.`;
}

async function selectedNodeTestPath(root: ApprovedRoot, policy: WorkspacePathPolicy, value: unknown): Promise<SelectedTestIdentity> {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 1_024 || value.includes("\u0000") || isAbsolute(value)) {
    throw new ReviewedCommandError("Selected tests require one in-root relative JavaScript test file.");
  }
  const requested = resolve(root.path, value);
  try {
    const lexicalStats = await lstat(requested);
    if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink()) throw new ReviewedCommandError();
    const authorized = await policy.authorizePath(requested, "read");
    const canonical = await realpath(authorized.path);
    const canonicalStats = await stat(canonical);
    if (canonical !== authorized.path || !canonicalStats.isFile() || ![".js", ".cjs", ".mjs"].includes(extname(canonical).toLowerCase())) {
      throw new ReviewedCommandError("Selected test must be an in-root regular .js, .cjs, or .mjs file.");
    }
    if (canonicalStats.size > MAX_SELECTED_TEST_BYTES) throw new ReviewedCommandError("Selected test file exceeds the 2 MiB review limit.");
    const contents = await readFile(canonical);
    const afterRead = await stat(canonical);
    if (afterRead.ino !== canonicalStats.ino || afterRead.size !== canonicalStats.size || afterRead.mtimeMs !== canonicalStats.mtimeMs ||
        (process.platform !== "win32" && afterRead.dev !== canonicalStats.dev)) throw new ReviewedCommandError("Selected test changed while it was being approved.");
    return {
      relativePath: value,
      canonicalPath: canonical,
      size: afterRead.size,
      modifiedAt: afterRead.mtimeMs,
      ino: afterRead.ino,
      dev: afterRead.dev,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
  } catch (error: unknown) {
    if (error instanceof ReviewedCommandError) throw error;
    throw new ReviewedCommandError("Selected test must be an existing in-root regular .js, .cjs, or .mjs file.");
  }
}

export async function runReviewedCommand(
  store: Persistence,
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  command: unknown,
  selectedTestPath?: unknown,
): Promise<ReviewedCommandResult> {
  if (command !== "node-test" && command !== "typescript-check") {
    throw new ReviewedCommandError("Allowed checks are node-test and typescript-check.");
  }
  const approvedRoot = resolve(root.path);
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === approvedRoot)) {
    throw new ReviewedCommandError("Repository root approval is required before execution.");
  }

  let executable = process.execPath;
  let effectiveCommand: ReviewedCommandId = command;
  let selectedTest: SelectedTestIdentity | undefined;
  let arguments_: readonly string[] = command === "node-test" ? ["--test"] : [];
  if (selectedTestPath !== undefined) {
    if (command !== "node-test") throw new ReviewedCommandError("Selected test files are supported only with node-test.");
    selectedTest = await selectedNodeTestPath(root, policy, selectedTestPath);
    arguments_ = ["--test", selectedTest.canonicalPath];
    effectiveCommand = "node-test-selected";
  }
  if (command === "typescript-check") {
    executable = process.execPath;
    arguments_ = [await approvedTscPath(root, policy), "--noEmit"];
  }

  const runId = randomUUID();
  await store.saveRunSummary({
    runId,
    workflowId: WORKFLOW_ID,
    summary: `Reviewed ${effectiveCommand} check is pending; command output is not persisted.`,
  });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_started", stepId: effectiveCommand });

  let processResult: ProcessResult;
  try {
    if (selectedTest !== undefined) {
      const current = await selectedNodeTestPath(root, policy, selectedTest.relativePath);
      if (current.canonicalPath !== selectedTest.canonicalPath || current.size !== selectedTest.size ||
          current.modifiedAt !== selectedTest.modifiedAt || current.ino !== selectedTest.ino ||
          (process.platform !== "win32" && current.dev !== selectedTest.dev) || current.sha256 !== selectedTest.sha256) {
        throw new ReviewedCommandError("Selected test changed after approval; approve a fresh test snapshot.");
      }
    }
    processResult = await runChildProcess(executable, arguments_, approvedRoot);
  } catch (error: unknown) {
    if (!(error instanceof ReviewedCommandError)) throw error;
    processResult = {
      exitCode: null,
      status: "could_not_start",
      durationMs: 0,
      outputTruncated: false,
      observedOutputBytes: 0,
    };
  }
  const status = statusFor(processResult);
  const finalSummary = summary(effectiveCommand, status, processResult.exitCode);
  await store.updateRunSummary(runId, finalSummary);
  await store.updateRunState(runId, status === "passed" ? "completed" : "failed");
  await store.appendRunEvent({
    runId,
    eventId: randomUUID(),
    type: status === "passed" ? "step_finished" : "run_failed",
    ...(status === "passed" ? { stepId: effectiveCommand } : { toolName: effectiveCommand }),
  });
  if (status === "passed") {
    await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_finished" });
  }
  return {
    run: {
      runId,
      workflowId: WORKFLOW_ID,
      summary: finalSummary,
      state: status === "passed" ? "completed" : "failed",
      createdAt: new Date(),
    },
    command: effectiveCommand,
    status,
    exitCode: processResult.exitCode,
    durationMs: processResult.durationMs,
    outputTruncated: processResult.outputTruncated,
    observedOutputBytes: processResult.observedOutputBytes,
  };
}
