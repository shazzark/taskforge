import assert from "node:assert/strict";
import test from "node:test";
import {
  isIncompleteActionResponse,
  isIncompleteOneShotResult,
  shouldRequireAnalysisTool,
} from "../dist/agent/natural-language-policy.js";

test("an explicit supported-file analysis asks the provider to select a host tool", () => {
  assert.equal(shouldRequireAnalysisTool("Analyze examples/amounts.csv and report the row count and exact total of the amount column."), true);
  assert.equal(shouldRequireAnalysisTool("Please summarize C:\\data\\quarter report.xlsx."), true);
});

test("ambiguous or unsupported requests retain normal clarification behavior", () => {
  assert.equal(shouldRequireAnalysisTool("Analyze a CSV and report its row count."), false);
  assert.equal(shouldRequireAnalysisTool("Which column should I total in examples/amounts.csv?"), false);
  assert.equal(shouldRequireAnalysisTool("Analyze examples/archive.zip and report its contents."), false);
});

test("approval and clarification text is incomplete whether or not a tool action ran", () => {
  assert.equal(isIncompleteActionResponse("Could you please provide approval to read the file examples/amounts.csv?"), true);
  assert.equal(isIncompleteActionResponse("Which column should I sum?"), true);
  assert.equal(isIncompleteOneShotResult("Could you please provide approval to read this file?", 0, false), true);
  assert.equal(isIncompleteOneShotResult("Which column should I sum?", 0, false), true);
  assert.equal(isIncompleteOneShotResult("Could you please provide approval to read this file?", 1, true), true);
  assert.equal(isIncompleteOneShotResult("Which column should I sum?", 1, true), true);
  assert.equal(isIncompleteOneShotResult("The CSV analysis found 2 rows and amount=20.", 1, true), false);
  assert.equal(isIncompleteOneShotResult("The CSV analysis found 2 rows and amount=20. Would you like another breakdown?", 1, true), false);
  assert.equal(isIncompleteOneShotResult("Here is how CSV totals work.", 0, false), false);
  assert.equal(isIncompleteOneShotResult("The request needs a tool.", 0, true), true);
});
