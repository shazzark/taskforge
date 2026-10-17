export interface RunSummaryInput {
  readonly runId: string;
  readonly workflowId: string;
  readonly summary: string;
}

export type RunState = "created" | "awaiting_approval" | "running" | "completed" | "failed" | "cancelled" | "uncertain";

export interface RunSummary extends RunSummaryInput {
  readonly state: RunState;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
}

export type RunEventType =
  | "run_started"
  | "step_started"
  | "step_finished"
  | "tool_intent"
  | "tool_finished"
  | "approval_required"
  | "run_paused"
  | "run_resumed"
  | "run_finished"
  | "run_failed"
  | "run_cancelled";

export interface RunEventInput {
  readonly runId: string;
  readonly eventId: string;
  readonly type: RunEventType;
  readonly stepId?: string;
  readonly toolName?: string;
}

export interface RunEvent extends RunEventInput {
  readonly sequence: number;
  readonly createdAt: Date;
}

export interface RunCheckpointInput {
  readonly runId: string;
  readonly version: 1;
  readonly inputHash: string;
  readonly stateHash: string;
  readonly completedStepIds: readonly string[];
  readonly pendingStepId?: string;
}

export interface RunCheckpoint extends RunCheckpointInput {
  readonly updatedAt: Date;
}

export type ScheduleWorkflowId = "csv-analyze" | "document-analyze";
export type ScheduleStatus = "active" | "paused" | "completed" | "deleted";
export type ScheduleOccurrenceStatus = "awaiting_approval" | "missed" | "completed" | "failed";

export interface ScheduleOccurrence {
  readonly runId: string;
  readonly scheduledFor: Date;
  readonly status: ScheduleOccurrenceStatus;
  readonly missedCount: number;
  readonly recordedAt: Date;
}

export interface ScheduleDefinition {
  readonly scheduleId: string;
  readonly workflowId: ScheduleWorkflowId;
  readonly inputPath: string;
  readonly nextRunAt: Date;
  readonly intervalMinutes?: number;
}

export interface ScheduleRecord extends ScheduleDefinition {
  readonly status: ScheduleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly occurrences: readonly ScheduleOccurrence[];
  readonly pendingOccurrence?: ScheduleOccurrence;
  readonly dispatchOwner?: string;
  readonly dispatchStartedAt?: Date;
}

export interface ScheduleClaim {
  readonly schedule: ScheduleRecord;
  readonly occurrence: ScheduleOccurrence;
}

export type FolderApprovalAccess = "read" | "write";

export interface FolderApproval {
  readonly path: string;
  readonly access: FolderApprovalAccess;
  readonly status: "active" | "revoked";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ArtifactType = "csv-analysis-json" | "csv-analysis-csv" | "csv-analysis-markdown" | "document-plain-text" | "document-analysis-json" | "document-analysis-csv" | "document-analysis-markdown";

export interface ArtifactReference {
  readonly artifactId: string;
  readonly runId: string;
  readonly relativePath: string;
  readonly type: ArtifactType;
  readonly sha256: string;
  readonly bytes: number;
  readonly createdAt: Date;
}

export class DatabaseShutdownError extends Error {
  constructor(message = "Unable to close the TaskForge storage cleanly.") {
    super(message);
    this.name = "DatabaseShutdownError";
  }
}

export class DatabasePersistenceError extends Error {
  constructor(message = "Unable to persist or read TaskForge data.") {
    super(message);
    this.name = "DatabasePersistenceError";
  }
}

export class PersistenceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceInputError";
  }
}

export class StaleCheckpointError extends Error {
  constructor() {
    super("Run checkpoint is stale because its inputs or state have changed.");
    this.name = "StaleCheckpointError";
  }
}
