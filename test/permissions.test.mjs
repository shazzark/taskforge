import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActionApprovalRegistry, ApprovalError } from "../dist/security/approval-preview.js";
import { PathPolicyError, WorkspacePathPolicy } from "../dist/security/path-policy.js";

async function withTemporaryFolders(run) {
  const parent = await mkdtemp(join(tmpdir(), "taskforge-permissions-"));
  const approved = join(parent, "approved");
  const outside = join(parent, "outside");
  await mkdir(approved);
  await mkdir(outside);
  try {
    await run({ parent, approved, outside });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("approved-root policy allows contained files and rejects unapproved paths", async () => {
  await withTemporaryFolders(async ({ approved, outside }) => {
    const containedFile = join(approved, "notes.txt");
    await writeFile(containedFile, "safe fixture");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(approved);
    assert.equal(root.path, approved);
    assert.equal((await policy.authorizePath(containedFile, "read")).path, containedFile);
    assert.equal((await policy.authorizePath(join(approved, "new.txt"), "write")).exists, false);
    await assert.rejects(policy.authorizePath(join(containedFile, "child.txt"), "write"), (error) => error.kind === "path_unavailable");
    await assert.rejects(policy.authorizePath(join(outside, "private.txt"), "read"), (error) => error.kind === "not_approved");
    await assert.rejects(policy.authorizePath(join(approved, "..", "outside", "private.txt"), "write"), (error) => error.kind === "not_approved");
    assert.equal(policy.listApprovedRoots().length, 1);
  });
});

test("secret-file rules deny credentials while allowing the placeholder example", async () => {
  await withTemporaryFolders(async ({ approved }) => {
    await writeFile(join(approved, ".env.example"), "TASKFORGE_KEY=placeholder\n");
    const policy = new WorkspacePathPolicy();
    await policy.approveRoot(approved);
    assert.equal((await policy.authorizePath(join(approved, ".env.example"), "read")).exists, true);
    for (const name of [".env", ".env.production", ".npmrc", "id_ed25519", "private.pem", "credentials.json"]) {
      await assert.rejects(policy.authorizePath(join(approved, name), "read"), (error) => error instanceof PathPolicyError && error.kind === "secret_denied");
    }
  });
});

test("symlink and junction escapes resolve outside the approved root and are rejected", async (context) => {
  await withTemporaryFolders(async ({ approved, outside }) => {
    const outsideFile = join(outside, "outside.txt");
    await writeFile(outsideFile, "outside fixture");
    const junction = join(approved, "linked-outside");
    try {
      await symlink(outside, junction, "junction");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && ["EPERM", "EACCES"].includes(error.code)) {
        context.skip("Windows does not permit creating the test junction in this environment.");
        return;
      }
      throw error;
    }
    const policy = new WorkspacePathPolicy();
    await policy.approveRoot(approved);
    await assert.rejects(policy.authorizePath(join(junction, "outside.txt"), "read"), (error) => error.kind === "not_approved");
  });
});

test("approval previews bind planned write content and reject a changed target", async () => {
  await withTemporaryFolders(async ({ approved }) => {
    const policy = new WorkspacePathPolicy();
    await policy.approveRoot(approved);
    const registry = new ActionApprovalRegistry(policy);
    const targetPath = join(approved, "report.txt");
    const preview = await registry.preview({ kind: "write", targetPath, content: "planned report" });
    assert.equal(preview.targetExists, false);
    const approval = registry.approve(preview.previewId);
    assert.equal((await registry.revalidate(approval)).previewId, preview.previewId);
    await writeFile(targetPath, "unapproved content");
    await assert.rejects(registry.revalidate(approval), (error) => error instanceof ApprovalError && error.kind === "stale_preview");
    await assert.rejects(registry.revalidate(approval), (error) => error.kind === "unknown_preview");
  });
});

test("approval preview detects source changes and rejects missing approval", async () => {
  await withTemporaryFolders(async ({ approved }) => {
    const sourcePath = join(approved, "source.txt");
    const targetPath = join(approved, "moved.txt");
    await writeFile(sourcePath, "original content");
    const policy = new WorkspacePathPolicy();
    await policy.approveRoot(approved);
    const registry = new ActionApprovalRegistry(policy);
    const preview = await registry.preview({ kind: "move", sourcePath, targetPath });
    await assert.rejects(registry.revalidate({ previewId: preview.previewId, digest: "tampered" }), (error) => error.kind === "unknown_preview");
    const approval = registry.approve(preview.previewId);
    await writeFile(sourcePath, "changed content");
    await assert.rejects(registry.revalidate(approval), (error) => error instanceof ApprovalError && error.kind === "stale_preview");
  });
});

test("approval preview invalidates when an approved target is replaced by an escape", async (context) => {
  await withTemporaryFolders(async ({ approved, outside }) => {
    const targetDirectory = join(approved, "target-dir");
    await mkdir(targetDirectory);
    const target = join(targetDirectory, "target.txt");
    await writeFile(target, "inside");
    await writeFile(join(outside, "target.txt"), "outside");
    const policy = new WorkspacePathPolicy();
    await policy.approveRoot(approved);
    const registry = new ActionApprovalRegistry(policy);
    const preview = await registry.preview({ kind: "write", targetPath: target, content: "replacement" });
    const approval = registry.approve(preview.previewId);
    await rm(targetDirectory, { recursive: true, force: true });
    try {
      await symlink(outside, targetDirectory, "junction");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && ["EPERM", "EACCES"].includes(error.code)) {
        context.skip("Windows does not permit creating the test symlink in this environment.");
        return;
      }
      throw error;
    }
    await assert.rejects(registry.revalidate(approval), (error) => error instanceof ApprovalError && error.kind === "stale_preview");
  });
});

test("preview rejects secret targets, oversized payloads, and directories", async () => {
  await withTemporaryFolders(async ({ approved }) => {
    const directory = join(approved, "directory");
    await mkdir(directory);
    const policy = new WorkspacePathPolicy();
    await policy.approveRoot(approved);
    const registry = new ActionApprovalRegistry(policy);
    await assert.rejects(registry.preview({ kind: "write", targetPath: join(approved, ".env.local"), content: "secret" }), (error) => error.kind === "secret_denied");
    await assert.rejects(registry.preview({ kind: "write", targetPath: join(approved, "large.txt"), content: "x".repeat(8 * 1024 * 1024 + 1) }), ApprovalError);
    await assert.rejects(registry.preview({ kind: "move", sourcePath: directory, targetPath: join(approved, "directory-copy") }), (error) => error.kind === "unsupported_target");
  });
});
