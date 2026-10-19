import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ArchitectureReportError, createArchitectureReport } from "../../workflows/architecture-report-workflow.js";
import { RepositoryInspectionError, inspectRepository } from "../../workflows/repository-inspection-workflow.js";
import { SourceReviewError, reviewSourceFiles } from "../../workflows/source-review-workflow.js";
import { PathPolicyError, WorkspacePathPolicy } from "../../security/path-policy.js";
import type { TaskForgeStore } from "../../storage/store.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";
import { PersistentFolderApprovalError } from "../command-errors.js";

export interface RepositoryInspectionCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
  readonly requirePersistentFolderApproval: (pathValue: string, access: "read" | "write") => Promise<void>;
}

export async function runRepositoryInspectionCommand(
  commandArgs: readonly string[],
  dependencies: RepositoryInspectionCommandDependencies,
): Promise<void> {
  if (
    commandArgs.length !== 2 || commandArgs[0] !== "--root" ||
    commandArgs[1] === undefined || commandArgs[1].trim().length === 0
  ) {
    process.stderr.write("Expected --root followed by a repository directory.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Repository inspection requires an interactive terminal for explicit root approval.\n");
    process.exitCode = 2;
    return;
  }

  const requestedRoot = resolve(commandArgs[1]);
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Allow TaskForge to inventory this exact repository root? ${requestedRoot} [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Repository inspection cancelled before access.\n");
    return;
  }

  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(requestedRoot);
    await dependencies.requirePersistentFolderApproval(approvedRoot.path, "read");
    const result = await dependencies.withStore((store) => inspectRepository(store, approvedRoot, policy));
    if (result !== undefined) {
      const inventory = result.inventory;
      process.stdout.write(
        `Run ${result.run.runId} completed: ${inventory.fileCount} files, ` +
        `${inventory.directoryCount} directories inspected, ${inventory.sourceFileCount} source files, ` +
        `${inventory.testFileCount} test-named files.\n` +
        `Coverage limits: ${inventory.excludedDirectoryCount} directories excluded before descent` +
        `${inventory.excludedDirectoryCategories.length === 0 ? "" : ` (${inventory.excludedDirectoryCategories.join(", ")})`}; ` +
        `their contents were not inspected; ${inventory.skippedLinkCount} symbolic links and ` +
        `${inventory.deniedPathCount} secret paths skipped.\n`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof RepositoryInspectionError || error instanceof PersistentFolderApprovalError ? error.message : "Repository inspection failed safely.";
    process.stderr.write(`Repository inspection failed: ${message}\n`);
    process.exitCode = 3;
  }
}

export async function runSourceReviewCommand(
  commandArgs: readonly string[],
  dependencies: RepositoryInspectionCommandDependencies,
): Promise<void> {
  if (commandArgs.length < 4 || commandArgs[0] !== "--root" || commandArgs[1] === undefined || commandArgs[1].trim().length === 0) {
    process.stderr.write("Expected --root <directory> --file <relative-path> [--file <relative-path> ...].\n");
    process.exitCode = 1;
    return;
  }
  const paths: string[] = [];
  for (let index = 2; index < commandArgs.length; index += 2) {
    const flag = commandArgs[index];
    const path = commandArgs[index + 1];
    if (flag !== "--file" || path === undefined) {
      process.stderr.write("Each selected file must use --file followed by a relative path.\n");
      process.exitCode = 1;
      return;
    }
    paths.push(path);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Source review requires an interactive terminal for exact root and file-set approval.\n");
    process.exitCode = 2;
    return;
  }
  const requestedRoot = resolve(commandArgs[1]);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(requestedRoot);
  } catch {
    process.stderr.write("The requested repository root could not be resolved.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Review these exact files from this resolved repository root?\nRoot: ${canonicalRoot}\nFiles: ${paths.join(", ")}\nContent stays local. Common credential patterns are redacted heuristically; other secrets may remain visible. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Source review cancelled before file access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const approvedRoot = await policy.approveRoot(canonicalRoot);
    await dependencies.requirePersistentFolderApproval(approvedRoot.path, "read");
    const files = await reviewSourceFiles(approvedRoot, policy, paths);
    for (const file of files) {
      process.stdout.write(`\n--- ${file.path} (${file.byteCount} bytes, ${file.lineCount} lines) ---\n${file.content}\n`);
    }
  } catch (error: unknown) {
    const message = error instanceof SourceReviewError || error instanceof PersistentFolderApprovalError ? error.message : "Source review failed safely.";
    process.stderr.write(`Source review failed: ${message}\n`);
    process.exitCode = 3;
  }
}

export async function runArchitectureReportCommand(
  commandArgs: readonly string[],
  dependencies: RepositoryInspectionCommandDependencies,
): Promise<void> {
  if (commandArgs.length < 4 || commandArgs[0] !== "--root" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --root <directory> --file <relative-path> [--file <relative-path> ...].\n");
    process.exitCode = 1;
    return;
  }
  const paths: string[] = [];
  for (let index = 2; index < commandArgs.length; index += 2) {
    const option = commandArgs[index];
    const path = commandArgs[index + 1];
    if (option !== "--file" || path === undefined) {
      process.stderr.write("Each selected file must use --file followed by a relative path.\n");
      process.exitCode = 1;
      return;
    }
    paths.push(path);
  }
  if (paths.length > 20) {
    process.stderr.write("Select no more than 20 files for an architecture report.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Architecture reports require interactive exact-root and file-set approval.\n");
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
  let answer: string;
  try {
    answer = await consent.question(`Read these exact files for a local architecture report?\nRoot: ${escapeTerminalControls(rootPath)}\nFiles:\n${paths.map((path) => `  ${JSON.stringify(escapeTerminalControls(path))}`).join("\n")}\nOnly these files are read, using bounded heuristic redaction. Source is not executed and the report is not a full-repository scan. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Architecture report cancelled before file access.\n");
    return;
  }
  try {
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    await dependencies.requirePersistentFolderApproval(root.path, "read");
    const report = await createArchitectureReport(root, policy, paths);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    const message = error instanceof ArchitectureReportError || error instanceof PersistentFolderApprovalError || error instanceof PathPolicyError
      ? error.message : "Architecture report failed safely.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 3;
  }
}
