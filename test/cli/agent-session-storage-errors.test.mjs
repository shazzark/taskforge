import assert from "node:assert/strict";
import test from "node:test";
import { createCliAgentTools } from "../../dist/cli/commands/agent-session.js";

function createCsvTool({ readApprovedInputFile, withStore }) {
  return createCliAgentTools(async () => "y", { readApprovedInputFile, withStore }, [])[0];
}

test("natural-language CSV reports storage outage without classifying it as a file denial", async () => {
  let storeCalls = 0;
  let fileReadWasAttempted = false;
  const tool = createCsvTool({
    readApprovedInputFile: async (_path, _question, _signal, reportFailure) => {
      fileReadWasAttempted = true;
      reportFailure("storage-unavailable");
      return undefined;
    },
    withStore: async () => {
      storeCalls += 1;
      return undefined;
    },
  });

  const result = await tool.execute({ input: "examples/amounts.csv", numericColumns: ["amount"] });
  assert.match(result, /selected storage is unavailable/u);
  assert.match(result, /file was not read/u);
  assert.doesNotMatch(result, /file access was denied/u);
  assert.equal(fileReadWasAttempted, true);
  assert.equal(storeCalls, 0);
});

test("natural-language CSV preserves a real file-approval denial", async () => {
  const tool = createCsvTool({
    readApprovedInputFile: async (_path, _question, _signal, reportFailure) => {
      reportFailure("denied");
      return undefined;
    },
    withStore: async () => undefined,
  });

  await assert.rejects(
    tool.execute({ input: "examples/amounts.csv", numericColumns: ["amount"] }),
    /CSV file access was denied or unavailable/u,
  );
});

test("natural-language CSV reports storage loss after file access separately", async () => {
  const tool = createCsvTool({
    readApprovedInputFile: async () => Buffer.from("item,amount\nNotebook,12\nPen,8\n"),
    withStore: async () => undefined,
  });

  const result = await tool.execute({ input: "examples/amounts.csv", numericColumns: ["amount"] });
  assert.match(result, /could not be recorded because the selected storage became unavailable after file access/u);
  assert.doesNotMatch(result, /file read denied/u);
});
