import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ActionApprovalRegistry } from "../../security/approval-preview.js";
import { WorkspacePathPolicy } from "../../security/path-policy.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";
import { previewPdfArtifact, PdfArtifactError, writeApprovedPdfArtifact } from "../../tools/artifacts/approved-pdf-output.js";
import { DraftArtifactError, parseLocalDraftInput, previewTextArtifact, writeApprovedTextArtifact } from "../../tools/artifacts/drafts.js";
import { PersistentFolderApprovalError } from "../command-errors.js";

export interface ArtifactCommandDependencies {
  readonly readApprovedInputFile: (pathValue: string) => Promise<Uint8Array | undefined>;
  readonly requirePersistentFolderApproval: (pathValue: string, access: "read" | "write") => Promise<void>;
}

export async function runPdfReportCommand(
  commandArgs: readonly string[],
  dependencies: ArtifactCommandDependencies,
): Promise<void> {
  if (
    commandArgs.length !== 4 || commandArgs[0] !== "--input" || commandArgs[1] === undefined ||
    commandArgs[2] !== "--output" || commandArgs[3] === undefined || commandArgs[3].trim().length === 0
  ) {
    process.stderr.write("Expected --input <report.json> --output <new.pdf>.\n");
    process.exitCode = 1;
    return;
  }
  const input = await dependencies.readApprovedInputFile(commandArgs[1]);
  if (input === undefined) return;
  let report: unknown;
  try {
    report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)) as unknown;
  } catch {
    process.stderr.write("PDF report input must be valid UTF-8 JSON.\n");
    process.exitCode = 3;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("PDF artifact output requires an interactive terminal for target and content-bound approval.\n");
    process.exitCode = 2;
    return;
  }
  const requestedOutput = resolve(commandArgs[3]);
  try {
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await dependencies.requirePersistentFolderApproval(outputRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await previewPdfArtifact(report, requestedOutput, outputRoot, policy, approvals);
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(
        `Create this new PDF artifact?\nPath: ${pending.preview.targetPath}\nBytes: ${pending.bytes.byteLength}\nSHA-256: ${pending.digest}\nExisting files will not be replaced. [y/N] `,
      );
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      approvals.discard(pending.preview.previewId);
      process.stdout.write("PDF artifact creation cancelled before writing.\n");
      return;
    }
    const approval = approvals.approve(pending.preview.previewId);
    const written = await writeApprovedPdfArtifact(pending, approval, outputRoot, policy, approvals);
    process.stdout.write(`PDF artifact created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
  } catch (error: unknown) {
    const message = error instanceof PdfArtifactError || error instanceof PersistentFolderApprovalError ? error.message : "PDF artifact creation failed safely.";
    process.stderr.write(`PDF report failed: ${message}\n`);
    process.exitCode = 3;
  }
}

export async function runDraftCommand(
  commandArgs: readonly string[],
  dependencies: ArtifactCommandDependencies,
): Promise<void> {
  if (commandArgs.length !== 4 || commandArgs[0] !== "--input" || commandArgs[1] === undefined || commandArgs[2] !== "--output" || commandArgs[3] === undefined) {
    process.stderr.write("Expected --input <draft.json> --output <new.md>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Draft creation requires an interactive terminal for input and create-only output approval.\n");
    process.exitCode = 2;
    return;
  }
  const inputBytes = await dependencies.readApprovedInputFile(commandArgs[1]);
  if (inputBytes === undefined) return;
  let draft: unknown;
  try {
    draft = parseLocalDraftInput(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes)) as unknown);
  } catch (error: unknown) {
    process.stderr.write(`Draft input rejected: ${error instanceof DraftArtifactError ? error.message : "input must be valid UTF-8 JSON"}\n`);
    process.exitCode = 3;
    return;
  }
  const requestedOutput = resolve(commandArgs[3]);
  try {
    const policy = new WorkspacePathPolicy();
    const outputRoot = await policy.approveRoot(dirname(requestedOutput));
    await dependencies.requirePersistentFolderApproval(outputRoot.path, "write");
    const approvals = new ActionApprovalRegistry(policy);
    const pending = await previewTextArtifact(draft, requestedOutput, outputRoot, policy, approvals);
    process.stdout.write(`\n--- LOCAL DRAFT PREVIEW (heuristic redaction) ---\n${escapeTerminalControls(pending.content)}\n`);
    const consent = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = await consent.question(`Create this new local Markdown draft?\nPath: ${pending.preview.targetPath}\nBytes: ${Buffer.byteLength(pending.content, "utf8")}\nSHA-256: ${pending.digest}\nNo network request or email send will occur. [y/N] `);
    } finally {
      consent.close();
    }
    if (answer.trim().toLowerCase() !== "y") {
      approvals.discard(pending.preview.previewId);
      process.stdout.write("Draft creation cancelled before writing.\n");
      return;
    }
    const approval = approvals.approve(pending.preview.previewId);
    const written = await writeApprovedTextArtifact(pending, approval, outputRoot, policy, approvals);
    process.stdout.write(`Local draft created: ${written.byteCount} bytes; SHA-256 ${written.sha256}.\n`);
  } catch (error: unknown) {
    process.stderr.write(`Draft creation failed: ${error instanceof DraftArtifactError || error instanceof PersistentFolderApprovalError ? error.message : "the artifact could not be created safely"}\n`);
    process.exitCode = 3;
  }
}
