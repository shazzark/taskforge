import { createInterface } from "node:readline/promises";
import { GitHubReadError, readPublicIssues } from "../../integrations/github-public-issues.js";

export async function runGitHubIssuesCommand(commandArgs: readonly string[]): Promise<void> {
  if (commandArgs.length !== 2 || commandArgs[0] !== "--repository" || commandArgs[1] === undefined) {
    process.stderr.write("Expected --repository <owner/name>.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("GitHub issue reading requires an interactive confirmation for the public repository request.\n");
    process.exitCode = 2;
    return;
  }
  const repository = commandArgs[1];
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await consent.question(`Read up to 20 open issue titles from the public repository ${repository}? The request uses no GitHub token and will not write anything. [y/N] `);
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("GitHub issue read cancelled before network access.\n");
    return;
  }
  try {
    const issues = await readPublicIssues(repository);
    if (issues.length === 0) {
      process.stdout.write("No open issues were returned.\n");
      return;
    }
    for (const issue of issues) {
      process.stdout.write(`#${issue.number} [${issue.state}] ${issue.title}\n${issue.url}\n`);
    }
  } catch (error: unknown) {
    const message = error instanceof GitHubReadError ? error.message : "GitHub issue read failed safely.";
    process.stderr.write(`GitHub issue read failed: ${message}\n`);
    process.exitCode = 3;
  }
}
