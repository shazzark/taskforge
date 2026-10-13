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
    readonly networkFailureCount: number;
    readonly missingAltCount: number;
    readonly unnamedControlCount: number;
    readonly mobileHorizontalOverflow: boolean;
    readonly desktopHorizontalOverflow: boolean;
    readonly missingSecurityHeaderCount: number;
    readonly securityHeadersChecked: number;
    readonly mixedContentCheck: "skipped_http_target";
    readonly blockedExternalRequestCount: number;
    readonly blockedUnsafeMethodCount: number;
    readonly blockedRequestLimitCount: number;
    readonly designObservations: readonly string[];
    readonly navigationFailed: boolean;
    readonly pageInspectionFailed: boolean;
    readonly designInspectionFailed: boolean;
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

export function browserAuditExitCode(state: RunSummary["state"]): 0 | 3 {
  return state === "failed" ? 3 : 0;
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
    networkFailureCount: 0,
    missingAltCount: 0,
    unnamedControlCount: 0,
    mobileHorizontalOverflow: false,
    desktopHorizontalOverflow: false,
    missingSecurityHeaderCount: 0,
    securityHeadersChecked: 0,
    mixedContentCheck: "skipped_http_target" as const,
    blockedExternalRequestCount: 0,
    blockedUnsafeMethodCount: 0,
    blockedRequestLimitCount: 0,
    designObservations: [] as string[],
    navigationFailed: false,
    pageInspectionFailed: false,
    designInspectionFailed: false,
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
      await page.setViewportSize({ width: 1280, height: 800 });
      page.setDefaultTimeout(MAX_PAGE_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(MAX_PAGE_TIMEOUT_MS);
      let pageRequestCount = 0;
      const policyAbortedRequests = new WeakSet<import("playwright").Request>();
      page.on("response", (response) => incrementOnHttpError(response.status(), metrics));
      page.on("requestfailed", (request) => {
        if (policyAbortedRequests.has(request)) return;
        try {
          if (new URL(request.url()).origin === target.origin) metrics.networkFailureCount += 1;
        } catch { /* Ignore malformed request URLs; they are outside counted coverage. */ }
      });
      page.on("console", (message) => {
        if (message.type() === "error") metrics.consoleErrorCount += 1;
      });
      page.on("pageerror", () => { metrics.pageErrorCount += 1; });
      await page.route("**/*", async (route) => {
        const request = route.request();
        pageRequestCount += 1;
        if (pageRequestCount > MAX_PAGE_REQUESTS) {
          metrics.blockedRequestLimitCount += 1;
          policyAbortedRequests.add(request);
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
          policyAbortedRequests.add(request);
          await route.abort();
          return;
        }
        if (request.method() !== "GET" && request.method() !== "HEAD") {
          metrics.blockedUnsafeMethodCount += 1;
          policyAbortedRequests.add(request);
          await route.abort();
          return;
        }
        await route.continue();
      });
      try {
        const navigation = await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: MAX_PAGE_TIMEOUT_MS });
        if (navigation !== null) {
          const headers = await navigation.allHeaders();
          for (const name of ["content-security-policy", "x-content-type-options", "referrer-policy"]) {
            metrics.securityHeadersChecked += 1;
            if (headers[name] === undefined) metrics.missingSecurityHeaderCount += 1;
          }
        }
      } catch {
        metrics.navigationFailed = true;
      }
      if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");

      try {
        const desktop = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          missingAlt: document.querySelectorAll("img:not([alt])").length,
          unnamedControls: [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")]
            .filter((element) => {
              if (element.closest("[aria-hidden='true'], [hidden]")) return false;
              const style = window.getComputedStyle(element);
              if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return false;
              const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/u)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join("").trim();
              const named = element.getAttribute("aria-label")?.trim() || element.getAttribute("title")?.trim() ||
                labelledBy || element.textContent?.trim() || (element instanceof HTMLInputElement ? element.labels?.item(0)?.textContent?.trim() : "");
              return !named;
            }).length,
        }));
        metrics.desktopHorizontalOverflow = desktop.width > desktop.viewport;
        metrics.missingAltCount = desktop.missingAlt;
        metrics.unnamedControlCount = desktop.unnamedControls;
        await page.setViewportSize({ width: 360, height: 800 });
        metrics.mobileHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        await page.setViewportSize({ width: 1280, height: 800 });
      } catch {
        metrics.pageInspectionFailed = true;
      }

      try {
        metrics.designObservations = await page.evaluate(() => {
          const observations: string[] = [];
          const customProperties = new Set<string>();
          let inspectedRules = 0;
          let inspectedDeclarations = 0;
          for (let sheetIndex = 0; sheetIndex < document.styleSheets.length && sheetIndex < 32 && inspectedRules < 256; sheetIndex += 1) {
            const sheet = document.styleSheets.item(sheetIndex);
            if (sheet === null) continue;
            let rules: CSSRuleList;
            try { rules = sheet.cssRules; } catch { continue; }
            for (let ruleIndex = 0; ruleIndex < rules.length && ruleIndex < 256 && inspectedRules < 256; ruleIndex += 1) {
              const rule = rules.item(ruleIndex);
              if (rule === null) continue;
              inspectedRules += 1;
              if (!(rule instanceof CSSStyleRule)) continue;
              for (let declarationIndex = 0; declarationIndex < rule.style.length && inspectedDeclarations < 512; declarationIndex += 1) {
                inspectedDeclarations += 1;
                const property = rule.style.item(declarationIndex);
                if (/^--[A-Za-z0-9_-]{1,78}$/.test(property) && customProperties.size < 64) {
                  customProperties.add(property);
                }
              }
            }
          }
          for (const property of customProperties) {
            if (observations.length >= 16) break;
            observations.push(`inferred CSS custom-property name: ${property.slice(0, 80)}`);
          }
          const componentSelectors = [["navigation", "nav"], ["header", "header"], ["main", "main"], ["footer", "footer"], ["form", "form"], ["button", "button"], ["card-like class", "[class*=card i]"]] as const;
          const componentCounts = componentSelectors.map(() => 0);
          const componentWalker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
          let inspectedElements = 0;
          while (inspectedElements < 2_000 && componentWalker.nextNode() !== null) {
            const element = componentWalker.currentNode;
            if (!(element instanceof Element)) continue;
            inspectedElements += 1;
            for (let selectorIndex = 0; selectorIndex < componentSelectors.length; selectorIndex += 1) {
              const selector = componentSelectors[selectorIndex]?.[1];
              if (selector !== undefined && element.matches(selector)) componentCounts[selectorIndex] = (componentCounts[selectorIndex] ?? 0) + 1;
            }
          }
          for (let selectorIndex = 0; selectorIndex < componentSelectors.length; selectorIndex += 1) {
            const label = componentSelectors[selectorIndex]?.[0];
            const count = componentCounts[selectorIndex];
            if (label !== undefined && count !== undefined && count > 0) observations.push(`observed component ${label}: ${count}`);
            if (observations.length >= 31) break;
          }
          if (inspectedElements === 2_000 && observations.length < 32) observations.push("component counts sampled from first 2000 elements");
          return observations.slice(0, 32);
        });
      } catch {
        metrics.designInspectionFailed = true;
      }

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
  return `Local browser audit ${metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed ? "incomplete" : "complete"}: navigation failed=${metrics.navigationFailed}, page inspection failed=${metrics.pageInspectionFailed}, design inspection failed=${metrics.designInspectionFailed}, ${metrics.httpErrorCount} HTTP errors, ${metrics.networkFailureCount} failed same-origin requests excluding policy blocks, ${metrics.brokenLinkCount}/${metrics.linksChecked} broken local links, ${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ${metrics.missingAltCount} images missing alt text, ${metrics.unnamedControlCount} unnamed visible controls (heuristic), mobile overflow=${metrics.mobileHorizontalOverflow}, desktop overflow=${metrics.desktopHorizontalOverflow}, ${metrics.missingSecurityHeaderCount}/${metrics.securityHeadersChecked} checked passive security headers missing, mixed-content check=${metrics.mixedContentCheck}, ${metrics.blockedExternalRequestCount} external requests blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ${metrics.blockedRequestLimitCount} requests blocked at the limit.`;
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
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished", stepId: STEP_ID });
  const inspectionFailed = metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed;
  const finished = await store.updateRunState(runId, inspectionFailed ? "failed" : "completed");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: inspectionFailed ? "run_failed" : "run_finished" });
  return { run: finished, metrics };
}
