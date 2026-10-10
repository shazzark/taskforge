import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { reviewSourceFiles, SourceReviewError } from "../dist/workflows/source-review-workflow.js";

test("source review reads only explicit approved files and redacts common credential patterns", async () => {
  const root = await mkdtemp(join(tmpdir(), "taskforge-source-review-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "sample.ts"), "const ready = true;\nconst api_key = 'private-value';\nconst token = 'gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';\n-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(root);
    const files = await reviewSourceFiles(approvedRoot, policy, ["src/sample.ts"]);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, "src\\sample.ts".replaceAll("\\", process.platform === "win32" ? "\\" : "/"));
    assert.equal(files[0]?.content.includes("private-value"), false);
    assert.equal(files[0]?.content.includes("gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ"), false);
    assert.equal(files[0]?.content.includes("private-key-material"), false);
    assert.match(files[0]?.content ?? "", /REDACTED/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source review rejects unapproved roots, secret paths, links, traversal, invalid UTF-8 and oversized selections", async () => {
  const root = await mkdtemp(join(tmpdir(), "taskforge-source-review-deny-"));
  const outside = await mkdtemp(join(tmpdir(), "taskforge-source-outside-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "ok.ts"), "export const ok = true;\n", "utf8");
    await writeFile(join(root, "src", "bad.ts"), Buffer.from([0xff, 0xfe]));
    await writeFile(join(root, "src", "nul.ts"), Buffer.from("const bad = '\u0000';", "utf8"));
    await writeFile(join(root, ".env.ts"), "const secret = 'x';\n", "utf8");
    await writeFile(join(outside, "outside.ts"), "export const outside = true;\n", "utf8");
    await symlink(outside, join(root, "src", "linked-dir"), process.platform === "win32" ? "junction" : "dir");
    const policy = new WorkspacePathPolicy();
    await assert.rejects(reviewSourceFiles({ path: root }, policy, ["src/ok.ts"]), SourceReviewError);
    const approvedRoot = await policy.approveRoot(root);
    for (const paths of [["../outside.ts"], [".env.ts"], ["src/linked-dir/outside.ts"], ["src/bad.ts"], ["src/nul.ts"], [], Array.from({ length: 21 }, () => "src/ok.ts")]) {
      await assert.rejects(reviewSourceFiles(approvedRoot, policy, paths), SourceReviewError);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
