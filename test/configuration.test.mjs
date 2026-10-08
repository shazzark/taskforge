import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ConfigurationError,
  formatConfigurationSummary,
  loadConfiguration,
  parseConfiguration,
} from "../dist/config.js";

const localMongoUri = "mongodb://localhost:27017/taskforge_test?marker=redaction-check";
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function isolatedEnvironment(mongodbUri) {
  const environment = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  if (typeof mongodbUri === "string") {
    environment.TASKFORGE_MONGODB_URI = mongodbUri;
  }

  return environment;
}

function runConfigCommand(mongodbUri) {
  return spawnSync(process.execPath, [cliPath, "config"], {
    encoding: "utf8",
    env: isolatedEnvironment(mongodbUri),
  });
}

function runDoctorCommand(mongodbUri) {
  return spawnSync(process.execPath, [cliPath, "doctor"], {
    encoding: "utf8",
    env: isolatedEnvironment(mongodbUri),
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

test("CLI config reports missing configuration without a value", () => {
  const result = runConfigCommand(undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TASKFORGE_MONGODB_URI/u);
  assert.doesNotMatch(result.stderr, /mongodb:\/\//u);
});

test("CLI config validates and summarizes without revealing the URI", () => {
  const result = runConfigCommand(localMongoUri);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /MongoDB configuration: present/u);
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

test("CLI doctor reports missing MongoDB configuration without a connection value", () => {
  const result = runDoctorCommand(undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MongoDB: not configured/u);
  assert.match(result.stdout, /Model providers: not implemented yet/u);
  assert.match(result.stdout, /Browser tooling: not implemented yet/u);
  assert.equal(result.stdout.includes("mongodb://"), false);
});

test("CLI doctor reports unavailable MongoDB without echoing the endpoint", () => {
  const unavailableUri = "mongodb://127.0.0.1:1/taskforge_test";
  const result = runDoctorCommand(unavailableUri);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MongoDB: unavailable/u);
  assert.doesNotMatch(result.stdout, /127\.0\.0\.1:1/u);
});
