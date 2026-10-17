import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCsv, CsvAnalysisError } from "../../../dist/tools/data/csv-analysis.js";

test("analyzes BOM, CRLF, quoted delimiters, embedded newlines and escaped quotes", () => {
  const content = "\uFEFFname,amount,notes\r\nalpha,0.10,\"contains,comma\"\r\nbeta,2.20,\"line one\r\nline two\"\r\nbeta,2.20,\"line one\r\nline two\"\r\ngamma,-0.30,\"He said \"\"hi\"\"\"\r\n";
  const result = analyzeCsv(content, { numericColumns: ["amount"] });
  assert.deepEqual(result.headers, ["name", "amount", "notes"]);
  assert.equal(result.rowCount, 4);
  assert.equal(result.duplicateRowCount, 1);
  assert.equal(result.missingValues.notes, 0);
  assert.equal(result.numericTotals.amount, "4.2");
});

test("uses exact decimal accumulation and reports missing cells", () => {
  const result = analyzeCsv("id,amount,comment\n1,0.1,\n2,0.2,ready\n3,,ready\n", { numericColumns: ["amount"] });
  assert.equal(result.numericTotals.amount, "0.3");
  assert.equal(result.missingValues.amount, 1);
  assert.equal(result.missingValues.comment, 1);
  assert.equal(result.rowCount, 3);
  assert.equal(result.duplicateRowCount, 0);
});

test("numeric totals safely preserve prototype-named headers", () => {
  const result = analyzeCsv("__proto__\n1\n2\n", { numericColumns: ["__proto__"] });
  assert.equal(Object.hasOwn(result.numericTotals, "__proto__"), true);
  assert.equal(result.numericTotals["__proto__"], "3");
});

test("supports exponent notation and rejects selected non-numeric values", () => {
  const valid = analyzeCsv("value\n1e2\n-0.25\n", { numericColumns: ["value"] });
  assert.equal(valid.numericTotals.value, "99.75");
  assert.throws(
    () => analyzeCsv("value\n1,2\n", { numericColumns: ["value"] }),
    (error) => error instanceof CsvAnalysisError && /different number of fields/u.test(error.message),
  );
  assert.throws(() => analyzeCsv("value\n1\nnope\n", { numericColumns: ["value"] }), CsvAnalysisError);
});

test("rejects malformed quoting, duplicate headers, invalid selection and wrong input types", () => {
  for (const content of [
    "a\n\"unterminated",
    "a\n\"quoted\"trailing",
    "a,A\n1,2\n",
    "\n",
  ]) {
    assert.throws(() => analyzeCsv(content, { numericColumns: [] }), CsvAnalysisError);
  }
  assert.throws(() => analyzeCsv("a\n1\n", { numericColumns: ["missing"] }), CsvAnalysisError);
  assert.throws(() => analyzeCsv("a\n1\n", { numericColumns: ["a", "a"] }), CsvAnalysisError);
  assert.throws(() => analyzeCsv("a\n1\n", { numericColumns: [1] }), CsvAnalysisError);
  assert.throws(() => analyzeCsv("a\n1\n", null), CsvAnalysisError);
  assert.throws(() => analyzeCsv(42, { numericColumns: [] }), CsvAnalysisError);
});

test("enforces input, record, column, and decimal-value limits", () => {
  assert.throws(() => analyzeCsv("x".repeat(8 * 1024 * 1024 + 1), { numericColumns: [] }), CsvAnalysisError);
  assert.throws(() => analyzeCsv(`${"value\n1\n".repeat(50_001)}`, { numericColumns: [] }), CsvAnalysisError);
  assert.throws(() => analyzeCsv(`${Array.from({ length: 257 }, (_, index) => `h${index}`).join(",")}\n`, { numericColumns: [] }), CsvAnalysisError);
  assert.throws(() => analyzeCsv(`amount\n${"9".repeat(101)}\n`, { numericColumns: ["amount"] }), CsvAnalysisError);
});
