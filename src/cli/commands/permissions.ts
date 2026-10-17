import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  DatabasePersistenceError,
  PersistenceInputError,
  type FolderApproval,
} from "../../storage/types.js";
import type { TaskForgeStore } from "../../storage/store.js";
import { PathPolicyError, WorkspacePathPolicy } from "../../security/path-policy.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";

export interface PermissionsCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
}

export async function runPermissionsCommand(
  commandArgs: readonly string[],
  dependencies: PermissionsCommandDependencies,
): Promise<void> {
  const action = commandArgs[0];
  if (action === "list" && (commandArgs.length === 1 || (commandArgs.length === 2 && commandArgs[1] === "--all"))) {
    let approvals: readonly FolderApproval[] | undefined;
    try {
      approvals = await dependencies.withStore((store) => store.listFolderApprovals(commandArgs[1] === "--all"));
    } catch (error: unknown) {
      const detail = error instanceof DatabasePersistenceError || error instanceof PersistenceInputError
        ? error.message
        : "the approval records could not be read safely";
      process.stderr.write(`Permission list failed: ${detail}.\n`);
      process.exitCode = 2;
      return;
    }
    if (approvals !== undefined) {
      if (approvals.length === 0) process.stdout.write("No folder approvals are stored.\n");
      for (const approval of approvals) process.stdout.write(`${approval.status} ${approval.access} ${escapeTerminalControls(approval.path)}\n`);
    }
    return;
  }
  if ((action !== "approve" && action !== "revoke") || commandArgs.length !== 5 || commandArgs[1] !== "--root" || commandArgs[3] !== "--access" ||
    (commandArgs[4] !== "read" && commandArgs[4] !== "write")) {
    process.stderr.write("Expected permissions list [--all], permissions approve --root <folder> --access <read|write>, or permissions revoke --root <folder> --access <read|write>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Folder permission changes require interactive confirmation.\n");
    process.exitCode = 2;
    return;
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolve(commandArgs[2] ?? ""));
    if (/[\u0000-\u001f\u007f]/u.test(canonicalRoot)) throw new Error("control character in directory path");
    if (!(await stat(canonicalRoot)).isDirectory()) throw new Error("not a directory");
    const validator = new WorkspacePathPolicy();
    await validator.approveRoot(canonicalRoot);
  } catch (error: unknown) {
    process.stderr.write(`Folder permission change rejected: ${error instanceof PathPolicyError ? error.message : "root must be an existing, non-sensitive directory"}\n`);
    process.exitCode = 2;
    return;
  }
  const access = commandArgs[4];
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(action === "approve"
      ? `Persist ${access} access for this exact folder and descendants?\n${escapeTerminalControls(canonicalRoot)}\nThis does not approve individual reads, writes, or actions. [y/N] `
      : `Revoke the persisted ${access} approval for this exact folder?\n${escapeTerminalControls(canonicalRoot)}\n[y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Folder permission change cancelled.\n");
    return;
  }
  let changed: boolean | undefined;
  try {
    changed = await dependencies.withStore(async (store) => action === "approve"
      ? (await store.grantFolderApproval(canonicalRoot, access), true)
      : store.revokeFolderApproval(canonicalRoot, access));
  } catch (error: unknown) {
    const detail = error instanceof DatabasePersistenceError || error instanceof PersistenceInputError
      ? error.message
      : "the approval change could not be stored safely";
    process.stderr.write(`Permission change failed: ${detail}.\n`);
    process.exitCode = 2;
    return;
  }
  if (changed === true) process.stdout.write(action === "approve" ? `Persisted ${access} approval for ${escapeTerminalControls(canonicalRoot)}.\n` : `Revoked ${access} approval for ${escapeTerminalControls(canonicalRoot)}.\n`);
  else if (action === "revoke" && changed === false) process.stdout.write("No active matching folder approval was found.\n");
}
