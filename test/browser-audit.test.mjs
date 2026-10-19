import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentBudgetLedger } from "../dist/agent/tool-loop.js";
import { runSpecialistReview } from "../dist/agent/specialist-review.js";
import {
  auditPublicBrowserPage, runBrowserAudit, runPublicBrowserAudit, BrowserAuditError, browserAuditExitCode,
  validateApprovedBrowserOrigin, validateBrowserJourney, validatePublicBrowserTarget,
} from "../dist/workflows/browser-audit-workflow.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function createPersistenceRecorder() {
  const state = { events: [], summary: undefined, status: "created" };
  return {
    state,
    async saveRunSummary(input) {
      state.summary = input;
      return { ...input, state: "created", createdAt: new Date() };
    },
    async updateRunState(_runId, status) {
      state.status = status;
      return { ...state.summary, state: status, createdAt: new Date() };
    },
    async updateRunSummary(_runId, summary) {
      state.summary = { ...state.summary, summary };
    },
    async appendRunEvent(event) {
      state.events.push(event);
      return { ...event, sequence: state.events.length, createdAt: new Date() };
    },
  };
}

async function startFixture() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, host: request.headers.host });
    if (request.url === "/network-failure") {
      request.socket.destroy();
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end();
      return;
    }
    if (request.url === "/large-dom") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<main>${"<span> </span>".repeat(2_100)}<p>Late UI content</p></main>`);
      return;
    }
    if (request.url === "/failed-data") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><main><h1>Harry Potter</h1><p>Loading books...</p></main><script>fetch("/api/books").catch(() => {});</script>');
      return;
    }
    if (request.url === "/api/books") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"unavailable"}');
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Private fixture title</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --brand-accent: #123456; --bad\u202Ename: red; } body { font-family: Arial, sans-serif; }</style></head><body>
        <p>Private page text must not be persisted.</p><a href="/book/missing">Missing local page</a><img src="/image.png"><img alt="Not found" src="/status-error"><button></button><button aria-labelledby="accessible-name"></button><span id="accessible-name">Accessible name</span><button aria-hidden="true"></button><button hidden></button><button style="display:none"></button><button style="visibility:hidden"></button><form id="getForm" method="get" action="/mutate-get"><input type="hidden" name="action" value="delete"></form><div style="width:1600px">wide fixture</div>
        <script>
          console.error("fixture console problem");
          fetch("https://example.invalid/telemetry").catch(() => {});
          fetch("/network-failure").catch(() => {});
          fetch("/mutate", { method: "POST" }).catch(() => {});
          document.getElementById("getForm").requestSubmit();
        </script>
      </body></html>`);
      return;
    }
    response.writeHead(request.url === "/book/missing" || request.url === "/status-error" ? 404 : 200, { "content-type": "text/plain" });
    response.end("fixture response");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture server did not bind to a TCP port.");
  return { server, requests, url: `http://127.0.0.1:${address.port}/` };
}

test("browser fixture audit blocks external/unsafe requests and persists aggregate metadata only", async () => {
  const fixture = await startFixture();
  try {
    const persistence = createPersistenceRecorder();
    const result = await runBrowserAudit(persistence, fixture.url);
    assert.equal(result.metrics.brokenLinkCount, 1, JSON.stringify(result.metrics));
    assert.equal(result.metrics.linksChecked, 1);
    assert.equal(result.metrics.httpErrorCount, 2, "the browser observes both the image response and bounded link probe");
    assert.ok(result.metrics.networkFailureCount >= 1);
    assert.ok(result.metrics.consoleErrorCount >= 1);
    assert.equal(result.metrics.blockedExternalRequestCount, 1);
    assert.deepEqual(result.metrics.blockedResourceOrigins, ["https://example.invalid"]);
    assert.equal(result.metrics.blockedUnsafeMethodCount, 1);
    assert.equal(result.metrics.navigationFailed, false);
    assert.equal(result.metrics.pageDiagnostics.snapshots[0]?.state, "rendered");
    assert.ok(result.metrics.pageDiagnostics.screenshots[0]?.png.byteLength > 0);
    assert.deepEqual([...result.metrics.pageDiagnostics.screenshots[0].png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(fixture.requests.some(({ method, url }) => method === "HEAD" && url === "/book/missing"));
    assert.equal(result.metrics.missingAltCount, 1);
    assert.equal(result.metrics.unnamedControlCount, 1);
    assert.equal(result.metrics.mobileHorizontalOverflow, true);
    assert.equal(result.metrics.securityHeadersChecked, 3);
    assert.equal(result.metrics.missingSecurityHeaderCount, 3);
    assert.equal(result.metrics.mixedContentCheck, "skipped_http_target");
    assert.ok(result.metrics.designObservations.some((observation) => observation.includes("--brand-accent")));
    assert.ok(result.metrics.designObservations.every((observation) => !observation.includes("\u202E")));
    assert.ok(result.metrics.designObservations.some((observation) => observation.includes("observed component button: 6")));
    assert.ok(result.metrics.designObservations.some((observation) => observation.includes("visual-style consistency heuristic")));
    assert.ok(result.metrics.designObservations.length <= 32);
    assert.ok(result.metrics.designObservations.every((observation) => observation.length <= 250));
    assert.equal(fixture.requests.some((request) => request.url === "/mutate"), false);
    assert.equal(fixture.requests.some((request) => request.url.startsWith("/mutate-get")), false);
    assert.equal(fixture.requests.some((request) => request.url === "/book/missing"), true);
    assert.equal(persistence.state.status, "completed", JSON.stringify(result.metrics));
    assert.deepEqual(persistence.state.events.map((event) => event.type), ["run_started", "step_started", "step_finished", "run_finished"]);
    const stored = JSON.stringify(persistence.state);
    assert.equal(stored.includes(fixture.url), false);
    assert.equal(stored.includes("Private fixture title"), false);
    assert.equal(stored.includes("Private page text"), false);
    assert.equal(stored.includes("fixture console problem"), false);
    assert.equal(stored.includes("example.invalid"), false);
    assert.equal(stored.includes("brand-accent"), false);
    assert.equal(stored.includes("#123456"), false);
    assert.equal(stored.includes("Arial"), false);
    assert.equal(stored.includes("pageDiagnostics"), false);

    const specialistRequests = [];
    const { pageDiagnostics: _pageDiagnostics, ...specialistMetrics } = result.metrics;
    const specialist = await runSpecialistReview({
      async complete(request) {
        specialistRequests.push(request);
        return { content: request.messages[0].content.includes("parent reviewer") ? "Parent verified the aggregate evidence." : "One missing alt attribute is supported by the audit counts.", toolCalls: [], finishReason: "stop" };
      },
    }, "fixture", "Review this local fixture report.", JSON.stringify({ findings: specialistMetrics, coverageLimitations: ["Aggregate fixture observations only."] }), [
      { role: "browser-specialist", goal: "Analyze observed browser findings and coverage." },
    ], new AgentBudgetLedger(4, 2));
    assert.equal(specialist.workers[0].status, "complete");
    assert.equal(specialist.parentReviewStatus, "complete");
    assert.equal(specialistRequests.length, 2);
    assert.match(specialistRequests[0].messages[1].content, /missingAltCount/u);
    assert.doesNotMatch(specialistRequests[0].messages[1].content, /127\.0\.0\.1|Private page text|fixture console problem/u);
    assert.doesNotMatch(specialistRequests[0].messages[1].content, /Private fixture title|Private page text|screenshot|pageDiagnostics/u);

    const limitedRequests = [];
    const limitedSpecialist = await runSpecialistReview({
      async complete(request) {
        limitedRequests.push(request);
        return { content: "One bounded browser finding.", toolCalls: [], finishReason: "stop" };
      },
    }, "fixture", "Review this local fixture report.", JSON.stringify({ findings: specialistMetrics }), [
      { role: "browser-specialist", goal: "Interpret aggregate browser findings." },
    ], new AgentBudgetLedger(1, 0));
    assert.equal(limitedSpecialist.workers[0]?.status, "complete");
    assert.equal(limitedSpecialist.parentReviewStatus, "budget-exhausted");
    assert.equal(limitedRequests.length, 1);
    assert.equal(limitedRequests[0]?.tools?.length, 0);
    assert.deepEqual(limitedSpecialist.budget, {
      modelRequests: 1, toolActions: 0, modelRequestsRemaining: 0, toolActionsRemaining: 0,
    });
  } finally {
    await new Promise((resolve, reject) => fixture.server.close((error) => error === undefined ? resolve() : reject(error)));
  }
});

test("browser diagnostics capture empty DOM evidence and separate observed data failures from hypotheses", async () => {
  const fixture = await startFixture();
  try {
    const empty = await runBrowserAudit(createPersistenceRecorder(), new URL("/empty", fixture.url).toString());
    assert.equal(empty.metrics.navigationHttpStatus, 200);
    assert.equal(empty.metrics.pageInspectionFailed, true);
    assert.equal(empty.metrics.pageDiagnostics.snapshots[0]?.state, "empty");
    assert.equal(empty.metrics.pageDiagnostics.snapshots[0]?.bodyTextLength, 0);
    assert.equal(empty.metrics.pageDiagnostics.snapshots[0]?.domScanTruncated, false);
    assert.match(empty.metrics.pageDiagnostics.observedFailures[0] ?? "", /empty initial page/u);
    assert.ok(empty.metrics.pageDiagnostics.screenshots[0]?.png.byteLength > 0);

    const largeDom = await runBrowserAudit(createPersistenceRecorder(), new URL("/large-dom", fixture.url).toString());
    assert.equal(largeDom.metrics.pageDiagnostics.snapshots[0]?.state, "incomplete");
    assert.equal(largeDom.metrics.pageDiagnostics.snapshots[0]?.domScanTruncated, true);
    assert.equal(largeDom.metrics.pageDiagnostics.snapshots[0]?.textScanTruncated, true);
    assert.equal(largeDom.metrics.pageDiagnostics.suspectedCauses.some((cause) => cause.includes("page was empty")), false);

    const failedData = await runBrowserAudit(createPersistenceRecorder(), new URL("/failed-data", fixture.url).toString());
    assert.equal(failedData.metrics.pageDiagnostics.snapshots.at(-1)?.cardLikeElements, 0);
    assert.ok(failedData.metrics.pageDiagnostics.observedFailures.some((finding) => finding.includes("HTTP 503 fetch") && finding.includes("/api/books")));
    assert.ok(failedData.metrics.pageDiagnostics.suspectedCauses.some((cause) => cause.includes("hypothesis") && cause.includes("absent result cards")));
    assert.ok(fixture.requests.some(({ method, url }) => method === "GET" && url === "/api/books"));
  } finally {
    await new Promise((resolve, reject) => fixture.server.close((error) => error === undefined ? resolve() : reject(error)));
  }
});

test("browser audit rejects external targets, userinfo, query and fragment before persistence", async () => {
  const persistence = createPersistenceRecorder();
  for (const url of [
    "https://example.com/",
    "http://127.0.0.1:1234/?token=synthetic",
    "http://user:pass@127.0.0.1:1234/",
    "http://127.0.0.1:1234/#fragment",
  ]) {
    await assert.rejects(runBrowserAudit(persistence, url), BrowserAuditError);
  }
  assert.equal(persistence.state.summary, undefined);
  assert.equal(persistence.state.events.length, 0);
});

test("public browser target and additional-origin validation reject private, reserved, and non-HTTPS destinations", () => {
  assert.equal(validatePublicBrowserTarget("https://123.example.com/docs").origin, "https://123.example.com");
  for (const url of [
    "http://example.com/", "https://127.0.0.1/", "https://10.0.0.1/", "https://[::1]/", "https://[fc00::1]/",
    "https://localhost/", "https://service.internal/", "https://example.com:8443/", "https://user@example.com/",
    "https://example.com/?token=synthetic", "https://example.com/#fragment", "https://example.com/account/delete",
  ]) assert.throws(() => validatePublicBrowserTarget(url), BrowserAuditError, url);
  assert.equal(validateApprovedBrowserOrigin("https://cdn.example.com"), "https://cdn.example.com");
  for (const origin of ["http://cdn.example.com", "https://10.1.2.3", "https://cdn.example.com/path", "https://user@cdn.example.com"]) {
    assert.throws(() => validateApprovedBrowserOrigin(origin), BrowserAuditError, origin);
  }
});

test("public browser journeys accept bounded text, GET search, book links, ordinary links, and browser back", () => {
  assert.deepEqual(validateBrowserJourney([
    { type: "expect-text", text: "Documentation" },
    { type: "search", text: "Harry Potter" },
    { type: "open-first-book" },
    { type: "click-link", text: "API reference" },
    { type: "go-back" },
  ]), [
    { type: "expect-text", text: "Documentation" },
    { type: "search", text: "Harry Potter" },
    { type: "open-first-book" },
    { type: "click-link", text: "API reference" },
    { type: "go-back" },
  ]);
  for (const value of [
    [], [{ type: "submit-form", text: "Send" }], [{ type: "click-button", text: "Buy" }],
    [{ type: "click-link", text: "\u001b[31munsafe" }], [{ type: "expect-text", text: "x".repeat(201) }],
    [{ type: "expect-text", text: "allowed", selector: "body" }], Array.from({ length: 9 }, () => ({ type: "expect-text", text: "ok" })),
  ]) assert.throws(() => validateBrowserJourney(value), BrowserAuditError);
});

test("Chromium traverses the actual egress proxy for an explicitly bounded GET search journey", async () => {
  const hostname = "bookfinder-fixture.example.com";
  const origin = `https://${hostname}`;
  const [key, cert] = await Promise.all([
    readFile(new URL("./fixtures/browser-egress-fixture.key", import.meta.url)),
    readFile(new URL("./fixtures/browser-egress-fixture.crt", import.meta.url)),
  ]);
  const requests = [];
  const server = createHttpsServer({ key, cert }, (request, response) => {
    requests.push({ method: request.method, url: request.url, host: request.headers.host });
    const knownRoute = request.url === "/" || request.url === "/manual-login" || request.url === "/api/auth/login" || request.url === "/api/auth/signin" || request.url === "/auth-discover" || request.url === "/many-passwords" || request.url === "/blocked-data" || request.url === "/blocked-private-data" || request.url === "/mutating-link" || request.url === "/resource-redirect" || request.url === "/search?q=Harry+Potter" || request.url === "/book/azkaban?edition=1";
    if (request.url === "/resource-redirect") response.writeHead(302, { location: "https://api-fixture.example.net/books/details" });
    else if (request.url === "/api/auth/signin" && request.method === "POST") response.writeHead(302, { location: "/account/delete" });
    else if (request.url === "/api/auth/login" && request.method === "POST") response.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "fixture_session=synthetic; HttpOnly; Secure; SameSite=Lax" });
    else response.writeHead(knownRoute ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/api/auth/login" && request.method === "POST") {
      response.end('<main><h1>Signed in</h1><form action="/search" method="get"><label>Search<input type="search" name="q"></label><button>Search</button></form></main>');
    } else if (request.url === "/api/auth/signin" && request.method === "POST") {
      response.end();
    } else if (request.url === "/manual-login") {
      response.end('<!doctype html><form action="/api/auth/login" method="post"><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>');
    } else if (request.url === "/auth-discover") {
      response.end('<!doctype html><body><p>Loading session</p><script>history.replaceState(null, "", "/login"); setTimeout(() => { document.body.innerHTML = "<form><label>Search<input type=search name=q></label><label>Email<input type=email></label><label>Password<input type=password></label></form>"; }, 200);</script></body>');
    } else if (request.url === "/many-passwords") {
      response.end(`<!doctype html><body><form><input type=search aria-label=Search>${"<input type=password hidden>".repeat(21)}<input type=password></form></body>`);
    } else if (request.url === "/blocked-data") {
      response.end('<!doctype html><main><h1>Loading results</h1></main><script>fetch("https://api-fixture.example.net/books").catch(() => {});</script>');
    } else if (request.url === "/blocked-private-data") {
      response.end('<!doctype html><main><h1>Loading results</h1></main><script>fetch("https://10.0.0.2/books").catch(() => {});</script>');
    } else if (request.url === "/mutating-link") {
      response.end('<!doctype html><main><h1>Results</h1><a href="/book/delete?confirm=true">Harry Potter Delete</a></main><script>fetch("/api/delete-user").catch(() => {});fetch("/search?action=changeFavorite").catch(() => {});</script>');
    } else if (request.url === "/resource-redirect") {
      response.end();
    } else if (request.url === "/") {
      const delayedShell = '<main><h1>BookFinder fixture</h1><img src="https://telemetry-fixture.example.net/pixel"><form action="/search" method="get"><label for="q">Search books</label><input id="q" name="q" type="search"><button>Search</button></form></main>';
      response.end(`<!doctype html><body><p>Loading...</p><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(delayedShell)}; }, 200);</script></body>`);
    } else if (request.url === "/search?q=Harry+Potter") {
      response.end('<main><h1>Results for Harry Potter</h1><a href="/book/azkaban?edition=1">Harry Potter &#x202e;and the Prisoner of Azkaban</a></main>');
    } else if (request.url === "/book/azkaban?edition=1") {
      response.end('<main><h1>Book details</h1><p>Harry Potter and the Prisoner of Azkaban</p></main>');
    } else {
      response.end("not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTPS proxy fixture did not bind to a TCP port.");
  const upstreams = [];
  const connectRequests = [];
  const browserFailures = [];
  try {
    const metrics = await auditPublicBrowserPage(new URL(origin), {
      approvedOrigins: [origin],
      journey: [
        { type: "search", text: "Harry Potter" },
        { type: "expect-text", text: "Results for Harry Potter" },
        { type: "open-first-book" },
        { type: "expect-text", text: "Book details" },
        { type: "go-back" },
        { type: "expect-text", text: "Results for Harry Potter" },
      ],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async (ip, port) => {
        upstreams.push({ ip, port });
        return new Promise((resolve, reject) => {
          const socket = connect(address.port, "127.0.0.1");
          socket.once("error", reject);
          socket.once("connect", () => {
            socket.removeListener("error", reject);
            resolve(socket);
          });
        });
      },
      onConnectRequest: (authority) => connectRequests.push(authority),
      onBrowserRequestFailure: (url, error) => browserFailures.push({ url, error }),
      ignoreHTTPSErrors: true,
    });
    assert.equal(metrics.navigationFailed, false, JSON.stringify({ metrics, requests, upstreams, connectRequests, browserFailures }));
    assert.equal(metrics.navigationHttpStatus, 200);
    assert.equal(metrics.finalPath, "/search");
    assert.equal(metrics.navigationRedirectCount, 0);
    assert.ok(metrics.renderWaitMs >= 150 && metrics.renderWaitMs <= 2_500 * 13, metrics.renderWaitMs);
    assert.equal(metrics.journeyStepsCompleted, 6, JSON.stringify({ metrics, requests, upstreams, connectRequests, browserFailures }));
    assert.equal(metrics.journeyStepsFailed, 0);
    assert.deepEqual(metrics.journeyFailureReasons, []);
    assert.equal(metrics.navigationFailed, false);
    const bookEvidence = metrics.journeyEvidence.find((evidence) => evidence.includes("Harry Potter"));
    assert.ok(bookEvidence?.includes("\\u{202e}"));
    assert.doesNotMatch(bookEvidence ?? "", /\u202e/u);
    assert.ok(upstreams.length >= 1);
    assert.ok(upstreams.every(({ ip, port }) => ip === "93.184.216.34" && port === 443));
    assert.ok(requests.some(({ method, url }) => method === "GET" && url === "/search?q=Harry+Potter"));
    assert.ok(requests.some(({ method, url }) => method === "GET" && url === "/book/azkaban?edition=1"));
    assert.ok(requests.every(({ method }) => method === "GET" || method === "HEAD"));
    assert.ok(metrics.blockedExternalRequestCount >= 1);
    assert.deepEqual(metrics.blockedResourceOrigins, ["https://telemetry-fixture.example.net"]);
    assert.doesNotMatch(JSON.stringify(requests), /telemetry-fixture/u);

    const approvals = [];
    let manualBrowserClosed = false;
    let manualPage;
    let manualContextInitialCookies;
    let notifyAuthPostPrompted;
    let notifyAuthPostApproved;
    const authPostPrompted = new Promise((resolve) => { notifyAuthPostPrompted = resolve; });
    const authPostApproved = new Promise((resolve) => { notifyAuthPostApproved = resolve; });
    const manualMetrics = await auditPublicBrowserPage(new URL(origin + "/manual-login"), {
      approvedOrigins: [origin],
      journey: [{ type: "search", text: "Harry Potter" }, { type: "expect-text", text: "Results for Harry Potter" }],
      manualLogin: true,
    }, undefined, {
      headless: true,
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async () => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
      }),
      ignoreHTTPSErrors: true,
      onBrowserClosed: () => { manualBrowserClosed = true; },
      onManualLoginReady: async (page) => {
        manualContextInitialCookies = await page.context().cookies();
        const queryPostWasBlocked = await page.evaluate(async () => {
          try {
            await fetch("/api/auth/login?intent=delete", { method: "POST" });
            return false;
          } catch {
            return true;
          }
        });
        assert.equal(queryPostWasBlocked, true, "query-bearing authentication POST must be blocked");
        const tokenPathPostWasBlocked = await page.evaluate(async () => {
          try {
            await fetch("/api/auth/login/user12345678901234567890", { method: "POST" });
            return false;
          } catch {
            return true;
          }
        });
        assert.equal(tokenPathPostWasBlocked, true, "dynamic credential-like path segments must be blocked");
        const redirectedUnsafePostWasBlocked = await page.evaluate(async () => {
          try {
            await fetch("/api/auth/signin", { method: "POST" });
            return false;
          } catch {
            return true;
          }
        });
        assert.equal(redirectedUnsafePostWasBlocked, true, "redirect to mutating-looking path must be blocked");
        manualPage = page;
        await page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
        await authPostPrompted;
      },
      manualLoginInteraction: {
        approveOrigin: async (approvedOrigin) => { approvals.push(["origin", approvedOrigin]); return approvedOrigin === origin; },
        approveLoginPost: async (approvedOrigin, pathname) => {
          approvals.push(["post", approvedOrigin, pathname]);
          if (pathname === "/api/auth/login") {
            notifyAuthPostPrompted();
            await authPostApproved;
          }
          return approvedOrigin === origin && ["/api/auth/login", "/api/auth/signin"].includes(pathname);
        },
        completeLogin: async () => {
          approvals.push(["complete-login"]);
          notifyAuthPostApproved();
          return true;
        },
        approveJourney: async (journey) => {
          approvals.push(["journey", journey.length]);
          assert.ok(manualPage);
          const postAfterFreezeWasBlocked = await manualPage.evaluate(async () => {
            try {
              await fetch("/api/auth/login", { method: "POST" });
              return false;
            } catch {
              return true;
            }
          });
          assert.equal(postAfterFreezeWasBlocked, true);
          return journey.length === 2;
        },
      },
    });
    assert.equal(manualMetrics.journeyStepsCompleted, 2);
    assert.equal(manualMetrics.journeyStepsFailed, 0);
    assert.deepEqual(approvals, [["post", origin, "/api/auth/signin"], ["post", origin, "/api/auth/login"], ["complete-login"], ["journey", 2]]);
    assert.equal(manualMetrics.pageDiagnostics.snapshots.length, 0);
    assert.equal(manualMetrics.pageDiagnostics.screenshots.length, 0);
    assert.equal(manualBrowserClosed, true);
    assert.deepEqual(manualContextInitialCookies, [], "manual login starts without imported browser session cookies");
    assert.deepEqual(manualMetrics.designObservations, []);
    assert.ok(manualMetrics.journeyEvidence.every((evidence) => evidence === "A read-only journey step completed."));
    assert.doesNotMatch(JSON.stringify(manualMetrics), /synthetic|fixture_session|Password|Sign in|Results for Harry Potter/u);
    assert.ok(requests.some(({ method, url }) => method === "POST" && url === "/api/auth/login"));
    assert.ok(!requests.some(({ method, url }) => method === "GET" && url === "/account/delete"));
    assert.ok(!requests.some(({ method, url }) => method === "POST" && url.includes("?")));
    assert.ok(!requests.some(({ method, url }) => method === "POST" && url.startsWith("/api/auth/login/")));
    assert.ok(requests.filter(({ method }) => method !== "GET" && method !== "HEAD").every(({ method, url }) => method === "POST" && ["/api/auth/login", "/api/auth/signin"].includes(url)));

    const beforeCancelledRequests = requests.length;
    let cancelledBrowserClosed = false;
    await assert.rejects(() => auditPublicBrowserPage(new URL(origin + "/manual-login"), {
      approvedOrigins: [origin],
      journey: [{ type: "expect-text", text: "Signed in" }],
      manualLogin: true,
    }, undefined, {
      headless: true,
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async () => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
      }),
      ignoreHTTPSErrors: true,
      onBrowserClosed: () => { cancelledBrowserClosed = true; },
      manualLoginInteraction: {
        approveOrigin: async () => false,
        approveLoginPost: async () => false,
        completeLogin: async () => false,
        approveJourney: async () => false,
      },
    }), /Manual login was cancelled/u);
    assert.equal(cancelledBrowserClosed, true);
    assert.ok(!requests.slice(beforeCancelledRequests).some(({ method }) => method === "POST"));

    const beforeAuthRequests = requests.length;
    const authMetrics = await auditPublicBrowserPage(new URL(`${origin}/auth-discover`), {
      approvedOrigins: [origin],
      journey: [
        { type: "search", text: "Harry Potter" },
        { type: "expect-text", text: "Results for Harry Potter" },
        { type: "open-first-book" },
        { type: "expect-text", text: "Book details" },
        { type: "go-back" },
      ],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async (_ip, _port) => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
      }),
      ignoreHTTPSErrors: true,
    });
    assert.equal(authMetrics.authenticationGateDetected, true);
    assert.equal(authMetrics.navigationHttpStatus, 200);
    assert.equal(authMetrics.finalPath, "/login");
    assert.equal(authMetrics.journeyStepsCompleted, 0);
    assert.equal(authMetrics.journeyStepsFailed, 5);
    assert.equal(authMetrics.pageDiagnostics.snapshots.at(-1)?.state, "authentication-gated");
    assert.ok(authMetrics.pageDiagnostics.screenshots.length >= 1);
    assert.ok(authMetrics.journeyFailureReasons.every((reason) => reason === "authentication-gate-detected"));
    assert.equal(authMetrics.pageDiagnostics.suspectedCauses.some((cause) => cause.includes("failed same-origin fetch/XHR")), false);
    assert.equal(requests.slice(beforeAuthRequests).some(({ url }) => url?.startsWith("/search?")), false);

    const beforeLimitRequests = requests.length;
    const limitMetrics = await auditPublicBrowserPage(new URL(`${origin}/many-passwords`), {
      approvedOrigins: [origin],
      journey: [{ type: "search", text: "Harry Potter" }],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async (_ip, _port) => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
      }),
      ignoreHTTPSErrors: true,
    });
    assert.equal(limitMetrics.authenticationGateDetected, false);
    assert.equal(limitMetrics.authenticationGateDetectionIncomplete, true);
    assert.equal(limitMetrics.journeyStepsCompleted, 0);
    assert.equal(limitMetrics.journeyStepsFailed, 1);
    assert.deepEqual(limitMetrics.journeyFailureReasons, ["authentication-scan-limit-reached"]);
    assert.equal(requests.slice(beforeLimitRequests).some(({ url }) => url?.startsWith("/search?")), false);

    const blockedDataMetrics = await auditPublicBrowserPage(new URL(`${origin}/blocked-data`), {
      approvedOrigins: [origin],
      journey: [{ type: "expect-text", text: "Results for Harry Potter" }],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async (_ip, _port) => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
      }),
      ignoreHTTPSErrors: true,
    });
    assert.deepEqual(blockedDataMetrics.pageDiagnostics.blockedDataResourceOrigins, ["https://api-fixture.example.net"]);
    assert.deepEqual(blockedDataMetrics.blockedResourceOrigins, ["https://api-fixture.example.net"]);
    assert.ok(blockedDataMetrics.pageDiagnostics.suspectedCauses.some((cause) => cause.includes("Blocked cross-origin fetch/XHR") && cause.includes("correlation")));
    assert.equal(blockedDataMetrics.journeyStepsCompleted, 0);
    assert.ok(blockedDataMetrics.pageDiagnostics.screenshots.length >= 1);
    assert.equal(requests.some(({ url }) => url?.includes("api-fixture.example.net")), false);

    const blockedPrivateDataMetrics = await auditPublicBrowserPage(new URL(`${origin}/blocked-private-data`), {
      approvedOrigins: [origin],
      journey: [{ type: "expect-text", text: "Results for Harry Potter" }],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async (_ip, _port) => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
      }),
      ignoreHTTPSErrors: true,
    });
    assert.deepEqual(blockedPrivateDataMetrics.pageDiagnostics.blockedDataResourceOrigins, []);
    assert.ok(blockedPrivateDataMetrics.pageDiagnostics.observedFailures.some((failure) => failure.includes("https://10.0.0.2")));
    assert.equal(blockedPrivateDataMetrics.pageDiagnostics.suspectedCauses.some((cause) => cause.includes("Blocked cross-origin fetch/XHR")), false);

    const beforeMutatingRouteRequests = requests.length;
    const mutatingRouteMetrics = await auditPublicBrowserPage(new URL(`${origin}/mutating-link`), {
      approvedOrigins: [origin],
      journey: [{ type: "open-first-book" }],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.equal(requestedHost, hostname);
        return ["93.184.216.34"];
      },
      connectAddress: async (_ip, _port) => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
      }),
      ignoreHTTPSErrors: true,
    });
    assert.deepEqual(mutatingRouteMetrics.journeyFailureReasons, ["link-destination-not-classified-as-read-only"]);
    assert.equal(mutatingRouteMetrics.blockedMutatingRouteCount, 2);
    assert.equal(requests.slice(beforeMutatingRouteRequests).some(({ url }) => url === "/book/delete?confirm=true"), false);
    assert.equal(requests.slice(beforeMutatingRouteRequests).some(({ url }) => url === "/api/delete-user"), false);
    assert.equal(requests.slice(beforeMutatingRouteRequests).some(({ url }) => url === "/search?action=changeFavorite"), false);

    const beforeResourceRedirectRequests = requests.length;
    const resourceRedirectMetrics = await auditPublicBrowserPage(new URL(`${origin}/resource-redirect`), {
      approvedOrigins: [origin, "https://api-fixture.example.net"],
      journey: [{ type: "expect-text", text: "API details" }],
    }, undefined, {
      lookupAddresses: async (requestedHost) => {
        assert.ok(requestedHost === hostname || requestedHost === "api-fixture.example.net");
        return ["93.184.216.34"];
      },
      connectAddress: async (_ip, _port) => new Promise((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
      }),
      ignoreHTTPSErrors: true,
    });
    assert.equal(requests.slice(beforeResourceRedirectRequests).some(({ host }) => host?.includes("api-fixture.example.net")), false);
    assert.ok(resourceRedirectMetrics.journeyStepsFailed >= 1);
    assert.equal(resourceRedirectMetrics.blockedNavigationCount, 1);
    assert.equal(resourceRedirectMetrics.navigationHttpStatus, 302);
    assert.equal(resourceRedirectMetrics.navigationRedirectCount, 1);
    assert.equal(resourceRedirectMetrics.blockedResourceOrigins.includes("https://api-fixture.example.net"), false);
    assert.equal(resourceRedirectMetrics.networkFailureCount, 0);

  } finally {
    await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
});

test("public workflow rejects a private target or unapproved private origin before persistence or connection", async () => {
  const persistence = createPersistenceRecorder();
  await assert.rejects(runPublicBrowserAudit(persistence, "https://127.0.0.1/", {
    approvedOrigins: [], journey: [{ type: "expect-text", text: "hello" }],
  }), BrowserAuditError);
  await assert.rejects(runPublicBrowserAudit(persistence, "https://example.com/", {
    approvedOrigins: ["https://192.168.1.4"], journey: [{ type: "expect-text", text: "hello" }],
  }), BrowserAuditError);
  await assert.rejects(runPublicBrowserAudit(persistence, "https://example.com/", {
    approvedOrigins: [], journey: [],
  }), BrowserAuditError);
  assert.equal(persistence.state.summary, undefined);
  assert.equal(persistence.state.events.length, 0);
});

test("browser audit marks navigation failure as failed and persists the coverage status", async () => {
  const server = createServer((request) => request.socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Failure fixture did not bind to a TCP port.");
  const fixture = createPersistenceRecorder();
  try {
    const result = await runBrowserAudit(fixture, `http://127.0.0.1:${address.port}/`);
    assert.equal(result.metrics.navigationFailed, true);
    assert.equal(result.run.state, "failed");
    assert.match(result.run.summary, /incomplete/u);
    assert.equal(fixture.state.events.at(-1)?.type, "run_failed");
    assert.equal(browserAuditExitCode(result.run.state), 3);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
});

test("browser audit CLI exit mapping preserves verified success and surfaces failed observations", () => {
  assert.equal(browserAuditExitCode("completed"), 0);
  assert.equal(browserAuditExitCode("failed"), 3);
});

test("browser-audit CLI requires an interactive confirmation before local navigation", () => {
  const result = spawnSync(process.execPath, [cliPath, "run", "browser-audit", "--url", "http://127.0.0.1:1234/"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive approval/u);
  assert.equal(result.stderr.includes("127.0.0.1:1234"), false);
});

test("browser-audit CLI requires explicit public-site journey approval before navigation", () => {
  const result = spawnSync(process.execPath, [cliPath, "run", "browser-audit", "--url", "https://example.com/", "--journey", '[{"type":"expect-text","text":"Docs"}]'], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive approval/u);
  assert.doesNotMatch(result.stdout + result.stderr, /example\.com/u);
});
