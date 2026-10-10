import {
  ModelProviderError,
  type FunctionToolDefinition,
  type ModelProvider,
  type ProviderMessage,
} from "../providers/types.js";

export interface AgentTool {
  readonly definition: FunctionToolDefinition;
  validateArguments(value: unknown): unknown;
  execute(argumentsValue: unknown, signal?: AbortSignal): Promise<string>;
}

export interface AgentRunOptions {
  readonly maxModelRequests: number;
  readonly maxToolActions: number;
  readonly signal?: AbortSignal;
}

export interface AgentRunResult {
  readonly content: string;
  readonly modelRequests: number;
  readonly toolActions: number;
  readonly toolNames: readonly string[];
}

export class AgentBudgetError extends Error {
  constructor() {
    super("The model run reached its configured action budget.");
    this.name = "AgentBudgetError";
  }
}

export class AgentToolError extends Error {
  constructor() {
    super("The model requested an unknown or invalid tool action.");
    this.name = "AgentToolError";
  }
}

const MAX_TOOL_RESULT_CHARACTERS = 16_000;
const MAX_ALLOWED_MODEL_REQUESTS = 40;
const MAX_ALLOWED_TOOL_ACTIONS = 30;

export async function runToolLoop(
  provider: ModelProvider,
  model: string,
  initialMessages: readonly ProviderMessage[],
  tools: readonly AgentTool[],
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  if (
    !Number.isInteger(options.maxModelRequests) ||
    options.maxModelRequests < 1 ||
    options.maxModelRequests > MAX_ALLOWED_MODEL_REQUESTS ||
    !Number.isInteger(options.maxToolActions) ||
    options.maxToolActions < 0 ||
    options.maxToolActions > MAX_ALLOWED_TOOL_ACTIONS
  ) {
    throw new AgentBudgetError();
  }

  const messages: ProviderMessage[] = [...initialMessages];
  const toolsByName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  if (toolsByName.size !== tools.length) {
    throw new AgentToolError();
  }
  const definitions = tools.map((tool) => tool.definition);
  const calledToolNames: string[] = [];
  let toolActions = 0;

  for (let modelRequests = 1; modelRequests <= options.maxModelRequests; modelRequests += 1) {
    if (options.signal?.aborted === true) {
      throw new ModelProviderError("cancelled");
    }
    const request = {
      model,
      messages,
      tools: definitions,
    };
    const completion = options.signal === undefined
      ? await provider.complete(request)
      : await provider.complete(request, options.signal);
    if (completion.toolCalls.length === 0) {
      return {
        content: completion.content ?? "",
        modelRequests,
        toolActions,
        toolNames: calledToolNames,
      };
    }
    if (toolActions + completion.toolCalls.length > options.maxToolActions) {
      throw new AgentBudgetError();
    }

    messages.push({
      role: "assistant",
      content: completion.content,
      toolCalls: completion.toolCalls,
    });
    for (const call of completion.toolCalls) {
      const tool = toolsByName.get(call.name);
      if (tool === undefined) {
        throw new AgentToolError();
      }
      let validatedArguments: unknown;
      try {
        validatedArguments = tool.validateArguments(call.arguments);
      } catch {
        throw new AgentToolError();
      }
      let output: string;
      try {
        output = options.signal === undefined
          ? await tool.execute(validatedArguments)
          : await tool.execute(validatedArguments, options.signal);
      } catch {
        throw new AgentToolError();
      }
      if (typeof output !== "string" || output.length > MAX_TOOL_RESULT_CHARACTERS) {
        throw new AgentToolError();
      }
      messages.push({ role: "tool", toolCallId: call.id, content: output });
      calledToolNames.push(call.name);
      toolActions += 1;
    }
  }
  throw new AgentBudgetError();
}
