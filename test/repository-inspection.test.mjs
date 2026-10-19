import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { inspectRepository, RepositoryInspectionError } from "../dist/workflows/repository-inspection-workflow.js";

function createPersistenceRecorder() {
  const state = { events: [], summary: undefined, status: "created" };
  return {
    state,
    async saveRunSummary(input) {
      state.summary = input;
      return { ...input, state: "created", createdAt: new Date() };
    },
    async updateRunState(_runId, status) {
      state.status = status;
      return { ...state.summary, state: status, createdAt: new Date() };
    },
    async updateRunSummary(_runId, summary) {
      state.summary = { ...state.summary, summary };
    },
    async appendRunEvent(event) {
      state.events.push(event);
      return { ...event, sequence: state.events.length, createdAt: new Date() };
    },
  };
}

test("repository inspection inventories only the approved bounded root and persists metadata", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-repo-inspect-"));
  try {
    await mkdir(join(rootPath, "src"));
    await mkdir(join(rootPath, "test"));
    await mkdir(join(rootPath, "node_modules", "ignored"), { recursive: true });
    await mkdir(join(rootPath, ".git"));
    await writeFile(join(rootPath, "src", "index.ts"), "synthetic source content", "utf8");
    await writeFile(join(rootPath, "test", "index.spec.ts"), "synthetic test content", "utf8");
    await writeFile(join(rootPath, "README.md"), "synthetic readme", "utf8");
    await writeFile(join(rootPath, ".env"), "synthetic-secret-value", "utf8");
    await writeFile(join(rootPath, "node_modules", "ignored", "dependency.js"), "ignored", "utf8");
    await writeFile(join(rootPath, ".git", "config"), "ignored", "utf8");

    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const result = await inspectRepository(persistence, root, policy);

    assert.equal(result.inventory.fileCount, 3);
    assert.equal(result.inventory.sourceFileCount, 2);
    assert.equal(result.inventory.testFileCount, 1);
    assert.equal(result.inventory.deniedPathCount, 1);
    assert.equal(result.inventory.excludedDirectoryCount, 2);
    assert.deepEqual(result.inventory.excludedDirectoryCategories, [".git", "node_modules"]);
    assert.equal(result.inventory.filesByExtension[".ts"], 2);
    assert.equal(persistence.state.status, "completed");
    assert.equal(persistence.state.events.map((event) => event.type).join(","), "run_started,step_started,step_finished,run_finished");
    assert.equal(persistence.state.summary.summary.includes(rootPath), false);
    assert.equal(JSON.stringify(persistence.state.events).includes("index.ts"), false);
    assert.equal(JSON.stringify(persistence.state).includes("synthetic-secret-value"), false);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("repository inspection prunes known generated build roots before charging the directory budget", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-repo-build-exclusions-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-repo-outside-"));
  try {
    await mkdir(join(rootPath, "src"));
    await writeFile(join(rootPath, "src", "index.ts"), "synthetic source", "utf8");
    await mkdir(join(outsidePath, "outside"));
    await writeFile(join(outsidePath, "outside", "secret.ts"), "must not be inventoried", "utf8");

    for (let index = 0; index < 35; index += 1) {
      const buildRoot = join(rootPath, `.taskforge-build-legacy-${index}`);
      await mkdir(buildRoot);
      for (let childIndex = 0; childIndex < 10; childIndex += 1) {
        await mkdir(join(buildRoot, `generated-${childIndex}`));
      }
    }
    await symlink(join(outsidePath, "outside"), join(rootPath, ".taskforge-build-outside"), "junction");

    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const persistence = createPersistenceRecorder();
    const result = await inspectRepository(persistence, root, policy);

    assert.equal(result.inventory.fileCount, 1);
    assert.equal(result.inventory.directoryCount, 2);
    assert.equal(result.inventory.sourceFileCount, 1);
    assert.equal(result.inventory.excludedDirectoryCount, 35);
    assert.deepEqual(result.inventory.excludedDirectoryCategories, [".taskforge-build-*"]);
    assert.equal(result.inventory.skippedLinkCount, 1);
    assert.equal(result.inventory.filesByExtension[".ts"], 1);
    assert.match(persistence.state.summary.summary, /\.taskforge-build-\*/u);
    assert.match(persistence.state.summary.summary, /excluded subtree contents were not inspected/u);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test("repository inspection requires an in-memory approved root", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-repo-unapproved-"));
  try {
    const policy = new WorkspacePathPolicy();
    await assert.rejects(
      inspectRepository(createPersistenceRecorder(), { path: rootPath }, policy),
      RepositoryInspectionError,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
