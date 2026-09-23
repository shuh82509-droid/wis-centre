import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const authorityPort = 44931;
const hubPort = 44932;
let sessionCalls = 0;
let sessionMode = "ok";

const authority = createServer((request, response) => {
  if (request.url === "/api/central-auth/me") sessionCalls += 1;
  if (request.url === "/api/central-auth/me" && sessionMode === "html-unavailable") {
    const body = "<html><body>temporary gateway outage</body></html>";
    response.writeHead(502, { "Content-Type": "text/html", "Content-Length": Buffer.byteLength(body) });
    response.end(body);
    return;
  }
  if (request.url === "/api/central-auth/me" && sessionMode === "login-redirect") {
    response.writeHead(302, { "Content-Type": "text/html", Location: "/login" });
    response.end("login required");
    return;
  }
  if (request.url === "/api/central-auth/me" && sessionMode === "unavailable") {
    const body = JSON.stringify({ detail: "temporary authority outage" });
    response.writeHead(503, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    response.end(body);
    return;
  }
  const credential = String(request.headers.cookie || "anonymous").replace(/^.*?=/u, "");
  const payload = request.url === "/api/central-auth/me"
    ? {
        user: { number: `FD-${credential.toUpperCase()}`, realName: `验收账号-${credential}` },
        permissions: { operation_admin: true, manage_permissions: credential !== "no-incentive" },
        access: { allowed_modules: credential === "no-incentive" ? ["cloud-manager", "data-dashboard", "creative-radar"] : ["cloud-manager", "data-dashboard", "creative-radar", "material-incentive"] },
      }
    : { ok: true };
  const body = JSON.stringify(payload);
  response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
});

await new Promise((resolveListen) => authority.listen(authorityPort, "127.0.0.1", resolveListen));
const hub = spawn(process.execPath, [resolve("server.mjs")], {
  cwd: resolve("."),
  env: {
    ...process.env,
    PORT: String(hubPort),
    CENTRAL_AUTHORITY_BASE: `http://127.0.0.1:${authorityPort}/api`,
    SESSION_CACHE_TTL_MS: "100",
    SESSION_STALE_TTL_MS: "1500",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${hubPort}/health`);
      if (response.ok) return;
    } catch { /* 服务仍在启动 */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("hub server did not become healthy");
}

try {
  await waitForHealth();
  const rootResponse = await fetch(`http://127.0.0.1:${hubPort}/`);
  assert.equal(rootResponse.status, 200);
  assert.equal(sessionCalls, 0, "static HTML must not call the authority service");

  const assetName = (await readdir(resolve("dist/assets"))).find((name) => name.endsWith(".js"));
  assert.ok(assetName);
  const assetResponse = await fetch(`http://127.0.0.1:${hubPort}/assets/${assetName}`, {
    headers: { "Accept-Encoding": "br" },
  });
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-encoding"), "br");
  assert.match(assetResponse.headers.get("cache-control") || "", /immutable/);
  assert.equal(sessionCalls, 0, "static assets must not call the authority service");

  const credentialHeaders = { Cookie: "oa_session=performance-test" };
  const concurrentSessions = await Promise.all(Array.from({ length: 24 }, () =>
    fetch(`http://127.0.0.1:${hubPort}/api/session`, { headers: credentialHeaders }).then((response) => response.json())
  ));
  assert.equal(sessionCalls, 1, "concurrent requests for one account must share one authority lookup");
  assert.ok(concurrentSessions.every((payload) => payload.user.realName === "验收账号-performance-test"));
  const secondIdentity = await fetch(`http://127.0.0.1:${hubPort}/api/session`, {
    headers: { Cookie: "oa_session=second-user" },
  }).then((response) => response.json());
  assert.equal(secondIdentity.user.realName, "验收账号-second-user");
  assert.equal(sessionCalls, 2, "different account cookies must never share a session cache entry");
  assert.equal((await fetch(`http://127.0.0.1:${hubPort}/api/launch/cloud-manager`, { method: "HEAD", headers: credentialHeaders })).status, 204);
  const launch = await fetch(`http://127.0.0.1:${hubPort}/api/launch/cloud-manager`, {
    headers: credentialHeaders,
    redirect: "manual",
  });
  assert.equal(launch.status, 302);
  assert.equal(launch.headers.get("location"), "https://app.fandow.top/fd-026222/wis-video-center/");

  assert.equal((await fetch(`http://127.0.0.1:${hubPort}/api/launch/creative-radar`, { method: "HEAD", headers: credentialHeaders })).status, 204);
  const radarLaunch = await fetch(`http://127.0.0.1:${hubPort}/api/launch/creative-radar`, {
    headers: credentialHeaders,
    redirect: "manual",
  });
  assert.equal(radarLaunch.status, 302);
  assert.equal(radarLaunch.headers.get("location"), "https://app.fandow.top/fd-026222/creative-radar/");

  assert.equal((await fetch(`http://127.0.0.1:${hubPort}/api/launch/data-dashboard`, { method: "HEAD", headers: credentialHeaders })).status, 204);
  const dataDashboardLaunch = await fetch(`http://127.0.0.1:${hubPort}/api/launch/data-dashboard`, {
    headers: credentialHeaders,
    redirect: "manual",
  });
  assert.equal(dataDashboardLaunch.status, 302);
  assert.equal(dataDashboardLaunch.headers.get("location"), "https://app.fandow.top/fd-026222/wis-data-dashboard/");
  assert.doesNotMatch(dataDashboardLaunch.headers.get("location") || "", /feishuapp\.com/);
  assert.equal(sessionCalls, 2, "session and launch checks should share the short-lived cache");

  const incentiveOverview = await fetch(`http://127.0.0.1:${hubPort}/api/creative-incentives/overview`, { headers: credentialHeaders });
  assert.equal(incentiveOverview.status, 200, "authorized incentive requests must proxy to the authority backend");
  const deniedIncentive = await fetch(`http://127.0.0.1:${hubPort}/api/creative-incentives/overview`, {
    headers: { Cookie: "oa_session=no-incentive" },
  });
  assert.equal(deniedIncentive.status, 403, "hub server must enforce the material-incentive module before proxying");

  const mutation = await fetch(`http://127.0.0.1:${hubPort}/api/permissions/admins`, {
    method: "POST",
    headers: { ...credentialHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ real_name: "测试成员" }),
  });
  assert.equal(mutation.status, 200);
  await fetch(`http://127.0.0.1:${hubPort}/api/launch/cloud-manager`, { method: "HEAD", headers: credentialHeaders });
  assert.equal(sessionCalls, 4, "permission changes must invalidate the launch cache");

  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  sessionMode = "unavailable";
  const staleSession = await fetch(`http://127.0.0.1:${hubPort}/api/session`, { headers: credentialHeaders });
  assert.equal(staleSession.status, 200, "a short authority rollout must reuse the last verified session");
  assert.equal((await staleSession.json()).user.realName, "验收账号-performance-test");
  assert.equal(sessionCalls, 5);

  sessionMode = "ok";
  const recoveredSession = await fetch(`http://127.0.0.1:${hubPort}/api/session`, { headers: credentialHeaders });
  assert.equal(recoveredSession.status, 200);
  assert.equal(sessionCalls, 6, "the next request must refresh after the authority recovers");

  const directHtmlNavigation = await fetch(`http://127.0.0.1:${hubPort}/api/session`, {
    redirect: "manual",
    headers: { Accept: "text/html", "X-Forwarded-Prefix": "/fd-026222/wis-marketing-hub" },
  });
  assert.equal(directHtmlNavigation.status, 303, "a browser returned to the session API must re-enter the app");
  assert.equal(directHtmlNavigation.headers.get("location"), "/fd-026222/wis-marketing-hub/");
  assert.equal(sessionCalls, 6, "the HTML redirect must not call the authority service");

  sessionMode = "html-unavailable";
  const htmlUpstream = await fetch(`http://127.0.0.1:${hubPort}/api/session`, {
    headers: { Cookie: "oa_session=html-upstream", Accept: "application/json" },
  });
  assert.equal(htmlUpstream.status, 503);
  assert.deepEqual(await htmlUpstream.json(), { detail: "统一权限服务暂时不可用，请稍后刷新" });

  sessionMode = "login-redirect";
  const loginRedirect = await fetch(`http://127.0.0.1:${hubPort}/api/session`, {
    headers: { Cookie: "oa_session=redirect-upstream", Accept: "application/json" },
  });
  assert.equal(loginRedirect.status, 401);
  assert.deepEqual(await loginRedirect.json(), { detail: "统一登录状态已失效，请返回中枢首页重新登录" });

  console.log(JSON.stringify({ ok: true, staticAuthorityCalls: 0, concurrentSessionCalls: 1, isolatedAccounts: 2, staleFallback: true, htmlSessionRedirect: true, nonJsonNormalized: true, compressed: "br" }));
} finally {
  hub.kill();
  authority.close();
}
