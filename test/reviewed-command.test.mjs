import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { runReviewedCommand, ReviewedCommandError } from "../dist/software/reviewed-command.js";

function createPersistenceRecorder() {
  const state = { events: [], runs: new Map() };
  return {
    state,
    async saveRunSummary(input) {
      const run = { ...input, state: "created", createdAt: new Date() };
      state.runs.set(input.runId, run);
      return run;
    },
    async updateRunState(runId, status) {
      const run = state.runs.get(runId);
      const updated = { ...run, state: status };
      state.runs.set(runId, updated);
      return updated;
    },
    async updateRunSummary(runId, summary) {
      const run = state.runs.get(runId);
      state.runs.set(runId, { ...run, summary });
    },
    async appendRunEvent(event) {
      state.events.push(event);
      return { ...event, sequence: state.events.length, createdAt: new Date() };
    },
  };
}

test("reviewed node-test reproduces a seeded failure and records only redacted outcomes", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-command-check-"));
  try {
    const testPath = join(rootPath, "test", "seeded.test.mjs");
    await mkdir(join(rootPath, "test"));
    await writeFile(testPath, "import assert from 'node:assert/strict';\nassert.equal(1, 2, 'seeded bug marker');\n", "utf8");

    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const failed = await runReviewedCommand(persistence, approvedRoot, policy, "node-test");
    assert.equal(failed.status, "failed");
    assert.notEqual(failed.exitCode, 0);
    assert.equal(failed.run.state, "failed");
    assert.equal(Object.hasOwn(failed, "stdout"), false);
    assert.equal(JSON.stringify([...persistence.state.runs.values()]).includes("seeded bug marker"), false);
    assert.equal(JSON.stringify(persistence.state.events).includes("seeded bug marker"), false);

    await writeFile(testPath, "import assert from 'node:assert/strict';\nassert.equal(1, 1);\n", "utf8");
    const passed = await runReviewedCommand(persistence, approvedRoot, policy, "node-test");
    assert.equal(passed.status, "passed");
    assert.equal(passed.exitCode, 0);
    assert.equal(passed.run.state, "completed");
    assert.equal(persistence.state.events.some((event) => event.type === "run_finished"), true);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("reviewed command requires exact in-memory root approval and a fixed command id", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-command-unapproved-"));
  try {
    const policy = new WorkspacePathPolicy();
    const persistence = createPersistenceRecorder();
    await assert.rejects(
      runReviewedCommand(persistence, { path: rootPath }, policy, "node-test"),
      ReviewedCommandError,
    );
    const root = await policy.approveRoot(rootPath);
    await assert.rejects(
      runReviewedCommand(persistence, root, policy, "node -e arbitrary"),
      ReviewedCommandError,
    );
    assert.equal(persistence.state.runs.size, 0);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("approved TypeScript build invokes only the local compiler and records build status", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-typescript-build-"));
  const outsideBundle = join(rootPath, "..", `${basename(rootPath)}-outside.js`);
  try {
    await mkdir(join(rootPath, "src"));
    const compilerPath = join(rootPath, "node_modules", "typescript", "bin", "tsc");
    await mkdir(join(rootPath, "node_modules", "typescript", "bin"), { recursive: true });
    await writeFile(compilerPath, "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';\nif (process.argv.includes('--showConfig')) { console.log(JSON.stringify({ compilerOptions: JSON.parse(readFileSync('tsconfig.json', 'utf8')).compilerOptions })); } else { const config = JSON.parse(readFileSync('tsconfig.json', 'utf8')); if (config.failBuild) process.exit(9); if (config.delayBuild) setTimeout(() => {}, 30000); const output = process.argv[process.argv.indexOf('--outDir') + 1]; mkdirSync(output, { recursive: true }); writeFileSync(`${output}/build-marker.js`, 'built'); }\n", "utf8");
    await writeFile(join(rootPath, "src", "index.ts"), "export const marker = true;\n", "utf8");
    const escapingOutput = join(rootPath, "..", "outside-build-output");
    await writeFile(join(rootPath, "tsconfig.json"), JSON.stringify({ compilerOptions: { outDir: escapingOutput, declarationDir: escapingOutput, tsBuildInfoFile: join(escapingOutput, "build.tsbuildinfo") }, include: ["src/**/*.ts"] }));
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const fixtureBuildId = "123e4567-e89b-42d3-a456-426614174000";
    const stalePath = join(rootPath, `.taskforge-build-${fixtureBuildId}-stale1`);
    const activePath = join(rootPath, `.taskforge-build-${fixtureBuildId}-active1`);
    const mixedPath = join(rootPath, `.taskforge-build-${fixtureBuildId}-mixed1`);
    for (const [path, pid] of [[stalePath, 2147483647], [activePath, process.pid]]) {
      await mkdir(path);
      await writeFile(join(path, ".taskforge-owner.json"), JSON.stringify({ pid, directoryId: basename(path).slice(".taskforge-build-".length) }));
      await writeFile(join(path, "artifact.js"), "compiled");
      await utimes(path, new Date(Date.now() - 26 * 60 * 60 * 1_000), new Date(Date.now() - 26 * 60 * 60 * 1_000));
    }
    await mkdir(mixedPath);
    await writeFile(join(mixedPath, ".taskforge-owner.json"), JSON.stringify({ pid: 2147483647, directoryId: basename(mixedPath).slice(".taskforge-build-".length) }));
    await writeFile(join(mixedPath, "report.json"), JSON.stringify({ preserve: "user report" }));
    await utimes(mixedPath, new Date(Date.now() - 26 * 60 * 60 * 1_000), new Date(Date.now() - 26 * 60 * 60 * 1_000));
    const result = await runReviewedCommand(persistence, root, policy, "typescript-build");
    assert.equal(result.command, "typescript-build");
    assert.equal(result.status, "passed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.run.state, "completed");
    const outputDirectories = (await readdir(rootPath)).filter((entry) => entry.startsWith(".taskforge-build-"));
    assert.deepEqual(outputDirectories.sort(), [basename(activePath), basename(mixedPath)].sort());
    assert.equal((await readFile(join(activePath, "artifact.js"), "utf8")), "compiled");
    assert.deepEqual(JSON.parse(await readFile(join(mixedPath, "report.json"), "utf8")), { preserve: "user report" });
    assert.equal(JSON.stringify([...persistence.state.runs.values()]).includes("build-marker"), false);
    await writeFile(outsideBundle, "// outside target\n", "utf8");
    await writeFile(join(rootPath, "tsconfig.json"), JSON.stringify({ compilerOptions: { outFile: outsideBundle }, include: ["src/**/*.ts"] }));
    await assert.rejects(runReviewedCommand(persistence, root, policy, "typescript-build"), /does not support configured outFile/u);
    await writeFile(join(rootPath, "tsconfig.json"), JSON.stringify({ compilerOptions: { generateTrace: join(rootPath, "..", "outside-trace") }, include: ["src/**/*.ts"] }));
    await assert.rejects(runReviewedCommand(persistence, root, policy, "typescript-build"), /trace and CPU profile output/u);
    await writeFile(join(rootPath, "tsconfig.json"), JSON.stringify({ compilerOptions: {}, failBuild: true, include: ["src/**/*.ts"] }));
    const failedBuild = await runReviewedCommand(persistence, root, policy, "typescript-build");
    assert.equal(failedBuild.status, "failed");
    assert.deepEqual((await readdir(rootPath)).filter((entry) => entry.startsWith(".taskforge-build-")).sort(), [basename(activePath), basename(mixedPath)].sort());

    await assert.rejects(runReviewedCommand({ ...persistence, async saveRunSummary() { throw new Error("simulated persistence interruption"); } }, root, policy, "typescript-build"), /simulated persistence interruption/u);
    assert.deepEqual((await readdir(rootPath)).filter((entry) => entry.startsWith(".taskforge-build-")).sort(), [basename(activePath), basename(mixedPath)].sort());

    await writeFile(join(rootPath, "tsconfig.json"), JSON.stringify({ compilerOptions: {}, delayBuild: true, include: ["src/**/*.ts"] }));
    const cancellation = new AbortController();
    const pendingBuild = runReviewedCommand(persistence, root, policy, "typescript-build", undefined, cancellation.signal);
    setTimeout(() => cancellation.abort(), 500);
    const cancelledBuild = await pendingBuild;
    assert.equal(cancelledBuild.status, "cancelled");
    assert.deepEqual((await readdir(rootPath)).filter((entry) => entry.startsWith(".taskforge-build-")).sort(), [basename(activePath), basename(mixedPath)].sort());
  } finally {
    await rm(outsideBundle, { force: true });
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("selected Node test runs only the exact in-root file and rejects unsafe selections", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-selected-test-"));
  try {
    const testDirectory = join(rootPath, "test");
    await mkdir(testDirectory);
    await writeFile(join(testDirectory, "selected.test.mjs"), "import assert from 'node:assert/strict';\nassert.equal(2, 2);\n", "utf8");
    await writeFile(join(testDirectory, "unselected.test.mjs"), "import assert from 'node:assert/strict';\nassert.equal(1, 2, 'must not run');\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const result = await runReviewedCommand(persistence, root, policy, "node-test", "test/selected.test.mjs");
    assert.equal(result.command, "node-test-selected");
    assert.equal(result.status, "passed");
    assert.equal(result.run.state, "completed");
    assert.doesNotMatch(result.run.summary, /selected\.test\.mjs/u);
    for (const invalid of ["../outside.test.mjs", ".\\..\\outside.test.mjs", "test/missing.test.mjs", "test/data.json", join(testDirectory, "selected.test.mjs")]) {
      await assert.rejects(runReviewedCommand(persistence, root, policy, "node-test", invalid), ReviewedCommandError);
    }
    await assert.rejects(runReviewedCommand(persistence, root, policy, "typescript-check", "test/selected.test.mjs"), ReviewedCommandError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("selected Node test revalidates its path after approval and refuses a junction swap", async (context) => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-selected-race-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-selected-outside-"));
  const testDirectory = join(rootPath, "test");
  const selectedPath = join(testDirectory, "selected.test.mjs");
  const markerPath = join(outsidePath, "executed.txt");
  try {
    await mkdir(testDirectory);
    await writeFile(selectedPath, "import assert from 'node:assert/strict';\nassert.ok(true);\n", "utf8");
    await writeFile(join(outsidePath, "selected.test.mjs"), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(markerPath)}, 'escaped');\n`, "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const append = persistence.appendRunEvent.bind(persistence);
    let swapped = false;
    persistence.appendRunEvent = async (event) => {
      const saved = await append(event);
      if (!swapped && event.type === "step_started") {
        swapped = true;
        await rename(testDirectory, join(rootPath, "test-original"));
        try {
          await symlink(outsidePath, testDirectory, "junction");
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && ["EPERM", "EACCES"].includes(error.code)) {
            context.skip("Windows does not permit creating a test junction in this environment.");
            return saved;
          }
          throw error;
        }
      }
      return saved;
    };
    const result = await runReviewedCommand(persistence, root, policy, "node-test", "test/selected.test.mjs");
    assert.equal(result.status, "could_not_start");
    assert.equal(result.run.state, "failed");
    assert.equal(persistence.state.events.at(-1)?.type, "run_failed");
    await assert.rejects(import("node:fs/promises").then(({ access }) => access(markerPath)), (error) => error.code === "ENOENT");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
