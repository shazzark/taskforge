import { createInterface } from "node:readline/promises";
import { ConfigurationError, loadLocalEnvironmentFile } from "../../config/configuration.js";
import { DeploymentTraceError, traceDeployments } from "../../integrations/deployment-tracing.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";

export async function runDeploymentTraceCommand(commandArgs: readonly string[]): Promise<void> {
  const valid = (commandArgs.length === 4 || commandArgs.length === 6) &&
    commandArgs[0] === "--repository" && commandArgs[1] !== undefined &&
    commandArgs[2] === "--project-id" && commandArgs[3] !== undefined &&
    (commandArgs.length === 4 || (commandArgs[4] === "--team-id" && commandArgs[5] !== undefined));
  if (!valid) {
    process.stderr.write("Expected --repository <owner/name> --project-id <prj_id> [--team-id <team_id>].\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Deployment tracing requires interactive approval for the exact public repository and Vercel project scope.\n");
    process.exitCode = 2;
    return;
  }
  try {
    loadLocalEnvironmentFile();
  } catch (error: unknown) {
    process.stderr.write(error instanceof ConfigurationError ? error.message : "The local environment file could not be loaded safely.\n");
    process.exitCode = 2;
    return;
  }
  const token = process.env["TASKFORGE_VERCEL_TOKEN"];
  if (token === undefined || token.length === 0) {
    process.stderr.write("Vercel tracing requires TASKFORGE_VERCEL_TOKEN in the local environment. No network request was made.\n");
    process.exitCode = 2;
    return;
  }
  const repository = commandArgs[1];
  const projectId = commandArgs[3];
  if (repository === undefined || projectId === undefined) {
    process.stderr.write("The selected deployment scope is incomplete.\n");
    process.exitCode = 1;
    return;
  }
  const teamId = commandArgs[5];
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    const teamLine = teamId === undefined ? "" : `\nVercel team: ${escapeTerminalControls(teamId)}`;
    answer = await consent.question(
      `Read-only deployment trace for exactly this public GitHub repository and Vercel project?\nRepository: ${escapeTerminalControls(repository)}\nVercel project: ${escapeTerminalControls(projectId)}${teamLine}\nThis sends bounded GET requests to GitHub Actions and Vercel deployment-list APIs. The Vercel token is sent only to api.vercel.com and is never displayed or stored. No deployment action will be performed. [y/N] `,
    );
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Deployment trace cancelled before network access.\n");
    return;
  }
  try {
    const result = await traceDeployments(repository, projectId, token, fetch, teamId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.github.status !== "ok" || result.vercel.status !== "ok") process.exitCode = 3;
  } catch (error: unknown) {
    const message = error instanceof DeploymentTraceError ? error.message : "Deployment tracing failed safely.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 3;
  }
}
