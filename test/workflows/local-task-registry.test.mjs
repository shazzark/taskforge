import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BUILT_IN_TASKS, TaskRegistryError } from "../../dist/workflows/task-registry.js";
import {
  installLocalTaskDefinition,
  loadLocalTaskRegistry,
  MAX_LOCAL_TASK_DEFINITION_BYTES,
} from "../../dist/workflows/local-task-registry.js";

const originalLocalAppData = process.env["LOCALAPPDATA"];
const originalStorage = process.env["TASKFORGE_STORAGE"];

async function withIsolatedTaskForgeData(t, action) {
  const root = await mkdtemp(join(tmpdir(), "taskforge-local-task-registry-"));
  process.env["LOCALAPPDATA"] = root;
  process.env["TASKFORGE_STORAGE"] = "local";
  t.after(async () => {
    if (originalLocalAppData === undefined) delete process.env["LOCALAPPDATA"];
    else process.env["LOCALAPPDATA"] = originalLocalAppData;
    if (originalStorage === undefined) delete process.env["TASKFORGE_STORAGE"];
    else process.env["TASKFORGE_STORAGE"] = originalStorage;
    await rm(root, { recursive: true, force: true });
  });
  await action(root);
}

function localDefinition(id = "test-custom-task") {
  return {
    ...structuredClone(BUILT_IN_TASKS[0]),
    id,
    name: "Custom test task",
  };
}

test("local definitions install atomically, reload with built-ins, and reject duplicate ids", async (t) => {
  await withIsolatedTaskForgeData(t, async () => {
    const initial = await loadLocalTaskRegistry();
    assert.deepEqual(initial.definitions.map((definition) => definition.id), BUILT_IN_TASKS.map((definition) => definition.id));
    assert.equal(initial.fileCount, 0);

    const definition = await installLocalTaskDefinition(localDefinition());
    assert.equal(definition.id, "test-custom-task");
    const loaded = await loadLocalTaskRegistry();
    assert.equal(loaded.localDefinitionIds.has(definition.id), true);
    assert.equal(loaded.definitions.at(-1)?.id, definition.id);
    assert.deepEqual(loaded.invalidFiles, []);
    await assert.rejects(installLocalTaskDefinition(localDefinition()), TaskRegistryError);
  });
});

test("local registry rejects malformed, unsafe, oversized and built-in replacement definitions without echoing content", async (t) => {
  await withIsolatedTaskForgeData(t, async (root) => {
    const directory = join(root, "TaskForge", "task-definitions");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "malformed.json"), '{"private":"must-not-be-reported"', "utf8");
    await writeFile(join(directory, "unknown-tool.json"), JSON.stringify({ ...localDefinition("unknown-tool"), requiredTools: ["shell.exec"] }), "utf8");
    await writeFile(join(directory, "permission-field.json"), JSON.stringify({ ...localDefinition("permission-field"), permissions: ["write"] }), "utf8");
    await writeFile(join(directory, "csv-summary.json"), JSON.stringify(BUILT_IN_TASKS[0]), "utf8");
    await writeFile(join(directory, "oversized.json"), " ".repeat(MAX_LOCAL_TASK_DEFINITION_BYTES + 1), "utf8");

    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "escaped-task.json"), JSON.stringify(localDefinition("escaped-task")), "utf8");
    let symlinkCreated = false;
    try {
      await symlink(outside, join(directory, "escaped-task.json"), "junction");
      symlinkCreated = true;
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "ERROR_PRIVILEGE_NOT_HELD") throw error;
      t.diagnostic("Symlink creation is unavailable on this Windows account; other path and schema checks still ran.");
    }

    const snapshot = await loadLocalTaskRegistry();
    assert.equal(snapshot.definitions.some((definition) => definition.id === "csv-summary"), true);
    assert.equal(snapshot.localDefinitionIds.size, 0);
    assert.ok(snapshot.invalidFiles.length >= 4);
    if (symlinkCreated) assert.ok(snapshot.invalidFiles.some((entry) => entry.fileName === "escaped-task.json" && /regular file/u.test(entry.reason)));
    const report = JSON.stringify(snapshot.invalidFiles);
    assert.doesNotMatch(report, /must-not-be-reported/u);
    assert.match(report, /built-in|unsupported|64 KiB|regular file/u);
  });
});

test("registry discovery is non-recursive and applies the file-count and aggregate-size bounds", async (t) => {
  await withIsolatedTaskForgeData(t, async (root) => {
    const directory = join(root, "TaskForge", "task-definitions");
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(join(directory, "nested", "ignored.json"), JSON.stringify(localDefinition("ignored-task")), "utf8");
    for (let index = 0; index < 101; index += 1) {
      await writeFile(join(directory, `invalid-${String(index).padStart(3, "0")}.json`), "{}", "utf8");
    }
    const snapshot = await loadLocalTaskRegistry();
    assert.equal(snapshot.fileCount, 101);
    assert.equal(snapshot.localDefinitionIds.size, 0);
    assert.equal(snapshot.definitions.some((definition) => definition.id === "ignored-task"), false);
    assert.ok(snapshot.invalidFiles.some((entry) => /first 100/u.test(entry.reason)));

    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    for (let index = 0; index < 99; index += 1) {
      await writeFile(join(directory, `aggregate-${String(index).padStart(3, "0")}.json`), " ".repeat(11 * 1024), "utf8");
    }
    const aggregateBound = await loadLocalTaskRegistry();
    assert.ok(aggregateBound.invalidFiles.some((entry) => /1 MiB aggregate limit/u.test(entry.reason)));
  });
});

test("concurrent installs cannot exceed the registry file-count limit", async (t) => {
  await withIsolatedTaskForgeData(t, async (root) => {
    const directory = join(root, "TaskForge", "task-definitions");
    await mkdir(directory, { recursive: true });
    for (let index = 0; index < 99; index += 1) {
      await writeFile(join(directory, `occupied-${String(index).padStart(3, "0")}.json`), "{}", "utf8");
    }

    const results = await Promise.allSettled([
      installLocalTaskDefinition(localDefinition("concurrent-first")),
      installLocalTaskDefinition(localDefinition("concurrent-second")),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected?.status, "rejected");
    assert.ok(rejected.reason instanceof TaskRegistryError);
    const snapshot = await loadLocalTaskRegistry();
    assert.equal(snapshot.fileCount, 100);
  });
});

test("an existing registry install lock fails closed without changing files", async (t) => {
  await withIsolatedTaskForgeData(t, async (root) => {
    const directory = join(root, "TaskForge", "task-definitions");
    await mkdir(directory, { recursive: true });
    const lockPath = join(directory, ".install.lock");
    await writeFile(lockPath, "12345\n", "utf8");
    await assert.rejects(installLocalTaskDefinition(localDefinition()), /active, or a previous installation left a stale/u);
    assert.equal((await stat(lockPath)).isFile(), true);
    assert.deepEqual((await loadLocalTaskRegistry()).localDefinitionIds.size, 0);
  });
});

