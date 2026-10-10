#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { createInterface } from "node:readline/promises";
import { ConfigurationError, formatConfigurationSummary, loadConfiguration, loadProviderConfiguration } from "./config.js";
import { AgentToolError, runToolLoop } from "./agent/tool-loop.js";
import {
  DatabaseConnectionError,
  DatabaseShutdownError,
  MongoStore,
} from "./mongo-store.js";
import { createModelProvider } from "./providers/create-provider.js";
import { ModelProviderError } from "./providers/types.js";

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version | config | doctor | model-check | chat]

The config command validates local settings and prints a redacted summary.
The doctor command checks configured MongoDB connectivity and reports available setup areas.
The model-check command makes a synthetic read-only tool call through the selected model provider.
The chat command opens a bounded interactive conversation with the selected provider.
Task execution and other runtime features are not implemented yet.
`;

const args = process.argv.slice(2);

async function runDoctor(): Promise<void> {
  process.stdout.write("TaskForge doctor (early development)\n");
  let providerStatus = "not configured or invalid";
  try {
    providerStatus = `${loadProviderConfiguration().kind} configured (not contacted by doctor)`;
  } catch {
    // Keep provider diagnostics independent from secret values and MongoDB configuration.
  }

  try {
    const configuration = loadConfiguration();
    process.stdout.write(`${formatConfigurationSummary(configuration)}\n`);
    const store = await MongoStore.connect(configuration);
    try {
      await store.close();
    } catch {
      throw new DatabaseShutdownError();
    }
    process.stdout.write("MongoDB: available\n");
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      if (error.message.includes("TASKFORGE_MONGODB_URI")) {
        process.stdout.write(`MongoDB: not configured. ${error.message}\n`);
      } else {
        process.stdout.write(`Configuration: invalid. ${error.message}\n`);
      }
    } else if (error instanceof DatabaseConnectionError) {
      process.stdout.write(`MongoDB: unavailable. ${error.message}\n`);
    } else if (error instanceof DatabaseShutdownError) {
      process.stdout.write(`MongoDB: connection check could not close cleanly. ${error.message}\n`);
    } else {
      process.stdout.write("MongoDB: check failed with an unexpected error.\n");
    }
    process.stdout.write(`Model provider: ${providerStatus}.\n`);
    process.stdout.write("Browser tooling: not implemented yet.\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Model provider: ${providerStatus}.\n`);
  process.stdout.write("Browser tooling: not implemented yet.\n");
}

async function runModelCheck(): Promise<void> {
  const controller = new AbortController();
  const handleInterrupt = (): void => controller.abort();
  process.once("SIGINT", handleInterrupt);
  try {
    const providerConfiguration = loadProviderConfiguration();
    const selected = createModelProvider(providerConfiguration);
    const result = await runToolLoop(
      selected.provider,
      selected.model,
      [{ role: "user", content: "Use read_fixture_status for record_id fixture-001, then report its status." }],
      [{
        definition: {
          name: "read_fixture_status",
          description: "Read the fixed synthetic status for the fixture record fixture-001.",
          parameters: {
            type: "object",
            properties: { record_id: { type: "string", enum: ["fixture-001"] } },
            required: ["record_id"],
            additionalProperties: false,
          },
        },
        validateArguments(value: unknown): unknown {
          if (
            typeof value !== "object" || value === null || Array.isArray(value) ||
            !("record_id" in value) || value.record_id !== "fixture-001" ||
            Object.keys(value).some((key) => key !== "record_id")
          ) {
            throw new AgentToolError();
          }
          return { record_id: value.record_id };
        },
        async execute(): Promise<string> {
          return "fixture-001 status=ready (synthetic fixture; no files or services accessed)";
        },
      }],
      { maxModelRequests: 3, maxToolActions: 1, signal: controller.signal },
    );
    if (result.toolActions !== 1 || result.toolNames[0] !== "read_fixture_status") {
      process.stderr.write("Model check failed: the provider did not complete the required synthetic tool call.\n");
      process.exitCode = 3;
      return;
    }
    process.stdout.write(`Model check passed: ${providerConfiguration.kind}; tool actions=${result.toolActions}; model requests=${result.modelRequests}.\n`);
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`Model check setup error: ${error.message}\n`);
    } else if (error instanceof ModelProviderError) {
      process.stderr.write(`Model check failed: ${error.message}\n`);
    } else if (error instanceof AgentToolError) {
      process.stderr.write("Model check failed: provider requested an unknown or invalid tool action.\n");
    } else {
      process.stderr.write("Model check failed with an unexpected error.\n");
    }
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
  }
}

async function runChat(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Chat requires an interactive terminal.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const providerConfiguration = loadProviderConfiguration();
    const selected = createModelProvider(providerConfiguration);
    if (providerConfiguration.kind === "groq") {
      process.stdout.write("This session sends the text you enter to the configured Groq service. Continue? [y/N] ");
      const consent = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await consent.question("");
      consent.close();
      if (answer.trim().toLowerCase() !== "y") {
        process.stdout.write("Chat cancelled before sending a request.\n");
        return;
      }
    }

    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const messages: Array<{ readonly role: "user" | "assistant"; readonly content: string }> = [];
    let modelRequestsUsed = 0;
    let activeController: AbortController | undefined;
    let stopRequested = false;
    terminal.on("SIGINT", () => {
      if (activeController !== undefined) {
        activeController.abort();
      } else {
        stopRequested = true;
        terminal.close();
      }
    });
    process.stdout.write("Chat ready. Enter /exit to finish; Ctrl+C cancels the active request.\n");
    try {
      while (!stopRequested && modelRequestsUsed < 40) {
        let input: string;
        try {
          input = await terminal.question("You> ");
        } catch {
          break;
        }
        if (input.trim() === "/exit" || input.trim() === "/quit") {
          break;
        }
        if (input.length === 0) {
          continue;
        }
        if (input.length > 8_000) {
          process.stdout.write("Message too long; the maximum is 8,000 characters.\n");
          continue;
        }
        messages.push({ role: "user", content: input });
        const controller = new AbortController();
        activeController = controller;
        try {
          const result = await runToolLoop(
            selected.provider,
            selected.model,
            messages.slice(-40),
            [],
            { maxModelRequests: 40 - modelRequestsUsed, maxToolActions: 0, signal: controller.signal },
          );
          modelRequestsUsed += result.modelRequests;
          messages.push({ role: "assistant", content: result.content });
          process.stdout.write(`TaskForge> ${result.content}\n`);
        } catch (error: unknown) {
          if (error instanceof ModelProviderError) {
            process.stderr.write(`Chat request failed: ${error.message}\n`);
          } else {
            process.stderr.write("Chat request failed with an unexpected error.\n");
          }
          if (controller.signal.aborted) {
            stopRequested = true;
          }
        } finally {
          activeController = undefined;
        }
      }
      if (modelRequestsUsed >= 40) {
        process.stdout.write("Chat model-request budget reached. Start a new session to continue.\n");
      }
    } finally {
      terminal.close();
    }
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "Unable to start chat with the selected provider.";
    process.stderr.write(`Chat setup error: ${message}\n`);
    process.exitCode = 2;
  }
}

if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) {
  process.stdout.write(helpText);
} else if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) {
  process.stdout.write(`${packageJson.version}\n`);
} else if (args.length === 1 && args[0] === "config") {
  try {
    const configuration = loadConfiguration();
    process.stdout.write(`${formatConfigurationSummary(configuration)}\n`);
  } catch (error: unknown) {
    const message = error instanceof ConfigurationError ? error.message : "Unable to load configuration.";
    process.stderr.write(`Configuration error: ${message}\n`);
    process.exitCode = 2;
  }
} else if (args.length === 1 && args[0] === "doctor") {
  await runDoctor();
} else if (args.length === 1 && args[0] === "model-check") {
  await runModelCheck();
} else if (args.length === 1 && args[0] === "chat") {
  await runChat();
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
