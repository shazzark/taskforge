import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runBrowserAudit, BrowserAuditError, browserAuditExitCode } from "../dist/workflows/browser-audit-workflow.js";

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
        <p>Private page text must not be persisted.</p><a href="/missing">Missing local page</a><img src="/image.png"><img alt="Not found" src="/status-error"><button></button><button aria-labelledby="accessible-name"></button><span id="accessible-name">Accessible name</span><button aria-hidden="true"></button><button hidden></button><button style="display:none"></button><button style="visibility:hidden"></button><div style="width:1600px">wide fixture</div>
        <script>
          console.error("fixture console problem");
          fetch("https://example.invalid/telemetry").catch(() => {});
          fetch("/network-failure").catch(() => {});
          fetch("/mutate", { method: "POST" }).catch(() => {});
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
    assert.equal(result.metrics.httpErrorCount, 1);
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
    assert.ok(result.metrics.designObservations.length <= 32);
    assert.ok(result.metrics.designObservations.every((observation) => observation.length <= 250));
    assert.equal(fixture.requests.some((request) => request.url === "/mutate"), false);
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
