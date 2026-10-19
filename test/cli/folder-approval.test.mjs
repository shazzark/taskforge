import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersistentFolderApprovalError, TaskForgeStorageUnavailableError } from "../../dist/cli/command-errors.js";
import { requirePersistentFolderApproval } from "../../dist/cli/folder-approval.js";
import { DatabasePersistenceError, DatabaseShutdownError } from "../../dist/storage/types.js";

async function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), "taskforge-folder-approval-"));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("storage connection failure remains distinct from a denied folder approval", async () => {
  await withTemporaryDirectory(async (directory) => {
    await assert.rejects(
      requirePersistentFolderApproval(directory, "read", async () => undefined),
      (error) => error instanceof TaskForgeStorageUnavailableError && !(error instanceof PersistentFolderApprovalError),
    );
  });
});

test("storage failures during the approval lookup are not classified as file denials", async () => {
  await withTemporaryDirectory(async (directory) => {
    for (const failure of [new DatabasePersistenceError("database query failed"), new DatabaseShutdownError()]) {
      await assert.rejects(
        requirePersistentFolderApproval(directory, "read", async () => { throw failure; }),
        (error) => error instanceof TaskForgeStorageUnavailableError && !(error instanceof PersistentFolderApprovalError),
      );
    }
  });
});

test("an available store with no matching grant is reported as an approval denial", async () => {
  await withTemporaryDirectory(async (directory) => {
    await assert.rejects(
      requirePersistentFolderApproval(directory, "read", async () => false),
      PersistentFolderApprovalError,
    );
  });
});

test("an active exact-scope grant passes the persistent approval check", async () => {
  await withTemporaryDirectory(async (directory) => {
    await assert.doesNotReject(requirePersistentFolderApproval(directory, "read", async () => true));
  });
});
