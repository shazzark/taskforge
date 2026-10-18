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
  readonly budget?: AgentBudgetLedger;
  readonly signal?: AbortSignal;
}

export interface AgentBudgetSnapshot {
  readonly modelRequests: number;
  readonly toolActions: number;
  readonly modelRequestsRemaining: number;
  readonly toolActionsRemaining: number;
}

export class AgentBudgetLedger {
  readonly maxModelRequests: number;
  readonly maxToolActions: number;
  private modelRequests = 0;
  private toolActions = 0;

  constructor(maxModelRequests = MAX_ALLOWED_MODEL_REQUESTS, maxToolActions = MAX_ALLOWED_TOOL_ACTIONS) {
    if (!Number.isInteger(maxModelRequests) || maxModelRequests < 1 || maxModelRequests > MAX_ALLOWED_MODEL_REQUESTS ||
        !Number.isInteger(maxToolActions) || maxToolActions < 0 || maxToolActions > MAX_ALLOWED_TOOL_ACTIONS) {
      throw new AgentBudgetError();
    }
    this.maxModelRequests = maxModelRequests;
    this.maxToolActions = maxToolActions;
  }

  consumeModelRequest(): boolean {
    if (this.modelRequests >= this.maxModelRequests) return false;
    this.modelRequests += 1;
    return true;
  }

  consumeToolActions(count = 1): boolean {
    if (!Number.isInteger(count) || count < 0 || this.toolActions + count > this.maxToolActions) return false;
    this.toolActions += count;
    return true;
  }

  snapshot(): AgentBudgetSnapshot {
    return {
      modelRequests: this.modelRequests,
      toolActions: this.toolActions,
      modelRequestsRemaining: this.maxModelRequests - this.modelRequests,
      toolActionsRemaining: this.maxToolActions - this.toolActions,
    };
  }
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

export class AgentToolInputError extends AgentToolError {
  constructor() {
    super();
    this.name = "AgentToolInputError";
  }
}

const MAX_TOOL_RESULT_CHARACTERS = 16_000;
const MAX_ALLOWED_MODEL_REQUESTS = 40;
const MAX_ALLOWED_TOOL_ACTIONS = 30;
const INVALID_TOOL_INPUT_RESULT = "The requested action was not run because required details were missing or invalid. Ask the user to clarify the exact file and requested fields, then retry only with their explicit details.";
const INPUT_CLARIFICATION_RESPONSE = "I need the exact file and requested fields before I can safely continue. Please clarify them and try again.";

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
  const budget = options.budget ?? new AgentBudgetLedger(options.maxModelRequests, options.maxToolActions);
  if (options.maxModelRequests > budget.maxModelRequests || options.maxToolActions > budget.maxToolActions) throw new AgentBudgetError();
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
    if (!budget.consumeModelRequest()) throw new AgentBudgetError();
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
    if (toolActions + completion.toolCalls.length > options.maxToolActions || !budget.consumeToolActions(completion.toolCalls.length)) {
      throw new AgentBudgetError();
    }

    messages.push({
      role: "assistant",
      content: completion.content,
      toolCalls: completion.toolCalls,
    });
    const validatedCalls: { readonly name: string; readonly tool: AgentTool; readonly argumentsValue: unknown }[] = [];
    let inputRejected = false;
    for (const call of completion.toolCalls) {
      const tool = toolsByName.get(call.name);
      if (tool === undefined) {
        throw new AgentToolError();
      }
      let validatedArguments: unknown;
      try {
        validatedArguments = tool.validateArguments(call.arguments);
      } catch (error: unknown) {
        if (error instanceof AgentToolInputError) {
          inputRejected = true;
          validatedCalls.push({ name: call.name, tool, argumentsValue: undefined });
          continue;
        }
        throw new AgentToolError();
      }
      validatedCalls.push({ name: call.name, tool, argumentsValue: validatedArguments });
    }
    if (inputRejected) {
      for (const call of completion.toolCalls) {
        messages.push({ role: "tool", toolCallId: call.id, content: INVALID_TOOL_INPUT_RESULT });
      }
      if (modelRequests === options.maxModelRequests) {
        return {
          content: INPUT_CLARIFICATION_RESPONSE,
          modelRequests,
          toolActions,
          toolNames: calledToolNames,
        };
      }
      continue;
    }
    for (const [index, call] of completion.toolCalls.entries()) {
      const validated = validatedCalls[index];
      if (validated === undefined) throw new AgentToolError();
      let output: string;
      try {
        output = options.signal === undefined
          ? await validated.tool.execute(validated.argumentsValue)
          : await validated.tool.execute(validated.argumentsValue, options.signal);
      } catch {
        throw new AgentToolError();
      }
      if (typeof output !== "string" || output.length > MAX_TOOL_RESULT_CHARACTERS) {
        throw new AgentToolError();
      }
      messages.push({ role: "tool", toolCallId: call.id, content: output });
    }
    calledToolNames.push(...completion.toolCalls.map((call) => call.name));
    toolActions += completion.toolCalls.length;
  }
  throw new AgentBudgetError();
}
