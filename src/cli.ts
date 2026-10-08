#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { ConfigurationError, formatConfigurationSummary, loadConfiguration } from "./config.js";

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version | config]

The config command validates local settings and prints a redacted summary.
Task execution and other runtime features are not implemented yet.
`;

const args = process.argv.slice(2);

if (args.length === 0 || args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
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
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
