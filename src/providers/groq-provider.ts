import Groq from "groq-sdk";
import type { ProviderConfiguration } from "../config/configuration.js";
import {
  ModelProviderError,
  parseProviderCompletion,
  type FunctionToolDefinition,
  type ProviderMessage,
  type ProviderRequest,
  type ModelProvider,
} from "./types.js";

type GroqCreateParams = Parameters<Groq["chat"]["completions"]["create"]>[0];
type GroqTransport = (request: GroqCreateParams, signal?: AbortSignal) => Promise<unknown>;

function toGroqMessages(messages: readonly ProviderMessage[]): Groq.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message): Groq.Chat.Completions.ChatCompletionMessageParam => {
    if (message.role === "system" || message.role === "user") {
      return { role: message.role, content: message.content };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    const toolCalls = message.toolCalls?.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
    return {
      role: "assistant",
      content: message.content,
      ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
    };
  });
}

function toGroqTools(tools: readonly FunctionToolDefinition[]): Groq.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: { ...tool.parameters.properties },
        required: [...tool.parameters.required],
        additionalProperties: false,
      },
    },
  }));
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = error.status;
  return typeof status === "number" ? status : undefined;
}

function classifyGroqError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) {
    return error;
  }
  if (error instanceof Error && (error.name === "APIUserAbortError" || error.name === "AbortError")) {
    return new ModelProviderError("cancelled");
  }
  const status = getHttpStatus(error);
  if (status === 401 || status === 403) {
    return new ModelProviderError("authentication");
  }
  if (status === 429) {
    return new ModelProviderError("quota");
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ModelProviderError("unsupported_tool");
  }
  return new ModelProviderError("unavailable");
}

export class GroqProvider implements ModelProvider {
  private readonly model: string;
  private readonly transport: GroqTransport;

  constructor(configuration: Extract<ProviderConfiguration, { kind: "groq" }>, transport?: GroqTransport) {
    this.model = configuration.model;
    if (transport !== undefined) {
      this.transport = transport;
      return;
    }
    // Tool workers share the CLI request budget; disable SDK-internal retries so
    // each outbound attempt is accounted for by that same ledger.
    const client = new Groq({ apiKey: configuration.apiKey, maxRetries: 0 });
    this.transport = async (request: GroqCreateParams, signal?: AbortSignal): Promise<unknown> => {
      return signal === undefined
        ? client.chat.completions.create(request)
        : client.chat.completions.create(request, { signal });
    };
  }

  async complete(request: ProviderRequest, signal?: AbortSignal) {
    if (signal?.aborted === true) {
      throw new ModelProviderError("cancelled");
    }
    try {
      const params: GroqCreateParams = {
        model: this.model,
        messages: toGroqMessages(request.messages),
        tools: toGroqTools(request.tools),
        tool_choice: request.tools.length === 0 ? "none" : "auto",
        max_completion_tokens: 512,
      };
      const response = await this.transport(params, signal);
      return parseProviderCompletion(response);
    } catch (error: unknown) {
      throw classifyGroqError(error);
    }
  }
}

