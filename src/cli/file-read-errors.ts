import { PersistentFolderApprovalError } from "./command-errors.js";
import { PathPolicyError } from "../security/path-policy.js";

export function formatApprovedFileReadError(error: unknown): string {
  if (error instanceof PersistentFolderApprovalError || error instanceof PathPolicyError) {
    return error.message;
  }
  return "The approved file could not be read safely.";
}
