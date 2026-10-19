import {
  ConfigurationError,
  formatStoreConfigurationSummary,
  loadProviderConfiguration,
  loadStoreConfiguration,
} from "../../config/configuration.js";

export interface SetupGuideDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion?: string;
  readonly writeLine?: (line: string) => void;
}

function checkNodeVersion(version: string): "supported" | "unsupported" | "unknown" {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  const majorText = match?.[1];
  const minorText = match?.[2];
  const patchText = match?.[3];
  if (majorText === undefined || minorText === undefined || patchText === undefined) return "unknown";
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (![major, minor, patch].every(Number.isSafeInteger)) return "unknown";
  return major > 22 || (major === 22 && minor >= 13) ? "supported" : "unsupported";
}

export function runSetupGuide(dependencies: SetupGuideDependencies = {}): void {
  const environment = dependencies.environment;
  const writeLine = dependencies.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  const nodeVersion = dependencies.nodeVersion ?? process.version;
  const nodeStatus = checkNodeVersion(nodeVersion);

  writeLine("TaskForge setup guide (checks configuration; makes no changes)");
  writeLine(nodeStatus === "supported"
    ? `Node.js: ${nodeVersion} (supported; requires >=22.13.0)`
    : nodeStatus === "unsupported"
      ? `Node.js: ${nodeVersion} (below the required >=22.13.0)`
      : `Node.js: version could not be verified (reported value: ${nodeVersion})`);

  try {
    writeLine(formatStoreConfigurationSummary(loadStoreConfiguration(environment)));
  } catch (error: unknown) {
    const detail = error instanceof ConfigurationError ? error.message : "Unable to read storage configuration.";
    writeLine(`Storage configuration: needs attention. ${detail}`);
  }

  try {
    const provider = loadProviderConfiguration(environment);
    writeLine(
      provider.kind === "groq"
        ? `Model provider: Groq configured (${provider.model}; key redacted; not contacted).`
        : `Model provider: Ollama configured (${provider.model}; loopback only; not contacted).`,
    );
  } catch {
    writeLine("Model provider: not configured or invalid; provider was not contacted.");
  }

  writeLine("Next steps:");
  writeLine("- This npm package requires Node.js >=22.13.0 and does not bundle a Node.js runtime.");
  writeLine("- Run `taskforge doctor` to check the selected storage connection.");
  writeLine("- Set TASKFORGE_PROVIDER=groq and TASKFORGE_GROQ_API_KEY for Groq, or configure the installed loopback Ollama model.");
  writeLine("- Browser binaries are not bundled; install the pinned Chromium browser with `npx playwright install chromium` only if you need browser workflows.");
  writeLine("- Keep local environment files private and uncommitted; this guide never writes configuration or downloads software.");
}
