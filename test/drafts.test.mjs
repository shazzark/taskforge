import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActionApprovalRegistry } from "../dist/security/approval-preview.js";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";
import { DraftArtifactError, parseLocalDraftInput, previewTextArtifact, renderLocalDraft, writeApprovedTextArtifact } from "../dist/artifacts/drafts.js";

test("local issue and email drafts render explicit local-only artifacts", () => {
  const issue = renderLocalDraft({
    kind: "github-issue",
    repository: "octocat/hello",
    sourceIssueUrl: "https://github.com/octocat/hello/issues/12",
    title: "Add fixture coverage",
    body: "Please add one regression case.",
  });
  assert.match(issue, /TaskForge GitHub Issue Draft/u);
  assert.match(issue, /Related issue: https:\/\/github\.com\/octocat\/hello\/issues\/12/u);
  assert.match(issue, /did not contact GitHub or publish it/u);
  const email = renderLocalDraft({ kind: "email", to: "team@example.test", subject: "Review", body: "Please review this draft." });
  assert.match(email, /To: team@example\.test/u);
  assert.match(email, /Subject: Review/u);
  assert.match(email, /did not contact an email service or send it/u);
});

test("draft input validation rejects mismatched issue links and header injection", () => {
  assert.throws(() => parseLocalDraftInput({
    kind: "github-issue", repository: "octocat/hello", sourceIssueUrl: "https://github.com/other/repo/issues/1", title: "Title", body: "Body",
  }), DraftArtifactError);
  assert.throws(() => parseLocalDraftInput({
    kind: "github-issue", repository: "octocat/hello", sourceIssueUrl: "https://secret@github.com/octocat/hello/issues/1", title: "Title", body: "Body",
  }), DraftArtifactError);
  assert.throws(() => parseLocalDraftInput({ kind: "email", to: "person@example.test\nBcc:other@example.test", subject: "Hello", body: "Body" }), DraftArtifactError);
  assert.throws(() => parseLocalDraftInput({ kind: "email", subject: "Hello\nBcc: x", body: "Body" }), DraftArtifactError);
  assert.throws(() => parseLocalDraftInput({ kind: "email", subject: "Hello", body: "" }), DraftArtifactError);
});

test("terminal control sequences in rendered content are escaped before preview display", async () => {
  const { escapeTerminalControls } = await import("../dist/security/terminal-text.js");
  const draft = renderLocalDraft({ kind: "email", subject: "Hello\u001b[2J", body: "Body\u0007" });
  const displayed = escapeTerminalControls(draft);
  assert.match(displayed, /\\u001b\[2J/u);
  assert.match(displayed, /\\u0007/u);
  assert.doesNotMatch(displayed, /\u001b|\u0007/u);
});

test("approved local draft output is create-only and verifies the written digest", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-draft-output-"));
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const approvals = new ActionApprovalRegistry(policy);
    const input = { kind: "email", subject: "Fixture", body: "Draft only." };
    const outputPath = join(rootPath, "email-draft.md");
    const pending = await previewTextArtifact(input, outputPath, root, policy, approvals);
    const approval = approvals.approve(pending.preview.previewId);
    const written = await writeApprovedTextArtifact(pending, approval, root, policy, approvals);
    const actual = await readFile(outputPath, "utf8");
    assert.equal(actual, pending.content);
    assert.equal(written.byteCount, Buffer.byteLength(actual, "utf8"));
    assert.equal(written.sha256, pending.digest);
    await assert.rejects(previewTextArtifact(input, outputPath, root, policy, approvals), DraftArtifactError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("draft output rejects stale and outside-root targets without overwriting", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-draft-stale-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-draft-outside-"));
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const approvals = new ActionApprovalRegistry(policy);
    const input = { kind: "github-issue", repository: "octocat/hello", title: "Title", body: "Body" };
    const outputPath = join(rootPath, "issue-draft.md");
    const pending = await previewTextArtifact(input, outputPath, root, policy, approvals);
    await writeFile(outputPath, "owner-created content", "utf8");
    const approval = approvals.approve(pending.preview.previewId);
    await assert.rejects(writeApprovedTextArtifact(pending, approval, root, policy, approvals), DraftArtifactError);
    await assert.rejects(previewTextArtifact(input, join(outsidePath, "issue-draft.md"), root, policy, approvals), DraftArtifactError);
    assert.equal(await readFile(outputPath, "utf8"), "owner-created content");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
