#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { ConfigurationError, formatConfigurationSummary, loadConfiguration } from "./config.js";
import {
  DatabaseConnectionError,
  DatabaseShutdownError,
  MongoStore,
} from "./mongo-store.js";

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version | config | doctor]

The config command validates local settings and prints a redacted summary.
The doctor command checks configured MongoDB connectivity and reports unimplemented setup areas.
Task execution and other runtime features are not implemented yet.
`;

const args = process.argv.slice(2);

async function runDoctor(): Promise<void> {
  process.stdout.write("TaskForge doctor (early development)\n");

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
      process.stdout.write(`MongoDB: not configured. ${error.message}\n`);
    } else if (error instanceof DatabaseConnectionError) {
      process.stdout.write(`MongoDB: unavailable. ${error.message}\n`);
    } else if (error instanceof DatabaseShutdownError) {
      process.stdout.write(`MongoDB: connection check could not close cleanly. ${error.message}\n`);
    } else {
      process.stdout.write("MongoDB: check failed with an unexpected error.\n");
    }
    process.stdout.write("Model providers: not implemented yet.\n");
    process.stdout.write("Browser tooling: not implemented yet.\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write("Model providers: not implemented yet.\n");
  process.stdout.write("Browser tooling: not implemented yet.\n");
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
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
