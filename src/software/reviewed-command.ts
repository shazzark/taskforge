import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, readdir, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { MongoStore, RunSummary } from "../mongo-store.js";
import type { ApprovedRoot, WorkspacePathPolicy } from "../security/path-policy.js";

const MAX_RUNTIME_MS = 120_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const MAX_SELECTED_TEST_BYTES = 2 * 1024 * 1024;
const WORKFLOW_ID = "software-check";
const BUILD_PREFIX = ".taskforge-build-";
const BUILD_OWNER_FILE = ".taskforge-owner.json";
const STALE_BUILD_AGE_MS = 24 * 60 * 60 * 1_000;

export type ReviewedCommandId = "node-test" | "node-test-selected" | "typescript-check" | "typescript-build";
export type ReviewedCommandStatus = "passed" | "failed" | "timed_out" | "cancelled" | "could_not_start";

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

interface BuildPreparation {
  readonly arguments: readonly string[];
  readonly outputDirectory: string;
  readonly ownerToken: string;
}

async function removeOwnedBuildDirectory(directory: string, ownerToken: string): Promise<void> {
  try {
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return;
    const ownerPath = join(directory, BUILD_OWNER_FILE);
    const ownerStats = await lstat(ownerPath);
    if (!ownerStats.isFile() || ownerStats.isSymbolicLink()) return;
    const owner: unknown = JSON.parse(await readFile(ownerPath, "utf8"));
    if (typeof owner !== "object" || owner === null || !("pid" in owner) || owner.pid !== process.pid ||
        !("directoryId" in owner) || owner.directoryId !== ownerToken || basename(directory).slice(BUILD_PREFIX.length) !== ownerToken ||
        !(await containsOnlyBuildOutputs(directory, ownerPath))) return;
    await rm(directory, { recursive: true, force: false });
  } catch {
    // Preserve any artifact whose ownership or contents cannot be verified.
  }
}

async function reapStaleBuildDirectories(rootPath: string): Promise<void> {
  let entries: string[];
  try { entries = await readdir(rootPath); } catch { return; }
  for (const entry of entries) {
    if (!entry.startsWith(BUILD_PREFIX)) continue;
    const directory = join(rootPath, entry);
    try {
      const directoryStats = await lstat(directory);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink() || Date.now() - directoryStats.mtimeMs < STALE_BUILD_AGE_MS) continue;
      const ownerPath = join(directory, BUILD_OWNER_FILE);
      const ownerStats = await lstat(ownerPath);
      if (!ownerStats.isFile() || ownerStats.isSymbolicLink()) continue;
      const owner: unknown = JSON.parse(await readFile(ownerPath, "utf8"));
      const directoryId = entry.slice(BUILD_PREFIX.length);
      if (typeof owner !== "object" || owner === null || !("pid" in owner) || typeof owner.pid !== "number" ||
          !Number.isSafeInteger(owner.pid) || owner.pid < 1 || !("directoryId" in owner) ||
          owner.directoryId !== directoryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9]{6}$/iu.test(directoryId)) continue;
      try { process.kill(owner.pid, 0); }
      catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
          if (await containsOnlyBuildOutputs(directory, ownerPath)) await rm(directory, { recursive: true, force: false });
        }
      }
    } catch {
      // Unknown or changing artifacts are retained for safety.
    }
  }
}

async function containsOnlyBuildOutputs(directory: string, ownerPath: string): Promise<boolean> {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (path === ownerPath) continue;
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) pending.push(path);
      else if (!entry.isFile() || !/\.(?:[cm]?js|jsx|map|d\.ts|tsbuildinfo)$/iu.test(entry.name)) return false;
      if (relative(directory, path).startsWith("..")) return false;
    }
  }
  return true;
}

async function buildArguments(root: ApprovedRoot, policy: WorkspacePathPolicy): Promise<BuildPreparation> {
  const rootPath = resolve(root.path);
  let outputDirectoryForCleanup: string | undefined;
  let ownerTokenForCleanup: string | undefined;
  try {
    const compilerPath = await approvedTscPath(root, policy);
    const configResult = spawnSync(process.execPath, [compilerPath, "--showConfig"], {
      cwd: rootPath, env: safeEnvironment(), shell: false, windowsHide: true,
      encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024,
    });
    if (configResult.error !== undefined || configResult.status !== 0 || configResult.stdout === null || configResult.stdout.length > 1024 * 1024) {
      throw new ReviewedCommandError("TypeScript configuration could not be inspected safely.");
    }
    let effectiveConfig: unknown;
    try { effectiveConfig = JSON.parse(configResult.stdout) as unknown; }
    catch { throw new ReviewedCommandError("TypeScript configuration is invalid."); }
    if (typeof effectiveConfig !== "object" || effectiveConfig === null || !("compilerOptions" in effectiveConfig)) {
      throw new ReviewedCommandError("TypeScript configuration is invalid.");
    }
    const options: unknown = effectiveConfig.compilerOptions;
    if (typeof options !== "object" || options === null || Array.isArray(options)) throw new ReviewedCommandError("TypeScript configuration is invalid.");
    if ("outFile" in options && options.outFile !== undefined) throw new ReviewedCommandError("TypeScript build does not support configured outFile targets.");
    if (("generateTrace" in options && options.generateTrace !== undefined && options.generateTrace !== false) ||
        ("generateCpuProfile" in options && options.generateCpuProfile !== undefined && options.generateCpuProfile !== false)) {
      throw new ReviewedCommandError("TypeScript trace and CPU profile output options are not supported by the approved build.");
    }

    await reapStaleBuildDirectories(rootPath);
    const outputDirectory = await mkdtemp(join(rootPath, `${BUILD_PREFIX}${randomUUID()}-`));
    outputDirectoryForCleanup = outputDirectory;
    const runToken = basename(outputDirectory).slice(BUILD_PREFIX.length);
    ownerTokenForCleanup = runToken;
    await writeFile(join(outputDirectory, BUILD_OWNER_FILE), JSON.stringify({ pid: process.pid, directoryId: runToken }), { flag: "wx" });
    if ((await realpath(outputDirectory)) !== outputDirectory) throw new ReviewedCommandError("The build output directory must remain under the approved root.");
    const declarationDirectory = join(outputDirectory, "types");
    const arguments_: string[] = [
      compilerPath,
      "--outDir", outputDirectory,
    ];
    if (("declaration" in options && options.declaration === true) || ("composite" in options && options.composite === true)) {
      await mkdir(declarationDirectory);
      if ((await realpath(declarationDirectory)) !== declarationDirectory) throw new ReviewedCommandError("The declaration output directory must remain under the approved root.");
      arguments_.push("--declarationDir", declarationDirectory);
    }
    if (("incremental" in options && options.incremental === true) || ("composite" in options && options.composite === true)) {
      arguments_.push("--tsBuildInfoFile", join(outputDirectory, "taskforge.tsbuildinfo"));
    }
    return { arguments: arguments_, outputDirectory, ownerToken: runToken };
  } catch (error: unknown) {
    if (outputDirectoryForCleanup !== undefined && ownerTokenForCleanup !== undefined) {
      await removeOwnedBuildDirectory(outputDirectoryForCleanup, ownerTokenForCleanup);
    }
    if (error instanceof ReviewedCommandError) throw error;
    throw new ReviewedCommandError("TypeScript build configuration or output path could not be validated.");
  }
}

function runChildProcess(executable: string, arguments_: readonly string[], cwd: string, signal?: AbortSignal): Promise<ProcessResult> {
  const startedAt = Date.now();
  if (signal?.aborted === true) return Promise.resolve({ exitCode: null, status: "cancelled", durationMs: 0, outputTruncated: false, observedOutputBytes: 0 });
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
    let cancelled = false;
    const finish = (result: ProcessResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolveResult(result);
    };
    const onAbort = (): void => {
      cancelled = true;
      terminateProcessTree(child);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, MAX_RUNTIME_MS);
    if (signal?.aborted === true) onAbort();
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
        status: cancelled ? "cancelled" : timedOut ? "timed_out" : "completed",
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
    child.kill();
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
  signal?: AbortSignal,
): Promise<ReviewedCommandResult> {
  if (command !== "node-test" && command !== "typescript-check" && command !== "typescript-build") {
    throw new ReviewedCommandError("Allowed checks are node-test, typescript-check, and typescript-build.");
  }
  const approvedRoot = resolve(root.path);
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === approvedRoot)) {
    throw new ReviewedCommandError("Repository root approval is required before execution.");
  }

  let executable = process.execPath;
  let effectiveCommand: ReviewedCommandId = command;
  let buildOutputDirectory: string | undefined;
  let buildOwnerToken: string | undefined;
  let selectedTest: SelectedTestIdentity | undefined;
  let arguments_: readonly string[] = command === "node-test" ? ["--test"] : [];
  if (selectedTestPath !== undefined) {
    if (command !== "node-test") throw new ReviewedCommandError("Selected test files are supported only with node-test.");
    selectedTest = await selectedNodeTestPath(root, policy, selectedTestPath);
    arguments_ = ["--test", selectedTest.canonicalPath];
    effectiveCommand = "node-test-selected";
  }
  if (command === "typescript-check" || command === "typescript-build") {
    executable = process.execPath;
    if (command === "typescript-check") arguments_ = [await approvedTscPath(root, policy), "--noEmit"];
    else {
      const build = await buildArguments(root, policy);
      arguments_ = build.arguments;
      buildOutputDirectory = build.outputDirectory;
      buildOwnerToken = build.ownerToken;
    }
  }

  try {
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
    processResult = await runChildProcess(executable, arguments_, approvedRoot, signal);
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
  } finally {
    if (buildOutputDirectory !== undefined && buildOwnerToken !== undefined) {
      await removeOwnedBuildDirectory(buildOutputDirectory, buildOwnerToken);
    }
  }
}
