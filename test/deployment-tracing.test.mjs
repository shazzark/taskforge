import assert from "node:assert/strict";
import test from "node:test";
import { DeploymentTraceError, traceDeployments } from "../dist/integrations/deployment-tracing.js";

const sha = "a".repeat(40);

function githubResponse(overrides = {}) {
  return new Response(JSON.stringify({ workflow_runs: [{
    id: 42,
    display_title: "Build\u001b[2J",
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    html_url: "https://github.com/octocat/hello/actions/runs/42",
    created_at: "2026-10-17T10:00:00Z",
  }], ...overrides }), { status: 200, headers: { "content-type": "application/json" } });
}

function vercelResponse(overrides = {}) {
  return new Response(JSON.stringify({ deployments: [{
    uid: "dpl_123456",
    name: "bookfinder",
    readyState: "READY",
    target: "production",
    url: "bookfinder-abc.vercel.app",
    created: 1792231200000,
    meta: { githubCommitSha: sha },
  }], ...overrides }), { status: 200, headers: { "content-type": "application/json" } });
}

test("deployment tracing uses only bounded GET endpoints and joins validated commit SHAs", async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    return url.origin === "https://api.github.com" ? githubResponse() : vercelResponse();
  };
  const token = "ephemeral-vercel-token-fixture";
  const result = await traceDeployments("octocat/hello", "prj_example123", token, fetcher, "team_example123");

  assert.equal(seen.length, 2);
  for (const { url, init } of seen) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(url.origin === "https://api.github.com" || url.origin === "https://api.vercel.com", true);
  }
  const githubRequest = seen.find(({ url }) => url.origin === "https://api.github.com");
  const vercelRequest = seen.find(({ url }) => url.origin === "https://api.vercel.com");
  assert.equal(githubRequest.url.pathname, "/repos/octocat/hello/actions/runs");
  assert.equal(githubRequest.url.searchParams.get("per_page"), "25");
  assert.equal(githubRequest.init.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal("Authorization" in githubRequest.init.headers, false);
  assert.equal(vercelRequest.url.pathname, "/v7/deployments");
  assert.equal(vercelRequest.url.searchParams.get("projectId"), "prj_example123");
  assert.equal(vercelRequest.url.searchParams.get("limit"), "25");
  assert.equal(vercelRequest.url.searchParams.get("teamId"), "team_example123");
  assert.equal(vercelRequest.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.github.runs[0].url, "https://github.com/octocat/hello/actions/runs/42");
  assert.match(result.github.runs[0].title, /\\u001b\[2J/u);
  assert.equal(result.vercel.deployments[0].url, "https://bookfinder-abc.vercel.app");
  assert.deepEqual(result.commitJoins, [{
    commitSha: sha,
    githubRunUrl: "https://github.com/octocat/hello/actions/runs/42",
    deploymentUrl: "https://bookfinder-abc.vercel.app",
  }]);
});

test("auth failures are classified independently and successful source data is retained", async () => {
  const result = await traceDeployments("octocat/hello", "prj_example123", "fixture-token", async (url) => {
    if (url.origin === "https://api.github.com") return githubResponse();
    return new Response("secret-bearing error body", { status: 401 });
  });
  assert.equal(result.github.status, "ok");
  assert.equal(result.github.runs.length, 1);
  assert.equal(result.vercel.status, "auth_expired");
  assert.equal(result.vercel.deployments.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-bearing|fixture-token/u);
});

test("Vercel 404 remains distinct from authentication failure", async () => {
  const result = await traceDeployments("octocat/hello", "prj_example123", "ephemeral-token", async (url) =>
    url.origin === "https://api.github.com" ? githubResponse() : new Response("{}", { status: 404 }));
  assert.equal(result.vercel.status, "not_found");
  assert.match(result.vercel.message ?? "", /not found or is not visible/u);
});

test("invalid inputs fail before any request and response records/links are validated", async () => {
  let calls = 0;
  const unusedFetcher = async () => { calls += 1; return githubResponse(); };
  await assert.rejects(traceDeployments("octocat/../bad", "prj_example123", "token", unusedFetcher), DeploymentTraceError);
  await assert.rejects(traceDeployments("octocat/hello", "https://attacker.invalid", "token", unusedFetcher), DeploymentTraceError);
  await assert.rejects(traceDeployments("octocat/hello", "prj_example123", "\nsecret", unusedFetcher), DeploymentTraceError);
  assert.equal(calls, 0);

  const badGithub = await traceDeployments("octocat/hello", "prj_example123", "token", async (url) =>
    url.origin === "https://api.github.com"
      ? new Response(JSON.stringify({ workflow_runs: [{ id: 3, head_sha: sha, html_url: "https://attacker.invalid/run" }] }), { status: 200 })
      : vercelResponse());
  assert.equal(badGithub.github.status, "unavailable");
  assert.equal(badGithub.vercel.status, "ok");

  const badVercel = await traceDeployments("octocat/hello", "prj_example123", "token", async (url) =>
    url.origin === "https://api.github.com"
      ? githubResponse()
      : new Response(JSON.stringify({ deployments: [{ uid: "x", name: "x", state: "READY", url: "attacker.invalid", created: 1 }] }), { status: 200 }));
  assert.equal(badVercel.github.status, "ok");
  assert.equal(badVercel.vercel.status, "unavailable");
});

test("deployment tracing caps item and response sizes and sanitizes network failures", async () => {
  const tooManyRuns = await traceDeployments("octocat/hello", "prj_example123", "token", async (url) =>
    url.origin === "https://api.github.com"
      ? new Response(JSON.stringify({ workflow_runs: Array.from({ length: 26 }, () => ({})) }), { status: 200 })
      : vercelResponse());
  assert.equal(tooManyRuns.github.status, "unavailable");
  assert.equal(tooManyRuns.vercel.status, "ok");

  const oversized = await traceDeployments("octocat/hello", "prj_example123", "token", async (url) =>
    url.origin === "https://api.github.com"
      ? new Response("x".repeat(257 * 1024), { status: 200 })
      : vercelResponse());
  assert.equal(oversized.github.status, "unavailable");
  assert.equal(oversized.vercel.status, "ok");

  const networkFailure = await traceDeployments("octocat/hello", "prj_example123", "token", async (url) => {
    if (url.origin === "https://api.github.com") throw new Error("token=must-not-leak");
    return new Response("{}", { status: 403 });
  });
  assert.equal(networkFailure.github.status, "unavailable");
  assert.equal(networkFailure.vercel.status, "access_denied");
  assert.doesNotMatch(JSON.stringify(networkFailure), /must-not-leak/u);
});
