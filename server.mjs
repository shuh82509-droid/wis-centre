import {ProductionSources} from './flow-production-sources.mjs';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {startSourceScheduler} from './source-scheduler.mjs';
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { previewMemberDirectory } from "./preview-directory.mjs";
import { WorkflowStore } from "./workflow-store.mjs";
import { TaskWorkflow } from "./task-workflow.mjs";
import { WorkflowAssistant, configuredProvider } from "./workflow-assistant.mjs";
import { createWorkflowHandler } from "./workflow-http.mjs";
import { WorkflowCloudReader } from "./workflow-cloud.mjs";
import { requestAuthority } from "./authority-client.mjs";
import { proxyHubAuth } from "./hub-auth-proxy.mjs";
import { integratedLaunchTarget } from "./integrated-routes.mjs";
import { OrganizationEntryStore, createOrganizationEntryHandler } from "./organization-entry.mjs";
import { OrganizationSourceStore, projectOrganizationSnapshot } from "./organization-daily-sources.mjs";
import { rootMaterialRequest, normalizeRootMaterialUploads, rootMaterialSnapshotForDate, rootSourceRefreshState } from "./organization-root-adapter.mjs";
import { workflowExecutionPolicy } from './workflow-execution-policy.mjs';
import { FlowRuntime } from './flow-runtime.mjs';
import { LiveSessionFlow } from './live-session-flow.mjs';
import { createOfficialLiveScheduleReader } from './live-official-schedule.mjs';
import { LiveAutoDispatch } from './live-auto-dispatch.mjs';
import { LiveNextDayReminder, currentOfficialNextDaySource } from './live-next-day.mjs';
import {isolatedNextDayPermitPath,readNextDayReleasePermit} from './live-next-day-release.mjs';
import { createLiveScheduleReader } from './live-schedule-reader.mjs';
import { FlowSources } from './flow-sources.mjs';
import { FlowFeishu } from './flow-feishu.mjs';
import { LiveFeishuService } from './live-feishu-service.mjs';
import { createFlowHandler } from './flow-http.mjs';
import { FlowEvidence } from './flow-evidence.mjs';
import { FlowAutomation } from './flow-automation.mjs';
import { FlowBlueprints } from './flow-blueprints.mjs';
import {configurationAccess,readConfigurationGrants} from './flow-configuration-access.mjs';
import { FlowDelivery } from './flow-delivery.mjs';
import { inactiveWorkflowMembers } from './flow-personnel.mjs';
import { enforceConfirmedAdmission } from './admission-policy.mjs';
import { officialBusinessRefreshState, recheckOfficialBusiness } from './dashboard-business-refresh.mjs';
import { createGracefulShutdown, waitForWorkerExit } from './server-shutdown.mjs';
import { createSparkLibraryHandler, sparkAccessFor } from './spark-library.mjs';

const root = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const dataRoot = resolve(process.env.DATA_DIR || fileURLToPath(new URL("./data", import.meta.url)));
const dashboardScopeFile = join(dataRoot, "dashboard-scopes.json");
const previewAuditFile = join(dataRoot, "permission-preview-audits.json");
const organizationEntryStore = new OrganizationEntryStore(join(dataRoot, "organization-entry-access.json"));
const organizationSourceStore = new OrganizationSourceStore(join(dataRoot, "organization-sources"));
const longTermWorkFile = join(dataRoot, "long-term-work.json");
const rootDashboardRealtimeFile = join(dataRoot, "root-dashboard-realtime.json");
const rootMaterialUploadsFile = join(dataRoot, "root-material-uploads.json");
const taskCenterFile = join(dataRoot, "task-center.json");
const taskAttachmentRoot = join(dataRoot, "task-center-attachments");
const taskCenterPilot = "AI营销中心";
const port = Number(process.env.PORT || 3000);
const release = process.env.RELEASE_ID || "local";
// A fresh process gets a new ID. A permit left on the persistent volume from
// the previous Hub/container cannot authorize a replacement after restart.
const liveNextDayBootId = randomUUID();
const fingerprint = "WIS品牌营销部中枢";
const hubIntegratedMode = process.env.HUB_INTEGRATED_MODE === "1";
if (hubIntegratedMode && !process.env.CENTRAL_AUTHORITY_BASE) {
  throw new Error("统一中枢模式必须显式配置 CENTRAL_AUTHORITY_BASE");
}
const authorityBase = String(
  process.env.CENTRAL_AUTHORITY_BASE ||
    "https://app.fandow.top/fd-026222/wis-video-center/api",
).replace(/\/+$/u, "");
// ROOT_DASHBOARD_API_BASE uses the current canonical public host. The legacy
// app.fandow.top host now returns 308, which redirect:manual treats as data loss.
// 2026-09 事故：环境变量曾被注入 http://wis-root-authorized-data:3000，但该别名依赖
// Docker 自定义网络；deploy-flow-configuration.py 在容器处于默认 bridge 网络时会丢弃
// 网络别名（bridge 不支持 --network-alias），导致 fetch 报 ENOTFOUND，根数据看板与
// 每日素材快照连续断档。切勿回退到内部别名。
const rootDashboardApiBase = String(
  process.env.ROOT_DASHBOARD_API_BASE ||
    "https://app.fandow.com/fd-026222/wis-data-dashboard/api",
).replace(/\/+$/u, "");
const authSessionBase = String(process.env.CENTRAL_AUTH_SESSION_BASE || "").replace(/\/+$/u, "");
const sessionCache = new Map();
let sessionCacheEpoch = 0;
const sessionInflight = new Map();
const previewContexts = new Map();
const dashboardJobs = new Map();
const sessionCacheTtlMs = Math.max(100, Number(process.env.SESSION_CACHE_TTL_MS || 15_000));
const sessionStaleTtlMs = Math.max(sessionCacheTtlMs, Number(process.env.SESSION_STALE_TTL_MS || 120_000));
const sessionCacheLimit = 500;
const dashboardJobTtlMs = Math.max(60_000, Number(process.env.DASHBOARD_JOB_TTL_MS || 300_000));
const dashboardJobLimit = 200;
const workspaceSummaryInflight = new Map();
const libtvCreditCache = new Map();
const libtvCreditInflight = new Map();
const libtvCreditCacheTtlMs = Math.max(60_000, Number(process.env.LIBTV_CREDIT_CACHE_TTL_MS || 300_000));
const libtvCreditApiBase = String(process.env.LIBTV_API_BASE || "https://api2.liblib.art").replace(/\/+$/u, "");
const libtvCreditConfigDir = resolve(process.env.LIBTV_CONFIG_DIR || join(dataRoot, "libtv-credit-session"));
const libtvCredentialFile = resolve(process.env.LIBTV_CREDENTIALS_FILE || join(libtvCreditConfigDir, "credentials.json"));
const libtvCreditTeamFile = join(dataRoot, "libtv-credit-team.json");
const libtvBinary = resolve(process.env.LIBTV_PATH || (process.platform === "win32"
  ? join(process.env.USERPROFILE || process.cwd(), ".libtv", "libtv.exe")
  : "/app/tools/libtv"));
const libtvLoginState = { phoneDigest: "", maskedPhone: "", sentAt: 0 };
const businessModuleKeys = [
  "data-dashboard",
  "creative-hub",
  "creative-radar",
  "ai-first-creation",
  "material-workbench",
  "cloud-manager",
  "live-room-management",
  "workflow-engine",
];
const businessModuleKeyByLabel = new Map([
  ["经营情况总览", "data-dashboard"],
  ["创意来源", "creative-hub"],
  ["创意雷达", "creative-radar"],
  ["一创创作", "ai-first-creation"],
  ["二创混剪", "material-workbench"],
  ["素材存储与推送回流", "cloud-manager"],
  ["WIS云管家", "cloud-manager"],
  ["直播间", "live-room-management"],
  ["流程引擎", "workflow-engine"],
]);
const allBusinessModuleLabels = [...businessModuleKeyByLabel.keys()].filter(label => label !== "素材存储与推送回流");
const specialistModuleLabelsByCenter = new Map([
  ["AI营销中心", ["一创创作", "二创混剪", "WIS云管家"]],
  ["营销中心A", ["一创创作", "二创混剪", "WIS云管家"]],
  ["营销中心B", ["一创创作", "二创混剪", "WIS云管家"]],
  ["营销中心C", ["一创创作", "二创混剪", "WIS云管家"]],
  ["营销中心D", ["一创创作", "二创混剪", "WIS云管家"]],
  ["营销中心J", ["一创创作", "二创混剪", "WIS云管家"]],
  ["视频中心", ["一创创作", "二创混剪", "WIS云管家"]],
  ["品牌创意中心", ["创意来源", "一创创作", "二创混剪", "WIS云管家"]],
  ["品牌营销中心", ["创意来源", "一创创作", "二创混剪", "WIS云管家"]],
  ["直播中心", ["直播间"]],
]);
const mappedLeadership = [
  { id: "FD-117110", name: "赵佳乐", role: "director", roleLabel: "总监", center: "未分中心", manager: "", modules: allBusinessModuleLabels },
  { id: "FD-015835", name: "郑萌榆", role: "director", roleLabel: "总监", center: "未分中心", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-026222", name: "舒豪", role: "director", roleLabel: "见习总监", center: "AI营销中心", manager: "", modules: allBusinessModuleLabels },
  { id: "FD-024031", name: "练美好", role: "director", roleLabel: "总监", center: "营销中心D", manager: "", modules: [] },
  { id: "FD-029514", name: "张鑫露", role: "director", roleLabel: "总监", center: "营销中心J", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-022896", name: "吴为", role: "manager", roleLabel: "主管/负责人", center: "AI营销中心", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-022962", name: "覃琪惠", role: "manager", roleLabel: "主管/负责人", center: "营销中心A", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-021471", name: "彭聪", role: "manager", roleLabel: "主管/负责人", center: "营销中心B", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-026657", name: "曾业高", role: "manager", roleLabel: "主管/负责人", center: "营销中心C", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-021068", name: "何雨庭", role: "manager", roleLabel: "主管/负责人", center: "视频中心", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-023794", name: "李雨橦", role: "manager", roleLabel: "主管/负责人", center: "品牌创意中心", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-027340", name: "刘慧迅", role: "manager", roleLabel: "主管/负责人", center: "直播中心", manager: "赵佳乐", modules: allBusinessModuleLabels },
  { id: "FD-026339", name: "鲍敏纳", role: "manager", roleLabel: "主管/负责人", center: "直播中心", manager: "刘慧迅", modules: allBusinessModuleLabels },
  { id: "FD-023807", name: "梁瑜涵", role: "manager", roleLabel: "主管/负责人", center: "直播中心", manager: "刘慧迅", modules: allBusinessModuleLabels },
];
const individualModuleOverrides = new Map([
  ["FD-029613", allBusinessModuleLabels],
]);
const systemMaintainerNames = new Set(["许国杨", "刘嘉兴", "何佳泽", "朱嘉琳", "叶森莹"]);
// Explicit owner-approved business exception; this never grants admin rights
// or changes the colleague's real OA department (2026-09-04, 舒豪).
const externalDirectorDepartments = new Map([["丁小恬", "总经办"]]);
const workspacePolicySource = {
  title: "部门人员映射表",
  url: "https://jqx28l0j4lx.feishu.cn/wiki/HeErw3wpdi2VtIkqxsIc2x2GnCk",
  sheetId: "93dfa2",
  revision: 467,
  verifiedAt: "2026-09-02T07:53:16+08:00",
  coverage: {
    departmentMapped: 168,
    otherDepartmentMapped: 47,
    otherDepartmentClosed: 21,
    systemMaintainers: 5,
    oaActive: 167,
    blankModulePolicies: 1,
  },
};
const organizationStructureSource = {
  sourceTitle: "品牌营销部组织架构2606",
  sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/Pe27wuyp7i1EsbkzIpdcZBkkn6b",
  revision: 30,
  updatedAt: "2026-09-02T07:53:16+08:00",
  verifiedAt: "2026-09-02T07:53:16+08:00",
  centers: ["营销中心A", "营销中心B", "营销中心C", "营销中心D", "营销中心J", "品牌营销中心", "品牌创意中心", "视频中心", "AI营销中心", "直播中心", "未分中心"],
  snapshots: [
    { key: "marketing", label: "营销端组织架构", headcount: 91, snapshotMonth: "2026-04" },
    { key: "live", label: "直播端组织架构", headcount: 58, snapshotMonth: "2026-08" },
  ],
  warnings: [
    "营销端与直播端是不同月份的组织快照，人员可能重叠，不能直接相加为部门人数。",
    "成员实时部门与中心归属以 OA 登录身份为准，飞书画板用于组织层级和范围参考。",
  ],
  directors: mappedLeadership
    .filter((item) => item.role === "director")
    .map((item) => ({ name: item.name, role: item.roleLabel })),
  leaders: [
    { center: "AI营销中心", name: "吴为" },
    { center: "营销中心A", name: "覃琪惠" },
    { center: "营销中心B", name: "彭聪" },
    { center: "营销中心C", name: "曾业高" },
    { center: "营销中心D", name: "练美好" },
    { center: "营销中心J", name: "张鑫露" },
    { center: "品牌营销中心", name: "宋睿凛" },
    { center: "品牌创意中心", name: "李雨橦" },
    { center: "视频中心", name: "何雨庭", note: "代管" },
    { center: "直播中心", name: "刘慧迅" },
  ],
};
const dailyReportDirectorySource = {
  sourceTitle: "品牌营销部中心日报与看板入口",
  sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/IT5Hw5fnyiuhrGketT8cgdVOnMg",
  revision: 710,
  updatedAt: "2026-09-02T07:53:16+08:00",
  verifiedAt: "2026-09-02T07:53:16+08:00",
  guidance: {
    deadline: "每日早会前 9:05",
    coverage: "全员覆盖",
    updateMode: "固定日报文档置顶、按日期倒序更新",
    fields: ["经营数据", "价值发现", "关键工作", "今日计划"],
  },
  entries: [
    { channel: "一创", center: "品牌营销中心", owner: "宋睿凛", reports: [], dashboards: [{ title: "品牌营销中心经营看板", url: "https://app.fandow.top/fd-024782/wis-dashboard/" }], state: "partial", note: "日报目录仅登记看板，固定日报文档待回补。" },
    { channel: "一创", center: "品牌创意中心", owner: "李雨橦", reports: [{ title: "品牌营销部创意中心工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/WnCAwFNfPiqJFmkMu2zcCrSknAf" }], dashboards: [{ title: "创意中心早会看板", url: "https://app.fandow.top/fd-023794/creative-center-morning-brief/" }] },
    { channel: "一创", center: "视频中心", owner: "何雨庭", reports: [{ title: "品牌营销部视频中心工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/QdYSwKW0RiXnq5kXdQDcPCNnnBh" }], dashboards: [{ title: "视频中心日报看板", url: "https://app.fandow.top/fd-021068/wis-video-center-dashboard/" }] },
    { channel: "一创", center: "营销中心J", owner: "向可可", reports: [], dashboards: [], state: "pending", note: "视频号一创入口在目录中仍为空，保持待回补。" },
    { channel: "抖店", center: "AI营销中心", owner: "舒豪", reports: [{ title: "品牌营销部AI营销中心工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/RR7owXRT9iXZaYke9hUck4gMnrb" }], dashboards: [{ title: "抖店经营看板", url: "https://app.fandow.top/fd-026222/wis-doudian-operations/" }] },
    { channel: "抖店", center: "AI营销中心", owner: "吴为", reports: [{ title: "AI营销中心-抖音新品日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/NFVnwDxLEi7lU0krv9xcxs31nPd" }], dashboards: [{ title: "抖音新品经营看板", url: "https://marketing-j-ops-board.weiwu2025.chatgpt.site/" }] },
    { channel: "抖店", center: "营销中心B", owner: "彭聪", reports: [{ title: "品牌营销部营销中心B工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/HDGjwYfwDiD9NXkdEV8cfgIbnPb" }], dashboards: [{ title: "中心B日报看板", url: "https://app.fandow.top/fd-021471/center-b-dashboard/" }, { title: "中心B时表看板", url: "https://app.fandow.top/fd-021471/water-hourly-dashboard/" }] },
    { channel: "抖店", center: "营销中心C", owner: "曾业高", reports: [{ title: "品牌营销部营销中心C工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/YzmdwfENWiYuwzkbLdOchP70nzb" }], dashboards: [{ title: "中心C日报看板", url: "https://app.fandow.top/fd-026657/data-board/api/v1/live-dashboard" }, { title: "中心C时表看板", url: "https://app.fandow.top/fd-026657/data-board/api/v1/hourly-dashboard" }] },
    { channel: "视频号", center: "营销中心J", owner: "张鑫露", reports: [{ title: "品牌营销部J中心工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/PkyIwEoC2ivXMSk2G0acUWYfnNh" }], dashboards: [{ title: "中心J经营看板", url: "https://app.fandow.top/fd-029514/jboard/" }] },
    { channel: "视频号", center: "营销中心A", owner: "覃琪惠", reports: [{ title: "品牌营销部A中心工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/VLZ2wMNqTi9vPYkhpH6cNhr9nOm" }], dashboards: [{ title: "中心A经营看板", url: "https://app.fandow.top/fd-022962/data-board/" }] },
    { channel: "视频号", center: "营销中心D", owner: "练美好", reports: [{ title: "品牌营销部营销中心D-微信豆工作日报", url: "https://jqx28l0j4lx.feishu.cn/docx/MK3UdZZzKo8Gemx1qdrcjOt7nNg" }], dashboards: [{ title: "中心D日报看板", url: "https://app.fandow.top/fd-024031/marketing-d-morning-dashboard/" }] },
    { channel: "直播", center: "直播中心", owner: "刘慧迅", reports: [{ title: "品牌营销部直播中心工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/FTFEwNQdEiLfx6kfGnEcPydonmc" }], dashboards: [{ title: "直播中心经营页", url: "https://jqx28l0j4lx.feishu.cn/page/Tuu7mvfjndE8Nlab0lXc6D7tnMb/" }] },
    { channel: "BP", center: "HRBP", owner: "待核验", reports: [{ title: "品牌营销部HRBP工作日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/EatUwdeEviE8uZkKp0rcQ4yInAg" }], dashboards: [] },
    { channel: "BP", center: "助理", owner: "待核验", reports: [{ title: "品牌营销部-总助日报", url: "https://jqx28l0j4lx.feishu.cn/wiki/FBCJwE1Rci958VkohNdc8YlInZ8" }], dashboards: [] },
  ],
  warnings: [
    "原目录保留两条 AI 营销中心，分别由舒豪和吴为维护不同日报及看板；系统不再擅自合并来源责任人。",
    "品牌营销中心与视频号一创仍有日报或看板空缺，空缺保持待回补，不按已接入处理。",
    "日报链接用于工作事实追溯，经营成交仍以根数据看板为准。",
  ],
};
const legacyMeetingArchiveSource = {
  sourceTitle: "品牌营销部会议资料存档多维表格",
  sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/IsEnwVz3ci32O0kGJZUcr2GCnTf",
  revision: 4138,
  archiveRevision: 989,
  updatedAt: "2026-08-27T08:41:00+08:00",
  sourceMode: "snapshot",
  totalRecords: 693,
  archiveRecords: 209,
  snapshotDate: "2026-08-26",
  dailyRecords: 14,
  readableRecords: 11,
  blockedRecords: 2,
  blankRecords: 1,
  items: [
    { date: "2026-08-26", title: "一创早会", center: "营销中心J", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/BfgwdPSy8o9FAtxHQGBcxeu5nig" },
    { date: "2026-08-26", title: "营销B早会", center: "营销中心B", minutesUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnnf47ro6ka4aj2d71aoa3", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/XFc4dhmd7oLs9KxZ0nqcO145ngf" },
    { date: "2026-08-26", title: "组长素材早会", center: "营销中心A", minutesUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnnfk847kos1r262473s2z", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/Q5pEdfAR7oexpKxxq9XcTdMXnMb" },
    { date: "2026-08-26", title: "中心周例会", center: "营销中心J", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/VPpjdP9PFoUBmuxgrrdchhsqnhd" },
    { date: "2026-08-26", title: "抖店新品早会", center: "营销中心J", minutesUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnnfd82xw1gm4i23a74977", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/Gr1Md2GcvoR3Wsx8lS7cFs0bnZb" },
    { date: "2026-08-26", title: "营销B-8月复盘与9月规划（定计划会）", center: "ALL", minutesUrl: "https://jqx28l0j4lx.feishu.cn/wiki/X7jiwfjZciBRFUkJNV3cvbFgnyf", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/wiki/Kj1jwUfo1ihsJEkh84BcTUxVnbe" },
    { date: "2026-08-26", title: "2026/08/26 品牌营销部早会", center: "ALL", minutesUrl: "https://jqx28l0j4lx.feishu.cn/wiki/NpuXw5hLyixUcXkrUs7czy9Inic", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/wiki/L9CcwbyIEi6e1MkqQXXcSV9cn3f" },
    { date: "2026-08-26", title: "2026/08/26 早会", center: "营销中心A", minutesUrl: "https://jqx28l0j4lx.feishu.cn/docx/LhkKdlSQQoyotbxujDMcweK1n1c", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/WSiKdgJtfoGcJexvtkUcJf0Gnrd" },
    { date: "2026-08-26", title: "蒲冠彰面谈", center: "营销中心B", minutesUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnnk58i137tr2i4b84s27x", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnnk58i137tr2i4b84s27x", accessState: "blocked" },
    { date: "2026-08-26", title: "中心周例会", center: "营销中心A", minutesUrl: "https://jqx28l0j4lx.feishu.cn/docx/RMfjdyjoLoufdgxEKfucF9uinCg", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/MrPRdcXYEoo155xurFzcSzyznEc" },
    { date: "2026-08-26", title: "抖店新品定计划", center: "AI营销中心", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/LNu6dsmgwoLdyXxHRs1cUImRn1g" },
    { date: "2026-08-26", title: "营销C定计划", center: "营销中心C", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/HuRDdtsKao7yCrxCLj9cOCXcnFe" },
    { date: "2026-08-26", title: "营销C早会", center: "营销中心C", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/Q12cd2736o48b3xscawceM0snXf", accessState: "blocked" },
  ],
};

const meetingArchiveSource = {
  sourceTitle: "品牌营销部会议资料存档多维表格",
  sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/IsEnwVz3ci32O0kGJZUcr2GCnTf",
  revision: 4430,
  archiveRevision: 1167,
  updatedAt: "2026-09-02T07:53:16+08:00",
  verifiedAt: "2026-09-02T07:53:16+08:00",
  sourceMode: "verified-snapshot",
  totalRecords: 788,
  archiveRecords: 269,
  snapshotDate: "2026-09-01",
  dailyRecords: 13,
  readableRecords: 13,
  blockedRecords: 0,
  blankRecords: 0,
  verification: {
    method: "逐条读取会议存档中的原始文字记录并校验飞书访问结果",
    scope: "2026-09-01 品牌营销部公共会议与各中心会议",
    note: "链接存在不等于可读；本快照 13 条文字记录均已通过当前授权身份读回。",
  },
  items: [
    { date: "2026-09-01", title: "AI营销中心早会", center: "AI营销中心", minutesUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnrj4m94imsj76mjj3x82f", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/IIwxdtP6MolKSAxDop5cSia9ncM" },
    { date: "2026-09-01", title: "二创早会", center: "营销中心J", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/QVAIdR2kHoifWixPSaNcFgmEn8e" },
    { date: "2026-09-01", title: "营销中心B早会", center: "营销中心B", minutesUrl: "https://jqx28l0j4lx.feishu.cn/minutes/obcnrjb9qt283r7ik7r727yl", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/Uq2jd2imGoFjrMxS0xgci9LDnfc" },
    { date: "2026-09-01", title: "抖店KOC突破日会", center: "ALL", minutesUrl: "https://www.feishu.cn/docx/Hi8rduVvLoeKGlxUNdncstzQnAh", transcriptUrl: "https://www.feishu.cn/docx/VLuBdXFBuogRUxxEbRecLiOonLx" },
    { date: "2026-09-01", title: "品牌营销中心早会", center: "ALL", minutesUrl: "https://www.feishu.cn/docx/G8fzdbts9onrHpx75HdcBHEinxh", transcriptUrl: "https://www.feishu.cn/docx/MudBdSkTSoR9isxudlNcTWO9nOf" },
    { date: "2026-09-01", title: "视频号问题复盘", center: "ALL", minutesUrl: "https://www.feishu.cn/docx/KIMLdRR46ouiMvxJ2p4ctuNBnyQ", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/AAnJdkUR0oYU2Nx4dl0cf0o1nNg" },
    { date: "2026-09-01", title: "品牌营销部早会", center: "ALL", minutesUrl: "https://www.feishu.cn/docx/QM1HdTKbUoAUVJxEtd3c6y75nZc", transcriptUrl: "https://www.feishu.cn/docx/Bk6MdntxVoyaPexuhetcU9gxntg" },
    { date: "2026-09-01", title: "营销中心A早会", center: "营销中心A", minutesUrl: "https://jqx28l0j4lx.feishu.cn/docx/Hl9sdscwVo4FVPxdulOc9cPFnnb", transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/QSHPdrapGoWrg3xeCHkcA8dnn1c" },
    { date: "2026-09-01", title: "中心成员面谈", center: "营销中心J", minutesUrl: null, transcriptUrl: "https://jqx28l0j4lx.feishu.cn/docx/Vg8BdjsZZoXtOqx6oNrcvRFnnLb" },
    { date: "2026-09-01", title: "中秋与国庆抖店规划", center: "ALL", minutesUrl: "https://www.feishu.cn/docx/Pr7Zdi6nvoR8PexaKmmcMPh0nzE", transcriptUrl: "https://www.feishu.cn/docx/H4UndlnSeoWUvOxNsnqcbbcrnOm" },
    { date: "2026-09-01", title: "直播中心早会", center: "直播中心", minutesUrl: "https://www.feishu.cn/docx/W8zrdQxjToyUswx2Lt1cpegxnmg", transcriptUrl: "https://www.feishu.cn/docx/Edm4dfZ1aoJEpSx9MCycRNJrnfc" },
    { date: "2026-09-01", title: "直播中心周会", center: "直播中心", minutesUrl: "https://www.feishu.cn/docx/XmncdWfEpoxqA1xLDktcS7h5ntF", transcriptUrl: "https://www.feishu.cn/docx/TQ8FdbKZZoUSpExfazlcsnTInGf" },
    { date: "2026-09-01", title: "WIS二创明星混剪突破复盘会", center: "ALL", minutesUrl: "https://www.feishu.cn/docx/FAeedwbEvoWPquxIuyZcX4wSn5g", transcriptUrl: "https://www.feishu.cn/docx/JmWXdG6VqoRe5xxveZPcgEX2nPf" },
  ],
};

const legacyMeetingIntelligenceSnapshot = {
  date: "2026-08-26",
  generatedAt: "2026-08-27T08:41:00+08:00",
  sourceMode: "verified-snapshot",
  coverage: {
    dailyRecords: 14,
    readableRecords: 11,
    blockedRecords: 2,
    blankRecords: 1,
    rate: 0.7857,
    note: "14 条当日会议记录中，11 条逐字记录可读取；2 条受原文权限限制，1 条为空记录。未读取部分不按 0 处理。",
  },
  method: "基于逐字记录中的计划、交付、风险、跨组协作和持续负荷信号形成会议信号指数；它不是工时，也不作为单一绩效结论。",
  profiles: [
    { center: "AI营销中心", leader: "吴为", state: "ready", vitalityScore: 84, heatScore: 91, saturationScore: 88, evidenceCount: 3, summary: "新品经营复盘、人员分工与 AI 素材产能要求同时推进，负荷信号偏高。", evidence: [
      { title: "抖店新品定计划", signal: "明确新品 GMV、利润与素材供给计划，并拆分负责人和单项 KPI。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/LNu6dsmgwoLdyXxHRs1cUImRn1g" },
      { title: "抖店新品早会", signal: "团队按品分工、值班试点与素材基建量并行推进。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/Gr1Md2GcvoR3Wsx8lS7cFs0bnZb" },
      { title: "品牌营销部早会", signal: "视频号结果、素材卡审和账号异常均有明确跟进动作。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/L9CcwbyIEi6e1MkqQXXcSV9cn3f" },
    ] },
    { center: "营销中心B", leader: "彭聪", state: "ready", vitalityScore: 82, heatScore: 89, saturationScore: 86, evidenceCount: 3, summary: "多人逐项汇报、工具迁移和新品方向调整密集，存在高负荷与效率切换信号。", evidence: [
      { title: "营销B早会", signal: "逐人核对剪辑数量、品类方向与卡点，并要求自动化混剪工具提效。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/XFc4dhmd7oLs9KxZ0nqcO145ngf" },
      { title: "营销B早会", signal: "单人昨日 25 条、7—8 条等产出被逐项核验，同时存在卡审和新工具适应问题。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/XFc4dhmd7oLs9KxZ0nqcO145ngf" },
      { title: "品牌营销部早会", signal: "日报质量和价值发现被列为负责人持续监管事项。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/L9CcwbyIEi6e1MkqQXXcSV9cn3f" },
    ] },
    { center: "营销中心J", leader: "张鑫露", state: "partial", vitalityScore: 81, heatScore: 84, saturationScore: 80, evidenceCount: 3, summary: "早会、周例会与一创协作频繁；当前信号反映中心状态，不等同于负责人个人评分。", evidence: [
      { title: "中心周例会", signal: "中心复盘成交、素材方向与跨品类 AI 复刻，并形成补数和提需动作。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/VPpjdP9PFoUBmuxgrrdchhsqnhd" },
      { title: "抖店新品早会", signal: "成员逐项汇报 7—8 条素材、品类测试与设备卡点。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/Gr1Md2GcvoR3Wsx8lS7cFs0bnZb" },
      { title: "一创早会", signal: "一创工作形成独立会议记录并纳入当日中心证据。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/BfgwdPSy8o9FAtxHQGBcxeu5nig" },
    ] },
    { center: "营销中心D", leader: "练美好", state: "partial", vitalityScore: 76, heatScore: 79, saturationScore: 75, evidenceCount: 2, summary: "部门早会中持续汇报经营、创意项目和账号异常，中心独立会议证据仍待补充。", evidence: [
      { title: "品牌营销部早会", signal: "同步经营结果、创意项目进度和退款率问题。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/L9CcwbyIEi6e1MkqQXXcSV9cn3f" },
      { title: "品牌营销部早会", signal: "账号掉车、素材卡审和艺人上线均有后续跟进。", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/L9CcwbyIEi6e1MkqQXXcSV9cn3f" },
    ] },
    { center: "营销中心A", leader: "宋睿凛", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 3, summary: "当日有早会、组长素材早会和周例会记录，但当前快照未形成足够可解释的个人/中心信号。", evidence: [] },
    { center: "营销中心C", leader: "曾业高", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 1, summary: "当日 2 条记录中 1 条逐字稿无权读取，暂不评分。", evidence: [] },
    { center: "品牌营销中心", leader: "宋睿凛", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议库未返回可归属到该中心的独立记录。", evidence: [] },
    { center: "品牌创意中心", leader: "李雨橦", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议库未返回可归属到该中心的独立记录。", evidence: [] },
    { center: "视频中心", leader: "何雨庭", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议库未返回可归属到该中心的独立记录。", evidence: [] },
    { center: "直播中心", leader: "刘慧迅", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议库未返回可归属到该中心的独立记录。", evidence: [] },
  ],
};

const meetingIntelligenceSnapshot = {
  date: "2026-09-01",
  generatedAt: "2026-09-02T07:53:16+08:00",
  sourceMode: "verified-snapshot",
  coverage: {
    dailyRecords: 13,
    readableRecords: 13,
    blockedRecords: 0,
    blankRecords: 0,
    rate: 1,
    note: "13 条当日会议文字记录已逐条验证可读；本轮仅更新事实覆盖，不沿用 8 月评分。",
  },
  method: "会议主题、中心、纪要和文字记录来自会议根数据表；原文可读性已验证。活力、热力与饱和度需重新完成内容归因后才生成，旧分值不续用。",
  profiles: [
    { center: "AI营销中心", leader: "吴为", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 1, summary: "已验证 1 条中心早会文字记录；当前仅作为工作事实，不生成推断评分。", evidence: [] },
    { center: "营销中心A", leader: "覃琪惠", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 1, summary: "已验证 1 条中心早会文字记录；当前仅作为工作事实，不生成推断评分。", evidence: [] },
    { center: "营销中心B", leader: "彭聪", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 1, summary: "已验证 1 条中心早会文字记录；当前仅作为工作事实，不生成推断评分。", evidence: [] },
    { center: "营销中心C", leader: "曾业高", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议根数据未返回可独立归属的中心记录，保持待回补。", evidence: [] },
    { center: "营销中心D", leader: "练美好", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议根数据未返回可独立归属的中心记录，保持待回补。", evidence: [] },
    { center: "营销中心J", leader: "张鑫露", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 2, summary: "已验证二创早会和成员面谈 2 条文字记录；当前仅作为工作事实，不生成推断评分。", evidence: [] },
    { center: "品牌营销中心", leader: "宋睿凛", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 1, summary: "已验证品牌营销中心早会文字记录，但源表归属为部门公共，暂不生成中心评分。", evidence: [] },
    { center: "品牌创意中心", leader: "李雨橦", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议根数据未返回可独立归属的中心记录，保持待回补。", evidence: [] },
    { center: "视频中心", leader: "何雨庭", state: "pending", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 0, summary: "当日会议根数据未返回可独立归属的中心记录，保持待回补。", evidence: [] },
    { center: "直播中心", leader: "刘慧迅", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null, evidenceCount: 2, summary: "已验证早会和周会 2 条文字记录；当前仅作为工作事实，不生成推断评分。", evidence: [] },
  ],
};

const longTermWorkFallback = {
  schemaVersion: 1,
  generatedAt: "2026-08-27T10:25:00+08:00",
  sourceMode: "verified-snapshot",
  sourceChat: {
    name: "品牌营销部-核心干将",
    chatId: "oc_04ec28cf2911911da8c202c5eee21742",
    readThroughDate: "2026-08-27",
  },
  definition: "仅收录跨日、具备负责人或持续要求的工作；群聊和文档只作为事实来源，不把闲聊或未确认建议当任务。",
  items: [
    { id: "sep-original", title: "9月全员一创与有效 AI 开头", center: "ALL", owners: ["各中心负责人"], startDate: "2026-08-27", endDate: "2026-09-30", status: "进行中", acceptance: "每人形成可核验有效一创与至少一个有效 AI 开头", sourceType: "飞书文档", sourceTitle: "营销B-8月复盘与9月规划", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/Kj1jwUfo1ihsJEkh84BcTUxVnbe" },
    { id: "weekly-review", title: "每周二固定素材周复盘", center: "营销中心B", owners: ["彭聪"], startDate: "2026-09-01", endDate: "2026-09-30", status: "持续执行", acceptance: "每周形成有效方向、无效方向与下一轮测试动作", sourceType: "飞书文档", sourceTitle: "营销B-8月复盘与9月规划", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/Kj1jwUfo1ihsJEkh84BcTUxVnbe" },
    { id: "mid-autumn", title: "中秋节点素材储备", center: "营销中心B", owners: ["营销中心B"], startDate: "2026-08-27", endDate: "2026-09-20", status: "进行中", acceptance: "节点前完成可投放素材储备并通过复盘筛选", sourceType: "飞书文档", sourceTitle: "营销B-8月复盘与9月规划", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/Kj1jwUfo1ihsJEkh84BcTUxVnbe" },
    { id: "new-product-material", title: "新品每日原创素材测试与周度有效文案", center: "AI营销中心", owners: ["吴为", "AI营销中心"], startDate: "2026-08-27", endDate: "2026-09-30", status: "进行中", acceptance: "每人每日至少2条原创素材测试，周度沉淀有效文案方向", sourceType: "飞书文档", sourceTitle: "08-26 抖店新品定计划", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/LNu6dsmgwoLdyXxHRs1cUImRn1g" },
    { id: "new-product-review", title: "新品素材审核与复盘机制", center: "AI营销中心", owners: ["吴为"], startDate: "2026-08-27", endDate: "2026-09-30", status: "进行中", acceptance: "提升素材会议频次并按有效结果回写方向", sourceType: "飞书文档", sourceTitle: "08-26 抖店新品定计划", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/LNu6dsmgwoLdyXxHRs1cUImRn1g" },
    { id: "ai-certification", title: "品牌营销部 AI 初级技能认证", center: "ALL", owners: ["舒豪", "各中心负责人"], startDate: "2026-08-27", endDate: "2026-09-30", status: "进行中", acceptance: "全员完成7天考核并在3天内完成评分与结果归档", sourceType: "飞书文档", sourceTitle: "品牌营销部AI通用技能认证—初级考核设计", sourceUrl: "https://jqx28l0j4lx.feishu.cn/docx/LH5IdmRAmo66iyxxNXLcNU61nFh" },
    { id: "creative-radar", title: "创意雷达推广使用与反馈闭环", center: "ALL", owners: ["舒豪", "各中心负责人"], startDate: "2026-08-27", endDate: "2026-09-15", status: "进行中", acceptance: "各中心完成使用反馈并沉淀可复用创意方向", sourceType: "核心干将群", sourceTitle: "品牌营销部-核心干将", sourceUrl: "https://applink.feishu.cn/client/chat/open?openChatId=oc_04ec28cf2911911da8c202c5eee21742" },
    { id: "center-dashboard", title: "各中心经营看板与关键工作补齐", center: "ALL", owners: ["各中心负责人"], startDate: "2026-08-27", endDate: "2026-09-05", status: "进行中", acceptance: "价值发现、关键工作、排期和可视化完整可读", sourceType: "核心干将群", sourceTitle: "品牌营销部-核心干将", sourceUrl: "https://applink.feishu.cn/client/chat/open?openChatId=oc_04ec28cf2911911da8c202c5eee21742" },
  ],
};

function readLongTermWorkSnapshot() {
  try {
    const value = JSON.parse(readFileSync(longTermWorkFile, "utf8"));
    if (value && Array.isArray(value.items)) return value;
  } catch { /* fall back to the last verified source snapshot */ }
  return longTermWorkFallback;
}

function longTermWorkFor(access, sourceSnapshot = null) {
  const snapshot = sourceSnapshot && Array.isArray(sourceSnapshot.items)
    ? sourceSnapshot
    : readLongTermWorkSnapshot();
  const scopedCenters = Array.isArray(access.centers) ? access.centers.filter(Boolean) : access.center ? [access.center] : [];
  const items = access.scope === "department"
    ? snapshot.items
    : access.scope === "center"
      ? snapshot.items.filter((item) => item.center === "ALL" || scopedCenters.includes(item.center))
      : snapshot.items.filter((item) => (item.owners || []).includes(access.personName));
  return {
    ...snapshot,
    items,
    visibilityNote: access.scope === "department"
      ? "展示部门公共和各中心长期工作。"
      : access.scope === "center"
        ? `仅展示部门公共及 ${scopedCenters.join("、")} 长期工作。`
        : "仅展示负责人明确匹配本人的长期工作；未匹配不展示他人事项。",
  };
}

function readDashboardScopes() {
  try {
    const value = JSON.parse(readFileSync(dashboardScopeFile, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeDashboardScopes(value) {
  mkdirSync(dataRoot, { recursive: true });
  const temporary = `${dashboardScopeFile}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, dashboardScopeFile);
}

function dashboardUserIdentifier(user = {}) {
  return String(user.number || user.userNumber || user.employeeNumber || user.userId || user.id || user.realName || user.name || "").trim();
}

function dashboardUserName(user = {}) {
  return String(user.realName || user.name || user.real_name || "").trim();
}

function normalizedCenter(value) {
  return String(value || "")
    .trim()
    .replace(/^品牌营销部\s*[-—/·]\s*/u, "")
    .replace(/\s+/gu, "");
}

function userCenter(user = {}) {
  const candidates = [user.center, user.groupName, user.deptName];
  for (const candidate of candidates) {
    const center = normalizedCenter(candidate);
    if (organizationStructureSource.centers.some((item) => normalizedCenter(item) === center)) return center;
  }
  return normalizedCenter(candidates.find(Boolean));
}

function userDepartment(user = {}) {
  return String(user.department || user.parentDept || user.deptName || "").trim();
}

function moduleKeysForLabels(labels = []) {
  return labels.map((label) => businessModuleKeyByLabel.get(label)).filter(Boolean);
}

function normalizedPreviewMemberQuery(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

function previewMemberCandidate(row) {
  const departmentEvidence = [row.department, row.center]
    .map((value) => String(value || ""))
    .join(" ");
  const rowModules = Array.isArray(row.allowedModules) ? row.allowedModules.map(String) : [];
  const allowedModules = row.loginActive === false ? [] : rowModules;
  return {
    userNumber: String(row.userNumber || ""),
    realName: String(row.realName || ""),
    department: String(row.department || ""),
    center: String(row.center || ""),
    jobTitle: String(row.jobTitle || ""),
    mappedRole: String(row.mappedRole || ""),
    sparkRole: String(row.sparkRole ?? row.mappedRole ?? ""),
    manager: String(row.manager || ""),
    allowedModules,
    loginActive: row.loginActive !== false,
    organizationEntryAllowed: organizationEntryStore.allowed(row),
    note: String(row.note || ""),
    sourceSheet: String(row.sourceSheet || ""),
  };
}

function findPreviewMembers(value) {
  const query = normalizedPreviewMemberQuery(value);
  if (!query) return [];
  const exact = previewMemberDirectory.filter((row) => [row.userNumber, row.realName]
    .some((candidate) => normalizedPreviewMemberQuery(candidate) === query));
  if (exact.length) return exact.map(previewMemberCandidate);
  return previewMemberDirectory.filter((row) => [row.userNumber, row.realName, row.department, row.center]
    .some((candidate) => normalizedPreviewMemberQuery(candidate).includes(query)))
    .map(previewMemberCandidate);
}

function previewMemberCandidates(value = "") {
  const query = normalizedPreviewMemberQuery(value);
  const rows = query
    ? previewMemberDirectory.filter((row) => [row.userNumber, row.realName, row.department, row.center]
      .some((candidate) => normalizedPreviewMemberQuery(candidate).includes(query)))
    : previewMemberDirectory;
  return rows.map(previewMemberCandidate);
}

function workspacePolicyFor(sessionPayload = {}) {
  const user = sessionPayload.user || {};
  const identifier = dashboardUserIdentifier(user).toLocaleUpperCase("en-US");
  const personName = dashboardUserName(user);
  const department = userDepartment(user);
  const centerFromOa = userCenter(user);
  const departmentEvidence = [user.department, user.parentDept, user.deptName, user.groupName]
    .map((value) => String(value || ""))
    .join(" ");
  const leadership = mappedLeadership.find((item) => item.id === identifier || item.name === personName) || null;
  const isMaintainer = systemMaintainerNames.has(personName);
  const isBrandDepartment = Boolean(leadership || departmentEvidence.includes("品牌营销部"));
  const upstreamModules = Array.isArray(sessionPayload.access?.allowed_modules)
    ? sessionPayload.access.allowed_modules.map(String)
    : [];
  const exceptionDepartment = externalDirectorDepartments.get(personName);
  const isExternalDirector = Boolean(exceptionDepartment
    && departmentEvidence.split(/[\s/·—-]+/u).includes(exceptionDepartment)
    && upstreamModules.includes("data-dashboard"));
  const preservedModules = upstreamModules.filter((key) => !businessModuleKeys.includes(key));

  // “最高权限” is the existing, authenticated permission-manager grant. Give
  // it the owner's business view without changing any super_admin capability.
  if (sessionPayload.permissions?.manage_permissions === true) {
    const catalogKeys = (sessionPayload.access?.modules || []).map(item => item.key).filter(Boolean);
    return {role: "director", role_label: "最高权限", home: "department", dashboard_scope: "department",
      dashboard_department: "品牌营销部", department, center: centerFromOa, manager: "",
      is_brand_department: isBrandDepartment, is_system_maintainer: isMaintainer,
      can_view_organization_dashboard: true, can_view_public_summary: true,
      module_policy_state: "highest-business-access", policy_source: workspacePolicySource,
      allowed_modules: [...new Set([...businessModuleKeys, "material-incentive", ...catalogKeys, ...upstreamModules])]};
  }

  const profile = sessionPayload.access?.workspace_profile;
  if (profile?.configured && isBrandDepartment
      && ["director", "manager", "specialist"].includes(profile.role)
      && organizationStructureSource.centers.includes(profile.center)) {
    const role = profile.role;
    return {
      role, role_label: { director: "总监", manager: "主管/负责人", specialist: "专员" }[role],
      home: { director: "department", manager: "center", specialist: "personal" }[role],
      dashboard_scope: { director: "department", manager: "center", specialist: "personal" }[role],
      department, center: profile.center, manager: "", is_brand_department: true,
      is_system_maintainer: false, can_view_organization_dashboard: role !== "specialist",
      can_view_public_summary: true, module_policy_state: "admin-configured",
      policy_source: { ...workspacePolicySource, title: "角色与中心配置", version: profile.version },
      allowed_modules: [...new Set(upstreamModules)],
    };
  }

  let role = "external";
  let roleLabel = "协作成员";
  let home = "modules";
  let dashboardScope = "none";
  let center = centerFromOa;
  let manager = "";
  let canViewOrganizationDashboard = false;
  let canViewPublicSummary = false;
  let moduleLabels = null;
  let modulePolicyState = "upstream";

  if (isExternalDirector) {
    role = "director";
    roleLabel = "总监";
    home = "department";
    dashboardScope = "department";
    canViewOrganizationDashboard = true;
    canViewPublicSummary = true;
    modulePolicyState = "owner-approved-director-exception:2026-09-04";
  } else if (isMaintainer) {
    role = "maintainer";
    roleLabel = "系统开发维护";
    home = "department";
    dashboardScope = "department";
    canViewOrganizationDashboard = true;
    canViewPublicSummary = true;
  } else if (isBrandDepartment && leadership) {
    role = leadership.role;
    roleLabel = leadership.roleLabel;
    home = leadership.role === "director" ? "department" : "center";
    dashboardScope = leadership.role === "director" ? "department" : "center";
    center = normalizedCenter(leadership.center) || center;
    manager = leadership.manager;
    canViewOrganizationDashboard = true;
    canViewPublicSummary = true;
    moduleLabels = leadership.modules;
    modulePolicyState = leadership.modules.length ? "mapped" : "mapped-empty";
  } else if (isBrandDepartment) {
    role = "specialist";
    roleLabel = "专员";
    home = "personal";
    dashboardScope = "personal";
    canViewPublicSummary = true;
    moduleLabels = individualModuleOverrides.get(identifier)
      || specialistModuleLabelsByCenter.get(center)
      || null;
    modulePolicyState = individualModuleOverrides.has(identifier)
      ? "mapped-exception"
      : moduleLabels
        ? "mapped-center"
        : "unmapped";
  }

  // The central permission store owns module admission, including its default
  // all-module policy. Role/center mappings only determine the workspace view;
  // they must not create a second, different module allowlist in navigation.
  const explicitlyConfigured = sessionPayload.access?.configured === true || sessionPayload.access?.access_mode === "selected";
  const allowedModules = [...new Set(upstreamModules)];
  return {
    role,
    role_label: roleLabel,
    home,
    dashboard_scope: dashboardScope,
    ...(isExternalDirector ? { dashboard_department: "品牌营销部" } : {}),
    department,
    center,
    manager,
    is_brand_department: isBrandDepartment,
    is_system_maintainer: isMaintainer,
    can_view_organization_dashboard: canViewOrganizationDashboard,
    can_view_public_summary: canViewPublicSummary,
    module_policy_state: explicitlyConfigured ? "admin-configured-modules" : "central-default-modules",
    policy_source: workspacePolicySource,
    allowed_modules: allowedModules,
  };
}

async function currentPreviewCandidates(request, query = "") {
  const upstream = await callAuthority(request, `/admin/workspace-profiles?q=${encodeURIComponent(query)}`);
  if (upstream.status !== 200) throw new Error("当前角色配置暂时无法核对，请稍后重试预览");
  const items = previewMemberCandidates(query);
  for (const row of upstream.payload?.items || []) {
    const existing = items.findIndex(item => row.user_number ? item.userNumber === row.user_number : item.realName === row.real_name && item.department === row.department);
    const mapped = workspacePolicyFor({user: {number: row.user_number, realName: row.real_name,
      department: row.department, center: row.center}, permissions: {manage_permissions: row.highest_business_access === true},
      access: {allowed_modules: row.effective_modules || row.modules || [], configured: row.module_configured,
        access_mode: row.module_access_mode, workspace_profile: row.configured ? row : null}});
    const sparkPolicy = workspacePolicyFor({user: {number: row.user_number, realName: row.real_name,
      department: row.department, center: row.center}, permissions: {manage_permissions: false},
      access: {allowed_modules: row.effective_modules || row.modules || [], configured: row.module_configured,
        access_mode: row.module_access_mode, workspace_profile: row.configured ? row : null}});
    const candidate = previewMemberCandidate({ userNumber: row.user_number, realName: row.real_name,
      department: row.department, center: mapped.center, mappedRole: mapped.role,
      sparkRole: sparkPolicy.role,
      allowedModules: mapped.allowed_modules, loginActive: row.login_active, sourceSheet: "当前生效权限" });
    candidate.organizationEntryAllowed = row.highest_business_access === true ||
      (mapped.can_view_organization_dashboard && organizationEntryStore.allowed({number: row.user_number}));
    if (existing >= 0) items[existing] = candidate;
    else items.push(candidate);
  }
  return items;
}

function applyWorkspacePolicy(sessionPayload) {
  if (!sessionPayload || typeof sessionPayload !== "object") return sessionPayload;
  const workspace = workspacePolicyFor(sessionPayload);
  // Spark records contain department management sources. A highest-business
  // grant alone does not promote a specialist to a department manager here.
  workspace.spark_role = workspacePolicyFor({ ...sessionPayload,
    permissions: { ...(sessionPayload.permissions || {}), manage_permissions: false }
  }).role;
  workspace.can_view_spark_library = sparkAccessFor({ ...sessionPayload, workspace }).enabled;
  workspace.can_view_organization_dashboard = workspace.can_view_organization_dashboard &&
    (sessionPayload.permissions?.manage_permissions === true || organizationEntryStore.allowed(sessionPayload.user));
  return {
    ...sessionPayload,
    access: {
      ...(sessionPayload.access || {}),
      access_mode: "selected",
      allowed_modules: workspace.allowed_modules,
      policy_source: workspace.policy_source,
      policy_state: workspace.module_policy_state,
    },
    workspace: Object.fromEntries(Object.entries(workspace).filter(([key]) => key !== "allowed_modules")),
  };
}

function leadershipCentersFor(name) {
  return organizationStructureSource.leaders
    .filter((item) => item.name === name)
    .map((item) => item.center);
}

function dashboardAccessFor(sessionPayload, preview = null) {
  const user = sessionPayload?.user || {};
  const identifier = dashboardUserIdentifier(user);
  const personName = dashboardUserName(user);
  const workspace = sessionPayload?.workspace || workspacePolicyFor(sessionPayload);
  const configured = identifier ? readDashboardScopes()[identifier] : null;
  const leadershipCenters = workspace.dashboard_scope === "center"
    ? [workspace.center].filter(Boolean)
    : leadershipCentersFor(personName);
  let scope = workspace.dashboard_scope === "department" || workspace.dashboard_scope === "center"
    ? workspace.dashboard_scope
    : "personal";
  if (!new Set(["department", "center", "personal"]).has(scope)) scope = "personal";
  const department = workspace.dashboard_department || workspace.department || userDepartment(user);
  const oaCenter = workspace.center || userCenter(user);
  const centers = scope === "center"
    ? [...new Set([...(leadershipCenters || []), ...(oaCenter ? [oaCenter] : [])])]
    : [];
  const center = centers[0] || "";
  if (scope === "center" && !centers.length) scope = "personal";
  const normalAccess = {
    scope,
    label: scope === "department" ? (department || "品牌营销部") : scope === "center" ? centers.join("、") : (personName || identifier || "本人"),
    department,
    center,
    centers,
    personName,
    configured: Boolean(configured),
  };
  if (!preview?.active || !sessionPayload?.permissions?.manage_permissions) return normalAccess;
  const previewScope = preview.scope;
  const previewSubject = preview.subject || null;
  const previewPerson = previewSubject?.realName || preview.person || personName;
  const previewDepartment = previewSubject?.department || department;
  const previewCenter = previewSubject?.center || preview.center || "";
  return {
    scope: previewScope,
    label: previewScope === "department"
      ? (previewDepartment || "品牌营销部")
      : previewScope === "center"
        ? (previewCenter || "主管视角")
        : (previewPerson || "专员视角"),
    department: previewDepartment,
    center: previewScope === "center" ? previewCenter : "",
    centers: previewScope === "center" && previewCenter ? [previewCenter] : [],
    personName: previewPerson,
    configured: false,
    previewed: true,
  };
}

function organizationStructureFor(access, source = organizationStructureSource) {
  const isDepartment = access.scope === "department";
  const scopedCenters = Array.isArray(access.centers) ? access.centers.filter(Boolean) : access.center ? [access.center] : [];
  return {
    ...source,
    sourceTitle: source.sourceTitle || "飞书组织架构",
    sourceUrl: source.sourceMetadata?.sourceUrl || source.sourceUrl,
    revision: source.revision ?? source.sourceMetadata?.revision ?? null,
    updatedAt: source.updatedAt || source.sourceMetadata?.readAt || null,
    verifiedAt: source.verifiedAt || source.sourceMetadata?.readAt || null,
    warnings: source.warnings || [],
    directors: isDepartment ? source.directors || [] : [],
    centers: isDepartment ? source.centers : source.centers.filter((center) => scopedCenters.includes(center)),
    snapshots: isDepartment ? source.snapshots : [],
    leaders: isDepartment
      ? source.leaders
      : source.leaders.filter((item) => scopedCenters.includes(item.center)),
    visibilityNote: isDepartment
      ? "展示部门组织目录与两份独立人数快照。"
      : scopedCenters.length
        ? `当前只展示 ${scopedCenters.join("、")} 的组织范围；部门人数快照不可见。`
        : "当前只展示本人范围；部门与中心人数快照不可见。",
  };
}

function dailyReportDirectoryFor(access, source = dailyReportDirectorySource) {
  const scopedCenters = Array.isArray(access.centers) ? access.centers.filter(Boolean) : access.center ? [access.center] : [];
  const entries = access.scope === "department"
    ? source.entries
    : access.scope === "center"
      ? source.entries.filter((item) => scopedCenters.includes(item.center))
      : [];
  return {
    ...source,
    sourceTitle: source.sourceTitle || "中心固定日报与经营入口",
    sourceUrl: source.sourceMetadata?.sourceUrl || source.sourceUrl,
    revision: source.revision ?? source.sourceMetadata?.revision ?? null,
    updatedAt: source.updatedAt || source.sourceMetadata?.readAt || null,
    verifiedAt: source.verifiedAt || source.sourceMetadata?.readAt || null,
    guidance: source.guidance || { deadline: "原文未登记", coverage: "按已登记入口", updateMode: "依据原文版本", fields: [] },
    warnings: source.warnings || [],
    entries,
    visibilityNote: access.scope === "department"
      ? "总监级展示全部中心固定日报与经营入口。"
      : access.scope === "center"
        ? `仅展示 ${scopedCenters.join("、")} 的日报与经营入口。`
        : "个人视角不展示跨中心日报与经营入口。",
  };
}

function meetingEvidenceFor(access, source = meetingArchiveSource) {
  const canViewDepartment = access.scope === "department";
  const scopedCenters = Array.isArray(access.centers) ? access.centers.filter(Boolean) : access.center ? [access.center] : [];
  const items = canViewDepartment
    ? source.items
    : access.scope === "center" && scopedCenters.length
      ? source.items.filter((item) => scopedCenters.includes(item.center))
      : [];
  return {
    ...source,
    sourceTitle: source.sourceTitle || "会议资料存档",
    sourceUrl: source.sourceMetadata?.sourceUrl || source.sourceUrl,
    revision: source.revision ?? source.sourceMetadata?.revision ?? null,
    updatedAt: source.updatedAt || source.sourceMetadata?.readAt || null,
    verifiedAt: source.verifiedAt || source.sourceMetadata?.readAt || null,
    snapshotDate: source.factsDate || source.snapshotDate || null,
    totalRecords: canViewDepartment ? source.totalRecords ?? null : null,
    archiveRecords: canViewDepartment ? source.archiveRecords ?? null : null,
    dailyRecords: items.length,
    readableRecords: items.filter((item) => item.readState === "readable" || (!item.readState && source.sourceMode === "verified-snapshot" && source.readableRecords === source.items.length)).length,
    blockedRecords: items.filter((item) => item.readState === "blocked" || item.accessState === "blocked").length,
    blankRecords: items.filter((item) => item.readState === "blank").length,
    unverifiedRecords: items.filter((item) => item.readState === "unverified").length,
    errorRecords: items.filter((item) => item.readState === "error").length,
    verification: { method: "逐条来源状态；链接存在与原文可读分开记录", scope: access.label || access.scope, note: "统计仅含当前权限可见记录；未读原文不计为已读，也不评分。" },
    items,
    visibilityNote: canViewDepartment
      ? "展示部门及各中心最近会议快照。"
      : access.scope === "center" && scopedCenters.length
        ? `仅展示 ${scopedCenters.join("、")} 的会议快照。`
        : "个人级待接入会议参与人与责任人映射，当前不展示部门会议明细。",
  };
}

function averageScore(profiles, key) {
  const values = profiles.map((item) => item[key]).filter((value) => Number.isFinite(value));
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function meetingIntelligenceFor(access, source = meetingIntelligenceSnapshot, meeting = null) {
  if (meeting) {
    const centers = [...new Set(meeting.items.map((item) => item.center))];
    const profiles = centers.map((center) => {
      const items = meeting.items.filter((item) => item.center === center);
      const todos = items.filter((item) => typeof item.todo === "string" && item.todo.trim());
      const readCount = items.filter((item) => item.readState === "readable"
        || (!item.readState && meeting.sourceMode === "verified-snapshot" && meeting.readableRecords === meeting.dailyRecords)).length;
      return { center, leader: "", state: "partial", vitalityScore: null, heatScore: null, saturationScore: null,
        evidenceCount: items.length,
        summary: `已登记 ${items.length} 条会议，其中 ${todos.length} 条记录包含明确 TODO；${readCount} 条原文已读。缺足够评分依据，保持空分值。`,
        evidence: todos.map((item) => ({ title: item.title, signal: item.todo,
          sourceUrl: item.transcriptUrl || item.minutesUrl || meeting.sourceUrl })),
      };
    });
    return {
      date: meeting.snapshotDate, generatedAt: meeting.verifiedAt || meeting.updatedAt || null,
      sourceMode: meeting.sourceMode,
      coverage: { dailyRecords: meeting.dailyRecords, readableRecords: meeting.readableRecords,
        blockedRecords: meeting.blockedRecords, blankRecords: meeting.blankRecords,
        unverifiedRecords: meeting.unverifiedRecords || 0, errorRecords: meeting.errorRecords || 0,
        rate: meeting.dailyRecords ? meeting.readableRecords / meeting.dailyRecords : null,
        note: "会议表事实与原文核验分开记录；明确 TODO 可追溯，缺足够评分依据时不形成分值。" },
      method: "展示原表会议、明确 TODO 与来源，不把会议数量换算为工作饱和度、活力或绩效。",
      profiles,
      summary: { vitalityScore: null, heatScore: null, saturationScore: null, scoredProfiles: 0, visibleProfiles: profiles.length },
      visibilityNote: access.scope === "personal" ? "个人范围尚无已核验参与人映射，不展示他人会议。"
        : "只展示当前权限范围内的会议事实和明确 TODO。",
    };
  }
  const scopedCenters = Array.isArray(access.centers) ? access.centers.filter(Boolean) : access.center ? [access.center] : [];
  let profiles = access.scope === "department"
    ? meetingIntelligenceSnapshot.profiles
    : access.scope === "center"
      ? meetingIntelligenceSnapshot.profiles.filter((item) => scopedCenters.includes(item.center))
      : meetingIntelligenceSnapshot.profiles.filter((item) => item.leader === access.personName);
  if (access.scope === "personal" && !profiles.length) {
    profiles = [{
      center: access.center || "本人",
      leader: access.personName || "本人",
      state: "pending",
      vitalityScore: null,
      heatScore: null,
      saturationScore: null,
      evidenceCount: 0,
      summary: "会议参与人和当前登录身份尚未完成可靠映射，暂不展示他人记录，也不按 0 评分。",
      evidence: [],
    }];
  }
  return {
    ...meetingIntelligenceSnapshot,
    method: access.scope === "personal"
      ? "基于逐字记录中的计划、交付、风险、跨组协作和持续负荷信号形成会议信号指数；不作为单一绩效结论。"
      : meetingIntelligenceSnapshot.method,
    profiles,
    summary: {
      vitalityScore: averageScore(profiles, "vitalityScore"),
      heatScore: averageScore(profiles, "heatScore"),
      saturationScore: averageScore(profiles, "saturationScore"),
      scoredProfiles: profiles.filter((item) => Number.isFinite(item.vitalityScore)).length,
      visibleProfiles: profiles.length,
    },
    visibilityNote: access.scope === "department"
      ? "总监级展示主管与负责人所辖单元的会议信号。"
      : access.scope === "center"
        ? `仅展示 ${scopedCenters.join("、")} 的中心级信号。`
        : "仅展示与本人身份可靠匹配的信号；未匹配时不展示他人内容。",
  };
}

function memberDashboardForAccess(payload, access) {
  if (!payload || !Array.isArray(payload.members)) return null;
  const scopedCenters = Array.isArray(access.centers) ? access.centers.filter(Boolean) : access.center ? [access.center] : [];
  const normalizedPerson = String(access.personName || "").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN");
  const members = access.scope === "department"
    ? payload.members
    : access.scope === "center"
      ? payload.members.filter((item) => scopedCenters.includes(item.center) || (item.leaderCenters || []).some((center) => scopedCenters.includes(center)))
      : payload.members.filter((item) => String(item.personName || "").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN") === normalizedPerson);
  const personalScope = access.scope === "personal";
  const timesheetMembers = personalScope ? [] : members.filter((item) => Number.isFinite(item.timesheet?.averageEffectiveHours));
  const averageTimesheet = (field) => {
    const values = timesheetMembers.map((item) => item.timesheet?.[field]).filter((value) => Number.isFinite(value));
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
  };
  const visibleMembers = personalScope
    ? members.map(({ timesheet: _privateRoutineData, ...member }) => member)
    : members;
  const source = personalScope
    ? Object.fromEntries(Object.entries(payload.source || {}).filter(([key]) => !key.toLocaleLowerCase("en-US").includes("timesheet")))
    : payload.source;
  const summary = {
    visibleMembers: visibleMembers.length,
    mappedMembers: visibleMembers.filter((item) => item.performance?.state === "ready").length,
    unmappedMembers: visibleMembers.filter((item) => item.performance?.state !== "ready").length,
  };
  if (!personalScope) Object.assign(summary, {
    timesheetMappedMembers: timesheetMembers.length,
    averageEffectiveHours: averageTimesheet("averageEffectiveHours"),
    averageAttendanceHours: averageTimesheet("averageAttendanceHours"),
    averageScheduledDays: averageTimesheet("scheduledDays"),
    averagePunchDays: averageTimesheet("punchDays"),
  });
  return {
    ...payload,
    access: {
      scope: access.scope,
      centers: scopedCenters,
      personName: access.personName,
      serverFiltered: true,
    },
    summary,
    source,
    members: visibleMembers,
  };
}

function stripPersonalRoutineData(value) {
  if (Array.isArray(value)) return value.map(stripPersonalRoutineData);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !key.toLocaleLowerCase("en-US").includes("timesheet"))
      .map(([key, item]) => [key, stripPersonalRoutineData(item)]));
  }
  return typeof value === "string" ? value.replaceAll("工时", "例行") : value;
}

const restrictedRoutineTextPattern = /工时|timesheet|有效时长|出勤时长|打卡时长|排班时长/iu;
const restrictedRoutineKeyPattern = /timesheet|effective.*hours?|attendance.*hours?|work.*hours?|scheduledDays|punchDays/iu;

function stripSpecialistRoutineInformation(value) {
  if (Array.isArray(value)) return value.map(stripSpecialistRoutineInformation);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !restrictedRoutineKeyPattern.test(key))
      .map(([key, item]) => [key, stripSpecialistRoutineInformation(item)]));
  }
  if (typeof value !== "string") return value;
  const lines = value.split("\n").filter((line) => !restrictedRoutineTextPattern.test(line));
  return lines.join("\n").trim();
}

const launchTargets = {
  "data-dashboard": "https://app.fandow.top/fd-026222/wis-data-dashboard/",
  "creative-hub": "https://app.fandow.top/fd-023794/creative-hub/",
  "creative-radar": "http://pinguan-central-platform.fandow.com/today-highlights",
  "ai-first-creation": "https://app.fandow.top/fd-026222/brand-marketing-workbench/",
  "material-workbench": "https://app.fandow.top/fd-026222/brand-marketing-workbench/remix.html",
  "cloud-manager": "https://app.fandow.top/fd-026222/wis-video-center/",
  "live-room-management": "https://app.fandow.top/fd-027340/live-center-workbench/#business",
  "workflow-engine": "https://app.fandow.top/fd-026222/wis-marketing-hub/workflow-panorama/",
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendFile(request, response, filePath) {
  const extension = extname(filePath).toLowerCase();
  const accepts = String(request.headers["accept-encoding"] || "");
  const compressible = new Set([".css", ".html", ".js", ".json", ".svg"]);
  let sourcePath = filePath;
  let contentEncoding = "";
  if (compressible.has(extension) && accepts.includes("br") && existsSync(`${filePath}.br`)) {
    sourcePath = `${filePath}.br`;
    contentEncoding = "br";
  } else if (compressible.has(extension) && accepts.includes("gzip") && existsSync(`${filePath}.gz`)) {
    sourcePath = `${filePath}.gz`;
    contentEncoding = "gzip";
  }
  const fileStat = statSync(sourcePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes[extension] || "application/octet-stream");
  response.setHeader("Content-Length", fileStat.size);
  response.setHeader("Last-Modified", fileStat.mtime.toUTCString());
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", extension === ".html" ? "no-store" : "public, max-age=31536000, immutable");
  if (contentEncoding) {
    response.setHeader("Content-Encoding", contentEncoding);
    response.setHeader("Vary", "Accept-Encoding");
  }
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(sourcePath).pipe(response);
}

function readBody(request, maxBytes = 128 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("请求内容过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function readPrivateJson(filePath) {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function writePrivateJson(filePath, value) {
  mkdirSync(resolve(filePath, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

async function readJsonBody(request) {
  const raw = await readBody(request, 32 * 1024);
  if (!raw.length) return {};
  try {
    const value = JSON.parse(raw.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("请求内容不是有效 JSON");
  }
}

async function readTaskJsonBody(request, maxBytes = 42 * 1024 * 1024) {
  const raw = await readBody(request, maxBytes);
  if (!raw.length) return {};
  try {
    const value = JSON.parse(raw.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("任务内容不是有效 JSON");
  }
}


function taskCenterUser(sessionPayload = {}) {
  const user = sessionPayload.user || {};
  return {
    number: dashboardUserIdentifier(user).toLocaleUpperCase("en-US"),
    name: dashboardUserName(user),
    center: String(sessionPayload.workspace?.center || userCenter(user) || "").trim(),
    role: String(sessionPayload.workspace?.role || "external"),
  };
}

function taskCenterAccess(sessionPayload = {}) {
  const user = taskCenterUser(sessionPayload);
  const allowedRole = new Set(["director", "manager", "specialist"]).has(user.role);
  const enabled = allowedRole && user.center === taskCenterPilot && sessionPayload.workspace?.is_brand_department === true;
  return {
    enabled,
    canManage: enabled && new Set(["director", "manager"]).has(user.role),
    user,
  };
}

function taskCenterText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function taskCenterUrl(value) {
  const text = taskCenterText(value, 1200);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return new Set(["http:", "https:"]).has(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function taskCenterId(prefix, seed = "") {
  return `${prefix}_${createHash("sha256").update(`${Date.now()}:${process.hrtime.bigint()}:${seed}`).digest("hex").slice(0, 20)}`;
}

function taskCenterAssignee(identifier) {
  const key = taskCenterText(identifier, 80).toLocaleUpperCase("en-US");
  if (!key) return null;
  const row = previewMemberDirectory.find((item) => (
    String(item.userNumber || "").toLocaleUpperCase("en-US") === key
    || String(item.realName || "").trim() === taskCenterText(identifier, 80)
  ));
  if (!row || row.loginActive === false || String(row.center || "").trim() !== taskCenterPilot) return null;
  return { number: String(row.userNumber || "").toLocaleUpperCase("en-US"), name: String(row.realName || "").trim() };
}

function taskCenterResolveAssignees(value) {
  const identifiers = Array.isArray(value) ? value : value ? [value] : [];
  if (identifiers.length > 20) return null;
  const resolved = [];
  const seen = new Set();
  for (const identifier of identifiers) {
    const assignee = taskCenterAssignee(identifier);
    if (!assignee) return null;
    if (seen.has(assignee.number)) continue;
    seen.add(assignee.number);
    resolved.push(assignee);
  }
  return resolved;
}

function taskCenterStoredAssignees(task) {
  const values = Array.isArray(task?.assignees) && task.assignees.length
    ? task.assignees
    : task?.assignee
      ? [task.assignee]
      : [];
  const seen = new Set();
  return values.flatMap((value) => {
    const number = taskCenterText(value?.number, 80).toLocaleUpperCase("en-US");
    const name = taskCenterText(value?.name, 80);
    if (!number || !name || seen.has(number)) return [];
    seen.add(number);
    return [{ number, name }];
  });
}


function taskCenterSaveVideo(video, taskId) {
  if (!video || typeof video !== "object") throw new Error("请先选择参考视频文件");
  const filename = taskCenterText(video.filename, 120);
  const mimeType = taskCenterText(video.mimeType, 80).toLocaleLowerCase("en-US");
  const dataBase64 = String(video.dataBase64 || "");
  const mimeExtensions = new Map([
    ["video/mp4", ".mp4"],
    ["video/quicktime", ".mov"],
    ["video/webm", ".webm"],
  ]);
  const extension = mimeExtensions.get(mimeType);
  if (!filename || !extension) throw new Error("仅支持 MP4、MOV 或 WebM 参考视频");
  if (!dataBase64 || dataBase64.length > 41 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(dataBase64)) {
    throw new Error("参考视频内容无效或超过 30MB");
  }
  const content = Buffer.from(dataBase64, "base64");
  if (!content.length || content.length > 30 * 1024 * 1024) throw new Error("参考视频内容无效或超过 30MB");
  const id = taskCenterId("att", `${taskId}:${filename}:${content.length}`);
  mkdirSync(taskAttachmentRoot, { recursive: true, mode: 0o700 });
  const storagePath = join(taskAttachmentRoot, `${id}${extension}`);
  writeFileSync(storagePath, content, { flag: "wx", mode: 0o600 });
  return { id, filename, mimeType, sizeBytes: content.length, storageName: `${id}${extension}` };
}

function taskCenterVisible(task, access) {
  if (!access.enabled || String(task.center || "") !== taskCenterPilot) return false;
  if (access.canManage) return true;
  if (task.kind === "opportunity") return true;
  const assignees = taskCenterStoredAssignees(task);
  return !assignees.length || assignees.some((assignee) => assignee.number === access.user.number);
}


function taskCenterAssignees() {
  return previewMemberDirectory
    .filter((item) => item.loginActive !== false && String(item.center || "").trim() === taskCenterPilot)
    .map((item) => ({ number: String(item.userNumber || "").toLocaleUpperCase("en-US"), name: String(item.realName || "").trim() }))
    .filter((item) => item.number && item.name)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}


function libtvCredentialValue(payload, names) {
  const candidates = [payload, payload?.data, payload?.credential, payload?.credentials];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const name of names) {
      const value = String(candidate[name] || "").trim();
      if (value) return value;
    }
  }
  return "";
}

function safeLibtvHeaderValue(value) {
  const text = String(value || "").trim();
  return text && text.length <= 4096 && !/[\r\n]/u.test(text) ? text : "";
}

function readLibtvCredentials() {
  const payload = readPrivateJson(libtvCredentialFile);
  if (!payload) return null;
  const token = safeLibtvHeaderValue(libtvCredentialValue(payload, ["usertoken", "userToken", "token"]));
  const webid = safeLibtvHeaderValue(libtvCredentialValue(payload, ["webid", "webId"]));
  if (!token || !webid) return null;
  return { token, webid };
}

function libtvApiError(message, authRequired = false) {
  const error = new Error(message);
  error.authRequired = authRequired;
  return error;
}

async function callLibtvApi(pathname, method = "GET", body = undefined, timeoutMs = 20_000) {
  const credentials = readLibtvCredentials();
  if (!credentials) throw libtvApiError("LibTV 团队账号尚未连接", true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${libtvCreditApiBase}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        token: credentials.token,
        webid: credentials.webid,
        "x-language": "zh",
        "X-Log-ID": createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    const code = Number(payload?.code);
    const authRequired = response.status === 401 || code === 401 || code === 10050 || code === 10051;
    if (!response.ok || (Number.isFinite(code) && code !== 0)) {
      const detail = authRequired ? "LibTV 登录已失效，请重新连接" : String(payload?.msg || payload?.message || `LibTV 接口返回 ${response.status}`).slice(0, 160);
      throw libtvApiError(detail, authRequired);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw libtvApiError("LibTV 积分接口读取超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function libtvShanghaiDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function libtvDateShift(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return libtvShanghaiDate(date);
}

function libtvDateRange(days) {
  const endDate = libtvShanghaiDate();
  const startDate = libtvDateShift(endDate, 1 - days);
  return {
    startDate,
    endDate,
    startTime: Math.floor(new Date(`${startDate}T00:00:00+08:00`).getTime() / 1000),
    endTime: Math.floor(new Date(`${endDate}T23:59:59+08:00`).getTime() / 1000),
  };
}

function libtvTransactionTime(value) {
  const number = Number(value);
  const date = Number.isFinite(number)
    ? new Date(number > 10_000_000_000 ? number : number * 1000)
    : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function libtvFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLibtvTransaction(row, index) {
  const occurred = libtvTransactionTime(row?.transTime || row?.transactionTime || row?.createdAt);
  if (!occurred) return null;
  const consumedRaw = libtvFiniteNumber(row?.transAmount ?? row?.amount ?? row?.power);
  if (consumedRaw === null) return null;
  const userName = String(row?.seatName || row?.userName || row?.memberName || "账号待核验").trim() || "账号待核验";
  const explicitUserId = String(row?.seatUserId || row?.userId || row?.seatId || "").trim();
  return {
    id: String(row?.id || `${occurred.getTime()}-${index}`),
    occurredAt: occurred.toISOString(),
    date: libtvShanghaiDate(occurred),
    userId: explicitUserId || createHash("sha256").update(`libtv-member:${userName}`).digest("hex").slice(0, 16),
    userName,
    sourceName: String(row?.sourceName || row?.taskTypeName || "").trim() || null,
    modelName: String(row?.modelName || "").trim() || null,
    projectName: String(row?.projectName || "").trim() || null,
    projectId: String(row?.projectId || "").trim() || null,
    taskId: String(row?.bizNo || row?.taskId || "").trim() || null,
    detail: String(row?.transDesc || row?.detail || "").trim().slice(0, 240) || null,
    consumed: Math.abs(consumedRaw),
  };
}

function unwrapLibtvData(payload) {
  return payload?.data ?? payload ?? {};
}

async function fetchLibtvConsumption(range) {
  const pageSize = 100;
  const basePayload = {
    page: 1,
    pageSize,
    opTypeCode: 2,
    startTime: range.startTime,
    endTime: range.endTime,
  };
  const [firstPayload, summaryPayload] = await Promise.all([
    callLibtvApi("/api/www/power/translogs/management", "POST", basePayload, 25_000),
    callLibtvApi("/api/www/power/translogs/management/summary", "POST", basePayload, 25_000),
  ]);
  const first = unwrapLibtvData(firstPayload);
  const firstRows = Array.isArray(first?.data) ? first.data : Array.isArray(first?.list) ? first.list : Array.isArray(first) ? first : [];
  const total = Math.max(firstRows.length, Number(first?.total || first?.totalCount || firstRows.length) || 0);
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount > 200) throw libtvApiError("LibTV 积分明细超过单次安全读取上限，请缩短周期");
  const rows = [...firstRows];
  for (let page = 2; page <= pageCount; page += 1) {
    const payload = await callLibtvApi("/api/www/power/translogs/management", "POST", { ...basePayload, page }, 25_000);
    const data = unwrapLibtvData(payload);
    const pageRows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
    rows.push(...pageRows);
  }
  const transactions = rows
    .map(normalizeLibtvTransaction)
    .filter(Boolean)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const summary = unwrapLibtvData(summaryPayload);
  return {
    transactions,
    totalCount: libtvFiniteNumber(summary?.totalCount) ?? total,
    totalAmount: libtvFiniteNumber(summary?.totalAmount),
  };
}

function findLibtvPowerAttributes(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return null;
  const attr = value.attr && typeof value.attr === "object" ? value.attr : value;
  if (["usablePower", "totalPower", "usedPower", "libtvUsablePower", "rechargeUsablePower"].some((key) => key in attr)) return attr;
  for (const key of ["data", "vipInfo", "userVipInfo", "memberAccount", "account", "info"]) {
    const found = findLibtvPowerAttributes(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function fetchLibtvCurrentBalance() {
  try {
    const payload = await callLibtvApi("/api/www/user/getUserInfo", "GET", undefined, 15_000);
    const attr = findLibtvPowerAttributes(payload);
    if (!attr) return null;
    const usable = libtvFiniteNumber(attr.usablePower) ?? Math.max(0, (libtvFiniteNumber(attr.totalPower) || 0) - (libtvFiniteNumber(attr.usedPower) || 0));
    const tv = Math.max(0, libtvFiniteNumber(attr.libtvUsablePower) || 0);
    const model = Math.max(0, libtvFiniteNumber(attr.exPowerSummary?.usablePower) || 0);
    return Math.max(0, usable) + tv + model;
  } catch (error) {
    if (error?.authRequired) throw error;
    return null;
  }
}

function libtvTrendSnapshotFile(days) {
  return join(dataRoot, `libtv-credit-trend-${days}.json`);
}

function emptyLibtvCreditTrend(days, status, note) {
  const range = libtvDateRange(days);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    team: { name: null, id: null, verified: false },
    days,
    range: { startDate: range.startDate, endDate: range.endDate, timezone: "Asia/Shanghai" },
    summary: { todayConsumed: null, consumed: null, dailyAverage: null, currentBalance: null, transactionCount: null },
    series: [],
    members: [],
    transactions: [],
    source: { label: "LibTV 团队积分管理", updatedAt: null, cache: "live", note },
  };
}

async function buildLibtvCreditTrend(days) {
  const range = libtvDateRange(days);
  const [{ transactions, totalCount, totalAmount }, currentBalance] = await Promise.all([
    fetchLibtvConsumption(range),
    fetchLibtvCurrentBalance(),
  ]);
  const dates = Array.from({ length: days }, (_, index) => libtvDateShift(range.startDate, index));
  const dateSet = new Set(dates);
  const totalsByDate = new Map(dates.map((date) => [date, { consumed: 0, transactionCount: 0 }]));
  const members = new Map();
  for (const transaction of transactions) {
    if (!dateSet.has(transaction.date)) continue;
    const total = totalsByDate.get(transaction.date);
    total.consumed += transaction.consumed;
    total.transactionCount += 1;
    if (!members.has(transaction.userId)) {
      members.set(transaction.userId, {
        userId: transaction.userId,
        name: transaction.userName,
        total: 0,
        daily: new Map(dates.map((date) => [date, 0])),
      });
    }
    const member = members.get(transaction.userId);
    member.total += transaction.consumed;
    member.daily.set(transaction.date, (member.daily.get(transaction.date) || 0) + transaction.consumed);
  }
  const computedTotal = transactions.reduce((sum, item) => sum + item.consumed, 0);
  const consumed = totalAmount === null ? computedTotal : Math.abs(totalAmount);
  const team = readPrivateJson(libtvCreditTeamFile) || {};
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    status: "ready",
    team: {
      name: String(team.name || process.env.LIBTV_TEAM_NAME || "品牌营销部").trim() || null,
      id: String(team.id || process.env.LIBTV_TEAM_ID || "").trim() || null,
      verified: team.verified === true,
    },
    days,
    range: { startDate: range.startDate, endDate: range.endDate, timezone: "Asia/Shanghai" },
    summary: {
      todayConsumed: totalsByDate.get(range.endDate)?.consumed ?? 0,
      consumed,
      dailyAverage: days ? consumed / days : null,
      currentBalance,
      transactionCount: totalCount,
    },
    series: dates.map((date) => ({ date, ...totalsByDate.get(date) })),
    members: [...members.values()]
      .map((member) => ({
        userId: member.userId,
        name: member.name,
        total: member.total,
        series: dates.map((date) => ({ date, consumed: member.daily.get(date) || 0 })),
      }))
      .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "zh-CN")),
    transactions: transactions.map(({ date, ...transaction }) => transaction),
    source: {
      label: "LibTV 团队积分管理",
      updatedAt: generatedAt,
      cache: "live",
      note: currentBalance === null ? "消耗明细已完整读取；当前余额暂未返回，显示待回补。" : "通过 LibTV 团队管理后台过渡接口读取；5 分钟缓存。",
    },
  };
}

async function loadLibtvCreditTrend(days, force = false) {
  const key = String(days);
  const now = Date.now();
  const cached = libtvCreditCache.get(key);
  if (!force && cached && cached.expiresAt > now) return cached.value;
  if (libtvCreditInflight.has(key)) return libtvCreditInflight.get(key);
  const load = (async () => {
    try {
      const value = await buildLibtvCreditTrend(days);
      libtvCreditCache.set(key, { expiresAt: Date.now() + libtvCreditCacheTtlMs, value });
      writePrivateJson(libtvTrendSnapshotFile(days), value);
      return value;
    } catch (error) {
      const snapshot = readPrivateJson(libtvTrendSnapshotFile(days));
      if (snapshot) {
        return {
          ...snapshot,
          status: "stale",
          source: {
            ...snapshot.source,
            cache: "stale",
            note: error?.authRequired ? "LibTV 登录已失效，暂显示最近成功快照；请管理员重新连接。" : `实时读取失败，暂显示最近成功快照：${String(error?.message || "接口不可用").slice(0, 120)}`,
          },
        };
      }
      return emptyLibtvCreditTrend(days, error?.authRequired ? "auth_required" : "error", String(error?.message || "LibTV 积分数据暂不可用").slice(0, 160));
    } finally {
      libtvCreditInflight.delete(key);
    }
  })();
  libtvCreditInflight.set(key, load);
  return load;
}

function runLibtvCli(args, timeoutMs = 60_000, secrets = []) {
  return new Promise((resolveRun) => {
    if (!existsSync(libtvBinary)) {
      resolveRun({ code: 127, stdout: "", stderr: "LibTV CLI 尚未安装" });
      return;
    }
    mkdirSync(libtvCreditConfigDir, { recursive: true, mode: 0o700 });
    const child = spawn(libtvBinary, args, {
      cwd: libtvCreditConfigDir,
      windowsHide: true,
      env: { ...process.env, LIBTV_CONFIG_DIR: libtvCreditConfigDir, HOME: libtvCreditConfigDir, USERPROFILE: libtvCreditConfigDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const redact = (value) => secrets.reduce((text, secret) => secret ? text.split(String(secret)).join("***") : text, String(value || ""));
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: 1, stdout: redact(stdout), stderr: redact(error.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: Number(code ?? 1), stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}

function parseLibtvCliJson(text) {
  try { return JSON.parse(String(text || "").trim()); } catch { return null; }
}

async function readLibtvBridgeStatus() {
  if (!readLibtvCredentials()) return { connected: false, status: "auth_required", message: "请连接 LibTV 团队管理员账号" };
  const result = await runLibtvCli(["account", "info"], 20_000);
  if (result.code !== 0) return { connected: false, status: "auth_required", message: "LibTV 登录已失效，请重新连接" };
  const account = parseLibtvCliJson(result.stdout) || {};
  const active = account.activeAccount || {};
  const teamId = Number(account.teamId || active.teamId || 0);
  const name = String(active.accountName || process.env.LIBTV_TEAM_NAME || "品牌营销部").trim();
  const isTeam = Number(active.accountType || 0) === 2 || teamId > 0;
  if (isTeam) writePrivateJson(libtvCreditTeamFile, { id: teamId ? String(teamId) : null, name, verified: true, updatedAt: new Date().toISOString() });
  return {
    connected: true,
    status: isTeam ? "connected" : "account_selection_required",
    message: isTeam ? `已连接 ${name}` : "当前是个人空间，请切换到团队账号",
    team: { id: teamId ? String(teamId) : null, name, verified: isTeam },
  };
}

function normalizeLibtvPhone(value) {
  const phone = String(value || "").replace(/[\s-]+/gu, "");
  if (!/^1\d{10}$/u.test(phone)) throw new Error("请输入有效的 11 位手机号");
  return phone;
}

function normalizeLibtvCode(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/u.test(code)) throw new Error("请输入短信中的 6 位验证码");
  return code;
}

function libtvCliFailure(result, fallback) {
  const message = `${result?.stderr || ""}\n${result?.stdout || ""}`.trim();
  if (/captcha|人机验证|滑块|安全验证/iu.test(message)) return "LibTV 要求人机验证，请稍后重试或改用网页登录";
  return (message || fallback).replace(/\s+/gu, " ").slice(0, 180);
}

async function sendLibtvLoginCode(phoneValue) {
  const phone = normalizeLibtvPhone(phoneValue);
  const digest = createHash("sha256").update(phone).digest("hex");
  const elapsed = Date.now() - libtvLoginState.sentAt;
  if (libtvLoginState.phoneDigest === digest && elapsed < 60_000) {
    return { ok: true, status: "code_sent", maskedPhone: libtvLoginState.maskedPhone, retryAfter: Math.ceil((60_000 - elapsed) / 1000), message: `验证码已发送至 ${libtvLoginState.maskedPhone}` };
  }
  const result = await runLibtvCli(["login", "phone", "-p", phone], 60_000, [phone]);
  if (result.code !== 0) throw new Error(libtvCliFailure(result, "LibTV 验证码发送失败"));
  libtvLoginState.phoneDigest = digest;
  libtvLoginState.maskedPhone = `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  libtvLoginState.sentAt = Date.now();
  return { ok: true, status: "code_sent", maskedPhone: libtvLoginState.maskedPhone, retryAfter: 60, message: `验证码已发送至 ${libtvLoginState.maskedPhone}` };
}

async function verifyLibtvLoginCode(phoneValue, codeValue) {
  const phone = normalizeLibtvPhone(phoneValue);
  const code = normalizeLibtvCode(codeValue);
  const result = await runLibtvCli(["login", "phone", "-p", phone, "-c", code], 60_000, [phone, code]);
  if (result.code !== 0) throw new Error(libtvCliFailure(result, "LibTV 验证码验证失败"));
  const accountsResult = await runLibtvCli(["account", "list"], 20_000);
  if (accountsResult.code === 0) {
    const accountsPayload = parseLibtvCliJson(accountsResult.stdout) || {};
    const accounts = Array.isArray(accountsPayload) ? accountsPayload : Array.isArray(accountsPayload.accounts) ? accountsPayload.accounts : [];
    const teams = accounts.filter((item) => Number(item?.accountType || 0) === 2 || Number(item?.teamId || 0) > 0);
    const active = accounts.find((item) => item?.isActive);
    if (teams.length === 1 && String(active?.accountId || "") !== String(teams[0]?.accountId || "")) {
      await runLibtvCli(["account", "use", String(teams[0].accountId)], 20_000);
    }
  }
  libtvLoginState.phoneDigest = "";
  libtvLoginState.maskedPhone = "";
  libtvLoginState.sentAt = 0;
  libtvCreditCache.clear();
  return readLibtvBridgeStatus();
}

async function logoutLibtvBridge() {
  const result = await runLibtvCli(["logout"], 20_000);
  if (result.code !== 0 && !/未登录|not logged/iu.test(`${result.stderr}\n${result.stdout}`)) throw new Error(libtvCliFailure(result, "LibTV 退出失败"));
  libtvCreditCache.clear();
  return { ok: true, connected: false, status: "auth_required", message: "LibTV 团队账号已解除连接" };
}

function authorityHeaders(request, hasBody = false) {
  const headers = { Accept: "application/json" };
  if (request.headers.cookie) headers.Cookie = request.headers.cookie;
  if (request.headers["x-oa-token"]) headers["X-OA-Token"] = request.headers["x-oa-token"];
  if (hasBody) headers["Content-Type"] = "application/json";
  return headers;
}

async function callAuthority(request, path, method = "GET", body, timeoutMs = 15_000) {
  const startedAt = Date.now();
  const result = await requestAuthority({ authorityBase, sessionBase: authSessionBase }, {
    path, method, body, timeoutMs, headers: authorityHeaders(request, Boolean(body?.length))
  });
  if (result.status >= 500) console.warn("authority request unavailable", {
    path: path.split("?", 1)[0], method, status: result.status,
    elapsedMs: Date.now() - startedAt, timeoutMs
  });
  return result;
}

function isHtmlNavigation(request) {
  return /(?:^|,)\s*text\/html(?:\s*;|\s*,|$)/iu.test(String(request.headers.accept || ""));
}

function hubEntryPath(request) {
  const prefix = String(request.headers["x-forwarded-prefix"] || "").trim().replace(/\/+$/u, "");
  return prefix ? `${prefix}/` : "/";
}

async function callRootDashboard(request, path, timeoutMs = 15_000) {
  let upstream;
  const startedAt = Date.now();
  try {
    upstream = await fetch(`${rootDashboardApiBase}${path}`, {
      method: "GET",
      headers: authorityHeaders(request),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.warn("root dashboard request unavailable", {
      path,
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      cause: error instanceof Error ? error.name : "unknown",
    });
    return { status: 503, payload: { detail: "根数据看板暂时不可用，请稍后刷新" } };
  }
  const payload = await upstream.json().catch(() => ({
    detail: upstream.status === 401 ? "根数据看板登录状态已失效" : "根数据看板返回了无法识别的结果",
  }));
  return { status: upstream.status, payload };
}

async function relayAuthorityBinary(request, response, path) {
  let upstream;
  try {
    upstream = await fetch(`${authorityBase}${path}`, {
      method: "GET",
      headers: authorityHeaders(request),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    sendJson(response, 503, { detail: "图片预览服务暂时不可用" });
    return;
  }
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => ({ detail: "图片暂时无法读取" }));
    sendJson(response, upstream.status, payload);
    return;
  }
  const data = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    "Cache-Control": "private, no-store",
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Content-Length": data.length,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(data);
}

function sessionCacheKey(request) {
  const credential = String(request.headers["x-oa-token"] || request.headers.cookie || "");
  return credential ? createHash("sha256").update(credential).digest("hex") : "";
}

function emptyPermissionPreview() {
  return { active: false, scope: "real", center: "", person: "", label: "真实权限", subject: null, updatedAt: null };
}

function permissionPreviewFor(request, sessionPayload) {
  if (!sessionPayload?.permissions?.manage_permissions) return emptyPermissionPreview();
  const key = sessionCacheKey(request);
  return key ? (previewContexts.get(key) || emptyPermissionPreview()) : emptyPermissionPreview();
}

function permissionPreviewFromQuery(url, sessionPayload, fallback) {
  if (!sessionPayload?.permissions?.manage_permissions) return fallback;
  if (!url.searchParams.has("preview_scope")) return fallback;
  const scope = String(url.searchParams.get("preview_scope") || "real");
  if (scope === "real") return emptyPermissionPreview();
  if (!new Set(["department", "center", "personal"]).has(scope)) return fallback;
  const center = String(url.searchParams.get("preview_center") || fallback?.center || "").trim().slice(0, 120);
  const person = String(url.searchParams.get("preview_person") || fallback?.person || "").trim().slice(0, 120);
  if (scope === "center" && !center) return fallback;
  const subject = fallback?.active && fallback.scope === scope
    && (!person || normalizedPreviewMemberQuery(fallback.person) === normalizedPreviewMemberQuery(person))
    ? fallback.subject || null
    : null;
  const payload = {
    active: true,
    scope,
    center: scope === "center" ? center : "",
    person,
    label: scope === "department"
      ? `总监级${person ? ` · ${person}` : "视角"}`
      : scope === "center"
        ? `主管级 · ${person || center}`
        : `专员级 · ${person || "本人"}`,
    subject,
    updatedAt: String(url.searchParams.get("preview_version") || new Date().toISOString()),
  };
  return payload;
}

function readPreviewAudits() {
  try {
    const value = JSON.parse(readFileSync(previewAuditFile, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function appendPreviewAudit(sessionPayload, preview) {
  try {
    const user = sessionPayload?.user || {};
    const now = new Date().toISOString();
    const rows = readPreviewAudits();
    rows.unshift({
      id: -Date.now(),
      actor_number: String(user.number || user.userNumber || ""),
      actor_name: String(user.realName || user.name || ""),
      department: String(user.department || user.parentDept || user.groupName || ""),
      module: "权限预览",
      action: preview.active ? `切换为${preview.label}` : "退出权限预览",
      method: "PUT",
      path: "/api/permission-preview",
      result: "success",
      status_code: 200,
      resource_type: "permission_preview",
      resource_id: preview.active ? [preview.scope, preview.center, preview.person].filter(Boolean).join(":") : "real",
      detail: "仅改变当前最高权限账号的开发预览视角，不修改任何成员实际权限。",
      created_at: now,
    });
    mkdirSync(dataRoot, { recursive: true });
    const temporary = `${previewAuditFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(rows.slice(0, 500), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, previewAuditFile);
    return true;
  } catch (error) {
    // 审计日志属于辅助能力。磁盘写满或日志目录短暂不可写时，不能让
    // 已通过权限校验的视角切换把整个 Node 进程带崩。
    console.warn("permission preview audit unavailable", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function filterPreviewAudits(url) {
  const query = String(url.searchParams.get("q") || "").trim().toLocaleLowerCase("zh-CN");
  const moduleName = String(url.searchParams.get("module") || "").trim();
  const result = String(url.searchParams.get("result") || "").trim();
  const dateFrom = String(url.searchParams.get("date_from") || "").trim();
  const dateTo = String(url.searchParams.get("date_to") || "").trim();
  let entryAudits = [];
  try { entryAudits = organizationEntryStore.read().audits; } catch { /* deny access elsewhere; keep unrelated audit available */ }
  return [...readPreviewAudits(), ...entryAudits].filter((row) => {
    if (moduleName && row.module !== moduleName) return false;
    if (result && row.result !== result) return false;
    if (dateFrom && row.created_at.slice(0, 10) < dateFrom) return false;
    if (dateTo && row.created_at.slice(0, 10) > dateTo) return false;
    if (query && !`${row.actor_name} ${row.actor_number} ${row.path} ${row.resource_id}`.toLocaleLowerCase("zh-CN").includes(query)) return false;
    return true;
  });
}

function clearSessionCache() {
  sessionCacheEpoch += 1;
  sessionCache.clear();
  sessionInflight.clear();
  dashboardJobs.clear();
  workspaceSummaryInflight.clear();
}

function readRootDashboardRealtimeSnapshot() {
  try {
    const value = JSON.parse(readFileSync(rootDashboardRealtimeFile, "utf8"));
    return value && Array.isArray(value.channels) ? value : null;
  } catch {
    return null;
  }
}

function writeRootDashboardRealtimeSnapshot(payload) {
  if (!payload || !Array.isArray(payload.channels)) return;
  try {
    mkdirSync(dataRoot, { recursive: true });
    const temporary = `${rootDashboardRealtimeFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, rootDashboardRealtimeFile);
  } catch (error) {
    console.warn("root dashboard snapshot unavailable", error instanceof Error ? error.message : String(error));
  }
}

function startWorkspaceSummaryRefresh(request) {
  const key = sessionCacheKey(request);
  if (!key || workspaceSummaryInflight.has(key)) return;
  const load = callRootDashboard(request, "/omnichannel/realtime-comparison", 75_000)
    .then((value) => {
      if (value.status === 200) writeRootDashboardRealtimeSnapshot(value.payload);
      return value;
    })
    .catch((error) => ({ status: 503, payload: { detail: error instanceof Error ? error.message : "根数据暂时不可用" } }))
    .finally(() => workspaceSummaryInflight.delete(key));
  workspaceSummaryInflight.set(key, load);
}

function readRootMaterialUploadsSnapshot(date) {
  try {
    rootMaterialRequest(date);
    const path = join(dataRoot, "root-material-snapshots", date + ".json");
    const value = JSON.parse(readFileSync(existsSync(path) ? path : rootMaterialUploadsFile, "utf8"));
    return value?.schemaVersion === 2 ? rootMaterialSnapshotForDate(value, date) : null;
  } catch {
    return null;
  }
}

function writeRootMaterialUploadsSnapshot(payload) {
  if (!payload || payload.schemaVersion !== 2 || !Array.isArray(payload.channels)) return;
  try {
    rootMaterialRequest(payload.date);
    const directory = join(dataRoot, "root-material-snapshots");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, payload.date + ".json");
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    console.warn("root material snapshot unavailable", error instanceof Error ? error.message : String(error));
  }
}

function transientAuthorityFailure(value) {
  return new Set([408, 425, 429, 502, 503, 504]).has(Number(value?.status));
}

async function currentSession(request) {
  const epoch = sessionCacheEpoch;
  const key = sessionCacheKey(request);
  const now = Date.now();
  const cached = key ? sessionCache.get(key) : null;
  if (cached && cached.expiresAt > now) return enforceConfirmedAdmission(cached.value);
  const pending = key ? sessionInflight.get(key) : null;
  if (pending) return enforceConfirmedAdmission(await pending);
  const load = (async () => {
    const upstream = await callAuthority(request, "/central-auth/me");
    if (epoch !== sessionCacheEpoch) return currentSession(request);
    const value = enforceConfirmedAdmission(upstream.status === 200
      ? { ...upstream, payload: applyWorkspacePolicy(upstream.payload) }
      : upstream);
    const resolvedAt = Date.now();
    if (key && value.status === 200) {
      if (sessionCache.size >= sessionCacheLimit && !sessionCache.has(key)) {
        sessionCache.delete(sessionCache.keys().next().value);
      }
      sessionCache.set(key, {
        expiresAt: resolvedAt + sessionCacheTtlMs,
        staleUntil: resolvedAt + sessionStaleTtlMs,
        value,
      });
      return value;
    }
    if (cached && transientAuthorityFailure(value) && cached.staleUntil > resolvedAt) {
      console.warn("authority session temporarily reused", {
        status: value.status,
        staleForMs: resolvedAt - cached.expiresAt,
      });
      return enforceConfirmedAdmission(cached.value);
    }
    if (key && cached) sessionCache.delete(key);
    return value;
  })();
  if (key) sessionInflight.set(key, load);
  try {
    return await load;
  } finally {
    if (key && sessionInflight.get(key) === load) sessionInflight.delete(key);
  }
}

function dashboardSelectedDate(url) {
  const value = String(url.searchParams.get("date") || "").trim();
  const date = value || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() - 86400000));
  rootMaterialRequest(date);
  return date;
}

function dashboardJobKey(request, url) {
  const credential = sessionCacheKey(request);
  if (!credential) return "";
  // The upstream facts are identical across safe preview roles; only the
  // server-side filter below changes. Reuse the same cold aggregation when a
  // director switches department/center/personal views instead of launching
  // another 150-second OA + personal-root-data read for every preview.
  const sourceKey = new URLSearchParams();
  sourceKey.set("date", dashboardSelectedDate(url));
  sourceKey.set("days", String(Math.max(1, Math.min(30, Number(url.searchParams.get("days") || 7)))));
  return `${credential}:${sourceKey.toString()}`;
}

function dashboardSourceRequests(url) {
  const selectedDate = dashboardSelectedDate(url);
  const material = rootMaterialRequest(selectedDate);
  const businessQuery = new URLSearchParams({ date: selectedDate, days: String(Math.max(1, Math.min(30, Number(url.searchParams.get("days") || 7)))) });
  const memberQuery = new URLSearchParams();
  if (selectedDate) memberQuery.set("end_date", selectedDate);
  memberQuery.set("days", String(Math.max(1, Math.min(30, Number(url.searchParams.get("days") || 7)))));
  return {
    business: { path: `/business-intelligence/overview?${businessQuery.toString()}`, timeoutMs: 45_000 },
    realtime: { source: "root-dashboard", path: "/omnichannel/realtime-comparison", timeoutMs: 75_000 },
    materials: { source: "root-dashboard", ...material },
    // Member aggregation reads OA scope, per-person root data and the verified
    // timesheet snapshot. A cold authority process can legitimately need more
    // than 45 seconds, so keep this aligned with the proven production budget.
    members: { path: `/organization/member-dashboard?${memberQuery.toString()}`, timeoutMs: 150_000 },
    work: { path: "/business-intelligence/long-term-work", timeoutMs: 12_000 },
  };
}

function startDashboardJob(request, url) {
  const key = dashboardJobKey(request, url);
  const force = url.searchParams.get("refresh") === "1";
  const now = Date.now();
  const existing = key ? dashboardJobs.get(key) : null;
  const retryTransientFailure = existing?.completedAt
    && now - existing.completedAt >= 5_000
    && Object.values(existing.attempts || existing.results || {}).some(transientAuthorityFailure);
  const officialRefresh = existing ? officialBusinessRefreshState(existing, now) : null;
  if (existing && !force && now - existing.createdAt < dashboardJobTtlMs && (!retryTransientFailure || officialRefresh?.pending || officialRefresh?.exhausted)) {
    // An HTTP 200 can still be a cold official aggregation. Re-read just this
    // business result; leave member/OA, work, realtime and uploads untouched.
    const recheck = recheckOfficialBusiness(existing, () => {
      const source = dashboardSourceRequests(url).business;
      return callAuthority(request, source.path, "GET", undefined, source.timeoutMs);
    }, now);
    if (recheck) void shutdown.trackBackground("official-business-refresh", () => recheck);
    return existing;
  }
  if (key && dashboardJobs.size >= dashboardJobLimit && !dashboardJobs.has(key)) {
    dashboardJobs.delete(dashboardJobs.keys().next().value);
  }
  const sources = dashboardSourceRequests(url);
  const job = {
    businessDate: dashboardSelectedDate(url),
    materialDays: Math.max(1, Math.min(30, Number(url.searchParams.get("days") || 7))),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    pending: new Set(Object.keys(sources)),
    results: {},
    attempts: {},
  };
  // The map key includes the verified credential, business day and period.
  // Preserve facts only within that exact request scope; never reuse attempts
  // as facts or advance the payload's original source timestamps.
  for (const name of Object.keys(sources)) {
    const previous = existing?.results?.[name];
    if (previous?.status === 200) job.results[name] = {
      ...previous, payload: { ...previous.payload, cacheState: "stale-while-refresh" },
    };
  }
  const settle = (name, value) => {
    job.attempts[name] = value;
    const retryable = value.status >= 500 || [408, 425, 429].includes(value.status);
    // In particular, 401/403 remove cached facts immediately. A permission
    // failure is not an upstream availability failure.
    if (value.status === 200 || !retryable || job.results[name]?.status !== 200) job.results[name] = value;
  };
  if (key) dashboardJobs.set(key, job);
  for (const [name, source] of Object.entries(sources)) {
    const cachedRealtime = name === "realtime" ? readRootDashboardRealtimeSnapshot() : null;
    const cachedMaterials = name === "materials" ? readRootMaterialUploadsSnapshot(job.businessDate) : null;
    if (cachedRealtime && !job.results.realtime) {
      job.results.realtime = {
        status: 200,
        payload: { ...cachedRealtime, cacheState: "stale-while-refresh" },
      };
    }
    if (cachedMaterials && !job.results.materials) {
      job.results.materials = {
        status: 200,
        payload: { ...cachedMaterials, cacheState: "stale-while-refresh" },
      };
    }
    const load = source.source === "root-dashboard"
      ? callRootDashboard(request, source.path, source.timeoutMs)
      : callAuthority(request, source.path, "GET", undefined, source.timeoutMs);
    void load
      .then((value) => {
        job.attempts[name] = value;
        if (name === "realtime" && value.status === 200) {
          writeRootDashboardRealtimeSnapshot(value.payload);
          job.results[name] = value;
          return;
        }
        if (name === "materials" && value.status === 200) {
          const normalized = normalizeRootMaterialUploads(value.payload, { date: job.businessDate, receivedAt: new Date().toISOString() });
          if (normalized) {
            writeRootMaterialUploadsSnapshot(normalized);
            job.results[name] = { status: 200, payload: normalized };
            return;
          }
          value = { status: 502, payload: { detail: "根数据没有返回所选日期的可核验素材观测汇总，保留同日最近成功快照" } };
          job.attempts[name] = value;
        }
        settle(name, value);
      })
      .catch((error) => {
        settle(name, { status: 503, payload: { detail: error instanceof Error ? error.message : "数据源暂时不可用" } });
      })
      .finally(() => {
        job.pending.delete(name);
        job.updatedAt = Date.now();
        if (!job.pending.size) job.completedAt = job.updatedAt;
      });
  }
  return job;
}

function normalizeRootDashboardRealtime(payload) {
  if (!payload || !Array.isArray(payload.channels)) return null;
  const channels = ["douyin", "wechat"]
    .map((key) => payload.channels.find((channel) => channel?.key === key))
    .filter(Boolean)
    .map((channel) => ({
      ...channel,
      spendBreakdown: Array.isArray(channel.spendBreakdown) ? channel.spendBreakdown : [],
      points: Array.isArray(channel.points) ? channel.points : [],
    }));
  if (!channels.length) return null;
  const totals = channels.map((channel) => channel.todayTotalYuan);
  const departmentTodayGsvYuan = channels.length === 2 && totals.every(Number.isFinite)
    ? Math.round(totals.reduce((sum, value) => sum + value, 0) * 100) / 100
    : null;
  const ready = channels.length === 2 && channels.every(
    (channel) => channel.state === "ready" && channel.unavailableReason == null && Number.isFinite(channel.todayTotalYuan),
  );
  return {
    schemaVersion: 2,
    generatedAt: payload.generatedAt || null,
    timezone: payload.timezone || "Asia/Shanghai",
    status: payload.cacheState === "stale-while-refresh" || payload.status === "stale" ? "stale" : ready && payload.status === "ready" ? "ready" : "partial",
    summary: {
      departmentTodayGsvYuan,
      includedChannels: channels.map((channel) => channel.key),
    },
    definitions: {
      departmentPerformance: "品牌营销部业绩 = 抖店有效 GSV + 视频号有效 GSV；两个渠道独立展示后再合计。",
      douyinGsv: "抖店支付订单中排除退款、关闭状态后的有效成交额。",
      wechatGsv: "视频号支付订单中排除退款、关闭状态后的有效成交额。",
      qianchuanAttribution: "千川归因 GMV 只用于投放分析，不重复计入店铺有效 GSV。",
      spendCoverage: "费用按根数据看板已返回的来源和覆盖状态展示；缺失项不补 0。",
      comparison: "同比与曲线只比较已经完整结束的小时。",
    },
    channels,
    quality: {
      source: "WIS 根数据看板 · 数据库直连",
      preservesMissingAsNull: true,
    },
  };
}

function organizationDashboardPayload(job, access, preview, sourceSnapshot) {
  const selectedDate = job.businessDate;
  const daily = sourceSnapshot ? projectOrganizationSnapshot(sourceSnapshot, access) : null;
  const sourceRefresh = {
    generationId: daily?.generationId || null, requiredBusinessDate: selectedDate,
    scheduler: daily?.scheduler || null, sources: daily?.status || {},
  };
  const organization = organizationStructureFor(access, daily?.sources.organization || organizationStructureSource);
  const reportingDirectory = dailyReportDirectoryFor(access, daily?.sources.reportingDirectory || dailyReportDirectorySource);
  const meetingEvidence = meetingEvidenceFor(access, daily?.sources.meetingEvidence || meetingArchiveSource);
  const meetingIntelligence = meetingIntelligenceFor(access, daily?.sources.meetingIntelligence || meetingIntelligenceSnapshot, meetingEvidence);
  const collection = (key, fallbackTime) => {
    const state = sourceRefresh.sources[key];
    return { state: state?.state || "stale", updatedAt: state?.lastSuccessAt || fallbackTime || null,
      note: state?.note || "每日采集尚无可核验成功记录；保留原来源日期，不代表当日数据" };
  };
  const upstream = job.results.business;
  const realtimeUpstream = job.results.realtime;
  const materialUpstream = job.results.materials;
  const memberUpstream = job.results.members;
  const workUpstream = job.results.work;
  const upstreamRefresh = (name) => {
    const result = job.results[name], attempt = job.attempts?.[name];
    const refreshing = job.pending.has(name);
    const failureStatus = attempt && attempt.status !== 200 ? attempt.status : null;
    const retained = result?.status === 200 && Boolean(result.payload?.cacheState || failureStatus);
    return { refreshing, failureStatus, retained,
      note: retained ? refreshing ? "后台刷新中，沿用最近成功事实及原更新时间"
        : failureStatus ? `本次读取失败 HTTP ${failureStatus}，沿用最近成功事实及原更新时间`
          : "来源返回最近成功快照，保留原更新时间"
        : failureStatus ? `本次读取失败 HTTP ${failureStatus}，当前没有可展示的授权事实` : "" };
  };
  const businessRefresh = upstreamRefresh("business"), membersRefresh = upstreamRefresh("members"), workRefresh = upstreamRefresh("work");
  let business = upstream?.status === 200 ? upstream.payload : null;
  if (business && businessRefresh.retained) business = { ...business, status: "stale",
    coverage: { ...business.coverage, warnings: [...(business.coverage?.warnings || []), businessRefresh.note] } };
  const actualBusinessDate = business?.query?.productDate || null;
  const dateMismatch = Boolean(business && actualBusinessDate !== selectedDate);
  if (dateMismatch) business = { ...business, status: "stale",
    coverage: { ...business.coverage, warnings: [...(business.coverage?.warnings || []),
      "请求 " + selectedDate + "，经营事实实际日期为 " + (actualBusinessDate || "未返回") + "；保留实际日期，不作为所选日结果"] } };
  const omnichannelRealtime = realtimeUpstream?.status === 200
    ? normalizeRootDashboardRealtime(realtimeUpstream.payload)
    : null;
  let materialUploads = materialUpstream?.status === 200 ? rootMaterialSnapshotForDate(materialUpstream.payload, selectedDate) : null;
  const materialRefresh = rootSourceRefreshState({
    result: !materialUploads && materialUpstream?.status === 200 ? { status: 502 } : job.attempts?.materials || materialUpstream, pending: job.pending.has("materials"),
    cached: Boolean(materialUploads?.cacheState || (materialUploads && job.attempts?.materials && job.attempts.materials.status !== 200)),
  });
  if (materialUploads) materialUploads = { ...materialUploads,
    status: materialRefresh.state === "stale" ? "stale" : materialUploads.status === "ready" ? "ready" : "partial" };
  const realtimeRefresh = rootSourceRefreshState({
    result: !omnichannelRealtime && realtimeUpstream?.status === 200 ? { status: 502 } : job.attempts?.realtime || realtimeUpstream, pending: job.pending.has("realtime"),
    cached: Boolean(realtimeUpstream?.payload?.cacheState || (omnichannelRealtime && job.attempts?.realtime && job.attempts.realtime.status !== 200)),
  });
  if (omnichannelRealtime && realtimeRefresh.state === "stale") omnichannelRealtime.status = "stale";
  let rootState = "pending";
  let rootNote = job.pending.has("business") || job.pending.has("realtime")
    ? "根数据正在后台读取；页面其他内容已先展示"
    : "根数据暂时无法读取";
  if (business) {
    rootState = business?.status === "stale" ? "stale" : business?.status === "ready" ? "ready" : "partial";
    rootNote = `${business?.coverage?.product?.source || "经营根数据"} · 全角色共享`;
  }
  if (omnichannelRealtime) {
    rootState = omnichannelRealtime?.status === "stale"
      ? "stale"
      : rootState === "pending" ? "partial" : rootState;
    rootNote = `抖店＋视频号实时 GSV · ${omnichannelRealtime?.status === "stale" ? "沿用最近成功快照" : "全角色共享"}`;
  } else if (!business && realtimeUpstream && !job.pending.has("realtime")) {
    rootNote = realtimeUpstream.payload?.detail || rootNote;
  }
  if (rootState === "ready" && (!business || !omnichannelRealtime || omnichannelRealtime.status !== "ready")) rootState = "partial";
  const memberDashboard = memberUpstream?.status === 200
    ? memberDashboardForAccess(memberUpstream.payload, access)
    : null;
  const productUpdatedAt = business?.coverage?.product?.sourceUpdatedAt || null;
  const realtimeUpdatedAt = omnichannelRealtime?.generatedAt || null;
  const longTermWork = longTermWorkFor(access, workUpstream?.status === 200 ? workUpstream.payload : null);
  const workScheduler = longTermWork.scheduler || {};
  const workState = job.pending.has("work")
    ? "partial"
    : workUpstream?.status !== 200
      ? "stale"
      : workScheduler.status === "ready" ? "ready" : "partial";
  const workNote = job.pending.has("work")
    ? "长期工作正在后台补充，先展示最近核验内容"
    : workUpstream?.status !== 200
      ? `平台内置刷新暂时不可用，沿用最近核验快照：${workUpstream?.payload?.detail || "连接失败"}`
      : workScheduler.lastError || `每日 ${String(workScheduler.hour ?? 10).padStart(2, "0")}:${String(workScheduler.minute ?? 15).padStart(2, "0")} 平台内置只读刷新`;
  const officialRefresh = officialBusinessRefreshState(job);
  const pendingSources = Array.from(new Set([...job.pending, ...(officialRefresh?.pending ? ["business"] : [])]));
  const sources = [
    { key: "root-data", label: "根数据", state: rootState, updatedAt: realtimeUpdatedAt || productUpdatedAt, note: rootNote, sourceUrl: "https://app.fandow.top/fd-026222/wis-data-dashboard/", authority: "凡岛根数据只读接口", coverage: "成交、订单、ROI、单品与跨渠道实时事实" },
    { key: "oa", label: "OA组织系统", state: "partial", updatedAt: workspacePolicySource.verifiedAt, note: `OA 在职 ${workspacePolicySource.coverage.oaActive} 人；映射表 ${workspacePolicySource.coverage.departmentMapped} 人，差异待核验`, sourceUrl: workspacePolicySource.url, revision: workspacePolicySource.revision, authority: "OA身份 + 部门人员映射表", coverage: "身份、部门、中心、角色与模块权限" },
    { key: "organization", label: "飞书组织架构", authority: "飞书组织架构原文" },
    { key: "daily-reports", label: "中心固定日报", authority: "飞书日报目录原文" },
    { key: "materials", label: "根数据素材观测", authority: "根数据素材趋势聚合" },
    { key: "people", label: "OA成员与个人根数据", state: job.pending.has("members") ? "pending" : memberDashboard ? memberDashboard.source?.performanceState === "ready" ? "ready" : "partial" : "pending", updatedAt: memberDashboard?.generatedAt || null, note: job.pending.has("members") ? "成员目录与个人经营映射正在后台读取" : memberDashboard ? `${memberDashboard.summary.visibleMembers} 名权限范围内成员 · ${memberDashboard.summary.mappedMembers} 名完成个人经营映射` : memberUpstream?.payload?.detail || "人员目录或个人经营映射待接入", sourceUrl: workspacePolicySource.url, revision: workspacePolicySource.revision, authority: "OA成员目录 + 根数据个人映射", coverage: "权限范围内成员、素材数与成交贡献" },
    { key: "timesheet", label: "飞书工时分析", state: job.pending.has("members") ? "pending" : memberDashboard?.source?.timesheetState || "pending", updatedAt: memberDashboard?.source?.timesheetGeneratedAt || null, note: job.pending.has("members") ? "工时快照正在后台读取" : memberDashboard ? `${memberDashboard.source?.timesheetMonth || "当前月"} · ${memberDashboard.summary.timesheetMappedMembers} 名权限范围内成员已匹配` : "飞书工时数据待回补", sourceUrl: "https://jqx28l0j4lx.feishu.cn/base/D94qbjMFIa8wPqsEo5NcMWYNnHd", authority: "飞书工时根表", coverage: "平均有效工时、出勤、排班与打卡" },
    { key: "meetings", label: "会议记录", authority: "飞书会议资料存档多维表格" },
    { key: "transcripts", label: "会议原文与信号", authority: "会议根表 + 原始文字记录" },
    { key: "work", label: "长期工作与核心干将群", state: workState, updatedAt: longTermWork.generatedAt || null, note: workNote, sourceUrl: longTermWork.sourceChat?.chatId ? `https://applink.feishu.cn/client/chat/open?openChatId=${longTermWork.sourceChat.chatId}` : null, authority: "授权群消息 + 关联飞书原文", coverage: "跨日事项、负责人、周期、验收口径与来源" },
    ...(officialRefresh ? [{ key: "official-material", label: "官方素材成交",
      state: officialRefresh.state === "ready" ? "ready" : "pending",
      updatedAt: business?.coverage?.material?.sourceUpdatedAt || null,
      note: officialRefresh.note || "所选周期官方视频财务汇总已返回，实际支付与含券口径分别展示",
      authority: "千川官方 · 已核验账户自然日视频报表", coverage: "所选周期视频实际支付归因金额与含券视频归因成交" }] : []),
  ].map((source) => {
    const refresh = source.key === "people" || source.key === "timesheet" ? membersRefresh
      : source.key === "work" ? workRefresh : source.key === "root-data" ? businessRefresh : null;
    if (refresh?.note) source = { ...source, state: refresh.retained ? "stale" : source.state,
      note: source.note + "；" + refresh.note };
    if (source.key === "organization") return { ...source, ...collection("organization", organization.updatedAt),
      sourceUrl: organization.sourceUrl, revision: organization.revision,
      coverage: organization.centers.length ? "已读取资料中的中心与负责人参考；不改变权限" : "已读取组织资料快照；画板中的中心名单待核验，不补造" };
    if (source.key === "daily-reports") return { ...source, ...collection("reportingDirectory", reportingDirectory.updatedAt),
      sourceUrl: reportingDirectory.sourceUrl, revision: reportingDirectory.revision,
      coverage: reportingDirectory.entries.length + " 个日报/看板入口；目录读取不等于日报完成" };
    if (source.key === "meetings") return { ...source, ...collection("meetingEvidence", meetingEvidence.updatedAt),
      sourceUrl: meetingEvidence.sourceUrl, revision: meetingEvidence.revision,
      coverage: "事实日期 " + (meetingEvidence.snapshotDate || "未返回") + " · 当前范围 " + meetingEvidence.dailyRecords + " 条记录" };
    if (source.key === "transcripts") return { ...source, ...collection("meetingIntelligence", meetingEvidence.updatedAt),
      state: collection("meetingIntelligence").state === "stale" ? "stale" : "partial",
      sourceUrl: meetingEvidence.sourceUrl, revision: meetingEvidence.archiveRevision,
      note: (meetingEvidence.snapshotDate || "日期未返回") + " · " + meetingEvidence.readableRecords + "/" + meetingEvidence.dailyRecords
        + " 条原文已读回；" + (meetingEvidence.unverifiedRecords || 0) + " 条待逐条读取；缺足够评分依据，三项分值保持空缺",
      coverage: "事实覆盖、明确 TODO 与来源；不以会议数估绩效" };
    if (source.key === "materials") return { ...source, label: "根数据素材观测",
      state: materialUploads?.status || materialRefresh.state, updatedAt: materialUploads?.generatedAt || null,
      note: "所选 " + selectedDate + "；" + (materialUploads ? "已返回同日观测，已核验上线与视频号发布仍待回补" : "同日素材观测尚未返回")
        + (materialRefresh.refreshing ? "；后台读取中" : "")
        + (materialRefresh.failureStatus ? "；本次读取失败 HTTP " + materialRefresh.failureStatus + "，保留同日最近成功事实" : ""),
      sourceUrl: "https://app.fandow.top/fd-026222/wis-data-dashboard/",
      authority: "根数据素材趋势聚合", coverage: "观测素材；不冒充已核验上线/内容发布" };
    if (source.key === "root-data" && dateMismatch) return { ...source, state: "stale",
      note: source.note + "；所选 " + selectedDate + "，经营事实 " + (actualBusinessDate || "日期未返回") };
    return source;
  }).filter((source) => access.scope !== "personal" || source.key !== "timesheet");
  const sourceCoverage = {
    verifiedAt: Object.values(sourceRefresh.sources).map(item => item.lastSuccessAt).filter(Boolean).sort().at(-1) || null,
    totalSources: sources.length,
    readySources: sources.filter((source) => source.state === "ready").length,
    incompleteSources: sources.filter((source) => source.state !== "ready").length,
    conflicts: [
      `OA 在职 ${workspacePolicySource.coverage.oaActive} 人与映射表 ${workspacePolicySource.coverage.departmentMapped} 人不一致`,
      "OA 与映射表存在新增、调动或姓名口径差异，未自动覆盖任一原始来源",
      `${workspacePolicySource.coverage.blankModulePolicies} 名在职人员模块权限为空，保持待核验`,
    ],
    guardrail: "缺失、无权限、未映射、来源冲突和未返回均不按 0 处理；仅展示当前角色授权范围。",
  };
  const payload = {
    schemaVersion: 8,
    generatedAt: new Date().toISOString(),
    status: sources.some(source => source.state === "stale") ? "stale"
      : sources.every(source => source.state === "ready") && !pendingSources.length ? "ready" : "partial",
    sourceRefresh,
    rootRefresh: { requestedDate: selectedDate, actualBusinessDate, dateMismatch, materials: materialRefresh, realtime: realtimeRefresh },
    refresh: {
      complete: pendingSources.length === 0,
      pendingSources,
      startedAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
      business: officialRefresh,
      pollAfterMs: officialRefresh?.pending && pendingSources.every(name => name === "business") ? 5_000 : 1_200,
    },
    access,
    preview,
    organization,
    reportingDirectory,
    businessVisibility: {
      scope: "all-authorized-roles",
      label: "经营数据全角色共享",
      note: access.scope === "personal"
        ? "总监级、主管级和专员级读取同一根数据事实；个人视角仅保留本人可行动信息。"
        : "总监级、主管级和专员级读取同一根数据事实；KPI、人员、例行、组织与会议明细按角色限定范围。",
    },
    meetingEvidence,
    meetingIntelligence,
    longTermWork,
    memberDashboard,
    sources,
    sourceCoverage,
    business,
    omnichannelRealtime,
    materialUploads,
    pendingMetrics: ["KPI目标", "关键工作完成验收", "周/月趋势"],
  };
  return access.scope === "personal" ? stripPersonalRoutineData(payload) : payload;
}

function permissionProxyRoute(url, method) {
  if (url.pathname === "/api/permissions/modules/batch") {
    return method === "POST" ? { path: "/admin/module-access/batch" } : { error: 405 };
  }
  const mappings = [
    [/^\/api\/permissions\/login(?:\/(.+))?$/u, "/admin/access-grants"],
    [/^\/api\/permissions\/admins(?:\/(.+))?$/u, "/admin/admin-grants"],
    [/^\/api\/permissions\/managers(?:\/(.+))?$/u, "/admin/permission-managers"],
    [/^\/api\/permissions\/modules(?:\/(.+))?$/u, "/admin/module-access"],
  ];
  for (const [pattern, target] of mappings) {
    const match = url.pathname.match(pattern);
    if (!match) continue;
    const allowed = target.endsWith("access-grants")
      ? new Set(["GET", "POST", "DELETE"])
      : target.endsWith("admin-grants") || target.endsWith("permission-managers")
        ? new Set(["GET", "POST", "DELETE"])
        : new Set(["GET", "PUT"]);
    if (!allowed.has(method)) return { error: 405 };
    if ((method === "DELETE" || method === "PUT") && !match[1]) return { error: 400 };
    if ((method === "GET" || method === "POST") && match[1]) return { error: 404 };
    const suffix = match[1] ? `/${encodeURIComponent(decodeURIComponent(match[1]))}` : "";
    return { path: `${target}${suffix}${url.search}` };
  }
  return null;
}

const organizationEntryHandler = createOrganizationEntryHandler({store: organizationEntryStore, currentSession,
  callAuthority, policyFor: workspacePolicyFor, readBody, sendJson, clearSessionCache});

async function handleApi(request, response, url) {
  if (await proxyHubAuth(request, response, url.pathname, {authorityBase, readBody, clearSessionCache})) return true;
  if (await sparkLibraryHandler(request, response, url)) return true;
  if (await organizationEntryHandler(request, response, url)) return true;
  // Shared gate for every dashboard endpoint, including scheduler and future routes.
  if (url.pathname.startsWith("/api/organization-dashboard/")) {
    const session = await currentSession(request);
    if (session.status !== 200) { sendJson(response, session.status, session.payload); return true; }
    if (!session.payload?.workspace?.can_view_organization_dashboard || !organizationEntryStore.allowed(session.payload.user)) {
      sendJson(response, 403, {detail: "当前账号未开通组织经营看板权限"}); return true;
    }
    const preview = permissionPreviewFor(request, session.payload);
    if (preview.subject && !organizationEntryStore.allowed(preview.subject)) {
      sendJson(response, 403, {detail: "当前预览成员的组织经营看板入口已关闭"}); return true;
    }
  }
  if (url.pathname === "/api/session" && request.method === "GET") {
    // After an OA login renewal, Nginx may return the browser to the original
    // session API URL. A top-level HTML navigation must re-enter the SPA rather
    // than expose a raw JSON response to the user.
    if (isHtmlNavigation(request)) {
      response.writeHead(303, {
        "Cache-Control": "private, no-store",
        Location: hubEntryPath(request),
      });
      response.end();
      return true;
    }
    const result = await currentSession(request);
    const payload = result.status === 200 ? {...result.payload, workspace:{...result.payload.workspace,can_configure_workflow:flowAccessFor(result.payload).canConfigure}} : result.payload;
    sendJson(response, result.status, payload);
    return true;
  }

  if (url.pathname === "/api/permission-preview/candidates") {
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.permissions?.manage_permissions) {
      sendJson(response, 403, { detail: "只有最高权限拥有者可以读取开发预览名单" });
      return true;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    let items;
    try { items = await currentPreviewCandidates(request, q); }
    catch (error) { sendJson(response, 503, {detail: error.message}); return true; }
    sendJson(response, 200, {
      items,
      total: items.length,
      source: { ...workspacePolicySource, sheets: ["本部门对照表", "其他部门对照表"] },
    });
    return true;
  }

  if (url.pathname === "/api/permission-preview") {
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.permissions?.manage_permissions) {
      sendJson(response, 403, { detail: "只有最高权限拥有者可以切换开发预览视角" });
      return true;
    }
    if (request.method === "GET") {
      sendJson(response, 200, permissionPreviewFor(request, session.payload));
      return true;
    }
    if (request.method !== "PUT") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    let payload;
    try { payload = JSON.parse((await readBody(request, 16 * 1024)).toString("utf8") || "{}"); }
    catch {
      sendJson(response, 400, { detail: "请求内容格式不正确" });
      return true;
    }
    const scope = String(payload.scope || "real");
    if (!new Set(["real", "department", "center", "personal"]).has(scope)) {
      sendJson(response, 400, { detail: "预览视角不正确" });
      return true;
    }
    const center = String(payload.center || "").trim().slice(0, 120);
    const person = String(payload.person || "").trim().slice(0, 120);
    let subject = null;
    if (scope !== "real" && person) {
      let candidates;
      try { candidates = await currentPreviewCandidates(request, person); }
      catch (error) { sendJson(response, 503, {detail: error.message}); return true; }
      const exact = candidates.filter(row => [row.realName, row.userNumber].some(value => normalizedPreviewMemberQuery(value) === normalizedPreviewMemberQuery(person)));
      const matches = exact.length ? exact : candidates;
      if (!matches.length) {
        sendJson(response, 404, { detail: `映射表中未找到“${person}”，请检查姓名或输入工号` });
        return true;
      }
      if (matches.length > 1) {
        sendJson(response, 409, {
          detail: `“${person}”对应多位成员，请输入工号：${matches.slice(0, 5).map((item) => `${item.realName}（${item.userNumber} · ${item.center || item.department}）`).join("、")}`,
          candidates: matches.slice(0, 10),
        });
        return true;
      }
      [subject] = matches;
    }
    const resolvedCenter = subject?.center || center;
    const resolvedPerson = subject?.realName || person;
    if (scope === "center" && !resolvedCenter) {
      sendJson(response, 400, { detail: "主管级预览需要指定中心" });
      return true;
    }
    const preview = scope === "real"
      ? emptyPermissionPreview()
      : {
          active: true,
          scope,
          center: scope === "center" ? resolvedCenter : "",
          person: resolvedPerson,
          label: scope === "department"
            ? `总监级${resolvedPerson ? ` · ${resolvedPerson}` : "视角"}`
            : scope === "center"
              ? `主管级 · ${resolvedPerson || resolvedCenter}`
              : `专员级 · ${resolvedPerson || "本人"}`,
          subject,
          updatedAt: new Date().toISOString(),
        };
    const key = sessionCacheKey(request);
    if (!key) {
      sendJson(response, 401, { detail: "统一登录凭证不完整，无法建立安全预览会话" });
      return true;
    }
    if (preview.active) previewContexts.set(key, preview);
    else previewContexts.delete(key);
    appendPreviewAudit(session.payload, preview);
    sendJson(response, 200, preview);
    return true;
  }

  if (url.pathname === "/api/operation-logs") {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const result = await callAuthority(request, `/admin/operation-logs${url.search}`);
    if (result.status !== 200) {
      sendJson(response, result.status, result.payload);
      return true;
    }
    const localRows = filterPreviewAudits(url);
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("page_size") || 20);
    const items = page === 1
      ? [...localRows, ...(result.payload?.items || [])]
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
        .slice(0, pageSize)
      : (result.payload?.items || []);
    const modules = [...new Set([...(result.payload?.modules || []), ...localRows.map(row => row.module)])].sort();
    const total = Number(result.payload?.total || 0) + localRows.length;
    sendJson(response, 200, { ...result.payload, items, total, total_pages: Math.max(1, Math.ceil(total / pageSize)), modules });
    return true;
  }

  if (url.pathname === "/api/workspace-home/summary") {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.workspace?.can_view_public_summary) {
      sendJson(response, 403, { detail: "当前账号不在品牌营销部公开经营摘要范围内" });
      return true;
    }
    const snapshot = readRootDashboardRealtimeSnapshot();
    const normalized = snapshot
      ? normalizeRootDashboardRealtime({ ...snapshot, cacheState: "stale-while-refresh" })
      : null;
    startWorkspaceSummaryRefresh(request);
    sendJson(response, 200, normalized
      ? {
          status: normalized.status,
          generatedAt: normalized.generatedAt,
          totalGsvYuan: normalized.summary.departmentTodayGsvYuan,
          channels: normalized.channels.map((channel) => ({
            key: channel.key,
            label: channel.label,
            todayDate: channel.todayDate || null,
            sourceUpdatedAt: channel.sourceUpdatedAt || null,
            todayTotalYuan: channel.todayTotalYuan,
            state: channel.unavailableReason ? "pending" : "ready",
          })),
          note: "公开经营摘要来自根数据最近成功快照，后台正在刷新；缺失项不补 0。",
        }
      : {
          status: "pending",
          generatedAt: null,
          totalGsvYuan: null,
          channels: [],
          note: "根数据公开经营摘要正在后台读取；未返回前不按 0 展示。",
        });
    return true;
  }

  if (await flowHandler(request, response, url)) return true;
  if (await workflowHandler(request, response, url)) return true;

  const taskAttachmentMatch = url.pathname.match(/^\/api\/task-center\/attachments\/([a-z0-9_]+)\/content$/u);
  if (taskAttachmentMatch && request.method === "GET") {
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    const access = taskCenterAccess(session.payload);
    const store = workflowStore.read();
    const task = store.tasks.find((item) => item.attachment?.id === taskAttachmentMatch[1]);
    if (!task || !taskCenterVisible(task, access)) {
      sendJson(response, 404, { detail: "参考视频不存在或当前账号不可见" });
      return true;
    }
    const storageName = String(task.attachment?.storageName || "");
    const filePath = resolve(taskAttachmentRoot, storageName);
    if (!storageName || !filePath.startsWith(taskAttachmentRoot + sep) || !existsSync(filePath)) {
      sendJson(response, 404, { detail: "参考视频待回补" });
      return true;
    }
    sendFile(request, response, filePath);
    return true;
  }


  if (url.pathname === "/api/business-intelligence/overview") {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.access?.allowed_modules?.includes("data-dashboard")) {
      sendJson(response, 403, { detail: "当前账号未开通经营情况总览权限" });
      return true;
    }
    const result = await callAuthority(
      request,
      `/business-intelligence/overview${url.search}`,
      "GET",
      undefined,
      150_000,
    );
    sendJson(response, result.status, result.payload);
    return true;
  }

  if (url.pathname.startsWith("/api/creative-incentives")) {
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.access?.allowed_modules?.includes("material-incentive")) {
      sendJson(response, 403, { detail: "当前账号未开通素材实时激励权限" });
      return true;
    }
    const allowed = (
      (url.pathname === "/api/creative-incentives/overview" && request.method === "GET")
      || (url.pathname === "/api/creative-incentives/directions" && request.method === "POST")
      || (url.pathname === "/api/creative-incentives/sync" && request.method === "POST")
      || (/^\/api\/creative-incentives\/directions\/[^/]+\/originality$/u.test(url.pathname) && request.method === "PATCH")
      || (/^\/api\/creative-incentives\/milestones\/[^/]+\/publish$/u.test(url.pathname) && request.method === "POST")
    );
    if (!allowed) {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const body = request.method === "GET" ? undefined : await readBody(request, 64 * 1024);
    const authorityPath = url.pathname.replace(/^\/api/u, "") + url.search;
    const result = await callAuthority(
      request,
      authorityPath,
      request.method,
      body,
      url.pathname.endsWith("/sync") ? 180_000 : 30_000,
    );
    sendJson(response, result.status, result.payload);
    return true;
  }

  if (url.pathname === "/api/organization-dashboard/long-term-work") {
    if (request.method !== "GET") { sendJson(response, 405, { detail: "请求方式不支持" }); return true; }
    const session = await currentSession(request);
    if (session.status !== 200) { sendJson(response, session.status, session.payload); return true; }
    if (!session.payload?.workspace?.can_view_organization_dashboard) {
      sendJson(response, 403, { detail: "当前账号未开通组织经营看板权限" }); return true;
    }
    const storedPreview = permissionPreviewFor(request, session.payload);
    const preview = permissionPreviewFromQuery(url, session.payload, storedPreview);
    const access = dashboardAccessFor(session.payload, preview);
    const result = await callAuthority(request, "/business-intelligence/long-term-work", "GET", undefined, 12_000);
    if (result.status === 200 && !Array.isArray(result.payload?.items)) {
      sendJson(response, 502, { detail: "长期工作快照结构无法核验，当前快照保持不变" }); return true;
    }
    sendJson(response, result.status, result.status === 200 && Array.isArray(result.payload?.items)
      ? longTermWorkFor(access, result.payload) : result.payload);
    return true;
  }

  if (url.pathname === "/api/organization-dashboard/long-term-work/scheduler") {
    if (!["GET", "PUT"].includes(request.method)) {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const body = request.method === "PUT" ? await readBody(request, 16 * 1024) : undefined;
    const requestId = request.method === "GET" ? url.searchParams.get("request_id") : null;
    if (requestId && !/^[A-Za-z0-9_.:-]{1,96}$/.test(requestId)) {
      sendJson(response, 400, { detail: "刷新请求编号不合法" }); return true;
    }
    const result = await callAuthority(
      request,
      `/business-intelligence/long-term-work/scheduler${requestId ? `?request_id=${encodeURIComponent(requestId)}` : ""}`,
      request.method,
      body,
      30_000,
    );
    sendJson(response, result.status, result.payload);
    return true;
  }

  if (url.pathname === "/api/organization-dashboard/long-term-work/scheduler/run") {
    if (request.method !== "POST") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    let body;
    try { body = JSON.parse((await readBody(request, 4096)).toString("utf8") || "{}"); }
    catch { sendJson(response, 400, { detail: "刷新请求内容不合法" }); return true; }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || (Object.hasOwn(body, "requestId") && (typeof body.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,96}$/.test(body.requestId)))) {
      sendJson(response, 400, { detail: "刷新请求编号不合法" }); return true;
    }
    const result = await callAuthority(
      request,
      "/business-intelligence/long-term-work/scheduler/run",
      "POST",
      Buffer.from(JSON.stringify(body.requestId ? { requestId: body.requestId } : {})),
      15_000,
    );
    sendJson(response, result.status, result.payload);
    return true;
  }

  if (url.pathname === "/api/organization-dashboard/libtv-credits") {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.workspace?.can_view_organization_dashboard) {
      sendJson(response, 403, { detail: "当前账号未开通组织经营看板权限" });
      return true;
    }
    const storedPreview = permissionPreviewFor(request, session.payload);
    const preview = permissionPreviewFromQuery(url, session.payload, storedPreview);
    const access = dashboardAccessFor(session.payload, preview);
    if (access.scope === "personal") {
      sendJson(response, 403, { detail: "LibTV 团队积分仅向总监和主管管理视图开放" });
      return true;
    }
    const requestedDays = Number(url.searchParams.get("days") || 7);
    const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 7;
    const force = url.searchParams.get("refresh") === "1" && session.payload?.permissions?.operation_admin === true;
    sendJson(response, 200, await loadLibtvCreditTrend(days, force));
    return true;
  }

  if (url.pathname === "/api/organization-dashboard/libtv-credits/auth") {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.workspace?.can_view_organization_dashboard) {
      sendJson(response, 403, { detail: "当前账号未开通组织经营看板权限" });
      return true;
    }
    try {
      sendJson(response, 200, { ...(await readLibtvBridgeStatus()), canConfigure: session.payload?.permissions?.operation_admin === true });
    } catch (error) {
      sendJson(response, 200, { connected: false, status: "auth_required", canConfigure: session.payload?.permissions?.operation_admin === true, message: String(error?.message || "LibTV 登录状态读取失败").slice(0, 160) });
    }
    return true;
  }

  if ([
    "/api/organization-dashboard/libtv-credits/login/send",
    "/api/organization-dashboard/libtv-credits/login/verify",
    "/api/organization-dashboard/libtv-credits/logout",
  ].includes(url.pathname)) {
    if (request.method !== "POST") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.permissions?.operation_admin) {
      sendJson(response, 403, { detail: "只有中枢运营管理员可以连接 LibTV 团队账号" });
      return true;
    }
    try {
      if (url.pathname.endsWith("/login/send")) {
        const body = await readJsonBody(request);
        sendJson(response, 200, await sendLibtvLoginCode(body.phone));
      } else if (url.pathname.endsWith("/login/verify")) {
        const body = await readJsonBody(request);
        sendJson(response, 200, await verifyLibtvLoginCode(body.phone, body.code));
      } else {
        sendJson(response, 200, await logoutLibtvBridge());
      }
    } catch (error) {
      sendJson(response, 400, { detail: String(error?.message || "LibTV 团队账号连接失败").slice(0, 180) });
    }
    return true;
  }

  if (url.pathname === "/api/organization-dashboard/overview") {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.workspace?.can_view_organization_dashboard) {
      sendJson(response, 403, { detail: "当前账号未开通组织经营看板权限" });
      return true;
    }
    const storedPreview = permissionPreviewFor(request, session.payload);
    const preview = permissionPreviewFromQuery(url, session.payload, storedPreview);
    const access = dashboardAccessFor(session.payload, preview);
    let job;
    try { job = startDashboardJob(request, url); }
    catch { sendJson(response, 400, { detail: "请选择有效的业务日期" }); return true; }
    const sourceSnapshot = await organizationSourceStore.read({ requiredBusinessDate: job.businessDate });
    sendJson(response, 200, organizationDashboardPayload(job, access, preview, sourceSnapshot));
    return true;
  }

  if (url.pathname === "/api/permissions/workspace-profiles" && request.method === "GET") {
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.permissions?.manage_permissions) {
      sendJson(response, 403, { detail: "只有权限管理员可以配置看板数据范围" });
      return true;
    }
    const upstream = await callAuthority(request, `/admin/workspace-profiles${url.search}`);
    if (upstream.status !== 200) {
      sendJson(response, upstream.status, upstream.payload);
      return true;
    }
    const items = (upstream.payload?.items || []).map((item) => {
      const identifier = String(item.identifier || item.user_number || item.real_name || "");
      const mappedWorkspace = workspacePolicyFor({
        user: {
          number: item.user_number || item.identifier,
          realName: item.real_name,
          department: item.department,
          center: item.center,
        },
        permissions: {manage_permissions: item.highest_business_access === true},
        access: { allowed_modules: item.effective_modules || (Array.isArray(item.modules) ? item.modules : []),
          configured: item.module_configured, access_mode: item.module_access_mode,
          workspace_profile: item.configured ? item : null },
      });
      const mappedScope = new Set(["department", "center", "personal"]).has(mappedWorkspace.dashboard_scope)
        ? mappedWorkspace.dashboard_scope
        : "personal";
      return {
        ...item, identifier,
        real_name: item.real_name || "",
        user_number: item.user_number || "",
        department: item.department || "",
        center: item.configured ? item.center : mappedWorkspace.center,
        dashboard_scope: mappedScope,
        role: mappedWorkspace.role,
        modules: mappedWorkspace.allowed_modules,
        editable: item.editable && !item.highest_business_access,
      };
    });
    sendJson(response, 200, { ...upstream.payload, items, total: items.length });
    return true;
  }

  const dashboardScopeMatch = url.pathname.match(/^\/api\/permissions\/workspace-profiles\/(.+)$/u);
  if (dashboardScopeMatch) {
    if (request.method !== "PUT") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.permissions?.manage_permissions) {
      sendJson(response, 403, { detail: "只有权限管理员可以配置看板数据范围" });
      return true;
    }
    let payload;
    try { payload = JSON.parse((await readBody(request, 16 * 1024)).toString("utf8") || "{}"); }
    catch {
      sendJson(response, 400, { detail: "请求内容格式不正确" });
      return true;
    }
    const identifier = decodeURIComponent(dashboardScopeMatch[1]);
    const result = await callAuthority(request, `/admin/workspace-profiles/${encodeURIComponent(identifier)}`,
      "PUT", Buffer.from(JSON.stringify(payload)));
    if (result.status === 200) clearSessionCache();
    sendJson(response, result.status, result.payload);
    return true;
  }
  if (url.pathname.startsWith("/api/permissions/dashboard-scopes")) {
    sendJson(response, 410, { detail: "旧看板范围已升级为角色与中心配置，请刷新页面后操作" });
    return true;
  }

  const launchMatch = url.pathname.match(/^\/api\/launch\/([a-z0-9-]+)$/u);
  if (launchMatch && (request.method === "GET" || request.method === "HEAD")) {
    const moduleKey = launchMatch[1];
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    if (!session.payload?.access?.allowed_modules?.includes(moduleKey)) {
      sendJson(response, 403, { detail: "当前账号未开通该界面权限" });
      return true;
    }
    const target = hubIntegratedMode && moduleKey !== "creative-radar"
      ? integratedLaunchTarget(moduleKey, process.env.HUB_EMBEDDED_MODULE_PATHS_JSON, process.env.HUB_PUBLIC_BASE_PATH || "/yxb/wis-marketing-hub/")
      : launchTargets[moduleKey];
    if (!target) {
      sendJson(response, 409, { detail: "该业务系统正在接入，正式地址配置后即可进入" });
      return true;
    }
    if (request.method === "HEAD") {
      response.writeHead(204, { "Cache-Control": "no-store", "X-Launch-Ready": "1" });
      response.end();
      return true;
    }
    response.writeHead(302, { "Cache-Control": "no-store", Location: target });
    response.end();
    return true;
  }

  const assistantRoutes = {
    "/api/assistant/status": { path: "/assistant/status", method: "GET", timeoutMs: 15_000 },
    "/api/assistant/chat": { path: "/assistant/chat", method: "POST", timeoutMs: 180_000 },
    "/api/assistant/insights": { path: "/assistant/insights", method: "GET", timeoutMs: 20_000 },
    "/api/assistant/insights/refresh": { path: "/assistant/insights/refresh", method: "POST", timeoutMs: 30_000 },
  };
  const assistantRoute = assistantRoutes[url.pathname];
  if (assistantRoute) {
    const expectedMethod = assistantRoute.method;
    if (request.method !== expectedMethod) {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    const assistantPreview = permissionPreviewFor(request, session.payload);
    const isSpecialist = session.payload?.workspace?.role === "specialist" || (assistantPreview.active && assistantPreview.scope === "personal");
    let body;
    if (expectedMethod === "POST" && url.pathname === "/api/assistant/chat") {
      try {
        body = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { detail: error instanceof Error ? error.message : "请求内容无效" });
        return true;
      }
    }
    if (isSpecialist && body?.length) {
      try {
        const chatPayload = JSON.parse(body.toString("utf8"));
        if (restrictedRoutineTextPattern.test(String(chatPayload.content || ""))) {
          sendJson(response, 403, { detail: "当前角色不开放人员例行时长信息" });
          return true;
        }
      } catch { /* malformed JSON is handled by the authority service */ }
    }
    const result = await callAuthority(
      request,
      assistantRoute.path,
      expectedMethod,
      body,
      assistantRoute.timeoutMs,
    );
    sendJson(response, result.status, isSpecialist ? stripSpecialistRoutineInformation(result.payload) : result.payload);
    return true;
  }

  const assistantContentMatch = url.pathname.match(/^\/api\/assistant\/attachments\/([a-f0-9-]+)\/content$/u);
  if (assistantContentMatch) {
    if (request.method !== "GET") {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    await relayAuthorityBinary(request, response, `/assistant/attachments/${assistantContentMatch[1]}/content`);
    return true;
  }

  const assistantDynamicRoutes = [
    { pattern: /^\/api\/assistant\/conversations$/u, methods: new Set(["GET", "POST"]) },
    { pattern: /^\/api\/assistant\/conversations\/[a-f0-9-]+$/u, methods: new Set(["PATCH", "DELETE"]) },
    { pattern: /^\/api\/assistant\/conversations\/[a-f0-9-]+\/messages$/u, methods: new Set(["GET"]) },
    { pattern: /^\/api\/assistant\/attachments$/u, methods: new Set(["POST"]) },
    { pattern: /^\/api\/assistant\/attachments\/[a-f0-9-]+$/u, methods: new Set(["DELETE"]) },
  ];
  const assistantDynamicRoute = assistantDynamicRoutes.find((item) => item.pattern.test(url.pathname));
  if (assistantDynamicRoute) {
    if (!assistantDynamicRoute.methods.has(request.method || "GET")) {
      sendJson(response, 405, { detail: "请求方式不支持" });
      return true;
    }
    const session = await currentSession(request);
    if (session.status !== 200) {
      sendJson(response, session.status, session.payload);
      return true;
    }
    let body;
    if (["POST", "PATCH"].includes(request.method || "")) {
      try {
        const limit = url.pathname === "/api/assistant/attachments" ? 18 * 1024 * 1024 : 256 * 1024;
        body = await readBody(request, limit);
      } catch (error) {
        sendJson(response, 413, { detail: error instanceof Error ? error.message : "请求内容无效" });
        return true;
      }
    }
    const authorityPath = `${url.pathname.replace(/^\/api/u, "")}${url.search}`;
    const result = await callAuthority(request, authorityPath, request.method, body, 180_000);
    const assistantPreview = permissionPreviewFor(request, session.payload);
    const isSpecialist = session.payload?.workspace?.role === "specialist" || (assistantPreview.active && assistantPreview.scope === "personal");
    sendJson(response, result.status, isSpecialist ? stripSpecialistRoutineInformation(result.payload) : result.payload);
    return true;
  }

  const proxy = permissionProxyRoute(url, request.method || "GET");
  if (proxy) {
    if (proxy.error) {
      sendJson(response, proxy.error, { detail: proxy.error === 405 ? "请求方式不支持" : "请求路径无效" });
      return true;
    }
    let body;
    if (["POST", "PUT", "PATCH"].includes(request.method || "")) {
      try {
        body = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { detail: error instanceof Error ? error.message : "请求内容无效" });
        return true;
      }
    }
    const result = await callAuthority(request, proxy.path, request.method, body);
    if (result.status >= 200 && result.status < 300 && request.method !== "GET") clearSessionCache();
    sendJson(response, result.status, result.payload);
    return true;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { detail: "接口不存在" });
    return true;
  }
  return false;
}

const sparkLibraryHandler = createSparkLibraryHandler({ root: join(dataRoot, 'spark-library'),
  currentSession, previewFor: permissionPreviewFor, sendJson, readJson: readTaskJsonBody });
const workflowStore = new WorkflowStore(taskCenterFile);
// This path must be the separate read-only mount checked by the deployment
// operator. An absent or legacy DATA_DIR path never authorizes a send.
const liveNextDayPermitFile = isolatedNextDayPermitPath(process.env);
const readLiveNextDayPermit = () => liveNextDayPermitFile?readNextDayReleasePermit(liveNextDayPermitFile):null;
const flowSources = new FlowSources();
let liveFeishuService=null;
const flowRuntime = new FlowRuntime(workflowStore, {people:()=>liveFeishuService?.people(flowSources.people())||flowSources.people(),canNotify:number=>flowNotifier.canQueue(number)});
const flowNotifier = new FlowFeishu(workflowStore, {people:()=>flowSources.people(),
  readNextDayPermit:readLiveNextDayPermit,releaseId:release,bootId:liveNextDayBootId,
  verifyLiveNoticeSource:notice=>currentOfficialNextDaySource(notice,{runtime:flowRuntime,liveSessions,notifier:flowNotifier,
    readReleasePermit:readLiveNextDayPermit,releaseId:release,bootId:liveNextDayBootId})});
const flowAccessFor = payload => {
  const user=taskCenterUser(payload), enabled=(payload.workspace?.is_brand_department===true||payload.permissions?.manage_permissions===true)&&!inactiveWorkflowMembers.has(user.number)&&['director','manager','specialist'].includes(user.role)&&payload.access?.allowed_modules?.includes('workflow-engine')===true;
  return configurationAccess({user,enabled,canManage:enabled&&['director','manager'].includes(user.role),department:enabled&&user.role==='director'&&payload.workspace?.dashboard_scope==='department',modules:payload.access?.allowed_modules||[]},readConfigurationGrants(join(dataRoot,'flow-configuration-grants.json')),{inactive:inactiveWorkflowMembers.has(user.number)});
};
const productionSources=process.env.FLOW_BUSINESS_SNAPSHOT?new ProductionSources(flowRuntime,flowSources,{file:process.env.FLOW_BUSINESS_SNAPSHOT,externalNumbers:(process.env.FLOW_EXTERNAL_COLLABORATOR_NUMBERS||'').split(',').filter(Boolean)}):null;
const flowBlueprints=new FlowBlueprints(flowRuntime);flowRuntime.blueprints=flowBlueprints;
const flowAutomation=new FlowAutomation(flowRuntime,flowSources);
const liveSessions=new LiveSessionFlow(flowRuntime,{enabled:process.env.FLOW_LIVE_SESSIONS_ENABLED==='true',readSchedule:process.env.FLOW_LIVE_OFFICIAL_SOURCE==='true'?createOfficialLiveScheduleReader({appId:process.env.FEISHU_APP_ID,appSecret:process.env.FEISHU_APP_SECRET}):process.env.HUB_INTEGRATED_MODE==='1'?createLiveScheduleReader({publicUrl:process.env.FLOW_PUBLIC_URL}):null});
const liveAutoDispatch=new LiveAutoDispatch(liveSessions,{enabled:process.env.FLOW_LIVE_AUTO_DISPATCH==='true'&&process.env.FLOW_LIVE_OFFICIAL_SOURCE==='true'});
const liveNextDayReminder=new LiveNextDayReminder({runtime:flowRuntime,liveSessions,notifier:flowNotifier,
  readReleasePermit:readLiveNextDayPermit,releaseId:release,bootId:liveNextDayBootId,
  enabled:process.env.FLOW_LIVE_NEXT_DAY_NOTIFICATIONS==='true'&&process.env.FLOW_LIVE_OFFICIAL_SOURCE==='true'});
const flowExecution=workflowExecutionPolicy();
liveFeishuService=new LiveFeishuService({runtime:flowRuntime,notifier:flowNotifier,liveSessions});
const flowHandler=createFlowHandler({runtime:flowRuntime,creative:productionSources?.creative,creativeStatus:()=>productionSources?.status()||{},localBusinessStatus:()=>productionSources?.business.status()||{},liveSessions,automation:flowAutomation,blueprints:flowBlueprints,sources:flowSources,notifier:flowNotifier,evidenceReader:new FlowEvidence({sources:flowSources,readCloud:callAuthority}),delivery:new FlowDelivery({runtime:flowRuntime,readCloud:callAuthority,root:join(dataRoot,'flow-deliveries')}),currentSession,accessFor:flowAccessFor,previewFor:permissionPreviewFor,readJson:readTaskJsonBody,sendJson,writesEnabled:flowExecution.writesEnabled,writeAccounts:flowExecution.writeAccounts});
const shutdown=createGracefulShutdown();
const sourceScheduler=startSourceScheduler({dataRoot,script:fileURLToPath(new URL('./server-source-refresh.mjs',import.meta.url)),enabled:process.env.SOURCE_SCHEDULER_ENABLED==='true'});
shutdown.onStop(()=>sourceScheduler.stop());
const refreshFlowSources=()=>shutdown.trackBackground('flow-source-refresh',async()=>{await flowSources.refresh();await waitForWorkerExit(flowSources.worker);}).catch(()=>console.error('Workflow source refresh pending; previous records retained'));
if (process.env.FLOW_SOURCE_REFRESH_ENABLED !== 'false') void refreshFlowSources();
const flowSourceTimer=process.env.FLOW_SOURCE_REFRESH_ENABLED === 'false' ? null : setInterval(()=>void refreshFlowSources(),30000);
flowSourceTimer?.unref();
let flowTickBusy=false;
const flowTickTimer=setInterval(()=>{if(flowTickBusy||shutdown.draining)return;flowTickBusy=true;void shutdown.trackBackground('flow-tick-and-notification-receipts',async()=>{try{if(flowExecution.backgroundEnabled){await productionSources?.sync();flowAutomation.reconcile();flowRuntime.tick();await flowNotifier.flush();}}catch{console.error('Workflow background pending; persisted events retained');}finally{flowTickBusy=false;}});},5000);flowTickTimer.unref();
// Keep Feishu source latency isolated from existing workflow notifications.
const liveDispatchTimer=setInterval(()=>{if(!shutdown.draining&&flowExecution.backgroundEnabled)void shutdown.trackBackground('live-auto-dispatch',()=>liveAutoDispatch.tick()).catch(()=>console.error('Live dispatch pending; existing work retained'));},30000);liveDispatchTimer.unref();
shutdown.onStop(()=>clearInterval(liveDispatchTimer));
const liveNextDayTimer=setInterval(()=>{if(!shutdown.draining&&flowExecution.backgroundEnabled)void shutdown.trackBackground('live-next-day-reminder',()=>liveNextDayReminder.tick()).catch(()=>console.error('Live next-day reminder pending; existing work retained'));},30000);liveNextDayTimer.unref();
shutdown.onStop(()=>clearInterval(liveNextDayTimer));
const liveCardTimer=setInterval(()=>{if(!shutdown.draining)void shutdown.trackBackground('live-feishu-card-receipts',()=>flowExecution.backgroundEnabled?liveFeishuService.tick():liveFeishuService.refreshIdentities()).catch(()=>console.error('Live Feishu verification pending; no broad access granted'));},2000);liveCardTimer.unref();
shutdown.onStop(()=>{clearInterval(liveCardTimer);liveFeishuService.stop();});
shutdown.onStop(()=>{clearInterval(flowSourceTimer);clearInterval(flowTickTimer);});
const workflowEngine = new TaskWorkflow(workflowStore, { resolveAssignees: taskCenterResolveAssignees, saveVideo: taskCenterSaveVideo });
const workflowAssistant = new WorkflowAssistant(workflowStore, { provider: configuredProvider(), model: process.env.WORKFLOW_AI_MODEL || 'not-configured' });
const workflowHandler = createWorkflowHandler({ engine: workflowEngine, assistant: workflowAssistant, cloudReader: new WorkflowCloudReader(workflowEngine,callAuthority),
  currentSession, accessFor: taskCenterAccess, previewFor: permissionPreviewFor, readBody, readJson: readTaskJsonBody,
  sendJson, assignees: taskCenterAssignees, principals: JSON.parse(process.env.WORKFLOW_ADAPTERS_JSON || '[]'), writesEnabled: flowExecution.legacyWritesEnabled });

const server=createServer(shutdown.wrapHandler(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, app: "wis-marketing-hub", release, fingerprint,
      liveNextDayInstance:liveNextDayBootId });
    return;
  }

  try { if (await handleApi(request, response, url)) return; }
  catch {
    if (!response.headersSent && !response.destroyed) sendJson(response,503,{detail:'请求暂未完成，请刷新核对；原有任务和素材不会因此删除'});
    else response.end();
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, HEAD");
    response.end("Method Not Allowed");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    response.statusCode = 400;
    response.end("Bad Request");
    return;
  }
  const relativePath = normalize(decodedPath).replace(/^([/\\])+/u, "");
  let candidate = resolve(join(root, relativePath || "index.html"));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate=join(candidate,'index.html');
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(request, response, candidate);
    return;
  }

  sendFile(request, response, join(root, "index.html"));
}));
shutdown.attachServer(server);shutdown.installSignals();
server.listen(port, process.env.BIND_ADDRESS || "0.0.0.0", () => {
  console.log(`wis-marketing-hub listening on ${port}`);
});
