import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudgetError, AgentToolError, runToolLoop } from "../dist/agent/tool-loop.js";
import { ConfigurationError, parseConfiguration } from "../dist/config.js";
import { GroqProvider } from "../dist/providers/groq-provider.js";
import { OllamaProvider } from "../dist/providers/ollama-provider.js";
import { ModelProviderError } from "../dist/providers/types.js";

const mongoUri = "mongodb://127.0.0.1:27017/taskforge_test";
const fixtureTool = {
  name: "read_fixture_status",
  description: "Read one synthetic status fixture.",
  parameters: {
    type: "object",
    properties: { record_id: { type: "string", enum: ["fixture-001"] } },
    required: ["record_id"],
    additionalProperties: false,
  },
};

function fixtureArguments(value) {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    value.record_id !== "fixture-001" || Object.keys(value).length !== 1
  ) {
    throw new Error("Invalid fixture arguments");
  }
  return value;
}

function fixtureToolImplementation(execute = async () => "fixture-001 status=ready") {
  return { definition: fixtureTool, validateArguments: fixtureArguments, execute };
}

function toolCompletion(toolCalls) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: toolCalls.map((call, index) => ({
          id: `call-${index}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      },
    }],
  };
}

function finalCompletion(content = "The fixture is ready.") {
  return { choices: [{ finish_reason: "stop", message: { content } }] };
}

test("configuration validates selected Groq settings without exposing the key", () => {
  const result = parseConfiguration({
    mongodbUri: mongoUri,
    provider: "groq",
    groqApiKey: "synthetic-key-for-test",
    groqModel: "openai/gpt-oss-20b",
  });
  assert.equal(result.provider.kind, "groq");
  assert.equal(result.provider.model, "openai/gpt-oss-20b");
  assert.throws(
    () => parseConfiguration({ mongodbUri: mongoUri, provider: "groq", groqModel: "openai/gpt-oss-20b" }),
    (error) => error instanceof ConfigurationError && error.message.includes("TASKFORGE_GROQ_API_KEY"),
  );
});

test("Ollama configuration rejects non-loopback endpoints", () => {
  assert.throws(
    () => parseConfiguration({
      mongodbUri: mongoUri,
      provider: "ollama",
      ollamaBaseUrl: "http://192.168.1.10:11434",
      ollamaModel: "qwen3:4b-q4_K_M",
    }),
    ConfigurationError,
  );
  const result = parseConfiguration({
    mongodbUri: mongoUri,
    provider: "ollama",
    ollamaBaseUrl: "http://127.0.0.1:11434/",
    ollamaModel: "qwen3:4b-q4_K_M",
  });
  assert.equal(result.provider.baseUrl, "http://127.0.0.1:11434");
});

test("Groq adapter submits a constrained function tool and parses its call", async () => {
  let observedRequest;
  const provider = new GroqProvider(
    { kind: "groq", apiKey: "synthetic-key-for-test", model: "openai/gpt-oss-20b" },
    async (request) => {
      observedRequest = request;
      return toolCompletion([{ name: "read_fixture_status", arguments: { record_id: "fixture-001" } }]);
    },
  );
  const result = await provider.complete({
    model: "ignored-request-model",
    messages: [{ role: "user", content: "Read the fixture." }],
    tools: [fixtureTool],
  });
  assert.equal(observedRequest.model, "openai/gpt-oss-20b");
  assert.equal(observedRequest.tools[0].function.name, "read_fixture_status");
  assert.equal(observedRequest.tools[0].function.parameters.additionalProperties, false);
  assert.equal(result.toolCalls[0].name, "read_fixture_status");
  assert.deepEqual(result.toolCalls[0].arguments, { record_id: "fixture-001" });
});

test("Groq adapter classifies auth, quota and invalid provider responses", async () => {
  const createRejectingProvider = (status) => new GroqProvider(
    { kind: "groq", apiKey: "synthetic-key-for-test", model: "openai/gpt-oss-20b" },
    async () => { throw { status }; },
  );
  const request = { model: "openai/gpt-oss-20b", messages: [], tools: [] };
  await assert.rejects(createRejectingProvider(401).complete(request), (error) => error.kind === "authentication");
  await assert.rejects(createRejectingProvider(429).complete(request), (error) => error.kind === "quota");
  const malformed = new GroqProvider(
    { kind: "groq", apiKey: "synthetic-key-for-test", model: "openai/gpt-oss-20b" },
    async () => ({ choices: [] }),
  );
  await assert.rejects(malformed.complete(request), (error) => error.kind === "invalid_response");
});

test("Ollama adapter sends the local OpenAI-compatible request and normalizes tool calls", async () => {
  let observedUrl;
  let observedBody;
  const provider = new OllamaProvider(
    { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-q4_K_M" },
    async (url, init) => {
      observedUrl = String(url);
      observedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(toolCompletion([
        { name: "read_fixture_status", arguments: { record_id: "fixture-001" } },
      ])), { status: 200, headers: { "content-type": "application/json" } });
    },
  );
  const result = await provider.complete({
    model: "ignored-request-model",
    messages: [{ role: "user", content: "Read the fixture." }],
    tools: [fixtureTool],
  });
  assert.equal(observedUrl, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(observedBody.model, "qwen3:4b-q4_K_M");
  assert.equal(observedBody.tools[0].function.name, "read_fixture_status");
  assert.equal(result.toolCalls[0].name, "read_fixture_status");
  assert.deepEqual(result.toolCalls[0].arguments, { record_id: "fixture-001" });
});

test("Ollama adapter reports unsupported tools and malformed response without leaking details", async () => {
  const request = { model: "qwen3:4b-q4_K_M", messages: [], tools: [fixtureTool] };
  const unsupported = new OllamaProvider(
    { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-q4_K_M" },
    async () => new Response("private server detail", { status: 400 }),
  );
  await assert.rejects(unsupported.complete(request), (error) => error.kind === "unsupported_tool");
  const malformed = new OllamaProvider(
    { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-q4_K_M" },
    async () => new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 }),
  );
  await assert.rejects(malformed.complete(request), (error) => error.kind === "invalid_response");
});

test("bounded tool loop completes a validated read-only action and final answer", async () => {
  const responses = [
    { content: null, toolCalls: [{ id: "call-1", name: "read_fixture_status", arguments: { record_id: "fixture-001" } }], finishReason: "tool_calls" },
    { content: "The fixture status is ready.", toolCalls: [], finishReason: "stop" },
  ];
  let callCount = 0;
  let executionCount = 0;
  const provider = {
    async complete() {
      callCount += 1;
      return responses.shift();
    },
  };
  const result = await runToolLoop(provider, "mock", [{ role: "user", content: "Check fixture." }], [
    fixtureToolImplementation(async () => { executionCount += 1; return "fixture-001 status=ready"; }),
  ], { maxModelRequests: 3, maxToolActions: 1 });
  assert.equal(result.content, "The fixture status is ready.");
  assert.equal(result.modelRequests, 2);
  assert.equal(result.toolActions, 1);
  assert.equal(callCount, 2);
  assert.equal(executionCount, 1);
});

test("tool loop rejects invalid arguments and enforces tool and request budgets", async () => {
  let executionCount = 0;
  const invalidProvider = {
    async complete() {
      return { content: null, toolCalls: [{ id: "call-1", name: "read_fixture_status", arguments: { record_id: "wrong" } }], finishReason: "tool_calls" };
    },
  };
  const tool = fixtureToolImplementation(async () => { executionCount += 1; return "not reached"; });
  await assert.rejects(
    runToolLoop(invalidProvider, "mock", [], [tool], { maxModelRequests: 2, maxToolActions: 1 }),
    AgentToolError,
  );
  assert.equal(executionCount, 0);

  const requestingProvider = {
    async complete() {
      return { content: null, toolCalls: [{ id: "call-1", name: "read_fixture_status", arguments: { record_id: "fixture-001" } }], finishReason: "tool_calls" };
    },
  };
  await assert.rejects(
    runToolLoop(requestingProvider, "mock", [], [tool], { maxModelRequests: 2, maxToolActions: 0 }),
    AgentBudgetError,
  );
  assert.equal(executionCount, 0);
  await assert.rejects(
    runToolLoop({ async complete() { return finalCompletion(); } }, "mock", [], [], { maxModelRequests: 0, maxToolActions: 0 }),
    AgentBudgetError,
  );
});

test("tool loop rejects duplicate tool names and supports cancellation before requests", async () => {
  const tool = fixtureToolImplementation();
  await assert.rejects(
    runToolLoop({ async complete() { return finalCompletion(); } }, "mock", [], [tool, tool], { maxModelRequests: 1, maxToolActions: 0 }),
    AgentToolError,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runToolLoop({ async complete() { return finalCompletion(); } }, "mock", [], [], { maxModelRequests: 1, maxToolActions: 0, signal: controller.signal }),
    (error) => error instanceof ModelProviderError && error.kind === "cancelled",
  );
});
