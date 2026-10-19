import assert from "node:assert/strict";
import test from "node:test";
import { PersistentFolderApprovalError } from "../../dist/cli/command-errors.js";
import { formatApprovedFileReadError } from "../../dist/cli/file-read-errors.js";
import { PathPolicyError } from "../../dist/security/path-policy.js";

test("file-read output explains the separate saved folder grant", () => {
  const message = formatApprovedFileReadError(new PersistentFolderApprovalError("read"));
  assert.match(message, /exact-file prompt is one-time approval/u);
  assert.match(message, /permissions approve --root/u);
});

test("file-read output preserves path-policy reasons without exposing arbitrary errors", () => {
  assert.equal(formatApprovedFileReadError(new PathPolicyError("target_not_found")), "The requested file does not exist.");
  assert.equal(formatApprovedFileReadError(new Error("sensitive implementation detail")), "The approved file could not be read safely.");
});
