import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { PersistentFolderApprovalError, TaskForgeStorageUnavailableError } from "./command-errors.js";
import type { TaskForgeStore } from "../storage/store.js";
import { DatabasePersistenceError, DatabaseShutdownError } from "../storage/types.js";

export type WithTaskForgeStore = <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;

export async function requirePersistentFolderApproval(
  pathValue: string,
  access: "read" | "write",
  withStore: WithTaskForgeStore,
): Promise<void> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolve(pathValue));
  } catch {
    throw new PersistentFolderApprovalError();
  }

  let approved: boolean | undefined;
  try {
    approved = await withStore((store) => store.hasFolderApproval(canonicalPath, access));
  } catch (error: unknown) {
    if (error instanceof DatabasePersistenceError || error instanceof DatabaseShutdownError) {
      throw new TaskForgeStorageUnavailableError();
    }
    throw error;
  }
  if (approved === undefined) throw new TaskForgeStorageUnavailableError();
  if (!approved) throw new PersistentFolderApprovalError();
}
