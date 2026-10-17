import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArchitectureReportError, createArchitectureReport } from "../dist/architecture-report.js";
import { WorkspacePathPolicy } from "../dist/security/path-policy.js";

test("architecture report cites actual inspected lines and labels inferences and coverage", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-architecture-report-"));
  try {
    await mkdir(join(rootPath, "src"));
    await writeFile(join(rootPath, "src", "entry.ts"), "import { run } from './worker.js';\nexport const start = run;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const report = await createArchitectureReport(root, policy, ["src/entry.ts"]);
    assert.deepEqual(report.coverage, {
      requestedFiles: 1, inspectedFiles: 1, analyzedFiles: 1, unsupportedFiles: 0,
      scope: "explicit-files-only", sourceExecution: false, redaction: "heuristic",
    });
    assert.deepEqual(report.files[0]?.observations.map((item) => [item.kind, item.evidence.path, item.evidence.line]), [
      ["import", "src/entry.ts", 1], ["export", "src/entry.ts", 2],
    ]);
    assert.equal(report.files[0]?.inferences[0]?.label, "inference");
    assert.ok(report.files[0]?.inferences[0]?.evidence.every((item) => item.line === 1));
    assert.equal(report.diagram.format, "mermaid-flowchart");
    assert.equal(report.diagram.edges.length, 1);
    assert.deepEqual(report.diagram.edges[0]?.evidence, { path: "src/entry.ts", line: 1 });
    assert.match(report.diagram.code, /^flowchart LR\n  file_1\n  file_1 --> module_1$/u);
    assert.equal(report.diagram.code.includes("./worker.js"), false);
    assert.ok(report.limitations.some((item) => item.includes("whole repository")));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("unsupported languages and missing evidence are explicit", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-architecture-unsupported-"));
  try {
    await writeFile(join(rootPath, "main.rs"), "use worker::run;\n", "utf8");
    await writeFile(join(rootPath, "empty.ts"), "// no module declarations\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const report = await createArchitectureReport(root, policy, ["main.rs", "empty.ts"]);
    assert.equal(report.coverage.unsupportedFiles, 1);
    assert.equal(report.files[0]?.status, "unsupported-language");
    assert.match(report.files[0]?.missingEvidence.join(" ") ?? "", /No architecture rules/u);
    assert.equal(report.files[1]?.status, "analyzed");
    assert.ok(report.files[1]?.missingEvidence.some((item) => item.includes("No import or export")));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("relative JavaScript and TypeScript imports resolve only to explicitly selected files", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-architecture-selected-resolution-"));
  try {
    await mkdir(join(rootPath, "src"));
    await writeFile(join(rootPath, "src", "entry.ts"), "import './worker.js';\nimport './util';\nimport 'node:fs';\n", "utf8");
    await writeFile(join(rootPath, "src", "worker.ts"), "export const worker = true;\n", "utf8");
    await writeFile(join(rootPath, "src", "util.ts"), "export const util = true;\n", "utf8");
    await writeFile(join(rootPath, "src", "unselected.ts"), "export const ignored = true;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const report = await createArchitectureReport(root, policy, ["src/entry.ts", "src/worker.ts", "src/util.ts"]);
    const source = report.diagram.nodes.find((node) => node.kind === "file" && node.value === "src/entry.ts");
    const worker = report.diagram.nodes.find((node) => node.kind === "file" && node.value === "src/worker.ts");
    const util = report.diagram.nodes.find((node) => node.kind === "file" && node.value === "src/util.ts");
    assert.ok(source);
    assert.ok(worker);
    assert.ok(util);
    assert.ok(report.diagram.edges.some((edge) => edge.from === source.id && edge.to === worker.id && edge.evidence.line === 1));
    assert.ok(report.diagram.edges.some((edge) => edge.from === source.id && edge.to === util.id && edge.evidence.line === 2));
    assert.ok(report.diagram.nodes.some((node) => node.kind === "module" && node.value === "node:fs"));
    assert.ok(report.limitations.some((item) => item.includes("exact selected files")));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("Windows path casing does not hide an explicitly selected import target", { skip: process.platform !== "win32" }, async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-architecture-windows-case-"));
  try {
    await mkdir(join(rootPath, "src"));
    await writeFile(join(rootPath, "src", "entry.ts"), "import './worker.js';\n", "utf8");
    await writeFile(join(rootPath, "src", "worker.ts"), "export const worker = true;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const report = await createArchitectureReport(root, policy, ["src/entry.ts", "SRC/WORKER.ts"]);
    const source = report.diagram.nodes.find((node) => node.kind === "file" && node.value === "src/entry.ts");
    const worker = report.diagram.nodes.find((node) => node.kind === "file" && node.value.toLowerCase() === "src/worker.ts");
    assert.ok(source);
    assert.ok(worker);
    assert.ok(report.diagram.edges.some((edge) => edge.from === source.id && edge.to === worker.id));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("Python import evidence resolves relative modules only inside the selected file set", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-architecture-python-"));
  try {
    await mkdir(join(rootPath, "pkg"));
    await writeFile(join(rootPath, "pkg", "entry.py"), "from .worker import run\nfrom .unselected import secret\nimport os, sys as system\n", "utf8");
    await writeFile(join(rootPath, "pkg", "worker.py"), "def run():\n    return True\n", "utf8");
    await writeFile(join(rootPath, "pkg", "unselected.py"), "secret = True\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const report = await createArchitectureReport(root, policy, ["pkg/entry.py", "pkg/worker.py"]);
    assert.equal(report.files[0]?.language, "Python");
    assert.equal(report.files[0]?.status, "analyzed");
    const source = report.diagram.nodes.find((node) => node.kind === "file" && node.value === "pkg/entry.py");
    const worker = report.diagram.nodes.find((node) => node.kind === "file" && node.value === "pkg/worker.py");
    assert.ok(source);
    assert.ok(worker);
    assert.ok(report.diagram.edges.some((edge) => edge.from === source.id && edge.to === worker.id && edge.evidence.line === 1));
    assert.ok(report.diagram.nodes.some((node) => node.kind === "module" && node.value === ".unselected"));
    assert.ok(report.diagram.nodes.some((node) => node.kind === "module" && node.value === "os"));
    assert.ok(report.diagram.nodes.some((node) => node.kind === "module" && node.value === "sys"));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("report reads only explicit approved files and uses existing secret redaction", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "taskforge-architecture-boundary-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "taskforge-architecture-outside-"));
  try {
    await writeFile(join(rootPath, "selected.ts"), "const apiKey = 'gsk_12345678901234567890';\nexport const ok = true;\n", "utf8");
    await writeFile(join(rootPath, "unselected.ts"), "import './must-not-be-read.js';\n", "utf8");
    await writeFile(join(outsidePath, "outside.ts"), "export const privateValue = true;\n", "utf8");
    const policy = new WorkspacePathPolicy();
    const root = await policy.approveRoot(rootPath);
    const report = await createArchitectureReport(root, policy, ["selected.ts"]);
    assert.deepEqual(report.files[0]?.observations.map((item) => item.kind), ["export"]);
    assert.equal(JSON.stringify(report).includes("gsk_12345678901234567890"), false);
    await assert.rejects(createArchitectureReport(root, policy, [join(outsidePath, "outside.ts")]), ArchitectureReportError);
    const unapprovedPolicy = new WorkspacePathPolicy();
    await assert.rejects(createArchitectureReport(root, unapprovedPolicy, ["selected.ts"]), ArchitectureReportError);
    await assert.rejects(createArchitectureReport(root, policy, []), ArchitectureReportError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
