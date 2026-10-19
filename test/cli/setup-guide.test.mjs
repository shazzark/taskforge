import assert from "node:assert/strict";
import test from "node:test";
import { runSetupGuide } from "../../dist/cli/commands/setup.js";

function setupOutput(environment) {
  const lines = [];
  runSetupGuide({ environment, nodeVersion: "v22.13.0", writeLine: (line) => lines.push(line) });
  return lines.join("\n");
}

test("setup guide explains fresh local setup without contacting providers or writing configuration", () => {
  const output = setupOutput({});
  assert.match(output, /Node\.js: v22\.13\.0 \(supported; requires >=22\.13\.0\)/u);
  assert.match(output, /local SQLite database \(path redacted\)/u);
  assert.match(output, /Model provider: not configured or invalid; provider was not contacted/u);
  assert.match(output, /TASKFORGE_PROVIDER=groq/u);
  assert.match(output, /requires Node\.js >=22\.13\.0 and does not bundle a Node\.js runtime/u);
  assert.match(output, /Browser binaries are not bundled/u);
  assert.match(output, /npx playwright install chromium/u);
  assert.match(output, /never writes configuration or downloads software/u);
});

test("setup guide identifies unsupported and unverifiable Node.js versions", () => {
  const lines = [];
  runSetupGuide({ environment: {}, nodeVersion: "v22.12.9", writeLine: (line) => lines.push(line) });
  assert.match(lines.join("\n"), /Node\.js: v22\.12\.9 \(below the required >=22\.13\.0\)/u);

  const unknownLines = [];
  runSetupGuide({ environment: {}, nodeVersion: "v22.13.0-nightly", writeLine: (line) => unknownLines.push(line) });
  assert.match(unknownLines.join("\n"), /Node\.js: version could not be verified \(reported value: v22\.13\.0-nightly\)/u);
});

test("setup guide reports configured providers without exposing secrets or contacting them", () => {
  const key = "synthetic-setup-guide-key-must-not-leak";
  const uri = "mongodb://user:password@db.example.test:27017/taskforge?token=secret";
  const output = setupOutput({
    TASKFORGE_STORAGE: "mongodb",
    TASKFORGE_MONGODB_URI: uri,
    TASKFORGE_PROVIDER: "groq",
    TASKFORGE_GROQ_API_KEY: key,
    TASKFORGE_GROQ_MODEL: "openai/gpt-oss-20b",
  });
  assert.match(output, /MongoDB configured \(connection string redacted\)/u);
  assert.match(output, /Groq configured \(openai\/gpt-oss-20b; key redacted; not contacted\)/u);
  assert.equal(output.includes(key), false);
  assert.equal(output.includes(uri), false);
});

test("setup guide reports invalid storage safely while keeping provider diagnosis independent", () => {
  const sensitiveValue = "mongodb+srv://owner:password@bad host/private";
  const output = setupOutput({
    TASKFORGE_STORAGE: "mongodb",
    TASKFORGE_MONGODB_URI: sensitiveValue,
    TASKFORGE_PROVIDER: "ollama",
    TASKFORGE_OLLAMA_MODEL: "qwen3:4b-q4_K_M",
  });
  assert.match(output, /Storage configuration: needs attention/u);
  assert.match(output, /Ollama configured \(qwen3:4b-q4_K_M; loopback only; not contacted\)/u);
  assert.equal(output.includes(sensitiveValue), false);
});
