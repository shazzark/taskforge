import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import type { ArtifactReference, FolderApproval, RunCheckpoint, RunEvent, RunState, RunSummary, ScheduleOccurrence, ScheduleRecord } from "./types.js";
import { DatabasePersistenceError, DatabaseShutdownError, PersistenceInputError, StaleCheckpointError } from "./types.js";
import type { TaskForgeStore } from "./store.js";

const MAX_EVENTS = 300, MAX_EVENT_BYTES = 2 * 1024, MAX_RUN_EVENT_BYTES = 5 * 1024 * 1024;
const MAX_CHECKPOINT_STEPS = 256, MAX_CHECKPOINT_BYTES = 64 * 1024, MAX_SUMMARY = 4_000;
const MAX_SCHEDULES = 500, MAX_OCCURRENCES = 100;
const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_TABLES = ["runs", "events", "checkpoints", "schedules", "approvals", "artifacts"] as const;
const STATES: readonly RunState[] = ["created", "awaiting_approval", "running", "completed", "failed", "cancelled", "uncertain"];
const TRANSITIONS: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  created: new Set(["awaiting_approval", "running", "failed", "cancelled", "uncertain"]),
  awaiting_approval: new Set(["running", "failed", "cancelled"]),
  running: new Set(["completed", "failed", "cancelled", "uncertain"]),
  completed: new Set(), failed: new Set(), cancelled: new Set(), uncertain: new Set(["running", "failed", "cancelled"]),
};
const TERMINAL = new Set<RunState>(["completed", "failed", "cancelled"]);
const EVENT_TYPES = new Set(["run_started", "step_started", "step_finished", "tool_intent", "tool_finished", "approval_required", "run_paused", "run_resumed", "run_finished", "run_failed", "run_cancelled"]);
const ARTIFACT_TYPES = new Set(["csv-analysis-json", "csv-analysis-csv", "csv-analysis-markdown", "document-plain-text", "document-analysis-json", "document-analysis-csv", "document-analysis-markdown"]);

type Row = { readonly value: string };
type JsonRecord = Record<string, unknown>;
const record = (v: unknown): v is JsonRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const now = (): Date => new Date();
function failInput(message: string): never { throw new PersistenceInputError(message); }
function failDb(): never { throw new DatabasePersistenceError(); }
function id(v: unknown, label = "Identifier"): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v) || /(?:password|secret|token|api[_-]?key|gsk_|gh[pousr]_|github_pat_|sk-)/iu.test(v)) return failInput(`${label} must be a bounded identifier.`);
  return v;
}
function date(v: unknown, label: string): Date {
  if (!(v instanceof Date) || !Number.isFinite(v.getTime())) return failInput(`${label} must be a valid date.`);
  return v;
}
function redacted(v: string): string {
  return v.replace(/\b(?:mongodb(?:\+srv)?|https?):\/\/[^/\s:@]+:[^@\s/]+@[^\s]+/giu, "[REDACTED_CONNECTION]")
    .replace(/\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;.]+/giu, m => `${m.slice(0, m.search(/[:=]/u) + 1)}[REDACTED]`)
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\b(?:gsk_[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/giu, "[REDACTED]");
}
function json(v: unknown): string {
  const encode = (value: unknown): unknown => {
    if (value instanceof Date) return { $date: value.toISOString() };
    if (Array.isArray(value)) return value.map(encode);
    if (!record(value)) return value;
    const result: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) result[key] = encode(item);
    return result;
  };
  return JSON.stringify(encode(v));
}
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (!record(v)) return v;
  if (Object.keys(v).length === 1 && typeof v["$date"] === "string") {
    const parsed = new Date(v["$date"]);
    if (!Number.isFinite(parsed.getTime())) failDb();
    return parsed;
  }
  const result: JsonRecord = {};
  for (const [k, val] of Object.entries(v)) result[k] = revive(val);
  return result;
}
function validHash(v: unknown, label: string): string {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/u.test(v)) return failInput(`${label} must be a SHA-256 hex digest.`);
  return v;
}
function read<T>(db: DatabaseSync, table: string, key: string): T | null {
  try {
    const row = db.prepare(`SELECT value FROM ${table} WHERE id = ?`).get(key) as Row | undefined;
    if (!row) return null;
    return revive(JSON.parse(row.value)) as T;
  } catch {
    return failDb();
  }
}
function all<T>(db: DatabaseSync, table: string): T[] {
  try {
    const rows = db.prepare(`SELECT value FROM ${table}`).all() as Row[];
    return rows.map(row => revive(JSON.parse(row.value)) as T);
  } catch {
    return failDb();
  }
}
function put(db: DatabaseSync, table: string, key: string, value: unknown): void {
  db.prepare(`INSERT INTO ${table}(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`).run(key, json(value));
}
function validatedRun(v: unknown): RunSummary {
  if (!record(v)) return failDb();
  const runId = id(v["runId"]), workflowId = id(v["workflowId"]), summary = v["summary"], state = v["state"];
  if (v["_id"] !== runId || typeof summary !== "string" || !STATES.includes(state as RunState)) return failDb();
  const createdAt = date(v["createdAt"], "createdAt");
  const updatedAt = v["updatedAt"] === undefined ? undefined : date(v["updatedAt"], "updatedAt");
  return { runId, workflowId, summary, state: state as RunState, createdAt, ...(updatedAt ? { updatedAt } : {}) };
}
function checkSummaryInput(v: unknown): { runId: string; workflowId: string; summary: string } {
  if (!record(v) || Object.keys(v).some(k => !["runId", "workflowId", "summary"].includes(k)) || typeof v["summary"] !== "string") return failInput("Run summary input is invalid.");
  return { runId: id(v["runId"], "Run id"), workflowId: id(v["workflowId"], "Workflow id"), summary: redacted((v["summary"] as string).slice(0, MAX_SUMMARY)).slice(0, MAX_SUMMARY) };
}
function parseEvent(v: unknown): Omit<RunEvent, "sequence" | "createdAt"> {
  if (!record(v) || Object.keys(v).some(k => !["runId", "eventId", "type", "stepId", "toolName"].includes(k))) return failInput("Run event is invalid.");
  const type = v["type"];
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) return failInput("Run event type is unsupported.");
  const base = { runId: id(v["runId"], "Run id"), eventId: id(v["eventId"], "Event id"), type: type as RunEvent["type"] };
  return { ...base, ...(v["stepId"] === undefined ? {} : { stepId: id(v["stepId"], "Step id") }), ...(v["toolName"] === undefined ? {} : { toolName: id(v["toolName"], "Tool name") }) };
}
function validateEvent(v: unknown): RunEvent {
  if (!record(v)) return failDb();
  const event = parseEvent({ runId: v["runId"], eventId: v["eventId"], type: v["type"], ...(v["stepId"] === undefined ? {} : { stepId: v["stepId"] }), ...(v["toolName"] === undefined ? {} : { toolName: v["toolName"] }) });
  if (v["_id"] !== `${event.runId}:${event.eventId}` || !Number.isSafeInteger(v["sequence"]) || (v["sequence"] as number) < 1) return failDb();
  return { ...event, sequence: v["sequence"] as number, createdAt: date(v["createdAt"], "event timestamp") };
}
function folderPath(v: unknown): string {
  if (typeof v !== "string" || v.length < 1 || v.length > 2048 || !isAbsolute(v) || /[\u0000-\u001f\u007f]/u.test(v)) return failInput("Folder path must be an absolute path without control characters.");
  return v;
}
function contains(root: string, candidate: string): boolean {
  const r = resolve(root), c = resolve(candidate), sr = platform() === "win32" ? r.toLowerCase() : r, sc = platform() === "win32" ? c.toLowerCase() : c;
  const rel = relative(sr, sc);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function parseDefinition(v: unknown): Omit<ScheduleRecord, "status" | "createdAt" | "updatedAt" | "occurrences" | "pendingOccurrence" | "dispatchOwner" | "dispatchStartedAt"> {
  if (!record(v) || Object.keys(v).some(k => !["scheduleId", "workflowId", "inputPath", "nextRunAt", "intervalMinutes"].includes(k))) return failInput("Schedule definition is invalid.");
  const workflowId = v["workflowId"], inputPath = v["inputPath"], interval = v["intervalMinutes"];
  if (workflowId !== "csv-analyze" && workflowId !== "document-analyze") return failInput("Scheduled workflow is unsupported.");
  if (typeof inputPath !== "string" || inputPath.length < 1 || inputPath.length > 2048 || !isAbsolute(inputPath) || /[\u0000-\u001f\u007f]/u.test(inputPath)) return failInput("Schedule path must be absolute and bounded.");
  const ext = extname(inputPath).toLowerCase();
  if (workflowId === "csv-analyze" ? ext !== ".csv" : ![".txt", ".md", ".markdown", ".pdf", ".docx", ".xlsx"].includes(ext)) return failInput("Schedule path extension does not match workflow.");
  if (interval !== undefined && (typeof interval !== "number" || !Number.isSafeInteger(interval) || interval < 1 || interval > 10080)) return failInput("Schedule interval is invalid.");
  return { scheduleId: id(v["scheduleId"], "Schedule id"), workflowId, inputPath, nextRunAt: date(v["nextRunAt"], "Next run"), ...(interval === undefined ? {} : { intervalMinutes: interval }) };
}
function occurrenceId(scheduleId: string, scheduledFor: Date): string { return `schedule-${createHash("sha256").update(`${scheduleId}:${scheduledFor.getTime()}`).digest("hex")}`; }
function checkOccurrence(v: unknown, scheduleId: string): ScheduleOccurrence {
  if (!record(v) || !["awaiting_approval", "missed", "completed", "failed"].includes(String(v["status"])) || !Number.isSafeInteger(v["missedCount"]) || (v["missedCount"] as number) < 0 || (v["missedCount"] as number) > 100000) return failDb();
  const scheduledFor = date(v["scheduledFor"], "scheduledFor"), recordedAt = date(v["recordedAt"], "recordedAt");
  return { runId: typeof v["runId"] === "string" ? id(v["runId"], "Occurrence run id") : occurrenceId(scheduleId, scheduledFor), scheduledFor, recordedAt, status: v["status"] as ScheduleOccurrence["status"], missedCount: v["missedCount"] as number };
}
function checkSchedule(v: unknown): ScheduleRecord {
  if (!record(v)) return failDb();
  const def = parseDefinition({ scheduleId: v["scheduleId"], workflowId: v["workflowId"], inputPath: v["inputPath"], nextRunAt: v["nextRunAt"], ...(v["intervalMinutes"] === undefined ? {} : { intervalMinutes: v["intervalMinutes"] }) });
  const status = v["status"], occurrences = v["occurrences"];
  if (v["_id"] !== undefined && v["_id"] !== def.scheduleId || !["active", "paused", "completed", "deleted"].includes(String(status)) || !Array.isArray(occurrences) || occurrences.length > MAX_OCCURRENCES) return failDb();
  const createdAt = date(v["createdAt"], "createdAt"), updatedAt = date(v["updatedAt"], "updatedAt");
  const owner = v["dispatchOwner"], started = v["dispatchStartedAt"];
  if ((owner === undefined) !== (started === undefined) || (owner !== undefined && (typeof owner !== "string" || owner.length > 128))) return failDb();
  return { ...def, status: status as ScheduleRecord["status"], createdAt, updatedAt, occurrences: occurrences.map(o => checkOccurrence(o, def.scheduleId)), ...(v["pendingOccurrence"] === undefined ? {} : { pendingOccurrence: checkOccurrence(v["pendingOccurrence"], def.scheduleId) }), ...(owner === undefined ? {} : { dispatchOwner: owner as string, dispatchStartedAt: date(started, "dispatch start") }) };
}

/** SQLite-backed TaskForgeStore adapter. All mutations are synchronous and transactional. */
export class SqliteStore implements TaskForgeStore {
  private readonly db: DatabaseSync;
  private closed = false;
  private constructor(path: string) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(path);
      let versionRow = database.prepare("PRAGMA user_version").get();
      let version = versionRow?.["user_version"];
      if (typeof version !== "number") throw new Error();
      if (version === 0) {
        database.exec("BEGIN IMMEDIATE");
        try {
          versionRow = database.prepare("PRAGMA user_version").get();
          version = versionRow?.["user_version"];
          if (version === 0) {
            const existingTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
            if (existingTables.length > 0) throw new Error();
            database.exec("CREATE TABLE runs(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE events(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE checkpoints(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE schedules(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE approvals(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE artifacts(id TEXT PRIMARY KEY,value TEXT NOT NULL);");
            database.exec(`PRAGMA user_version=${SQLITE_SCHEMA_VERSION}`);
            version = SQLITE_SCHEMA_VERSION;
          }
          if (version !== SQLITE_SCHEMA_VERSION) throw new Error();
          database.exec("COMMIT");
        } catch (error: unknown) {
          try { database.exec("ROLLBACK"); } catch { /* preserve schema validation or initialization error */ }
          throw error;
        }
      }
      if (version !== SQLITE_SCHEMA_VERSION) throw new Error();
      const presentTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row["name"]));
      if (SQLITE_TABLES.some(table => !presentTables.has(table))) throw new Error();
      database.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      this.db = database;
    } catch {
      try { database?.close(); } catch { /* keep the normalized persistence error */ }
      throw new DatabasePersistenceError("Unable to open a compatible local TaskForge database.");
    }
  }
  static async connect(configuration: unknown): Promise<SqliteStore> {
    if (!record(configuration) || typeof configuration["path"] !== "string" || !isAbsolute(configuration["path"]) || /[\u0000-\u001f\u007f]/u.test(configuration["path"])) return failInput("SQLite database path must be absolute and contain no control characters.");
    return new SqliteStore(configuration["path"]);
  }
  private transaction<T>(action: () => T): T {
    if (this.closed) return failDb();
    try {
      this.db.exec("BEGIN IMMEDIATE");
    } catch {
      return failDb();
    }
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error: unknown) {
      try { this.db.exec("ROLLBACK"); } catch { /* keep the operation error */ }
      if (error instanceof PersistenceInputError || error instanceof DatabasePersistenceError || error instanceof StaleCheckpointError) throw error;
      return failDb();
    }
  }
  private ensureScheduledRun(schedule: ScheduleRecord, occurrence: ScheduleOccurrence): void {
    const raw = read<unknown>(this.db, "runs", occurrence.runId);
    if (raw === null) {
      put(this.db, "runs", occurrence.runId, {
        _id: occurrence.runId,
        runId: occurrence.runId,
        workflowId: schedule.workflowId,
        summary: "Scheduled run is awaiting fresh user approval; no input has been read.",
        state: "awaiting_approval",
        createdAt: now(),
        eventCount: 0,
        eventBytes: 0,
      });
      return;
    }
    const run = validatedRun(raw);
    if (run.workflowId !== schedule.workflowId) return failDb();
    if (run.state === "created") {
      put(this.db, "runs", occurrence.runId, { ...(raw as JsonRecord), state: "awaiting_approval", updatedAt: now() });
    }
  }
  async saveRunSummary(value: unknown): Promise<RunSummary> {
    const input = checkSummaryInput(value);
    const createdAt = now();
    return this.transaction(() => {
      if (read(this.db, "runs", input.runId)) return failInput("Run already exists.");
      const saved = {
        _id: input.runId,
        ...input,
        state: "created" as const,
        createdAt,
        eventCount: 0,
        eventBytes: 0,
      };
      put(this.db, "runs", input.runId, saved);
      return validatedRun(saved);
    });
  }
  async updateRunSummary(runIdValue: unknown, summaryValue: unknown): Promise<RunSummary> {
    const runId = id(runIdValue, "Run id");
    if (typeof summaryValue !== "string") return failInput("Run summary requires a string.");
    return this.transaction(() => {
      const run = read<JsonRecord>(this.db, "runs", runId);
      if (!run) return failInput("Run does not exist.");
      const updated = {
        ...run,
        summary: redacted(summaryValue.slice(0, MAX_SUMMARY)).slice(0, MAX_SUMMARY),
      };
      put(this.db, "runs", runId, updated);
      return validatedRun(updated);
    });
  }
  async listRunSummaries(): Promise<readonly RunSummary[]> {
    return all<unknown>(this.db, "runs").map(validatedRun).sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0,50);
  }
  async getRunSummary(runIdValue: unknown): Promise<RunSummary | null> {
    return validatedRunOptional(read(this.db, "runs", id(runIdValue, "Run id")));
  }
  async updateRunState(runIdValue: unknown, nextStateValue: unknown): Promise<RunSummary> {
    const runId = id(runIdValue, "Run id");
    if (!STATES.includes(nextStateValue as RunState)) return failInput("Run state is unsupported.");
    const nextState = nextStateValue as RunState;
    return this.transaction(() => {
      const run = read<unknown>(this.db, "runs", runId);
      if (!run) return failInput("Run does not exist.");
      const current = validatedRun(run);
      if (!TRANSITIONS[current.state].has(nextState)) return failInput("Run state transition is not allowed.");
      const changed = { ...(run as JsonRecord), state: nextState, updatedAt: now() };
      put(this.db, "runs", runId, changed);
      return validatedRun(changed);
    });
  }
  async recoverStaleRun(runIdValue: unknown, staleBeforeValue: unknown): Promise<boolean> {
    const runId = id(runIdValue, "Run id");
    const cutoff = date(staleBeforeValue, "Stale cutoff");
    return this.transaction(() => {
      const raw = read<unknown>(this.db, "runs", runId);
      if (!raw) return false;
      const run = validatedRun(raw);
      if (run.state !== "running" || (run.updatedAt ?? run.createdAt) > cutoff) return false;
      put(this.db, "runs", runId, { ...(raw as JsonRecord), state: "uncertain", updatedAt: now() });
      return true;
    });
  }
  async appendRunEvent(value: unknown): Promise<RunEvent> {
    const input = parseEvent(value);
    const key = `${input.runId}:${input.eventId}`;
    return this.transaction(() => {
      const existing = read<unknown>(this.db, "events", key);
      if (existing) {
        const parsed = validateEvent(existing);
        if (parsed.type !== input.type || parsed.stepId !== input.stepId || parsed.toolName !== input.toolName) {
          return failInput("Run event id was reused.");
        }
        return parsed;
      }
      const raw = read<unknown>(this.db, "runs", input.runId);
      if (!raw) return failInput("Run does not exist.");
      const run = raw as JsonRecord;
      const count = typeof run["eventCount"] === "number" ? run["eventCount"] : 0;
      const bytes = typeof run["eventBytes"] === "number" ? run["eventBytes"] : 0;
      const eventBytes = Buffer.byteLength(json({ ...input, sequence: MAX_EVENTS, createdAt: now() }));
      if (eventBytes > MAX_EVENT_BYTES) return failInput("Run event exceeds size limit.");
      if (count >= MAX_EVENTS || bytes + eventBytes > MAX_RUN_EVENT_BYTES) return failInput("Run event budget exhausted.");
      const event = { _id: key, ...input, sequence: count + 1, createdAt: now() };
      put(this.db, "runs", input.runId, { ...run, eventCount: count + 1, eventBytes: bytes + eventBytes });
      put(this.db, "events", key, event);
      return validateEvent(event);
    });
  }
  async getRunEvents(runIdValue: unknown): Promise<readonly RunEvent[]> {
    const runId = id(runIdValue, "Run id");
    return all<unknown>(this.db, "events")
      .map(validateEvent)
      .filter(event => event.runId === runId)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, MAX_EVENTS);
  }
  async saveRunCheckpoint(value: unknown): Promise<RunCheckpoint> {
    if(!record(value)||Object.keys(value).some(k=>!["runId","version","inputHash","stateHash","completedStepIds","pendingStepId"].includes(k)))return failInput("Checkpoint is invalid.");
    const runId=id(value["runId"],"Run id"), inputHash=validHash(value["inputHash"],"inputHash"), stateHash=validHash(value["stateHash"],"stateHash"), steps=value["completedStepIds"];
    if(value["version"]!==1||!Array.isArray(steps)||steps.length>MAX_CHECKPOINT_STEPS)return failInput("Checkpoint version or steps are invalid.");
    const completedStepIds=steps.map(s=>id(s,"Step id")); if(new Set(completedStepIds).size!==steps.length)return failInput("Checkpoint contains duplicate steps."); const pending=value["pendingStepId"]===undefined?undefined:id(value["pendingStepId"],"Pending step id");
    const normalized={runId,version:1 as const,inputHash,stateHash,completedStepIds,...(pending===undefined?{}:{pendingStepId:pending})}; if(Buffer.byteLength(json(normalized))>MAX_CHECKPOINT_BYTES)return failInput("Checkpoint exceeds size limit.");
    return this.transaction(()=>{ const raw=read<unknown>(this.db,"runs",runId); if(!raw||TERMINAL.has(validatedRun(raw).state))return failInput("Checkpoint requires an active run."); const cp={...normalized,updatedAt:now()}; put(this.db,"checkpoints",runId,cp); return validateCheckpoint(cp); });
  }
  async loadRunCheckpoint(runIdValue: unknown,inputHashValue: unknown,stateHashValue: unknown): Promise<RunCheckpoint|null> {
    const runId=id(runIdValue,"Run id"), ih=validHash(inputHashValue,"inputHash"), sh=validHash(stateHashValue,"stateHash"), rawRun=read<unknown>(this.db,"runs",runId), raw=read<unknown>(this.db,"checkpoints",runId); if(!rawRun||!raw)return null; if(TERMINAL.has(validatedRun(rawRun).state))throw new StaleCheckpointError(); const cp=validateCheckpoint(raw); if(cp.inputHash!==ih||cp.stateHash!==sh)throw new StaleCheckpointError(); return cp;
  }
  async saveArtifactReference(value: unknown): Promise<ArtifactReference> {
    if(!record(value)||Object.keys(value).some(k=>!["artifactId","runId","relativePath","type","sha256","bytes"].includes(k)))return failInput("Artifact reference has unsupported fields.");
    const type=value["type"], path=value["relativePath"], bytes=value["bytes"]; if(typeof path!=="string"||path.length<1||path.length>512||path.startsWith("/")||path.includes("\\")||path.split("/").some(x=>!x||x==="."||x==="..")||typeof type!=="string"||!ARTIFACT_TYPES.has(type)||typeof bytes!=="number"||!Number.isSafeInteger(bytes)||bytes<1||bytes>65536)return failInput("Artifact reference is invalid.");
    const artifact: ArtifactReference={artifactId:id(value["artifactId"],"Artifact id"),runId:id(value["runId"],"Run id"),relativePath:path,type:type as ArtifactReference["type"],sha256:validHash(value["sha256"],"Artifact hash"),bytes,createdAt:now()};
    return this.transaction(()=>{const runRaw=read<unknown>(this.db,"runs",artifact.runId); if(!runRaw)return failInput("Matching completed run is required."); const run=validatedRun(runRaw), expected=artifact.type.startsWith("document-")?"document-analyze":"csv-analyze"; if(run.workflowId!==expected||run.state!=="completed")return failInput("Artifact requires a matching completed workflow run."); if(read(this.db,"artifacts",artifact.artifactId))return failInput("Artifact already exists."); put(this.db,"artifacts",artifact.artifactId,artifact);return artifact;});
  }
  async listArtifactReferences(runIdValue: unknown): Promise<readonly ArtifactReference[]> {
    const runId = id(runIdValue, "Run id");
    return all<unknown>(this.db, "artifacts")
      .map(validateArtifact)
      .filter(artifact => artifact.runId === runId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, 50);
  }
  async createSchedule(value: unknown): Promise<ScheduleRecord> {
    const definition = parseDefinition(value);
    return this.transaction(() => {
      const activeCount = all<unknown>(this.db, "schedules")
        .filter(value => checkSchedule(value).status !== "deleted").length;
      if (activeCount >= MAX_SCHEDULES) return failInput("Schedule limit reached.");
      if (read(this.db, "schedules", definition.scheduleId)) return failInput("Schedule already exists.");
      const createdAt = now();
      const schedule = {
        ...definition,
        _id: definition.scheduleId,
        status: "active" as const,
        createdAt,
        updatedAt: createdAt,
        occurrences: [],
      };
      put(this.db, "schedules", definition.scheduleId, schedule);
      return checkSchedule(schedule);
    });
  }
  async listSchedules(includeDeleted = false): Promise<readonly ScheduleRecord[]> {
    return all<unknown>(this.db, "schedules")
      .map(checkSchedule)
      .filter(schedule => includeDeleted || schedule.status !== "deleted")
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, MAX_SCHEDULES);
  }
  async grantFolderApproval(pathValue: unknown,accessValue: unknown): Promise<FolderApproval> { const path=folderPath(pathValue);if(accessValue!=="read"&&accessValue!=="write")return failInput("Folder access must be read or write.");const access=accessValue;const identity=platform()==="win32"?path.toLowerCase():path,key=createHash("sha256").update(`${identity}\0${access}`).digest("hex");return this.transaction(()=>{const current=read<JsonRecord>(this.db,"approvals",key),t=now(),a={path,access,status:"active" as const,createdAt:current?.["createdAt"]??t,updatedAt:t};put(this.db,"approvals",key,a);return validateApproval(a);}); }
  async listFolderApprovals(includeRevoked=false): Promise<readonly FolderApproval[]> { return all<unknown>(this.db,"approvals").map(validateApproval).filter(a=>includeRevoked||a.status==="active").sort((a,b)=>a.path.localeCompare(b.path)||a.access.localeCompare(b.access)); }
  async hasFolderApproval(pathValue: unknown,accessValue: unknown): Promise<boolean> { const p=folderPath(pathValue);if(accessValue!=="read"&&accessValue!=="write")return failInput("Folder access must be read or write.");return this.listFolderApprovals().then(a=>a.some(x=>x.access===accessValue&&contains(x.path,p))); }
  async revokeFolderApproval(pathValue: unknown,accessValue: unknown): Promise<boolean> { const p=folderPath(pathValue);if(accessValue!=="read"&&accessValue!=="write")return failInput("Folder access must be read or write.");const key=createHash("sha256").update(`${platform()==="win32"?p.toLowerCase():p}\0${accessValue}`).digest("hex");return this.transaction(()=>{const a=read<unknown>(this.db,"approvals",key);if(!a)return false;const valid=validateApproval(a);if(valid.status!=="active")return false;put(this.db,"approvals",key,{...valid,status:"revoked",updatedAt:now()});return true;}); }
  async setScheduleStatus(scheduleIdValue: unknown,nextStatusValue: unknown): Promise<ScheduleRecord> { const sid=id(scheduleIdValue,"Schedule id");if(nextStatusValue!=="active"&&nextStatusValue!=="paused"&&nextStatusValue!=="deleted")return failInput("Schedule status is unsupported.");return this.transaction(()=>{const raw=read<unknown>(this.db,"schedules",sid);if(!raw)return failInput("Schedule does not exist.");const s=checkSchedule(raw);if(s.dispatchOwner!==undefined)return failInput("Schedule has an active occurrence claim.");const allowed=nextStatusValue==="deleted"?s.status!=="deleted":nextStatusValue==="paused"?s.status==="active"||(s.status==="completed"&&s.pendingOccurrence!==undefined):s.status==="paused";if(!allowed)return failInput("Schedule transition is not allowed.");const updated={...(raw as JsonRecord),status:nextStatusValue,updatedAt:now()};put(this.db,"schedules",sid,updated);return checkSchedule(updated);}); }
  async claimDueSchedules(nowValue: unknown,graceMsValue: unknown): Promise<readonly {readonly schedule:ScheduleRecord;readonly occurrence:ScheduleOccurrence}[]> {
    const scheduledAt = date(nowValue, "Scheduler time");
    if (typeof graceMsValue !== "number" || !Number.isSafeInteger(graceMsValue) || graceMsValue < 1_000 || graceMsValue > 60_000) {
      return failInput("Scheduler grace period must be from 1 to 60 seconds.");
    }
    const graceMs = graceMsValue;

    return this.transaction(() => {
      const due = all<unknown>(this.db, "schedules")
        .map(checkSchedule)
        .filter(schedule => schedule.status === "active" && schedule.nextRunAt <= scheduledAt)
        .sort((left, right) => left.nextRunAt.getTime() - right.nextRunAt.getTime())
        .slice(0, MAX_SCHEDULES);
      const claims: Array<{ schedule: ScheduleRecord; occurrence: ScheduleOccurrence }> = [];

      for (const schedule of due) {
        const occurrenceTime = schedule.nextRunAt;
        const intervalMs = schedule.intervalMinutes === undefined ? undefined : schedule.intervalMinutes * 60_000;
        const lateByMs = scheduledAt.getTime() - occurrenceTime.getTime();
        const dueSlots = intervalMs === undefined ? 1 : Math.floor(lateByMs / intervalMs) + 1;
        const missedCount = schedule.pendingOccurrence !== undefined || lateByMs > graceMs ? dueSlots : 0;
        const occurrenceStatus: ScheduleOccurrence["status"] = missedCount > 0 ? "missed" : "awaiting_approval";
        const occurrence: ScheduleOccurrence = {
          runId: occurrenceId(schedule.scheduleId, occurrenceTime),
          scheduledFor: occurrenceTime,
          status: occurrenceStatus,
          missedCount,
          recordedAt: scheduledAt,
        };
        const nextRunAt = intervalMs === undefined
          ? occurrenceTime
          : new Date(occurrenceTime.getTime() + Math.max(1, missedCount) * intervalMs);
        const nextStatus = intervalMs === undefined ? "completed" : "active";
        const updated: JsonRecord = {
          ...(read<JsonRecord>(this.db, "schedules", schedule.scheduleId) ?? {}),
          status: nextStatus,
          nextRunAt,
          updatedAt: scheduledAt,
          occurrences: [...schedule.occurrences, occurrence].slice(-MAX_OCCURRENCES),
          ...(occurrenceStatus === "awaiting_approval" ? { pendingOccurrence: occurrence } : {}),
        };
        put(this.db, "schedules", schedule.scheduleId, updated);

        if (occurrenceStatus === "awaiting_approval") {
          this.ensureScheduledRun(schedule, occurrence);
          claims.push({ schedule: checkSchedule(updated), occurrence });
        }
      }
      return claims;
    });
  }
  async listPendingScheduleOccurrences(): Promise<readonly { readonly schedule: ScheduleRecord; readonly occurrence: ScheduleOccurrence }[]> {
    const schedules = await this.listSchedules();
    return schedules.flatMap(schedule =>
      schedule.status === "paused" || schedule.status === "deleted" || schedule.pendingOccurrence === undefined
        ? []
        : [{ schedule, occurrence: schedule.pendingOccurrence }],
    );
  }
  async claimPendingScheduleOccurrences(ownerIdValue: unknown): Promise<readonly { readonly schedule: ScheduleRecord; readonly occurrence: ScheduleOccurrence }[]> {
    const owner = id(ownerIdValue, "Scheduler owner id");
    return this.transaction(() => {
      const claimed: Array<{ schedule: ScheduleRecord; occurrence: ScheduleOccurrence }> = [];
      for (const schedule of all<unknown>(this.db, "schedules").map(checkSchedule)) {
        const occurrence = schedule.pendingOccurrence;
        if (schedule.dispatchOwner !== undefined || occurrence === undefined ||
            !(schedule.status === "active" || schedule.status === "completed") || occurrence.status !== "awaiting_approval") continue;

        this.ensureScheduledRun(schedule, occurrence);

        const updated = {
          ...(read<JsonRecord>(this.db, "schedules", schedule.scheduleId) ?? {}),
          dispatchOwner: owner,
          dispatchStartedAt: now(),
          updatedAt: now(),
        };
        put(this.db, "schedules", schedule.scheduleId, updated);
        claimed.push({ schedule: checkSchedule(updated), occurrence });
      }
      return claimed;
    });
  }
  async releaseScheduleOccurrenceClaim(scheduleIdValue: unknown, scheduledForValue: unknown, ownerIdValue: unknown): Promise<void> {
    const sid = id(scheduleIdValue, "Schedule id");
    const when = date(scheduledForValue, "Occurrence time");
    const owner = id(ownerIdValue, "Owner id");
    this.transaction(() => {
      const raw = read<JsonRecord>(this.db, "schedules", sid);
      if (!raw || raw["dispatchOwner"] !== owner) return failInput("Schedule occurrence claim was not found.");
      const schedule = checkSchedule(raw);
      if (schedule.pendingOccurrence?.status !== "awaiting_approval" || schedule.pendingOccurrence.scheduledFor.getTime() !== when.getTime()) {
        return failInput("Schedule occurrence claim was not found.");
      }
      delete raw["dispatchOwner"];
      delete raw["dispatchStartedAt"];
      raw["updatedAt"] = now();
      put(this.db, "schedules", sid, raw);
    });
  }
  async recoverScheduleOccurrenceClaim(scheduleIdValue: unknown, scheduledForValue: unknown): Promise<boolean> {
    const sid = id(scheduleIdValue, "Schedule id");
    const when = date(scheduledForValue, "Occurrence time");
    return this.transaction(() => {
      const raw = read<JsonRecord>(this.db, "schedules", sid);
      if (!raw) return false;
      const schedule = checkSchedule(raw);
      if (schedule.dispatchOwner === undefined || schedule.pendingOccurrence?.status !== "awaiting_approval" || schedule.pendingOccurrence.scheduledFor.getTime() !== when.getTime()) return false;
      delete raw["dispatchOwner"];
      delete raw["dispatchStartedAt"];
      raw["updatedAt"] = now();
      put(this.db, "schedules", sid, raw);
      return true;
    });
  }
  async finishScheduleOccurrence(
    scheduleIdValue: unknown,
    scheduledForValue: unknown,
    outcomeValue: unknown,
    ownerIdValue?: unknown,
  ): Promise<void> {
    const scheduleId = id(scheduleIdValue, "Schedule id");
    const scheduledFor = date(scheduledForValue, "Occurrence time");
    if (outcomeValue !== "completed" && outcomeValue !== "failed") return failInput("Occurrence outcome is unsupported.");
    const ownerId = ownerIdValue === undefined ? undefined : id(ownerIdValue, "Owner id");

    this.transaction(() => {
      const raw = read<JsonRecord>(this.db, "schedules", scheduleId);
      if (!raw) return failInput("Schedule does not exist.");
      const schedule = checkSchedule(raw);
      const pending = schedule.pendingOccurrence;
      if (!(schedule.status === "active" || schedule.status === "completed") ||
          pending?.status !== "awaiting_approval" || pending.scheduledFor.getTime() !== scheduledFor.getTime() ||
          (ownerId !== undefined && schedule.dispatchOwner !== ownerId)) {
        return failInput("Pending occurrence was not found.");
      }

      const recordedAt = now();
      const occurrences = schedule.occurrences.map(occurrence =>
        occurrence.scheduledFor.getTime() === scheduledFor.getTime() && occurrence.status === "awaiting_approval"
          ? { ...occurrence, status: outcomeValue, recordedAt }
          : occurrence,
      );
      delete raw["pendingOccurrence"];
      delete raw["dispatchOwner"];
      delete raw["dispatchStartedAt"];
      raw["occurrences"] = occurrences;
      raw["updatedAt"] = recordedAt;
      if (schedule.intervalMinutes === undefined) raw["status"] = "completed";
      put(this.db, "schedules", scheduleId, raw);
    });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      this.db.close();
      this.closed = true;
    } catch {
      throw new DatabaseShutdownError();
    }
  }
}

function validatedRunOptional(v: unknown): RunSummary|null { return v===null?null:validatedRun(v); }
function validateCheckpoint(v: unknown): RunCheckpoint { if(!record(v))return failDb();const runId=id(v["runId"],"Run id"),inputHash=validHash(v["inputHash"],"inputHash"),stateHash=validHash(v["stateHash"],"stateHash"),steps=v["completedStepIds"];if(v["version"]!==1||!Array.isArray(steps)||steps.length>MAX_CHECKPOINT_STEPS||v["_id"]!==undefined&&v["_id"]!==runId)return failDb();const completedStepIds=steps.map(x=>id(x,"Step id"));if(new Set(completedStepIds).size!==steps.length)return failDb();const pending=v["pendingStepId"]===undefined?undefined:id(v["pendingStepId"],"Pending step id");const cp={runId,version:1 as const,inputHash,stateHash,completedStepIds,...(pending===undefined?{}:{pendingStepId:pending})};if(Buffer.byteLength(json(cp))>MAX_CHECKPOINT_BYTES)return failDb();return {...cp,updatedAt:date(v["updatedAt"],"Checkpoint timestamp")}; }
function validateArtifact(v: unknown): ArtifactReference { if(!record(v)||typeof v["type"]!=="string"||!ARTIFACT_TYPES.has(v["type"])||typeof v["relativePath"]!=="string"||!Number.isSafeInteger(v["bytes"])||(v["bytes"] as number)<1||(v["bytes"] as number)>65536)return failDb();const path=v["relativePath"];if(path.length<1||path.length>512||path.startsWith("/")||path.includes("\\")||path.split("/").some(x=>!x||x==="."||x===".."))return failDb();return {artifactId:id(v["artifactId"],"Artifact id"),runId:id(v["runId"],"Run id"),relativePath:path,type:v["type"] as ArtifactReference["type"],sha256:validHash(v["sha256"],"Artifact hash"),bytes:v["bytes"] as number,createdAt:date(v["createdAt"],"Artifact timestamp")}; }
function validateApproval(v: unknown): FolderApproval { if(!record(v)||(v["access"]!=="read"&&v["access"]!=="write")||(v["status"]!=="active"&&v["status"]!=="revoked"))return failDb();return {path:folderPath(v["path"]),access:v["access"],status:v["status"],createdAt:date(v["createdAt"],"createdAt"),updatedAt:date(v["updatedAt"],"updatedAt")}; }
