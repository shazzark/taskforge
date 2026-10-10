import { randomUUID } from "node:crypto";
import type { MongoStore, RunSummary } from "../mongo-store.js";

const WORKFLOW_ID = "browser-fixture-audit";
const STEP_ID = "audit-local-page";
const MAX_PAGE_TIMEOUT_MS = 8_000;
const MAX_LINKS_TO_CHECK = 25;
const MAX_LINK_TIMEOUT_MS = 2_000;
const MAX_PAGE_REQUESTS = 100;

export interface BrowserAuditResult {
  readonly run: RunSummary;
  readonly metrics: {
    readonly httpErrorCount: number;
    readonly brokenLinkCount: number;
    readonly linksChecked: number;
    readonly consoleErrorCount: number;
    readonly pageErrorCount: number;
    readonly blockedExternalRequestCount: number;
    readonly blockedUnsafeMethodCount: number;
    readonly blockedRequestLimitCount: number;
    readonly navigationFailed: boolean;
    readonly durationMs: number;
  };
}

type Persistence = Pick<MongoStore, "saveRunSummary" | "updateRunState" | "appendRunEvent" | "updateRunSummary">;

export class BrowserAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAuditError";
  }
}

export function validateLoopbackBrowserTarget(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new BrowserAuditError("Browser audit requires a bounded loopback HTTP URL.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserAuditError("Browser audit requires a valid loopback HTTP URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0
  ) {
    throw new BrowserAuditError("Browser audit accepts only a loopback HTTP URL without credentials, query, or fragment.");
  }
  return url;
}

function incrementOnHttpError(status: number, metrics: { httpErrorCount: number }): void {
  if (status >= 400) metrics.httpErrorCount += 1;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export async function auditLoopbackPage(
  target: URL,
  signal?: AbortSignal,
): Promise<BrowserAuditResult["metrics"]> {
  const startedAt = Date.now();
  const metrics = {
    httpErrorCount: 0,
    brokenLinkCount: 0,
    linksChecked: 0,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    blockedExternalRequestCount: 0,
    blockedUnsafeMethodCount: 0,
    blockedRequestLimitCount: 0,
    navigationFailed: false,
    durationMs: 0,
  };
  if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
  process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= "0";
  let browser: import("playwright").Browser | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, timeout: MAX_PAGE_TIMEOUT_MS });
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(MAX_PAGE_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(MAX_PAGE_TIMEOUT_MS);
      let pageRequestCount = 0;
      page.on("response", (response) => incrementOnHttpError(response.status(), metrics));
      page.on("console", (message) => {
        if (message.type() === "error") metrics.consoleErrorCount += 1;
      });
      page.on("pageerror", () => { metrics.pageErrorCount += 1; });
      await page.route("**/*", async (route) => {
        const request = route.request();
        pageRequestCount += 1;
        if (pageRequestCount > MAX_PAGE_REQUESTS) {
          metrics.blockedRequestLimitCount += 1;
          await route.abort();
          return;
        }
        let requestUrl: URL | undefined;
        try {
          requestUrl = new URL(request.url());
        } catch {
          requestUrl = undefined;
        }
        if (requestUrl?.origin !== target.origin || requestUrl.username.length > 0 || requestUrl.password.length > 0) {
          metrics.blockedExternalRequestCount += 1;
          await route.abort();
          return;
        }
        if (request.method() !== "GET" && request.method() !== "HEAD") {
          metrics.blockedUnsafeMethodCount += 1;
          await route.abort();
          return;
        }
        await route.continue();
      });
      try {
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: MAX_PAGE_TIMEOUT_MS });
      } catch {
        metrics.navigationFailed = true;
      }
      if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");

      let hrefValues: unknown;
      try {
        hrefValues = await page.locator("a").evaluateAll(
          (anchors, limit) => anchors.slice(0, limit).map((anchor) => anchor.getAttribute("href")),
          MAX_LINKS_TO_CHECK,
        );
      } catch {
        hrefValues = [];
      }
      if (Array.isArray(hrefValues)) {
        for (const href of hrefValues) {
          if (typeof href !== "string" || href.trim().length === 0) continue;
          let link: URL;
          try {
            link = new URL(href, target);
          } catch {
            continue;
          }
          if (link.origin !== target.origin || link.username.length > 0 || link.password.length > 0) continue;
          metrics.linksChecked += 1;
          try {
            const response = await context.request.get(link.toString(), {
              timeout: MAX_LINK_TIMEOUT_MS,
              maxRedirects: 0,
              maxRetries: 0,
            });
            if (response.status() >= 400) metrics.brokenLinkCount += 1;
          } catch {
            metrics.brokenLinkCount += 1;
          }
          if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
        }
      }
    } finally {
      await context.close();
    }
  } catch (error: unknown) {
    if (error instanceof BrowserAuditError) throw error;
    throw new BrowserAuditError("The local browser could not complete the fixture audit. Verify the Playwright package and Chromium binary.");
  } finally {
    if (browser !== undefined) await browser.close().catch(() => undefined);
  }
  metrics.durationMs = Math.max(0, Date.now() - startedAt);
  return metrics;
}

function summarize(metrics: BrowserAuditResult["metrics"]): string {
  return `Local browser audit complete: ${metrics.httpErrorCount} HTTP errors, ${metrics.brokenLinkCount}/${metrics.linksChecked} broken local links, ${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ${metrics.blockedExternalRequestCount} external requests blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ${metrics.blockedRequestLimitCount} requests blocked at the limit.`;
}

export async function runBrowserAudit(
  store: Persistence,
  targetValue: unknown,
  signal?: AbortSignal,
): Promise<BrowserAuditResult> {
  const target = validateLoopbackBrowserTarget(targetValue);
  const metrics = await auditLoopbackPage(target, signal);
  const runId = randomUUID();
  const run = await store.saveRunSummary({
    runId,
    workflowId: WORKFLOW_ID,
    summary: "Loopback browser audit started; target URL, page contents, links, and console messages are not persisted.",
  });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_started", stepId: STEP_ID });
  await store.updateRunSummary(runId, summarize(metrics));
  const completed = await store.updateRunState(runId, "completed");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished", stepId: STEP_ID });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_finished" });
  return { run: completed, metrics };
}
