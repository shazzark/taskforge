import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { GitDiffReviewError, listGitDiffFiles, readGitDiff } from "../dist/software/git-diff-review.js";

function git(rootPath, args) {
  execFileSync("git", args, { cwd: rootPath, stdio: "ignore", windowsHide: true });
}

test("Git diff review is root-bound, bounded, and redacts displayed credentials", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-git-diff-"));
  try {
    await mkdir(join(rootPath, "src"));
    const sourcePath = join(rootPath, "src", "change.ts");
    await writeFile(sourcePath, "export const ready = false;\n", "utf8");
    git(rootPath, ["init"]);
    git(rootPath, ["add", "src/change.ts"]);
    git(rootPath, ["-c", "user.name=TaskForge Test", "-c", "user.email=test@example.invalid", "commit", "-m", "seed"]);
    await writeFile(sourcePath, "export const ready = true;\nconst api_key = 'private-value';\n-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----\n", "utf8");
    git(rootPath, ["add", "src/change.ts"]);

    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const files = await listGitDiffFiles(root, policy);
    assert.deepEqual(files, ["src/change.ts"]);
    const review = await readGitDiff(root, policy, files);
    assert.match(review.diff, /ready = true/u);
    assert.equal(review.diff.includes("private-value"), false);
    assert.equal(review.diff.includes("private-key-material"), false);
    assert.match(review.diff, /REDACTED/u);
    await assert.rejects(readGitDiff(root, policy, []), GitDiffReviewError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("Git diff review refuses changes under protected secret paths", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-git-diff-deny-"));
  try {
    await writeFile(join(rootPath, "tracked.ts"), "export const ready = true;\n", "utf8");
    git(rootPath, ["init"]);
    git(rootPath, ["add", "tracked.ts"]);
    git(rootPath, ["-c", "user.name=TaskForge Test", "-c", "user.email=test@example.invalid", "commit", "-m", "seed"]);
    await writeFile(join(rootPath, ".env.local"), "secret=value\n", "utf8");
    git(rootPath, ["add", "-f", ".env.local"]);
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await assert.rejects(listGitDiffFiles(root, policy), GitDiffReviewError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
