import assert from "node:assert/strict";
import test from "node:test";
import { parseTextDocument, TextDocumentError } from "../dist/documents/text-parser.js";

test("normalizes a BOM and Windows line endings while counting text", () => {
  const result = parseTextDocument("\uFEFFHello world\r\nSecond line\r\n", "txt");
  assert.equal(result.text, "Hello world\nSecond line\n");
  assert.equal(result.lineCount, 2);
  assert.equal(result.wordCount, 4);
  assert.deepEqual(result.headings, []);
});

test("extracts Markdown ATX headings and ignores fenced-code headings", () => {
  const result = parseTextDocument([
    "# Title",
    "",
    "~~~md",
    "## Not a heading inside a fence",
    "~~~",
    "  ### Actual heading ###",
    "```",
    "# Still fenced",
    "```",
    "###### Final",
  ].join("\n"), "markdown");
  assert.deepEqual(result.headings, [
    { level: 1, text: "Title", line: 1 },
    { level: 3, text: "Actual heading", line: 6 },
    { level: 6, text: "Final", line: 10 },
  ]);
});

test("rejects unsupported formats, binary NULs, wrong types and oversized input", () => {
  assert.throws(() => parseTextDocument(2, "txt"), TextDocumentError);
  assert.throws(() => parseTextDocument("data\u0000data", "txt"), TextDocumentError);
  assert.throws(() => parseTextDocument("content", "docx"), TextDocumentError);
  assert.throws(() => parseTextDocument("x".repeat(8 * 1024 * 1024 + 1), "txt"), TextDocumentError);
});
