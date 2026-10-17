import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { analyzeDocument, resumeDocumentAnalysisWorkflow } from "../../workflows/document-analysis-workflow.js";
import { resumeCsvAnalysisWorkflow, runCsvAnalysisWorkflow } from "../../workflows/csv-analysis-workflow.js";
import { runScheduler, runSchedulerTick } from "../../scheduling/scheduler.js";
import { WorkspacePathPolicy } from "../../security/path-policy.js";
import type { ScheduleRecord, ScheduleWorkflowId } from "../../storage/types.js";
import type { TaskForgeStore } from "../../storage/store.js";

export interface SchedulingCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
  readonly readApprovedInputFile: (pathValue: string) => Promise<Uint8Array | undefined>;
  readonly requirePersistentFolderApproval: (pathValue: string, access: "read" | "write") => Promise<void>;
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

async function executeScheduledWorkflow(
  dependencies: SchedulingCommandDependencies,
  store: TaskForgeStore,
  schedule: ScheduleRecord,
  occurrence: { readonly runId: string },
): Promise<boolean> {
  const input = await dependencies.readApprovedInputFile(schedule.inputPath);
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

export async function runScheduleCommand(
  commandArgs: readonly string[],
  dependencies: SchedulingCommandDependencies,
): Promise<void> {
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
      await dependencies.requirePersistentFolderApproval(dirname(absolutePath), "read");
      const approvedRoot = await policy.approveRoot(dirname(absolutePath));
      const authorized = await policy.authorizePath(absolutePath, "read");
      const canonicalPath = await realpath(authorized.path);
      const metadata = await stat(canonicalPath);
      if (canonicalPath !== authorized.path || !metadata.isFile()) throw new Error("File path is not a stable regular file.");
      process.stdout.write(`Future executions store and read this exact local file: ${canonicalPath}\n`);
      process.stdout.write(`Approved root: ${approvedRoot}\nThe file will require fresh read approval for every scheduled run.\n`);
      if (!(await askScheduleQuestion("Create this schedule?"))) return;
      const schedule = await dependencies.withStore((store) => store.createSchedule({
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
    const schedules = await dependencies.withStore((store) => store.listSchedules());
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
    const schedule = await dependencies.withStore((store) => store.setScheduleStatus(commandArgs[1], nextStatus));
    if (schedule !== undefined) process.stdout.write(`Schedule ${schedule.scheduleId}: ${schedule.status}.\n`);
    return;
  }
  if (action === "recover" && commandArgs.length === 2 && commandArgs[1] !== undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write("Recovering a claimed occurrence requires an interactive terminal.\n");
      process.exitCode = 2;
      return;
    }
    await dependencies.withStore(async (store) => {
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
      await dependencies.withStore(async (store) => {
        const attempted = new Set<string>();
        const ownerId = randomUUID();
        const tick = async (now = new Date()) => {
          const result = await runSchedulerTick(store, {
            now,
            userPresent: process.stdin.isTTY === true && process.stdout.isTTY === true,
            attemptedOccurrences: attempted,
            ownerId,
            confirm: async (schedule, scheduledFor) => askScheduleQuestion(`Run ${schedule.workflowId} for ${basename(schedule.inputPath)} scheduled at ${scheduledFor.toISOString()}?`),
            execute: (schedule, occurrence) => executeScheduledWorkflow(dependencies, store, schedule, occurrence),
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
