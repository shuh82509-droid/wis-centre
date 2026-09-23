import { createServer } from "node:http";

const port = Number(process.env.MOCK_AUTHORITY_PORT || 4311);
const role = String(process.env.MOCK_ROLE || "specialist");
const allModules = ["data-dashboard", "creative-hub", "creative-radar", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"];

function sessionForRole() {
  if (role === "director") return {
    user: { number: "FD-026222", realName: "舒豪", department: "品牌营销部", center: "AI营销中心", jobTitle: "见习总监" },
    permissions: { super_admin: true, operation_admin: true, manage_permissions: true },
    access: { master_access: true, access_mode: "all", allowed_modules: allModules, modules: [] },
  };
  if (role === "manager") return {
    user: { number: "FD-022896", realName: "吴为", department: "品牌营销部", center: "AI营销中心", jobTitle: "营销高级经理" },
    permissions: { super_admin: false, operation_admin: false, manage_permissions: false },
    access: { master_access: true, access_mode: "all", allowed_modules: allModules, modules: [] },
  };
  if (role === "ai-specialist") return {
    user: { number: "FD-QA-AI-001", realName: "AI中心专员验收账号", department: "品牌营销部", center: "AI营销中心", jobTitle: "营销专员" },
    permissions: { super_admin: false, operation_admin: false, manage_permissions: false },
    access: { master_access: true, access_mode: "selected", allowed_modules: ["creative-radar", "ai-first-creation", "material-workbench", "cloud-manager"], modules: [] },
  };
  return {
    user: { number: "FD-QA-001", realName: "专员验收账号", department: "品牌营销部", center: "营销中心B", jobTitle: "营销专员" },
    permissions: { super_admin: false, operation_admin: false, manage_permissions: false },
    access: { master_access: true, access_mode: "all", allowed_modules: allModules, modules: [] },
  };
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

createServer((request, response) => {
  if (request.url === "/central-auth/me") return send(response, 200, sessionForRole());
  if (request.url?.startsWith("/omnichannel/realtime-comparison")) return send(response, 200, {
    generatedAt: "2026-08-29T10:30:00+08:00",
    timezone: "Asia/Shanghai",
    channels: [
      { key: "douyin", label: "抖店", todayTotalYuan: 136000, points: [], spendBreakdown: [], unavailableReason: null },
      { key: "wechat", label: "视频号", todayTotalYuan: 486000, points: [], spendBreakdown: [], unavailableReason: null },
    ],
  });
  return send(response, 404, { detail: "local visual QA source not implemented" });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock role authority (${role}) listening on ${port}`);
});
