import Groq from "groq-sdk";
import type { ProviderConfiguration } from "../config.js";
import { ModelProviderError, type ProviderErrorKind } from "../providers/types.js";

const SUPPORTED_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-safeguard-20b",
]);
const MAX_QUERY_LENGTH = 512;
const MAX_ANSWER_LENGTH = 12_000;
const MAX_SOURCES = 10;
const MAX_SOURCE_TEXT_LENGTH = 1_000;

type SearchRequest = Parameters<Groq["chat"]["completions"]["create"]>[0];
export type BrowserSearchTransport = (request: SearchRequest, signal?: AbortSignal) => Promise<unknown>;

export interface ResearchSource {
  readonly title: string;
  readonly url: string;
  readonly excerpt: string;
}

export interface ResearchResult {
  readonly answer: string;
  readonly sources: readonly ResearchSource[];
  readonly citations: readonly ResearchCitation[];
  readonly uncitedStatements: readonly string[];
  readonly unmappedCitations: readonly string[];
  readonly retrievedAt: string;
  readonly model: string;
}

export interface ResearchCitation {
  readonly marker: string;
  readonly sourceIndex: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly source: ResearchSource;
}

export interface ResearchComparisonResult {
  readonly left: ResearchResult;
  readonly right: ResearchResult;
  readonly sharedSourceUrls: readonly string[];
}

export class BrowserSearchError extends Error {
  constructor(readonly kind: ProviderErrorKind) {
    super(`Browser research failed (${kind}).`);
    this.name = "BrowserSearchError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, limit);
}

function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048 || /[\u202A-\u202E\u2066-\u2069]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseSources(message: Record<string, unknown>): ResearchSource[] {
  const executedTools = message["executed_tools"];
  if (!Array.isArray(executedTools)) throw new BrowserSearchError("invalid_response");
  const sources: ResearchSource[] = [];
  const seenUrls = new Set<string>();
  for (const executedTool of executedTools) {
    if (!isRecord(executedTool) || executedTool["type"] !== "browser_search") {
      throw new BrowserSearchError("unsupported_tool");
    }
    const searchResults = executedTool["search_results"];
    const results = isRecord(searchResults) ? searchResults["results"] : undefined;
    if (Array.isArray(results)) {
      for (const result of results) {
        if (!isRecord(result)) continue;
        const url = safeSourceUrl(result["url"]);
        const title = nonEmptyText(result["title"], 300);
        if (url === undefined || title === undefined || seenUrls.has(url)) continue;
        seenUrls.add(url);
        sources.push({ title, url, excerpt: nonEmptyText(result["content"], MAX_SOURCE_TEXT_LENGTH) ?? "" });
        if (sources.length >= MAX_SOURCES) return sources;
      }
    }
    const browserResults = executedTool["browser_results"];
    if (Array.isArray(browserResults)) {
      for (const result of browserResults) {
        if (!isRecord(result)) continue;
        const url = safeSourceUrl(result["url"]);
        const title = nonEmptyText(result["title"], 300);
        if (url === undefined || title === undefined || seenUrls.has(url)) continue;
        seenUrls.add(url);
        sources.push({ title, url, excerpt: nonEmptyText(result["content"], MAX_SOURCE_TEXT_LENGTH) ?? "" });
        if (sources.length >= MAX_SOURCES) return sources;
      }
    }
  }
  return sources;
}

function parseCitations(answer: string, sources: readonly ResearchSource[]): {
  readonly citations: readonly ResearchCitation[];
  readonly uncitedStatements: readonly string[];
  readonly unmappedCitations: readonly string[];
} {
  const markerPattern = /〖(\d+)†L(\d+)(?:-L?(\d+))?〗/gu;
  const citations: ResearchCitation[] = [];
  const unmappedCitations: string[] = [];
  const cleanCitationOffsets: number[] = [];
  let removedMarkerCharacters = 0;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(answer)) !== null) {
    const sourceIndex = Number(match[1]);
    const lineStart = Number(match[2]);
    const lineEnd = Number(match[3] ?? match[2]);
    const marker = match[0];
    const source = Number.isSafeInteger(sourceIndex) && sourceIndex > 0 ? sources[sourceIndex - 1] : undefined;
    if (source === undefined || !Number.isSafeInteger(lineStart) || lineStart < 1 ||
        !Number.isSafeInteger(lineEnd) || lineEnd < lineStart || lineEnd > 100_000) {
      unmappedCitations.push(marker);
      continue;
    }
    citations.push({ marker, sourceIndex, lineStart, lineEnd, source });
    cleanCitationOffsets.push(match.index - removedMarkerCharacters);
    removedMarkerCharacters += marker.length;
  }
  const cleanAnswer = answer.replace(markerPattern, "");
  const sentences = Array.from(cleanAnswer.matchAll(/[^.!?]+(?:[.!?]+|$)/gu), (sentence) => {
    const raw = sentence[0] ?? "";
    const leadingWhitespace = raw.length - raw.trimStart().length;
    return { text: raw.trim(), start: (sentence.index ?? 0) + leadingWhitespace, end: (sentence.index ?? 0) + raw.length };
  }).filter((sentence) => sentence.text.length > 0);
  const uncitedStatements: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (sentence === undefined) continue;
    const nextSentenceStart = sentences[index + 1]?.start ?? cleanAnswer.length;
    const cited = cleanCitationOffsets.some((offset) => offset >= sentence.start && offset <= nextSentenceStart);
    if (!cited) uncitedStatements.push(sentence.text);
  }
  return { citations, uncitedStatements, unmappedCitations };
}

function parseResearchResponse(value: unknown, model: string): ResearchResult {
  if (!isRecord(value)) throw new BrowserSearchError("invalid_response");
  const choices = value["choices"];
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(choice) && isRecord(choice["message"]) ? choice["message"] : undefined;
  const answer = message === undefined ? undefined : nonEmptyText(message["content"], MAX_ANSWER_LENGTH);
  if (message === undefined || answer === undefined) throw new BrowserSearchError("invalid_response");
  const sources = parseSources(message);
  if (sources.length === 0) throw new BrowserSearchError("invalid_response");
  const citationEvidence = parseCitations(answer, sources);
  return { answer, sources, ...citationEvidence, retrievedAt: new Date().toISOString(), model };
}

function classifyError(error: unknown): BrowserSearchError {
  if (error instanceof BrowserSearchError) return error;
  if (error instanceof ModelProviderError) return new BrowserSearchError(error.kind);
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = error.status;
    if (status === 401 || status === 403) return new BrowserSearchError("authentication");
    if (status === 429) return new BrowserSearchError("quota");
    if (status === 400 || status === 404 || status === 422) return new BrowserSearchError("unsupported_tool");
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "APIUserAbortError")) {
    return new BrowserSearchError("cancelled");
  }
  return new BrowserSearchError("unavailable");
}

export class GroqBrowserResearch {
  private readonly transport: BrowserSearchTransport;
  private readonly model: string;

  constructor(configuration: Extract<ProviderConfiguration, { kind: "groq" }>, transport?: BrowserSearchTransport) {
    if (!SUPPORTED_MODELS.has(configuration.model)) throw new BrowserSearchError("unsupported_tool");
    this.model = configuration.model;
    if (transport !== undefined) {
      this.transport = transport;
      return;
    }
    const client = new Groq({ apiKey: configuration.apiKey });
    this.transport = (request, signal) => signal === undefined
      ? client.chat.completions.create(request)
      : client.chat.completions.create(request, { signal });
  }

  async search(query: string, signal?: AbortSignal): Promise<ResearchResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0 || normalizedQuery.length > MAX_QUERY_LENGTH) {
      throw new BrowserSearchError("invalid_response");
    }
    if (signal?.aborted === true) throw new BrowserSearchError("cancelled");
    try {
      const request: SearchRequest = {
        model: this.model,
        messages: [{ role: "user", content: normalizedQuery }],
        citation_options: "enabled",
        tools: [{ type: "browser_search" }],
        tool_choice: "required",
        max_completion_tokens: 1_024,
        reasoning_effort: "low",
      };
      return parseResearchResponse(await this.transport(request, signal), this.model);
    } catch (error: unknown) {
      throw classifyError(error);
    }
  }

  async compare(leftQuery: string, rightQuery: string, signal?: AbortSignal): Promise<ResearchComparisonResult> {
    if (leftQuery.trim().length === 0 || leftQuery.trim().length > MAX_QUERY_LENGTH ||
        rightQuery.trim().length === 0 || rightQuery.trim().length > MAX_QUERY_LENGTH) {
      throw new BrowserSearchError("invalid_response");
    }
    const left = await this.search(leftQuery, signal);
    const right = await this.search(rightQuery, signal);
    const rightUrls = new Set(right.sources.map((source) => source.url));
    const sharedSourceUrls = left.sources
      .filter((source) => rightUrls.has(source.url))
      .map((source) => source.url);
    return { left, right, sharedSourceUrls };
  }
}
