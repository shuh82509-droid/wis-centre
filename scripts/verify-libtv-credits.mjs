import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolveBody) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
  });
}

function roleFrom(request) {
  return /libtv_role=([^;]+)/u.exec(String(request.headers.cookie || ""))?.[1] || "personal";
}

function sessionFor(role) {
  const modules = [
    { key: "data-dashboard", label: "组织经营看板", purpose: "部门经营管理" },
    { key: "creative-hub", label: "创意来源", purpose: "创意工作台" },
    { key: "creative-radar", label: "创意雷达", purpose: "创意洞察" },
    { key: "ai-first-creation", label: "一创创作", purpose: "AI 一创工作台" },
    { key: "material-workbench", label: "二创混剪", purpose: "WIS 素材工作台" },
    { key: "cloud-manager", label: "素材存储与推送回流", purpose: "云管家项目" },
    { key: "live-room-management", label: "直播间", purpose: "直播间" },
  ];
  if (role === "director") return {
    user: { number: "FD-026222", realName: "舒豪", department: "品牌营销部", center: "AI营销中心" },
    permissions: { manage_permissions: true, operation_admin: true, super_admin: false },
    access: { allowed_modules: ["data-dashboard"], modules },
  };
  if (role === "manager") return {
    user: { number: "FD-022896", realName: "吴为", department: "品牌营销部", center: "AI营销中心" },
    permissions: { manage_permissions: false, operation_admin: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard"], modules },
  };
  return {
    user: { number: "FD-024035", realName: "曾泳淇", department: "品牌营销部", center: "直播中心" },
    permissions: { manage_permissions: false, operation_admin: false, super_admin: false },
    access: { allowed_modules: ["live-room-management"], modules },
  };
}

function shanghaiDate(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function epoch(date, hour) {
  return Math.floor(new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime() / 1000);
}

const tempRoot = await mkdtemp(join(tmpdir(), "wis-libtv-credits-"));
const credentialsFile = join(tempRoot, "credentials.json");
await writeFile(credentialsFile, JSON.stringify({ usertoken: "test-token-not-secret", webid: "test-webid" }), "utf8");

let visualRoleOverride = "";
const authority = createServer((request, response) => {
  if (request.url === "/api/central-auth/me") return send(response, 200, sessionFor(visualRoleOverride || roleFrom(request)));
  return send(response, 404, { detail: "not found" });
});
await new Promise((resolveListen) => authority.listen(0, "127.0.0.1", resolveListen));
const authorityPort = authority.address().port;

let listCalls = 0;
let summaryCalls = 0;
let balanceCalls = 0;
const today = shanghaiDate(0);
const yesterday = shanghaiDate(1);
const transactions = [
  { id: "tx-1", transTime: epoch(yesterday, 10), seatUserId: "seat-a", seatName: "视频中心2", sourceName: "LibTV生视频", modelName: "Seedance 2.5 VIP", projectName: "产品展示", projectId: "project-a", bizNo: "task-1", transAmount: 120 },
  { id: "tx-2", transTime: epoch(today, 9), seatUserId: "seat-a", seatName: "视频中心2", sourceName: "LibTV生图", modelName: "Qwen Image3", projectName: "产品展示", projectId: "project-a", bizNo: "task-2", transAmount: 30 },
  { id: "tx-3", transTime: epoch(today, 11), seatUserId: "seat-b", seatName: "营销A_美好", sourceName: "LibTV生视频", modelName: "Seedance 2.0 VIP", projectName: "广告短片", projectId: "project-b", bizNo: "task-3", transAmount: 80 },
];
const libtv = createServer(async (request, response) => {
  assert.equal(request.headers.token, "test-token-not-secret", "LibTV request must use the server-side token header");
  assert.equal(request.headers.webid, "test-webid", "LibTV request must use the server-side webid header");
  if (request.url === "/api/www/power/translogs/management" && request.method === "POST") {
    listCalls += 1;
    const payload = JSON.parse(await readBody(request));
    assert.equal(payload.opTypeCode, 2);
    return send(response, 200, { code: 0, data: { data: payload.page === 1 ? transactions : [], total: transactions.length } });
  }
  if (request.url === "/api/www/power/translogs/management/summary" && request.method === "POST") {
    summaryCalls += 1;
    await readBody(request);
    return send(response, 200, { code: 0, data: { totalCount: 3, totalAmount: 230 } });
  }
  if (request.url === "/api/www/user/getUserInfo" && request.method === "GET") {
    balanceCalls += 1;
    return send(response, 200, { code: 0, data: { vipInfo: { attr: { usablePower: 1000, libtvUsablePower: 200, exPowerSummary: { usablePower: 50 } } } } });
  }
  return send(response, 404, { code: 404, msg: "not found" });
});
await new Promise((resolveListen) => libtv.listen(0, "127.0.0.1", resolveListen));
const libtvPort = libtv.address().port;

const hubPort = 24000 + Math.floor(Math.random() * 1000);
const hub = spawn(process.execPath, [resolve("server.mjs")], {
  cwd: resolve("."),
  env: {
    ...process.env,
    PORT: String(hubPort),
    DATA_DIR: join(tempRoot, "data"),
    CENTRAL_AUTHORITY_BASE: `http://127.0.0.1:${authorityPort}/api`,
    LIBTV_API_BASE: `http://127.0.0.1:${libtvPort}`,
    LIBTV_CREDENTIALS_FILE: credentialsFile,
    LIBTV_CREDIT_CACHE_TTL_MS: "300000",
    RELEASE_ID: "libtv-credit-test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let hubOutput = "";
hub.stdout.on("data", (chunk) => { hubOutput += chunk; });
hub.stderr.on("data", (chunk) => { hubOutput += chunk; });

async function waitForHub() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${hubPort}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`hub did not start\n${hubOutput}`);
}

try {
  await waitForHub();
  const headers = (role) => ({ Cookie: `libtv_role=${role}` });
  const directorResponse = await fetch(`http://127.0.0.1:${hubPort}/api/organization-dashboard/libtv-credits?days=7`, { headers: headers("director") });
  assert.equal(directorResponse.status, 200);
  const payload = await directorResponse.json();
  assert.equal(payload.status, "ready");
  assert.equal(payload.days, 7);
  assert.equal(payload.summary.todayConsumed, 110);
  assert.equal(payload.summary.consumed, 230);
  assert.equal(payload.summary.currentBalance, 1250);
  assert.equal(payload.summary.transactionCount, 3);
  assert.equal(payload.series.length, 7);
  assert.equal(payload.series.find((item) => item.date === yesterday)?.consumed, 120);
  assert.equal(payload.series.find((item) => item.date === today)?.consumed, 110);
  assert.ok(payload.series.some((item) => item.consumed === 0), "complete days without transactions should be real zeroes");
  assert.deepEqual(payload.members.map((item) => [item.name, item.total]), [["视频中心2", 150], ["营销A_美好", 80]]);
  assert.equal(payload.transactions[0].taskId, "task-3");

  const firstCalls = { listCalls, summaryCalls, balanceCalls };
  const managerResponse = await fetch(`http://127.0.0.1:${hubPort}/api/organization-dashboard/libtv-credits?days=7`, { headers: headers("manager") });
  assert.equal(managerResponse.status, 200, "manager view should see team credit data");
  assert.deepEqual({ listCalls, summaryCalls, balanceCalls }, firstCalls, "the second authorized request must reuse the five-minute cache");

  const personalResponse = await fetch(`http://127.0.0.1:${hubPort}/api/organization-dashboard/libtv-credits?days=7`, { headers: headers("personal") });
  assert.equal(personalResponse.status, 403, "specialists must not see LibTV team credit data");

  const previewPersonal = await fetch(`http://127.0.0.1:${hubPort}/api/organization-dashboard/libtv-credits?days=7&preview_scope=personal&preview_person=%E6%9B%BE%E6%B3%B3%E6%B7%87&preview_version=test`, { headers: headers("director") });
  assert.equal(previewPersonal.status, 403, "a personal permission preview must also hide team credit data");

  console.log(JSON.stringify({ ok: true, members: payload.members.length, transactions: payload.transactions.length, cache: "passed", specialistPrivacy: "passed" }));
  if (process.env.LIBTV_VISUAL_HOLD === "1") {
    visualRoleOverride = "director";
    console.log(`LIBTV_VISUAL_URL=http://127.0.0.1:${hubPort}/`);
    await new Promise((resolveHold) => process.once("SIGINT", resolveHold));
  }
} finally {
  hub.kill();
  authority.close();
  libtv.close();
  await rm(tempRoot, { recursive: true, force: true });
}
