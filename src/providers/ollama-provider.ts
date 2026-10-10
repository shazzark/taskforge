import type { ProviderConfiguration } from "../config.js";
import {
  ModelProviderError,
  parseProviderCompletion,
  type FunctionToolDefinition,
  type ModelProvider,
  type ProviderMessage,
  type ProviderRequest,
} from "./types.js";

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function toOpenAIMessages(messages: readonly ProviderMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "system" || message.role === "user") {
      return { role: message.role, content: message.content };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    const toolCalls = message.toolCalls?.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
    return {
      role: "assistant",
      content: message.content,
      ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
    };
  });
}

function toOpenAITools(tools: readonly FunctionToolDefinition[]): Array<Record<string, unknown>> {
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

export class OllamaProvider implements ModelProvider {
  private readonly configuration: Extract<ProviderConfiguration, { kind: "ollama" }>;
  private readonly fetchFunction: FetchFunction;

  constructor(configuration: Extract<ProviderConfiguration, { kind: "ollama" }>, fetchFunction: FetchFunction = fetch) {
    this.configuration = configuration;
    this.fetchFunction = fetchFunction;
  }

  async complete(request: ProviderRequest, signal?: AbortSignal) {
    if (signal?.aborted === true) {
      throw new ModelProviderError("cancelled");
    }
    const body = {
      model: this.configuration.model,
      messages: toOpenAIMessages(request.messages),
      ...(request.tools.length === 0 ? {} : { tools: toOpenAITools(request.tools), tool_choice: "auto" }),
      max_tokens: 512,
      stream: false,
    };
    try {
      const response = await this.fetchFunction(`${this.configuration.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 404 || response.status === 422) {
          throw new ModelProviderError("unsupported_tool");
        }
        if (response.status === 429) {
          throw new ModelProviderError("quota");
        }
        throw new ModelProviderError("unavailable");
      }
      const responseText = await response.text();
      if (responseText.length > 1_000_000) {
        throw new ModelProviderError("invalid_response");
      }
      let result: unknown;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new ModelProviderError("invalid_response");
      }
      return parseProviderCompletion(result);
    } catch (error: unknown) {
      if (error instanceof ModelProviderError) {
        throw error;
      }
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new ModelProviderError("cancelled");
      }
      throw new ModelProviderError("unavailable");
    }
  }
}
