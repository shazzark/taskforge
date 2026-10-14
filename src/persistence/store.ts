import type {
  ArtifactReference,
  FolderApproval,
  RunCheckpoint,
  RunEvent,
  RunSummary,
  ScheduleOccurrence,
  ScheduleRecord,
} from "../mongo-store.js";
import type { MongoStore } from "../mongo-store.js";

/**
 * Adapter-neutral persistence contract. Pick only public operations so adapters
 * do not inherit MongoStore's private connection state or nominal class identity.
 */
export type TaskForgeStore = Pick<
  MongoStore,
  | "saveRunSummary"
  | "updateRunSummary"
  | "listRunSummaries"
  | "saveArtifactReference"
  | "listArtifactReferences"
  | "updateRunState"
  | "recoverStaleRun"
  | "appendRunEvent"
  | "getRunEvents"
  | "saveRunCheckpoint"
  | "loadRunCheckpoint"
  | "getRunSummary"
  | "createSchedule"
  | "listSchedules"
  | "grantFolderApproval"
  | "listFolderApprovals"
  | "hasFolderApproval"
  | "revokeFolderApproval"
  | "setScheduleStatus"
  | "claimDueSchedules"
  | "listPendingScheduleOccurrences"
  | "claimPendingScheduleOccurrences"
  | "releaseScheduleOccurrenceClaim"
  | "recoverScheduleOccurrenceClaim"
  | "finishScheduleOccurrence"
  | "close"
>;

export type StoreRunSummary = RunSummary;
export type StoreRunEvent = RunEvent;
export type StoreRunCheckpoint = RunCheckpoint;
export type StoreArtifactReference = ArtifactReference;
export type StoreFolderApproval = FolderApproval;
export type StoreSchedule = ScheduleRecord;
export type StoreScheduleOccurrence = ScheduleOccurrence;
