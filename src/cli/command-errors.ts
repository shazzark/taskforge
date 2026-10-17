export class PersistentFolderApprovalError extends Error {
  constructor() {
    super("No active persistent folder approval covers this path and access scope. Grant the exact folder scope with the permissions command.");
    this.name = "PersistentFolderApprovalError";
  }
}
