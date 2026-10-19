export class PersistentFolderApprovalError extends Error {
  constructor(access?: "read" | "write") {
    super(access === "read"
      ? "No saved read approval exists for this file's parent folder in the selected storage. The exact-file prompt is one-time approval and does not create a folder grant. To grant it explicitly, run: node dist/cli.js permissions approve --root \"<file-parent-folder>\" --access read (replace the placeholder with the file's parent folder and confirm the prompt)."
      : access === "write"
        ? "No saved write approval exists for this folder in the selected storage. Grant it explicitly with the permissions approve command and confirm the prompt."
        : "No active persistent folder approval covers this path and access scope. Grant the exact folder scope with the permissions command.");
    this.name = "PersistentFolderApprovalError";
  }
}

export class TaskForgeStorageUnavailableError extends Error {
  constructor() {
    super("The selected TaskForge storage is unavailable.");
    this.name = "TaskForgeStorageUnavailableError";
  }
}
