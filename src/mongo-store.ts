import { MongoClient, type Collection, type Document } from "mongodb";
import { parseConfiguration } from "./config.js";

export interface RunSummaryInput {
  readonly runId: string;
  readonly workflowId: string;
  readonly summary: string;
}

export interface RunSummary extends RunSummaryInput {
  readonly state: "created";
  readonly createdAt: Date;
}

interface StoredRunSummary extends Document {
  readonly _id: string;
  readonly runId: string;
  readonly workflowId: string;
  readonly summary: string;
  readonly state: "created";
  readonly createdAt: Date;
}

export class DatabaseConnectionError extends Error {
  constructor() {
    super("Unable to connect to MongoDB. Check server availability and TASKFORGE_MONGODB_URI.");
    this.name = "DatabaseConnectionError";
  }
}

export class DatabaseShutdownError extends Error {
  constructor() {
    super("Unable to close the MongoDB connection cleanly.");
    this.name = "DatabaseShutdownError";
  }
}

export class DatabasePersistenceError extends Error {
  constructor() {
    super("Unable to persist or read a run summary from MongoDB.");
    this.name = "DatabasePersistenceError";
  }
}

export class PersistenceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceInputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRunSummaryInput(value: unknown): RunSummaryInput {
  if (!isRecord(value)) {
    throw new PersistenceInputError("Run summary must be an object.");
  }

  const runId = value["runId"];
  const workflowId = value["workflowId"];
  const summary = value["summary"];
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new PersistenceInputError("Run summary requires a non-empty runId.");
  }
  if (typeof workflowId !== "string" || workflowId.trim().length === 0) {
    throw new PersistenceInputError("Run summary requires a non-empty workflowId.");
  }
  if (typeof summary !== "string") {
    throw new PersistenceInputError("Run summary requires a string summary.");
  }

  return { runId, workflowId, summary };
}

function parseStoredRunSummary(value: unknown): RunSummary {
  if (!isRecord(value)) {
    throw new DatabasePersistenceError();
  }

  const runId = value["runId"];
  const workflowId = value["workflowId"];
  const summary = value["summary"];
  const state = value["state"];
  const createdAt = value["createdAt"];
  const id = value["_id"];
  if (
    typeof runId !== "string" ||
    typeof id !== "string" ||
    id !== runId ||
    typeof workflowId !== "string" ||
    workflowId.trim().length === 0 ||
    typeof summary !== "string" ||
    state !== "created" ||
    !(createdAt instanceof Date) ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new DatabasePersistenceError();
  }

  return {
    runId,
    workflowId,
    summary,
    state,
    createdAt,
  };
}

export class MongoStore {
  private readonly client: MongoClient;
  private readonly runs: Collection<StoredRunSummary>;

  private constructor(client: MongoClient) {
    this.client = client;
    this.runs = client.db().collection<StoredRunSummary>("runs");
  }

  static async connect(configuration: unknown): Promise<MongoStore> {
    const validatedConfiguration = parseConfiguration(configuration);
    let client: MongoClient | undefined;

    try {
      client = new MongoClient(validatedConfiguration.mongodbUri, {
        serverSelectionTimeoutMS: 3000,
      });
      await client.connect();
      await client.db().command({ ping: 1 });
      return new MongoStore(client);
    } catch {
      if (client !== undefined) {
        try {
          await client.close();
        } catch {
          // Keep the public error independent of driver details and connection data.
        }
      }
      throw new DatabaseConnectionError();
    }
  }

  async saveRunSummary(value: unknown): Promise<RunSummary> {
    const input = parseRunSummaryInput(value);
    const document: StoredRunSummary = {
      _id: input.runId,
      ...input,
      state: "created",
      createdAt: new Date(),
    };

    try {
      await this.runs.insertOne(document);
    } catch {
      throw new DatabasePersistenceError();
    }

    return parseStoredRunSummary(document);
  }

  async getRunSummary(runId: unknown): Promise<RunSummary | null> {
    if (typeof runId !== "string" || runId.trim().length === 0) {
      throw new PersistenceInputError("A non-empty runId is required.");
    }

    try {
      const document = await this.runs.findOne({ _id: runId });
      return document === null ? null : parseStoredRunSummary(document);
    } catch {
      throw new DatabasePersistenceError();
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      throw new DatabaseShutdownError();
    }
  }
}
