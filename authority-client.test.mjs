import { test } from "node:test";
import assert from "node:assert/strict";
import { authorityTarget, requestAuthority } from "./authority-client.mjs";
const bases = { authorityBase: "http://business.test/api", sessionBase: "http://session.test/api" };
test("only GET session goes to lightweight authority", () => {
  assert.equal(authorityTarget(bases, "/central-auth/me"), "http://session.test/api/central-auth/me");
  for (const [path, method] of [["/organization-performance", "GET"], ["/central-auth/me", "POST"], ["/admin/access/grants", "POST"], ["/central-auth/me-extra", "GET"]]) {
    assert.equal(authorityTarget(bases, path, method), `${bases.authorityBase}${path}`);
  }
  assert.equal(authorityTarget({ authorityBase: bases.authorityBase }, "/central-auth/me"), `${bases.authorityBase}/central-auth/me`);
});
test("interrupted body is 503 not auth revoked or uncaught error", async () => {
  const result = await requestAuthority({ ...bases, fetchImpl: async () => ({ status: 200, text: async () => { throw new Error("body interrupted"); } }) }, { path: "/central-auth/me" });
  assert.equal(result.status, 503);
});
test("real 401 and 403 remain denied", async () => {
  for (const status of [401, 403]) {
    const result = await requestAuthority({ ...bases, fetchImpl: async () => new Response('{"detail":"denied"}', { status }) }, { path: "/central-auth/me" });
    assert.equal(result.status, status);
  }
});
test("redirect of either JSON or HTML is not followed or accepted as success", async () => {
  for (const mime of ["application/json", "text/html"]) {
    const result = await requestAuthority({ ...bases, fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "manual");
      return new Response("{}", { status: 302, headers: { "content-type": mime, location: "https://other.test/login" } });
    } }, { path: "/central-auth/me" });
    assert.equal(result.status, 401);
  }
});
test("no retries or fallback for failed mutation", async () => {
  let calls = 0;
  const result = await requestAuthority({ ...bases, fetchImpl: async (url) => { calls++; assert.equal(url, `${bases.authorityBase}/mutate`); throw new Error("timeout"); } }, { path: "/mutate", method: "POST", body: "{}" });
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
});
test("body deadline remains effective after headers", async () => {
  const result = await requestAuthority({ ...bases, fetchImpl: async (_url, { signal }) => ({ status: 200,
    text: () => new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("test timeout")), 500); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); })
  }) }, { path: "/central-auth/me", timeoutMs: 20 });
  assert.equal(result.status, 503);
});
