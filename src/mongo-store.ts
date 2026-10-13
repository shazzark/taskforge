import { MongoClient, type Collection, type Document } from "mongodb";
import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import { parseConfiguration } from "./config.js";

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

export type FolderApprovalAccess = "read" | "write";
export interface FolderApproval {
  readonly path: string;
  readonly access: FolderApprovalAccess;
  readonly status: "active" | "revoked";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ArtifactType = "csv-analysis-json" | "csv-analysis-csv" | "csv-analysis-markdown" | "document-plain-text";
export interface ArtifactReference {
  readonly artifactId: string;
  readonly runId: string;
  readonly relativePath: string;
  readonly type: ArtifactType;
  readonly sha256: string;
  readonly bytes: number;
  readonly createdAt: Date;
}

interface StoredRunSummary extends Document {
  readonly _id: string;
  readonly runId: string;
  readonly workflowId: string;
  readonly summary: string;
  readonly state: RunState;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
  readonly eventCount?: number;
  readonly eventBytes?: number;
}

interface StoredRunEvent extends Document {
  readonly _id: string;
  readonly runId: string;
  readonly eventId: string;
  readonly type: RunEventType;
  readonly sequence: number;
  readonly stepId?: string;
  readonly toolName?: string;
  readonly createdAt: Date;
}

interface StoredRunCheckpoint extends Document {
  readonly _id: string;
  readonly runId: string;
  readonly version: 1;
  readonly inputHash: string;
  readonly stateHash: string;
  readonly completedStepIds: string[];
  readonly pendingStepId?: string;
  readonly updatedAt: Date;
}

interface StoredSchedule extends Document {
  readonly _id: string;
  readonly scheduleId: string;
  readonly workflowId: ScheduleWorkflowId;
  readonly inputPath: string;
  readonly nextRunAt: Date;
  readonly intervalMinutes?: number;
  readonly status: ScheduleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly occurrences: ScheduleOccurrence[];
  readonly pendingOccurrence?: ScheduleOccurrence;
  readonly dispatchOwner?: string;
  readonly dispatchStartedAt?: Date;
}

interface StoredFolderApproval extends Document {
  readonly _id: string;
  readonly path: string;
  readonly access: FolderApprovalAccess;
  readonly status: "active" | "revoked";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface StoredArtifactReference extends Document {
  readonly _id: string;
  readonly artifactId: string;
  readonly runId: string;
  readonly relativePath: string;
  readonly type: ArtifactType;
  readonly sha256: string;
  readonly bytes: number;
  readonly createdAt: Date;
}

const MAX_EVENTS_PER_RUN = 300;
const MAX_EVENT_BYTES_PER_RUN = 5 * 1024 * 1024;
const MAX_EVENT_BYTES = 2 * 1024;
const MAX_CHECKPOINT_STEPS = 256;
const MAX_CHECKPOINT_BYTES = 64 * 1024;
const MAX_RUN_SUMMARY_CHARACTERS = 4_000;
const MAX_SCHEDULES = 500;
const MAX_SCHEDULE_OCCURRENCES = 100;
const EVENT_TYPES: ReadonlySet<string> = new Set([
  "run_started",
  "step_started",
  "step_finished",
  "tool_intent",
  "tool_finished",
  "approval_required",
  "run_paused",
  "run_resumed",
  "run_finished",
  "run_failed",
  "run_cancelled",
]);
const TERMINAL_STATES = new Set<RunState>(["completed", "failed", "cancelled"]);
const ALLOWED_RUN_TRANSITIONS: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  created: new Set(["awaiting_approval", "running", "failed", "cancelled", "uncertain"]),
  awaiting_approval: new Set(["running", "failed", "cancelled"]),
  running: new Set(["completed", "failed", "cancelled", "uncertain"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  uncertain: new Set(["running", "failed", "cancelled"]),
};

export class DatabaseConnectionError extends Error {
  constructor() {
    super("Unable to connect to MongoDB. Check server availability and TASKFORGE_MONGODB_URI.");
    this.name = "DatabaseConnectionError";
  }
}

export class DatabaseShutdownError extends Error {
  constructor() {
    super("Unable to close the MongoDB connection cleanly.");
    this.name = "DatabaseShutdownError";
  }
}

export class DatabasePersistenceError extends Error {
  constructor() {
    super("Unable to persist or read a run summary from MongoDB.");
    this.name = "DatabasePersistenceError";
  }
}

export class PersistenceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceInputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRunSummaryInput(value: unknown): RunSummaryInput {
  if (!isRecord(value)) {
    throw new PersistenceInputError("Run summary must be an object.");
  }

  const runId = value["runId"];
  const workflowId = value["workflowId"];
  const summary = value["summary"];
  if (typeof summary !== "string") {
    throw new PersistenceInputError("Run summary requires a string summary.");
  }

  return {
    runId: parseIdentifier(runId, "Run summary runId"),
    workflowId: parseIdentifier(workflowId, "Run summary workflowId"),
    summary: redactSensitiveText(summary.slice(0, MAX_RUN_SUMMARY_CHARACTERS)).slice(0, MAX_RUN_SUMMARY_CHARACTERS),
  };
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:mongodb(?:\+srv)?|https?):\/\/[^/\s:@]+:[^@\s/]+@[^\s]+/giu, "[REDACTED_CONNECTION]")
    .replace(/\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;.]+/giu, (match) => {
      const separatorIndex = match.search(/[:=]/u);
      return `${match.slice(0, separatorIndex + 1)}[REDACTED]`;
    })
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\b(?:gsk_[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/giu, "[REDACTED]");
}

function parseIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new PersistenceInputError(`${label} must be a bounded identifier.`);
  }
  if (/(?:password|secret|token|api[_-]?key|gsk_|gh[pousr]_|github_pat_|sk-)/iu.test(value)) {
    throw new PersistenceInputError(`${label} cannot contain credential-like values.`);
  }
  return value;
}

function isRunEventType(value: string): value is RunEventType {
  return EVENT_TYPES.has(value);
}

function parseRunEventInput(value: unknown): RunEventInput {
  if (!isRecord(value)) {
    throw new PersistenceInputError("Run event must be an object.");
  }
  const allowedKeys = new Set(["runId", "eventId", "type", "stepId", "toolName"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new PersistenceInputError("Run event contains unsupported fields.");
  }
  const runId = parseIdentifier(value["runId"], "Run event runId");
  const eventId = parseIdentifier(value["eventId"], "Run event eventId");
  const type = value["type"];
  if (typeof type !== "string" || !isRunEventType(type)) {
    throw new PersistenceInputError("Run event type is unsupported.");
  }
  const stepIdValue = value["stepId"];
  const toolNameValue = value["toolName"];
  const stepId = stepIdValue === undefined ? undefined : parseIdentifier(stepIdValue, "Run event stepId");
  const toolName = toolNameValue === undefined ? undefined : parseIdentifier(toolNameValue, "Run event toolName");
  return {
    runId,
    eventId,
    type,
    ...(stepId === undefined ? {} : { stepId }),
    ...(toolName === undefined ? {} : { toolName }),
  };
}

function isRunState(value: unknown): value is RunState {
  return value === "created" || value === "awaiting_approval" || value === "running" || value === "completed" ||
    value === "failed" || value === "cancelled" || value === "uncertain";
}

function parseHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new PersistenceInputError(`${label} must be a SHA-256 hex digest.`);
  }
  return value;
}

function parseRunCheckpointInput(value: unknown): RunCheckpointInput {
  if (!isRecord(value)) {
    throw new PersistenceInputError("Run checkpoint must be an object.");
  }
  const allowedKeys = new Set(["runId", "version", "inputHash", "stateHash", "completedStepIds", "pendingStepId"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new PersistenceInputError("Run checkpoint contains unsupported fields.");
  }
  const runId = parseIdentifier(value["runId"], "Run checkpoint runId");
  const version = value["version"];
  const inputHash = parseHash(value["inputHash"], "Run checkpoint inputHash");
  const stateHash = parseHash(value["stateHash"], "Run checkpoint stateHash");
  const stepValues = value["completedStepIds"];
  const pendingStepValue = value["pendingStepId"];
  if (version !== 1 || !Array.isArray(stepValues) || stepValues.length > MAX_CHECKPOINT_STEPS) {
    throw new PersistenceInputError("Run checkpoint version or completed steps are invalid.");
  }
  const completedStepIds = stepValues.map((stepId) => parseIdentifier(stepId, "Completed stepId"));
  if (new Set(completedStepIds).size !== completedStepIds.length) {
    throw new PersistenceInputError("Run checkpoint contains duplicate completed steps.");
  }
  const pendingStepId = pendingStepValue === undefined
    ? undefined
    : parseIdentifier(pendingStepValue, "Pending stepId");
  const normalized: RunCheckpointInput = {
    runId,
    version: 1,
    inputHash,
    stateHash,
    completedStepIds,
    ...(pendingStepId === undefined ? {} : { pendingStepId }),
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_CHECKPOINT_BYTES) {
    throw new PersistenceInputError("Run checkpoint exceeds the supported size limit.");
  }
  return normalized;
}

function parseScheduleDefinition(value: unknown): ScheduleDefinition {
  if (!isRecord(value)) throw new PersistenceInputError("Schedule definition must be an object.");
  const allowedKeys = new Set(["scheduleId", "workflowId", "inputPath", "nextRunAt", "intervalMinutes"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new PersistenceInputError("Schedule definition contains unsupported fields.");
  }
  const scheduleId = parseIdentifier(value["scheduleId"], "Schedule id");
  const workflowId = value["workflowId"];
  const inputPath = value["inputPath"];
  const nextRunAt = value["nextRunAt"];
  const intervalMinutes = value["intervalMinutes"];
  if (workflowId !== "csv-analyze" && workflowId !== "document-analyze") {
    throw new PersistenceInputError("Scheduled workflow is not supported.");
  }
  if (
    typeof inputPath !== "string" || inputPath.length < 1 || inputPath.length > 2_048 ||
    !isAbsolute(inputPath) || /[\u0000-\u001f\u007f]/u.test(inputPath)
  ) {
    throw new PersistenceInputError("Schedule input path must be an absolute path without control characters.");
  }
  const extension = extname(inputPath).toLowerCase();
  if ((workflowId === "csv-analyze" && extension !== ".csv") ||
      (workflowId === "document-analyze" && !new Set([".txt", ".md", ".markdown", ".pdf", ".docx", ".xlsx"]).has(extension))) {
    throw new PersistenceInputError("Schedule workflow does not support the input file extension.");
  }
  if (!(nextRunAt instanceof Date) || Number.isNaN(nextRunAt.getTime())) {
    throw new PersistenceInputError("Schedule next-run time must be a valid date.");
  }
  if (intervalMinutes !== undefined && (
    typeof intervalMinutes !== "number" || !Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10_080
  )) {
    throw new PersistenceInputError("Schedule interval must be between 1 minute and 7 days.");
  }
  return {
    scheduleId,
    workflowId,
    inputPath,
    nextRunAt,
    ...(intervalMinutes === undefined ? {} : { intervalMinutes }),
  };
}

function parseApprovedFolderPath(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048 || !isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PersistenceInputError("Approved folder path must be an absolute path without control characters.");
  }
  return value;
}

function folderApprovalId(path: string, access: FolderApprovalAccess): string {
  const identity = platform() === "win32" ? path.toLowerCase() : path;
  return createHash("sha256").update(`${identity}\0${access}`).digest("hex");
}

function containsFolder(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const scopedRoot = platform() === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const scopedCandidate = platform() === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  const pathFromRoot = relative(scopedRoot, scopedCandidate);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

function parseFolderApprovalAccess(value: unknown): FolderApprovalAccess {
  if (value !== "read" && value !== "write") throw new PersistenceInputError("Folder approval access must be read or write.");
  return value;
}

function parseStoredFolderApproval(value: unknown): FolderApproval {
  if (!isRecord(value)) throw new DatabasePersistenceError();
  const path = parseApprovedFolderPath(value["path"]);
  const access = parseFolderApprovalAccess(value["access"]);
  const status = value["status"];
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if ((status !== "active" && status !== "revoked") || !(createdAt instanceof Date) || !(updatedAt instanceof Date)) {
    throw new DatabasePersistenceError();
  }
  return { path, access, status, createdAt, updatedAt };
}

function parseArtifactReference(value: unknown): ArtifactReference {
  if (!isRecord(value)) throw new PersistenceInputError("Artifact reference must be an object.");
  const artifactId = parseIdentifier(value["artifactId"], "Artifact id");
  const runId = parseIdentifier(value["runId"], "Artifact runId");
  const relativePathValue = value["relativePath"];
  if (typeof relativePathValue !== "string" || relativePathValue.length === 0 || relativePathValue.length > 512 ||
      relativePathValue.startsWith("/") || relativePathValue.includes("\\") ||
      relativePathValue.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new PersistenceInputError("Artifact relativePath must be a bounded, non-traversing relative path.");
  }
  const typeValue = value["type"];
  if (typeValue !== "csv-analysis-json" && typeValue !== "csv-analysis-csv" && typeValue !== "csv-analysis-markdown" && typeValue !== "document-plain-text") {
    throw new PersistenceInputError("Artifact type is unsupported.");
  }
  const sha256 = parseHash(value["sha256"], "Artifact SHA-256");
  const bytes = value["bytes"];
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 64 * 1024) {
    throw new PersistenceInputError("Artifact byte count is outside supported limits.");
  }
  const createdAtValue = value["createdAt"];
  if (!(createdAtValue instanceof Date) || !Number.isFinite(createdAtValue.getTime())) {
    throw new PersistenceInputError("Artifact timestamp is invalid.");
  }
  return { artifactId, runId, relativePath: relativePathValue, type: typeValue, sha256, bytes, createdAt: createdAtValue };
}

function parseScheduleOccurrence(value: unknown, scheduleId?: string): ScheduleOccurrence {
  if (!isRecord(value)) throw new DatabasePersistenceError();
  const scheduledFor = value["scheduledFor"];
  const recordedAt = value["recordedAt"];
  const status = value["status"];
  const missedCount = value["missedCount"];
  const runIdValue = value["runId"];
  if (
    !(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime()) ||
    !(recordedAt instanceof Date) || Number.isNaN(recordedAt.getTime()) ||
    (status !== "awaiting_approval" && status !== "missed" && status !== "completed" && status !== "failed") ||
    typeof missedCount !== "number" || !Number.isSafeInteger(missedCount) || missedCount < 0 || missedCount > 100_000 ||
    (runIdValue !== undefined && (typeof runIdValue !== "string" || runIdValue.length > 128))
  ) throw new DatabasePersistenceError();
  const runId = typeof runIdValue === "string"
    ? runIdValue
    : scheduleId === undefined ? "legacy-occurrence" : scheduleOccurrenceRunId(scheduleId, scheduledFor);
  return { runId, scheduledFor, recordedAt, status, missedCount };
}

function scheduleOccurrenceRunId(scheduleId: string, scheduledFor: Date): string {
  return `schedule-${createHash("sha256").update(`${scheduleId}:${scheduledFor.getTime()}`).digest("hex")}`;
}

function parseStoredSchedule(value: unknown): ScheduleRecord {
  if (!isRecord(value)) throw new DatabasePersistenceError();
  const definition = parseScheduleDefinition({
    scheduleId: value["scheduleId"],
    workflowId: value["workflowId"],
    inputPath: value["inputPath"],
    nextRunAt: value["nextRunAt"],
    ...(value["intervalMinutes"] === undefined ? {} : { intervalMinutes: value["intervalMinutes"] }),
  });
  const status = value["status"];
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  const occurrencesValue = value["occurrences"];
  const pendingOccurrenceValue = value["pendingOccurrence"];
  const dispatchOwnerValue = value["dispatchOwner"];
  const dispatchStartedAtValue = value["dispatchStartedAt"];
  if (
    value["_id"] !== definition.scheduleId ||
    (status !== "active" && status !== "paused" && status !== "completed" && status !== "deleted") ||
    !(createdAt instanceof Date) || Number.isNaN(createdAt.getTime()) ||
    !(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime()) ||
    !Array.isArray(occurrencesValue) || occurrencesValue.length > MAX_SCHEDULE_OCCURRENCES ||
    (dispatchOwnerValue !== undefined && (typeof dispatchOwnerValue !== "string" || dispatchOwnerValue.length > 128)) ||
    (dispatchStartedAtValue !== undefined && (!(dispatchStartedAtValue instanceof Date) || Number.isNaN(dispatchStartedAtValue.getTime()))) ||
    (dispatchOwnerValue === undefined) !== (dispatchStartedAtValue === undefined)
  ) throw new DatabasePersistenceError();
  return {
    ...definition,
    status,
    createdAt,
    updatedAt,
    occurrences: occurrencesValue.map((occurrence) => parseScheduleOccurrence(occurrence, definition.scheduleId)),
    ...(pendingOccurrenceValue === undefined ? {} : { pendingOccurrence: parseScheduleOccurrence(pendingOccurrenceValue, definition.scheduleId) }),
    ...(typeof dispatchOwnerValue === "string" && dispatchStartedAtValue instanceof Date
      ? { dispatchOwner: dispatchOwnerValue, dispatchStartedAt: dispatchStartedAtValue }
      : {}),
  };
}

function parseStoredRunEvent(value: unknown): RunEvent {
  if (!isRecord(value)) {
    throw new DatabasePersistenceError();
  }
  const event = parseRunEventInput({
    runId: value["runId"],
    eventId: value["eventId"],
    type: value["type"],
    ...(value["stepId"] === undefined ? {} : { stepId: value["stepId"] }),
    ...(value["toolName"] === undefined ? {} : { toolName: value["toolName"] }),
  });
  const createdAt = value["createdAt"];
  const sequence = value["sequence"];
  if (
    value["_id"] !== `${event.runId}:${event.eventId}` ||
    typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1 ||
    !(createdAt instanceof Date) ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new DatabasePersistenceError();
  }
  return { ...event, sequence, createdAt };
}

function parseStoredRunCheckpoint(value: unknown): RunCheckpoint {
  if (!isRecord(value)) {
    throw new DatabasePersistenceError();
  }
  const checkpoint = parseRunCheckpointInput({
    runId: value["runId"],
    version: value["version"],
    inputHash: value["inputHash"],
    stateHash: value["stateHash"],
    completedStepIds: value["completedStepIds"],
    ...(value["pendingStepId"] === undefined ? {} : { pendingStepId: value["pendingStepId"] }),
  });
  const updatedAt = value["updatedAt"];
  if (value["_id"] !== checkpoint.runId || !(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
    throw new DatabasePersistenceError();
  }
  return { ...checkpoint, updatedAt };
}

export class StaleCheckpointError extends Error {
  constructor() {
    super("Run checkpoint is stale because its inputs or state have changed.");
    this.name = "StaleCheckpointError";
  }
}

function parseStoredRunSummary(value: unknown): RunSummary {
  if (!isRecord(value)) {
    throw new DatabasePersistenceError();
  }

  const runId = value["runId"];
  const workflowId = value["workflowId"];
  const summary = value["summary"];
  const state = value["state"];
  const createdAt = value["createdAt"];
  const id = value["_id"];
  if (
    typeof runId !== "string" ||
    typeof id !== "string" ||
    id !== runId ||
    typeof workflowId !== "string" ||
    workflowId.trim().length === 0 ||
    typeof summary !== "string" ||
    !isRunState(state) ||
    !(createdAt instanceof Date) ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new DatabasePersistenceError();
  }

  return {
    runId,
    workflowId,
    summary,
    state,
    createdAt,
  };
}

export class MongoStore {
  private readonly client: MongoClient;
  private readonly runs: Collection<StoredRunSummary>;
  private readonly events: Collection<StoredRunEvent>;
  private readonly checkpoints: Collection<StoredRunCheckpoint>;
  private readonly schedules: Collection<StoredSchedule>;
  private readonly folderApprovals: Collection<StoredFolderApproval>;
  private readonly artifacts: Collection<StoredArtifactReference>;

  private constructor(client: MongoClient) {
    this.client = client;
    const database = client.db();
    this.runs = database.collection<StoredRunSummary>("runs");
    this.events = database.collection<StoredRunEvent>("run_events");
    this.checkpoints = database.collection<StoredRunCheckpoint>("run_checkpoints");
    this.schedules = database.collection<StoredSchedule>("schedules");
    this.folderApprovals = database.collection<StoredFolderApproval>("folder_approvals");
    this.artifacts = database.collection<StoredArtifactReference>("artifacts");
  }

  static async connect(configuration: unknown): Promise<MongoStore> {
    if (!isRecord(configuration)) {
      throw new PersistenceInputError("MongoDB connection configuration is invalid.");
    }
    const validatedConfiguration = parseConfiguration({
      mongodbUri: configuration["mongodbUri"],
    });
    let client: MongoClient | undefined;

    try {
      client = new MongoClient(validatedConfiguration.mongodbUri, {
        serverSelectionTimeoutMS: 3000,
      });
      await client.connect();
      await client.db().command({ ping: 1 });
      return new MongoStore(client);
    } catch {
      if (client !== undefined) {
        try {
          await client.close();
        } catch {
          // Keep the public error independent of driver details and connection data.
        }
      }
      throw new DatabaseConnectionError();
    }
  }

  async saveRunSummary(value: unknown): Promise<RunSummary> {
    const input = parseRunSummaryInput(value);
    const document: StoredRunSummary = {
      _id: input.runId,
      ...input,
      state: "created",
      createdAt: new Date(),
      eventCount: 0,
      eventBytes: 0,
    };

    try {
      await this.runs.insertOne(document);
    } catch {
      throw new DatabasePersistenceError();
    }

    return parseStoredRunSummary(document);
  }

  private async ensureScheduledRun(schedule: ScheduleRecord, occurrence: ScheduleOccurrence): Promise<void> {
    let run = await this.getRunSummary(occurrence.runId);
    if (run === null) {
      try {
        run = await this.saveRunSummary({
          runId: occurrence.runId,
          workflowId: schedule.workflowId,
          summary: "Scheduled run is awaiting fresh user approval; no input has been read.",
        });
      } catch {
        // Another scheduler may have repaired the same deterministic occurrence concurrently.
        run = await this.getRunSummary(occurrence.runId);
        if (run === null) throw new DatabasePersistenceError();
      }
    }
    if (run.workflowId !== schedule.workflowId) throw new DatabasePersistenceError();
    if (run.state === "created") await this.updateRunState(run.runId, "awaiting_approval");
  }

  async updateRunSummary(runIdValue: unknown, summaryValue: unknown): Promise<RunSummary> {
    const runId = parseIdentifier(runIdValue, "Run id");
    if (typeof summaryValue !== "string") {
      throw new PersistenceInputError("Run summary requires a string summary.");
    }
    const summary = redactSensitiveText(summaryValue.slice(0, MAX_RUN_SUMMARY_CHARACTERS))
      .slice(0, MAX_RUN_SUMMARY_CHARACTERS);
    try {
      const result = await this.runs.updateOne({ _id: runId }, { $set: { summary } });
      if (result.matchedCount !== 1) {
        throw new PersistenceInputError("Run does not exist.");
      }
      const updated = await this.runs.findOne({ _id: runId });
      if (updated === null) {
        throw new PersistenceInputError("Run does not exist.");
      }
      return parseStoredRunSummary(updated);
    } catch (error) {
      if (error instanceof PersistenceInputError) {
        throw error;
      }
      throw new DatabasePersistenceError();
    }
  }

  async listRunSummaries(): Promise<readonly RunSummary[]> {
    try {
      const documents = await this.runs.find({}).sort({ createdAt: -1 }).limit(50).toArray();
      return documents.map((document) => parseStoredRunSummary(document));
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async saveArtifactReference(value: unknown): Promise<ArtifactReference> {
    if (!isRecord(value) || Object.keys(value).some((key) => !["artifactId", "runId", "relativePath", "type", "sha256", "bytes"].includes(key))) {
      throw new PersistenceInputError("Artifact reference contains unsupported fields.");
    }
    const now = new Date();
    const parsed = parseArtifactReference({ ...value, createdAt: now });
    try {
      const run = await this.runs.findOne({ _id: parsed.runId });
      const expectedWorkflow = parsed.type === "document-plain-text" ? "document-analyze" : "csv-analyze";
      if (run === null || run.workflowId !== expectedWorkflow || run.state !== "completed") {
        throw new PersistenceInputError("Artifact references require a matching completed workflow run.");
      }
      const document: StoredArtifactReference = { _id: parsed.artifactId, ...parsed };
      await this.artifacts.insertOne(document);
      return parsed;
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async listArtifactReferences(runIdValue: unknown): Promise<readonly ArtifactReference[]> {
    const runId = parseIdentifier(runIdValue, "Artifact runId");
    try {
      const documents = await this.artifacts.find({ runId }).sort({ createdAt: 1 }).limit(50).toArray();
      return documents.map(parseArtifactReference);
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async updateRunState(runIdValue: unknown, nextStateValue: unknown): Promise<RunSummary> {
    const runId = parseIdentifier(runIdValue, "Run id");
    if (!isRunState(nextStateValue)) {
      throw new PersistenceInputError("Run state is unsupported.");
    }
    let current: StoredRunSummary | null;
    try {
      current = await this.runs.findOne({ _id: runId });
    } catch {
      throw new DatabasePersistenceError();
    }
    if (current === null) {
      throw new PersistenceInputError("Run does not exist.");
    }
    const parsedCurrent = parseStoredRunSummary(current);
    if (!ALLOWED_RUN_TRANSITIONS[parsedCurrent.state].has(nextStateValue)) {
      throw new PersistenceInputError("Run state transition is not allowed.");
    }
    try {
      const result = await this.runs.updateOne(
        { _id: runId, state: parsedCurrent.state },
        { $set: { state: nextStateValue, updatedAt: new Date() } },
      );
      if (result.matchedCount !== 1) {
        throw new PersistenceInputError("Run state changed concurrently; reload it before continuing.");
      }
    } catch (error) {
      if (error instanceof PersistenceInputError) {
        throw error;
      }
      throw new DatabasePersistenceError();
    }
    return { ...parsedCurrent, state: nextStateValue };
  }

  async recoverStaleRun(runIdValue: unknown, staleBeforeValue: unknown): Promise<boolean> {
    const runId = parseIdentifier(runIdValue, "Run id");
    if (!(staleBeforeValue instanceof Date) || Number.isNaN(staleBeforeValue.getTime())) {
      throw new PersistenceInputError("A valid stale-run cutoff is required.");
    }
    try {
      const result = await this.runs.updateOne(
        { _id: runId, state: "running", updatedAt: { $lte: staleBeforeValue } },
        { $set: { state: "uncertain", updatedAt: new Date() } },
      );
      return result.modifiedCount === 1;
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async appendRunEvent(value: unknown): Promise<RunEvent> {
    const input = parseRunEventInput(value);
    const eventId = `${input.runId}:${input.eventId}`;
    const baseEvent = { ...input, createdAt: new Date() };
    const eventBytes = Buffer.byteLength(JSON.stringify({ _id: eventId, ...baseEvent, sequence: MAX_EVENTS_PER_RUN }));
    if (eventBytes > MAX_EVENT_BYTES) {
      throw new PersistenceInputError("Run event exceeds the supported size limit.");
    }

    try {
      const existing = await this.events.findOne({ _id: eventId });
      if (existing !== null) {
        const parsedExisting = parseStoredRunEvent(existing);
        if (
          parsedExisting.type !== input.type ||
          parsedExisting.stepId !== input.stepId ||
          parsedExisting.toolName !== input.toolName
        ) {
          throw new PersistenceInputError("Run event id was already used for different event data.");
        }
        return parsedExisting;
      }
      const reservation = await this.runs.findOneAndUpdate(
        {
          _id: input.runId,
          $expr: {
            $and: [
              { $lt: [{ $ifNull: ["$eventCount", 0] }, MAX_EVENTS_PER_RUN] },
              {
                $lte: [
                  { $add: [{ $ifNull: ["$eventBytes", 0] }, eventBytes] },
                  MAX_EVENT_BYTES_PER_RUN,
                ],
              },
            ],
          },
        },
        { $inc: { eventCount: 1, eventBytes } },
        { returnDocument: "after" },
      );
      if (reservation === null || typeof reservation["eventCount"] !== "number") {
        throw new PersistenceInputError("Run event budget is exhausted or the run does not exist.");
      }
      const sequence = reservation["eventCount"];
      const storedEvent: StoredRunEvent = {
        _id: eventId,
        ...input,
        sequence,
        createdAt: baseEvent.createdAt,
      };
      await this.events.insertOne(storedEvent);
      return parseStoredRunEvent(storedEvent);
    } catch (error) {
      if (error instanceof PersistenceInputError) {
        throw error;
      }
      throw new DatabasePersistenceError();
    }
  }

  async getRunEvents(runIdValue: unknown): Promise<readonly RunEvent[]> {
    const runId = parseIdentifier(runIdValue, "Run id");
    try {
      const documents = await this.events
        .find({ runId })
        .sort({ sequence: 1 })
        .limit(MAX_EVENTS_PER_RUN)
        .toArray();
      return documents.map((document) => parseStoredRunEvent(document));
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async saveRunCheckpoint(value: unknown): Promise<RunCheckpoint> {
    const input = parseRunCheckpointInput(value);
    let run: StoredRunSummary | null;
    try {
      run = await this.runs.findOne({ _id: input.runId });
    } catch {
      throw new DatabasePersistenceError();
    }
    if (run === null || !isRunState(run.state) || TERMINAL_STATES.has(run.state)) {
      throw new PersistenceInputError("A checkpoint can only be saved for an active run.");
    }
    const checkpoint: RunCheckpoint = { ...input, updatedAt: new Date() };
    const document: StoredRunCheckpoint = {
      _id: input.runId,
      ...input,
      completedStepIds: [...input.completedStepIds],
      updatedAt: checkpoint.updatedAt,
    };
    try {
      await this.checkpoints.replaceOne({ _id: input.runId }, document, { upsert: true });
      return parseStoredRunCheckpoint(document);
    } catch (error) {
      if (error instanceof PersistenceInputError) {
        throw error;
      }
      throw new DatabasePersistenceError();
    }
  }

  async loadRunCheckpoint(
    runIdValue: unknown,
    inputHashValue: unknown,
    stateHashValue: unknown,
  ): Promise<RunCheckpoint | null> {
    const runId = parseIdentifier(runIdValue, "Run id");
    const inputHash = parseHash(inputHashValue, "Current inputHash");
    const stateHash = parseHash(stateHashValue, "Current stateHash");
    let run: StoredRunSummary | null;
    let document: StoredRunCheckpoint | null;
    try {
      [run, document] = await Promise.all([
        this.runs.findOne({ _id: runId }),
        this.checkpoints.findOne({ _id: runId }),
      ]);
    } catch {
      throw new DatabasePersistenceError();
    }
    if (run === null || document === null) {
      return null;
    }
    if (!isRunState(run.state) || TERMINAL_STATES.has(run.state)) {
      throw new StaleCheckpointError();
    }
    const checkpoint = parseStoredRunCheckpoint(document);
    if (checkpoint.inputHash !== inputHash || checkpoint.stateHash !== stateHash) {
      throw new StaleCheckpointError();
    }
    return checkpoint;
  }

  async getRunSummary(runId: unknown): Promise<RunSummary | null> {
    if (typeof runId !== "string" || runId.trim().length === 0) {
      throw new PersistenceInputError("A non-empty runId is required.");
    }

    try {
      const document = await this.runs.findOne({ _id: runId });
      return document === null ? null : parseStoredRunSummary(document);
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async createSchedule(value: unknown): Promise<ScheduleRecord> {
    const definition = parseScheduleDefinition(value);
    let count: number;
    try {
      count = await this.schedules.countDocuments({ status: { $ne: "deleted" } }, { limit: MAX_SCHEDULES });
    } catch {
      throw new DatabasePersistenceError();
    }
    if (count >= MAX_SCHEDULES) throw new PersistenceInputError("The active schedule limit has been reached.");
    const now = new Date();
    const document: StoredSchedule = {
      _id: definition.scheduleId,
      ...definition,
      status: "active",
      createdAt: now,
      updatedAt: now,
      occurrences: [],
    };
    try {
      await this.schedules.insertOne(document);
      return parseStoredSchedule(document);
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async listSchedules(includeDeleted = false): Promise<readonly ScheduleRecord[]> {
    try {
      const documents = await this.schedules
        .find(includeDeleted ? {} : { status: { $ne: "deleted" } })
        .sort({ createdAt: -1 })
        .limit(MAX_SCHEDULES)
        .toArray();
      return documents.map(parseStoredSchedule);
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async grantFolderApproval(pathValue: unknown, accessValue: unknown): Promise<FolderApproval> {
    const path = parseApprovedFolderPath(pathValue);
    const access = parseFolderApprovalAccess(accessValue);
    const id = folderApprovalId(path, access);
    const now = new Date();
    try {
      const result = await this.folderApprovals.findOneAndUpdate(
        { _id: id },
        { $set: { path, access, status: "active", updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true, returnDocument: "after" },
      );
      if (result === null) throw new DatabasePersistenceError();
      return parseStoredFolderApproval(result);
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError || error instanceof DatabasePersistenceError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async listFolderApprovals(includeRevoked = false): Promise<readonly FolderApproval[]> {
    try {
      const documents = await this.folderApprovals
        .find(includeRevoked ? {} : { status: "active" })
        .sort({ path: 1, access: 1 })
        .toArray();
      return documents.map(parseStoredFolderApproval);
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async hasFolderApproval(pathValue: unknown, accessValue: unknown): Promise<boolean> {
    const path = parseApprovedFolderPath(pathValue);
    const access = parseFolderApprovalAccess(accessValue);
    try {
      const documents = await this.folderApprovals.find({ status: "active", access }).toArray();
      return documents.map(parseStoredFolderApproval).some((approval) => containsFolder(approval.path, path));
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async revokeFolderApproval(pathValue: unknown, accessValue: unknown): Promise<boolean> {
    const path = parseApprovedFolderPath(pathValue);
    const access = parseFolderApprovalAccess(accessValue);
    const id = folderApprovalId(path, access);
    try {
      const result = await this.folderApprovals.updateOne(
        { _id: id, status: "active" },
        { $set: { status: "revoked", updatedAt: new Date() } },
      );
      return result.modifiedCount === 1;
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async setScheduleStatus(scheduleIdValue: unknown, nextStatusValue: unknown): Promise<ScheduleRecord> {
    const scheduleId = parseIdentifier(scheduleIdValue, "Schedule id");
    if (nextStatusValue !== "active" && nextStatusValue !== "paused" && nextStatusValue !== "deleted") {
      throw new PersistenceInputError("Schedule status change is unsupported.");
    }
    try {
      const current = await this.schedules.findOne({ _id: scheduleId });
      if (current === null) throw new PersistenceInputError("Schedule does not exist.");
      const schedule = parseStoredSchedule(current);
      if (schedule.dispatchOwner !== undefined) {
        throw new PersistenceInputError("Schedule has an occurrence claimed by a running scheduler; wait for it to finish before changing its status.");
      }
      const allowed = nextStatusValue === "deleted"
        ? schedule.status !== "deleted"
        : nextStatusValue === "paused"
          ? schedule.status === "active" || (schedule.status === "completed" && schedule.pendingOccurrence !== undefined)
          : schedule.status === "paused";
      if (!allowed) throw new PersistenceInputError("Schedule status transition is not allowed.");
      const updated = await this.schedules.findOneAndUpdate(
        { _id: scheduleId, status: schedule.status, dispatchOwner: { $exists: false } },
        { $set: { status: nextStatusValue, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (updated === null) throw new PersistenceInputError("Schedule changed concurrently; reload it first.");
      return parseStoredSchedule(updated);
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async claimDueSchedules(nowValue: unknown, graceMsValue: unknown): Promise<readonly {
    readonly schedule: ScheduleRecord;
    readonly occurrence: ScheduleOccurrence;
  }[]> {
    if (!(nowValue instanceof Date) || Number.isNaN(nowValue.getTime())) {
      throw new PersistenceInputError("A valid scheduler time is required.");
    }
    if (typeof graceMsValue !== "number" || !Number.isSafeInteger(graceMsValue) || graceMsValue < 1_000 || graceMsValue > 60_000) {
      throw new PersistenceInputError("Scheduler grace period must be from 1 to 60 seconds.");
    }
    let due: StoredSchedule[];
    try {
      due = await this.schedules.find({ status: "active", nextRunAt: { $lte: nowValue } })
        .sort({ nextRunAt: 1 }).limit(MAX_SCHEDULES).toArray();
    } catch {
      throw new DatabasePersistenceError();
    }
    const claims: Array<{ readonly schedule: ScheduleRecord; readonly occurrence: ScheduleOccurrence }> = [];
    for (const stored of due) {
      const current = parseStoredSchedule(stored);
      const scheduledFor = current.nextRunAt;
      const intervalMs = current.intervalMinutes === undefined ? undefined : current.intervalMinutes * 60_000;
      const lateByMs = nowValue.getTime() - scheduledFor.getTime();
      const alreadyPending = current.pendingOccurrence !== undefined;
      const dueSlots = intervalMs === undefined ? 1 : Math.floor(lateByMs / intervalMs) + 1;
      const missedCount = alreadyPending || lateByMs > graceMsValue ? dueSlots : 0;
      const outcome: ScheduleOccurrenceStatus = missedCount > 0 ? "missed" : "awaiting_approval";
      const nextRunAt = intervalMs === undefined
        ? scheduledFor
        : new Date(scheduledFor.getTime() + Math.max(1, missedCount) * intervalMs);
      const status: ScheduleStatus = intervalMs === undefined ? "completed" : "active";
      const occurrence: ScheduleOccurrence = {
        runId: scheduleOccurrenceRunId(current.scheduleId, scheduledFor),
        scheduledFor, status: outcome, missedCount, recordedAt: nowValue,
      };
      try {
        const update: Document = {
          $set: {
            status,
            nextRunAt,
            updatedAt: nowValue,
            ...(outcome === "awaiting_approval" ? { pendingOccurrence: occurrence } : {}),
          },
          $push: { occurrences: { $each: [occurrence], $slice: -MAX_SCHEDULE_OCCURRENCES } },
        };
        const updated = await this.schedules.findOneAndUpdate(
          { _id: current.scheduleId, status: "active", nextRunAt: scheduledFor },
          update,
          { returnDocument: "after" },
        );
        if (updated !== null) {
          const savedSchedule = parseStoredSchedule(updated);
          if (outcome === "awaiting_approval") await this.ensureScheduledRun(savedSchedule, occurrence);
          claims.push({ schedule: savedSchedule, occurrence });
        }
      } catch {
        throw new DatabasePersistenceError();
      }
    }
    return claims;
  }

  async listPendingScheduleOccurrences(): Promise<readonly {
    readonly schedule: ScheduleRecord;
    readonly occurrence: ScheduleOccurrence;
  }[]> {
    const schedules = await this.listSchedules();
    return schedules.flatMap((schedule) => schedule.status === "paused" || schedule.status === "deleted" || schedule.pendingOccurrence === undefined
      ? []
      : [{ schedule, occurrence: schedule.pendingOccurrence }]);
  }

  async claimPendingScheduleOccurrences(ownerIdValue: unknown): Promise<readonly {
    readonly schedule: ScheduleRecord;
    readonly occurrence: ScheduleOccurrence;
  }[]> {
    const ownerId = parseIdentifier(ownerIdValue, "Scheduler owner id");
    const candidates = await this.listPendingScheduleOccurrences();
    const claimed: Array<{ readonly schedule: ScheduleRecord; readonly occurrence: ScheduleOccurrence }> = [];
    for (const candidate of candidates) {
      if (candidate.schedule.dispatchOwner !== undefined) continue;
      try {
        await this.ensureScheduledRun(candidate.schedule, candidate.occurrence);
        const updated = await this.schedules.findOneAndUpdate(
          {
            _id: candidate.schedule.scheduleId,
            status: { $in: ["active", "completed"] },
            dispatchOwner: { $exists: false },
            "pendingOccurrence.scheduledFor": candidate.occurrence.scheduledFor,
            "pendingOccurrence.status": "awaiting_approval",
          },
          { $set: { dispatchOwner: ownerId, dispatchStartedAt: new Date(), updatedAt: new Date() } },
          { returnDocument: "after" },
        );
        if (updated !== null) claimed.push({ schedule: parseStoredSchedule(updated), occurrence: candidate.occurrence });
      } catch {
        throw new DatabasePersistenceError();
      }
    }
    return claimed;
  }

  async releaseScheduleOccurrenceClaim(scheduleIdValue: unknown, scheduledForValue: unknown, ownerIdValue: unknown): Promise<void> {
    const scheduleId = parseIdentifier(scheduleIdValue, "Schedule id");
    const ownerId = parseIdentifier(ownerIdValue, "Scheduler owner id");
    if (!(scheduledForValue instanceof Date) || Number.isNaN(scheduledForValue.getTime())) {
      throw new PersistenceInputError("A valid scheduled occurrence time is required.");
    }
    try {
      const result = await this.schedules.updateOne(
        { _id: scheduleId, dispatchOwner: ownerId, "pendingOccurrence.scheduledFor": scheduledForValue, "pendingOccurrence.status": "awaiting_approval" },
        { $unset: { dispatchOwner: "", dispatchStartedAt: "" }, $set: { updatedAt: new Date() } },
      );
      if (result.modifiedCount !== 1) throw new PersistenceInputError("Schedule occurrence claim was not found.");
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async recoverScheduleOccurrenceClaim(scheduleIdValue: unknown, scheduledForValue: unknown): Promise<boolean> {
    const scheduleId = parseIdentifier(scheduleIdValue, "Schedule id");
    if (!(scheduledForValue instanceof Date) || Number.isNaN(scheduledForValue.getTime())) {
      throw new PersistenceInputError("A valid scheduled occurrence time is required.");
    }
    try {
      const result = await this.schedules.updateOne(
        {
          _id: scheduleId,
          dispatchOwner: { $exists: true },
          "pendingOccurrence.scheduledFor": scheduledForValue,
          "pendingOccurrence.status": "awaiting_approval",
        },
        { $unset: { dispatchOwner: "", dispatchStartedAt: "" }, $set: { updatedAt: new Date() } },
      );
      return result.modifiedCount === 1;
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async finishScheduleOccurrence(
    scheduleIdValue: unknown,
    scheduledForValue: unknown,
    outcomeValue: unknown,
    ownerIdValue?: unknown,
  ): Promise<void> {
    const scheduleId = parseIdentifier(scheduleIdValue, "Schedule id");
    if (!(scheduledForValue instanceof Date) || Number.isNaN(scheduledForValue.getTime())) {
      throw new PersistenceInputError("A valid scheduled occurrence time is required.");
    }
    if (outcomeValue !== "completed" && outcomeValue !== "failed") {
      throw new PersistenceInputError("Schedule occurrence outcome is unsupported.");
    }
    const ownerId = ownerIdValue === undefined ? undefined : parseIdentifier(ownerIdValue, "Scheduler owner id");
    try {
      const current = await this.schedules.findOne({ _id: scheduleId });
      if (current === null) throw new PersistenceInputError("Schedule does not exist.");
      const schedule = parseStoredSchedule(current);
      if (schedule.pendingOccurrence?.scheduledFor.getTime() !== scheduledForValue.getTime()) {
        throw new PersistenceInputError("Pending schedule occurrence was not found.");
      }
      const updatedAt = new Date();
      const setValues: Document = {
        "occurrences.$[entry].status": outcomeValue,
        "occurrences.$[entry].recordedAt": updatedAt,
        updatedAt,
        ...(schedule.intervalMinutes === undefined ? { status: "completed" } : {}),
      };
      const result = await this.schedules.updateOne(
        { _id: scheduleId, status: { $in: ["active", "completed"] }, ...(ownerId === undefined ? {} : { dispatchOwner: ownerId }), "pendingOccurrence.scheduledFor": scheduledForValue, "pendingOccurrence.status": "awaiting_approval" },
        { $set: setValues, $unset: { pendingOccurrence: "", dispatchOwner: "", dispatchStartedAt: "" } },
        { arrayFilters: [{ "entry.scheduledFor": scheduledForValue, "entry.status": "awaiting_approval" }] },
      );
      if (result.modifiedCount !== 1) throw new PersistenceInputError("Pending schedule occurrence was not found.");
    } catch (error: unknown) {
      if (error instanceof PersistenceInputError) throw error;
      throw new DatabasePersistenceError();
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      throw new DatabaseShutdownError();
    }
  }
}
