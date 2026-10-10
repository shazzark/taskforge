import assert from "node:assert/strict";
import JSZip from "jszip";
import test from "node:test";
import { DocxParserError, parseDocxText } from "../dist/documents/docx-parser.js";

async function createDocx(documentXml) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("extracts bounded paragraph text, tabs, breaks, and XML character references", async () => {
  const bytes = await createDocx(
    "<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>Alpha &amp; &#x03B2;</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three</w:t></w:r></w:p><w:p><w:r><w:t>last</w:t></w:r></w:p></w:body></w:document>",
  );
  assert.equal(await parseDocxText(bytes), "Alpha & β\ttwo\nthree\nlast\n");
});

test("rejects malformed, oversized, and DTD-bearing DOCX inputs", async () => {
  await assert.rejects(parseDocxText("not bytes"), DocxParserError);
  await assert.rejects(parseDocxText(new Uint8Array(8 * 1024 * 1024 + 1)), DocxParserError);
  await assert.rejects(parseDocxText(Buffer.from("not a zip archive")), DocxParserError);
  await assert.rejects(
    parseDocxText(await createDocx("<!DOCTYPE w:document [<!ENTITY x 'expanded'>]><w:document><w:t>&x;</w:t></w:document>")),
    DocxParserError,
  );
  await assert.rejects(parseDocxText(await createDocx("<w:document><w:t>broken</w:document>")), DocxParserError);
});
