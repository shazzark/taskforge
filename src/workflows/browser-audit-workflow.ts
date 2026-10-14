import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { MongoStore, RunSummary } from "../mongo-store.js";
import { createBrowserEgressProxy, isGlobalUnicastAddress } from "../security/browser-egress-proxy.js";
import { isRecord } from "../providers/types.js";

const WORKFLOW_ID = "browser-fixture-audit";
const STEP_ID = "audit-local-page";
const MAX_PAGE_TIMEOUT_MS = 8_000;
const MAX_LINKS_TO_CHECK = 10;
const MAX_LINK_TIMEOUT_MS = 1_500;
const MAX_PAGE_REQUESTS = 100;
const MAX_AUDIT_RUNTIME_MS = 45_000;
const MAX_JOURNEY_STEPS = 8;
const MAX_APPROVED_ORIGINS = 8;

export type BrowserJourneyStep =
  | { readonly type: "click-link"; readonly text: string }
  | { readonly type: "expect-text"; readonly text: string };

export interface PublicBrowserAuditOptions {
  readonly approvedOrigins: readonly string[];
  readonly journey: readonly BrowserJourneyStep[];
}

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
    readonly mixedContentCheck: "skipped_http_target" | "observed_https_target";
    readonly blockedExternalRequestCount: number;
    readonly blockedUnsafeMethodCount: number;
    readonly blockedRequestLimitCount: number;
    readonly blockedWebSocketCount: number;
    readonly blockedPrivateAddressRequestCount: number;
    readonly mixedContentRequestCount: number;
    readonly journeyStepsCompleted: number;
    readonly journeyStepsFailed: number;
    readonly approvedOriginCount: number;
    readonly isPublicTarget: boolean;
    readonly runtimeLimitReached: boolean;
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

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname.toLowerCase());
}

function validatePublicHost(hostname: string): void {
  const normalized = hostname.toLowerCase();
  if (isLoopbackHost(normalized) || normalized.endsWith(".localhost") || normalized.endsWith(".local") ||
      normalized.endsWith(".internal") || normalized.endsWith(".test") || normalized.endsWith(".invalid") ||
      normalized.endsWith(".example") || (!normalized.includes(".") && !normalized.startsWith("["))) {
    throw new BrowserAuditError("Public browser audit requires a publicly routable HTTPS host.");
  }
  const address = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  const version = isIP(address);
  if ((normalized.startsWith("[") && version !== 6) || (version !== 0 && !isGlobalUnicastAddress(address))) {
    throw new BrowserAuditError("Public browser audit rejects private, reserved, or invalid IP addresses.");
  }
}

export function validatePublicBrowserTarget(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new BrowserAuditError("Public browser audit requires a bounded HTTPS URL.");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new BrowserAuditError("Public browser audit requires a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.port.length > 0 ||
      url.search.length > 0 || url.hash.length > 0) {
    throw new BrowserAuditError("Public browser audit accepts HTTPS URLs on port 443 without credentials, query, or fragment.");
  }
  validatePublicHost(url.hostname);
  return url;
}

export function validateApprovedBrowserOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw new BrowserAuditError("An approved resource origin is invalid.");
  let url: URL;
  try { url = new URL(value); } catch { throw new BrowserAuditError("An approved resource origin is invalid."); }
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.port.length > 0 ||
      url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new BrowserAuditError("Additional browser origins must be HTTPS origins on port 443 only.");
  }
  validatePublicHost(url.hostname);
  return url.origin;
}

export function validateBrowserJourney(value: unknown): readonly BrowserJourneyStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_JOURNEY_STEPS) {
    throw new BrowserAuditError("Provide 1–8 supported read-only journey steps.");
  }
  const steps: BrowserJourneyStep[] = [];
  const journeyItems: readonly unknown[] = value;
  for (const item of journeyItems) {
    if (!isRecord(item)) throw new BrowserAuditError("A browser journey step is invalid.");
    const step = item;
    if (Object.keys(step).length !== 2 || typeof step["text"] !== "string" || step["text"].trim().length === 0 ||
        Buffer.byteLength(step["text"], "utf8") > 200 || /[\u0000-\u001f\u007f]/u.test(step["text"])) {
      throw new BrowserAuditError("Journey text must be 1–200 printable UTF-8 bytes.");
    }
    if (step["type"] === "expect-text") steps.push({ type: "expect-text", text: step["text"] });
    else if (step["type"] === "click-link") steps.push({ type: "click-link", text: step["text"] });
    else throw new BrowserAuditError("Supported journey steps are expect-text and click-link; form and button submissions are not supported.");
  }
  return steps;
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
  return auditPage(target, undefined, signal);
}

export async function auditPublicBrowserPage(
  target: URL,
  options: PublicBrowserAuditOptions,
  signal?: AbortSignal,
): Promise<BrowserAuditResult["metrics"]> {
  return auditPage(target, options, signal);
}

async function auditPage(
  target: URL,
  publicOptions: PublicBrowserAuditOptions | undefined,
  signal?: AbortSignal,
): Promise<BrowserAuditResult["metrics"]> {
  const startedAt = Date.now();
  const approvedOrigins = new Set(publicOptions?.approvedOrigins ?? [target.origin]);
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
    mixedContentCheck: publicOptions === undefined ? "skipped_http_target" as const : "observed_https_target" as const,
    blockedExternalRequestCount: 0,
    blockedUnsafeMethodCount: 0,
    blockedRequestLimitCount: 0,
    blockedWebSocketCount: 0,
    blockedPrivateAddressRequestCount: 0,
    mixedContentRequestCount: 0,
    journeyStepsCompleted: 0,
    journeyStepsFailed: 0,
    approvedOriginCount: approvedOrigins.size,
    isPublicTarget: publicOptions !== undefined,
    runtimeLimitReached: false,
    designObservations: [] as string[],
    navigationFailed: false,
    pageInspectionFailed: false,
    designInspectionFailed: false,
    durationMs: 0,
  };
  if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
  process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= "0";
  let browser: import("playwright").Browser | undefined;
  let context: import("playwright").BrowserContext | undefined;
  let closeForAbort: (() => void) | undefined;
  let runtimeLimitReached = false;
  const runtimeTimer = setTimeout(() => {
    runtimeLimitReached = true;
    closeForAbort?.();
  }, MAX_AUDIT_RUNTIME_MS);
  runtimeTimer.unref();
  const abortContext = (): void => { closeForAbort?.(); };
  signal?.addEventListener("abort", abortContext, { once: true });
  let egressProxy: Awaited<ReturnType<typeof createBrowserEgressProxy>> | undefined;
  try {
    const { chromium } = await import("playwright");
    if (publicOptions !== undefined) {
      egressProxy = await createBrowserEgressProxy({
        approvedOrigins: [...approvedOrigins],
        maxConcurrentTunnels: 8,
        tunnelTimeoutMs: 15_000,
        maxAggregateBytes: 20 * 1024 * 1024,
        onPrivateAddressBlocked: () => { metrics.blockedPrivateAddressRequestCount += 1; },
      });
    }
    browser = await chromium.launch({
      headless: true,
      timeout: MAX_PAGE_TIMEOUT_MS,
      ...(egressProxy === undefined ? {} : { proxy: { server: egressProxy.url } }),
      ...(publicOptions === undefined ? {} : { args: ["--disable-webrtc", "--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND"] }),
    });
    context = await browser.newContext({
      serviceWorkers: "block",
      ...(publicOptions === undefined ? {} : { storageState: { cookies: [], origins: [] } }),
    });
    closeForAbort = () => { void context?.close().catch(() => undefined); };
    if (isAborted(signal)) closeForAbort();
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
          if (approvedOrigins.has(new URL(request.url()).origin)) metrics.networkFailureCount += 1;
        } catch { /* Ignore malformed request URLs; they are outside counted coverage. */ }
      });
      page.on("console", (message) => {
        if (message.type() === "error") metrics.consoleErrorCount += 1;
      });
      page.on("pageerror", () => { metrics.pageErrorCount += 1; });
      if (publicOptions !== undefined) {
        await context.routeWebSocket("**/*", async (webSocket) => {
          metrics.blockedWebSocketCount += 1;
          await webSocket.close({ code: 1008, reason: "WebSocket access is blocked during a read-only audit." });
        });
      }
      await context.addInitScript(() => {
        Object.defineProperty(window, "RTCPeerConnection", { configurable: false, value: undefined });
        Object.defineProperty(window, "webkitRTCPeerConnection", { configurable: false, value: undefined });
        const blockFormSubmission = (event: Event): void => {
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        window.addEventListener("submit", blockFormSubmission, true);
        Object.defineProperty(HTMLFormElement.prototype, "submit", {
          configurable: false,
          value: () => { throw new Error("Form submission is blocked during a read-only audit."); },
        });
        Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
          configurable: false,
          value: () => { throw new Error("Form submission is blocked during a read-only audit."); },
        });
      });
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
        const isMixedContent = publicOptions !== undefined && requestUrl?.protocol === "http:";
        if (isMixedContent) metrics.mixedContentRequestCount += 1;
        const allowedProtocol = publicOptions === undefined ? requestUrl?.protocol === "http:" : requestUrl?.protocol === "https:";
        const unapprovedNavigation = publicOptions !== undefined && request.isNavigationRequest() &&
          (requestUrl === undefined || requestUrl.search.length > 0);
        if (requestUrl === undefined || !allowedProtocol || !approvedOrigins.has(requestUrl.origin) ||
            requestUrl.username.length > 0 || requestUrl.password.length > 0 || unapprovedNavigation) {
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

      if (publicOptions !== undefined) {
        for (const step of publicOptions.journey) {
          if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
          if (runtimeLimitReached) {
            metrics.journeyStepsFailed += publicOptions.journey.length - metrics.journeyStepsCompleted - metrics.journeyStepsFailed;
            break;
          }
          try {
            if (step.type === "expect-text") {
              const text = page.getByText(step.text, { exact: true });
              if (await text.count() === 0 || !(await text.first().isVisible())) {
                metrics.journeyStepsFailed += 1;
                continue;
              }
              metrics.journeyStepsCompleted += 1;
              continue;
            }
            const link = page.getByRole("link", { name: step.text, exact: true });
            if (await link.count() !== 1) {
              metrics.journeyStepsFailed += 1;
              continue;
            }
            const href = await link.getAttribute("href");
            if (href === null) {
              metrics.journeyStepsFailed += 1;
              continue;
            }
            const destination = new URL(href, page.url());
            if (destination.protocol !== "https:" || !approvedOrigins.has(destination.origin) ||
                destination.username.length > 0 || destination.password.length > 0 || destination.port.length > 0 ||
                destination.search.length > 0 || destination.hash.length > 0) {
              metrics.blockedExternalRequestCount += 1;
              metrics.journeyStepsFailed += 1;
              continue;
            }
            await link.click({ timeout: MAX_PAGE_TIMEOUT_MS });
            metrics.journeyStepsCompleted += 1;
          } catch {
            metrics.journeyStepsFailed += 1;
          }
        }
      }

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
          for (const [label, selector] of [["buttons", "button"], ["links", "a[href]"]] as const) {
            const visible = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
              const style = window.getComputedStyle(element);
              return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
            }).slice(0, 50);
            if (visible.length < 2) continue;
            const styleCounts = new Map<string, number>();
            for (const element of visible) {
              const style = window.getComputedStyle(element);
              const signature = [style.color, style.backgroundColor, style.fontFamily, style.fontSize,
                style.fontWeight, style.borderRadius].join("|");
              styleCounts.set(signature, (styleCounts.get(signature) ?? 0) + 1);
            }
            const dominantStyleCount = Math.max(...styleCounts.values());
            observations.push(`observed ${label} visual-style consistency heuristic: ${dominantStyleCount}/${visible.length} share the dominant sampled style signature`);
          }
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
            link = new URL(href, page.url());
          } catch {
            continue;
          }
          if (link.origin !== new URL(page.url()).origin || link.username.length > 0 || link.password.length > 0) {
            if (!approvedOrigins.has(link.origin)) metrics.blockedExternalRequestCount += 1;
            continue;
          }
          metrics.linksChecked += 1;
          try {
            const status = await page.evaluate(async ({ href: hrefValue, timeoutMs }) => {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), timeoutMs);
              try {
                const response = await fetch(hrefValue, {
                  method: "GET", credentials: "omit", redirect: "manual", cache: "no-store", signal: controller.signal,
                });
                const statusCode = response.status;
                await response.body?.cancel();
                return statusCode;
              } catch { return 0; }
              finally { clearTimeout(timer); }
            }, { href: link.toString(), timeoutMs: MAX_LINK_TIMEOUT_MS });
            if (status === 0 || status >= 400) metrics.brokenLinkCount += 1;
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
    if (egressProxy !== undefined) await egressProxy.close().catch(() => undefined);
    clearTimeout(runtimeTimer);
    signal?.removeEventListener("abort", abortContext);
  }
  metrics.runtimeLimitReached = runtimeLimitReached;
  metrics.durationMs = Math.max(0, Date.now() - startedAt);
  return metrics;
}

function summarize(metrics: BrowserAuditResult["metrics"]): string {
  return `Browser audit ${metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed || metrics.journeyStepsFailed > 0 || metrics.runtimeLimitReached ? "incomplete" : "complete"}: navigation failed=${metrics.navigationFailed}, page inspection failed=${metrics.pageInspectionFailed}, design inspection failed=${metrics.designInspectionFailed}, journey=${metrics.journeyStepsCompleted}/${metrics.journeyStepsCompleted + metrics.journeyStepsFailed} steps, ${metrics.httpErrorCount} HTTP errors, ${metrics.networkFailureCount} failed approved-origin requests excluding policy blocks, ${metrics.brokenLinkCount}/${metrics.linksChecked} same-origin links broken, ${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ${metrics.missingAltCount} images missing alt text, ${metrics.unnamedControlCount} unnamed visible controls (heuristic), mobile overflow=${metrics.mobileHorizontalOverflow}, desktop overflow=${metrics.desktopHorizontalOverflow}, ${metrics.missingSecurityHeaderCount}/${metrics.securityHeadersChecked} checked passive security headers missing, mixed-content check=${metrics.mixedContentCheck} (${metrics.mixedContentRequestCount} requests), ${metrics.blockedExternalRequestCount} unapproved resources blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ${metrics.blockedWebSocketCount} WebSockets blocked, ${metrics.blockedPrivateAddressRequestCount} private-address DNS attempts blocked, ${metrics.blockedRequestLimitCount} requests blocked at the limit, total runtime limit reached=${metrics.runtimeLimitReached}.`;
}

async function persistBrowserAudit(
  store: Persistence,
  metrics: BrowserAuditResult["metrics"],
  workflowId: string,
  startedSummary: string,
): Promise<BrowserAuditResult> {
  const runId = randomUUID();
  const run = await store.saveRunSummary({ runId, workflowId, summary: startedSummary });
  await store.updateRunState(runId, "running");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "run_started" });
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_started", stepId: STEP_ID });
  await store.updateRunSummary(runId, summarize(metrics));
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: "step_finished", stepId: STEP_ID });
  const inspectionFailed = metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed ||
    metrics.journeyStepsFailed > 0 || metrics.runtimeLimitReached;
  const finished = await store.updateRunState(runId, inspectionFailed ? "failed" : "completed");
  await store.appendRunEvent({ runId, eventId: randomUUID(), type: inspectionFailed ? "run_failed" : "run_finished" });
  return { run: finished, metrics };
}

export async function runBrowserAudit(
  store: Persistence,
  targetValue: unknown,
  signal?: AbortSignal,
): Promise<BrowserAuditResult> {
  const target = validateLoopbackBrowserTarget(targetValue);
  const metrics = await auditLoopbackPage(target, signal);
  return persistBrowserAudit(store, metrics, WORKFLOW_ID, "Loopback browser audit started; target URL, page contents, links, and console messages are not persisted.");
}

export async function runPublicBrowserAudit(
  store: Persistence,
  targetValue: unknown,
  optionsValue: unknown,
  signal?: AbortSignal,
): Promise<BrowserAuditResult> {
  const target = validatePublicBrowserTarget(targetValue);
  if (!isRecord(optionsValue) || Object.keys(optionsValue).some((key) => key !== "approvedOrigins" && key !== "journey") ||
      !Array.isArray(optionsValue["approvedOrigins"])) {
    throw new BrowserAuditError("Public browser audit requires approved origins and an explicit journey.");
  }
  const rawOrigins = optionsValue["approvedOrigins"];
  if (rawOrigins.length > MAX_APPROVED_ORIGINS - 1) throw new BrowserAuditError("At most 7 additional resource origins may be approved.");
  const origins = new Set<string>([target.origin]);
  for (const rawOrigin of rawOrigins) origins.add(validateApprovedBrowserOrigin(rawOrigin));
  if (origins.size > MAX_APPROVED_ORIGINS) throw new BrowserAuditError("At most 8 origins may be approved for one audit.");
  const options: PublicBrowserAuditOptions = {
    approvedOrigins: [...origins],
    journey: validateBrowserJourney(optionsValue["journey"]),
  };
  const metrics = await auditPublicBrowserPage(target, options, signal);
  return persistBrowserAudit(store, metrics, "browser-public-audit", "Public browser audit started; target URL, journey text, page contents, links, and console messages are not persisted.");
}
