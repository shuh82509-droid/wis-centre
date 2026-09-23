import type { AdminGrant, AssistantAttachment, AssistantConversation, AssistantMessage, AssistantResponse, AssistantStatus, BusinessIntelligenceOverview, CreativeIncentiveDirection, CreativeIncentiveMilestone, CreativeIncentiveOverview, DashboardScope, DashboardScopeGrant, HubSession, LibTvCreditAuthStatus, LibTvCreditTrend, LoginGrant, LongTermWorkSchedulerStatus, ModuleAccessGrant, OperationLog, OptimizationResponse, OrganizationDashboardOverview, PermissionPreview, PermissionPreviewSubject, TaskCenterItem, TaskCenterOverview, TaskCenterSourceKind, TaskCenterStatus, WorkspaceHomeSummary } from "./types";

import type {OrganizationEntries} from './OrganizationEntryControl';

export class ApiError extends Error {
  constructor(message: string, public status: number, public payload?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...(options?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.detail === "string"
      ? payload.detail
      : typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `请求未完成（${response.status}）`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}

const transientStatuses = new Set([302, 408, 425, 429, 502, 503, 504]);

export function isTransientApiError(error: unknown) {
  return !(error instanceof ApiError) || transientStatuses.has(error.status);
}

function isHubSession(value: unknown): value is HubSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  if (!session.user || typeof session.user !== "object") return false;
  if (!session.permissions || typeof session.permissions !== "object") return false;
  if (!session.workspace || typeof session.workspace !== "object") return false;
  if (!session.access || typeof session.access !== "object") return false;
  const access = session.access as Record<string, unknown>;
  return Array.isArray(access.allowed_modules) && Array.isArray(access.modules);
}

async function requestWithRetry<T>(path: string, options?: RequestInit): Promise<T> {
  const delays = [300, 900, 1_800];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request<T>(path, options);
    } catch (error) {
      if (!isTransientApiError(error) || attempt >= delays.length) throw error;
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, delays[attempt]));
    }
  }
}

type CacheEntry = { expiresAt: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inflightGets = new Map<string, Promise<unknown>>();
let responseCacheEpoch = 0;

function invalidateCache(...prefixes: string[]) {
  responseCacheEpoch += 1;
  for (const key of responseCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) responseCache.delete(key);
  }
  for (const key of inflightGets.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) inflightGets.delete(key);
  }
}

async function cachedGet<T>(path: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > now) return cached.value as T;
  const pending = inflightGets.get(path);
  if (pending) return pending as Promise<T>;
  const epoch = responseCacheEpoch;
  const promise = request<T>(path)
    .then((value) => {
      if (epoch === responseCacheEpoch) responseCache.set(path, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => { if (inflightGets.get(path) === promise) inflightGets.delete(path); });
  inflightGets.set(path, promise);
  return promise;
}

async function mutate<T>(path: string, options: RequestInit, ...invalidatePrefixes: string[]) {
  try { return await request<T>(path, options); }
  finally { invalidateCache(...invalidatePrefixes); }
}

export const api = {
  hubLogin: (username: string, password: string, captcha = "") => request<{ user: unknown }>("api/hub-auth/login", {
    method: "POST", body: JSON.stringify({ username, password, captcha }),
  }),
  hubCaptcha: (username: string) => request<{ ok: boolean; message: string }>("api/hub-auth/captcha", {
    method: "POST", body: JSON.stringify({ username }),
  }),
  hubLogout: () => mutate<{ ok: boolean }>("api/hub-auth/logout", {
    method: "POST", body: JSON.stringify({}),
  }, "api/"),
  organizationEntries: () => request<OrganizationEntries>('api/permissions/organization-entry'),
  organizationEntryUpdate: (identifiers: string[], enabled: boolean, version: number) => mutate<OrganizationEntries>(
    'api/permissions/organization-entry', {method: 'PUT', body: JSON.stringify({identifiers, enabled, version})},
    'api/permission-preview', 'api/organization-dashboard',
  ),
  session: async () => {
    const value = await requestWithRetry<unknown>("api/session");
    if (!isHubSession(value)) throw new ApiError("登录态响应异常，请刷新或重试。", 502, value);
    return value;
  },
  workspaceSummary: () => requestWithRetry<WorkspaceHomeSummary>("api/workspace-home/summary"),
  taskCenter: () => requestWithRetry<TaskCenterOverview>("api/task-center/overview"),
  loginGrants: (q = "") => cachedGet<{ items: LoginGrant[]; total: number }>(`api/permissions/login?q=${encodeURIComponent(q)}`, 15_000),
  loginGrantCreate: (realName: string, department = "", center = "") => mutate<LoginGrant>("api/permissions/login", {
    method: "POST",
    body: JSON.stringify({ real_name: realName, department, center }),
  }, "api/permissions/login", "api/permissions/modules"),
  loginGrantRevoke: (identifier: string) => mutate<LoginGrant>(`api/permissions/login/${encodeURIComponent(identifier)}`, { method: "DELETE" }, "api/permissions/login", "api/permissions/modules"),
  adminGrants: (q = "") => cachedGet<{ items: AdminGrant[]; total: number }>(`api/permissions/admins?q=${encodeURIComponent(q)}`, 15_000),
  adminGrantCreate: (realName: string, department = "", center = "") => mutate<AdminGrant>("api/permissions/admins", {
    method: "POST",
    body: JSON.stringify({ real_name: realName, department, center }),
  }, "api/permissions/admins"),
  adminGrantRevoke: (identifier: string) => mutate<AdminGrant>(`api/permissions/admins/${encodeURIComponent(identifier)}`, { method: "DELETE" }, "api/permissions/admins"),
  permissionManagers: (q = "") => cachedGet<{ items: AdminGrant[]; total: number }>(`api/permissions/managers?q=${encodeURIComponent(q)}`, 15_000),
  permissionManagerCreate: (realName: string, department = "", center = "") => mutate<AdminGrant>("api/permissions/managers", {
    method: "POST",
    body: JSON.stringify({ real_name: realName, department, center }),
  }, "api/permissions/", "api/permission-preview"),
  permissionManagerRevoke: (identifier: string) => mutate<AdminGrant>(`api/permissions/managers/${encodeURIComponent(identifier)}`, { method: "DELETE" }, "api/permissions/", "api/permission-preview"),
  moduleAccess: (q = "") => cachedGet<{
    items: ModuleAccessGrant[];
    total: number;
    modules: Array<{ key: string; label: string; purpose: string }>;
    default_mode: "all";
  }>(`api/permissions/modules?q=${encodeURIComponent(q)}`, 15_000),
  moduleAccessUpdate: (identifier: string, accessMode: "all" | "selected", selected: string[]) => mutate<ModuleAccessGrant>(
    `api/permissions/modules/${encodeURIComponent(identifier)}`,
    { method: "PUT", body: JSON.stringify({ access_mode: accessMode, modules: selected }) },
    "api/permissions/modules", "api/permissions/workspace-profiles", "api/permission-preview",
  ),
  moduleAccessBatchUpdate: (identifiers: string[], accessMode: "all" | "selected", selected: string[]) => mutate<{ items: ModuleAccessGrant[]; updated: number }>(
    "api/permissions/modules/batch",
    { method: "POST", body: JSON.stringify({ identifiers, access_mode: accessMode, modules: selected }) },
    "api/permissions/modules", "api/permissions/workspace-profiles", "api/permission-preview",
  ),
  assistantStatus: async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try { return await request<AssistantStatus>("api/assistant/status", { cache: "no-store", signal: controller.signal }); }
    finally { window.clearTimeout(timer); }
  },
  assistantConversations: (q = "") => cachedGet<{ items: AssistantConversation[]; total: number }>(`api/assistant/conversations?q=${encodeURIComponent(q)}`, 5_000),
  assistantConversationCreate: (title = "新会话") => mutate<AssistantConversation>("api/assistant/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  }, "api/assistant/conversations"),
  assistantConversationUpdate: (id: string, title: string) => mutate<AssistantConversation>(`api/assistant/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  }, "api/assistant/conversations"),
  assistantConversationDelete: (id: string) => mutate<{ deleted: boolean; id: string }>(`api/assistant/conversations/${id}`, { method: "DELETE" }, "api/assistant/conversations"),
  assistantMessages: (id: string) => request<{ conversation: AssistantConversation; items: AssistantMessage[] }>(`api/assistant/conversations/${id}/messages`),
  assistantAttachmentUpload: (conversationId: string, filename: string, mimeType: string, dataBase64: string) => request<AssistantAttachment>("api/assistant/attachments", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, filename, mime_type: mimeType, data_base64: dataBase64 }),
  }),
  assistantAttachmentDelete: (id: string) => request<{ deleted: boolean; id: string }>(`api/assistant/attachments/${id}`, { method: "DELETE" }),
  assistantChat: (payload: { conversation_id: string; content?: string; attachment_ids?: string[]; reuse_last_user_message?: boolean; current_view?: string }) => request<AssistantResponse>(
    "api/assistant/chat",
    { method: "POST", body: JSON.stringify(payload) },
  ),
  assistantInsights: () => cachedGet<OptimizationResponse>("api/assistant/insights", 30_000),
  assistantInsightsRefresh: () => mutate<OptimizationResponse>("api/assistant/insights/refresh", { method: "POST" }, "api/assistant/insights"),
  businessIntelligence: (date: string, days = 7) => cachedGet<BusinessIntelligenceOverview>(
    `api/business-intelligence/overview?date=${encodeURIComponent(date)}&days=${days}`,
    60_000,
  ),
  creativeIncentives: () => cachedGet<CreativeIncentiveOverview>("api/creative-incentives/overview", 15_000),
  creativeIncentiveCreate: (payload: {
    direction_name: string;
    material_id: string;
    material_name?: string;
    creator_name?: string;
    center?: string;
    online_date: string;
    originality_note?: string;
    copy_judgement?: string;
    visual_judgement?: string;
    voice_judgement?: string;
    remix_plan?: string;
    reference_url?: string;
  }) => mutate<CreativeIncentiveDirection>(
    "api/creative-incentives/directions",
    { method: "POST", body: JSON.stringify(payload) },
    "api/creative-incentives/overview",
  ),
  creativeIncentiveConfirm: (id: string, confirmed = true, note = "") => mutate<CreativeIncentiveDirection>(
    `api/creative-incentives/directions/${encodeURIComponent(id)}/originality`,
    { method: "PATCH", body: JSON.stringify({ confirmed, note }) },
    "api/creative-incentives/overview",
  ),
  creativeIncentiveSync: (date: string, force = false) => mutate<CreativeIncentiveOverview>(
    `api/creative-incentives/sync?date=${encodeURIComponent(date)}&force=${force ? "true" : "false"}`,
    { method: "POST" },
    "api/creative-incentives/overview",
  ),
  creativeIncentivePublish: (id: string, mode: "feishu" | "manual") => mutate<CreativeIncentiveMilestone>(
    `api/creative-incentives/milestones/${encodeURIComponent(id)}/publish`,
    { method: "POST", body: JSON.stringify({ mode }) },
    "api/creative-incentives/overview",
  ),
  organizationDashboard: (date: string, days = 7, preview?: PermissionPreview | null, force = false) => {
    const params = new URLSearchParams({ date, days: String(days) });
    if (force) params.set("refresh", "1");
    params.set("preview_scope", preview?.active ? preview.scope : "real");
    if (preview?.active && preview.scope === "center") params.set("preview_center", preview.center);
    if (preview?.active && preview.person) params.set("preview_person", preview.person);
    params.set("preview_version", preview?.updatedAt || "real");
    // The server returns a fast partial shell first and fills slow root-data
    // sources in the background. Do not pin that partial response in the
    // browser cache; repeated reads progressively become richer.
    return request<OrganizationDashboardOverview>(`api/organization-dashboard/overview?${params.toString()}`);
  },
  libtvCredits: (days: 7 | 30 | 90, preview?: PermissionPreview | null, force = false) => {
    const params = new URLSearchParams({ days: String(days), refresh: force ? "1" : "0" });
    params.set("preview_scope", preview?.active ? preview.scope : "real");
    if (preview?.active && preview.scope === "center") params.set("preview_center", preview.center);
    if (preview?.active && preview.person) params.set("preview_person", preview.person);
    params.set("preview_version", preview?.updatedAt || "real");
    return request<LibTvCreditTrend>(`api/organization-dashboard/libtv-credits?${params.toString()}`);
  },
  libtvCreditAuth: () => request<LibTvCreditAuthStatus>("api/organization-dashboard/libtv-credits/auth"),
  libtvCreditLoginSend: (phone: string) => request<LibTvCreditAuthStatus>("api/organization-dashboard/libtv-credits/login/send", {
    method: "POST",
    body: JSON.stringify({ phone }),
  }),
  libtvCreditLoginVerify: (phone: string, code: string) => mutate<LibTvCreditAuthStatus>(
    "api/organization-dashboard/libtv-credits/login/verify",
    { method: "POST", body: JSON.stringify({ phone, code }) },
    "api/organization-dashboard/libtv-credits",
  ),
  libtvCreditLogout: () => mutate<LibTvCreditAuthStatus>(
    "api/organization-dashboard/libtv-credits/logout",
    { method: "POST" },
    "api/organization-dashboard/libtv-credits",
  ),
  longTermWorkScheduler: (requestId?: string) => request<LongTermWorkSchedulerStatus>(
    `api/organization-dashboard/long-term-work/scheduler${requestId ? `?request_id=${encodeURIComponent(requestId)}` : ""}`,
    { signal: AbortSignal.timeout(10_000) },
  ),
  longTermWorkSnapshot: (preview?: PermissionPreview | null) => {
    const params = new URLSearchParams({ preview_scope: preview?.active ? preview.scope : "real", preview_version: preview?.updatedAt || "real" });
    if (preview?.active && preview.scope === "center") params.set("preview_center", preview.center);
    if (preview?.active && preview.person) params.set("preview_person", preview.person);
    return request<NonNullable<OrganizationDashboardOverview["longTermWork"]>>(
      `api/organization-dashboard/long-term-work?${params}`, { signal: AbortSignal.timeout(10_000) },
    );
  },
  longTermWorkSchedulerUpdate: (enabled: boolean, hour: number, minute: number) => mutate<LongTermWorkSchedulerStatus>(
    "api/organization-dashboard/long-term-work/scheduler",
    { method: "PUT", body: JSON.stringify({ enabled, hour, minute }) },
    "api/organization-dashboard/long-term-work/scheduler",
    "api/organization-dashboard/overview",
  ),
  longTermWorkSchedulerRun: (requestId: string) => mutate<LongTermWorkSchedulerStatus>(
    "api/organization-dashboard/long-term-work/scheduler/run",
    { method: "POST", body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(15_000) },
    "api/organization-dashboard/long-term-work/scheduler",
    "api/organization-dashboard/overview",
  ),
  permissionPreview: () => request<PermissionPreview>("api/permission-preview"),
  permissionPreviewCandidates: (q = "") => cachedGet<{ items: PermissionPreviewSubject[]; total: number }>(
    `api/permission-preview/candidates?q=${encodeURIComponent(q)}`,
    60_000,
  ),
  permissionPreviewUpdate: (scope: DashboardScope | "real", center = "", person = "") => mutate<PermissionPreview>(
    "api/permission-preview",
    { method: "PUT", body: JSON.stringify({ scope, center, person }) },
    "api/organization-dashboard/overview",
    "api/operation-logs",
  ),
  dashboardScopeGrants: (q = "") => cachedGet<{ items: DashboardScopeGrant[]; total: number; centers: string[]; catalog: Array<{key: string; label: string}> }>(
    `api/permissions/workspace-profiles?q=${encodeURIComponent(q)}`,
    0,
  ),
  dashboardScopeUpdate: (identifier: string, value: {role: string; center: string; modules: string[]; version: number}) => mutate<DashboardScopeGrant>(
    `api/permissions/workspace-profiles/${encodeURIComponent(identifier)}`,
    { method: "PUT", body: JSON.stringify(value) },
    "api/permissions/workspace-profiles", "api/permissions/modules", "api/session", "api/permission-preview",
  ),
  warmLaunch: (moduleId: string) => fetch(`api/launch/${encodeURIComponent(moduleId)}`, {
    method: "HEAD",
    credentials: "same-origin",
    cache: "no-store",
  }).then(() => undefined).catch(() => undefined),
  operationLogs: (filters: {
    q?: string;
    module?: string;
    result?: "" | "success" | "failed";
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const params = new URLSearchParams({
      q: filters.q || "",
      module: filters.module || "",
      result: filters.result || "",
      page: String(filters.page || 1),
      page_size: String(filters.pageSize || 20),
    });
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    return request<{ items: OperationLog[]; total: number; page: number; page_size: number; total_pages: number; modules: string[] }>(`api/operation-logs?${params}`);
  },
};
