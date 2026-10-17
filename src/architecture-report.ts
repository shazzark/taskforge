import { extname, resolve } from "node:path";
import type { ApprovedRoot, WorkspacePathPolicy } from "./security/path-policy.js";
import { SourceReviewError, reviewSourceFiles } from "./workflows/source-review-workflow.js";

const MAX_FILES = 20;
const MAX_DIAGRAM_EDGES = 200;
const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

export interface ArchitectureEvidence {
  readonly path: string;
  readonly line: number;
}

export interface ArchitectureObservation {
  readonly kind: "import" | "export";
  readonly description: string;
  readonly target: string | null;
  readonly evidence: ArchitectureEvidence;
}

export interface ArchitectureInference {
  readonly label: "inference";
  readonly description: string;
  readonly evidence: readonly ArchitectureEvidence[];
}

export interface ArchitectureFileReport {
  readonly path: string;
  readonly language: string;
  readonly status: "analyzed" | "unsupported-language";
  readonly observations: readonly ArchitectureObservation[];
  readonly inferences: readonly ArchitectureInference[];
  readonly missingEvidence: readonly string[];
}

export interface ArchitectureReport {
  readonly coverage: {
    readonly requestedFiles: number;
    readonly inspectedFiles: number;
    readonly analyzedFiles: number;
    readonly unsupportedFiles: number;
    readonly scope: "explicit-files-only";
    readonly sourceExecution: false;
    readonly redaction: "heuristic";
  };
  readonly files: readonly ArchitectureFileReport[];
  readonly diagram: {
    readonly format: "mermaid-flowchart";
    readonly code: string;
    readonly nodes: readonly { readonly id: string; readonly kind: "file" | "module"; readonly value: string }[];
    readonly edges: readonly { readonly from: string; readonly to: string; readonly evidence: ArchitectureEvidence }[];
    readonly truncated: boolean;
  };
  readonly limitations: readonly string[];
}

export class ArchitectureReportError extends Error {
  constructor(message = "The selected architecture-report files could not be inspected safely.") {
    super(message);
    this.name = "ArchitectureReportError";
  }
}

function languageFor(extension: string): string {
  switch (extension) {
    case ".js": case ".jsx": case ".mjs": case ".cjs": return "JavaScript";
    case ".ts": case ".tsx": case ".mts": case ".cts": return "TypeScript";
    case ".py": return "Python";
    case ".go": return "Go";
    case ".rs": return "Rust";
    case ".java": return "Java";
    case ".cs": return "C#";
    case ".rb": return "Ruby";
    case ".php": return "PHP";
    default: return "unrecognized or non-source file";
  }
}

function analyzeFile(path: string, content: string): ArchitectureFileReport {
  const extension = extname(path).toLowerCase();
  const language = languageFor(extension);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return {
      path,
      language,
      status: "unsupported-language",
      observations: [],
      inferences: [],
      missingEvidence: [`No architecture rules are defined for ${language}.`],
    };
  }

  const observations: ArchitectureObservation[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const evidence = { path, line: index + 1 };
    const imports = line.matchAll(/\bimport\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu);
    for (const match of imports) {
      const specifier = match[1] ?? match[2];
      if (specifier !== undefined) observations.push({ kind: "import", description: `Imports ${specifier}.`, target: specifier, evidence });
    }
    if (/^\s*export\s+(?:default\b|\{\b|(?:async\s+)?(?:class|function|const|let|var|type|interface|enum)\b)/u.test(line)) {
      observations.push({ kind: "export", description: "Declares an export.", target: null, evidence });
    }
  }

  const imported = observations.filter((entry) => entry.kind === "import");
  const inferences: ArchitectureInference[] = imported.length > 0
    ? [{
      label: "inference",
      description: "This file depends on one or more imported modules; runtime coupling and architectural role are not established by these lines alone.",
      evidence: imported.map((entry) => entry.evidence),
    }]
    : [];
  const missingEvidence: string[] = [];
  if (observations.length === 0) missingEvidence.push("No import or export declarations were recognized in the inspected lines.");
  if (imported.length === 0) missingEvidence.push("No module dependency evidence was found; this does not establish that the file has no runtime dependencies.");
  if (!observations.some((entry) => entry.kind === "export")) missingEvidence.push("No export declaration was recognized; this does not establish that the file is unused.");

  return { path, language, status: "analyzed", observations, inferences, missingEvidence };
}

/** Analyze only caller-selected files beneath an already approved root. */
export async function createArchitectureReport(
  root: ApprovedRoot,
  policy: WorkspacePathPolicy,
  requestedPaths: unknown,
): Promise<ArchitectureReport> {
  if (!Array.isArray(requestedPaths) || requestedPaths.length < 1 || requestedPaths.length > MAX_FILES ||
      requestedPaths.some((value: unknown) => typeof value !== "string" || value.trim().length === 0)) {
    throw new ArchitectureReportError("Select between 1 and 20 explicit files.");
  }
  if (!policy.listApprovedRoots().some((entry) => resolve(entry.path) === resolve(root.path))) {
    throw new ArchitectureReportError("Repository root approval is required before analysis.");
  }

  let reviewed;
  try {
    reviewed = await reviewSourceFiles(root, policy, requestedPaths);
  } catch (error: unknown) {
    if (error instanceof SourceReviewError) throw new ArchitectureReportError(error.message);
    throw new ArchitectureReportError();
  }
  const files = reviewed.map((file) => analyzeFile(file.path.replaceAll("\\", "/"), file.content));
  const nodes: { id: string; kind: "file" | "module"; value: string }[] = [];
  const edges: { from: string; to: string; evidence: ArchitectureEvidence }[] = [];
  const fileIds = new Map<string, string>();
  for (const file of files) {
    const id = `file_${fileIds.size + 1}`;
    fileIds.set(file.path, id);
    nodes.push({ id, kind: "file", value: file.path });
  }
  const moduleIds = new Map<string, string>();
  let truncated = false;
  for (const file of files) {
    const from = fileIds.get(file.path);
    if (from === undefined) continue;
    for (const observation of file.observations) {
      if (observation.kind !== "import" || observation.target === null) continue;
      if (edges.length >= MAX_DIAGRAM_EDGES) {
        truncated = true;
        break;
      }
      let to = moduleIds.get(observation.target);
      if (to === undefined) {
        to = `module_${moduleIds.size + 1}`;
        moduleIds.set(observation.target, to);
        nodes.push({ id: to, kind: "module", value: observation.target });
      }
      edges.push({ from, to, evidence: observation.evidence });
    }
    if (truncated) break;
  }
  const diagramLines = ["flowchart LR", ...nodes.filter((node) => node.kind === "file").map((node) => `  ${node.id}`), ...edges.map((edge) => `  ${edge.from} --> ${edge.to}`)];
  return {
    coverage: {
      requestedFiles: requestedPaths.length,
      inspectedFiles: reviewed.length,
      analyzedFiles: files.filter((file) => file.status === "analyzed").length,
      unsupportedFiles: files.filter((file) => file.status === "unsupported-language").length,
      scope: "explicit-files-only",
      sourceExecution: false,
      redaction: "heuristic",
    },
    files,
    diagram: { format: "mermaid-flowchart", code: diagramLines.join("\n"), nodes, edges, truncated },
    limitations: [
      "Only explicitly selected files were read; this report does not represent the whole repository.",
      "Import/export detection is line-based and heuristic; dynamic loading, generated code, and runtime behavior are not analyzed.",
      "Evidence identifies inspected file lines. It does not prove semantic correctness, reachability, or runtime architecture.",
      "The generated diagram is a bounded import graph for the selected files; module specifiers are not resolved to prove that they identify repository files.",
      "Common credential patterns are redacted heuristically; other secrets may remain visible.",
      "Source files are never executed.",
    ],
  };
}
