import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ConfigurationError,
  formatConfigurationSummary,
  loadConfiguration,
  loadStoreConfiguration,
  parseConfiguration,
} from "../../dist/config/configuration.js";

const localMongoUri = "mongodb://localhost:27017/taskforge_test?marker=redaction-check";
const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function isolatedEnvironment(mongodbUri, extra = {}) {
  const environment = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }
  environment.LOCALAPPDATA = join(tmpdir(), "taskforge-config-tests", String(process.pid));

  if (typeof mongodbUri === "string") {
    environment.TASKFORGE_MONGODB_URI = mongodbUri;
  }

  return { ...environment, ...extra };
}

function runConfigCommand(mongodbUri, extra = {}) {
  return spawnSync(process.execPath, [cliPath, "config"], {
    encoding: "utf8",
    env: isolatedEnvironment(mongodbUri, extra),
    cwd: tmpdir(),
  });
}

function runDoctorCommand(mongodbUri, extra = {}) {
  return spawnSync(process.execPath, [cliPath, "doctor"], {
    encoding: "utf8",
    env: isolatedEnvironment(mongodbUri, extra),
    cwd: tmpdir(),
  });
}

function runDoctorWithEnvironment(environment) {
  return spawnSync(process.execPath, [cliPath, "doctor"], {
    encoding: "utf8",
    env: environment,
    cwd: tmpdir(),
  });
}

test("accepts a valid local MongoDB URI", () => {
  const configuration = parseConfiguration({ mongodbUri: localMongoUri });
  assert.equal(configuration.mongodbUri, localMongoUri);
});

test("accepts a MongoDB URI with multiple hosts", () => {
  const configuration = parseConfiguration({
    mongodbUri: "mongodb://db-one.example:27017,db-two.example:27017/taskforge_test",
  });
  assert.equal(configuration.mongodbUri.includes("db-one.example"), true);
});

test("requires the named environment setting", () => {
  assert.throws(
    () => loadConfiguration({}),
    (error) => error instanceof ConfigurationError && error.message.includes("TASKFORGE_MONGODB_URI"),
  );
});

test("new installations select the local database and existing Mongo URI selects MongoDB", () => {
  assert.equal(loadStoreConfiguration({}).kind, "local");
  assert.deepEqual(loadStoreConfiguration({ TASKFORGE_MONGODB_URI: localMongoUri }), {
    kind: "mongodb",
    mongodbUri: localMongoUri,
  });
  assert.deepEqual(loadStoreConfiguration({ TASKFORGE_STORAGE: "mongodb", TASKFORGE_MONGODB_URI: localMongoUri }), {
    kind: "mongodb",
    mongodbUri: localMongoUri,
  });
  assert.equal(loadStoreConfiguration({ TASKFORGE_STORAGE: "local", TASKFORGE_MONGODB_URI: localMongoUri }).kind, "local");
  assert.throws(() => loadStoreConfiguration({ TASKFORGE_STORAGE: "mongodb" }), ConfigurationError);
  assert.throws(() => loadStoreConfiguration({ TASKFORGE_STORAGE: "remote" }), ConfigurationError);
});

test("rejects invalid input shapes and malformed URIs", () => {
  for (const value of [
    null,
    [],
    "mongodb://localhost",
    { mongodbUri: "mongodb://localhost:27017" },
    { mongodbUri: 42 },
    { mongodbUri: "mongodb://" },
    { mongodbUri: "mongodb://one@two@localhost/taskforge_test" },
    { mongodbUri: "mongodb://localhost:27017/db?option=%" },
    { mongodbUri: "mongodb://localhost:27017/%ZZ" },
  ]) {
    assert.throws(() => parseConfiguration(value), ConfigurationError);
  }
});

test("configuration summary does not expose the connection string", () => {
  const configuration = parseConfiguration({ mongodbUri: localMongoUri });
  const summary = formatConfigurationSummary(configuration);
  assert.equal(summary.includes(localMongoUri), false);
  assert.match(summary, /connection string redacted/u);
});

test("CLI config defaults to local storage without a value", () => {
  const result = runConfigCommand(undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /local SQLite database \(path redacted\)/u);
  assert.doesNotMatch(result.stderr, /mongodb:\/\//u);
});

test("CLI config validates and summarizes without revealing the URI", () => {
  const result = runConfigCommand(localMongoUri);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /MongoDB configured/u);
  assert.doesNotMatch(result.stdout, /mongodb:\/\//u);
});

test("CLI config rejects malformed values without revealing them", () => {
  const malformedUri = "mongodb://invalid host/taskforge_test";
  const result = runConfigCommand(malformedUri);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /valid mongodb:\/\//u);
  assert.doesNotMatch(result.stderr, /invalid host/u);
});

test("CLI doctor checks local storage by default without a connection value", () => {
  const result = runDoctorCommand(undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Local storage: available/u);
  assert.match(result.stdout, /Model provider: not configured/u);
  assert.match(result.stdout, /Browser tooling: loopback fixtures and approval-controlled public HTTPS audits are available; live owner-approved acceptance remains pending/u);
  assert.equal(result.stdout.includes("mongodb://"), false);
});

test("CLI doctor reports unavailable MongoDB without echoing the endpoint", () => {
  const unavailableUri = "mongodb://127.0.0.1:1/taskforge_test";
  const result = runDoctorCommand(unavailableUri, { TASKFORGE_STORAGE: "mongodb" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Configured storage: unavailable/u);
  assert.doesNotMatch(result.stdout, /127\.0\.0\.1:1/u);
});

test("doctor reports provider configuration independently when MongoDB URI is invalid", () => {
  const privateTestKey = "synthetic-test-key-that-must-not-appear";
  const environment = isolatedEnvironment("mongodb+srv://invalid-shape", {
    TASKFORGE_STORAGE: "mongodb",
    TASKFORGE_PROVIDER: "groq",
    TASKFORGE_GROQ_API_KEY: privateTestKey,
    TASKFORGE_GROQ_MODEL: "openai/gpt-oss-20b",
  });
  const result = runDoctorWithEnvironment(environment);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Storage configuration: invalid or incomplete/u);
  assert.match(result.stdout, /Model provider: groq configured/u);
  assert.doesNotMatch(result.stdout, new RegExp(privateTestKey, "u"));
});
