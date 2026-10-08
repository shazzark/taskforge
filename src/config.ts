export const MONGODB_URI_ENVIRONMENT_VARIABLE = "TASKFORGE_MONGODB_URI";

export interface AppConfiguration {
  readonly mongodbUri: string;
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

  return { mongodbUri };
}

export function loadConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AppConfiguration {
  return parseConfiguration({
    mongodbUri: environment[MONGODB_URI_ENVIRONMENT_VARIABLE],
  });
}

export function formatConfigurationSummary(_configuration: AppConfiguration): string {
  return "MongoDB configuration: present (connection string redacted).";
}
