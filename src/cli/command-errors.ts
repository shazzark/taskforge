export class PersistentFolderApprovalError extends Error {
  constructor() {
    super("No active persistent folder approval covers this path and access scope. Grant the exact folder scope with the permissions command.");
    this.name = "PersistentFolderApprovalError";
  }
}

export class TaskForgeStorageUnavailableError extends Error {
  constructor() {
    super("The selected TaskForge storage is unavailable.");
    this.name = "TaskForgeStorageUnavailableError";
  }
}
