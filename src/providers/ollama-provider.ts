import type { ProviderConfiguration } from "../config/configuration.js";
import {
  ModelProviderError,
  isRecord,
  type FunctionToolDefinition,
  type ModelProvider,
  type ProviderMessage,
  type ProviderRequest,
} from "./types.js";

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function toOllamaMessages(messages: readonly ProviderMessage[]): Array<Record<string, unknown>> {
  const toolNames = new Map<string, string>();
  return messages.map((message) => {
    if (message.role === "system" || message.role === "user") {
      return { role: message.role, content: message.content };
    }
    if (message.role === "tool") {
      const name = toolNames.get(message.toolCallId);
      if (name === undefined) throw new ModelProviderError("invalid_response");
      return { role: "tool", tool_name: name, content: message.content };
    }
    const calls = message.toolCalls?.map((call) => {
      toolNames.set(call.id, call.name);
      return { function: { name: call.name, arguments: call.arguments } };
    });
    return { role: "assistant", content: message.content ?? "", ...(calls === undefined || calls.length === 0 ? {} : { tool_calls: calls }) };
  });
}

function toOllamaTools(tools: readonly FunctionToolDefinition[]): Array<Record<string, unknown>> {
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

function parseOllamaCompletion(value: unknown, callIdPrefix: number) {
  if (!isRecord(value) || !isRecord(value["message"])) throw new ModelProviderError("invalid_response");
  const message = value["message"];
  const content = message["content"];
  if (typeof content !== "string" || content.length > 16_000) throw new ModelProviderError("invalid_response");
  const rawCalls = message["tool_calls"];
  if (rawCalls !== undefined && !Array.isArray(rawCalls)) throw new ModelProviderError("invalid_response");
  const toolCalls = (rawCalls ?? []).map((call, index) => {
    if (!isRecord(call) || !isRecord(call["function"]) || typeof call["function"]["name"] !== "string") {
      throw new ModelProviderError("invalid_response");
    }
    return {
      id: `ollama-call-${callIdPrefix}-${index}`,
      name: call["function"]["name"],
      arguments: call["function"]["arguments"],
    };
  });
  const doneReason = value["done_reason"];
  return { content, toolCalls, finishReason: typeof doneReason === "string" ? doneReason : "unknown" };
}

export class OllamaProvider implements ModelProvider {
  private readonly configuration: Extract<ProviderConfiguration, { kind: "ollama" }>;
  private readonly fetchFunction: FetchFunction;
  private callSequence = 0;

  constructor(configuration: Extract<ProviderConfiguration, { kind: "ollama" }>, fetchFunction: FetchFunction = fetch) {
    this.configuration = configuration;
    this.fetchFunction = fetchFunction;
  }

  async complete(request: ProviderRequest, signal?: AbortSignal) {
    if (signal?.aborted === true) throw new ModelProviderError("cancelled");
    const body = {
      model: this.configuration.model,
      messages: toOllamaMessages(request.messages),
      ...(request.tools.length === 0 ? {} : { tools: toOllamaTools(request.tools) }),
      options: { num_ctx: this.configuration.contextLength },
      stream: false,
    };
    try {
      const response = await this.fetchFunction(`${this.configuration.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 404 || response.status === 422) throw new ModelProviderError("unsupported_tool");
        if (response.status === 429) throw new ModelProviderError("quota");
        throw new ModelProviderError("unavailable");
      }
      const responseText = await response.text();
      if (responseText.length > 1_000_000) throw new ModelProviderError("invalid_response");
      let result: unknown;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new ModelProviderError("invalid_response");
      }
      const callIdPrefix = this.callSequence;
      this.callSequence += 1;
      return parseOllamaCompletion(result, callIdPrefix);
    } catch (error: unknown) {
      if (error instanceof ModelProviderError) throw error;
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ModelProviderError("cancelled");
      throw new ModelProviderError("unavailable");
    }
  }
}
