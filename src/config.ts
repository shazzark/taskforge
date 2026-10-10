import dotenv from "dotenv";

export const MONGODB_URI_ENVIRONMENT_VARIABLE = "TASKFORGE_MONGODB_URI";
export const MODEL_PROVIDER_ENVIRONMENT_VARIABLE = "TASKFORGE_PROVIDER";
export const GROQ_API_KEY_ENVIRONMENT_VARIABLE = "TASKFORGE_GROQ_API_KEY";
export const GROQ_MODEL_ENVIRONMENT_VARIABLE = "TASKFORGE_GROQ_MODEL";
export const OLLAMA_BASE_URL_ENVIRONMENT_VARIABLE = "TASKFORGE_OLLAMA_BASE_URL";
export const OLLAMA_MODEL_ENVIRONMENT_VARIABLE = "TASKFORGE_OLLAMA_MODEL";

export type ProviderConfiguration =
  | { readonly kind: "groq"; readonly apiKey: string; readonly model: string }
  | { readonly kind: "ollama"; readonly baseUrl: string; readonly model: string };

export interface AppConfiguration {
  readonly mongodbUri: string;
  readonly provider?: ProviderConfiguration;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidMongoDBUri(value: string): boolean {
  if (
    value !== value.trim() ||
    /[\s\u0000]/u.test(value) ||
    value.includes("#") ||
    /%(?![0-9a-f]{2})/iu.test(value)
  ) {
    return false;
  }

  const normalized = value.toLowerCase();
  const isSrv = normalized.startsWith("mongodb+srv://");
  const scheme = isSrv ? "mongodb+srv://" : "mongodb://";
  if (!normalized.startsWith(scheme)) {
    return false;
  }

  const authorityAndPath = value.slice(scheme.length);
  const authority = authorityAndPath.split(/[/?#]/u, 1)[0] ?? "";
  const suffix = authorityAndPath.slice(authority.length);
  const pathAndQuery = suffix.split("?", 1)[0] ?? "";
  const databaseName = pathAndQuery.startsWith("/") ? pathAndQuery.slice(1) : "";
  if (databaseName.length === 0 || databaseName.includes("/")) {
    return false;
  }

  try {
    const decodedDatabaseName = decodeURIComponent(databaseName);
    if (decodedDatabaseName.length === 0 || /[\u0000/\\]/u.test(decodedDatabaseName)) {
      return false;
    }
  } catch {
    return false;
  }

  const userInfoSeparator = authority.indexOf("@");
  if (userInfoSeparator !== authority.lastIndexOf("@") || userInfoSeparator === 0) {
    return false;
  }

  const hosts = authority.slice(userInfoSeparator + 1);
  if (hosts.length === 0 || (isSrv && (hosts.includes(",") || hosts.includes(":")))) {
    return false;
  }

  for (const host of hosts.split(",")) {
    if (host.length === 0) {
      return false;
    }

    try {
      const parsedHost = new URL(`mongodb://${host}`);
      if (parsedHost.hostname.length === 0) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function parseConfiguration(value: unknown): AppConfiguration {
  if (!isRecord(value)) {
    throw new ConfigurationError("Configuration must be an object.");
  }

  const mongodbUri = value["mongodbUri"];
  if (typeof mongodbUri !== "string" || mongodbUri.length === 0) {
    throw new ConfigurationError(
      `Missing required configuration: ${MONGODB_URI_ENVIRONMENT_VARIABLE}.`,
    );
  }

  if (!isValidMongoDBUri(mongodbUri)) {
    throw new ConfigurationError(
      `${MONGODB_URI_ENVIRONMENT_VARIABLE} must contain a valid mongodb:// or mongodb+srv:// URI. The value was omitted.`,
    );
  }

  const provider = parseProviderConfiguration(value);
  return provider === undefined ? { mongodbUri } : { mongodbUri, provider };
}

export function parseProviderConfiguration(value: unknown): ProviderConfiguration | undefined {
  if (!isRecord(value)) {
    throw new ConfigurationError("Provider configuration must be an object.");
  }
  const providerValue = value["provider"];
  if (providerValue === undefined || providerValue === "") {
    return undefined;
  }
  if (providerValue === "groq") {
    const apiKey = value["groqApiKey"];
    const model = value["groqModel"];
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new ConfigurationError(`Missing required configuration: ${GROQ_API_KEY_ENVIRONMENT_VARIABLE}.`);
    }
    if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u.test(model)) {
      throw new ConfigurationError(`${GROQ_MODEL_ENVIRONMENT_VARIABLE} must be a valid model identifier.`);
    }
    return { kind: "groq", apiKey, model };
  }

  if (providerValue === "ollama") {
    const baseUrl = value["ollamaBaseUrl"];
    const model = value["ollamaModel"];
    if (typeof baseUrl !== "string") {
      throw new ConfigurationError(`Missing required configuration: ${OLLAMA_BASE_URL_ENVIRONMENT_VARIABLE}.`);
    }
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new ConfigurationError(`${OLLAMA_BASE_URL_ENVIRONMENT_VARIABLE} must be a valid loopback URL.`);
    }
    if (
      parsedBaseUrl.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsedBaseUrl.hostname) ||
      parsedBaseUrl.username.length > 0 ||
      parsedBaseUrl.password.length > 0 ||
      parsedBaseUrl.search.length > 0 ||
      parsedBaseUrl.hash.length > 0
    ) {
      throw new ConfigurationError(`${OLLAMA_BASE_URL_ENVIRONMENT_VARIABLE} must use a loopback HTTP URL without credentials.`);
    }
    if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(model)) {
      throw new ConfigurationError(`${OLLAMA_MODEL_ENVIRONMENT_VARIABLE} must be a valid model identifier.`);
    }
    return { kind: "ollama", baseUrl: parsedBaseUrl.toString().replace(/\/$/u, ""), model };
  }

  throw new ConfigurationError(`${MODEL_PROVIDER_ENVIRONMENT_VARIABLE} must be either groq or ollama.`);
}

function loadLocalEnvironmentFile(environment: Readonly<Record<string, string | undefined>>): void {
  if (environment === process.env) {
    const result = dotenv.config({ quiet: true });
    const errorCode = isRecord(result.error) ? result.error["code"] : undefined;
    if (result.error !== undefined && errorCode !== "ENOENT") {
      throw new ConfigurationError("Unable to read the local environment file.");
    }
  }
}

function providerValues(environment: Readonly<Record<string, string | undefined>>): Record<string, unknown> {
  return {
    provider: environment[MODEL_PROVIDER_ENVIRONMENT_VARIABLE],
    groqApiKey: environment[GROQ_API_KEY_ENVIRONMENT_VARIABLE],
    groqModel: environment[GROQ_MODEL_ENVIRONMENT_VARIABLE] ?? "openai/gpt-oss-20b",
    ollamaBaseUrl: environment[OLLAMA_BASE_URL_ENVIRONMENT_VARIABLE] ?? "http://127.0.0.1:11434",
    ollamaModel: environment[OLLAMA_MODEL_ENVIRONMENT_VARIABLE],
  };
}

export function loadProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProviderConfiguration {
  loadLocalEnvironmentFile(environment);
  const provider = parseProviderConfiguration(providerValues(environment));
  if (provider === undefined) {
    throw new ConfigurationError(`Missing required configuration: ${MODEL_PROVIDER_ENVIRONMENT_VARIABLE}.`);
  }
  return provider;
}

export function loadConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AppConfiguration {
  loadLocalEnvironmentFile(environment);
  return parseConfiguration({
    mongodbUri: environment[MONGODB_URI_ENVIRONMENT_VARIABLE],
    ...providerValues(environment),
  });
}

export function formatConfigurationSummary(configuration: AppConfiguration): string {
  const providerSummary = configuration.provider === undefined
    ? "Model provider: not configured."
    : configuration.provider.kind === "groq"
      ? `Model provider: Groq configured (${configuration.provider.model}; key redacted).`
      : `Model provider: Ollama configured (${configuration.provider.model}; loopback only).`;
  return `MongoDB configuration: present (connection string redacted).\n${providerSummary}`;
}
