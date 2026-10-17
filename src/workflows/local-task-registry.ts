import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveTaskForgeDataDirectory } from "../config/configuration.js";
import {
  BUILT_IN_TASKS,
  TaskRegistryError,
  validateTaskDefinition,
  type TaskDefinition,
} from "./task-registry.js";

export const MAX_LOCAL_TASK_DEFINITION_BYTES = 64 * 1024;
const MAX_LOCAL_TASK_DEFINITION_FILES = 100;
const MAX_LOCAL_TASK_REGISTRY_BYTES = 1024 * 1024;
const REGISTRY_DIRECTORY_NAME = "task-definitions";

export interface InvalidLocalTaskDefinition {
  readonly fileName: string;
  readonly reason: string;
}

export interface LocalTaskRegistrySnapshot {
  readonly definitions: readonly TaskDefinition[];
  readonly localDefinitionIds: ReadonlySet<string>;
  readonly invalidFiles: readonly InvalidLocalTaskDefinition[];
  readonly totalBytes: number;
  readonly fileCount: number;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function safeFileName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, "?").slice(0, 128);
}

function registryDirectory(): string {
  return join(resolveTaskForgeDataDirectory(), REGISTRY_DIRECTORY_NAME);
}

async function resolveExistingRegistryDirectory(): Promise<string | undefined> {
  const directory = registryDirectory();
  try {
    const parentMetadata = await lstat(dirname(directory));
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new TaskRegistryError("The TaskForge data directory is not a regular directory.");
    }
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TaskRegistryError("The local task-definition directory is not a regular directory.");
    }
    const canonicalDirectory = await realpath(directory);
    const canonicalParent = await realpath(dirname(directory));
    if (dirname(canonicalDirectory) !== canonicalParent || canonicalDirectory !== resolve(canonicalParent, REGISTRY_DIRECTORY_NAME)) {
      throw new TaskRegistryError("The local task-definition directory escaped its data root.");
    }
    return canonicalDirectory;
  } catch (error: unknown) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function ensureRegistryDirectory(): Promise<string> {
  const directory = registryDirectory();
  await mkdir(dirname(directory), { recursive: true });
  const parentMetadata = await lstat(dirname(directory));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new TaskRegistryError("The TaskForge data directory is not a regular directory.");
  }
  const canonicalParent = await realpath(dirname(directory));
  await mkdir(directory, { recursive: false }).catch((error: unknown) => {
    if (!isRecordErrorCode(error, "EEXIST")) throw error;
  });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TaskRegistryError("The local task-definition directory is not a regular directory.");
  }
  const canonicalDirectory = await realpath(directory);
  if (dirname(canonicalDirectory) !== canonicalParent || canonicalDirectory !== resolve(canonicalParent, REGISTRY_DIRECTORY_NAME)) {
    throw new TaskRegistryError("The local task-definition directory escaped its data root.");
  }
  return canonicalDirectory;
}

function isRecordErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function readDefinitionFile(directory: string, fileName: string): Promise<TaskDefinition> {
  const path = join(directory, fileName);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TaskRegistryError("Definition entry is not a regular file.");
  }
  if (metadata.size > MAX_LOCAL_TASK_DEFINITION_BYTES) {
    throw new TaskRegistryError("Definition file exceeds the 64 KiB limit.");
  }
  const canonicalPath = await realpath(path);
  if (dirname(canonicalPath) !== directory || basename(canonicalPath) !== fileName) {
    throw new TaskRegistryError("Definition file escaped the local registry directory.");
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedMetadata = await file.stat();
    if (!openedMetadata.isFile() || openedMetadata.size > MAX_LOCAL_TASK_DEFINITION_BYTES || openedMetadata.size !== metadata.size) {
      throw new TaskRegistryError("Definition file changed or exceeds the 64 KiB limit.");
    }
    const bytes = await file.readFile();
    if (bytes.length > MAX_LOCAL_TASK_DEFINITION_BYTES) {
      throw new TaskRegistryError("Definition file exceeds the 64 KiB limit.");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new TaskRegistryError("Definition file is not valid UTF-8.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new TaskRegistryError("Definition file is not valid JSON.");
    }
    const definition = validateTaskDefinition(raw);
    if (`${definition.id}.json` !== fileName) {
      throw new TaskRegistryError("Definition filename must match its task id.");
    }
    return definition;
  } finally {
    await file.close();
  }
}

export async function loadLocalTaskRegistry(): Promise<LocalTaskRegistrySnapshot> {
  const directory = await resolveExistingRegistryDirectory();
  if (directory === undefined) {
    return { definitions: BUILT_IN_TASKS, localDefinitionIds: new Set(), invalidFiles: [], totalBytes: 0, fileCount: 0 };
  }
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.name.toLowerCase().endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const invalidFiles: InvalidLocalTaskDefinition[] = [];
  if (entries.length > MAX_LOCAL_TASK_DEFINITION_FILES) {
    invalidFiles.push({ fileName: "(registry)", reason: `Only the first ${MAX_LOCAL_TASK_DEFINITION_FILES} JSON files are considered.` });
  }
  const candidates: { readonly fileName: string; readonly definition: TaskDefinition }[] = [];
  let aggregateBytes = 0;
  for (const entry of entries.slice(0, MAX_LOCAL_TASK_DEFINITION_FILES)) {
    const fileName = safeFileName(entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      invalidFiles.push({ fileName, reason: "Entry is not a regular file." });
      continue;
    }
    try {
      const metadata = await lstat(join(directory, entry.name));
      aggregateBytes += metadata.size;
      if (aggregateBytes > MAX_LOCAL_TASK_REGISTRY_BYTES) {
        invalidFiles.push({ fileName, reason: "Registry exceeds the 1 MiB aggregate limit." });
        continue;
      }
      candidates.push({ fileName, definition: await readDefinitionFile(directory, entry.name) });
    } catch (error: unknown) {
      invalidFiles.push({
        fileName,
        reason: error instanceof TaskRegistryError ? error.message : "Definition could not be read safely.",
      });
    }
  }
  const idCounts = new Map<string, number>();
  for (const candidate of candidates) idCounts.set(candidate.definition.id, (idCounts.get(candidate.definition.id) ?? 0) + 1);
  const builtInIds = new Set(BUILT_IN_TASKS.map((definition) => definition.id));
  const accepted: TaskDefinition[] = [];
  const localDefinitionIds = new Set<string>();
  for (const candidate of candidates) {
    if (builtInIds.has(candidate.definition.id)) {
      invalidFiles.push({ fileName: candidate.fileName, reason: "Local definitions cannot replace a built-in task id." });
    } else if ((idCounts.get(candidate.definition.id) ?? 0) > 1) {
      invalidFiles.push({ fileName: candidate.fileName, reason: "Local task ids must be unique." });
    } else {
      accepted.push(candidate.definition);
      localDefinitionIds.add(candidate.definition.id);
    }
  }
  return {
    definitions: [...BUILT_IN_TASKS, ...accepted],
    localDefinitionIds,
    invalidFiles: invalidFiles.sort((left, right) => left.fileName.localeCompare(right.fileName, "en")),
    totalBytes: aggregateBytes,
    fileCount: entries.length,
  };
}

export async function validateLocalTaskDefinition(value: unknown): Promise<TaskDefinition> {
  const definition = validateTaskDefinition(value);
  if (BUILT_IN_TASKS.some((builtIn) => builtIn.id === definition.id)) {
    throw new TaskRegistryError("Local definitions cannot replace a built-in task id.");
  }
  const snapshot = await loadLocalTaskRegistry();
  if (snapshot.localDefinitionIds.has(definition.id)) {
    throw new TaskRegistryError("A local definition already uses this task id.");
  }
  return definition;
}

export async function installLocalTaskDefinition(value: unknown): Promise<TaskDefinition> {
  const definition = validateTaskDefinition(value);
  if (BUILT_IN_TASKS.some((builtIn) => builtIn.id === definition.id)) {
    throw new TaskRegistryError("Local definitions cannot replace a built-in task id.");
  }
  const directory = await ensureRegistryDirectory();
  const lockPath = join(directory, ".install.lock");
  const serialized = `${JSON.stringify(definition, null, 2)}\n`;
  const serializedBytes = Buffer.byteLength(serialized, "utf8");
  if (serializedBytes > MAX_LOCAL_TASK_DEFINITION_BYTES) throw new TaskRegistryError("Validated definition exceeds the 64 KiB file limit.");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error: unknown) {
    if (isRecordErrorCode(error, "EEXIST")) {
      throw new TaskRegistryError("Another task-definition installation is active, or a previous installation left a stale .install.lock file.");
    }
    throw new TaskRegistryError("Task registry could not be locked safely.");
  }
  const temporary = join(directory, `.install-${randomUUID()}.tmp`);
  try {
    await lock.writeFile(`${process.pid}\n`, "utf8");
    await lock.sync();
    const currentEntries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.name.toLowerCase().endsWith(".json"));
    if (currentEntries.length >= MAX_LOCAL_TASK_DEFINITION_FILES) {
      throw new TaskRegistryError(`Local registry is limited to ${MAX_LOCAL_TASK_DEFINITION_FILES} JSON files.`);
    }
    let totalBytes = 0;
    for (const entry of currentEntries) totalBytes += (await lstat(join(directory, entry.name))).size;
    if (totalBytes + serializedBytes > MAX_LOCAL_TASK_REGISTRY_BYTES) {
      throw new TaskRegistryError("Installing this definition would exceed the 1 MiB aggregate limit.");
    }
    if ((await loadLocalTaskRegistry()).localDefinitionIds.has(definition.id)) {
      throw new TaskRegistryError("A local definition already uses this task id.");
    }
    const destination = join(directory, `${definition.id}.json`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(serialized, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, destination);
    return definition;
  } catch (error: unknown) {
    if (error instanceof TaskRegistryError) throw error;
    if (isRecordErrorCode(error, "EEXIST")) throw new TaskRegistryError("A definition file with this task id already exists.");
    throw new TaskRegistryError("Task definition could not be installed safely.");
  } finally {
    await unlink(temporary).catch(() => undefined);
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

export function parseLocalTaskDefinitionText(text: string): TaskDefinition {
  if (Buffer.byteLength(text, "utf8") > MAX_LOCAL_TASK_DEFINITION_BYTES) {
    throw new TaskRegistryError("Definition file exceeds the 64 KiB limit.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TaskRegistryError("Definition file is not valid JSON.");
  }
  return validateTaskDefinition(raw);
}
