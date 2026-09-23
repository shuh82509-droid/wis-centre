import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const calls = { manager: 0, director: 0, leader: 0, center: 0, personal: 0, blocked: 0, maintainer: 0, emptyDirector: 0 };
const realtimeCalls = { manager: 0, director: 0, leader: 0, center: 0, personal: 0, blocked: 0, maintainer: 0, emptyDirector: 0 };
const memberCalls = { manager: 0, director: 0, leader: 0, center: 0, personal: 0, blocked: 0, maintainer: 0, emptyDirector: 0 };

function memberPayload(role) {
  const allMembers = [
    { personName: "吴为", employeeId: "FD-AI", department: "品牌营销部", center: "AI营销中心", isLeader: true, leaderCenters: ["AI营销中心"] },
    { personName: "AI中心同事", employeeId: "FD-AI-1", department: "品牌营销部", center: "AI营销中心", isLeader: false, leaderCenters: [] },
    { personName: "创意中心同事", employeeId: "FD-CENTER", department: "品牌营销部", center: "品牌创意中心", isLeader: false, leaderCenters: [] },
    { personName: "个人验收账号", employeeId: "FD-PERSONAL", department: "品牌营销部", center: "营销中心B", isLeader: false, leaderCenters: [] },
    { personName: "曾泳淇", employeeId: "FD-024035", department: "品牌营销部", center: "直播中心", isLeader: false, leaderCenters: [] },
  ].map((member, index) => ({
    ...member,
    performance: { state: "ready", materialCount: index + 1, qianchuanMaterialCount: index, videoMaterialCount: 1, totalGmvYuan: (index + 1) * 1000, qianchuanGmvYuan: index * 800, videoGmvYuan: 200 },
    signals: { workloadScore: null, vitalityScore: null, heatScore: null, saturationScore: null, state: "pending", note: "个人信号待核验" },
    timesheet: { state: "ready", monthLabel: "2026-08", averageEffectiveHours: 8 + index / 10, totalEffectiveHours: 160 + index, scheduledDays: 20, punchDays: 20, averageAttendanceHours: 8.5 },
    daily: Array.from({ length: 7 }, (_, offset) => ({ date: `2026-08-${String(19 + offset).padStart(2, "0")}`, materialCount: index + 1, gmvYuan: 100, state: "ready" })),
  }));
  const members = role === "leader" ? allMembers.slice(0, 2)
    : role === "center" ? allMembers.filter((item) => item.center === "品牌创意中心")
      : role === "personal" ? allMembers.filter((item) => item.personName === "个人验收账号")
        : allMembers;
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T08:00:00+08:00",
    range: { startDate: "2026-08-19", endDate: "2026-08-25", days: 7 },
    access: { scope: role === "leader" || role === "center" ? "center" : role === "personal" ? "personal" : "department", centers: [], personName: "", serverFiltered: true },
    summary: { visibleMembers: members.length, mappedMembers: members.length, unmappedMembers: 0 },
    source: { directory: "OA", performance: "FanDo 根数据", performanceState: "ready", performanceNote: "已映射", completeThroughDate: "2026-08-25", timesheet: { title: "飞书工时", url: "https://example.test/timesheet", baseToken: "base", tableId: "table", revision: 1, note: "已同步", definition: "有效工时" }, timesheetState: "ready", timesheetMode: "live", timesheetMonth: "2026-08", timesheetGeneratedAt: "2026-08-26T08:00:00+08:00", timesheetNote: "已同步" },
    members,
  };
}

function realtimePayload() {
  const channel = (key, label, todayTotalYuan) => ({
    key, label, metric: "GSV", todayDate: "2026-08-26", yesterdayDate: "2026-08-25",
    dataThroughHour: 13, comparisonThroughHour: 12, todayTotalYuan,
    todayComparisonYuan: todayTotalYuan - 100, yesterdaySameTimeYuan: todayTotalYuan - 200,
    yesterdayTotalYuan: todayTotalYuan - 50, comparisonPct: 10,
    todaySpendYuan: 100, yesterdaySameTimeSpendYuan: 90, yesterdayTotalSpendYuan: 120,
    todaySpendRatioPct: 10, yesterdaySameTimeSpendRatioPct: 9,
    yesterdayTotalSpendRatioPct: 9.5, spendRatioComparisonPct: 11,
    spendCoverage: key === "douyin" ? "partial" : "complete",
    yesterdaySpendCoverage: key === "douyin" ? "partial" : "complete",
    spendBreakdown: [{ key: "source", label: key === "douyin" ? "千川可见素材" : "ADQ", valueYuan: 100 }],
    sourceUpdatedAt: "2026-08-26T13:59:00+08:00", state: "partial", unavailableReason: null,
    points: Array.from({ length: 24 }, (_, hour) => ({
      hour, hourLabel: `${String(hour).padStart(2, "0")}:00`,
      todayHourlyYuan: hour <= 12 ? 10 : null, yesterdayHourlyYuan: 9,
      todayCumulativeYuan: hour <= 12 ? (hour + 1) * 10 : null, yesterdayCumulativeYuan: (hour + 1) * 9,
    })),
  });
  return {
    schemaVersion: 1, generatedAt: "2026-08-26T14:00:00+08:00", timezone: "Asia/Shanghai", status: "ready",
    summary: { departmentTodayGsvYuan: 60000, includedChannels: ["douyin", "wechat"] },
    definitions: {
      departmentPerformance: "品牌营销部业绩 = 抖店有效 GSV + 视频号有效 GSV。",
      douyinGsv: "抖店有效 GSV。", wechatGsv: "视频号有效 GSV。",
      qianchuanAttribution: "千川归因 GMV 不重复计入。", spendCoverage: "费用按覆盖状态展示。",
      comparison: "仅比较完整小时。",
    },
    channels: [channel("douyin", "抖音", 20000), channel("wechat", "视频号", 40000)],
  };
}

function roleFrom(request) {
  return /dashboard_role=([^;]+)/u.exec(String(request.headers.cookie || ""))?.[1] || "blocked";
}

function sessionFor(role) {
  if (["externalDirector", "externalSameName", "externalDirectorNoModule"].includes(role)) return {
    user: { number: "TEST-EXTERNAL-DIRECTOR", realName: "丁小恬", department: role === "externalSameName" ? "销售部" : "总经办", center: "总助模块" },
    permissions: { manage_permissions: false, super_admin: false, operation_admin: false },
    access: { allowed_modules: role === "externalDirectorNoModule" ? [] : ["data-dashboard", "creative-radar", "ai-first-creation"] },
  };
  if (role === "manager") return {
    user: { number: "FD-026222", realName: "舒豪", department: "品牌营销部", center: "AI营销中心" },
    permissions: { manage_permissions: true, super_admin: false },
    access: { allowed_modules: ["data-dashboard", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"] },
  };
  if (role === "center") return {
    user: { number: "FD-023794", realName: "李雨橦", department: "品牌营销部", center: "品牌创意中心" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"] },
  };
  if (role === "director") return {
    user: { number: "FD-DIRECTOR", realName: "赵佳乐", department: "品牌营销部" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard"] },
  };
  if (role === "leader") return {
    user: { number: "FD-LEADER", realName: "吴为", department: "品牌营销部" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard"] },
  };
  if (role === "personal") return {
    user: { number: "FD-PERSONAL", realName: "个人验收账号", department: "品牌营销部", center: "营销中心B" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"] },
  };
  if (role === "exception") return {
    user: { number: "FD-029613", realName: "李逸青", department: "品牌营销部", center: "营销中心D" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: [] },
  };
  if (role === "unmapped") return {
    user: { number: "FD-UNMAPPED", realName: "待映射专员", department: "品牌营销部", center: "未分中心" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"] },
  };
  if (role === "maintainer") return {
    user: { number: "FD-MAINTAINER", realName: "许国杨", department: "信息技术部" },
    permissions: { manage_permissions: true, super_admin: false },
    access: { allowed_modules: ["data-dashboard"] },
  };
  if (role === "emptyDirector") return {
    user: { number: "FD-024031", realName: "练美好", department: "品牌营销部", center: "营销中心D" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"] },
  };
  return {
    user: { number: "FD-BLOCKED", realName: "外部旧授权账号", department: "销售部" },
    permissions: { manage_permissions: false, super_admin: false },
    access: { allowed_modules: ["data-dashboard"] },
  };
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const authority = createServer((request, response) => {
  const role = roleFrom(request);
  if (request.url === "/api/central-auth/me") return send(response, 200, sessionFor(role));
  if (request.url?.startsWith("/api/admin/workspace-profiles")) return send(response, 200, { items: [] });
  if (request.url?.startsWith("/api/admin/module-access")) return send(response, 200, {
    items: [
      { identifier: "FD-023794", real_name: "李雨橦", user_number: "FD-023794", department: "品牌营销部", center: "品牌创意中心" },
      { identifier: "FD-026222", real_name: "舒豪", user_number: "FD-026222", department: "品牌营销部", center: "AI营销中心" },
    ],
  });
  if (request.url?.startsWith("/api/admin/permission-managers")) return send(response, 200, {
    items: [{ identifier: "FD-026222", real_name: "舒豪", user_number: "FD-026222", active: true }],
  });
  if (request.url?.startsWith("/api/business-intelligence/overview")) {
    calls[role] += 1;
    return send(response, 200, {
      status: "ready",
      coverage: {
        product: { source: "根数据验收源", sourceUpdatedAt: "2026-08-25T08:00:00+08:00" },
        material: { sourceUpdatedAt: "2026-08-25T09:00:00+08:00" },
      },
      summary: { productEffectiveSalesYuan: 12345, effectiveMaterialRate: 0.25 },
      query: { productDate: "2026-08-25" },
      products: [],
      wechatProducts: [{ standardProductName: "水润面膜", effectiveSalesYuan: 8000, orderCount: 8, productQuantity: 8, productLinkCount: 1, salesSharePct: 100, mapped: true }],
      topMaterials: [],
    });
  }
  if (request.url?.startsWith("/api/omnichannel/realtime-comparison")) {
    realtimeCalls[role] += 1;
    const payload = realtimePayload();
    return send(response, 200, {
      generatedAt: payload.generatedAt,
      timezone: payload.timezone,
      channels: payload.channels,
    });
  }
  if (request.url?.startsWith("/api/dashboard/material-online-trend")) return send(response, 200, {
    granularity: "day", startDate: "2026-08-25", endDate: "2026-08-25",
    items: [{ period: "2026-08-25", onlineTotal: 15, sourceUpdatedAt: "2026-08-26T08:00:00+08:00" }],
  });
  if (request.url?.startsWith("/api/organization/member-dashboard")) {
    memberCalls[role] += 1;
    return send(response, 200, memberPayload(role));
  }
  if (request.url?.startsWith("/api/assistant/status")) return send(response, 200, {
    status: "ready",
    note: "包含工时信息的验收文本",
    timesheet: { averageEffectiveHours: 8.5 },
    safe: "个人任务可见",
  });
  return send(response, 404, { detail: "mock route not found" });
});

await new Promise((done) => authority.listen(0, "127.0.0.1", done));
const authorityPort = authority.address().port;
const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const hubPort = probe.address().port;
await new Promise((done) => probe.close(done));
const dataDir = await mkdtemp(join(tmpdir(), "wis-org-dashboard-"));
const hub = spawn(process.execPath, [resolve("server.mjs")], {
  cwd: resolve("."),
  env: {
    ...process.env,
    PORT: String(hubPort),
    DATA_DIR: dataDir,
    CENTRAL_AUTHORITY_BASE: `http://127.0.0.1:${authorityPort}/api`,
    ROOT_DASHBOARD_API_BASE: `http://127.0.0.1:${authorityPort}/api`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${hubPort}/health`)).ok) return;
    } catch { /* server still starting */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("organization dashboard server did not become healthy");
}

const headersFor = (role) => ({ Cookie: `dashboard_role=${role}` });
const overviewOnce = async (role, extraQuery = "") => {
  const response = await fetch(`http://127.0.0.1:${hubPort}/api/organization-dashboard/overview?date=2026-08-25&days=7${extraQuery ? `&${extraQuery}` : ""}`, { headers: headersFor(role) });
  return { response, payload: await response.json() };
};
const overview = async (role, extraQuery = "") => {
  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    result = await overviewOnce(role, extraQuery);
    if (result.payload?.refresh?.complete !== false) return result;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error(`organization dashboard background sources did not settle for ${role}`);
};
const sessionOnce = async (role) => {
  const response = await fetch(`http://127.0.0.1:${hubPort}/api/session`, { headers: headersFor(role) });
  return { response, payload: await response.json() };
};

try {
  await waitForHealth();

  const externalDirectorSession = await sessionOnce("externalDirector");
  assert.equal(externalDirectorSession.payload.workspace.role, "director");
  assert.equal(externalDirectorSession.payload.workspace.home, "department");
  assert.equal(externalDirectorSession.payload.workspace.department, "总经办");
  assert.equal(externalDirectorSession.payload.workspace.dashboard_department, "品牌营销部");
  assert.equal(externalDirectorSession.payload.workspace.is_brand_department, false);
  assert.equal(externalDirectorSession.payload.workspace.is_system_maintainer, false);
  assert.equal(externalDirectorSession.payload.workspace.can_view_organization_dashboard, true);
  assert.deepEqual(externalDirectorSession.payload.permissions, { manage_permissions: false, super_admin: false, operation_admin: false });
  assert.deepEqual(externalDirectorSession.payload.access.allowed_modules, ["data-dashboard", "creative-radar", "ai-first-creation"]);
  for (const role of ["externalSameName", "externalDirectorNoModule"]) {
    assert.equal((await sessionOnce(role)).payload.workspace.can_view_organization_dashboard, false);
    assert.equal((await overviewOnce(role)).response.status, 403);
  }
  const externalOverview = await overview("externalDirector");
  assert.equal(externalOverview.response.status, 200);
  assert.equal(externalOverview.payload.access.scope, "department");
  assert.equal(externalOverview.payload.access.department, "品牌营销部");

  const managerSession = await sessionOnce("manager");
  assert.equal(managerSession.payload.workspace.role, "director");
  assert.equal(managerSession.payload.workspace.home, "department");
  assert.equal(managerSession.payload.workspace.can_view_organization_dashboard, true);
  assert.equal(managerSession.payload.access.allowed_modules.length, 9);
  assert.equal(managerSession.payload.workspace.module_policy_state, "highest-business-access");
  assert.equal(managerSession.payload.permissions.manage_permissions, true);
  assert.ok(managerSession.payload.access.allowed_modules.includes("workflow-engine"));
  assert.ok(managerSession.payload.access.allowed_modules.includes("creative-radar"));

  const leaderSession = await sessionOnce("leader");
  assert.equal(leaderSession.payload.workspace.role, "manager");
  assert.equal(leaderSession.payload.workspace.center, "AI营销中心");
  assert.equal(leaderSession.payload.workspace.dashboard_scope, "center");

  const personalSession = await sessionOnce("personal");
  assert.equal(personalSession.payload.workspace.role, "specialist");
  assert.equal(personalSession.payload.workspace.home, "personal");
  assert.equal(personalSession.payload.workspace.can_view_organization_dashboard, false);
  assert.deepEqual(personalSession.payload.access.allowed_modules, ["ai-first-creation", "material-workbench", "cloud-manager", "creative-radar"]);
  const deniedPersonalModule = await fetch(`http://127.0.0.1:${hubPort}/api/launch/data-dashboard`, { method: "HEAD", headers: headersFor("personal"), redirect: "manual" });
  assert.equal(deniedPersonalModule.status, 403);
  const allowedPersonalModule = await fetch(`http://127.0.0.1:${hubPort}/api/launch/ai-first-creation`, { method: "HEAD", headers: headersFor("personal"), redirect: "manual" });
  assert.equal(allowedPersonalModule.status, 204);
  const specialistAssistantStatus = await fetch(`http://127.0.0.1:${hubPort}/api/assistant/status`, { headers: headersFor("personal") });
  const specialistAssistantPayload = await specialistAssistantStatus.json();
  assert.equal(specialistAssistantStatus.status, 200);
  assert.equal(JSON.stringify(specialistAssistantPayload).includes("工时"), false);
  assert.equal("timesheet" in specialistAssistantPayload, false);
  const specialistRestrictedPrompt = await fetch(`http://127.0.0.1:${hubPort}/api/assistant/chat`, {
    method: "POST",
    headers: { ...headersFor("personal"), "Content-Type": "application/json" },
    body: JSON.stringify({ content: "查看团队工时" }),
  });
  assert.equal(specialistRestrictedPrompt.status, 403);

  const exceptionSession = await sessionOnce("exception");
  assert.equal(exceptionSession.payload.workspace.role, "specialist");
  assert.equal(exceptionSession.payload.workspace.module_policy_state, "mapped-exception");
  assert.equal(exceptionSession.payload.access.allowed_modules.length, 8, "the legacy all-business mapping includes the new workflow module until an explicit selection is saved");
  assert.ok(exceptionSession.payload.access.allowed_modules.includes("workflow-engine"));

  const unmappedSession = await sessionOnce("unmapped");
  assert.equal(unmappedSession.payload.workspace.module_policy_state, "unmapped");
  assert.deepEqual(unmappedSession.payload.access.allowed_modules, ["creative-radar"], "an unmapped brand-department member receives only the department-wide module");

  const maintainerSession = await sessionOnce("maintainer");
  assert.equal(maintainerSession.payload.workspace.role, "director");
  assert.equal(maintainerSession.payload.workspace.module_policy_state, "highest-business-access");
  assert.equal(maintainerSession.payload.workspace.is_brand_department, false);
  assert.equal(maintainerSession.payload.workspace.can_view_organization_dashboard, true);

  const emptyDirectorSession = await sessionOnce("emptyDirector");
  assert.equal(emptyDirectorSession.payload.workspace.role, "director");
  assert.deepEqual(emptyDirectorSession.payload.access.allowed_modules, ["creative-radar"], "blank mapping remains closed except for the department-wide module");
  const emptyDirectorDashboard = await overviewOnce("emptyDirector");
  assert.equal(emptyDirectorDashboard.response.status, 200, "organization access is separate from the six business-module grants");

  const externalSession = await sessionOnce("blocked");
  assert.equal(externalSession.payload.workspace.role, "external");
  assert.equal(externalSession.payload.workspace.can_view_organization_dashboard, false);

  const fastStartedAt = Date.now();
  const managerShell = await overviewOnce("manager");
  assert.equal(managerShell.response.status, 200);
  assert.ok(Date.now() - fastStartedAt < 500, "first dashboard shell must not wait for slow data sources");
  assert.equal(managerShell.payload.refresh.complete, false);
  assert.equal(managerShell.payload.access.scope, "department");
  assert.ok(managerShell.payload.organization.centers.includes("AI营销中心"));

  const manager = await overview("manager");
  assert.equal(manager.response.status, 200);
  assert.equal(manager.payload.access.scope, "department");
  assert.equal(manager.payload.business.summary.productEffectiveSalesYuan, 12345);
  assert.equal(manager.payload.omnichannelRealtime.summary.departmentTodayGsvYuan, 60000);
  assert.deepEqual(manager.payload.organization.snapshots.map((item) => item.headcount), [91, 58]);
  assert.ok(manager.payload.organization.centers.includes("AI营销中心"));
  assert.equal(manager.payload.organization.leaders.find((item) => item.center === "营销中心A").name, "覃琪惠");
  assert.ok(manager.payload.reportingDirectory.entries.some((item) => item.center === "营销中心A" && item.owner === "覃琪惠"));
  assert.equal(manager.payload.reportingDirectory.revision, 710);
  assert.ok(manager.payload.reportingDirectory.entries.some((item) => item.center === "品牌营销中心" && item.dashboards.length === 1));
  assert.ok(manager.payload.reportingDirectory.entries.some((item) => item.owner === "向可可" && item.state === "pending"));
  assert.ok(manager.payload.memberDashboard.members.every((item) => item.timesheet));
  assert.equal(manager.payload.businessVisibility.scope, "all-authorized-roles");
  assert.ok(manager.payload.meetingEvidence.items.length > 0);
  assert.equal(manager.payload.meetingEvidence.revision, 4430);
  assert.equal(manager.payload.meetingEvidence.archiveRevision, 1167);
  assert.equal(manager.payload.meetingIntelligence.coverage.readableRecords, 13);
  assert.ok(manager.payload.meetingIntelligence.profiles.every((item) => item.vitalityScore === null));
  assert.equal(manager.payload.meetingIntelligence.profiles.find((item) => item.center === "AI营销中心").leader, "");
  assert.equal(manager.payload.meetingIntelligence.profiles.find((item) => item.center === "营销中心J").leader, "");
  assert.equal(manager.payload.sourceCoverage.conflicts.length, 3);
  assert.ok(manager.payload.sources.every((item) => item.authority && item.coverage));
  assert.equal(manager.payload.materialUploads.channels.find((item) => item.key === "douyin").confirmedAssets, null);
  assert.equal(manager.payload.materialUploads.channels.find((item) => item.key === "douyin").observedAssets, 15);
  assert.equal(manager.payload.materialUploads.channels.find((item) => item.key === "wechat").confirmedAssets, null);
  assert.ok(manager.payload.longTermWork.items.length >= 8);
  assert.equal(manager.payload.longTermWork.sourceChat.name, "品牌营销部-核心干将");
  assert.equal(manager.payload.business.wechatProducts[0].effectiveSalesYuan, 8000);
  assert.equal(manager.payload.memberDashboard.members.length, 5);
  assert.equal(calls.manager, 1, "department scope should receive the shared root-data aggregate");
  assert.equal(realtimeCalls.manager, 1, "department scope should receive the shared realtime facts");

  const director = await overview("director");
  assert.equal(director.response.status, 200);
  assert.equal(director.payload.access.scope, "department", "赵佳乐 should inherit department scope from the organization map");

  const statelessCenterPreview = await overview("manager", "preview_scope=center&preview_center=AI%E8%90%A5%E9%94%80%E4%B8%AD%E5%BF%83&preview_version=browser-session");
  assert.equal(statelessCenterPreview.response.status, 200);
  assert.equal(statelessCenterPreview.payload.access.scope, "center");
  assert.equal(statelessCenterPreview.payload.access.label, "AI营销中心");
  assert.equal(statelessCenterPreview.payload.access.previewed, true);
  assert.deepEqual(statelessCenterPreview.payload.memberDashboard.members.map((item) => item.personName), ["吴为", "AI中心同事"]);

  const leader = await overview("leader");
  assert.equal(leader.response.status, 200);
  assert.equal(leader.payload.access.scope, "center", "吴为 should inherit center scope from the organization map");
  assert.deepEqual(leader.payload.access.centers, ["AI营销中心"]);
  assert.deepEqual(leader.payload.meetingIntelligence.profiles.map((item) => item.center), ["AI营销中心"]);
  assert.deepEqual(leader.payload.memberDashboard.members.map((item) => item.personName), ["吴为", "AI中心同事"]);

  const previewUpdate = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview`, {
    method: "PUT",
    headers: { ...headersFor("manager"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "center", center: "营销中心B" }),
  });
  assert.equal(previewUpdate.status, 200);
  const previewPayload = await previewUpdate.json();
  assert.equal(previewPayload.active, true);
  assert.equal(previewPayload.label, "主管级 · 营销中心B");

  const previewedManager = await overview("manager");
  assert.equal(previewedManager.payload.access.scope, "center");
  assert.equal(previewedManager.payload.access.center, "营销中心B");
  assert.equal(previewedManager.payload.access.previewed, true);
  assert.equal(previewedManager.payload.business.summary.productEffectiveSalesYuan, 12345);
  assert.equal(previewedManager.payload.omnichannelRealtime.summary.departmentTodayGsvYuan, 60000);

  const previewCandidates = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview/candidates`, { headers: headersFor("manager") });
  const previewCandidatesPayload = await previewCandidates.json();
  assert.equal(previewCandidates.status, 200);
  assert.equal(previewCandidatesPayload.total, 215);
  assert.ok(previewCandidatesPayload.items.some((item) => item.userNumber === "FD-024035" && item.realName === "曾泳淇"));
  const liuWenxuan = previewCandidatesPayload.items.find((item) => item.userNumber === "FD-023375");
  assert.equal(liuWenxuan?.realName, "刘文轩");
  assert.equal(liuWenxuan?.allowedModules.includes("creative-radar"), false, "preview must not insert an unconfigured module");

  const personalPreviewUpdate = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview`, {
    method: "PUT",
    headers: { ...headersFor("manager"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "personal", person: "曾泳淇" }),
  });
  assert.equal(personalPreviewUpdate.status, 200);
  const personalPreviewPayload = await personalPreviewUpdate.json();
  assert.equal(personalPreviewPayload.label, "专员级 · 曾泳淇");
  assert.equal(personalPreviewPayload.subject.userNumber, "FD-024035");
  assert.equal(personalPreviewPayload.subject.center, "直播中心");
  assert.deepEqual(personalPreviewPayload.subject.allowedModules, ["live-room-management"]);
  const previewedPersonal = await overview("manager");
  assert.equal(previewedPersonal.payload.access.scope, "personal");
  assert.equal(previewedPersonal.payload.access.personName, "曾泳淇");
  assert.deepEqual(previewedPersonal.payload.memberDashboard.members.map((item) => item.personName), ["曾泳淇"]);
  assert.deepEqual(previewedPersonal.payload.organization.centers, []);
  assert.deepEqual(previewedPersonal.payload.meetingEvidence.items, []);
  assert.ok(previewedPersonal.payload.longTermWork.items.every((item) => item.owners.includes("曾泳淇")));

  const externalDirectorPreview = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview`, {
    method: "PUT",
    headers: { ...headersFor("manager"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "department", person: "林少瑶" }),
  });
  const externalDirectorPayload = await externalDirectorPreview.json();
  assert.equal(externalDirectorPreview.status, 200);
  assert.equal(externalDirectorPayload.label, "总监级 · 林少瑶");
  assert.equal(externalDirectorPayload.subject.department, "新品牌事业部");
  assert.deepEqual(externalDirectorPayload.subject.allowedModules, ["creative-hub", "ai-first-creation", "material-workbench", "cloud-manager"]);

  const duplicateNamePreview = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview`, {
    method: "PUT",
    headers: { ...headersFor("manager"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "personal", person: "陈嘉欣" }),
  });
  assert.equal(duplicateNamePreview.status, 409, "duplicate names must require an employee id instead of guessing");

  const blockedPreview = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview`, {
    method: "PUT",
    headers: { ...headersFor("personal"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "department" }),
  });
  assert.equal(blockedPreview.status, 403, "non-permission-manager must not create a preview context");

  const previewReset = await fetch(`http://127.0.0.1:${hubPort}/api/permission-preview`, {
    method: "PUT",
    headers: { ...headersFor("manager"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "real" }),
  });
  assert.equal(previewReset.status, 200);

  const personal = await overviewOnce("personal");
  assert.equal(personal.response.status, 403, "specialists must not open the organization management dashboard");
  assert.equal(calls.personal, 0, "specialist denial must happen before organization data aggregation");
  assert.equal(memberCalls.personal, 0, "specialist denial must happen before member data aggregation");

  const publicSummary = await fetch(`http://127.0.0.1:${hubPort}/api/workspace-home/summary`, { headers: headersFor("personal") });
  const publicSummaryPayload = await publicSummary.json();
  assert.equal(publicSummary.status, 200);
  assert.equal(publicSummaryPayload.totalGsvYuan, 60000);
  assert.equal(JSON.stringify(publicSummaryPayload).includes("工时"), false, "specialist public summary must not contain the restricted label");

  const personalCannotElevate = await overviewOnce("personal", "preview_scope=department&preview_version=forbidden");
  assert.equal(personalCannotElevate.response.status, 403, "query preview parameters must not elevate a specialist");

  const blocked = await overview("blocked");
  assert.equal(blocked.response.status, 403);
  assert.equal(calls.blocked, 0, "module-denied users must not reach business data");
  assert.equal(realtimeCalls.blocked, 0, "module-denied users must not reach realtime business data");
  assert.equal(memberCalls.blocked, 0, "module-denied users must not reach member data");

  const scopeUpdate = await fetch(`http://127.0.0.1:${hubPort}/api/permissions/dashboard-scopes/FD-023794`, {
    method: "PUT",
    headers: { ...headersFor("manager"), "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "center" }),
  });
  assert.equal(scopeUpdate.status, 410, "the retired scope writer must not alter the live role configuration");

  const center = await overview("center");
  assert.equal(center.response.status, 200);
  assert.equal(center.payload.access.scope, "center");
  assert.equal(center.payload.access.label, "品牌创意中心");
  assert.equal(center.payload.business.summary.productEffectiveSalesYuan, 12345);
  assert.equal(center.payload.omnichannelRealtime.summary.departmentTodayGsvYuan, 60000);
  assert.deepEqual(center.payload.organization.snapshots, []);
  assert.deepEqual(center.payload.organization.centers, ["品牌创意中心"]);
  assert.ok(center.payload.meetingEvidence.items.every((item) => item.center === "品牌创意中心"));
  assert.deepEqual(center.payload.memberDashboard.members.map((item) => item.personName), ["创意中心同事"]);
  assert.equal(calls.center, 1, "center scope should receive the same shared root-data facts");

  const grants = await fetch(`http://127.0.0.1:${hubPort}/api/permissions/dashboard-scopes`, { headers: headersFor("manager") });
  const grantsPayload = await grants.json();
  assert.equal(grants.status, 410);
  assert.match(grantsPayload.detail, /角色与中心配置/u);

  console.log(JSON.stringify({ ok: true, departmentAggregateCalls: calls.manager, centerAggregateCalls: calls.center, specialistOrganizationCalls: calls.personal, moduleDenied: blocked.response.status, previewDenied: blockedPreview.status }));
} finally {
  hub.kill();
  authority.close();
  await rm(dataDir, { recursive: true, force: true });
}
