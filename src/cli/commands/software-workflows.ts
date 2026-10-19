import { realpath } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ConfigurationError, loadProviderConfiguration } from "../../config/configuration.js";
import { runToolLoop } from "../../agent/tool-loop.js";
import { createPatchProposalTool } from "../../agent/session-tools.js";
import type { TaskForgeStore } from "../../storage/store.js";
import { createModelProvider } from "../../providers/create-provider.js";
import { ModelProviderError } from "../../providers/types.js";
import { PathPolicyError, WorkspacePathPolicy } from "../../security/path-policy.js";
import { runReviewedCommand, validateSelectedNodeTestPath, type ReviewedCommandId, ReviewedCommandError } from "../../tools/software/reviewed-command.js";
import { redactSourceForDisplay, reviewSourceFiles, SourceReviewError } from "../../workflows/source-review-workflow.js";
import { ActionApprovalRegistry, ApprovalError } from "../../security/approval-preview.js";
import { prepareFilePatch, prepareGeneratedFilePatch, applyPreparedFilePatch, PatchApplicationError } from "../../tools/software/patch-application.js";
import { GitDiffReviewError, listGitDiffFiles, readGitDiff } from "../../tools/software/git-diff-review.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";
import { PersistentFolderApprovalError } from "../command-errors.js";

export interface SoftwareCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
  readonly requirePersistentFolderApproval: (pathValue: string, access: "read" | "write") => Promise<void>;
}export async function runSoftwareCheckCommand(commandArgs: readonly string[], dependencies: SoftwareCommandDependencies): Promise<void> {
  const rootValue = commandArgs[1];
  const checkValue = commandArgs[3];
  const selectedTestFile = commandArgs.length === 6 && commandArgs[4] === "--test" ? commandArgs[5] : undefined;
  if (
    (commandArgs.length !== 4 && selectedTestFile === undefined) || commandArgs[0] !== "--root" || rootValue === undefined ||
    rootValue.trim().length === 0 || commandArgs[2] !== "--check" ||
    (checkValue !== "node-test" && checkValue !== "typescript-check" && checkValue !== "typescript-build") ||
    (selectedTestFile !== undefined && checkValue !== "node-test")
  ) {
    process.stderr.write("Expected --root <directory> --check <node-test|typescript-check|typescript-build> [--test <relative-file for node-test>].\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Software checks require an interactive terminal for explicit approval.\n");
    process.exitCode = 2;
    return;
  }

  const requestedRoot = resolve(rootValue);
  const command: ReviewedCommandId = checkValue;
  const rootConsent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await rootConsent.question(`Allow TaskForge to run a reviewed check in this exact repository root? ${requestedRoot} [y/N] `);
  } finally {
    rootConsent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("Software check cancelled before repository access.\n");
    return;
  }

  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(requestedRoot);
    await dependencies.requirePersistentFolderApproval(approvedRoot.path, "write");
    const commandLabel = command === "node-test"
      ? selectedTestFile === undefined
        ? "node --test (runs the repository test code)"
        : `node --test for ${escapeTerminalControls(selectedTestFile)} (runs that repository test file)`
      : command === "typescript-check" ? "local TypeScript compiler --noEmit" : "local TypeScript compiler build (temporary output is removed after the check; configured outFile is rejected)";
    const commandConsent = createInterface({ input: process.stdin, output: process.stdout });
    let commandAnswer: string;
    try {
      commandAnswer = await commandConsent.question(`Run ${commandLabel} in the approved root? This executes repository code that may read or write files or cause side effects; no OS sandbox is provided. [y/N] `);
    } finally {
      commandConsent.close();
    }
    if (commandAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Software check cancelled before command execution.\n");
      return;
    }

    const controller = new AbortController();
    const handleInterrupt = (): void => controller.abort();
    process.once("SIGINT", handleInterrupt);
    let result: Awaited<ReturnType<typeof runReviewedCommand>> | undefined;
    try {
      result = await dependencies.withStore((store) => runReviewedCommand(store, approvedRoot, policy, command, selectedTestFile, controller.signal));
    } finally {
      process.removeListener("SIGINT", handleInterrupt);
    }
    if (result !== undefined) {
      process.stdout.write(
        `Run ${result.run.runId} ${result.status}: ${result.command}; ` +
        `exit=${result.exitCode === null ? "unavailable" : result.exitCode}; ` +
        `duration=${result.durationMs}ms; observed output bytes=${result.observedOutputBytes}` +
        `${result.outputTruncated ? " (capture limit reached)" : ""}. Output was not displayed or persisted.\n`,
      );
      if (result.status === "cancelled") process.exitCode = 130;
      else if (result.status !== "passed") process.exitCode = 3;
    }
  } catch (error: unknown) {
    const message = error instanceof ReviewedCommandError || error instanceof PersistentFolderApprovalError ? error.message : "Software check failed safely.";
    process.stderr.write(`Software check failed: ${message}\n`);
    process.exitCode = 3;
  }
}

export async function runFilePatchCommand(commandArgs: readonly string[], dependencies: SoftwareCommandDependencies): Promise<void> {
  if (
    commandArgs.length !== 6 || commandArgs[0] !== "--root" || commandArgs[1] === undefined ||
    commandArgs[2] !== "--target" || commandArgs[3] === undefined ||
    commandArgs[4] !== "--content-file" || commandArgs[5] === undefined
  ) {
    process.stderr.write("Expected --root <directory> --target <relative-path> --content-file <relative-path>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("File patching requires an interactive terminal for exact root, file-set and write approval.\n");
    process.exitCode = 2;
    return;
  }
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(commandArgs[1]));
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const targetRelativePath = commandArgs[3];
  const contentRelativePath = commandArgs[5];
  const rootConsent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await rootConsent.question(
      `Review a replacement for this exact target?\nRoot: ${rootPath}\nTarget: ${targetRelativePath}\nReplacement content file: ${contentRelativePath}\nSource stays local; redaction is heuristic. [y/N] `,
    );
  } finally {
    rootConsent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("File patch cancelled before access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(rootPath);
    await dependencies.requirePersistentFolderApproval(approvedRoot.path, "read");
    await dependencies.requirePersistentFolderApproval(approvedRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const prepared = await prepareFilePatch(approvedRoot, policy, approvals, targetRelativePath, contentRelativePath);
    const currentFiles = await reviewSourceFiles(approvedRoot, policy, [targetRelativePath]);
    const current = currentFiles[0];
    if (current === undefined) throw new PatchApplicationError();
    process.stdout.write(`\n--- CURRENT ${current.path} (${current.byteCount} bytes) ---\n${current.content}\n`);
    process.stdout.write(`\n--- REPLACEMENT ${contentRelativePath} (SHA-256 ${prepared.sha256}) ---\n${redactSourceForDisplay(prepared.content)}\n`);
    const patchConsent = createInterface({ input: process.stdin, output: process.stdout });
    let patchAnswer: string;
    try {
      patchAnswer = await patchConsent.question(
        `Apply this exact replacement to ${prepared.preview.targetPath}? The target will be revalidated before write. [y/N] `,
      );
    } finally {
      patchConsent.close();
    }
    if (patchAnswer.trim().toLowerCase() !== "y") {
      approvals.discard(prepared.preview.previewId);
      process.stdout.write("File patch cancelled before writing.\n");
      return;
    }
    const approval = approvals.approve(prepared.preview.previewId);
    await applyPreparedFilePatch(prepared, approval, approvals);
    process.stdout.write(`Replacement applied to ${prepared.preview.targetPath}. Run a reviewed check to verify it.\n`);
  } catch (error: unknown) {
    const message = error instanceof PatchApplicationError || error instanceof PersistentFolderApprovalError ? error.message : "File patch failed safely.";
    process.stderr.write(`File patch failed: ${message}\n`);
    process.exitCode = 3;
  }
}

export async function runAgentFixCommand(commandArgs: readonly string[], dependencies: SoftwareCommandDependencies): Promise<void> {
  const values = new Map<string, string>();
  for (let index = 0; index < commandArgs.length;) {
    const key = commandArgs[index];
    const value = commandArgs[index + 1];
    if ((key !== "--root" && key !== "--target" && key !== "--goal" && key !== "--test") ||
        value === undefined || values.has(key)) {
      process.stderr.write("Expected --root <directory> --target <relative-source-file> --goal <instruction> --test <relative-test-file>.\n");
      process.exitCode = 1;
      return;
    }
    values.set(key, value);
    index += 2;
  }
  const rootValue = values.get("--root");
  const target = values.get("--target");
  const goal = values.get("--goal");
  const testFile = values.get("--test");
  if (values.size !== 4 || rootValue === undefined || target === undefined || goal === undefined || testFile === undefined ||
      goal.trim().length === 0 || Buffer.byteLength(goal, "utf8") > 2_000) {
    process.stderr.write("Provide a root, one relative source target, a goal up to 2,000 bytes, and one relative Node test file.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Agent fixes require an interactive terminal for source transfer, patch, and check approval.\n");
    process.exitCode = 2;
    return;
  }

  let rootPath: string;
  let providerConfiguration;
  try {
    rootPath = await realpath(resolve(rootValue));
    providerConfiguration = loadProviderConfiguration();
  } catch (error: unknown) {
    process.stderr.write(error instanceof ConfigurationError ? `Agent fix setup error: ${error.message}\n` : "The approved repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Investigate this project using the selected evidence?\nRoot: ${escapeTerminalControls(rootPath)}\nSource evidence: ${escapeTerminalControls(target)}\nGoal: ${escapeTerminalControls(goal)}\nRelated test evidence: ${escapeTerminalControls(testFile)}\nTaskForge collects only these two files as model evidence. Approving either test run executes repository code that may read or write other files or cause side effects; no OS sandbox is provided. The selected source and test may be sent after a separate provider-transfer approval. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Agent fix cancelled before repository access.\n");
    return;
  }

  const controller = new AbortController();
  const handleInterrupt = (): void => controller.abort();
  process.once("SIGINT", handleInterrupt);
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await dependencies.requirePersistentFolderApproval(root.path, "read");
    await dependencies.requirePersistentFolderApproval(root.path, "write");
    const selectedTest = await validateSelectedNodeTestPath(root, policy, testFile);
    const targetPath = resolve(root.path, target);
    const targetIsTest = process.platform === "win32"
      ? targetPath.toLowerCase() === selectedTest.canonicalPath.toLowerCase()
      : targetPath === selectedTest.canonicalPath;
    if (targetIsTest) throw new ReviewedCommandError("The patch target and verification test must be different files.");
    const baselineConsent = createInterface({ input: process.stdin, output: process.stdout });
    let baselineAnswer: string;
    try {
      baselineAnswer = await baselineConsent.question(`Run this exact selected test as baseline investigation evidence? ${escapeTerminalControls(testFile)}. It may execute repository code; output will not be displayed or persisted. [y/N] `);
    } finally {
      baselineConsent.close();
    }
    if (baselineAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Agent investigation cancelled before test execution.\n");
      return;
    }
    const baseline = await dependencies.withStore((store) =>
      runReviewedCommand(store, root, policy, "node-test", testFile, controller.signal),
    );
    if (baseline === undefined) return;
    process.stdout.write(
      `Baseline evidence: selected test ${baseline.status}; exit=${baseline.exitCode === null ? "unavailable" : baseline.exitCode}; ` +
      `observed output bytes=${baseline.observedOutputBytes}${baseline.outputTruncated ? " (capture limit reached)" : ""}. Output was not displayed or persisted.\n`,
    );
    const files = await reviewSourceFiles(root, policy, [target, testFile]);
    const file = files[0];
    const testEvidence = files[1];
    if (file === undefined || testEvidence === undefined || file.content.includes("[REDACTED:") || testEvidence.content.includes("[REDACTED:")) {
      throw new SourceReviewError("The selected source or test contains redacted credential-like text; generated replacement is refused to avoid copying or relying on hidden material.");
    }
    const baselineText = `Selected test baseline status: ${baseline.status}; exit code: ${baseline.exitCode === null ? "unavailable" : baseline.exitCode}; observed output bytes: ${baseline.observedOutputBytes}; output text withheld.`;
    const transferText = `${file.path}\n${file.content}\n\nRelated test evidence: ${testEvidence.path}\n${testEvidence.content}\n\n${baselineText}\n\nGoal: ${goal}`;
    if (Buffer.byteLength(transferText, "utf8") > 24 * 1024) throw new SourceReviewError("The selected source, test evidence, and goal exceed the 24 KiB model-input limit.");
    process.stdout.write(`\n--- REDACTED SOURCE ${escapeTerminalControls(file.path)} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${escapeTerminalControls(file.content)}\n`);
    process.stdout.write(`\n--- REDACTED TEST EVIDENCE ${escapeTerminalControls(testEvidence.path)} (${testEvidence.byteCount} bytes, ${testEvidence.lineCount} lines) ---\n${escapeTerminalControls(testEvidence.content)}\n`);
    const provider = createModelProvider(providerConfiguration);
    const transferConsent = createInterface({ input: process.stdin, output: process.stdout });
    let transferAnswer: string;
    try {
      transferAnswer = await transferConsent.question(`Send these exact redacted source and test excerpts plus the baseline test status and goal to ${providerConfiguration.kind} (${provider.model}) to investigate and generate a full-file replacement? Redaction can miss secrets. The model has only a replacement-proposal tool; it cannot read files, run commands, or write. [y/N] `);
    } finally {
      transferConsent.close();
    }
    if (transferAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Agent fix cancelled before provider transfer.\n");
      return;
    }

    let replacement: string | undefined;
    const result = await runToolLoop(
      provider.provider,
      provider.model,
      [
        { role: "system", content: "You are TaskForge's code investigator and change proposer. Use only the explicitly selected source and test excerpts and the bounded baseline status as evidence. You may only call propose_replacement with a complete replacement for the single supplied source file. Do not claim changes were applied or tests run. If the evidence is insufficient or the request is unclear, explain the limitation without calling the tool. Preserve unrelated behavior and avoid adding dependencies or permission expansion." },
        { role: "user", content: `Target: ${file.path}\nGoal: ${goal}\nCurrent redacted source:\n${file.content}\n\nSelected test evidence: ${testEvidence.path}\n${testEvidence.content}\n\n${baselineText}` },
      ],
      [createPatchProposalTool((value) => { replacement = value; })],
      { maxModelRequests: 8, maxToolActions: 1, signal: controller.signal },
    );
    if (replacement === undefined) {
      if (result.content.length > 0) process.stdout.write(`TaskForge> ${escapeTerminalControls(result.content)}\n`);
      process.stdout.write("No replacement preview was generated; the target was not changed.\n");
      return;
    }
    if (redactSourceForDisplay(replacement) !== replacement) {
      throw new PatchApplicationError("The generated replacement contains credential-like text that would be hidden in the review; candidate refused.");
    }
    const approvals = new ActionApprovalRegistry(policy);
    const prepared = await prepareGeneratedFilePatch(root, policy, approvals, target, replacement);
    const current = await reviewSourceFiles(root, policy, [target]);
    const currentFile = current[0];
    if (currentFile === undefined || currentFile.content.includes("[REDACTED:")) {
      approvals.discard(prepared.preview.previewId);
      throw new SourceReviewError("The target changed or contains credential-like text; generated preview discarded.");
    }
    process.stdout.write(`\n--- CURRENT ${escapeTerminalControls(currentFile.path)} (SHA-256 of replacement ${prepared.sha256}) ---\n${escapeTerminalControls(currentFile.content)}\n`);
    process.stdout.write(`\n--- GENERATED REPLACEMENT (SHA-256 ${prepared.sha256}) ---\n${escapeTerminalControls(redactSourceForDisplay(prepared.content))}\n`);
    const patchConsent = createInterface({ input: process.stdin, output: process.stdout });
    let patchAnswer: string;
    try {
      patchAnswer = await patchConsent.question(`Apply this exact generated replacement to ${prepared.preview.targetPath}? The current target snapshot is bound to this preview and revalidated before writing. [y/N] `);
    } finally {
      patchConsent.close();
    }
    if (patchAnswer.trim().toLowerCase() !== "y") {
      approvals.discard(prepared.preview.previewId);
      process.stdout.write("Generated patch declined; target unchanged.\n");
      return;
    }
    const approval = approvals.approve(prepared.preview.previewId);
    await applyPreparedFilePatch(prepared, approval, approvals);
    process.stdout.write(`Generated replacement applied to ${prepared.preview.targetPath}. Now approve the relevant fixed Node test.\n`);
    await runSoftwareCheckCommand(["--root", root.path, "--check", "node-test", "--test", testFile], dependencies);
  } catch (error: unknown) {
    const message = error instanceof PatchApplicationError || error instanceof SourceReviewError || error instanceof PersistentFolderApprovalError
      ? error.message
      : error instanceof ModelProviderError ? error.message : "Agent fix failed safely; inspect the target before retrying.";
    process.stderr.write(`Agent fix failed: ${message}\n`);
    process.exitCode = controller.signal.aborted || (error instanceof ModelProviderError && error.kind === "cancelled") ? 130 : 3;
  } finally {
    process.off("SIGINT", handleInterrupt);
  }
}

export async function runFileMoveCommand(commandArgs: readonly string[], dependencies: SoftwareCommandDependencies): Promise<void> {
  if (commandArgs.length !== 4 || commandArgs[0] !== "--source" || commandArgs[1] === undefined ||
      commandArgs[2] !== "--target" || commandArgs[3] === undefined) {
    process.stderr.write("Expected --source <file> --target <new-file>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("File moves require an interactive terminal for exact operation approval.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const sourcePath = resolve(commandArgs[1]);
    const targetPath = resolve(commandArgs[3]);
    const extension = extname(sourcePath).toLowerCase();
    const supported = new Set([".txt", ".md", ".markdown", ".csv", ".pdf", ".docx", ".xlsx"]);
    if (!supported.has(extension) || extname(targetPath).toLowerCase() !== extension) {
      process.stderr.write("File move supports matching TXT, Markdown, CSV, PDF, DOCX, or XLSX extensions.\n");
      process.exitCode = 2;
      return;
    }
    const policy = new WorkspacePathPolicy();
    const sourceRoot = await policy.approveRoot(dirname(sourcePath));
    const targetRoot = await policy.approveRoot(dirname(targetPath));
    await dependencies.requirePersistentFolderApproval(sourceRoot.path, "read");
    await dependencies.requirePersistentFolderApproval(sourceRoot.path, "write");
    await dependencies.requirePersistentFolderApproval(targetRoot.path, "write");
    const registry = new ActionApprovalRegistry(policy);
    const preview = await registry.preview({ kind: "move", sourcePath, targetPath });
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(
        `Move this exact file?\nSource: ${escapeTerminalControls(preview.sourcePath ?? "")}\nDestination (must not exist): ${escapeTerminalControls(preview.targetPath)}\nSize: ${preview.sourceBytes ?? 0} bytes\nSHA-256: ${preview.sourceSha256 ?? "unavailable"}\nThe source is removed after a verified same-volume hard link is created. [y/N] `,
      );
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      registry.discard(preview.previewId);
      process.stdout.write("File move cancelled before mutation.\n");
      return;
    }
    await registry.applyApprovedMove(registry.approve(preview.previewId));
    process.stdout.write(`Moved file to ${escapeTerminalControls(preview.targetPath)}.\n`);
  } catch (error: unknown) {
    const detail = error instanceof PersistentFolderApprovalError ? error.message
      : error instanceof ApprovalError ? error.message
        : error instanceof PathPolicyError ? error.message : "the move could not be completed safely";
    process.stderr.write(`File move failed: ${detail}. The source may remain if the destination could not be verified.\n`);
    process.exitCode = 3;
  }
}

export async function runGitDiffCommand(commandArgs: readonly string[], dependencies: SoftwareCommandDependencies): Promise<void> {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--root" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --root <directory>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Git diff review requires an interactive terminal for exact root and changed-file approval.\n");
    process.exitCode = 2;
    return;
  }
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(commandArgs[1]));
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let rootAnswer: string;
  try {
    rootAnswer = await consent.question(`Inspect staged Git changes from this exact repository root?\nRoot: ${rootPath}\nNo source is read until the staged-file list is approved. [y/N] `);
  } finally {
    consent.close();
  }
  if (rootAnswer.trim().toLowerCase() !== "y") {
    process.stdout.write("Git diff review cancelled before content access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await dependencies.requirePersistentFolderApproval(root.path, "read");
    const files = await listGitDiffFiles(root, policy);
    if (files.length === 0) {
      process.stdout.write("No tracked changes are available for review. Unstaged and untracked files are not included.\n");
      return;
    }
    const fileList = files.map((file) => `  ${JSON.stringify(file)}`).join("\n");
    const fileConsent = createInterface({ input: process.stdin, output: process.stdout });
    let fileAnswer: string;
    try {
      fileAnswer = await fileConsent.question(`Display the locally redacted diff for these exact changed files?\n${fileList}\nMaximum: 20 files and 48 KiB. Redaction is heuristic. [y/N] `);
    } finally {
      fileConsent.close();
    }
    if (fileAnswer.trim().toLowerCase() !== "y") {
      process.stdout.write("Git diff review cancelled before content access.\n");
      return;
    }
    const review = await readGitDiff(root, policy, files);
    process.stdout.write(review.diff.length === 0 ? "The approved diff is empty.\n" : `${review.diff}\n`);
  } catch (error: unknown) {
    const message = error instanceof GitDiffReviewError || error instanceof PersistentFolderApprovalError ? error.message : "Git diff review failed safely.";
    process.stderr.write(`Git diff review failed: ${message}\n`);
    process.exitCode = 3;
  }
}

