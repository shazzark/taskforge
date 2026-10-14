import { AgentToolError, type AgentTool } from "./tool-loop.js";
import { isRecord } from "../providers/types.js";

const CSV_TOOL_ARGUMENT_KEYS = new Set(["input", "numericColumns"]);

export interface CsvAnalysisToolArguments {
  readonly input: string;
  readonly numericColumns: readonly string[];
}

export type CsvAnalysisToolExecutor = (
  argumentsValue: CsvAnalysisToolArguments,
  signal?: AbortSignal,
) => Promise<string>;

function parseCsvToolArguments(value: unknown): CsvAnalysisToolArguments {
  if (!isRecord(value)) throw new AgentToolError();
  const input = value["input"];
  if (Object.keys(value).some((key) => !CSV_TOOL_ARGUMENT_KEYS.has(key)) ||
      typeof input !== "string" || input.trim().length === 0 || input.length > 2_048) {
    throw new AgentToolError();
  }
  const numericColumnsValue = value["numericColumns"];
  if (numericColumnsValue !== undefined && !Array.isArray(numericColumnsValue)) throw new AgentToolError();
  const numericColumns: string[] = [];
  if (Array.isArray(numericColumnsValue)) {
    if (numericColumnsValue.length > 16) throw new AgentToolError();
    for (const column of numericColumnsValue) {
      if (typeof column !== "string" || column.trim().length === 0 || column.length > 256) throw new AgentToolError();
      numericColumns.push(column);
    }
  }
  if (new Set(numericColumns).size !== numericColumns.length) throw new AgentToolError();
  return { input, numericColumns };
}

export function createCsvAnalysisTool(execute: CsvAnalysisToolExecutor): AgentTool {
  return {
    definition: {
      name: "analyze_csv",
      description: "Analyze one CSV file after TaskForge asks the user for exact-file and stored-folder read approval. Never guess the path or numeric column.",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Exact path to one CSV file supplied by the user." },
          numericColumns: { type: "array", items: { type: "string" }, maxItems: 16, description: "Exact numeric header names explicitly requested by the user; omit when none were requested." },
        },
        required: ["input"],
        additionalProperties: false,
      },
    },
    validateArguments(value: unknown): CsvAnalysisToolArguments {
      return parseCsvToolArguments(value);
    },
    execute: async (argumentsValue, signal) => {
      return execute(parseCsvToolArguments(argumentsValue), signal);
    },
  };
}

export const TASKFORGE_AGENT_SYSTEM_MESSAGE = [
  "You are TaskForge, a local developer assistant.",
  "Use only tools explicitly supplied by the host. The only available action is analyze_csv.",
  "Do not claim to inspect files, websites, repositories, or services without a tool result.",
  "Never ask a tool to grant permissions or infer a file path or numeric column. Ask the user to clarify missing or ambiguous inputs in plain language.",
  "The host will request exact file-read approval before reading a CSV. A model tool call is not user approval.",
  "Do not claim a successful analysis unless the host tool returns a result. Keep the answer concise and separate observed values from suggestions.",
].join(" ");
