import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { RunSummary } from "../storage/types.js";
import type { TaskForgeStore } from "../storage/store.js";
import { createBrowserEgressProxy, isGlobalUnicastAddress, type BrowserEgressProxyOptions } from "../security/browser-egress-proxy.js";
import { isRecord } from "../providers/types.js";
import { escapeTerminalControls } from "../security/terminal-text.js";

const WORKFLOW_ID = "browser-fixture-audit";
const STEP_ID = "audit-local-page";
const MAX_PAGE_TIMEOUT_MS = 8_000;
const MAX_RENDER_WAIT_MS = 2_500;
const MAX_NETWORK_QUIET_WAIT_MS = 1_500;
const MAX_LINKS_TO_CHECK = 10;
const MAX_LINK_TIMEOUT_MS = 1_500;
const MAX_PAGE_REQUESTS = 100;
const MAX_AUDIT_RUNTIME_MS = 45_000;
const MAX_JOURNEY_STEPS = 8;
const MAX_APPROVED_ORIGINS = 8;
const MAX_DIAGNOSTIC_SCREENSHOTS = 2;
const MAX_DIAGNOSTIC_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTIC_FAILURES = 20;
const MAX_DIAGNOSTIC_DOM_ELEMENTS = 2_000;
const MAX_AUTH_SCAN_ELEMENTS = 2_000;
const MAX_PASSWORD_FIELDS_TO_INSPECT = 20;
const HTTP_REDIRECT_STATUSES = new Set([301, 302, 303, 305, 307, 308]);

export type BrowserJourneyStep =
  | { readonly type: "click-link"; readonly text: string }
  | { readonly type: "expect-text"; readonly text: string }
  | { readonly type: "search"; readonly text: string }
  | { readonly type: "open-first-book" }
  | { readonly type: "go-back" };

export interface PublicBrowserAuditOptions {
  readonly approvedOrigins: readonly string[];
  readonly journey: readonly BrowserJourneyStep[];
  readonly manualLogin?: boolean;
}

/** Human callbacks used only by the explicit, headed manual-login flow. */
export interface BrowserManualLoginInteraction {
  readonly approveOrigin: (origin: string) => Promise<boolean>;
  readonly approveLoginPost: (origin: string, pathname: string) => Promise<boolean>;
  readonly completeLogin: () => Promise<boolean>;
  readonly approveJourney: (journey: readonly BrowserJourneyStep[]) => Promise<boolean>;
}

/** Test-only seams; public CLI workflows never accept these values. */
export type BrowserAuditFixtureDependencies = Pick<BrowserEgressProxyOptions, "lookupAddresses" | "connectAddress" | "onConnectRequest"> & {
  readonly ignoreHTTPSErrors?: boolean;
  readonly onBrowserRequestFailure?: (url: string, error: string | undefined) => void;
  readonly onUnexpectedAuditError?: (error: unknown) => void;
  readonly onBrowserClosed?: () => void;
  readonly manualLoginInteraction?: BrowserManualLoginInteraction;
  readonly onManualLoginReady?: (page: import("playwright").Page) => Promise<void>;
  readonly headless?: boolean;
};

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
    readonly blockedMutatingRouteCount: number;
    readonly blockedNavigationCount: number;
    readonly blockedUnsafeMethodCount: number;
    readonly blockedRequestLimitCount: number;
    readonly blockedWebSocketCount: number;
    readonly blockedPrivateAddressRequestCount: number;
    readonly blockedResourceOrigins: readonly string[];
    readonly journeyEvidence: readonly string[];
    readonly journeyFailureReasons: readonly string[];
    readonly mixedContentRequestCount: number;
    readonly journeyStepsCompleted: number;
    readonly journeyStepsFailed: number;
    readonly approvedOriginCount: number;
    readonly isPublicTarget: boolean;
    readonly runtimeLimitReached: boolean;
    readonly designObservations: readonly string[];
    readonly navigationFailed: boolean;
    readonly navigationHttpStatus: number | null;
    readonly finalPath: string | null;
    readonly renderWaitMs: number;
    readonly networkSettleWaitMs: number;
    readonly navigationRedirectCount: number;
    readonly authenticationGateDetected: boolean;
    readonly authenticationGateDetectionIncomplete: boolean;
    readonly pageDiagnostics: BrowserPageDiagnostics;
    readonly pageInspectionFailed: boolean;
    readonly designInspectionFailed: boolean;
    readonly durationMs: number;
  };
}

export interface BrowserPageSnapshot {
  readonly stage: "initial" | "final";
  readonly state: "rendered" | "empty" | "incomplete" | "authentication-gated" | "navigation-failed";
  readonly path: string | null;
  readonly status: number | null;
  readonly title: string;
  readonly bodyTextLength: number;
  readonly bodyTextSample: string;
  readonly headings: number;
  readonly mainLandmarks: number;
  readonly forms: number;
  readonly searchControls: number;
  readonly visibleInputs: number;
  readonly visibleButtons: number;
  readonly visibleLinks: number;
  readonly cardLikeElements: number;
  readonly domScanTruncated: boolean;
  readonly textScanTruncated: boolean;
}

export interface BrowserPageDiagnostics {
  readonly snapshots: readonly BrowserPageSnapshot[];
  readonly screenshots: readonly { readonly stage: "initial" | "final"; readonly png: Uint8Array }[];
  readonly observedFailures: readonly string[];
  readonly suspectedCauses: readonly string[];
  readonly blockedDataResourceOrigins: readonly string[];
  readonly screenshotLimitReached: boolean;
}

type Persistence = Pick<TaskForgeStore, "saveRunSummary" | "updateRunState" | "appendRunEvent" | "updateRunSummary">;

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
  if (containsMutatingRouteTerms(url)) throw new BrowserAuditError("Public browser audit refuses a target URL with a mutating route or action parameter.");
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
    if (step["type"] === "go-back" && Object.keys(step).length === 1) {
      steps.push({ type: "go-back" });
      continue;
    }
    if (step["type"] === "open-first-book" && Object.keys(step).length === 1) {
      steps.push({ type: "open-first-book" });
      continue;
    }
    if (Object.keys(step).length !== 2 || typeof step["text"] !== "string" || step["text"].trim().length === 0 ||
        Buffer.byteLength(step["text"], "utf8") > 200 || /[\u0000-\u001f\u007f]/u.test(step["text"])) {
      throw new BrowserAuditError("Journey text must be 1–200 printable UTF-8 bytes.");
    }
    if (step["type"] === "expect-text") steps.push({ type: "expect-text", text: step["text"] });
    else if (step["type"] === "click-link") steps.push({ type: "click-link", text: step["text"] });
    else if (step["type"] === "search") steps.push({ type: "search", text: step["text"] });
    else throw new BrowserAuditError("Supported journey steps are expect-text, search, open-first-book, click-link, and go-back; arbitrary form/button actions are not supported.");
  }
  return steps;
}

function incrementOnHttpError(status: number, metrics: { httpErrorCount: number }): void {
  if (status >= 400) metrics.httpErrorCount += 1;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function escapeAuditEvidence(value: string): string {
  return escapeTerminalControls(value).replace(/\p{Cf}/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
  });
}

function safeRequestPath(value: string): string {
  try { return escapeAuditEvidence(new URL(value).pathname.slice(0, 160)); }
  catch { return "[unavailable]"; }
}

const READ_ONLY_ROUTE_ROOTS = new Set(["about", "auth", "book", "books", "contact", "detail", "details", "discover", "forgot-password", "home", "login", "privacy", "product", "products", "register", "reset-password", "result", "results", "search", "signup", "terms", "title", "titles"]);
const MUTATING_ROUTE_WORDS = new Set(["add", "buy", "cart", "checkout", "create", "delete", "destroy", "edit", "favorite", "favourite", "follow", "logout", "order", "payment", "post", "publish", "purchase", "remove", "save", "subscribe", "unsubscribe", "update", "write"]);

function hasMutatingRouteWord(value: string): boolean {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase().split(/[^a-z0-9]+/u)
    .some((word) => MUTATING_ROUTE_WORDS.has(word));
}

function containsMutatingRouteTerms(destination: URL): boolean {
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(destination.pathname); }
  catch { return true; }
  if (hasMutatingRouteWord(decodedPath)) return true;
  for (const [key, value] of destination.searchParams) {
    if (hasMutatingRouteWord(key) || hasMutatingRouteWord(value)) return true;
  }
  return false;
}

function isAuthenticationEndpoint(destination: URL): boolean {
  let path: string;
  try { path = decodeURIComponent(destination.pathname); } catch { return false; }
  const segments = path.split("/").filter(Boolean);
  const safeStaticSegments = /^(?:api|v[0-9]{1,3}|auth|oauth|login|signin|sign-in|authenticate)$/iu;
  return segments.length > 0 && segments.length <= 8 && segments.every((segment) => safeStaticSegments.test(segment)) &&
    /(?:^|\/)(?:login|signin|sign-in|authenticate)(?:\/|$)/iu.test(path);
}

/** Fail closed for page-provided links outside recognizable read-only content routes. */
function isClassifiedReadOnlyBrowserDestination(destination: URL): boolean {
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(destination.pathname); }
  catch { return false; }
  if (containsMutatingRouteTerms(destination)) return false;
  const firstPathSegment = decodedPath.split("/").filter(Boolean)[0]?.toLowerCase();
  if (firstPathSegment !== undefined && !READ_ONLY_ROUTE_ROOTS.has(firstPathSegment)) return false;
  return true;
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
  fixtureDependencies?: BrowserAuditFixtureDependencies,
): Promise<BrowserAuditResult["metrics"]> {
  return auditPage(target, options, signal, fixtureDependencies);
}

async function auditPage(
  target: URL,
  publicOptions: PublicBrowserAuditOptions | undefined,
  signal?: AbortSignal,
  fixtureDependencies?: BrowserAuditFixtureDependencies,
): Promise<BrowserAuditResult["metrics"]> {
  const startedAt = Date.now();
  const approvedOrigins = new Set(publicOptions?.approvedOrigins ?? [target.origin]);
  const manualLogin = publicOptions?.manualLogin === true;
  const manualInteraction = fixtureDependencies?.manualLoginInteraction;
  if (manualLogin && manualInteraction === undefined) {
    throw new BrowserAuditError("Manual login requires interactive origin, authentication-request, and journey approvals.");
  }
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
    blockedMutatingRouteCount: 0,
    blockedNavigationCount: 0,
    blockedUnsafeMethodCount: 0,
    blockedRequestLimitCount: 0,
    blockedWebSocketCount: 0,
    blockedPrivateAddressRequestCount: 0,
    blockedResourceOrigins: [] as string[],
    journeyEvidence: [] as string[],
    journeyFailureReasons: [] as string[],
    mixedContentRequestCount: 0,
    journeyStepsCompleted: 0,
    journeyStepsFailed: 0,
    approvedOriginCount: approvedOrigins.size,
    isPublicTarget: publicOptions !== undefined,
    runtimeLimitReached: false,
    designObservations: [] as string[],
    navigationFailed: false,
    navigationHttpStatus: null as number | null,
    finalPath: null as string | null,
    renderWaitMs: 0,
    networkSettleWaitMs: 0,
    navigationRedirectCount: 0,
    authenticationGateDetected: false,
    authenticationGateDetectionIncomplete: false,
    pageDiagnostics: {
      snapshots: [] as BrowserPageSnapshot[],
      screenshots: [] as { stage: "initial" | "final"; png: Uint8Array }[],
      observedFailures: [] as string[],
      suspectedCauses: [] as string[],
      blockedDataResourceOrigins: [] as string[],
      screenshotLimitReached: false,
    },
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
        ...(fixtureDependencies?.lookupAddresses === undefined ? {} : { lookupAddresses: fixtureDependencies.lookupAddresses }),
        ...(fixtureDependencies?.connectAddress === undefined ? {} : { connectAddress: fixtureDependencies.connectAddress }),
        ...(fixtureDependencies?.onConnectRequest === undefined ? {} : { onConnectRequest: fixtureDependencies.onConnectRequest }),
      });
    }
    browser = await chromium.launch({
      headless: manualLogin ? (fixtureDependencies?.headless ?? false) : true,
      timeout: MAX_PAGE_TIMEOUT_MS,
      ...(egressProxy === undefined ? {} : { proxy: { server: egressProxy.url } }),
      ...(publicOptions === undefined ? {} : { args: ["--disable-webrtc", "--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] }),
    });
    context = await browser.newContext({
      serviceWorkers: "block",
      ...(fixtureDependencies?.ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors: fixtureDependencies.ignoreHTTPSErrors }),
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
      let manualLoginPhase = false;
      let manualLoginClosing = false;
      const pendingManualApprovals = new Set<Promise<void>>();
      const approvedNavigationUrls = new Set<string>();
      const diagnosticRouteProbeUrls = new Set<string>();
      const blockedOriginSet = new Set<string>();
      const recordBlockedOrigin = (url: URL | undefined, dataRequest = false): void => {
        if (url === undefined || url.origin === target.origin || blockedOriginSet.size >= MAX_APPROVED_ORIGINS) return;
        blockedOriginSet.add(url.origin);
        metrics.blockedResourceOrigins = [...blockedOriginSet];
        // Only a valid public HTTPS origin can be a candidate for explicit
        // approval on a later run. Other blocked resources remain coverage evidence.
        if (!dataRequest || url.protocol !== "https:") return;
        try {
          const candidate = validateApprovedBrowserOrigin(url.origin);
          if (metrics.pageDiagnostics.blockedDataResourceOrigins.length < MAX_APPROVED_ORIGINS &&
              !metrics.pageDiagnostics.blockedDataResourceOrigins.includes(candidate)) {
            metrics.pageDiagnostics.blockedDataResourceOrigins.push(candidate);
          }
        } catch {
          // Private, reserved, or invalid origins cannot be approval candidates.
        }
      };
      const recordObservedFailure = (failure: string): void => {
        if (manualLogin) return;
        if (metrics.pageDiagnostics.observedFailures.length >= MAX_DIAGNOSTIC_FAILURES || Buffer.byteLength(failure, "utf8") > 300) return;
        metrics.pageDiagnostics.observedFailures.push(failure);
      };
      const recordJourneyEvidence = (evidence: string): void => {
        if (metrics.journeyEvidence.length >= MAX_JOURNEY_STEPS || Buffer.byteLength(evidence, "utf8") > 300) return;
        if (manualLogin) {
          metrics.journeyEvidence.push("A read-only journey step completed.");
          return;
        }
        const withoutFormatControls = evidence.replace(/\p{Cf}/gu, (character) => {
          const codePoint = character.codePointAt(0);
          return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
        });
        metrics.journeyEvidence.push(escapeTerminalControls(withoutFormatControls));
      };
      const recordJourneyFailure = (reason: string): void => {
        if (metrics.journeyFailureReasons.length < MAX_JOURNEY_STEPS) {
          metrics.journeyFailureReasons.push(manualLogin ? "A read-only journey step did not complete." : reason);
        }
        metrics.journeyStepsFailed += 1;
      };
      const policyAbortedRequests = new WeakSet<import("playwright").Request>();
      page.on("response", (response) => {
        incrementOnHttpError(response.status(), metrics);
        if (response.status() >= 400) {
          try {
            const responseUrl = new URL(response.url());
            if (approvedOrigins.has(responseUrl.origin)) {
              const resourceType = response.request().resourceType();
              recordObservedFailure(`Observed HTTP ${response.status()} ${resourceType} response at ${safeRequestPath(response.url())}.`);
            }
          } catch { /* Malformed response URLs are counted only in aggregate metrics. */ }
        }
        if (response.request().isNavigationRequest()) {
          try {
            if (approvedOrigins.has(new URL(response.url()).origin)) metrics.navigationHttpStatus = response.status();
          } catch { /* Ignore malformed browser-generated URLs. */ }
        }
      });
      page.on("request", (request) => {
        if (request.isNavigationRequest() && request.redirectedFrom() !== null) metrics.navigationRedirectCount += 1;
      });
      page.on("requestfailed", (request) => {
        fixtureDependencies?.onBrowserRequestFailure?.(request.url(), request.failure()?.errorText);
        if (policyAbortedRequests.has(request)) return;
        try {
          const requestUrl = new URL(request.url());
          const isDiagnosticRouteProbe = request.method() === "HEAD" && diagnosticRouteProbeUrls.has(requestUrl.toString());
          if (approvedOrigins.has(requestUrl.origin) && !isDiagnosticRouteProbe) {
            metrics.networkFailureCount += 1;
            const resourceType = request.resourceType();
            recordObservedFailure(`Observed failed ${resourceType} request at ${safeRequestPath(request.url())}.`);
          }
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
      await context.addInitScript((allowAuthenticationPost: boolean) => {
        Object.defineProperty(window, "RTCPeerConnection", { configurable: false, value: undefined });
        Object.defineProperty(window, "webkitRTCPeerConnection", { configurable: false, value: undefined });
        const blockFormSubmission = (event: Event): void => {
          if (allowAuthenticationPost && event.target instanceof HTMLFormElement &&
              event.target.method.toUpperCase() === "POST") return;
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        window.addEventListener("submit", blockFormSubmission, true);
        if (allowAuthenticationPost) {
          const nativeSubmit = HTMLFormElement.prototype.submit;
          Object.defineProperty(HTMLFormElement.prototype, "submit", {
            configurable: false,
            value: function (this: HTMLFormElement): void {
              if (this.method.toUpperCase() !== "POST") throw new Error("GET form submission is blocked during manual login.");
              nativeSubmit.call(this);
            },
          });
          return;
        }
        Object.defineProperty(HTMLFormElement.prototype, "submit", {
          configurable: false,
          value: () => { throw new Error("Form submission is blocked during a read-only audit."); },
        });
        Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
          configurable: false,
          value: () => { throw new Error("Form submission is blocked during a read-only audit."); },
        });
      }, manualLogin);
      await context.route("**/*", async (route) => {
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
        if (manualLogin && manualLoginPhase && !manualLoginClosing && requestUrl !== undefined && requestUrl.protocol === "https:" && !approvedOrigins.has(requestUrl.origin) &&
            approvedOrigins.size < MAX_APPROVED_ORIGINS && manualInteraction !== undefined) {
          let candidateOrigin: string | undefined;
          try { candidateOrigin = validateApprovedBrowserOrigin(requestUrl.origin); } catch { /* Private/invalid origins cannot be approved. */ }
          if (candidateOrigin !== undefined) {
            let finishApproval: (() => void) | undefined;
            const pendingApproval = new Promise<void>((resolve) => { finishApproval = resolve; });
            pendingManualApprovals.add(pendingApproval);
            try {
              if (await manualInteraction.approveOrigin(candidateOrigin)) {
                approvedOrigins.add(candidateOrigin);
                egressProxy?.approveOrigin(candidateOrigin);
                metrics.approvedOriginCount = approvedOrigins.size;
              }
            } finally {
              pendingManualApprovals.delete(pendingApproval);
              finishApproval?.();
            }
          }
        }
        const isMixedContent = publicOptions !== undefined && requestUrl?.protocol === "http:";
        if (isMixedContent) metrics.mixedContentRequestCount += 1;
        const allowedProtocol = publicOptions === undefined ? requestUrl?.protocol === "http:" : requestUrl?.protocol === "https:";
        const documentNavigation = request.isNavigationRequest() || request.resourceType() === "document";
        const permittedManualNavigation = manualLogin && manualLoginPhase && requestUrl !== undefined &&
          approvedOrigins.has(requestUrl.origin) &&
          (isClassifiedReadOnlyBrowserDestination(requestUrl) ||
            (request.method() === "POST" && requestUrl.search.length === 0 && isAuthenticationEndpoint(requestUrl)));
        const unapprovedNavigation = publicOptions !== undefined && documentNavigation &&
          (requestUrl === undefined || (!approvedNavigationUrls.has(requestUrl.toString()) &&
            !(request.redirectedFrom() !== null && requestUrl.origin === target.origin &&
              isClassifiedReadOnlyBrowserDestination(requestUrl)) &&
            !permittedManualNavigation));
        const mutatingRouteRequest = publicOptions !== undefined && requestUrl !== undefined && containsMutatingRouteTerms(requestUrl);
        if (requestUrl === undefined || !allowedProtocol || !approvedOrigins.has(requestUrl.origin) ||
            requestUrl.username.length > 0 || requestUrl.password.length > 0 || unapprovedNavigation || mutatingRouteRequest) {
          if (mutatingRouteRequest && requestUrl !== undefined && approvedOrigins.has(requestUrl.origin)) metrics.blockedMutatingRouteCount += 1;
          else if (unapprovedNavigation) metrics.blockedNavigationCount += 1;
          else metrics.blockedExternalRequestCount += 1;
          if (!documentNavigation) recordBlockedOrigin(requestUrl, request.resourceType() === "fetch" || request.resourceType() === "xhr");
          if (unapprovedNavigation && requestUrl !== undefined) {
            recordObservedFailure(`Blocked document navigation outside the approved target journey at ${safeRequestPath(requestUrl.toString())}; it was not accessed.`);
          }
          if (mutatingRouteRequest && requestUrl !== undefined) {
            recordObservedFailure(`Blocked a page request with mutating route terms at ${safeRequestPath(requestUrl.toString())}; it was not accessed.`);
          }
          if (requestUrl !== undefined && requestUrl.origin !== target.origin && !approvedOrigins.has(requestUrl.origin)) {
            recordObservedFailure(`Observed blocked unapproved ${request.resourceType()} resource from ${requestUrl.origin}; it was not accessed.`);
          }
          if (requestUrl !== undefined && requestUrl.protocol === "https:" && requestUrl.origin !== target.origin && !approvedOrigins.has(requestUrl.origin) &&
              (request.resourceType() === "fetch" || request.resourceType() === "xhr")) {
            recordObservedFailure(`Observed blocked unapproved ${request.resourceType()} request to ${requestUrl.origin}; it was not accessed.`);
          }
          policyAbortedRequests.add(request);
          await route.abort();
          return;
        }
        if (request.method() !== "GET" && request.method() !== "HEAD") {
          if (manualLogin && manualLoginPhase && !manualLoginClosing && request.method() === "POST" && requestUrl !== undefined &&
              approvedOrigins.has(requestUrl.origin) && requestUrl.search.length === 0 &&
              isAuthenticationEndpoint(requestUrl) && !mutatingRouteRequest &&
              manualInteraction !== undefined) {
            let finishApproval: (() => void) | undefined;
            const pendingApproval = new Promise<void>((resolve) => { finishApproval = resolve; });
            pendingManualApprovals.add(pendingApproval);
            try {
              if (await manualInteraction.approveLoginPost(requestUrl.origin, requestUrl.pathname) &&
                  manualLoginPhase && requestUrl.search.length === 0 && approvedOrigins.has(requestUrl.origin)) {
                // Avoid Chromium following an authentication response redirect
                // without re-entering the policy route. Fulfill only the first
                // response when it is not a redirect. Redirecting login responses
                // are unsupported and aborted before Chromium can follow them.
                const response = await route.fetch({ maxRedirects: 0, timeout: MAX_PAGE_TIMEOUT_MS });
                const responseHeaders = response.headers();
                if (HTTP_REDIRECT_STATUSES.has(response.status()) ||
                    (response.status() === 300 && Object.hasOwn(responseHeaders, "location"))) {
                  metrics.blockedNavigationCount += 1;
                  metrics.navigationRedirectCount += 1;
                  recordObservedFailure("An authentication POST returned a redirect; the redirect was blocked before following it.");
                  policyAbortedRequests.add(request);
                  await route.abort();
                  return;
                }
                await route.fulfill({ response });
                return;
              }
            } finally {
              pendingManualApprovals.delete(pendingApproval);
              finishApproval?.();
            }
          }
          metrics.blockedUnsafeMethodCount += 1;
          policyAbortedRequests.add(request);
          await route.abort();
          return;
        }
        if (publicOptions !== undefined && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          try {
            // Playwright route.continue() delegates redirect following to Chromium;
            // Chromium does not route each redirect hop back through this handler.
            // Fetch one bounded redirect hop explicitly so a Location is never
            // followed under a resource-only origin approval.
            const response = await route.fetch({ maxRedirects: 0, timeout: MAX_PAGE_TIMEOUT_MS });
            const responseHeaders = response.headers();
            const isRedirectResponse = HTTP_REDIRECT_STATUSES.has(response.status()) ||
              (response.status() === 300 && Object.hasOwn(responseHeaders, "location"));
            if (isRedirectResponse) {
              metrics.blockedNavigationCount += 1;
              metrics.navigationHttpStatus = response.status();
              metrics.navigationRedirectCount += 1;
              recordObservedFailure(`Observed HTTP ${response.status()} document redirect at ${safeRequestPath(request.url())}; it was blocked before following the destination.`);
              policyAbortedRequests.add(request);
              await route.abort();
              return;
            }
            await route.fulfill({ response });
          } catch {
            metrics.networkFailureCount += 1;
            recordObservedFailure(`Failed to retrieve an approved document within the bounded redirect check at ${safeRequestPath(request.url())}.`);
            policyAbortedRequests.add(request);
            await route.abort();
          }
          return;
        }
        await route.continue();
      });
      const waitForRenderedContent = async (): Promise<void> => {
        const startedAt = Date.now();
        try {
          await page.waitForFunction(({ maxElements }) => {
            const isVisible = (element: Element): boolean => {
              if (element.closest("[aria-hidden='true'], [hidden]")) return false;
              const style = window.getComputedStyle(element);
              return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
            };
            const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
            let inspectedNodes = 0;
            let visibleTextLength = 0;
            while (inspectedNodes < maxElements && walker.nextNode() !== null) {
              inspectedNodes += 1;
              const node = walker.currentNode;
              if (node instanceof Element && node.matches("main, [role=main], h1, h2, form, input, button, a[href], [role=searchbox]") && isVisible(node)) return true;
              if (node instanceof Text && node.parentElement !== null && isVisible(node.parentElement)) {
                visibleTextLength += node.nodeValue?.slice(0, 40).trim().length ?? 0;
                if (visibleTextLength >= 40) return true;
              }
            }
            return false;
          }, { maxElements: MAX_DIAGNOSTIC_DOM_ELEMENTS }, { timeout: MAX_RENDER_WAIT_MS, polling: 100 });
        } catch { /* Keep the empty-page observation after the bounded render window. */ }
        metrics.renderWaitMs += Math.min(MAX_RENDER_WAIT_MS, Math.max(0, Date.now() - startedAt));
      };
      const waitForVisibleJourneyTarget = async (locator: import("playwright").Locator): Promise<void> => {
        const startedAt = Date.now();
        try { await locator.waitFor({ state: "visible", timeout: MAX_RENDER_WAIT_MS }); }
        catch { /* The step records a bounded unsupported/missing-target reason below. */ }
        metrics.renderWaitMs += Math.min(MAX_RENDER_WAIT_MS, Math.max(0, Date.now() - startedAt));
      };
      const settleNetwork = async (): Promise<void> => {
        const startedAt = Date.now();
        try { await page.waitForLoadState("networkidle", { timeout: MAX_NETWORK_QUIET_WAIT_MS }); }
        catch {
          recordObservedFailure(`Observed network activity did not settle within the ${MAX_NETWORK_QUIET_WAIT_MS} ms diagnostic window.`);
        }
        metrics.networkSettleWaitMs += Math.min(MAX_NETWORK_QUIET_WAIT_MS, Math.max(0, Date.now() - startedAt));
      };
      const inspectPasswordFields = async (): Promise<"none" | "visible" | "limit"> => page.evaluate(({ maxElements, maxPasswordFields }) => {
        const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
        let inspectedElements = 0;
        let passwordFields = 0;
        while (inspectedElements < maxElements && walker.nextNode() !== null) {
          const element = walker.currentNode;
          if (!(element instanceof Element)) continue;
          inspectedElements += 1;
          if (!(element instanceof HTMLInputElement) || element.type !== "password") continue;
          passwordFields += 1;
          if (passwordFields > maxPasswordFields) return "limit" as const;
          if (element.closest("[aria-hidden='true'], [hidden]")) continue;
          const style = window.getComputedStyle(element);
          if (style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0) return "visible" as const;
        }
        return inspectedElements >= maxElements && walker.nextNode() !== null ? "limit" as const : "none" as const;
      }, { maxElements: MAX_AUTH_SCAN_ELEMENTS, maxPasswordFields: MAX_PASSWORD_FIELDS_TO_INSPECT });
      const captureSnapshot = async (stage: "initial" | "final"): Promise<BrowserPageSnapshot> => {
        const passwordState = await inspectPasswordFields();
        if (passwordState === "visible") metrics.authenticationGateDetected = true;
        if (passwordState === "limit") metrics.authenticationGateDetectionIncomplete = true;
        const snapshot = await page.evaluate(({ snapshotStage, navigationStatus, isNavigationFailed, isAuthGate, isInspectionIncomplete, maxElements }) => {
          const visible = (element: Element): boolean => {
            if (element.closest("[aria-hidden='true'], [hidden]")) return false;
            const style = window.getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
          };
          const counts = { headings: 0, mainLandmarks: 0, forms: 0, searchControls: 0, visibleInputs: 0, visibleButtons: 0, visibleLinks: 0, cardLikeElements: 0 };
          const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
          let inspected = 0;
          while (inspected < maxElements && walker.nextNode() !== null) {
            const element = walker.currentNode;
            if (!(element instanceof Element)) continue;
            inspected += 1;
            if (element.matches("h1, h2, h3, h4, h5, h6")) counts.headings += 1;
            if (element.matches("main, [role=main]")) counts.mainLandmarks += 1;
            if (element.matches("form")) counts.forms += 1;
            if (element.matches('input[type="search"], [role=searchbox]')) counts.searchControls += 1;
            if (element.matches('input:not([type="hidden"]), select, textarea') && visible(element)) counts.visibleInputs += 1;
            if (element.matches("button, [role=button]") && visible(element)) counts.visibleButtons += 1;
            if (element.matches("a[href]") && visible(element)) counts.visibleLinks += 1;
            if (element.matches("article, [role=article], [class*=card i]")) counts.cardLikeElements += 1;
          }
          const domScanTruncated = inspected >= maxElements && walker.nextNode() !== null;
          const textWalker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
          const textParts: string[] = [];
          let sampledTextLength = 0;
          let sampledNodes = 0;
          let textScanTruncated = false;
          while (sampledNodes < maxElements && sampledTextLength < 100_000 && textWalker.nextNode() !== null) {
            sampledNodes += 1;
            const fullNodeText = textWalker.currentNode.textContent ?? "";
            const nodeText = fullNodeText.slice(0, 1_000);
            if (fullNodeText.length > nodeText.length) textScanTruncated = true;
            sampledTextLength += nodeText.length;
            if (textParts.join(" ").length < 240 && nodeText.trim().length > 0) textParts.push(nodeText.trim().slice(0, 240));
          }
          if (sampledNodes >= maxElements && textWalker.nextNode() !== null) textScanTruncated = true;
          if (sampledTextLength >= 100_000 && textWalker.nextNode() !== null) textScanTruncated = true;
          const bodyTextSample = textParts.join(" ").replace(/\\s+/gu, " ").slice(0, 240);
          const state: BrowserPageSnapshot["state"] = isNavigationFailed ? "navigation-failed" : isAuthGate ? "authentication-gated" :
            isInspectionIncomplete || domScanTruncated || textScanTruncated ? "incomplete" :
            sampledTextLength === 0 && counts.headings === 0 && counts.mainLandmarks === 0 && counts.forms === 0 &&
              counts.searchControls === 0 && counts.visibleInputs === 0 && counts.visibleButtons === 0 && counts.visibleLinks === 0
              ? "empty" : "rendered";
          return {
            stage: snapshotStage,
            state,
            path: window.location.pathname.slice(0, 512),
            status: navigationStatus,
            title: document.title.slice(0, 160),
            bodyTextLength: sampledTextLength,
            bodyTextSample,
            ...counts,
            domScanTruncated,
            textScanTruncated,
          };
        }, {
          snapshotStage: stage,
          navigationStatus: metrics.navigationHttpStatus,
          isNavigationFailed: metrics.navigationFailed,
          isAuthGate: passwordState === "visible",
          isInspectionIncomplete: passwordState === "limit",
          maxElements: MAX_DIAGNOSTIC_DOM_ELEMENTS,
        });
        if (snapshot.state === "empty") {
          metrics.pageInspectionFailed = true;
          recordObservedFailure(`Observed an empty ${stage} page after bounded rendering: no sampled text, headings, main landmarks, forms, search controls, or visible controls.`);
        } else if (snapshot.state === "authentication-gated") {
          recordObservedFailure(`Observed a visible password field in the ${stage} page; journey execution is stopped at the authentication gate.`);
        } else if (snapshot.state === "incomplete") {
          metrics.pageInspectionFailed = true;
          recordObservedFailure(`The ${stage} page inspection reached a bounded DOM, text, or authentication-scan limit; empty-page and missing-result conclusions are withheld.`);
        }
        metrics.pageDiagnostics.snapshots.push(snapshot);
        return snapshot;
      };
      const captureScreenshot = async (stage: "initial" | "final"): Promise<void> => {
        if (metrics.pageDiagnostics.screenshots.length >= MAX_DIAGNOSTIC_SCREENSHOTS) {
          metrics.pageDiagnostics.screenshotLimitReached = true;
          return;
        }
        try {
          const png = await page.screenshot({ type: "png", animations: "disabled", timeout: 3_000 });
          if (png.byteLength > MAX_DIAGNOSTIC_SCREENSHOT_BYTES) {
            metrics.pageDiagnostics.screenshotLimitReached = true;
            recordObservedFailure(`The ${stage} screenshot exceeded the 4 MiB evidence limit and was not retained.`);
            return;
          }
          metrics.pageDiagnostics.screenshots.push({ stage, png });
        } catch {
          recordObservedFailure(`The bounded ${stage} screenshot could not be captured.`);
        }
      };
      try {
        if (publicOptions !== undefined) approvedNavigationUrls.add(target.toString());
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
      await waitForRenderedContent();
      await settleNetwork();
      if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
      let initialSnapshot: BrowserPageSnapshot | undefined;
      if (manualLogin) {
        if (manualInteraction === undefined) throw new BrowserAuditError("Manual login approvals are unavailable.");
        manualLoginPhase = true;
        await fixtureDependencies?.onManualLoginReady?.(page);
        const loginCompleted = await manualInteraction.completeLogin();
        if (!loginCompleted) throw new BrowserAuditError("Manual login was cancelled before the read-only journey.");
        manualLoginClosing = true;
        await Promise.all([...pendingManualApprovals]);
        manualLoginPhase = false;
        await waitForRenderedContent();
        await settleNetwork();
        if (!await manualInteraction.approveJourney(publicOptions?.journey ?? [])) {
          throw new BrowserAuditError("The read-only journey was not approved after manual login.");
        }
      } else {
        initialSnapshot = await captureSnapshot("initial");
        await captureScreenshot("initial");
      }
      try {
        if (!manualLogin) {
          const finalUrl = new URL(page.url());
          if (publicOptions === undefined || finalUrl.origin === target.origin) metrics.finalPath = finalUrl.pathname.slice(0, 512);
        }
      } catch { /* Final path remains unavailable for a failed navigation. */ }

      if (publicOptions !== undefined) {
        for (let stepIndex = 0; stepIndex < publicOptions.journey.length; stepIndex += 1) {
          const step = publicOptions.journey[stepIndex];
          if (step === undefined) continue;
          if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
          if (runtimeLimitReached) {
            const remainingSteps = publicOptions.journey.length - metrics.journeyStepsCompleted - metrics.journeyStepsFailed;
            for (let remaining = 0; remaining < remainingSteps; remaining += 1) recordJourneyFailure("audit-runtime-limit");
            break;
          }
          try {
            const passwordInspection = await inspectPasswordFields();
            if (passwordInspection !== "none") {
              metrics.authenticationGateDetected = passwordInspection === "visible";
              metrics.authenticationGateDetectionIncomplete = passwordInspection === "limit";
              const remainingSteps = publicOptions.journey.length - metrics.journeyStepsCompleted - metrics.journeyStepsFailed;
              const reason = passwordInspection === "visible" ? "authentication-gate-detected" : "authentication-scan-limit-reached";
              for (let remaining = 0; remaining < remainingSteps; remaining += 1) recordJourneyFailure(reason);
              break;
            }
            if (step.type === "search") {
              await waitForVisibleJourneyTarget(page.getByRole("searchbox").first());
            } else if (step.type === "expect-text") {
              await waitForVisibleJourneyTarget(page.getByText(step.text, { exact: true }).first());
            } else if (step.type === "click-link") {
              await waitForVisibleJourneyTarget(page.getByRole("link", { name: step.text, exact: true }).first());
            } else if (step.type === "open-first-book") {
              await waitForVisibleJourneyTarget(page.getByRole("main").first().getByRole("link", { name: /Harry Potter/i }).first());
            }
            const postWaitPasswordInspection = await inspectPasswordFields();
            if (postWaitPasswordInspection !== "none") {
              metrics.authenticationGateDetected = postWaitPasswordInspection === "visible";
              metrics.authenticationGateDetectionIncomplete = postWaitPasswordInspection === "limit";
              const remainingSteps = publicOptions.journey.length - metrics.journeyStepsCompleted - metrics.journeyStepsFailed;
              const reason = postWaitPasswordInspection === "visible" ? "authentication-gate-detected" : "authentication-scan-limit-reached";
              for (let remaining = 0; remaining < remainingSteps; remaining += 1) recordJourneyFailure(reason);
              break;
            }
            if (step.type === "go-back") {
              const previous = await page.goBack({ waitUntil: "domcontentloaded", timeout: MAX_PAGE_TIMEOUT_MS });
              if (previous === null) recordJourneyFailure("browser-history-unavailable");
              else {
                await waitForRenderedContent();
                await settleNetwork();
                metrics.journeyStepsCompleted += 1;
                recordJourneyEvidence(`Returned to ${new URL(page.url()).pathname} with browser history.`);
              }
              continue;
            }
            if (step.type === "expect-text") {
              const text = page.getByText(step.text, { exact: true });
              if (await text.count() === 0 || !(await text.first().isVisible())) {
                recordJourneyFailure("expected-visible-text-not-found");
                continue;
              }
              metrics.journeyStepsCompleted += 1;
              continue;
            }
            if (step.type === "search") {
              const searchboxes = page.getByRole("searchbox");
              if (await searchboxes.count() !== 1 || !(await searchboxes.isVisible())) {
                recordJourneyFailure("searchbox-not-unique-and-visible");
                continue;
              }
              const field = await searchboxes.evaluate((element) => {
                if (!(element instanceof HTMLInputElement) || element.form === null || element.form.method.toUpperCase() !== "GET" ||
                    element.type !== "search" || element.name.trim().length === 0) return null;
                const namedControls = Array.from(element.form.elements).filter((control) => {
                  if (!(control instanceof HTMLElement) || ("disabled" in control && control.disabled)) return false;
                  return "name" in control && typeof control.name === "string" && control.name.trim().length > 0;
                });
                if (namedControls.length !== 1 || namedControls[0] !== element) return null;
                return { action: element.form.action, name: element.name };
              });
              if (!isRecord(field) || typeof field["action"] !== "string" || typeof field["name"] !== "string") {
                recordJourneyFailure("search-field-is-not-a-single-named-get-control");
                continue;
              }
              const searchUrl = new URL(field["action"]);
              if (searchUrl.origin !== target.origin || searchUrl.protocol !== "https:" || searchUrl.search.length > 0 || searchUrl.hash.length > 0 ||
                  searchUrl.username.length > 0 || searchUrl.password.length > 0) {
                recordBlockedOrigin(searchUrl);
                metrics.blockedExternalRequestCount += 1;
                recordJourneyFailure("search-action-is-not-same-origin-https");
                continue;
              }
              searchUrl.searchParams.set(field["name"], step.text);
              approvedNavigationUrls.add(searchUrl.toString());
              const response = await page.goto(searchUrl.toString(), { waitUntil: "domcontentloaded", timeout: MAX_PAGE_TIMEOUT_MS });
              await waitForRenderedContent();
              await settleNetwork();
              if (response === null || response.status() >= 400) recordJourneyFailure("search-get-did-not-return-success");
              else {
                metrics.journeyStepsCompleted += 1;
                recordJourneyEvidence(`Performed approved GET search on ${searchUrl.pathname} using one search field.`);
              }
              continue;
            }
            let link: import("playwright").Locator;
            if (step.type === "open-first-book") {
              const main = page.getByRole("main");
              if (await main.count() !== 1) {
                recordJourneyFailure("main-landmark-not-unique");
                continue;
              }
              const bookLinks = main.getByRole("link", { name: /Harry Potter/i }).filter({ visible: true });
              if (await bookLinks.count() === 0) {
                recordJourneyFailure("visible-harry-potter-result-link-not-found");
                continue;
              }
              link = bookLinks.first();
            } else {
              link = page.getByRole("link", { name: step.text, exact: true });
            }
            if (await link.count() !== 1) {
              recordJourneyFailure("requested-link-not-unique");
              continue;
            }
            const href = await link.getAttribute("href");
            if (href === null) {
              recordJourneyFailure("requested-link-has-no-destination");
              continue;
            }
            const destination = new URL(href, page.url());
            if (destination.protocol !== "https:" || !approvedOrigins.has(destination.origin) ||
                destination.username.length > 0 || destination.password.length > 0 || destination.port.length > 0 ||
                destination.origin !== target.origin) {
              recordBlockedOrigin(destination);
              metrics.blockedExternalRequestCount += 1;
              recordJourneyFailure("link-destination-not-approved-same-origin-https");
              continue;
            }
            if (!isClassifiedReadOnlyBrowserDestination(destination)) {
              recordJourneyFailure("link-destination-not-classified-as-read-only");
              continue;
            }
            approvedNavigationUrls.add(destination.toString());
            const linkLabel = await link.evaluate((element, bounds) => {
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let label = "";
              let inspectedNodes = 0;
              while (inspectedNodes < bounds.maxNodes && label.length < bounds.maxLength && walker.nextNode() !== null) {
                inspectedNodes += 1;
                const text = walker.currentNode.textContent?.slice(0, bounds.maxLength - label.length) ?? "";
                if (text.trim().length > 0) label += `${label.length === 0 ? "" : " "}${text.trim()}`;
              }
              return label.replace(/\s+/gu, " ").slice(0, bounds.maxLength);
            }, { maxNodes: 20, maxLength: 200 });
            await link.click({ timeout: MAX_PAGE_TIMEOUT_MS });
            await waitForRenderedContent();
            await settleNetwork();
            metrics.journeyStepsCompleted += 1;
            recordJourneyEvidence(`Opened same-origin link: ${linkLabel}`);
          } catch {
            recordJourneyFailure("journey-action-failed-within-bounds");
          }
        }
      }

      if (!manualLogin) {
        const finalSnapshot = await captureSnapshot("final");
        if (initialSnapshot !== undefined && JSON.stringify({ ...initialSnapshot, stage: "final" }) !== JSON.stringify(finalSnapshot)) {
          await captureScreenshot("final");
        }
      }

      if (!manualLogin) try {
        const finalUrl = new URL(page.url());
        if (finalUrl.origin === target.origin) metrics.finalPath = finalUrl.pathname.slice(0, 512);
      } catch { /* Final path remains unavailable for a failed navigation. */ }

      if (!manualLogin) try {
        const desktop = await page.evaluate(({ maxElements, maxLabelNodes }) => {
          const isVisible = (element: Element): boolean => {
            if (element.closest("[aria-hidden='true'], [hidden]")) return false;
            const style = window.getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
          };
          const result = { width: document.documentElement.scrollWidth, viewport: window.innerWidth, missingAlt: 0, unnamedControls: 0 };
          const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
          let inspected = 0;
          while (inspected < maxElements && walker.nextNode() !== null) {
            const element = walker.currentNode;
            if (!(element instanceof Element)) continue;
            inspected += 1;
            if (element.matches("img:not([alt])")) result.missingAlt += 1;
            if (!element.matches("button, a[href], input:not([type=hidden]), select, textarea, [role=button]") || !isVisible(element)) continue;
            const namedByAttribute = ["aria-label", "aria-labelledby", "title"].some((name) => (element.getAttribute(name)?.trim().length ?? 0) > 0);
            const associatedLabel = element instanceof HTMLInputElement && (element.labels?.length ?? 0) > 0;
            let hasText = false;
            if (!namedByAttribute && !associatedLabel) {
              const textWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let inspectedLabelNodes = 0;
              while (inspectedLabelNodes < maxLabelNodes && textWalker.nextNode() !== null) {
                inspectedLabelNodes += 1;
                if ((textWalker.currentNode.textContent?.slice(0, 128).trim().length ?? 0) > 0) { hasText = true; break; }
              }
            }
            if (!namedByAttribute && !associatedLabel && !hasText) result.unnamedControls += 1;
          }
          return { ...result, scanTruncated: inspected >= maxElements && walker.nextNode() !== null };
        }, { maxElements: MAX_DIAGNOSTIC_DOM_ELEMENTS, maxLabelNodes: 20 });
        metrics.desktopHorizontalOverflow = desktop.width > desktop.viewport;
        metrics.missingAltCount = desktop.missingAlt;
        metrics.unnamedControlCount = desktop.unnamedControls;
        if (desktop.scanTruncated) metrics.pageInspectionFailed = true;
        await page.setViewportSize({ width: 360, height: 800 });
        metrics.mobileHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        await page.setViewportSize({ width: 1280, height: 800 });
      } catch {
        metrics.pageInspectionFailed = true;
      }

      if (!manualLogin) {
      try {
        metrics.designObservations = await page.evaluate(({ maxElements }) => {
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
          const structureCounts = { headings: 0, mainLandmarks: 0, forms: 0, searchControls: 0, links: 0 };
          const visibleButtons: HTMLElement[] = [];
          const visibleLinks: HTMLElement[] = [];
          const componentWalker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
          let inspectedElements = 0;
          while (inspectedElements < maxElements && componentWalker.nextNode() !== null) {
            const element = componentWalker.currentNode;
            if (!(element instanceof Element)) continue;
            inspectedElements += 1;
            if (element.matches("h1, h2, h3, h4, h5, h6")) structureCounts.headings += 1;
            if (element.matches("main")) structureCounts.mainLandmarks += 1;
            if (element.matches("form")) structureCounts.forms += 1;
            if (element.matches('input[type="search"], [role="searchbox"]')) structureCounts.searchControls += 1;
            if (element.matches("a[href]")) structureCounts.links += 1;
            for (let selectorIndex = 0; selectorIndex < componentSelectors.length; selectorIndex += 1) {
              const selector = componentSelectors[selectorIndex]?.[1];
              if (selector !== undefined && element.matches(selector)) componentCounts[selectorIndex] = (componentCounts[selectorIndex] ?? 0) + 1;
            }
            if (element instanceof HTMLElement && (element.matches("button, [role=button]") || element.matches("a[href]"))) {
              const style = window.getComputedStyle(element);
              if (style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0) {
                if (element.matches("button, [role=button]") && visibleButtons.length < 50) visibleButtons.push(element);
                if (element.matches("a[href]") && visibleLinks.length < 50) visibleLinks.push(element);
              }
            }
          }
          for (let selectorIndex = 0; selectorIndex < componentSelectors.length; selectorIndex += 1) {
            const label = componentSelectors[selectorIndex]?.[0];
            const count = componentCounts[selectorIndex];
            if (label !== undefined && count !== undefined && count > 0) observations.push(`observed component ${label}: ${count}`);
            if (observations.length >= 31) break;
          }
          const structureSample = inspectedElements === maxElements ? ` (sampled first ${maxElements} elements)` : "";
          observations.push(`observed page structure${structureSample}: ${structureCounts.headings} headings, ${structureCounts.mainLandmarks} main landmarks, ${structureCounts.forms} forms, ${structureCounts.searchControls} search controls, ${structureCounts.links} links`);
          if (inspectedElements === maxElements && observations.length < 32) observations.push(`component counts sampled from first ${maxElements} elements`);
          for (const [label, visible] of [["buttons", visibleButtons], ["links", visibleLinks]] as const) {
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
        }, { maxElements: MAX_DIAGNOSTIC_DOM_ELEMENTS });
      } catch {
        metrics.designInspectionFailed = true;
      }

      let hrefValues: unknown;
      try {
        hrefValues = await page.evaluate(({ maxElements, maxLinks }) => {
          const hrefs: string[] = [];
          const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
          let inspected = 0;
          while (inspected < maxElements && hrefs.length < maxLinks && walker.nextNode() !== null) {
            const element = walker.currentNode;
            if (!(element instanceof Element)) continue;
            inspected += 1;
            if (!element.matches("a[href]")) continue;
            const href = element.getAttribute("href");
            if (href !== null) hrefs.push(href.slice(0, 2_048));
          }
          return hrefs;
        }, { maxElements: MAX_DIAGNOSTIC_DOM_ELEMENTS, maxLinks: MAX_LINKS_TO_CHECK });
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
            if (!approvedOrigins.has(link.origin)) {
              recordBlockedOrigin(link);
              metrics.blockedExternalRequestCount += 1;
            }
            continue;
          }
          if (!isClassifiedReadOnlyBrowserDestination(link)) {
            recordObservedFailure(`Skipped same-origin route probe because the path is not classified as read-only: ${safeRequestPath(link.toString())}.`);
            continue;
          }
          metrics.linksChecked += 1;
          try {
            diagnosticRouteProbeUrls.add(link.toString());
            const status = await page.evaluate(async ({ href: hrefValue, timeoutMs }) => {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), timeoutMs);
              try {
                const response = await fetch(hrefValue, {
                  method: "HEAD", credentials: "omit", redirect: "manual", cache: "no-store", signal: controller.signal,
                });
                const statusCode = response.status;
                await response.body?.cancel();
                return statusCode;
              } catch { return 0; }
              finally { clearTimeout(timer); }
            }, { href: link.toString(), timeoutMs: MAX_LINK_TIMEOUT_MS });
            if (status === 404 || status === 410) metrics.brokenLinkCount += 1;
            if (status === 0 || status >= 400) recordObservedFailure(`Observed same-origin HEAD route probe result (${status === 0 ? "transport failure" : `HTTP ${status}`}): ${safeRequestPath(link.toString())}; non-404/410 results are not classified as broken links.`);
          } catch {
            recordObservedFailure(`Observed same-origin HEAD route probe failure: ${safeRequestPath(link.toString())}; no broken-link conclusion was made.`);
          }
          if (isAborted(signal)) throw new BrowserAuditError("Browser audit was cancelled.");
        }
      }
      const noBookCardsObserved = !metrics.authenticationGateDetected && metrics.pageDiagnostics.snapshots.length > 0 &&
        metrics.pageDiagnostics.snapshots.every((snapshot) => snapshot.cardLikeElements === 0 && snapshot.state !== "incomplete" && snapshot.state !== "authentication-gated");
      if (noBookCardsObserved && metrics.pageDiagnostics.blockedDataResourceOrigins.length > 0) {
        metrics.pageDiagnostics.suspectedCauses.push("Blocked cross-origin fetch/XHR requests may be related to missing results; page content is untrusted and cannot authorize access, and correlation does not confirm causation.");
      }
      if (noBookCardsObserved && metrics.pageDiagnostics.observedFailures.some((failure) => /(?:Observed failed (?:fetch|xhr) request at|Observed HTTP \d{3} (?:fetch|xhr) response at)/iu.test(failure))) {
        metrics.pageDiagnostics.suspectedCauses.push("An observed failed same-origin fetch/XHR may be related to absent result cards; this is a hypothesis, not a confirmed cause.");
      }
      if (metrics.pageDiagnostics.snapshots.some((snapshot) => snapshot.state === "empty") &&
          metrics.pageDiagnostics.observedFailures.every((failure) => !/(?:fetch|xhr)/iu.test(failure))) {
        metrics.pageDiagnostics.suspectedCauses.push("The page was empty after bounded rendering, but no data-request failure was observed to explain it.");
      }
      }
    } finally {
      await context.close();
    }
  } catch (error: unknown) {
    if (error instanceof BrowserAuditError) throw error;
    fixtureDependencies?.onUnexpectedAuditError?.(error);
    throw new BrowserAuditError("The local browser could not complete the fixture audit. Verify the Playwright package and Chromium binary.");
  } finally {
    if (browser !== undefined) await browser.close().catch(() => undefined);
    fixtureDependencies?.onBrowserClosed?.();
    if (egressProxy !== undefined) await egressProxy.close().catch(() => undefined);
    clearTimeout(runtimeTimer);
    signal?.removeEventListener("abort", abortContext);
  }
  metrics.runtimeLimitReached = runtimeLimitReached;
  metrics.durationMs = Math.max(0, Date.now() - startedAt);
  return metrics;
}

function summarize(metrics: BrowserAuditResult["metrics"]): string {
  return `Browser audit ${metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed || metrics.journeyStepsFailed > 0 || metrics.runtimeLimitReached ? "incomplete" : "complete"}: navigation failed=${metrics.navigationFailed}, authentication gate detected=${metrics.authenticationGateDetected}, authentication gate scan incomplete=${metrics.authenticationGateDetectionIncomplete}, page inspection failed=${metrics.pageInspectionFailed}, design inspection failed=${metrics.designInspectionFailed}, journey=${metrics.journeyStepsCompleted}/${metrics.journeyStepsCompleted + metrics.journeyStepsFailed} steps, ${metrics.httpErrorCount} HTTP errors, ${metrics.networkFailureCount} failed approved-origin requests excluding policy blocks, ${metrics.brokenLinkCount}/${metrics.linksChecked} same-origin links broken, ${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ${metrics.missingAltCount} images missing alt text, ${metrics.unnamedControlCount} unnamed visible controls (heuristic), mobile overflow=${metrics.mobileHorizontalOverflow}, desktop overflow=${metrics.desktopHorizontalOverflow}, ${metrics.missingSecurityHeaderCount}/${metrics.securityHeadersChecked} checked passive security headers missing, mixed-content check=${metrics.mixedContentCheck} (${metrics.mixedContentRequestCount} requests), ${metrics.blockedExternalRequestCount} unapproved resources blocked, ${metrics.blockedNavigationCount} out-of-scope document navigations or HTTP redirects blocked, ${metrics.blockedMutatingRouteCount} suspected mutating-route requests blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ${metrics.blockedWebSocketCount} WebSockets blocked, ${metrics.blockedPrivateAddressRequestCount} private-address DNS attempts blocked, ${metrics.blockedRequestLimitCount} requests blocked at the limit, total runtime limit reached=${metrics.runtimeLimitReached}.`;
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
  manualLoginInteraction?: BrowserManualLoginInteraction,
): Promise<BrowserAuditResult> {
  const target = validatePublicBrowserTarget(targetValue);
  if (!isRecord(optionsValue) || Object.keys(optionsValue).some((key) => key !== "approvedOrigins" && key !== "journey" && key !== "manualLogin") ||
      !Array.isArray(optionsValue["approvedOrigins"])) {
    throw new BrowserAuditError("Public browser audit requires approved origins and an explicit journey.");
  }
  const manualLogin = optionsValue["manualLogin"] === true;
  if (optionsValue["manualLogin"] !== undefined && typeof optionsValue["manualLogin"] !== "boolean") {
    throw new BrowserAuditError("Manual-login mode must be a boolean opt-in.");
  }
  if (manualLogin && manualLoginInteraction === undefined) {
    throw new BrowserAuditError("Manual-login mode requires explicit interactive approvals.");
  }
  const rawOrigins = optionsValue["approvedOrigins"];
  if (rawOrigins.length > MAX_APPROVED_ORIGINS - 1) throw new BrowserAuditError("At most 7 additional resource origins may be approved.");
  const origins = new Set<string>([target.origin]);
  for (const rawOrigin of rawOrigins) origins.add(validateApprovedBrowserOrigin(rawOrigin));
  if (origins.size > MAX_APPROVED_ORIGINS) throw new BrowserAuditError("At most 8 origins may be approved for one audit.");
  const options: PublicBrowserAuditOptions = {
    approvedOrigins: [...origins],
    journey: validateBrowserJourney(optionsValue["journey"]),
    ...(manualLogin ? { manualLogin: true } : {}),
  };
  const metrics = await auditPublicBrowserPage(target, options, signal,
    manualLoginInteraction === undefined ? undefined : { manualLoginInteraction });
  return persistBrowserAudit(store, metrics, "browser-public-audit", "Public browser audit started; target URL, journey text, page contents, links, and console messages are not persisted.");
}
