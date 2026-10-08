#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };

const helpText = `TaskForge ${packageJson.version} (early development)

Usage: taskforge [--help | --version]

Runtime features are not implemented yet.
`;

const args = process.argv.slice(2);

if (args.length === 0 || args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  process.stdout.write(helpText);
} else if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) {
  process.stdout.write(`${packageJson.version}\n`);
} else {
  process.stderr.write("Error: unknown or unsupported CLI arguments.\nRun 'taskforge --help' for usage.\n");
  process.exitCode = 1;
}
