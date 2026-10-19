export interface FunctionToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

export interface FunctionToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export type ProviderMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls?: readonly FunctionToolCall[] }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

export interface ProviderRequest {
  readonly model: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools: readonly FunctionToolDefinition[];
  readonly toolChoice?: "auto" | "required";
}

export interface ProviderCompletion {
  readonly content: string | null;
  readonly toolCalls: readonly FunctionToolCall[];
  readonly finishReason: string;
}

export interface ModelProvider {
  complete(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderCompletion>;
}

export type ProviderErrorKind = "authentication" | "quota" | "unsupported_tool" | "unavailable" | "invalid_response" | "cancelled";

export class ModelProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind) {
    const messageByKind: Record<ProviderErrorKind, string> = {
      authentication: "The model provider rejected its configured credentials.",
      quota: "The model provider quota or rate limit was reached.",
      unsupported_tool: "The selected model or provider does not support the requested tool contract.",
      unavailable: "The model provider is unavailable.",
      invalid_response: "The model provider returned an invalid response.",
      cancelled: "The model request was cancelled.",
    };
    super(messageByKind[kind]);
    this.name = "ModelProviderError";
    this.kind = kind;
  }
}

export type ProviderTransport = (request: ProviderRequest, signal?: AbortSignal) => Promise<unknown>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProviderCompletion(value: unknown): ProviderCompletion {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_response");
  }
  const choices = value["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelProviderError("invalid_response");
  }
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice["message"])) {
    throw new ModelProviderError("invalid_response");
  }
  const message = choice["message"];
  const contentValue = message["content"];
  if (contentValue !== undefined && contentValue !== null && typeof contentValue !== "string") {
    throw new ModelProviderError("invalid_response");
  }
  if (typeof contentValue === "string" && contentValue.length > 16_000) {
    throw new ModelProviderError("invalid_response");
  }

  const callsValue = message["tool_calls"];
  const toolCalls: FunctionToolCall[] = [];
  if (callsValue !== undefined) {
    if (!Array.isArray(callsValue)) {
      throw new ModelProviderError("invalid_response");
    }
    for (const callValue of callsValue) {
      if (!isRecord(callValue) || !isRecord(callValue["function"])) {
        throw new ModelProviderError("invalid_response");
      }
      const id = callValue["id"];
      const name = callValue["function"]["name"];
      const rawArguments = callValue["function"]["arguments"];
      if (typeof id !== "string" || id.length === 0 || typeof name !== "string" || typeof rawArguments !== "string") {
        throw new ModelProviderError("invalid_response");
      }
      let parsedArguments: unknown;
      try {
        parsedArguments = JSON.parse(rawArguments);
      } catch {
        throw new ModelProviderError("invalid_response");
      }
      toolCalls.push({ id, name, arguments: parsedArguments });
    }
  }

  const finishReason = choice["finish_reason"];
  return {
    content: typeof contentValue === "string" ? contentValue : null,
    toolCalls,
    finishReason: typeof finishReason === "string" ? finishReason : "unknown",
  };
}
