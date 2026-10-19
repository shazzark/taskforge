import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resumeWorkflowCommand, runCsvWorkflowCommand, runDocumentAnalysisCommand } from "../../dist/cli/commands/data-documents.js";
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

test("CSV and document export prompt cancellation preserves completed analysis and writes no report", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  const root = await mkdtemp(join(tmpdir(), "taskforge-export-cancel-"));
  try {
    for (const [command, inputPath, bytes] of [
      [runCsvWorkflowCommand, "synthetic.csv", Buffer.from("name,amount\nA,2\n", "utf8")],
      [runDocumentAnalysisCommand, "synthetic.txt", Buffer.from("local words only", "utf8")],
    ]) {
      const persistence = createPersistence(() => {});
      const fixture = dependenciesFor(persistence, bytes);
      const outputPath = join(root, `${inputPath}.json`);
      let promptSeen = false;
      let signalPromptReached;
      const promptReached = new Promise((resolve) => { signalPromptReached = resolve; });
      fixture.dependencies.askExportConsent = (question, signal) => {
        promptSeen = question.includes("Create this new");
        signalPromptReached();
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(undefined), { once: true });
        });
      };
      const pending = command(["--input", inputPath, "--output", outputPath], fixture.dependencies);
      let promptTimeout;
      try {
        await Promise.race([
          promptReached,
          new Promise((_, reject) => { promptTimeout = setTimeout(() => reject(new Error("export prompt was not reached")), 5000); }),
        ]);
      } finally { clearTimeout(promptTimeout); }
      assert.equal(promptSeen, true);
      fixture.interrupt();
      await pending;

      const [run] = persistence.state.runs.values();
      assert.equal(promptSeen, true);
      assert.equal(process.exitCode, 130);
      assert.equal(run?.state, "completed");
      assert.equal(persistence.state.events.some((event) => event.type === "run_finished"), true);
      assert.equal(fixture.cleaned(), true);
      await assert.rejects(access(outputPath), { code: "ENOENT" });
      process.exitCode = 0;
    }
  } finally {
    process.exitCode = previousExitCode;
    await rm(root, { recursive: true, force: true });
  }
});

test("the default process SIGINT handler cancels pending CSV and document export approval", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  const root = await mkdtemp(join(tmpdir(), "taskforge-process-sigint-"));
  const initialListeners = process.listenerCount("SIGINT");
  try {
    for (const [command, inputPath, bytes] of [
      [runCsvWorkflowCommand, "synthetic.csv", Buffer.from("name,amount\nA,2\n", "utf8")],
      [runDocumentAnalysisCommand, "synthetic.txt", Buffer.from("local document", "utf8")],
    ]) {
      process.exitCode = 0;
      const persistence = createPersistence(() => {});
      const fixture = dependenciesFor(persistence, bytes);
      delete fixture.dependencies.registerInterrupt;
      const outputPath = join(root, `${inputPath}.json`);
      let reachPrompt;
      const promptReached = new Promise((resolve) => { reachPrompt = resolve; });
      fixture.dependencies.askExportConsent = (_question, signal) => {
        reachPrompt();
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true }));
      };
      const pending = command(["--input", inputPath, "--output", outputPath], fixture.dependencies);
      let promptTimeout;
      try {
        await Promise.race([
          promptReached,
          new Promise((_, reject) => { promptTimeout = setTimeout(() => reject(new Error("export prompt was not reached")), 5000); }),
        ]);
      } finally { clearTimeout(promptTimeout); }
      assert.equal(process.listenerCount("SIGINT"), initialListeners + 1);
      process.emit("SIGINT");
      await pending;
      assert.equal(process.exitCode, 130);
      assert.equal(persistence.state.events.some((event) => event.type === "run_finished"), true);
      assert.equal(process.listenerCount("SIGINT"), initialListeners);
      await assert.rejects(access(outputPath), { code: "ENOENT" });
    }
  } finally {
    process.exitCode = previousExitCode;
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling CSV and document resumes returns runs to uncertain and later CLI resumes complete once", async () => {
  const previousExitCode = process.exitCode;
  try {
    for (const [runCommand, inputPath, bytes] of [
      [runCsvWorkflowCommand, "synthetic.csv", Buffer.from("name,amount\nA,2\n", "utf8")],
      [runDocumentAnalysisCommand, "synthetic.txt", Buffer.from("resume document locally", "utf8")],
    ]) {
      process.exitCode = 0;
      let initialFixture;
      const persistence = createPersistence(() => initialFixture.interrupt());
      initialFixture = dependenciesFor(persistence, bytes);
      await runCommand(["--input", inputPath], initialFixture.dependencies);
      const [run] = persistence.state.runs.values();
      assert.equal(run?.state, "uncertain");

      const resumeFixture = dependenciesFor(persistence, bytes);
      const appendRunEvent = persistence.appendRunEvent.bind(persistence);
      persistence.appendRunEvent = async (event) => {
        const saved = await appendRunEvent(event);
        if (event.type === "run_resumed") resumeFixture.interrupt();
        return saved;
      };
      process.exitCode = 0;
      await resumeWorkflowCommand(run.runId, ["--input", inputPath], resumeFixture.dependencies);
      assert.equal(process.exitCode, 130);
      assert.equal(persistence.state.runs.get(run.runId)?.state, "uncertain");
      assert.equal(persistence.state.events.filter((event) => event.type === "run_finished").length, 0);
      assert.equal(persistence.state.events.filter((event) => event.type === "run_paused").length, 2);
      assert.equal(resumeFixture.cleaned(), true);

      persistence.appendRunEvent = appendRunEvent;
      process.exitCode = 0;
      await resumeWorkflowCommand(run.runId, ["--input", inputPath], resumeFixture.dependencies);
      assert.equal(process.exitCode, 0);
      assert.equal(persistence.state.runs.get(run.runId)?.state, "completed");
      assert.equal(persistence.state.events.filter((event) => event.type === "run_finished").length, 1);
    }
  } finally {
    process.exitCode = previousExitCode;
  }
});
