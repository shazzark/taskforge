import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentBudgetLedger } from "../dist/agent/tool-loop.js";
import { runSpecialistReview } from "../dist/agent/specialist-review.js";
import {
  runBrowserAudit, runPublicBrowserAudit, BrowserAuditError, browserAuditExitCode,
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
    requests.push({ method: request.method, url: request.url });
    if (request.url === "/network-failure") {
      request.socket.destroy();
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Private fixture title</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --brand-accent: #123456; --bad\u202Ename: red; } body { font-family: Arial, sans-serif; }</style></head><body>
        <p>Private page text must not be persisted.</p><a href="/missing">Missing local page</a><img src="/image.png"><img alt="Not found" src="/status-error"><button></button><button aria-labelledby="accessible-name"></button><span id="accessible-name">Accessible name</span><button aria-hidden="true"></button><button hidden></button><button style="display:none"></button><button style="visibility:hidden"></button><form id="getForm" method="get" action="/mutate-get"><input type="hidden" name="action" value="delete"></form><div style="width:1600px">wide fixture</div>
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
    response.writeHead(request.url === "/missing" || request.url === "/status-error" ? 404 : 200, { "content-type": "text/plain" });
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
    assert.equal(result.metrics.blockedUnsafeMethodCount, 1);
    assert.equal(result.metrics.navigationFailed, false);
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
    assert.equal(fixture.requests.some((request) => request.url === "/missing"), true);
    assert.equal(persistence.state.status, "completed");
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

    const specialistRequests = [];
    const specialist = await runSpecialistReview({
      async complete(request) {
        specialistRequests.push(request);
        return { content: request.messages[0].content.includes("parent reviewer") ? "Parent verified the aggregate evidence." : "One missing alt attribute is supported by the audit counts.", toolCalls: [], finishReason: "stop" };
      },
    }, "fixture", "Review this local fixture report.", JSON.stringify({ findings: result.metrics, coverageLimitations: ["Aggregate fixture observations only."] }), [
      { role: "browser-specialist", goal: "Analyze observed browser findings and coverage." },
    ], new AgentBudgetLedger(4, 2));
    assert.equal(specialist.workers[0].status, "complete");
    assert.equal(specialist.parentReviewStatus, "complete");
    assert.equal(specialistRequests.length, 2);
    assert.match(specialistRequests[0].messages[1].content, /missingAltCount/u);
    assert.doesNotMatch(specialistRequests[0].messages[1].content, /127\.0\.0\.1|Private page text|fixture console problem/u);
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
    "https://example.com/?token=synthetic", "https://example.com/#fragment",
  ]) assert.throws(() => validatePublicBrowserTarget(url), BrowserAuditError, url);
  assert.equal(validateApprovedBrowserOrigin("https://cdn.example.com"), "https://cdn.example.com");
  for (const origin of ["http://cdn.example.com", "https://10.1.2.3", "https://cdn.example.com/path", "https://user@cdn.example.com"]) {
    assert.throws(() => validateApprovedBrowserOrigin(origin), BrowserAuditError, origin);
  }
});

test("public browser journeys accept only bounded visible-text checks and ordinary anchor clicks", () => {
  assert.deepEqual(validateBrowserJourney([
    { type: "expect-text", text: "Documentation" },
    { type: "click-link", text: "API reference" },
  ]), [
    { type: "expect-text", text: "Documentation" },
    { type: "click-link", text: "API reference" },
  ]);
  for (const value of [
    [], [{ type: "submit-form", text: "Send" }], [{ type: "click-button", text: "Buy" }],
    [{ type: "click-link", text: "\u001b[31munsafe" }], [{ type: "expect-text", text: "x".repeat(201) }],
    [{ type: "expect-text", text: "allowed", selector: "body" }], Array.from({ length: 9 }, () => ({ type: "expect-text", text: "ok" })),
  ]) assert.throws(() => validateBrowserJourney(value), BrowserAuditError);
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
