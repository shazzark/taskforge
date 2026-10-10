import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { analyzeCsv, CsvAnalysisError, type CsvAnalysisResult } from "../data/csv-analysis.js";
import { MongoStore, type RunSummary } from "../mongo-store.js";

const WORKFLOW_ID = "csv-analyze";
const WORKFLOW_STATE_HASH = createHash("sha256").update("taskforge:csv-analyze:v1").digest("hex");
const ANALYSIS_STEP_ID = "analyze";

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

function analyzeBytes(input: Uint8Array): CsvAnalysisResult {
  if (!(input instanceof Uint8Array) || input.byteLength > 8 * 1024 * 1024) {
    throw new CsvWorkflowError("CSV input is invalid or exceeds the 8 MiB workflow limit.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new CsvWorkflowError("CSV input must use valid UTF-8 encoding.");
  }
  return analyzeCsv(text, { numericColumns: [] });
}

async function executeAnalysis(
  store: MongoStore,
  run: RunSummary,
  inputHash: string,
  input: Uint8Array,
  resumed: boolean,
): Promise<CsvWorkflowResult> {
  try {
    await store.saveRunCheckpoint({
      runId: run.runId,
      version: 1,
      inputHash,
      stateHash: WORKFLOW_STATE_HASH,
      completedStepIds: [],
      pendingStepId: ANALYSIS_STEP_ID,
    });
    await store.appendRunEvent({
      runId: run.runId,
      eventId: randomUUID(),
      type: "step_started",
      stepId: ANALYSIS_STEP_ID,
    });
    const analysis = analyzeBytes(input);
    await store.saveRunCheckpoint({
      runId: run.runId,
      version: 1,
      inputHash,
      stateHash: WORKFLOW_STATE_HASH,
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
): Promise<CsvWorkflowResult> {
  const inputHash = createHash("sha256").update(input).digest("hex");
  const runId = randomUUID();
  const run = await store.saveRunSummary({
    runId,
    workflowId: WORKFLOW_ID,
    summary: "CSV analysis started; input content is not persisted.",
  });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  return executeAnalysis(store, run, inputHash, input, false);
}

export async function resumeCsvAnalysisWorkflow(
  store: MongoStore,
  runId: unknown,
  input: Uint8Array,
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
  const checkpoint = await store.loadRunCheckpoint(runId, inputHash, WORKFLOW_STATE_HASH);
  if (
    checkpoint === null ||
    (checkpoint.pendingStepId !== ANALYSIS_STEP_ID && !checkpoint.completedStepIds.includes(ANALYSIS_STEP_ID))
  ) {
    throw new CsvWorkflowError("The run has no resumable analysis checkpoint.");
  }
  const resumed = await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_resumed" });
  return executeAnalysis(store, resumed, inputHash, input, true);
}
