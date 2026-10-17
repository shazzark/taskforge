import { ConfigurationError, type ProviderConfiguration } from "../config/configuration.js";
import { GroqProvider } from "./groq-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import type { ModelProvider } from "./types.js";

export function createModelProvider(providerConfiguration: ProviderConfiguration): { readonly model: string; readonly provider: ModelProvider } {
  if (providerConfiguration.kind === "groq") {
    return { model: providerConfiguration.model, provider: new GroqProvider(providerConfiguration) };
  }
  return { model: providerConfiguration.model, provider: new OllamaProvider(providerConfiguration) };
}
