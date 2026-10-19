import assert from "node:assert/strict";
import test from "node:test";
import { runCsvWorkflowCommand, runDocumentAnalysisCommand } from "../../dist/cli/commands/data-documents.js";
import { resumeCsvAnalysisWorkflow } from "../../dist/workflows/csv-analysis-workflow.js";
import { resumeDocumentAnalysisWorkflow } from "../../dist/workflows/document-analysis-workflow.js";

function createPersistence(onFirstCheckpoint) {
  const state = { runs: new Map(), checkpoints: new Map(), events: [] };
  let interrupted = false;
  const persistence = {
    state,
    async saveRunSummary(value) {
      const run = { ...value, state: "created", createdAt: new Date() };
      state.runs.set(value.runId, run);
      return run;
    },
    async updateRunState(runId, nextState) {
      const run = state.runs.get(runId);
      const updated = { ...run, state: nextState };
      state.runs.set(runId, updated);
      return updated;
    },
    async updateRunSummary(runId, summary) {
      const run = state.runs.get(runId);
      state.runs.set(runId, { ...run, summary });
      return state.runs.get(runId);
    },
    async appendRunEvent(event) {
      state.events.push(event);
      return { ...event, sequence: state.events.length, createdAt: new Date() };
    },
    async saveRunCheckpoint(checkpoint) {
      state.checkpoints.set(checkpoint.runId, checkpoint);
      if (!interrupted) {
        interrupted = true;
        onFirstCheckpoint();
      }
      return { ...checkpoint, updatedAt: new Date() };
    },
    async loadRunCheckpoint(runId, inputHash, stateHash) {
      const checkpoint = state.checkpoints.get(runId);
      const run = state.runs.get(runId);
      return run?.state === "uncertain" && checkpoint?.inputHash === inputHash && checkpoint?.stateHash === stateHash
        ? { ...checkpoint, updatedAt: new Date() }
        : null;
    },
    async getRunSummary(runId) {
      return state.runs.get(runId) ?? null;
    },
    async recoverStaleRun() {
      return false;
    },
  };
  return persistence;
}

function dependenciesFor(persistence, bytes) {
  let interrupt;
  let cleaned = false;
  return {
    dependencies: {
      withStore: async (action) => action(persistence),
      readApprovedInputFile: async () => bytes,
      requirePersistentFolderApproval: async () => {},
      registerInterrupt: (handler) => {
        interrupt = handler;
        return () => { cleaned = true; };
      },
    },
    interrupt: () => interrupt?.(),
    cleaned: () => cleaned,
  };
}

test("direct CSV Ctrl+C records uncertain state and resumes the same checkpoint once", async () => {
  let interrupt;
  const bytes = Buffer.from("name,amount\nA,2\nB,3\n", "utf8");
  const persistence = createPersistence(() => interrupt());
  const fixture = dependenciesFor(persistence, bytes);
  interrupt = fixture.interrupt;
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await runCsvWorkflowCommand(["--input", "synthetic.csv"], fixture.dependencies);
    const [run] = persistence.state.runs.values();
    assert.equal(process.exitCode, 130);
    assert.equal(run?.state, "uncertain");
    assert.equal(persistence.state.checkpoints.get(run.runId).pendingStepId, "analyze");
    assert.equal(persistence.state.events.some((event) => event.type === "run_paused"), true);
    assert.equal(fixture.cleaned(), true);

    const resumed = await resumeCsvAnalysisWorkflow(persistence, run.runId, bytes);
    assert.equal(resumed.run.state, "completed");
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.analysis.rowCount, 2);
    assert.equal(persistence.state.events.filter((event) => event.type === "run_finished").length, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("direct document Ctrl+C records uncertain state and resumes with the same parser format", async () => {
  let interrupt;
  const bytes = Buffer.from("synthetic words remain local", "utf8");
  const persistence = createPersistence(() => interrupt());
  const fixture = dependenciesFor(persistence, bytes);
  interrupt = fixture.interrupt;
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await runDocumentAnalysisCommand(["--input", "synthetic.txt"], fixture.dependencies);
    const [run] = persistence.state.runs.values();
    assert.equal(process.exitCode, 130);
    assert.equal(run?.state, "uncertain");
    assert.equal(persistence.state.checkpoints.get(run.runId).pendingStepId, "parse");
    assert.equal(persistence.state.events.some((event) => event.type === "run_paused"), true);
    assert.equal(fixture.cleaned(), true);

    const resumed = await resumeDocumentAnalysisWorkflow(persistence, run.runId, ".txt", bytes);
    assert.equal(resumed.run.state, "completed");
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.analysis.wordCount, 4);
    assert.equal(persistence.state.events.filter((event) => event.type === "run_finished").length, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("CSV and document Ctrl+C cancels a pending exact-file approval before storage opens", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    for (const [command, args] of [
      [runCsvWorkflowCommand, ["--input", "synthetic.csv"]],
      [runDocumentAnalysisCommand, ["--input", "synthetic.txt"]],
    ]) {
      const persistence = createPersistence(() => assert.fail("storage must not open before file approval"));
      const fixture = dependenciesFor(persistence, Buffer.from("unused", "utf8"));
      fixture.dependencies.readApprovedInputFile = async (_path, signal) => new Promise((resolve) => {
        assert.ok(signal instanceof AbortSignal);
        signal.addEventListener("abort", () => resolve(undefined), { once: true });
      });
      const pending = command(args, fixture.dependencies);
      await new Promise((resolve) => setImmediate(resolve));
      fixture.interrupt();
      await pending;
      assert.equal(process.exitCode, 130);
      assert.equal(persistence.state.runs.size, 0);
      assert.equal(fixture.cleaned(), true);
      process.exitCode = 0;
    }
  } finally {
    process.exitCode = previousExitCode;
  }
});
