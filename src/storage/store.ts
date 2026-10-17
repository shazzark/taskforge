import type {
  ArtifactReference,
  FolderApproval,
  RunCheckpoint,
  RunEvent,
  RunSummary,
  ScheduleClaim,
  ScheduleOccurrence,
  ScheduleRecord,
} from "./types.js";

/** Public persistence operations shared by every storage adapter. */
export interface TaskForgeStore {
  saveRunSummary(value: unknown): Promise<RunSummary>;
  updateRunSummary(runId: unknown, summary: unknown): Promise<RunSummary>;
  listRunSummaries(): Promise<readonly RunSummary[]>;
  saveArtifactReference(value: unknown): Promise<ArtifactReference>;
  listArtifactReferences(runId: unknown): Promise<readonly ArtifactReference[]>;
  updateRunState(runId: unknown, nextState: unknown): Promise<RunSummary>;
  recoverStaleRun(runId: unknown, staleBefore: unknown): Promise<boolean>;
  appendRunEvent(value: unknown): Promise<RunEvent>;
  getRunEvents(runId: unknown): Promise<readonly RunEvent[]>;
  saveRunCheckpoint(value: unknown): Promise<RunCheckpoint>;
  loadRunCheckpoint(runId: unknown, inputHash: unknown, stateHash: unknown): Promise<RunCheckpoint | null>;
  getRunSummary(runId: unknown): Promise<RunSummary | null>;
  createSchedule(value: unknown): Promise<ScheduleRecord>;
  listSchedules(includeDeleted?: boolean): Promise<readonly ScheduleRecord[]>;
  grantFolderApproval(path: unknown, access: unknown): Promise<FolderApproval>;
  listFolderApprovals(includeRevoked?: boolean): Promise<readonly FolderApproval[]>;
  hasFolderApproval(path: unknown, access: unknown): Promise<boolean>;
  revokeFolderApproval(path: unknown, access: unknown): Promise<boolean>;
  setScheduleStatus(scheduleId: unknown, nextStatus: unknown): Promise<ScheduleRecord>;
  claimDueSchedules(now: unknown, graceMs: unknown): Promise<readonly ScheduleClaim[]>;
  listPendingScheduleOccurrences(): Promise<readonly ScheduleClaim[]>;
  claimPendingScheduleOccurrences(ownerId: unknown): Promise<readonly ScheduleClaim[]>;
  releaseScheduleOccurrenceClaim(scheduleId: unknown, scheduledFor: unknown, ownerId: unknown): Promise<void>;
  recoverScheduleOccurrenceClaim(scheduleId: unknown, scheduledFor: unknown): Promise<boolean>;
  finishScheduleOccurrence(scheduleId: unknown, scheduledFor: unknown, outcome: unknown, ownerId?: unknown): Promise<void>;
  close(): Promise<void>;
}

export type StoreRunSummary = RunSummary;
export type StoreRunEvent = RunEvent;
export type StoreRunCheckpoint = RunCheckpoint;
export type StoreArtifactReference = ArtifactReference;
export type StoreFolderApproval = FolderApproval;
export type StoreSchedule = ScheduleRecord;
export type StoreScheduleOccurrence = ScheduleOccurrence;
