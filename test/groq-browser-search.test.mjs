import assert from "node:assert/strict";
import test from "node:test";
import { BrowserSearchError, GroqBrowserResearch } from "../dist/integrations/groq-browser-search.js";

const configuration = { kind: "groq", apiKey: "test-key", model: "openai/gpt-oss-20b" };
const validResponse = {
  choices: [{ message: {
    content: "A bounded answer.",
    executed_tools: [{
      type: "browser_search",
      search_results: { results: [
        { title: "Official result", url: "https://example.com/doc", content: "Evidence excerpt." },
        { title: "Unsafe URL", url: "http://example.com/unsafe", content: "discarded" },
      ] },
    }],
  } }],
};

test("Groq browser research requests only browser search and returns validated bounded sources", async () => {
  let request;
  const research = new GroqBrowserResearch(configuration, async (value) => {
    request = value;
    return validResponse;
  });
  const result = await research.search("  official browser search docs  ");
  assert.equal(request.messages[0].content, "official browser search docs");
  assert.deepEqual(request.tools, [{ type: "browser_search" }]);
  assert.equal(request.tool_choice, "required");
  assert.equal(request.model, "openai/gpt-oss-20b");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://example.com/doc");
  assert.equal(result.sources[0].excerpt, "Evidence excerpt.");
  assert.equal(result.model, configuration.model);
  assert.match(result.retrievedAt, /^\d{4}-\d\d-\d\dT/u);
});

test("browser research uses the selected model consistently when it is on the supported allowlist", async () => {
  const configurationWith120B = { ...configuration, model: "openai/gpt-oss-120b" };
  const research = new GroqBrowserResearch(configurationWith120B, async (request) => {
    assert.equal(request.model, configurationWith120B.model);
    return validResponse;
  });
  const result = await research.search("supported model check");
  assert.equal(result.model, configurationWith120B.model);
});

test("browser research rejects unsupported models, invalid queries, unsafe tool execution and missing sources", async () => {
  assert.throws(() => new GroqBrowserResearch({ ...configuration, model: "llama-3" }), BrowserSearchError);
  const research = new GroqBrowserResearch(configuration, async () => validResponse);
  await assert.rejects(research.search(" "), BrowserSearchError);
  await assert.rejects(research.search("x".repeat(513)), BrowserSearchError);
  await assert.rejects(new GroqBrowserResearch(configuration, async () => ({
    choices: [{ message: { content: "answer", executed_tools: [{ type: "code_interpreter" }] } }],
  })).search("query"), (error) => error instanceof BrowserSearchError && error.kind === "unsupported_tool");
  await assert.rejects(new GroqBrowserResearch(configuration, async () => ({
    choices: [{ message: { content: "answer", executed_tools: [] } }],
  })).search("query"), (error) => error instanceof BrowserSearchError && error.kind === "invalid_response");
});

test("browser research maps provider errors without leaking their raw message and respects cancellation", async () => {
  const research = new GroqBrowserResearch(configuration, async () => {
    throw Object.assign(new Error("secret-bearing upstream detail"), { status: 429 });
  });
  await assert.rejects(research.search("query"), (error) => {
    assert.ok(error instanceof BrowserSearchError);
    assert.equal(error.kind, "quota");
    assert.equal(error.message.includes("secret-bearing"), false);
    return true;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(research.search("query", controller.signal), (error) => error instanceof BrowserSearchError && error.kind === "cancelled");
});
