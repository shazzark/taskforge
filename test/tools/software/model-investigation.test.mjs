import assert from "node:assert/strict";
import test from "node:test";
import { investigateSource, ModelInvestigationError } from "../../../dist/tools/software/model-investigation.js";
import { escapeTerminalControls } from "../../../dist/security/terminal-text.js";

test("model investigation sends only reviewed redacted excerpts and accepts bounded findings", async () => {
  let captured;
  const provider = {
    async complete(request) {
      captured = request;
      return { content: "Finding: sample.ts:1 has a concrete issue.", toolCalls: [], finishReason: "stop" };
    },
  };
  const findings = await investigateSource(provider, "fixture-model", [
    { path: "sample.ts", byteCount: 20, lineCount: 1, content: "const key = [REDACTED];" },
  ]);
  assert.match(findings, /concrete issue/u);
  assert.deepEqual(captured.tools, []);
  assert.match(captured.messages[1].content, /\[REDACTED\]/u);
  assert.doesNotMatch(captured.messages[0].content, /run tests/u);
});

test("model investigation rejects unbounded input, tool calls, and empty output", async () => {
  const provider = {
    async complete() {
      return { content: "", toolCalls: [{ id: "call-1" }], finishReason: "tool_calls" };
    },
  };
  await assert.rejects(investigateSource(provider, "fixture-model", [
    { path: "large.ts", byteCount: 25 * 1024, lineCount: 1, content: "x".repeat(25 * 1024) },
  ]), ModelInvestigationError);
  await assert.rejects(investigateSource(provider, "fixture-model", [
    { path: "unicode.ts", byteCount: 28 * 1024, lineCount: 1, content: "ðŸ˜€".repeat(7 * 1024) },
  ]), ModelInvestigationError);
  await assert.rejects(investigateSource(provider, "fixture-model", [
    { path: "sample.ts", byteCount: 1, lineCount: 1, content: "x" },
  ]), ModelInvestigationError);
});

test("model findings are escaped before terminal output can process control sequences", () => {
  assert.equal(escapeTerminalControls("finding\u001b[2J\r\nnext\tline"), "finding\\u001b[2J\\r\nnext\\tline");
});
