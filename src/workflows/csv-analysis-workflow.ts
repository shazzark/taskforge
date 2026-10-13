import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { analyzeCsv, CsvAnalysisError, type CsvAnalysisResult } from "../data/csv-analysis.js";
import { MongoStore, type RunSummary } from "../mongo-store.js";

const WORKFLOW_ID = "csv-analyze";
const ANALYSIS_STEP_ID = "analyze";

function workflowStateHash(numericColumns: readonly string[]): string {
  return createHash("sha256").update(numericColumns.length === 0
    ? "taskforge:csv-analyze:v1"
    : `taskforge:csv-analyze:v2:${JSON.stringify(numericColumns)}`).digest("hex");
}

export class CsvWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvWorkflowError";
  }
}

export interface CsvWorkflowResult {
  readonly run: RunSummary;
  readonly analysis: CsvAnalysisResult;
  readonly resumed: boolean;
}

function summarize(analysis: CsvAnalysisResult): string {
  const missingCellCount = Object.values(analysis.missingValues).reduce((total, count) => total + count, 0);
  return `CSV analysis complete: ${analysis.rowCount} rows; ${analysis.duplicateRowCount} duplicate rows; ${missingCellCount} missing cells.`;
}

function analyzeBytes(input: Uint8Array, numericColumns: readonly string[]): CsvAnalysisResult {
  if (!(input instanceof Uint8Array) || input.byteLength > 8 * 1024 * 1024) {
    throw new CsvWorkflowError("CSV input is invalid or exceeds the 8 MiB workflow limit.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new CsvWorkflowError("CSV input must use valid UTF-8 encoding.");
  }
  return analyzeCsv(text, { numericColumns });
}

async function executeAnalysis(
  store: MongoStore,
  run: RunSummary,
  inputHash: string,
  input: Uint8Array,
  numericColumns: readonly string[],
  resumed: boolean,
): Promise<CsvWorkflowResult> {
  try {
    await store.saveRunCheckpoint({
      runId: run.runId,
      version: 1,
      inputHash,
      stateHash: workflowStateHash(numericColumns),
      completedStepIds: [],
      pendingStepId: ANALYSIS_STEP_ID,
    });
    await store.appendRunEvent({
      runId: run.runId,
      eventId: randomUUID(),
      type: "step_started",
      stepId: ANALYSIS_STEP_ID,
    });
    const analysis = analyzeBytes(input, numericColumns);
    await store.saveRunCheckpoint({
      runId: run.runId,
      version: 1,
      inputHash,
      stateHash: workflowStateHash(numericColumns),
      completedStepIds: [ANALYSIS_STEP_ID],
    });
    await store.appendRunEvent({
      runId: run.runId,
      eventId: randomUUID(),
      type: "step_finished",
      stepId: ANALYSIS_STEP_ID,
    });
    await store.updateRunSummary(run.runId, summarize(analysis));
    const completed = await store.updateRunState(run.runId, "completed");
    await store.appendRunEvent({
      runId: run.runId,
      eventId: randomUUID(),
      type: "run_finished",
    });
    return { run: completed, analysis, resumed };
  } catch (error: unknown) {
    if (error instanceof CsvAnalysisError || error instanceof CsvWorkflowError) {
      await store.updateRunSummary(run.runId, "CSV analysis failed validation; input content was not persisted.");
      await store.updateRunState(run.runId, "failed");
      await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "run_failed" });
      throw new CsvWorkflowError(error.message);
    }
    try {
      await store.updateRunState(run.runId, "uncertain");
      await store.appendRunEvent({ runId: run.runId, eventId: randomUUID(), type: "run_paused" });
    } catch {
      // The original failure may be a database outage; do not mask it with a second failure.
    }
    throw error;
  }
}

export async function runCsvAnalysisWorkflow(
  store: MongoStore,
  input: Uint8Array,
  scheduledRunId?: string,
  numericColumns: readonly string[] = [],
): Promise<CsvWorkflowResult> {
  const inputHash = createHash("sha256").update(input).digest("hex");
  const runId = scheduledRunId ?? randomUUID();
  const existing = scheduledRunId === undefined ? null : await store.getRunSummary(runId);
  const run = existing ?? await store.saveRunSummary({
    runId, workflowId: WORKFLOW_ID, summary: "CSV analysis started; input content is not persisted.",
  });
  if (run.workflowId !== WORKFLOW_ID || (existing !== null && existing.state !== "awaiting_approval")) {
    throw new CsvWorkflowError("Scheduled CSV run is not awaiting fresh approval.");
  }
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  return executeAnalysis(store, run, inputHash, input, numericColumns, false);
}

export async function resumeCsvAnalysisWorkflow(
  store: MongoStore,
  runId: unknown,
  input: Uint8Array,
  numericColumns: readonly string[] = [],
): Promise<CsvWorkflowResult> {
  if (typeof runId !== "string") {
    throw new CsvWorkflowError("A run id is required to resume CSV analysis.");
  }
  let existing = await store.getRunSummary(runId);
  if (existing === null || existing.workflowId !== WORKFLOW_ID) {
    throw new CsvWorkflowError("Only an uncertain csv-analyze run can be resumed.");
  }
  if (existing.state === "running") {
    const recovered = await store.recoverStaleRun(runId, new Date(Date.now() - 2 * 60 * 1000));
    if (recovered) {
      await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_paused" });
      existing = await store.getRunSummary(runId);
    }
  }
  if (existing === null || existing.state !== "uncertain") {
    throw new CsvWorkflowError("Only an uncertain csv-analyze run can be resumed.");
  }
  const inputHash = createHash("sha256").update(input).digest("hex");
  const checkpoint = await store.loadRunCheckpoint(runId, inputHash, workflowStateHash(numericColumns));
  if (
    checkpoint === null ||
    (checkpoint.pendingStepId !== ANALYSIS_STEP_ID && !checkpoint.completedStepIds.includes(ANALYSIS_STEP_ID))
  ) {
    throw new CsvWorkflowError("The run has no resumable analysis checkpoint.");
  }
  const resumed = await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_resumed" });
  return executeAnalysis(store, resumed, inputHash, input, numericColumns, true);
}
