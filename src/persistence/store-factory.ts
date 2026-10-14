import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabasePersistenceError, MongoStore } from "../mongo-store.js";
import { loadStoreConfiguration, type StoreConfiguration } from "../config.js";
import type { TaskForgeStore } from "./store.js";

export async function connectTaskForgeStore(
  configuration: StoreConfiguration = loadStoreConfiguration(),
): Promise<TaskForgeStore> {
  if (configuration.kind === "mongodb") {
    return MongoStore.connect({ mongodbUri: configuration.mongodbUri });
  }

  try {
    await mkdir(dirname(configuration.path), { recursive: true, mode: 0o700 });
    const { SqliteStore } = await import("./sqlite-store.js");
    return await SqliteStore.connect({ path: configuration.path });
  } catch {
    throw new DatabasePersistenceError("Unable to open the configured local TaskForge database.");
  }
}
