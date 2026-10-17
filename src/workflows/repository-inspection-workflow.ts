import { randomUUID } from "node:crypto";
import { opendir, realpath, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { RunSummary } from "../storage/types.js";
import type { TaskForgeStore } from "../storage/store.js";
import { PathPolicyError, type ApprovedRoot, type WorkspacePathPolicy } from "../security/path-policy.js";

const WORKFLOW_ID = "repository-inspect";
const STEP_ID = "inventory";
const MAX_FILES = 1_000;
const MAX_ENTRIES = 5_000;
const MAX_DIRECTORIES = 250;
const MAX_DEPTH = 12;
const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".jsx", ".mjs", ".mts",
  ".php", ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".ts", ".tsx", ".cts", ".yaml", ".yml",
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage", ".next", ".venv", "venv", "target",
]);

export class RepositoryInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryInspectionError";
  }
}

export interface RepositoryInventory {
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly sourceFileCount: number;
  readonly testFileCount: number;
  readonly skippedLinkCount: number;
  readonly deniedPathCount: number;
  readonly filesByExtension: Readonly<Record<string, number>>;
}

export interface RepositoryInspectionResult {
  readonly run: RunSummary;
  readonly inventory: RepositoryInventory;
}

type Persistence = Pick<TaskForgeStore, "saveRunSummary" | "updateRunState" | "appendRunEvent" | "updateRunSummary">;

function isDeniedPath(error: unknown): boolean {
  return error instanceof PathPolicyError && error.kind === "secret_denied";
}

function isSourceFile(extension: string): boolean {
  return SOURCE_EXTENSIONS.has(extension);
}

function isTestFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name.includes("test") || name.includes("spec") || name === "pytest.ini";
}

function fileExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/u.test(extension) ? extension : "[other]";
}

async function collectInventory(
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
): Promise<RepositoryInventory> {
  const approvedRoot = resolve(root.path);
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === approvedRoot)) {
    throw new RepositoryInspectionError("Repository root approval is required before inspection.");
  }

  const filesByExtension: Record<string, number> = {};
  const pending: Array<{ readonly path: string; readonly depth: number }> = [{ path: approvedRoot, depth: 0 }];
  let fileCount = 0;
  let directoryCount = 0;
  let sourceFileCount = 0;
  let testFileCount = 0;
  let skippedLinkCount = 0;
  let deniedPathCount = 0;
  let entryCount = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) continue;
    if (directory.depth > MAX_DEPTH) {
      throw new RepositoryInspectionError("Repository exceeds the supported directory depth limit.");
    }
    let entries;
    try {
      const authorized = await policy.authorizePath(directory.path, "read");
      const canonicalPath = await realpath(authorized.path);
      if (canonicalPath !== authorized.path) throw new RepositoryInspectionError("Repository path changed during inspection.");
      const directoryHandle = await opendir(canonicalPath);
      entries = [];
      for await (const entry of directoryHandle) {
        entryCount += 1;
        if (entryCount > MAX_ENTRIES) {
          throw new RepositoryInspectionError("Repository exceeds the supported directory-entry limit.");
        }
        entries.push(entry);
      }
    } catch (error: unknown) {
      if (isDeniedPath(error)) {
        deniedPathCount += 1;
        continue;
      }
      if (error instanceof RepositoryInspectionError) throw error;
      throw new RepositoryInspectionError("A repository directory could not be inspected safely.");
    }

    directoryCount += 1;
    if (directoryCount > MAX_DIRECTORIES) {
      throw new RepositoryInspectionError("Repository exceeds the supported directory count limit.");
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const candidate = join(directory.path, entry.name);
      if (entry.isSymbolicLink()) {
        skippedLinkCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) {
          if (directoryCount + pending.length + 1 > MAX_DIRECTORIES) {
            throw new RepositoryInspectionError("Repository exceeds the supported directory count limit.");
          }
          pending.push({ path: candidate, depth: directory.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const authorized = await policy.authorizePath(candidate, "read");
        const canonicalPath = await realpath(authorized.path);
        if (canonicalPath !== authorized.path) throw new RepositoryInspectionError("Repository file changed during inspection.");
        const metadata = await stat(canonicalPath);
        if (!metadata.isFile()) continue;
      } catch (error: unknown) {
        if (isDeniedPath(error)) {
          deniedPathCount += 1;
          continue;
        }
        if (error instanceof RepositoryInspectionError) throw error;
        throw new RepositoryInspectionError("A repository file could not be inspected safely.");
      }

      fileCount += 1;
      if (fileCount > MAX_FILES) {
        throw new RepositoryInspectionError("Repository exceeds the supported file count limit.");
      }
      const extension = fileExtension(entry.name);
      filesByExtension[extension] = (filesByExtension[extension] ?? 0) + 1;
      if (isSourceFile(extension)) sourceFileCount += 1;
      if (isTestFile(entry.name)) testFileCount += 1;
    }
  }

  return { fileCount, directoryCount, sourceFileCount, testFileCount, skippedLinkCount, deniedPathCount, filesByExtension };
}

function summarize(inventory: RepositoryInventory): string {
  return `Repository inventory complete: ${inventory.fileCount} files; ${inventory.sourceFileCount} source files; ${inventory.testFileCount} test-named files; ${inventory.skippedLinkCount} links skipped.`;
}

export async function inspectRepository(
  store: Persistence,
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
): Promise<RepositoryInspectionResult> {
  let inventory: RepositoryInventory;
  try {
    inventory = await collectInventory(root, policy);
  } catch (error: unknown) {
    if (error instanceof RepositoryInspectionError) throw error;
    throw new RepositoryInspectionError("Repository inventory failed safely.");
  }

  const runId = randomUUID();
  const run = await store.saveRunSummary({
    runId,
    workflowId: WORKFLOW_ID,
    summary: "Repository inventory started; file contents and paths are not persisted.",
  });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_started", stepId: STEP_ID });
  await store.updateRunSummary(runId, summarize(inventory));
  const completed = await store.updateRunState(runId, "completed");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished", stepId: STEP_ID });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_finished" });
  return { run: completed, inventory };
}
