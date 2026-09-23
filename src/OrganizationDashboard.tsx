import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwiseRegular, BotRegular, CheckmarkCircleFilled, DataBarVerticalRegular, PeopleRegular, PulseRegular, WarningRegular } from "@fluentui/react-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { OmnichannelRealtime } from "./OmnichannelRealtime";
import { LibTvCreditTrendPanel } from "./LibTvCreditTrendPanel";
import { sourceTime } from "./sourceTime";
import { isOfficialMaterial } from "./materialMetrics";
import { observeWorkRequest, workIsActive, workStatusLabel, workSubmissionRejected } from "./longTermWorkState";
import { workSourceSummary } from "./longTermWorkScope";
import type { DashboardScope, HubSession, LongTermWorkSchedulerStatus, OrganizationDashboardOverview, PermissionPreview } from "./types";
import "./organization-dashboard.css";
import "./organization-dashboard-performance.css";
import "./organization-dashboard-enhancements.css";
import "./organization-structure.css";

const scopeLabels: Record<DashboardScope, { title: string; note: string }> = {
  department: { title: "总监级", note: "品牌营销部全局" },
  center: { title: "主管级", note: "所负责中心" },
  personal: { title: "专员级", note: "仅本人" },
};

const sourceStateLabels = {
  ready: "已接入",
  partial: "部分接入",
  pending: "待接入",
  stale: "快照数据",
};

function shanghaiDate(daysAgo = 0) {
  const value = new Date(Date.now() - daysAgo * 86400000);
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "待核验";
  if (Math.abs(value) >= 10000) return `¥${(value / 10000).toFixed(1)}万`;
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
}

function rate(value: number | null | undefined) {
  return value === null || value === undefined ? "待核验" : `${(value * 100).toFixed(1)}%`;
}

function hours(value: number | null | undefined) {
  return value === null || value === undefined ? "待核验" : `${value.toFixed(2)} 小时`;
}

function MetricCard({ label, value, note, state = "ready" }: { label: string; value: string | number; note: string; state?: "ready" | "pending" | "warning" }) {
  return <article className={`org-metric-card is-${state}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function TimesheetBlock({ dashboard }: { dashboard: OrganizationDashboardOverview["memberDashboard"] }) {
  const summary = dashboard?.summary;
  const source = dashboard?.source;
  const available = summary?.averageEffectiveHours !== null && summary?.averageEffectiveHours !== undefined;
  return <article className={`org-timesheet-block ${available ? "is-ready" : "is-pending"}`}>
    <span><i />飞书 Base · {source?.timesheetMonth || "工时月份待核验"}</span>
    <strong>工时结构<b>{hours(summary?.averageEffectiveHours)}</b></strong>
    <div><span>平均出勤 <b>{hours(summary?.averageAttendanceHours)}</b></span><span>平均排班 <b>{summary?.averageScheduledDays ?? "待核验"} 天</b></span><span>平均打卡 <b>{summary?.averagePunchDays ?? "待核验"} 天</b></span></div>
    <em>{available ? `${summary?.timesheetMappedMembers} 人已匹配 · ${source?.timesheetMode === "live" ? "实时同步" : "已核验快照"}` : source?.timesheetNote || "待接入真实数据"}</em>
  </article>;
}

function InferenceBlock({ title, score, description, coverage }: { title: string; score: number | null; description: string; coverage: string }) {
  return <article className={`org-inference-block ${score === null ? "is-pending" : ""}`}>
    <span><i />会议事实与可解释信号</span>
    <strong>{title}<b>{score === null ? "缺评分依据" : `${score}/100`}</b></strong>
    <p>{description}</p>
    <em>{coverage}</em>
  </article>;
}

function scoreText(value: number | null | undefined) {
  return value === null || value === undefined ? "缺评分依据" : `${value}/100`;
}

function DailySourceStatus({ data }: { data: OrganizationDashboardOverview | null }) {
  const refresh = data?.sourceRefresh;
  const labels = { organization: "组织资料", reportingDirectory: "日报目录", meetingEvidence: "会议记录", meetingIntelligence: "会议原文与信号" } as const;
  return <section className="org-structure-card" aria-label="每日来源读取状态">
    <header><div><span>DAILY SOURCE READBACK</span><h2>每日资料更新</h2><p>采集时间与业务日期分开记录。读取目录不代表日报已完成；会议条数不等于绩效或工作饱和度。</p></div><small>{refresh?.scheduler ? "下次计划读取：" + sourceTime(refresh.scheduler.nextDueAt) : "尚无每日调度执行记录"}</small></header>
    <div className="org-source-strip">{Object.entries(labels).map(([key, label]) => {
      const source = refresh?.sources[key as keyof typeof labels];
      return <article key={key} className={"is-" + (source?.state || "pending")}><i /><span><strong>{label}</strong>
        <small>最近尝试 {sourceTime(source?.lastAttemptAt)} · 最近成功 {sourceTime(source?.lastSuccessAt)}</small>
        <small>事实日期：{source?.factsDate || (key.startsWith("meeting") ? "尚无已核验业务日期" : "参考资料，无业务完成日期")}{source?.requiredBusinessDate ? " · 所选 " + source.requiredBusinessDate : ""}</small>
        <small>{source?.error || source?.note || "尚无可核验每日读取记录；旧资料保留原日期"}</small>
      </span><em>{sourceStateLabels[source?.state || "pending"]}</em></article>;
    })}</div>
    <footer><WarningRegular /><span>{refresh?.scheduler ? "这里展示实际登记的下一次计划及读取回执；超过计划时间未成功会标为旧快照。" : "待采集任务登记执行状态后，再展示每日运行记录。"} 失败时保留最近成功资料，缺失不补 0。</span></footer>
  </section>;
}

function sourceResponsibility(key: string) {
  if (key === "root-data") return "成交额、订单、ROI、单品 · 全角色共享";
  if (key === "oa") return "身份、组织已接；KPI目标待接";
  if (key === "timesheet") return "平均有效工时、出勤、排班与打卡 · 按角色范围";
  if (key === "organization") return "组织层级、中心目录、范围参考";
  if (key === "daily-reports") return "中心固定日报、负责人和现有经营入口";
  if (key === "materials") return "抖店素材上线、视频号内容发布 · 根数据完整日";
  if (key === "people") return "权限范围内成员目录、个人素材数与成交额";
  if (key === "meetings") return "会议主题、中心、纪要、归档与当日覆盖";
  if (key === "work") return "长期工作、负责人、周期、验收口径与来源链接";
  return "活力、热力与饱和度会议信号；缺失不评分";
}

function compactDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}.${Number(day)}`;
}

function utcDay(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function dayDistance(start: string, end: string) {
  return Math.round((utcDay(end).getTime() - utcDay(start).getTime()) / 86400000);
}

function plusDays(value: string, days: number) {
  const date = utcDay(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function countText(value: number | null | undefined) {
  return value === null || value === undefined ? "待回补" : `${value} 条`;
}

function SituationAnalysis({ perspective, title, items, state = "attention" }: { perspective: string; title: string; items: string[]; state?: "ready" | "attention" | "pending" }) {
  return <section className={`org-situation-analysis is-${state}`}>
    <div><span>SITUATION ANALYSIS</span><strong>{title}</strong><small>{perspective}</small></div>
    <ol>{items.map((item, index) => <li key={`${index}-${item}`}><b>{String(index + 1).padStart(2, "0")}</b><span>{item}</span></li>)}</ol>
  </section>;
}

function ListPagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(safePage * pageSize, total);
  return <nav className="org-list-pagination" aria-label="列表分页">
    <span>{start}–{end} / {total}</span>
    <button type="button" disabled={safePage <= 1} onClick={() => onChange(safePage - 1)}>上一页</button>
    <b>第 {safePage} / {pageCount} 页</b>
    <button type="button" disabled={safePage >= pageCount} onClick={() => onChange(safePage + 1)}>下一页</button>
  </nav>;
}

export function OrganizationDashboardPage({ session, preview, entryScrollTop = null, onAsk }: { session: HubSession; preview?: PermissionPreview | null; entryScrollTop?: number | null; onAsk: (prompt: string) => void }) {
  const yesterday = useMemo(() => shanghaiDate(1), []);
  const [selectedDate, setSelectedDate] = useState(yesterday);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<OrganizationDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [realtimeRefreshing, setRealtimeRefreshing] = useState(false);
  const [realtimeRefreshError, setRealtimeRefreshError] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [heatmapQuery, setHeatmapQuery] = useState("");
  const [heatmapPage, setHeatmapPage] = useState(1);
  const [workScheduler, setWorkScheduler] = useState<LongTermWorkSchedulerStatus | null>(null);
  const [workSchedulerBusy, setWorkSchedulerBusy] = useState(false);
  const [workSchedulerError, setWorkSchedulerError] = useState("");
  const [workRequestId, setWorkRequestId] = useState("");
  const [workCheckEpoch, setWorkCheckEpoch] = useState(0);
  const [workChecking, setWorkChecking] = useState(false);
  const workStorageKey = `wis-long-work-request:${session.user.number || session.user.userId || session.user.id || "current"}`;
  const hasRestoredEntryScroll = useRef(false);
  const requestSequence = useRef(0);
  const queryKey = JSON.stringify([selectedDate, days, preview?.updatedAt]);
  const activeQuery = useRef(queryKey);
  activeQuery.current = queryKey;

  useLayoutEffect(() => {
    if (entryScrollTop === null || hasRestoredEntryScroll.current) return;
    window.scrollTo({ top: entryScrollTop, left: 0, behavior: "auto" });
    if (loading) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: entryScrollTop, left: 0, behavior: "auto" });
      hasRestoredEntryScroll.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entryScrollTop, loading]);

  const load = async (date = selectedDate, range = days) => {
    const key = JSON.stringify([date, range, preview?.updatedAt]);
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await api.organizationDashboard(date, range, preview);
      if (activeQuery.current === key && requestSequence.current === sequence) setData(next);
    }
    catch (cause) { if (activeQuery.current === key && requestSequence.current === sequence) setError(cause instanceof ApiError ? cause.message : "组织经营数据读取失败"); }
    finally { if (activeQuery.current === key && requestSequence.current === sequence) setLoading(false); }
  };
  useEffect(() => {
    if (selectedDate) void load(selectedDate, days);
    return () => { requestSequence.current += 1; };
  }, [selectedDate, days, preview?.updatedAt]);
  useEffect(() => {
    if (!data?.refresh || data.refresh.complete || !data.refresh.pendingSources.length) return;
    let cancelled = false;
    let timer = 0;
    const interval = Math.max(1_200, Math.min(5_000, data.refresh.pollAfterMs || 1_200));
    const poll = async () => {
      try {
        const next = await api.organizationDashboard(selectedDate, days, preview);
        if (!cancelled && activeQuery.current === queryKey) setData(next);
      } catch {
        // Keep the already rendered facts available and retry the background
        // status check. A transient poll failure must not blank the dashboard.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), interval);
      }
    };
    timer = window.setTimeout(() => void poll(), interval);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [Boolean(data?.refresh && !data.refresh.complete && data.refresh.pendingSources.length), data?.refresh?.pollAfterMs, selectedDate, days, preview?.updatedAt]);
  useEffect(() => {
    if (!session.permissions.operation_admin) return;
    let cancelled = false;
    try { setWorkRequestId(sessionStorage.getItem(workStorageKey) || ""); } catch { /* memory state still protects this page */ }
    void api.longTermWorkScheduler().then((next) => {
      if (cancelled) return;
      setWorkScheduler(next);
      const pending = next.requestPending || (workIsActive(next) ? next.run?.lastRequestId : "");
      if (pending) setWorkRequestId((current) => current || pending);
    }).catch((cause) => {
      if (!cancelled) setWorkSchedulerError(cause instanceof ApiError ? cause.message : "定时刷新状态读取失败");
    });
    return () => { cancelled = true; };
  }, [session.permissions.operation_admin, workStorageKey]);
  useEffect(() => {
    if (!workRequestId || !session.permissions.operation_admin) return;
    let cancelled = false;
    setWorkChecking(true);
    void observeWorkRequest({
      requestId: workRequestId, read: api.longTermWorkScheduler,
      onStatus: setWorkScheduler, cancelled: () => cancelled,
      delay: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
    }).then(async (result) => {
      if (cancelled) return;
      if (!result) {
        setWorkSchedulerError("本次自动核对已结束；请核对原请求状态。没有重复发起读取或模型提炼。");
        return;
      }
      // The server has durably identified this request and it is no longer active.
      try { sessionStorage.removeItem(workStorageKey); } catch { /* no submission follows from storage failure */ }
      setWorkSchedulerError("");
      if (result.status === "ready") {
        try {
          const latest = await api.longTermWorkSnapshot(preview);
          if (!cancelled) setData((current) => current ? { ...current, longTermWork: latest } : current);
        } catch { if (!cancelled) setWorkSchedulerError("刷新已完成，最新事项读取失败；当前保留原快照，可再次核对状态。"); }
      }
      if (!cancelled) { setWorkChecking(false); setWorkRequestId(""); }
    }).finally(() => { if (!cancelled) setWorkChecking(false); });
    return () => { cancelled = true; };
  }, [workRequestId, workCheckEpoch, workStorageKey, session.permissions.operation_admin, preview?.updatedAt]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api.organizationDashboard(selectedDate, days, preview).then((next) => {
        if (!cancelled && activeQuery.current === queryKey) setData(next);
      }).catch(() => undefined);
    }, 300_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedDate, days, preview?.updatedAt]);

  const scope = data?.access.scope || (session.permissions.manage_permissions ? "department" : "personal");
  const showTimesheet = scope !== "personal";
  const business = data?.business;
  const actualDate = business?.query.productDate || "待回补";
  const realtimeDate = data?.omnichannelRealtime?.channels.map(channel => channel.todayDate).filter(Boolean);
  const realtimeDateLabel = realtimeDate?.length && new Set(realtimeDate).size === 1 ? realtimeDate[0] : "日期待核验";
  const products = business?.products || [];
  const wechatProducts = business?.wechatProducts || [];
  const maxProduct = Math.max(...products.map((item) => item.effectiveSalesYuan), 1);
  const maxWechatProduct = Math.max(...wechatProducts.map((item) => item.effectiveSalesYuan), 1);
  const meeting = data?.meetingIntelligence;
  const uploadChannels = data?.materialUploads?.channels || [];
  const verifiedUploadCounts = uploadChannels.map((item) => item.confirmedAssets).filter((value): value is number => typeof value === "number");
  const verifiedUploadTotal = verifiedUploadCounts.length === uploadChannels.length && uploadChannels.length
    ? verifiedUploadCounts.reduce((sum, value) => sum + value, 0)
    : null;
  const memberDashboard = data?.memberDashboard;
  const members = memberDashboard?.members || [];
  const dailyDates = members[0]?.daily.map((item) => item.date) || [];
  const maxDailyMaterial = Math.max(...members.flatMap((member) => member.daily.map((item) => item.materialCount || 0)), 1);
  const riskProfiles = (meeting?.profiles || []).filter((profile) => profile.heatScore !== null && profile.saturationScore !== null);
  const ganttItems = (data?.longTermWork.items || []).slice(0, 8);
  const ganttStart = ganttItems.length ? ganttItems.map((item) => item.startDate).sort()[0] : selectedDate || yesterday;
  const ganttEnd = ganttItems.length ? ganttItems.map((item) => item.endDate).sort().at(-1) || ganttStart : ganttStart;
  const ganttDayCount = Math.max(1, dayDistance(ganttStart, ganttEnd) + 1);
  const ganttColumns = Math.min(7, Math.max(1, Math.ceil(ganttDayCount / 7)));
  const ganttBucketDays = Math.ceil(ganttDayCount / ganttColumns);
  const ganttDates = Array.from({ length: ganttColumns }, (_, index) => plusDays(ganttStart, index * ganttBucketDays));
  const hasTimesheet = showTimesheet && memberDashboard?.summary.averageEffectiveHours !== null && memberDashboard?.summary.averageEffectiveHours !== undefined;
  const memberPageSize = 12;
  const heatmapPageSize = 10;
  const normalizedMemberQuery = memberQuery.trim().toLocaleLowerCase("zh-CN");
  const normalizedHeatmapQuery = heatmapQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredMembers = members.filter((member) => !normalizedMemberQuery || `${member.personName} ${member.center || ""} ${member.department || ""}`.toLocaleLowerCase("zh-CN").includes(normalizedMemberQuery));
  const filteredHeatmapMembers = members.filter((member) => !normalizedHeatmapQuery || `${member.personName} ${member.center || ""} ${member.department || ""}`.toLocaleLowerCase("zh-CN").includes(normalizedHeatmapQuery));
  const memberPageCount = Math.max(1, Math.ceil(filteredMembers.length / memberPageSize));
  const heatmapPageCount = Math.max(1, Math.ceil(filteredHeatmapMembers.length / heatmapPageSize));
  const visibleMemberPage = Math.min(memberPage, memberPageCount);
  const visibleHeatmapPage = Math.min(heatmapPage, heatmapPageCount);
  const memberPageRows = filteredMembers.slice((visibleMemberPage - 1) * memberPageSize, visibleMemberPage * memberPageSize);
  const heatmapPageRows = filteredHeatmapMembers.slice((visibleHeatmapPage - 1) * heatmapPageSize, visibleHeatmapPage * heatmapPageSize);
  const readySources = (data?.sources || []).filter((source) => source.state === "ready").length;
  const staleOrPendingSources = (data?.sources || []).filter((source) => source.state === "stale" || source.state === "pending").length;
  const perspective = scope === "department"
    ? "总监视角：看跨中心差异、资源优先级与部门级数据断点。"
    : scope === "center"
      ? `主管视角（${data?.access.label || "所辖中心"}）：只分析当前中心与可见成员，不引用其他中心明细。`
      : `同事视角（${data?.access.personName || session.user.realName || "本人"}）：只分析本人可行动事实，不展示他人明细。`;
  const observedUploads = uploadChannels.find(item => item.key === "douyin")?.observedAssets;
  const uploadSituation = verifiedUploadTotal === null
    ? (typeof observedUploads === "number" ? (data?.materialUploads?.date || "日期待核验") + " 抖音观测素材 " + observedUploads + " 条；" : "") + "已核验上线与视频号发布字段仍有缺口，不能把观测量当成上线量。"
    : `${data?.materialUploads?.date || actualDate} 已核验上线/发布素材 ${verifiedUploadTotal} 条。`;
  const memberSituation = memberDashboard
    ? `当前权限可见 ${memberDashboard.summary.visibleMembers} 人，其中 ${memberDashboard.summary.mappedMembers} 人已匹配个人根数据，未匹配人员继续标记待核验。`
    : "成员目录或个人经营映射暂未返回，不能据此判断人员产出为 0。";
  const sourceSituation = data?.sources?.length
    ? `${data.sources.length} 个来源中 ${readySources} 个已接入，${staleOrPendingSources} 个为快照或待接入；其余为部分接入。`
    : "来源台账尚未返回，当前结论仅可视为待核验。";

  useEffect(() => { setMemberPage(1); }, [normalizedMemberQuery, preview?.updatedAt, selectedDate, days]);
  useEffect(() => { setHeatmapPage(1); }, [normalizedHeatmapQuery, preview?.updatedAt, selectedDate, days]);
  useEffect(() => { if (memberPage > memberPageCount) setMemberPage(memberPageCount); }, [memberPage, memberPageCount]);
  useEffect(() => { if (heatmapPage > heatmapPageCount) setHeatmapPage(heatmapPageCount); }, [heatmapPage, heatmapPageCount]);

  const updateWorkScheduler = async (enabled: boolean) => {
    const current = workScheduler || data?.longTermWork.scheduler;
    if (!current) return;
    setWorkSchedulerBusy(true);
    setWorkSchedulerError("");
    try {
      setWorkScheduler(await api.longTermWorkSchedulerUpdate(enabled, current.hour, current.minute));
    } catch (cause) {
      setWorkSchedulerError(cause instanceof ApiError ? cause.message : "定时刷新设置未保存");
    } finally {
      setWorkSchedulerBusy(false);
    }
  };

  const runWorkScheduler = async () => {
    if (workRequestId || workSchedulerBusy || (workScheduler && workIsActive(workScheduler))) return;
    const requestId = `manual-${crypto.randomUUID()}`;
    try { sessionStorage.setItem(workStorageKey, requestId); } catch { /* the in-memory id remains authoritative */ }
    setWorkRequestId(requestId);
    setWorkSchedulerBusy(true);
    setWorkSchedulerError("");
    try {
      setWorkScheduler(await api.longTermWorkSchedulerRun(requestId));
    } catch (cause) {
      if (cause instanceof ApiError && workSubmissionRejected(cause.status, cause.payload)) {
        try { sessionStorage.removeItem(workStorageKey); } catch { /* confirmed rejection, no work belongs to this id */ }
        setWorkRequestId(""); setWorkChecking(false);
        setWorkSchedulerError("另一个刷新正在执行，本次新请求未接收；正在核对当前运行，没有重复提交。");
        try {
          const current = await api.longTermWorkScheduler(); setWorkScheduler(current);
          const pending = current.requestPending || (workIsActive(current) ? current.run?.lastRequestId : "");
          if (pending) setWorkRequestId(pending);
        } catch { /* a later explicit status check remains GET-only */ }
        return;
      }
      setWorkSchedulerError("提交结果尚未确认，正在只读核对原请求；不会重复发起。");
    } finally {
      setWorkSchedulerBusy(false);
    }
  };
  const refreshRealtime = async () => {
    if (realtimeRefreshing) return;
    const key = activeQuery.current;
    setRealtimeRefreshing(true);
    setRealtimeRefreshError("");
    try {
      let next = await api.organizationDashboard(selectedDate, days, preview, true);
      if (activeQuery.current !== key) return;
      setData(next);
      for (let attempt = 0; attempt < 40 && next.rootRefresh?.realtime.refreshing; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        if (activeQuery.current !== key) return;
        next = await api.organizationDashboard(selectedDate, days, preview);
        setData(next);
      }
      if (activeQuery.current !== key) return;
      const source = next.rootRefresh?.realtime;
      if (source?.refreshing) setRealtimeRefreshError("本次读取仍在进行，请稍后再刷新查看。保留原数据和更新时间。");
      else if (source?.failureStatus) setRealtimeRefreshError(`本次读取失败（HTTP ${source.failureStatus}）。请检查根数据登录状态；页面未用 0 补齐。`);
      else if (!next.omnichannelRealtime) setRealtimeRefreshError("根数据尚未返回可用的 GSV 数据，请稍后重试。页面未用 0 补齐。");
    } catch (cause) {
      if (activeQuery.current === key) setRealtimeRefreshError(cause instanceof ApiError ? cause.message : "刷新失败，请稍后重试；原数据仍保留。");
    } finally {
      setRealtimeRefreshing(false);
    }
  };

  const checkWorkScheduler = async () => {
    if (workRequestId) { setWorkCheckEpoch((value) => value + 1); return; }
    const key = activeQuery.current;
    try {
      const current = await api.longTermWorkScheduler();
      if (activeQuery.current !== key) return;
      setWorkScheduler(current);
      const pending = current.requestPending || (workIsActive(current) ? current.run?.lastRequestId : "");
      if (pending) { setWorkRequestId(pending); return; }
      if (current.status === "ready") {
        const latest = await api.longTermWorkSnapshot(preview);
        if (activeQuery.current === key) setData((previous) => previous ? { ...previous, longTermWork: latest } : previous);
      }
      if (activeQuery.current === key) setWorkSchedulerError("");
    } catch { if (activeQuery.current === key) setWorkSchedulerError("状态或最新事项读取失败；保留原快照，没有发起新读取任务。"); }
  };

  const health = [
    { index: "01", name: "结果层", state: data?.omnichannelRealtime ? "ready" : business ? "partial" : "pending", note: data?.omnichannelRealtime ? `${realtimeDateLabel} 双渠道 ${money(data.omnichannelRealtime.summary.departmentTodayGsvYuan)}` : business ? `抖店单品 ${money(business.summary.productEffectiveSalesYuan)}` : "根数据待同步" },
    { index: "02", name: "任务层", state: meeting ? "partial" : "pending", note: meeting ? `${meeting.coverage.readableRecords}/${meeting.coverage.dailyRecords} 条条目原文可读` : "OA关键工作与会议行动项" },
    { index: "03", name: showTimesheet ? "例行层" : "执行层", state: showTimesheet ? hasTimesheet ? "ready" : "pending" : meeting ? "partial" : "pending", note: showTimesheet ? hasTimesheet ? `${memberDashboard?.source.timesheetMonth} 日均有效工时 ${hours(memberDashboard?.summary.averageEffectiveHours)}` : "工时、时效与积压待回补" : meeting ? "个人关键工作、行动兑现与积压信号" : "个人关键工作与行动记录待回补" },
    { index: "04", name: "组织层", state: meeting?.summary.vitalityScore !== null && meeting?.summary.vitalityScore !== undefined ? "partial" : "pending", note: meeting?.summary.vitalityScore !== null && meeting?.summary.vitalityScore !== undefined ? `活力 ${scoreText(meeting.summary.vitalityScore)} · 会议推断` : "事实已读，活力、热力与饱和度缺评分依据" },
    { index: "05", name: "资源层", state: business ? "partial" : "pending", note: business ? `素材有效率 ${rate(business.summary.effectiveMaterialRate)}` : "素材与费用待接入" },
    { index: "06", name: "趋势层", state: "pending", note: "需连续日快照后形成周/月趋势" },
  ];

  return (
    <main className="hub-main organization-dashboard" id="main-content" data-ui-release="personal-routine-privacy-20260828">
      <section className="org-dashboard-hero">
        <div className="org-dashboard-copy">
          <span>ORGANIZATION PERFORMANCE</span>
          <h1>组织经营看板</h1>
          <p>把经营结果、关键工作、人员负荷和素材产出放进同一个可追溯的事实底座。</p>
        </div>
        <div className="org-scope-lock"><PeopleRegular /><span><small>当前数据范围</small><strong>{scopeLabels[scope].title} · {data?.access.label || scopeLabels[scope].note}</strong></span><i>{data?.access.previewed ? "安全预览" : "服务端锁定"}</i></div>
      </section>

      <section className="org-scope-rail" aria-label="三级数据权限">
        {(["department", "center", "personal"] as DashboardScope[]).map((item, index) => {
          const active = item === scope;
          const allowed = scope === "department" || (scope === "center" && item !== "department") || item === "personal";
          return <div className={`${active ? "is-active" : ""}${allowed ? " is-allowed" : " is-locked"}`} key={item}><b>0{index + 1}</b><span><strong>{scopeLabels[item].title}</strong><small>{scopeLabels[item].note}</small></span>{active ? <em>当前视图</em> : <i>{allowed ? "可下钻" : "不可查看"}</i>}</div>;
        })}
      </section>

      {data?.businessVisibility && <section className="org-business-sharing-banner">
        <DataBarVerticalRegular />
        <span><strong>{data.businessVisibility.label}</strong><small>{data.businessVisibility.note}</small></span>
        <em>根数据事实层</em>
      </section>}

      <OmnichannelRealtime data={data?.omnichannelRealtime || null} onRefresh={() => void refreshRealtime()} refreshing={realtimeRefreshing} refreshError={realtimeRefreshError || (data?.rootRefresh?.realtime.failureStatus ? `读取失败（HTTP ${data.rootRefresh.realtime.failureStatus}），请检查根数据登录状态。` : "")} />
      <DailySourceStatus data={data} />

      {data?.organization && <section className="org-structure-card">
        <header>
          <div><span>ORGANIZATION SCOPE</span><h2>组织范围快照</h2><p>{data.organization.visibilityNote}</p></div>
          <a href={data.organization.sourceUrl} target="_blank" rel="noreferrer">查看飞书来源 ↗</a>
        </header>
        <div className="org-structure-body">
          <div className="org-snapshot-list">
            {data.organization.snapshots.map((snapshot) => <article key={snapshot.key}><span>{snapshot.label}</span><strong>{snapshot.headcount}<small>人</small></strong><em>{snapshot.snapshotMonth} 资料快照</em></article>)}
            {!data.organization.snapshots.length && <article className="is-private"><PeopleRegular /><strong>{scopeLabels[scope].title}</strong><em>部门人数快照仅总监级可见</em></article>}
          </div>
          <div className="org-center-directory"><span>当前权限可见组织与负责人</span><div>{data.organization.centers.length ? data.organization.centers.map((center) => {
            const leaders = data.organization.leaders.filter((item) => item.center === center);
            return <b key={center}>{center}{leaders.length ? <small>{leaders.map((item) => `${item.name}${item.note ? `（${item.note}）` : ""}`).join("、")}</small> : null}</b>;
          }) : <em>{scope === "personal" ? "仅本人范围" : "原文为组织画板，中心名单尚待核验；权限仍以 OA 为准"}</em>}</div></div>
        </div>
        <footer><WarningRegular /><span>{data.organization.warnings.join(" ")}</span><small>来源 revision {data.organization.revision}</small></footer>
      </section>}

      {data?.reportingDirectory?.entries.length ? <section className="org-report-directory">
        <header><div><span>DAILY REPORT DIRECTORY</span><h2>中心固定日报与经营入口</h2><p>{data.reportingDirectory.guidance.deadline} · {data.reportingDirectory.guidance.coverage} · {data.reportingDirectory.guidance.updateMode}</p></div><a href={data.reportingDirectory.sourceUrl} target="_blank" rel="noreferrer">查看飞书目录 ↗</a></header>
        <div>{data.reportingDirectory.entries.map((entry) => <article key={`${entry.channel}-${entry.center}-${entry.owner}`}><span>{entry.channel || '中心资料'}</span><strong>{entry.center}<small>{entry.owner ? `负责人：${entry.owner}` : '负责人按组织名单核验'}</small></strong><nav>{entry.reports.map((item) => <div key={item.url} style={{width:'100%'}}><a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a>{item.collection && <details style={{marginTop:8,padding:10,background:'#f5f9fc',borderRadius:8}}><summary style={{cursor:'pointer'}}>{item.collection.state === 'failed' ? '读取受限' : item.collection.factsDate ? `原文日期 ${item.collection.factsDate}` : '原文日期待核验'} · 展开原文</summary><small style={{display:'block',marginTop:6}}>采集于 {sourceTime(item.collection.readAt)} · 原文摘录</small><p style={{whiteSpace:'pre-wrap',lineHeight:1.7,fontSize:12,maxHeight:280,overflowY:'auto'}}>{item.collection.error || item.collection.excerpt || '原文暂无可显示正文'}</p></details>}</div>)}{entry.dashboards.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url}>{item.title}</a>)}</nav></article>)}</div>
        <footer><span>固定字段：{data.reportingDirectory.guidance.fields.join("、")}</span><small>{data.reportingDirectory.visibilityNote} · revision {data.reportingDirectory.revision}</small></footer>
      </section> : null}

      <section className="org-filter-bar">
        <label><span>数据日期</span><input type="date" max={yesterday} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
        <label><span>素材与人员观察周期</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>上一个完整自然日</option><option value={7}>近7个完整自然日</option><option value={14}>近14个完整自然日</option><option value={30}>近30个完整自然日</option></select></label>
        <Button appearance="primary" icon={loading ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />} disabled={loading} onClick={() => void load()}>{loading ? "读取中" : "刷新看板"}</Button>
        <Button appearance="secondary" icon={<BotRegular />} onClick={() => onAsk(`请结合组织经营看板 ${actualDate} 的经营结果、素材表现、人员负荷和关键工作证据，指出最需要管理介入的三件事；缺失数据请列为待核验。`)}>让 AI 做管理诊断</Button>
      </section>

      {error && <div className="org-dashboard-alert"><WarningRegular />{error}<button type="button" onClick={() => void load()}>重试</button></div>}
      {data?.rootRefresh?.dateMismatch && <div className="org-dashboard-alert" role="status"><WarningRegular />所选日期 {data.rootRefresh.requestedDate}，经营事实实际为 {data.rootRefresh.actualBusinessDate || "日期未返回"}；当前保留原事实，等待同日数据。</div>}
      {data?.meetingEvidence && data.meetingEvidence.snapshotDate !== selectedDate && <div className="org-dashboard-alert" role="status"><WarningRegular />会议：所选日期 {selectedDate || "未选择"} 无已核验资料，当前展示最近已读日期 {data.meetingEvidence.snapshotDate || "未返回"}。下方会议覆盖与信号均按这个实际资料日，不作为所选日结论。</div>}
      {loading && !data ? <div className="org-dashboard-loading"><Spinner size="large" label="正在读取权限范围和多源经营事实…" /></div> : null}
      {data?.refresh && !data.refresh.complete ? <div className="org-dashboard-progress" role="status"><Spinner size="tiny" /><span>页面已可使用，正在后台补充 {data.refresh.pendingSources.length} 项数据…</span></div> : null}
      {data?.refresh?.business?.note && <div className="org-dashboard-progress" role="status">{data.refresh.business.pending ? <Spinner size="tiny" /> : <WarningRegular />}<span>{data.refresh.business.note}</span></div>}

      <section className="org-source-strip">
        {(data?.sources || []).map((source) => <article className={`is-${source.state}`} key={source.key}><i /> <span><strong>{source.label}</strong><small>{source.note}</small></span><em>{sourceStateLabels[source.state]}</em></article>)}
      </section>

      <section className="org-section-heading"><div><span>01 · HEALTH OVERVIEW</span><h2>第1屏：健康总览</h2><p>先判断需不需要管理介入；每个数值保留来源与口径。</p></div><small>数据日 {actualDate}</small></section>
      <SituationAnalysis
        perspective={perspective}
        title={data?.omnichannelRealtime || business ? "经营事实已返回，优先补齐目标与异常闭环" : "经营事实暂未完整返回，先恢复数据链路"}
        state={data?.omnichannelRealtime && business ? "ready" : "pending"}
        items={[
          data?.omnichannelRealtime ? `${realtimeDateLabel} 全渠道有效成交额 ${money(data.omnichannelRealtime.summary.departmentTodayGsvYuan)}；与千川归因 GMV 分开呈现。` : "今日全渠道有效成交额待根数据回补，不以空值替代。",
          business ? `素材有效率 ${rate(business.summary.effectiveMaterialRate)}；${business.coverage.warnings[0] || "当前未返回额外经营口径警告。"}` : "素材有效率与经营警告待根数据回补。",
          data?.pendingMetrics?.length ? `当前首要补齐：${data.pendingMetrics.join("、")}。` : "当前没有新增的待接指标。",
        ]}
      />
      <section className="org-metric-grid">
        <MetricCard label="KPI目标完成率" value="待接入" note="需要 OA/KPI 目标表与实际值" state="pending" />
        <MetricCard label={realtimeDateLabel + " 全渠道有效成交额"} value={money(data?.omnichannelRealtime?.summary.departmentTodayGsvYuan)} note="根数据 · 抖店有效 GSV＋视频号有效 GSV · 全角色共享" state={data?.omnichannelRealtime ? "ready" : "pending"} />
        <MetricCard label="素材有效率" value={rate(business?.summary.effectiveMaterialRate)} note={isOfficialMaterial(business) ? "官方视频报表 · 有效账户素材-天 / 有消耗账户素材-天" : "根数据链路 · 有效素材 / 有消耗素材样本"} state={business ? business.status === "stale" ? "warning" : "ready" : "pending"} />
        {isOfficialMaterial(business) && <MetricCard label="含券视频归因成交" value={money(business?.summary.materialCouponInclusiveGmvYuan ?? business?.summary.materialAttributedGmvYuan)} note={`${business?.query.materialStartDate} 至 ${business?.query.materialEndDate} · ${business?.coverage.material.source}`} state={business?.status === "stale" ? "warning" : "ready"} />}
        {isOfficialMaterial(business) && <MetricCard label="视频实际支付归因金额" value={money(business?.summary.materialActualPayGmvYuan)} note="官方视频支付归因口径；与含券成交分列，不加进店铺有效 GSV" state={business?.status === "stale" ? "warning" : "ready"} />}
        <MetricCard label="关键工作证据覆盖" value={meeting ? `${meeting.coverage.readableRecords}/${meeting.coverage.dailyRecords}` : "待接入"} note={meeting ? (meeting.date || "日期待核验") + " 会议纪要/逐字稿可读数；完成率仍需 OA 验收" : "OA任务 + 会议承诺项 + 验收结果"} state={meeting ? "warning" : "pending"} />
        {showTimesheet && <MetricCard label="月均有效工时" value={hours(memberDashboard?.summary.averageEffectiveHours)} note={hasTimesheet ? `${memberDashboard?.source.timesheetMonth} · 当前权限 ${memberDashboard?.summary.timesheetMappedMembers} 人 · 扣除午休、有薪加班与晚餐重叠` : memberDashboard?.source.timesheetNote || "飞书工时数据待回补"} state={hasTimesheet ? memberDashboard?.source.timesheetState === "ready" ? "ready" : "warning" : "pending"} />}
        <MetricCard label="组织活力" value={scoreText(meeting?.summary.vitalityScore)} note="会议推断 · 协作、行动兑现与复盘闭环；非绩效结论" state={meeting?.summary.vitalityScore !== null && meeting?.summary.vitalityScore !== undefined ? "warning" : "pending"} />
        <MetricCard label="人员热力值" value={scoreText(meeting?.summary.heatScore)} note="会议推断 · 任务密度、交付和风险信号" state={meeting?.summary.heatScore !== null && meeting?.summary.heatScore !== undefined ? "warning" : "pending"} />
        <MetricCard label="工作饱和度信号" value={scoreText(meeting?.summary.saturationScore)} note={showTimesheet ? "会议推断 · 不替代工时；缺失与无权记录不计 0" : "会议推断 · 缺失与无权记录不计 0"} state={meeting?.summary.saturationScore !== null && meeting?.summary.saturationScore !== undefined ? "warning" : "pending"} />
      </section>

      <section className="org-health-layout">
        <article className="org-health-card">
          <header><span><PulseRegular /><strong>六维健康度</strong></span><small>不具备数据的维度不评分</small></header>
          <div className="org-health-list">{health.map((item) => <div className={`is-${item.state}`} key={item.index}><b>{item.index}</b><span><strong>{item.name}</strong><small>{item.note}</small></span><em>{item.state === "ready" ? "已接入" : item.state === "partial" ? "部分接入" : "待接入"}</em></div>)}</div>
        </article>
        <article className="org-intervention-card">
          <header><span><WarningRegular /><strong>管理介入清单</strong></span><small>异常优先，不罗列全部数据</small></header>
          {business?.coverage.warnings.length ? business.coverage.warnings.slice(0, 4).map((warning, index) => <div className="org-risk-row" key={warning}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>数据与经营风险</strong><small>{warning}</small></span><em>待核验</em></div>) : <div className="org-empty-state"><CheckmarkCircleFilled /><strong>暂未形成可核验风险清单</strong><span>接入 KPI、OA 任务和会议行动项后，将按影响排序展示。</span></div>}
        </article>
      </section>

      <LibTvCreditTrendPanel session={session} preview={preview} />

      <section className="org-section-heading"><div><span>02 · EXCEPTION DRILLDOWN</span><h2>第2屏：异常下钻</h2><p>从结果异常下钻到任务、人员和素材环节。</p></div></section>
      <SituationAnalysis
        perspective={perspective}
        title={memberDashboard?.summary.unmappedMembers ? "人员映射仍有缺口，先补齐归因再做产能判断" : "当前范围已可下钻到素材、成员与会议证据"}
        state={memberDashboard && memberDashboard.summary.unmappedMembers === 0 ? "ready" : "attention"}
        items={[
          uploadSituation,
          memberSituation,
          meeting ? `会议证据可读 ${meeting.coverage.readableRecords}/${meeting.coverage.dailyRecords} 条；受限或空记录不纳入评分。` : "会议证据尚未接入，关键工作完成情况保持待核验。",
        ]}
      />
      <section className="org-drill-grid is-products">
        <article className="org-analysis-card org-product-card">
          <header><div><span>DOUYIN PRODUCT / COMPLETE DAY</span><h3>抖店单品成交贡献</h3></div><small>{products.length ? `${actualDate} · ${products.length} 个标准分类` : "范围数据待接入"}</small></header>
          <div className="org-product-upload"><span>观测素材</span><strong>{countText(uploadChannels.find((item) => item.key === "douyin")?.observedAssets)}</strong><small>已核验上线：{countText(uploadChannels.find((item) => item.key === "douyin")?.confirmedAssets)}</small><small>{uploadChannels.find((item) => item.key === "douyin")?.note || `${data?.materialUploads?.date || actualDate} · 根数据完整自然日`}</small></div>
          <div className="org-bar-list">{products.slice(0, 8).map((product, index) => <div key={product.standardProductName}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{product.standardProductName}</strong><small>{product.orderCount} 单 · 占比 {product.salesSharePct.toFixed(1)}%</small></span><i><em style={{ width: `${Math.max(3, product.effectiveSalesYuan / maxProduct * 100)}%` }} /></i><strong>{money(product.effectiveSalesYuan)}</strong></div>)}{!products.length && <div className="org-no-data">根数据当前没有返回可核验的单品成交数据。</div>}</div>
        </article>
        <article className="org-analysis-card org-product-card is-wechat">
          <header><div><span>WECHAT PRODUCT / COMPLETE DAY</span><h3>视频号单品成交贡献</h3></div><small>{wechatProducts.length ? `${actualDate} · ${wechatProducts.length} 个标准分类` : "范围数据待回补"}</small></header>
          <div className="org-product-upload"><span>内容发布</span><strong>{countText(uploadChannels.find((item) => item.key === "wechat")?.confirmedAssets)}</strong><small>{uploadChannels.find((item) => item.key === "wechat")?.note || `${data?.materialUploads?.date || actualDate} · finder_account_id + feed_id 去重`}</small></div>
          <div className="org-bar-list">{wechatProducts.slice(0, 8).map((product, index) => <div key={product.standardProductName}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{product.standardProductName}</strong><small>{product.orderCount} 单 · 占比 {product.salesSharePct.toFixed(1)}%</small></span><i><em style={{ width: `${Math.max(3, product.effectiveSalesYuan / maxWechatProduct * 100)}%` }} /></i><strong>{money(product.effectiveSalesYuan)}</strong></div>)}{!wechatProducts.length && <div className="org-no-data">根数据当前没有返回可核验的视频号单品成交明细，不按 0 展示。</div>}</div>
        </article>
      </section>

      <section className="org-people-work-grid">
        <article className="org-analysis-card">
          <header><div><span>PEOPLE HEALTH</span><h3>人员负荷与活力</h3></div><small>个人明细仅在权限范围内展示</small></header>
          <div className="org-pending-grid">{showTimesheet && <TimesheetBlock dashboard={memberDashboard || null} />}<InferenceBlock title="工作饱和度信号" score={meeting?.summary.saturationScore ?? null} description="从并行任务、连续交付、卡点与明确承诺中识别负荷信号。" coverage={meeting?.coverage.note || "会议证据待接入"} /><InferenceBlock title="人员热力值" score={meeting?.summary.heatScore ?? null} description="综合任务密度、产出、异常和跨组支援，不替代正式考核。" coverage={meeting?.visibilityNote || "会议证据待接入"} /><InferenceBlock title="组织活力" score={meeting?.summary.vitalityScore ?? null} description="观察响应、协作、行动兑现与复盘闭环。" coverage={meeting?.method || "会议证据待接入"} /></div>
          {meeting && <div className="org-people-signal-list">
            <header><span>当前权限可见单元</span><small>{meeting.summary.scoredProfiles}/{meeting.summary.visibleProfiles} 个单元形成可解释分值</small></header>
            {meeting.profiles.map((profile) => <article className={`is-${profile.state}`} key={`${profile.center}-${profile.leader}`}>
              <div><strong>{profile.center}</strong><small>{profile.leader ? "负责人：" + profile.leader : "负责人未核验"}</small></div>
              <div className="org-signal-scores"><span>活力 <b>{scoreText(profile.vitalityScore)}</b></span><span>热力 <b>{scoreText(profile.heatScore)}</b></span><span>饱和 <b>{scoreText(profile.saturationScore)}</b></span></div>
              <p>{profile.summary}</p>
              <em>{profile.evidenceCount ? `${profile.evidenceCount} 条可追溯证据` : "证据待回补"}</em>
              {profile.evidence.length > 0 && <details><summary>查看证据</summary>{profile.evidence.map((item, index) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={`${item.title}-${index}`}><b>{item.title}</b><span>{item.signal}</span></a>)}</details>}
            </article>)}
          </div>}
        </article>
        <article className="org-analysis-card">
          <header><div><span>KEY WORK</span><h3>关键工作与会议证据</h3></div><small>原始事项与 AI 推导动作分开</small></header>
          {data?.meetingEvidence && <div className="org-meeting-source">
            <div><span><strong>飞书会议记录与原文核验</strong><small>{data.meetingEvidence.visibilityNote}</small></span><a href={data.meetingEvidence.sourceUrl} target="_blank" rel="noreferrer">查看来源 ↗</a></div>
            <p>{data.meetingEvidence.snapshotDate} 当日 {data.meetingEvidence.dailyRecords} 条 · 可读 {data.meetingEvidence.readableRecords} 条 · 受限 {data.meetingEvidence.blockedRecords} 条 · 空记录 {data.meetingEvidence.blankRecords} 条。{data.meetingEvidence.verification?.note}</p>
            <section>{data.meetingEvidence.items.slice(0, 5).map((item) => <article key={`${item.date}-${item.title}`}><time>{item.date}</time><span><strong>{item.title}</strong><small>{item.center === "ALL" ? "部门公共" : item.center}</small></span><div>{item.minutesUrl && <a href={item.minutesUrl} target="_blank" rel="noreferrer">纪要</a>}{item.transcriptUrl && <a href={item.transcriptUrl} target="_blank" rel="noreferrer">逐字记录</a>}</div></article>)}</section>
            {!data.meetingEvidence.items.length && <em>当前角色没有可展示的会议明细，不会将部门会议暴露给个人范围。</em>}
          </div>}
          <div className="org-work-lanes"><div><b>01</b><span><strong>OA关键工作</strong><small>目标、负责人、里程碑、截止日期、验收结果</small></span><em>待接入</em></div><div><b>02</b><span><strong>会议行动信号</strong><small>原文核验与原表明确 TODO 分开记录；完成验收仍以 OA 为准</small></span><em>{meeting ? "部分接入" : "待接入"}</em></div><div><b>03</b><span><strong>交付与价值回写</strong><small>交付物关联素材、经营贡献和复盘结论</small></span><em>待接入</em></div></div>
        </article>
      </section>

      <section className="org-member-detail-board">
        <header>
          <div><span>PEOPLE DETAIL / SERVER SCOPED</span><h2>权限范围内成员明细</h2><p>总监级查看全部门，主管与负责人查看所辖中心，专员只看本人；范围由后端过滤。</p></div>
          <div><strong>{memberDashboard?.summary.visibleMembers ?? "—"}<small>人可见</small></strong><em>{memberDashboard ? `${memberDashboard.summary.mappedMembers} 人已匹配个人根数据` : "成员目录待回补"}</em></div>
        </header>
        {members.length ? <>
          <div className="org-list-tools">
            <label><span>搜索成员明细</span><input type="search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="输入姓名、中心或部门" /></label>
            <ListPagination page={visibleMemberPage} total={filteredMembers.length} pageSize={memberPageSize} onChange={setMemberPage} />
          </div>
          <div className="org-member-card-grid">
            {memberPageRows.map((member) => <article key={member.employeeId || member.personName}>
              <header><b>{member.personName.slice(0, 1)}</b><span><strong>{member.personName}</strong><small>{member.center || "中心待回补"}{member.isLeader ? " · 负责人" : ""}</small></span><em className={`is-${member.performance.state}`}>{member.performance.state === "ready" ? "根数据已匹配" : "待核验"}</em></header>
              <div>{showTimesheet && <span>日均有效工时<strong>{hours(member.timesheet?.averageEffectiveHours)}</strong></span>}<span>素材产出<strong>{member.performance.materialCount ?? "待核验"}</strong></span><span>成交额<strong>{money(member.performance.totalGmvYuan)}</strong></span><span>人员热力<strong>{scoreText(member.signals.heatScore)}</strong></span><span>饱和度<strong>{scoreText(member.signals.saturationScore)}</strong></span></div>
              <p>{showTimesheet && member.timesheet?.averageEffectiveHours !== null && member.timesheet?.averageEffectiveHours !== undefined ? `${member.timesheet.monthLabel} · 排班 ${member.timesheet.scheduledDays ?? "待核验"} 天 · 打卡 ${member.timesheet.punchDays ?? "待核验"} 天` : member.performance.state === "ready" ? `千川 ${member.performance.qianchuanMaterialCount} 条 · 视频号 ${member.performance.videoMaterialCount} 条` : member.signals.note}</p>
            </article>)}
          </div>
          {!memberPageRows.length && <div className="org-list-no-match">没有匹配的成员，请更换姓名、中心或部门关键词。</div>}

          <article className="org-people-heatmap">
            <header><div><span>MEMBER OUTPUT HEATMAP</span><h3>成员产出热力图</h3></div><small>{showTimesheet ? "颜色深浅＝FanDo 根数据可归因素材数；不是工时或绩效评分" : "颜色深浅＝FanDo 根数据可归因素材数；不是绩效评分"}</small></header>
            <div className="org-list-tools is-compact">
              <label><span>搜索热力图成员</span><input type="search" value={heatmapQuery} onChange={(event) => setHeatmapQuery(event.target.value)} placeholder="输入姓名、中心或部门" /></label>
              <ListPagination page={visibleHeatmapPage} total={filteredHeatmapMembers.length} pageSize={heatmapPageSize} onChange={setHeatmapPage} />
            </div>
            <div className="org-heatmap-table" style={{ minWidth: `${150 + Math.max(dailyDates.length, 1) * 61}px` }}><div className="org-heatmap-head" style={{ gridTemplateColumns: `150px repeat(${Math.max(dailyDates.length, 1)}, minmax(54px, 1fr))` }}><b>成员</b>{dailyDates.map((day) => <span key={day}>{compactDate(day)}</span>)}</div>{heatmapPageRows.map((member) => <div className="org-heatmap-row" style={{ gridTemplateColumns: `150px repeat(${Math.max(dailyDates.length, 1)}, minmax(54px, 1fr))` }} key={`heat-${member.employeeId || member.personName}`}><b>{member.personName}<small>{member.center || "待回补"}</small></b>{member.daily.map((item) => <span className={item.materialCount === null ? "is-pending" : ""} style={item.materialCount === null ? undefined : { backgroundColor: `rgba(0, 139, 211, ${0.12 + item.materialCount / maxDailyMaterial * 0.78})` }} title={item.materialCount === null ? "个人归因待核验" : `${item.date} · ${item.materialCount} 条 · ${money(item.gmvYuan)}`} key={item.date}>{item.materialCount ?? "—"}</span>)}</div>)}</div>
            {!heatmapPageRows.length && <div className="org-list-no-match">没有匹配的热力图成员，请更换搜索关键词。</div>}
          </article>

          <div className="org-people-operations-grid">
            <article className="org-gantt-card">
              <header><div><span>LONG-TERM WORK TIMELINE</span><h3>关键工作甘特视图</h3></div><small>{data?.longTermWork ? `${data.longTermWork.sourceChat.readThroughDate} 最近快照 · 群消息与已读文档原文` : "长期工作来源待接入"}</small></header>
              {session.permissions.operation_admin && (() => {
                const scheduler = workScheduler || data?.longTermWork.scheduler;
                if (!scheduler) return <div className="org-work-scheduler is-pending"><span><strong>平台内置定时刷新</strong><small>正在读取调度状态</small></span></div>;
                const stateLabel = workStatusLabel(scheduler.status);
                const run = scheduler.run;
                const blocked = Boolean(workRequestId || workIsActive(scheduler) || ["uncertain", "analysis_failed", "blocked_state", "blocked_maintenance"].includes(scheduler.status));
                return <div className={`org-work-scheduler is-${scheduler.status}`}>
                  <span><strong>平台内置定时刷新 · {stateLabel}</strong><small>每天 {String(scheduler.hour).padStart(2, "0")}:{String(scheduler.minute).padStart(2, "0")}（Asia/Shanghai）· 下次 {scheduler.nextRunAt ? sourceTime(scheduler.nextRunAt) : "未安排"}</small></span>
                  <dl><div><dt>最近尝试</dt><dd>{scheduler.lastAttemptAt ? sourceTime(scheduler.lastAttemptAt) : "尚未执行"}</dd></div><div><dt>最近刷新完成</dt><dd>{scheduler.lastSuccessAt ? sourceTime(scheduler.lastSuccessAt) : "沿用核验快照"}</dd></div><div><dt>最近完成范围 · {scheduler.lastSuccessfulDate || "日期待核验"}</dt><dd>{workSourceSummary(scheduler.sourceScope, scheduler.messagesRead, scheduler.documentsRead)}</dd></div><div><dt>最近成功快照中的事项</dt><dd>{scheduler.itemCount} 项 · 该次新增 {scheduler.newCount} · 该次更新 {scheduler.updatedCount}</dd></div></dl>
                  {run && <dl><div><dt>本次来源 · {workStatusLabel(run.sourceState || "pending")}</dt><dd>{["complete", "partial"].includes(run.sourceState || "") ? workSourceSummary(run.sourceScope, run.messagesRead ?? 0, run.documentsRead ?? 0) : "读取尚未完成，数量待汇总"}<small>固定窗口截至 {sourceTime(run.windowEnd)} · 来源读取时间 {sourceTime(run.sourceReadAt)}</small></dd></div><div><dt>本次提炼 · {workStatusLabel(run.analysisState || "pending")}</dt><dd>{run.completedBatches ?? 0} / {run.totalBatches ?? 0} 批完成 · 第 {run.roundCount ?? 1} 轮<small>提炼仅依据已读群消息和文档原文；未完成时保留最近成功快照，旧事项不计为本次新增。</small></dd></div></dl>}
                  {(() => {
                    const scope = run?.sourceScope || scheduler.sourceScope;
                    const references = scope?.referenceOnlyResources || [];
                    return references.length > 0 && <details><summary>{scope?.referenceOnlyCount} 项关联资源仅登记入口 · 未读取内容或表内记录</summary>{references.map((resource) => <p key={resource.url}><a href={resource.url} target="_blank" rel="noreferrer">{resource.title || "关联资源"} ↗</a> · {resource.type}<small>{resource.note}</small></p>)}</details>;
                  })()}
                  {(scheduler.lastError || workSchedulerError) && <p><WarningRegular />{workSchedulerError || scheduler.lastError}{scheduler.status === "blocked_permission" && <small>{scheduler.resourceAccessRequired}</small>}</p>}
                  <nav><Button disabled={workSchedulerBusy || blocked} appearance="primary" icon={workSchedulerBusy || workChecking ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />} onClick={() => void runWorkScheduler()}>{run?.canContinue ? "继续本次读取" : "立即刷新"}</Button><Button disabled={workSchedulerBusy || workChecking} appearance="secondary" onClick={() => void checkWorkScheduler()}>{workChecking ? "正在核对本次状态" : "核对本次状态"}</Button><Button disabled={workSchedulerBusy || workIsActive(scheduler)} appearance="secondary" onClick={() => void updateWorkScheduler(!scheduler.enabled)}>{scheduler.enabled ? "停用定时刷新" : "启用定时刷新"}</Button></nav>
                </div>;
              })()}
              <div className="org-gantt-head"><b>事项</b><span style={{ gridTemplateColumns: `repeat(${ganttColumns}, 1fr)` }}>{ganttDates.map((day) => <i key={day}>{compactDate(day)}</i>)}</span><em>状态</em></div>
              {ganttItems.map((item) => {
                const startColumn = Math.min(ganttColumns, Math.max(1, Math.floor(dayDistance(ganttStart, item.startDate) / ganttBucketDays) + 1));
                const endColumn = Math.min(ganttColumns + 1, Math.max(startColumn + 1, Math.ceil((dayDistance(ganttStart, item.endDate) + 1) / ganttBucketDays) + 1));
                return <div className="org-gantt-row" key={item.id}><b><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a><small>{item.center === "ALL" ? "部门公共" : item.center} · {item.owners.join("、")}</small></b><span style={{ gridTemplateColumns: `repeat(${ganttColumns}, 1fr)` }}><i style={{ gridColumnStart: startColumn, gridColumnEnd: endColumn }} title={`${item.startDate} 至 ${item.endDate} · ${item.acceptance}`} /></span><em>{item.status}</em></div>;
              })}
              {!ganttItems.length && <div className="org-no-data">当前权限没有可展示的长期工作；不会暴露其他中心事项。</div>}
              {data?.longTermWork && <p className="org-gantt-definition">{data.longTermWork.definition} {data.longTermWork.visibilityNote}</p>}
            </article>
            <article className="org-risk-bubble-card"><header><div><span>ORGANIZATION SIGNAL MAP</span><h3>中心风险气泡</h3></div><small>横轴＝饱和度信号，纵轴＝热力信号；非个人绩效</small></header><div className="org-risk-map"><span className="org-risk-y">业务热力</span><span className="org-risk-x">饱和度升高 →</span>{riskProfiles.map((profile) => <i title={`${profile.center} · 热力 ${profile.heatScore} · 饱和 ${profile.saturationScore}`} style={{ left: `${Math.max(8, Math.min(88, profile.saturationScore || 0))}%`, bottom: `${Math.max(10, Math.min(82, profile.heatScore || 0))}%`, width: `${54 + Math.min(profile.evidenceCount, 5) * 8}px`, height: `${54 + Math.min(profile.evidenceCount, 5) * 8}px` }} key={profile.center}>{profile.center.replace("营销中心", "营销")}</i>)}{!riskProfiles.length && <em>当前范围没有足够的可解释会议信号，待回补。</em>}</div></article>
          </div>
        </> : <div className="org-member-empty"><PeopleRegular /><strong>成员目录尚未返回</strong><span>{memberDashboard?.source.performanceNote || "请检查 OA 成员中心归属与后端权限映射；不会以示例人员填充。"}</span></div>}
      </section>

      <section className="org-section-heading"><div><span>03 · SOURCE LEDGER</span><h2>第3屏：数据底座与明细</h2><p>完整数据不挤进首屏，但必须能追溯到来源、时间和口径。</p></div></section>
      <SituationAnalysis
        perspective={perspective}
        title={staleOrPendingSources ? "仍有来源需要回补或刷新，当前结论保留验证状态" : "当前来源均已返回，可继续核对口径与更新时间"}
        state={staleOrPendingSources ? "attention" : "ready"}
        items={[
          sourceSituation,
          data?.sourceCoverage ? `已核验 ${data.sourceCoverage.totalSources} 类授权来源；当前完整 ${data.sourceCoverage.readySources} 类，仍需回补或刷新 ${data.sourceCoverage.incompleteSources} 类。` : "来源覆盖审计尚未返回。",
          data?.sourceCoverage?.conflicts.length ? `当前保留 ${data.sourceCoverage.conflicts.length} 类来源冲突，不会用任一快照静默覆盖另一来源。` : "当前没有已知来源冲突。",
          data?.generatedAt ? `本次看板生成时间 ${sourceTime(data.generatedAt)}；逐项更新时间以下方来源台账为准。` : "看板生成时间待回补。",
          "缺失、未映射或未返回的数据不等于 0；有效店铺成交与千川归因 GMV 必须分开使用。",
        ]}
      />
      <section className="org-source-ledger">
        <div className="org-ledger-head"><span>来源</span><span>当前状态</span><span>负责指标</span><span>更新与说明</span></div>
        {(data?.sources || []).map((source) => <article key={source.key}><strong>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.label} ↗</a> : source.label}</strong><span className={`is-${source.state}`}>{sourceStateLabels[source.state]}</span><span>{source.coverage || sourceResponsibility(source.key)}</span><small>{source.updatedAt ? `更新 ${sourceTime(source.updatedAt)} · ${source.note}` : source.note}{source.authority ? ` · ${source.authority}` : ""}{source.revision !== undefined ? ` · revision ${source.revision}` : ""}</small></article>)}
      </section>
      <div className="org-method-note"><strong>口径护栏</strong><span>{data?.sourceCoverage?.guardrail || "缺失、未映射或未返回的数据不等于 0；有效店铺成交与千川归因 GMV 分开呈现；人员热力和饱和度只展示可解释组成，不作为单一绩效结论。"}</span></div>
    </main>
  );
}
