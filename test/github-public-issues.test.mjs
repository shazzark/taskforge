import assert from "node:assert/strict";
import test from "node:test";
import { GitHubReadError, readPublicIssues } from "../dist/integrations/github-public-issues.js";

test("GitHub public issue read uses a fixed read-only endpoint and returns bounded safe metadata", async () => {
  let requestUrl;
  let requestInit;
  const fetcher = async (url, init) => {
    requestUrl = url;
    requestInit = init;
    return new Response(JSON.stringify([
      { number: 7, title: "Issue\u001b[2J title", state: "open", html_url: "https://github.com/octocat/hello/issues/7" },
      { number: 8, title: "PR", state: "open", html_url: "https://github.com/octocat/hello/issues/8", pull_request: { url: "https://api.github.com/repos/octocat/hello/pulls/8" } },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const issues = await readPublicIssues("octocat/hello", fetcher);
  assert.equal(requestUrl.origin, "https://api.github.com");
  assert.equal(requestUrl.pathname, "/repos/octocat/hello/issues");
  assert.equal(requestUrl.searchParams.get("per_page"), "20");
  assert.equal(requestInit.method, "GET");
  assert.equal("Authorization" in requestInit.headers, false);
  assert.equal(issues.length, 1);
  assert.match(issues[0].title, /\\u001b\[2J/u);
  assert.equal(issues[0].url, "https://github.com/octocat/hello/issues/7");
});

test("GitHub issue read rejects invalid repository names, malformed records, and large responses", async () => {
  const unusedFetcher = async () => new Response("[]", { status: 200 });
  await assert.rejects(readPublicIssues("octocat/../other", unusedFetcher), GitHubReadError);
  await assert.rejects(readPublicIssues("octocat/hello", async () => new Response(JSON.stringify([
    { number: 3, title: "Issue", state: "open", html_url: "https://example.com/issues/3" },
  ]), { status: 200 })), GitHubReadError);
  await assert.rejects(readPublicIssues("octocat/hello", async () => new Response("x".repeat(257 * 1024), { status: 200 })), GitHubReadError);
  await assert.rejects(readPublicIssues("octocat/hello", async () => new Response("{}", { status: 403 })), GitHubReadError);
});
