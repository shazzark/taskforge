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

export function runSetupGuide(dependencies: SetupGuideDependencies = {}): void {
  const environment = dependencies.environment;
  const writeLine = dependencies.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  const nodeVersion = dependencies.nodeVersion ?? process.version;

  writeLine("TaskForge setup guide (checks configuration; makes no changes)");
  writeLine(`Node.js: ${nodeVersion} (TaskForge requires >=22.13.0)`);

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
  writeLine("- Run `taskforge doctor` to check the selected storage connection.");
  writeLine("- Set TASKFORGE_PROVIDER=groq and TASKFORGE_GROQ_API_KEY for Groq, or configure the installed loopback Ollama model.");
  writeLine("- Install the pinned Chromium browser with `npx playwright install chromium` only if you need browser workflows.");
  writeLine("- Keep local environment files private and uncommitted; this guide never writes configuration or downloads software.");
}
