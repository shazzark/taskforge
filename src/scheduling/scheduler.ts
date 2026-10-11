import type { MongoStore, ScheduleRecord } from "../mongo-store.js";
import { setTimeout as delay } from "node:timers/promises";

const SCHEDULER_GRACE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

type SchedulerPersistence = Pick<
  MongoStore,
  "claimDueSchedules" | "claimPendingScheduleOccurrences" | "releaseScheduleOccurrenceClaim" | "listPendingScheduleOccurrences" | "finishScheduleOccurrence"
>;

export interface SchedulerTickResult {
  readonly claimed: number;
  readonly pending: number;
  readonly missed: number;
  readonly completed: number;
  readonly failed: number;
}

export interface SchedulerTickOptions {
  readonly now: Date;
  readonly userPresent: boolean;
  readonly confirm: (schedule: ScheduleRecord, scheduledFor: Date) => Promise<boolean>;
  readonly execute: (schedule: ScheduleRecord) => Promise<boolean>;
  readonly attemptedOccurrences: Set<string>;
  readonly ownerId: string;
}

function occurrenceKey(scheduleId: string, scheduledFor: Date): string {
  return `${scheduleId}:${scheduledFor.getTime()}`;
}

export async function runSchedulerTick(
  store: SchedulerPersistence,
  options: SchedulerTickOptions,
): Promise<SchedulerTickResult> {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new TypeError("Scheduler tick requires a valid timestamp.");
  }
  const claims = await store.claimDueSchedules(options.now, SCHEDULER_GRACE_MS);
  const pending = options.userPresent
    ? await store.claimPendingScheduleOccurrences(options.ownerId)
    : [];
  let completed = 0;
  let failed = 0;
  for (const entry of pending) {
    const key = occurrenceKey(entry.schedule.scheduleId, entry.occurrence.scheduledFor);
    if (options.attemptedOccurrences.has(key)) {
      await store.releaseScheduleOccurrenceClaim(entry.schedule.scheduleId, entry.occurrence.scheduledFor, options.ownerId);
      continue;
    }
    options.attemptedOccurrences.add(key);
    let approved: boolean;
    try {
      approved = await options.confirm(entry.schedule, entry.occurrence.scheduledFor);
    } catch {
      await store.releaseScheduleOccurrenceClaim(entry.schedule.scheduleId, entry.occurrence.scheduledFor, options.ownerId);
      continue;
    }
    if (!approved) {
      await store.releaseScheduleOccurrenceClaim(entry.schedule.scheduleId, entry.occurrence.scheduledFor, options.ownerId);
      continue;
    }
    try {
      const didRun = await options.execute(entry.schedule);
      if (!didRun) {
        await store.releaseScheduleOccurrenceClaim(entry.schedule.scheduleId, entry.occurrence.scheduledFor, options.ownerId);
        continue;
      }
      await store.finishScheduleOccurrence(entry.schedule.scheduleId, entry.occurrence.scheduledFor, "completed", options.ownerId);
      completed += 1;
    } catch {
      await store.finishScheduleOccurrence(entry.schedule.scheduleId, entry.occurrence.scheduledFor, "failed", options.ownerId);
      failed += 1;
    }
  }
  const remaining = await store.listPendingScheduleOccurrences();
  return {
    claimed: claims.length,
    pending: remaining.length,
    missed: claims.reduce((count, entry) => count + (entry.occurrence.status === "missed" ? entry.occurrence.missedCount : 0), 0),
    completed,
    failed,
  };
}

export async function runScheduler(
  signal: AbortSignal,
  tick: (now?: Date) => Promise<SchedulerTickResult>,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): Promise<void> {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000) {
    throw new TypeError("Scheduler poll interval must be from 1 to 60 seconds.");
  }
  while (!signal.aborted) {
    await tick(new Date());
    if (!signal.aborted) {
      try {
        await delay(pollIntervalMs, undefined, { signal });
      } catch (error: unknown) {
        if (!signal.aborted) throw error;
      }
    }
  }
}
