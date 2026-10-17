import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { loadProviderConfiguration } from "../../config/configuration.js";
import { ConfigurationError } from "../../config/configuration.js";
import { SpecialistReviewError } from "../../agent/specialist-review.js";
import { ModelProviderError } from "../../providers/types.js";
import {
  BrowserAuditError, browserAuditExitCode, runBrowserAudit, runPublicBrowserAudit,
  validateApprovedBrowserOrigin, validateBrowserJourney, validateLoopbackBrowserTarget, validatePublicBrowserTarget,
  type BrowserAuditResult, type BrowserJourneyStep,
} from "../../workflows/browser-audit-workflow.js";
import { escapeTerminalControls } from "../../security/terminal-text.js";
import type { TaskForgeStore } from "../../storage/store.js";

type EvidenceSpecialistReview = (
  role: "browser-specialist" | "data-specialist",
  goal: string,
  evidence: string,
  providerConfiguration: ReturnType<typeof loadProviderConfiguration>,
  signal: AbortSignal,
) => Promise<boolean>;

export interface BrowserAuditCommandDependencies {
  readonly withStore: <T>(action: (store: TaskForgeStore) => Promise<T>) => Promise<T | undefined>;
  readonly runEvidenceSpecialistReview: EvidenceSpecialistReview;
}
async function saveBrowserAuditScreenshots(
  screenshots: BrowserAuditResult["metrics"]["pageDiagnostics"]["screenshots"],
): Promise<readonly string[]> {
  if (screenshots.length === 0) return [];
  const directory = await mkdtemp(join(tmpdir(), "taskforge-browser-audit-"));
  const paths: string[] = [];
  for (const screenshot of screenshots) {
    const path = join(directory, `${screenshot.stage}.png`);
    await writeFile(path, screenshot.png, { flag: "wx" });
    paths.push(path);
  }
  return paths;
}

function escapeBrowserAuditDisplay(value: string): string {
  return escapeTerminalControls(value).replace(/\p{Cf}/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
  });
}

export async function runBrowserAuditCommand(commandArgs: readonly string[], dependencies: BrowserAuditCommandDependencies): Promise<void> {
  let targetValue: string | undefined;
  let journeyValue: string | undefined;
  const rawOrigins: string[] = [];
  let withSpecialist = false;
  let manualLogin = false;
  for (let index = 0; index < commandArgs.length;) {
    const option = commandArgs[index];
    if (option === "--specialist" && !withSpecialist) {
      withSpecialist = true;
      index += 1;
      continue;
    }
    if (option === "--manual-login" && !manualLogin) {
      manualLogin = true;
      index += 1;
      continue;
    }
    const value = commandArgs[index + 1];
    if (value === undefined || value.trim().length === 0) {
      process.stderr.write("Browser audit option values must be supplied.\n");
      process.exitCode = 1;
      return;
    }
    if (option === "--url" && targetValue === undefined) targetValue = value;
    else if (option === "--journey" && journeyValue === undefined) journeyValue = value;
    else if (option === "--origin" && rawOrigins.length < 7) rawOrigins.push(value);
    else {
      process.stderr.write("Expected --url <url> [--journey <json-array>] [--origin <https-origin>]... [--manual-login] [--specialist].\n");
      process.exitCode = 1;
      return;
    }
    index += 2;
  }
  if (targetValue === undefined) {
    process.stderr.write("Expected --url <loopback-http-url> or --url <public-https-url> --journey <json-array>.\n");
    process.exitCode = 1;
    return;
  }
  let target: URL;
  let isPublic = false;
  try {
    target = validateLoopbackBrowserTarget(targetValue);
  } catch (error: unknown) {
    try {
      target = validatePublicBrowserTarget(targetValue);
      isPublic = true;
    } catch (publicError: unknown) {
      process.stderr.write(`${publicError instanceof BrowserAuditError ? publicError.message : error instanceof BrowserAuditError ? error.message : "Browser audit target was rejected."}\n`);
      process.exitCode = 1;
      return;
    }
  }
  let approvedOrigins: readonly string[] = [];
  let journey: readonly BrowserJourneyStep[] | undefined;
  if (isPublic) {
    if (journeyValue === undefined) {
      process.stderr.write("Public-site browser audits require an explicit --journey JSON array.\n");
      process.exitCode = 1;
      return;
    }
    let rawJourney: unknown;
    try { rawJourney = JSON.parse(journeyValue); } catch {
      process.stderr.write("The browser journey must be valid JSON.\n");
      process.exitCode = 1;
      return;
    }
    try {
      journey = validateBrowserJourney(rawJourney);
      approvedOrigins = [...new Set(rawOrigins.map(validateApprovedBrowserOrigin))];
      if (approvedOrigins.includes(target.origin)) {
        process.stderr.write("The target origin is approved automatically; pass only additional resource origins.\n");
        process.exitCode = 1;
        return;
      }
    } catch (error: unknown) {
      process.stderr.write(`${error instanceof BrowserAuditError ? error.message : "Browser journey or origins were rejected."}\n`);
      process.exitCode = 1;
      return;
    }
  } else if (journeyValue !== undefined || rawOrigins.length > 0) {
    process.stderr.write("Journey and additional-origin options are only valid for public HTTPS audits.\n");
    process.exitCode = 1;
    return;
  }
  if (manualLogin && (!isPublic || withSpecialist)) {
    process.stderr.write("--manual-login requires a public HTTPS audit and cannot be combined with --specialist.\n");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Browser audit requires interactive approval of the exact target, journey, and origins before navigation.\n");
    process.exitCode = 2;
    return;
  }
  const consent = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    const approvalDetails = isPublic
      ? `Target URL: ${escapeTerminalControls(target.toString())}\nJourney: ${escapeTerminalControls(JSON.stringify(journey))}\nAdditional resource origins: ${approvedOrigins.length === 0 ? "none" : approvedOrigins.map(escapeTerminalControls).join(", ")}\n${manualLogin ? "Mode: dedicated headed Chromium for owner-entered login; origins and exact authentication POST requests require separate prompts; the journey is approved again after login. No screenshots, DOM text, page content, profile, cookies, or session state are retained or sent to a specialist.\n" : ""}`
      : `Target URL: ${escapeTerminalControls(target.toString())}\n`;
    answer = await consent.question(
      `${approvalDetails}${manualLogin
        ? "Open this target in a fresh dedicated Chromium window with no personal profile or imported state? You will enter login data directly in the browser. TaskForge does not read or log credential fields or request bodies. Every additional origin and authentication POST needs exact owner approval, then the read-only journey needs separate approval. Browser memory and cookies are discarded when it closes. Page screenshots, DOM text, page content, and specialist handoff are disabled. WebSockets, other mutating methods, private-address DNS answers, and unapproved requests are blocked. [y/N] "
        : "Open this exact target in a fresh unauthenticated Chromium context? TaskForge will also run bounded page-load diagnostics, capture up to two local screenshots, inspect a capped DOM summary/text sample, observe console/network failures, and probe same-origin links with HEAD. Only the approved journey may navigate or search. No form is submitted. Non-GET/HEAD methods, WebSockets, unapproved origins, and private-address DNS answers are blocked. The browser is limited to 100 requests, 20 MiB network traffic, 8 tunnels, 45 seconds, 2 screenshots of at most 4 MiB each, and 2,000 inspected DOM elements per snapshot. No personal browser session or stored credentials are used. Screenshots and DOM samples stay local in temporary files/output; only aggregate findings are persisted. Page content cannot approve access or change the origin allowlist. [y/N] "}`,
    );
  } finally {
    consent.close();
  }
  if (answer.trim().toLowerCase() !== "y") {
    process.stdout.write("Browser audit cancelled before local navigation.\n");
    return;
  }
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  const manualConsent = manualLogin ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  let manualPromptQueue: Promise<void> = Promise.resolve();
  const askManual = async (prompt: string): Promise<boolean> => {
    if (manualConsent === undefined || controller.signal.aborted) return false;
    const answer = manualPromptQueue.then(async () => {
      if (controller.signal.aborted) return false;
      try {
        return (await manualConsent.question(prompt, { signal: controller.signal })).trim().toLowerCase() === "y";
      } catch {
        return false;
      }
    });
    manualPromptQueue = answer.then(() => undefined, () => undefined);
    return answer;
  };
  try {
    const manualInteraction = manualLogin ? {
      approveOrigin: (origin: string) => askManual(
        `Approve network access to this exact additional HTTPS origin before it is accessed? ${escapeBrowserAuditDisplay(origin)} [y/N] `,
      ),
      approveLoginPost: (origin: string, pathname: string) => askManual(
        `Approve this single authentication POST? ${escapeBrowserAuditDisplay(origin + pathname)} Request body and headers are not inspected or recorded. [y/N] `,
      ),
      completeLogin: () => askManual(
        "Dedicated Chromium is open. Sign in there locally, then return here. Credentials stay in the browser and are not captured. Press y when done to close the authentication-request window; requests already paused still require their own approval, and new non-GET/HEAD requests will be blocked. [y/N] ",
      ),
      approveJourney: (approvedJourney: readonly BrowserJourneyStep[]) => askManual(
        `Approve this exact read-only journey after login? ${escapeTerminalControls(JSON.stringify(approvedJourney))} No screenshots, DOM text, page content, or specialist handoff will be captured. [y/N] `,
      ),
    } : undefined;
    const result = await dependencies.withStore((store) => isPublic
      ? runPublicBrowserAudit(store, target.toString(), { approvedOrigins, journey, ...(manualLogin ? { manualLogin: true } : {}) }, controller.signal, manualInteraction)
      : runBrowserAudit(store, target.toString(), controller.signal));
    if (result !== undefined) {
      const metrics = result.metrics;
      let screenshotPaths: readonly string[] = [];
      try { screenshotPaths = manualLogin ? [] : await saveBrowserAuditScreenshots(metrics.pageDiagnostics.screenshots); }
      catch { process.stderr.write("Screenshot bytes were captured but could not be saved to the local temporary folder.\n"); }
      process.stdout.write(
        `Run ${result.run.runId} ${metrics.navigationFailed || metrics.pageInspectionFailed || metrics.designInspectionFailed || metrics.journeyStepsFailed > 0 || metrics.runtimeLimitReached ? "incomplete" : "completed"}: navigation failed=${metrics.navigationFailed}, authentication gate detected=${metrics.authenticationGateDetected}, authentication gate scan incomplete=${metrics.authenticationGateDetectionIncomplete}, page inspection failed=${metrics.pageInspectionFailed}, design inspection failed=${metrics.designInspectionFailed}, journey=${metrics.journeyStepsCompleted}/${metrics.journeyStepsCompleted + metrics.journeyStepsFailed}, ` +
        `${metrics.httpErrorCount} HTTP errors, ${metrics.networkFailureCount} failed approved-origin requests excluding policy blocks, ${metrics.brokenLinkCount}/${metrics.linksChecked} same-origin links broken, ` +
        `${metrics.consoleErrorCount} console errors, ${metrics.pageErrorCount} page errors, ${metrics.missingAltCount} images without alt text, ` +
        `${metrics.unnamedControlCount} unnamed controls, mobile overflow=${metrics.mobileHorizontalOverflow}, desktop overflow=${metrics.desktopHorizontalOverflow}, ` +
        `${metrics.missingSecurityHeaderCount}/${metrics.securityHeadersChecked} passive headers missing, mixed-content=${metrics.mixedContentCheck} (${metrics.mixedContentRequestCount} requests), ` +
        `${metrics.blockedExternalRequestCount} unapproved resources blocked, ${metrics.blockedNavigationCount} out-of-scope document navigations or HTTP redirects blocked, ${metrics.blockedMutatingRouteCount} suspicious mutating-route requests blocked, ${metrics.blockedUnsafeMethodCount} unsafe methods blocked, ${metrics.blockedWebSocketCount} WebSockets blocked, ` +
        `${metrics.blockedPrivateAddressRequestCount} private DNS answers blocked, ${metrics.blockedRequestLimitCount} requests blocked at the limit, runtime-limit=${metrics.runtimeLimitReached}.\n`,
      );
      if (manualLogin) process.stdout.write("Manual-login privacy boundary: no authenticated-page screenshots, DOM snapshots/text, page text, responsive/accessibility/design inspection, or specialist handoff were captured. The temporary browser context was closed; cookies and in-memory session state were discarded.\n");
      const finalPathWithoutFormatControls = (manualLogin ? undefined : metrics.finalPath)?.replace(/\p{Cf}/gu, (character) => {
        const codePoint = character.codePointAt(0);
        return codePoint === undefined ? "" : `\\u{${codePoint.toString(16)}}`;
      });
      process.stdout.write(`Navigation evidence (local only): last approved-origin navigation status=${metrics.navigationHttpStatus ?? "unavailable"}, final path=${escapeTerminalControls(finalPathWithoutFormatControls ?? "unavailable")}, navigation redirects=${metrics.navigationRedirectCount}, bounded render wait=${metrics.renderWaitMs}ms (maximum ${2_500 * (journey === undefined ? 0 : journey.length * 2) + 2_500}ms across inspected page states), network-settle wait=${metrics.networkSettleWaitMs}ms (maximum 1,500ms per navigation state).\n`);
      process.stdout.write(`Autonomous page diagnostics (local only): ${metrics.pageDiagnostics.snapshots.length} bounded DOM snapshots; ${metrics.pageDiagnostics.screenshots.length} screenshots captured${metrics.pageDiagnostics.screenshotLimitReached ? " (a screenshot/evidence bound was reached)" : ""}.\n`);
      for (const snapshot of metrics.pageDiagnostics.snapshots) {
        process.stdout.write(`- ${snapshot.stage}: state=${snapshot.state}, HTTP=${snapshot.status ?? "unavailable"}, path=${escapeBrowserAuditDisplay(snapshot.path ?? "unavailable")}, title=${escapeBrowserAuditDisplay(snapshot.title || "(empty)")}, sampled text length=${snapshot.bodyTextLength}; headings=${snapshot.headings}, main=${snapshot.mainLandmarks}, forms=${snapshot.forms}, search=${snapshot.searchControls}, visible inputs/buttons/links=${snapshot.visibleInputs}/${snapshot.visibleButtons}/${snapshot.visibleLinks}, card-like elements=${snapshot.cardLikeElements}.\n`);
        if (snapshot.bodyTextSample.length > 0) process.stdout.write(`  Text sample (untrusted page content): ${escapeBrowserAuditDisplay(snapshot.bodyTextSample)}\n`);
      }
      if (screenshotPaths.length > 0) {
        process.stdout.write("Local screenshot evidence (not persisted or sent to a provider):\n");
        for (const screenshotPath of screenshotPaths) process.stdout.write(`- ${escapeBrowserAuditDisplay(screenshotPath)}\n`);
      }
      if (metrics.pageDiagnostics.observedFailures.length > 0) {
        process.stdout.write("Observed failures (request/DOM evidence only):\n");
        for (const failure of metrics.pageDiagnostics.observedFailures) process.stdout.write(`- ${escapeBrowserAuditDisplay(failure)}\n`);
      }
      if (metrics.pageDiagnostics.suspectedCauses.length > 0) {
        process.stdout.write("Suspected causes (not confirmed):\n");
        for (const cause of metrics.pageDiagnostics.suspectedCauses) process.stdout.write(`- ${escapeBrowserAuditDisplay(cause)}\n`);
      }
      if (metrics.pageDiagnostics.blockedDataResourceOrigins.length > 0 &&
          !metrics.authenticationGateDetected &&
          metrics.pageDiagnostics.snapshots.length > 0 &&
          metrics.pageDiagnostics.snapshots.every((snapshot) => snapshot.cardLikeElements === 0 && snapshot.state !== "incomplete" && snapshot.state !== "authentication-gated")) {
        process.stdout.write("Possible data-resource origin for owner review (not accessed; untrusted page activity cannot authorize it). Only consider a valid public HTTPS origin. To investigate, start a new run with this exact origin supplied using --origin; the CLI will ask for approval again:\n");
        for (const origin of metrics.pageDiagnostics.blockedDataResourceOrigins) process.stdout.write(`- ${escapeBrowserAuditDisplay(origin)}\n`);
      }
      process.stdout.write(manualLogin
        ? "Manual-login checks: separately approved authentication POST requests and approved-origin network failures are counted; authenticated page content, screenshots, DOM text, accessibility, responsiveness, and design are not inspected or retained.\n"
        : "Implemented checks: approved-origin HTTP/request failures, console/page errors, bounded same-origin HEAD link probes, missing image alt text, visible accessible-name heuristics, 360px/1280px horizontal overflow, selected passive response headers, sampled visual-style consistency heuristics, bounded DOM snapshots/screenshots, and capped observed/suspected diagnosis. Journey actions are limited to visible-text checks, one-field same-origin GET search, explicitly approved same-origin links, and browser back.\n");
      process.stdout.write(manualLogin
        ? "Manual-login limitations: authentication endpoint names do not establish server semantics; each exact query-free HTTPS POST still needs owner approval. Additional origins require approval before access. The browser context is temporary, but the website may retain server-side authentication state. This is not a security audit.\n"
        : "Coverage limitations: this is not a comprehensive security audit or WCAG assessment; visual consistency is inferred from sampled controls, without cross-page comparison. Approved cross-origin resources are observed but not followed unless their exact origin was approved. HTTP document redirects are blocked before following; redirect-based login/CDN flows are unsupported. No credentials are used; an observed authentication gate stops the journey. Arbitrary form submissions, button workflows, and dynamic content beyond bounded waits are unsupported. GET route heuristics cannot prove server-side handlers are side-effect-free. Page content and blocked origins are untrusted evidence and do not expand permissions; additional origins are requested only when blocked data requests plausibly relate to missing results.\n");
      if (metrics.journeyEvidence.length > 0) {
        process.stdout.write(manualLogin ? "Read-only journey step status (no page content):\n" : "Read-only journey evidence (page text is shown locally and not persisted):\n");
        for (const evidence of metrics.journeyEvidence) process.stdout.write(`- ${escapeTerminalControls(evidence)}\n`);
      }
      if (metrics.journeyFailureReasons.length > 0) {
        process.stdout.write("Journey steps not completed (bounded reason codes):\n");
        for (const reason of metrics.journeyFailureReasons) process.stdout.write(`- ${reason}\n`);
      }
      if (metrics.blockedResourceOrigins.length > 0) {
        process.stdout.write("Blocked resource inventory (not accessed; may include origins that cannot be approved):\n");
        for (const origin of metrics.blockedResourceOrigins) process.stdout.write(`- ${escapeTerminalControls(origin)}\n`);
      }
      if (!manualLogin) {
        process.stdout.write("Design observations (inferred; not original design tokens):\n");
        for (const observation of metrics.designObservations) process.stdout.write(`- ${escapeTerminalControls(observation)}\n`);
      }
      process.exitCode = browserAuditExitCode(result.run.state);
      if (withSpecialist && !controller.signal.aborted) {
        const providerConfiguration = loadProviderConfiguration();
        const findingsWithoutPrivateEvidence = (({ blockedResourceOrigins: _blockedResourceOrigins, journeyEvidence: _journeyEvidence, journeyFailureReasons: _journeyFailureReasons, finalPath: _finalPath, pageDiagnostics: _pageDiagnostics, ...shareableMetrics }) => shareableMetrics)(metrics);
        const evidence = JSON.stringify({
          findings: findingsWithoutPrivateEvidence,
          coverageLimitations: [
            "No page text, target URL, origin list, credentials, or session data is included.",
            "Browser observations are aggregate and heuristic; comprehensive security and WCAG checks were not performed.",
          ],
        });
        const complete = await dependencies.runEvidenceSpecialistReview("browser-specialist", "Review these measured browser findings and explicitly reported coverage limitations.", evidence, providerConfiguration, controller.signal);
        if (!complete) process.exitCode = 3;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof BrowserAuditError || error instanceof ConfigurationError || error instanceof ModelProviderError || error instanceof SpecialistReviewError
      ? error.message
      : "Browser audit failed safely; no page content was persisted.";
    process.stderr.write(`${message}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 3;
  } finally {
    manualConsent?.close();
    process.removeListener("SIGINT", interrupt);
  }
}

