import { Button, FluentProvider, Spinner, webLightTheme } from "@fluentui/react-components";
import "./workspace-roles.css";
import {
  AddRegular,
  AppsRegular,
  ArrowClockwiseRegular,
  AttachRegular,
  BotRegular,
  CheckmarkCircleFilled,
  ChatMultipleRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ClipboardBulletListRegular,
  CloudArrowUpRegular,
  DataBarVerticalRegular,
  DismissRegular,
  DeleteRegular,
  EditRegular,
  ImageRegular,
  KeyRegular,
  LightbulbFilamentRegular,
  LiveRegular,
  PeopleSettingsRegular,
  PenSparkleRegular,
  PulseRegular,
  SearchRegular,
  SendRegular,
  ShieldLockRegular,
  SparkleRegular,
  VideoClipMultipleRegular,
  WrenchRegular,
} from "@fluentui/react-icons";
import type { FormEvent, ReactNode, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, isTransientApiError } from "./api";
import { modules } from "./data";
import { OrganizationDashboardPage } from "./OrganizationDashboard";
import { FlowInboxSummary } from "./FlowInboxSummary";
import { SparkLibrary } from "./SparkLibrary";
import { sourceTime } from "./sourceTime";
import { embeddedCloudAsset, initialModule } from "./moduleLocation";
import { businessDateLabel, combinedBusinessDateLabel } from "./businessDate";
import { isOfficialMaterial, materialGmvLabel, materialOrderCount } from "./materialMetrics";
import type { AdminGrant, AppModule, AssistantAttachment, AssistantConversation, AssistantMessage, AssistantStatus, BusinessIntelligenceOverview, CreativeIncentiveOverview, DashboardScope, DashboardScopeGrant, HubSession, LoginGrant, ModuleAccessGrant, OperationLog, OptimizationResponse, PermissionPreview, PermissionPreviewSubject, TaskCenterItem, TaskCenterOverview, TaskCenterSourceKind, TaskCenterStatus, WorkspaceHomeSummary } from "./types";
import "./permission-center.css";

const hubTheme = {
  ...webLightTheme,
  colorBrandBackground: "#087fc8",
  colorBrandBackgroundHover: "#076eae",
  colorBrandBackgroundPressed: "#075f96",
  colorBrandForeground1: "#087fc8",
  colorCompoundBrandForeground1: "#087fc8",
  fontFamilyBase: '"Microsoft YaHei", "微软雅黑", system-ui, sans-serif',
};

type ViewKey = "hub" | "organization" | "spark" | "incentives" | "assistant" | "optimization" | "logs" | "permissions";

type AssistantRequest = {
  id: string;
  prompt: string;
  source: string;
};

const viewLabels: Record<ViewKey, string> = {
  hub: "业务中枢",
  organization: "组织经营看板",
  spark: "部门星火库",
  incentives: "素材实时激励",
  assistant: "AI管家",
  optimization: "优化中心",
  logs: "操作日志",
  permissions: "权限管理",
};

const moduleIcons: Record<string, ReactNode> = {
  "data-dashboard": <DataBarVerticalRegular />,
  "creative-hub": <LightbulbFilamentRegular />,
  "ai-first-creation": <PenSparkleRegular />,
  "material-workbench": <VideoClipMultipleRegular />,
  "cloud-manager": <CloudArrowUpRegular />,
  "live-room-management": <LiveRegular />,
};

function Brand() {
  return (
    <div className="brand-lockup" aria-label="WIS Content Hub">
      <span className="brand-mark">W</span>
      <span className="brand-name"><strong>WIS</strong><small>CONTENT HUB</small></span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="login-page">
      <section className="login-card session-card">
        <Brand />
        <Spinner size="large" label="正在校验统一登录与界面权限…" />
      </section>
    </main>
  );
}

function AccessError({ message, recovering, onRetry }: { message: string; recovering: boolean; onRetry: () => void }) {
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeNo.trim() || !password) return;
    setBusy(true);
    setLoginError("");
    try {
      await api.hubLogin(employeeNo.trim(), password, captcha.trim());
      setPassword("");
      onRetry();
    } catch (cause) {
      setLoginError(cause instanceof ApiError ? cause.message : "登录暂未完成，请核对后重试");
    } finally { setBusy(false); }
  };
  const sendCaptcha = async () => {
    if (!employeeNo.trim()) { setLoginError("请先填写 OA 工号"); return; }
    setBusy(true);
    setLoginError("");
    try {
      const result = await api.hubCaptcha(employeeNo.trim());
      setLoginError(result.message || "验证码已发送");
    } catch (cause) {
      setLoginError(cause instanceof ApiError ? cause.message : "验证码暂时无法发送");
    } finally { setBusy(false); }
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <Brand />
        <div className="login-copy">
          <span>统一权限校验</span>
          <h1>{recovering ? "统一权限服务正在恢复" : "当前无法进入中枢"}</h1>
          <p>{message}</p>
        </div>
        {!recovering && <form className="hub-login-form" onSubmit={(event) => void submitLogin(event)}>
          <label>OA 工号<input autoComplete="username" value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} placeholder="FD-026222" /></label>
          <label>OA 密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>验证码（如需）<span className="hub-login-captcha"><input autoComplete="one-time-code" value={captcha} onChange={(event) => setCaptcha(event.target.value)} /><button type="button" disabled={busy} onClick={() => void sendCaptcha()}>发送验证码</button></span></label>
          {loginError && <p role="alert" className="hub-login-error">{loginError}</p>}
          <Button appearance="primary" size="large" type="submit" disabled={busy || !employeeNo.trim() || !password}>{busy ? "正在登录" : "登录中枢"}</Button>
        </form>}
        <Button appearance="subtle" size="large" icon={<ArrowClockwiseRegular />} onClick={onRetry}>立即重新校验</Button>
        <div className="login-note"><ShieldLockRegular /><span>中枢只读取 OA 登录状态和已授权界面，不保存 OA 密码。</span></div>
      </section>
    </main>
  );
}

function identityValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() || "";
}

function workspaceHomeLabel(session: HubSession) {
  if (session.workspace.home === "department") return "部门管理首页";
  if (session.workspace.home === "center") return "本中心工作台";
  if (session.workspace.home === "personal") return "个人工作台";
  return "业务入口";
}

function SidebarIdentity({ session }: { session: HubSession }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const user = session.user;
  const name = identityValue(user.realName, user.name) || "已登录成员";
  const number = identityValue(user.number, user.userId, user.id);
  const department = identityValue(user.department, user.parentDept);
  const rawCenter = identityValue(user.center, user.deptName, user.groupName);
  const center = department && rawCenter.startsWith(`${department}-`) ? rawCenter.slice(department.length + 1) : rawCenter;
  const title = identityValue(user.jobTitle, user.job_title, user.positionName, user.position, user.postName);
  const avatarUrl = identityValue(user.avatarUrl, user.avatar_url, user.headImg, user.photo);
  const initials = name.slice(0, 1).toUpperCase();
  const moduleTotal = session.access.modules.length || 8;
  const moduleCount = session.access.allowed_modules.length;
  const authority = session.workspace.role_label || (session.permissions.super_admin
    ? "最高权限"
    : session.permissions.manage_permissions
      ? "权限管理员"
      : session.permissions.operation_admin
        ? "运营管理员"
        : "协作成员");
  return (
    <section className="sidebar-identity-card" aria-label="当前登录身份">
      <div className="sidebar-identity-head">
        <span className="sidebar-user-avatar" aria-hidden="true">
          <b>{initials}</b>
          {avatarUrl && !avatarFailed && <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />}
          <i />
        </span>
        <span className="sidebar-user-primary">
          <strong title={name}>{name}</strong>
          <small title={title || authority}>{title || authority}</small>
        </span>
        <em>在线</em>
      </div>
      <dl className="sidebar-identity-meta">
        <div><dt>部门</dt><dd title={department || "OA 未返回部门"}>{department || "待 OA 回填"}</dd></div>
        <div><dt>中心</dt><dd title={center || "OA 未返回中心"}>{center || "待 OA 回填"}</dd></div>
        <div><dt>工号</dt><dd title={number || "OA 未返回工号"}>{number || "待 OA 回填"}</dd></div>
      </dl>
      <footer>
        <span><i />统一身份已登录</span>
        <strong>{moduleCount}/{moduleTotal} 个界面</strong>
      </footer>
    </section>
  );
}

function Sidebar({ active, activeModule, canManage, canViewLogs, canViewOrganization, canViewIncentives, canViewRadar, showOptimization, session, onNavigate, onOpenModule, onOpenRadar, onLogout }: { active: ViewKey; activeModule: string | null; canManage: boolean; canViewLogs: boolean; canViewOrganization: boolean; canViewIncentives: boolean; canViewRadar: boolean; showOptimization: boolean; session: HubSession; onNavigate: (view: ViewKey) => void; onOpenModule: (moduleId: string) => void; onOpenRadar: () => void; onLogout: () => void }) {
  const item = (key: ViewKey, icon: ReactNode, label = viewLabels[key]) => (
    <button className={`nav-item${active === key && !activeModule ? " active" : ""}`} type="button" onClick={() => onNavigate(key)}>
      {icon}<span>{label}</span>
    </button>
  );
  return (
    <aside className="hub-sidebar">
      <div className="sidebar-brand"><Brand /></div>
      <nav className="sidebar-nav" aria-label="中枢导航">
        <span className="nav-group-label">工作首页</span>
        {item("hub", <AppsRegular />, workspaceHomeLabel(session))}
        {canViewOrganization && item("organization", <PulseRegular />)}
        {[
          { label: "内容生产", ids: ["creative-hub", "ai-first-creation", "material-workbench"] },
          { label: "分发与转化", ids: ["cloud-manager", "live-room-management"] },
          { label: "经营分析", ids: ["data-dashboard"] },
        ].map((group) => {
          const visible = group.ids.flatMap(id => modules.filter(module => module.id === id && session.access.allowed_modules.includes(id) && module.status !== "building"));
          return visible.length ? <div className="nav-category" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {visible.map(module => <button key={module.id} className={`nav-item${activeModule === module.id ? " active" : ""}`} type="button" onClick={() => onOpenModule(module.id)}>
              {moduleIcons[module.id]}<span>{module.purpose}</span>
            </button>)}
          </div> : null;
        })}
        <span className="nav-group-label">协作与管理</span>
        {session.access.allowed_modules.includes('workflow-engine') && <a className="nav-item" href="api/launch/workflow-engine"><ClipboardBulletListRegular /><span>{session.workspace.can_configure_workflow || ['director','manager'].includes(session.workspace.role)?'流程引擎':'我的任务'}</span></a>}
        {canViewRadar && <button className="nav-item" type="button" onClick={onOpenRadar}><SearchRegular /><span>创意雷达</span></button>}
        {session.workspace.can_view_spark_library && item("spark", <LightbulbFilamentRegular />)}
        {canViewIncentives && item("incentives", <SparkleRegular />)}
        {item("assistant", <BotRegular />)}
        {showOptimization && item("optimization", <PulseRegular />)}
        {(canManage || canViewLogs) && (
          <>
            <span className="nav-group-label">系统管理</span>
            {canViewLogs && item("logs", <ClipboardBulletListRegular />)}
            {canManage && item("permissions", <ShieldLockRegular />)}
          </>
        )}
      </nav>
      <div className="sidebar-footer"><SidebarIdentity session={session} /><button className="sidebar-logout" type="button" onClick={onLogout}>退出中枢</button></div>
    </aside>
  );
}

function shanghaiDate(daysAgo = 0) {
  const value = new Date(Date.now() - daysAgo * 86400000);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function formatMoney(value: number | null | undefined, compact = false) {
  if (value === null || value === undefined) return "待核验";
  if (compact && Math.abs(value) >= 10000) return `¥${(value / 10000).toFixed(2)}万`;
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function formatRate(value: number | null | undefined) {
  return value === null || value === undefined ? "待核验" : `${(value * 100).toFixed(1)}%`;
}

function BusinessIntelligencePage({ onAsk }: { onAsk: (prompt: string) => void }) {
  const yesterday = useMemo(() => shanghaiDate(1), []);
  const [selectedDate, setSelectedDate] = useState(yesterday);
  const [data, setData] = useState<BusinessIntelligenceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (target = selectedDate) => {
    setLoading(true);
    setError("");
    try {
      setData(await api.businessIntelligence(target, 7));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "经营数据查询失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(yesterday); }, [yesterday]);

  const maxProductSales = Math.max(...(data?.products.map((item) => item.effectiveSalesYuan) || [1]), 1);
  const queryDate = data?.query.productDate || selectedDate;
  const actualRange = data ? `${data.query.materialStartDate} 至 ${data.query.materialEndDate}` : "近7个完整自然日";

  return (
    <main className="hub-main business-main" id="main-content">
      <section className="business-hero">
        <div>
          <span>BUSINESS INTELLIGENCE</span>
          <h1>经营智能</h1>
          <p>把根数据成交、素材投放表现与中枢业务链路放在同一个可核验视图里。</p>
        </div>
        <div className={`business-state is-${data?.status || "loading"}`}>
          <i />
          <strong>{data?.status === "ready" ? "根数据已就绪" : data?.status === "stale" ? "展示上次成功快照" : loading ? "正在查询根数据" : "数据待核验"}</strong>
          <small>{data?.generatedAt ? `生成于 ${sourceTime(data.generatedAt)}` : "缺失数据不会按 0 展示"}</small>
        </div>
      </section>

      <section className="business-query-panel">
        <div className="business-date-field"><span>单品成交日期</span><input type="date" max={yesterday} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></div>
        <Button appearance="primary" icon={loading ? <Spinner size="tiny" /> : <SearchRegular />} disabled={loading || !selectedDate} onClick={() => void load()}>查询根数据</Button>
        <div className="business-query-shortcuts">
          <button type="button" onClick={() => { setSelectedDate(yesterday); void load(yesterday); }}>昨天各单品成交</button>
          <button type="button" onClick={() => document.getElementById("effective-materials")?.scrollIntoView({ behavior: "smooth" })}>近7天素材 TOP10</button>
          <button type="button" onClick={() => onAsk(`请根据经营智能中的 ${queryDate} 单品成交和 ${actualRange} 素材数据，解释素材有效率、主要发现和下一步建议。`)}>让 AI 解读</button>
        </div>
      </section>

      {error && <div className="business-alert is-error"><span>{error}</span><button type="button" onClick={() => void load()}><ArrowClockwiseRegular />重试</button></div>}
      {data?.coverage.warnings.map((warning) => <div className="business-alert" key={warning}><span>{warning}</span></div>)}
      {data && !data.automation.matchesRequest && <div className="business-alert is-stale"><span>所选日期刷新失败，当前实际展示 {data.query.productDate} 的上次成功快照。</span></div>}

      <section className="business-summary-grid" aria-label="经营摘要">
        <article><span>单品有效成交额</span><strong>{formatMoney(data?.summary.productEffectiveSalesYuan, true)}</strong><small>{queryDate} · WIS 抖店 SKU 实付</small></article>
        <article><span>有效订单数</span><strong>{data?.summary.effectiveOrderCount ?? "待核验"}</strong><small>按订单号去重，不重复累加单品订单</small></article>
        <article className="is-accent"><span>投放素材有效率</span><strong>{formatRate(data?.summary.effectiveMaterialRate)}</strong><small>{data?.summary.effectiveMaterialCount ?? "—"} 条有效 / {data?.summary.spentMaterialCount ?? "—"} 条有消耗“账户素材-天”</small></article>
        <article><span>{materialGmvLabel(data)}</span><strong>{formatMoney(data?.summary.materialAttributedGmvYuan, true)}</strong><small>{actualRange} · {isOfficialMaterial(data) ? "官方完整自然日视频报表 · 含平台券" : "千川 ROI2 归因口径"}</small></article>
        {isOfficialMaterial(data) && <article><span>视频实际支付归因金额</span><strong>{formatMoney(data?.summary.materialActualPayGmvYuan, true)}</strong><small>{actualRange} · 与含券成交分开统计</small></article>}
      </section>

      {loading && !data ? <section className="business-loading"><Spinner size="large" label="正在读取根数据并核对口径，首次查询可能需要约一分钟…" /></section> : null}

      {data && <>
        <section className="business-grid">
          <article className="business-card product-performance">
            <header><div><span>PRODUCT PERFORMANCE</span><h2>{queryDate} 各单品有效成交</h2></div><small>共 {data.products.length} 个标准分类</small></header>
            <div className="product-bars">
              {data.products.map((product, index) => (
                <div className={`product-bar-row${product.mapped ? "" : " is-unmapped"}`} key={product.standardProductName}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <div className="product-bar-label"><strong>{product.standardProductName}</strong><small>{product.orderCount} 单 · {product.productQuantity} 件 · {product.salesSharePct.toFixed(1)}%</small></div>
                  <div className="product-bar-track"><i style={{ width: `${Math.max(2, product.effectiveSalesYuan / maxProductSales * 100)}%` }} /></div>
                  <em>{formatMoney(product.effectiveSalesYuan)}</em>
                </div>
              ))}
              {!data.products.length && <div className="business-empty">所选日期没有返回可核验的单品成交明细。</div>}
            </div>
          </article>

          <aside className="business-quality-card">
            <header><DataBarVerticalRegular /><div><strong>数据质量与覆盖</strong><small>每项都保留真实分母</small></div></header>
            <div className="quality-stat"><span>单品销售映射率</span><strong>{formatRate(data.quality.productMappedSalesRate)}</strong><small>未归类金额 {formatMoney(data.quality.unclassifiedProductSalesYuan)}</small></div>
            <div className="quality-stat"><span>素材名称覆盖率</span><strong>{formatRate(data.quality.materialNameCoverageRate)}</strong><small>仅表示根数据账本是否有可读名称</small></div>
            <div className="quality-stat"><span>TOP候选 GMV 覆盖</span><strong>{formatRate(data.quality.topCandidateGmvCoverageRate)}</strong><small>{isOfficialMaterial(data) ? "官方视频候选占含券视频归因成交" : "每日标准与乘方高成交候选占全部素材归因 GMV"}</small></div>
            <div className="quality-stat"><span>TOP10 中枢链路覆盖</span><strong>{formatRate(data.quality.topMaterialLineageCoverageRate)}</strong><small>{data.quality.topMaterialLineageLinkedCount ?? 0} 条已匹配；未匹配不等于无来源</small></div>
            <div className="quality-source"><i /><span>{data.coverage.product.source}<small>更新：{data.coverage.product.sourceUpdatedAt || "待核验"}</small></span></div>
            <div className="quality-source"><i /><span>{data.coverage.material.source}<small>更新：{data.coverage.material.sourceUpdatedAt || "待核验"}</small></span></div>
          </aside>
        </section>

        <section className="business-card material-performance" id="effective-materials">
          <header><div><span>MATERIAL DISCOVERY</span><h2>{actualRange} 高成交候选 TOP10</h2><p>{isOfficialMaterial(data) ? "官方视频报表候选，按授权账户与素材聚合；" : "每日标准与乘方候选按素材ID合并；"}候选覆盖 {formatRate(data.quality.topCandidateGmvCoverageRate)} 的{materialGmvLabel(data)}。</p></div><Button appearance="secondary" icon={<BotRegular />} onClick={() => onAsk(`请分析 ${actualRange} 高成交候选 TOP10，指出值得复用的素材、链路待匹配项和下一步核验清单。`)}>让 AI 找规律</Button></header>
          <div className="material-table">
            <div className="material-table-head"><span>排名 / 素材</span><span>{materialGmvLabel(data)}</span><span>消耗 / {isOfficialMaterial(data) ? "含券 ROI" : "ROI"}</span><span>订单</span><span>根数据来源</span><span>中枢链路</span></div>
            {data.topMaterials.map((material, index) => (
              <article key={`${material.materialId}-${index}`}>
                <div className="material-identity"><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{material.materialName || `素材ID ${material.materialId}`}</strong><small>ID {material.materialId || "待核验"}</small></span></div>
                <div className="material-metric"><strong className="material-gmv">{formatMoney(material.gmvYuan)}</strong>{isOfficialMaterial(data) && <small>实际支付归因 {formatMoney(material.actualPayGmvYuan)}</small>}</div>
                <div className="material-metric"><strong>{formatMoney(material.costYuan)}</strong><small>ROI {material.roi === null ? "待核验" : material.roi.toFixed(2)}</small></div>
                <div className="material-metric"><strong>{materialOrderCount(material.orderCount)}</strong><small>{material.activeDayCount} 天产生数据</small></div>
                <div className="material-source"><strong>{material.sourcePlatforms.join(" + ") || "待核验"}</strong><small>{material.materialSource || "来源类型待匹配"}</small></div>
                <div className={`lineage-pill is-${material.lineage?.state || "unlinked"}`}><i /><span><strong>{material.lineage?.state === "linked" ? material.lineage.businessStage : "链路待匹配"}</strong><small>{material.lineage?.state === "linked" ? material.lineage.assetName : "不判定为无来源"}</small></span></div>
              </article>
            ))}
            {!data.topMaterials.length && <div className="business-empty">所选周期没有返回可核验的高成交素材候选。</div>}
          </div>
        </section>

        <section className="metric-definition-panel">
          <strong>口径说明</strong>
          <div>{Object.values(data.definitions).map((definition) => <p key={definition}>{definition}</p>)}</div>
        </section>
      </>}
    </main>
  );
}

type IncentiveFormState = {
  directionName: string;
  materialId: string;
  materialName: string;
  creatorName: string;
  center: string;
  onlineDate: string;
  originalityNote: string;
  copyJudgement: string;
  visualJudgement: string;
  voiceJudgement: string;
  remixPlan: string;
  referenceUrl: string;
};

function MaterialIncentivePage({ session, notify }: { session: HubSession; notify: (message: string) => void }) {
  const defaultCreator = identityValue(session.user.realName, session.user.name);
  const defaultCenter = identityValue(session.user.center, session.user.deptName, session.user.groupName);
  const emptyForm = (): IncentiveFormState => ({
    directionName: "",
    materialId: "",
    materialName: "",
    creatorName: defaultCreator,
    center: defaultCenter,
    onlineDate: shanghaiDate(),
    originalityNote: "",
    copyJudgement: "",
    visualJudgement: "",
    voiceJudgement: "",
    remixPlan: "",
    referenceUrl: "",
  });
  const [data, setData] = useState<CreativeIncentiveOverview | null>(null);
  const [form, setForm] = useState<IncentiveFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const setField = (key: keyof IncentiveFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const load = async () => {
    setLoading(true);
    setError("");
    try { setData(await api.creativeIncentives()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "素材激励数据读取失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const createDirection = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.creativeIncentiveCreate({
        direction_name: form.directionName,
        material_id: form.materialId,
        material_name: form.materialName,
        creator_name: form.creatorName,
        center: form.center,
        online_date: form.onlineDate,
        originality_note: form.originalityNote,
        copy_judgement: form.copyJudgement,
        visual_judgement: form.visualJudgement,
        voice_judgement: form.voiceJudgement,
        remix_plan: form.remixPlan,
        reference_url: form.referenceUrl,
      });
      setForm(emptyForm());
      setShowCreate(false);
      notify("原创方向已登记，需人工确认原创后才会计入2万元激励。");
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "原创方向登记失败"); }
    finally { setSaving(false); }
  };
  const confirmOriginality = async (id: string) => {
    try {
      await api.creativeIncentiveConfirm(id, true);
      notify("已人工确认为全新原创方向；后续按千川核验结果计分。");
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "原创确认失败"); }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api.creativeIncentiveSync(shanghaiDate(1), false);
      setData(result);
      const generated = result.sync?.generated || 0;
      notify(generated ? `千川数据已核验，新生成 ${generated} 条积分分享草稿。` : "千川数据已核验，本次没有新增积分节点。");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "千川数据同步失败"); }
    finally { setSyncing(false); }
  };
  const copyDraft = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("分享文案已复制，可直接粘贴到创意突破分享群。");
    } catch { notify("浏览器未允许复制，请手动选中文案复制。"); }
  };
  const markPublished = async (id: string, mode: "feishu" | "manual") => {
    try {
      const result = await api.creativeIncentivePublish(id, mode);
      if (result.shareStatus === "published") notify(mode === "feishu" ? "已发送到创意突破分享群。" : "已标记为群内发布完成。");
      else notify(result.deliveryError || "群消息尚未发送，草稿已保留。");
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "分享状态更新失败"); }
  };

  return <main className="hub-main incentive-main" id="main-content">
    <section className="incentive-hero">
      <div><span>MATERIAL INCENTIVE</span><h1>素材实时激励</h1><p>只奖励全新原创方向。人工确认原创，千川成交每满2万元计1分，并生成群分享文案。</p></div>
      <div className="incentive-hero-actions"><Button appearance="secondary" icon={syncing ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />} disabled={syncing} onClick={() => void sync()}>{syncing ? "核验中…" : "同步千川核验"}</Button><Button appearance="primary" icon={<AddRegular />} onClick={() => setShowCreate((current) => !current)}>{showCreate ? "收起登记" : "登记原创方向"}</Button></div>
    </section>

    <section className="incentive-rule-strip">
      <div><b>01</b><span><strong>全新原创</strong><small>必须由人员确认，系统不猜</small></span></div>
      <div><b>02</b><span><strong>成交满2万元</strong><small>千川ROI2素材归因GMV</small></span></div>
      <div><b>03</b><span><strong>每2万元 +1分</strong><small>2万完整分享，后续简报</small></span></div>
      <div><b>04</b><span><strong>群内即时激励</strong><small>草稿可直发或复制发布</small></span></div>
    </section>

    {showCreate && <form className="incentive-create-card" onSubmit={(event) => void createDirection(event)}>
      <header><div><span>NEW ORIGINAL DIRECTION</span><h2>登记全新原创方向</h2><p>前三项是核验最小字段；有效点信息用于首次2万元分享，可先登记后补充。</p></div><ShieldLockRegular /></header>
      <div className="incentive-form-grid">
        <label><span>原创方向 *</span><input required value={form.directionName} onChange={(event) => setField("directionName", event.target.value)} placeholder="例：95岁金句＋创新明星形象" /></label>
        <label><span>千川素材ID *</span><input required value={form.materialId} onChange={(event) => setField("materialId", event.target.value)} placeholder="用于匹配真实成交数据" /></label>
        <label><span>首次上线日期 *</span><input required type="date" max={shanghaiDate()} value={form.onlineDate} onChange={(event) => setField("onlineDate", event.target.value)} /></label>
        <label><span>素材名称</span><input value={form.materialName} onChange={(event) => setField("materialName", event.target.value)} placeholder="未返回时可待回补" /></label>
        <label><span>创作者</span><input value={form.creatorName} onChange={(event) => setField("creatorName", event.target.value)} /></label>
        <label><span>所属中心</span><input value={form.center} onChange={(event) => setField("center", event.target.value)} placeholder="个人视角会按OA身份约束" /></label>
      </div>
      <details className="incentive-share-details">
        <summary>补充首次达标分享信息（推荐）</summary>
        <div className="incentive-form-grid is-notes">
          <label><span>原创说明</span><textarea value={form.originalityNote} onChange={(event) => setField("originalityNote", event.target.value)} placeholder="为什么这是一个全新方向" /></label>
          <label><span>文案有效点</span><textarea value={form.copyJudgement} onChange={(event) => setField("copyJudgement", event.target.value)} placeholder="开头、人群、痛点、金句等" /></label>
          <label><span>画面有效点</span><textarea value={form.visualJudgement} onChange={(event) => setField("visualJudgement", event.target.value)} placeholder="前三秒、人物、产品、效果画面等" /></label>
          <label><span>声音有效点</span><textarea value={form.voiceJudgement} onChange={(event) => setField("voiceJudgement", event.target.value)} placeholder="声音类型、语气、节奏等" /></label>
          <label><span>后续裂变</span><textarea value={form.remixPlan} onChange={(event) => setField("remixPlan", event.target.value)} placeholder="可替换产品、开头、人物或结尾" /></label>
          <label><span>参考素材链接</span><textarea value={form.referenceUrl} onChange={(event) => setField("referenceUrl", event.target.value)} placeholder="飞书、素材库或可访问链接" /></label>
        </div>
      </details>
      <footer><Button appearance="secondary" type="button" onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" type="submit" disabled={saving} icon={saving ? <Spinner size="tiny" /> : <AddRegular />}>{saving ? "登记中…" : "完成登记"}</Button></footer>
    </form>}

    {error && <div className="business-alert is-error"><span>{error}</span><button onClick={() => void load()}><ArrowClockwiseRegular />重试</button></div>}
    <section className="incentive-summary-grid">
      <article><span>已登记方向</span><strong>{data?.summary.directionCount ?? "—"}</strong><small>{data?.access.label || "当前权限范围"}</small></article>
      <article><span>已确认原创</span><strong>{data?.summary.confirmedCount ?? "—"}</strong><small>未经人工确认不计分</small></article>
      <article className="is-hit"><span>达到2万元</span><strong>{data?.summary.qualifiedCount ?? "—"}</strong><small>缺失与未匹配保持待核验</small></article>
      <article><span>累计积分</span><strong>{data?.summary.totalPoints ?? "—"}</strong><small>{data?.summary.pendingDraftCount ?? "—"} 条群分享待完成</small></article>
    </section>

    {loading && !data ? <section className="business-loading"><Spinner size="large" label="正在读取原创方向与积分台账…" /></section> : null}
    {data && <section className="incentive-directions">
      <header><div><span>VERIFIED DIRECTIONS</span><h2>原创方向与积分台账</h2></div><small>来源截至：{data.directions.find((item) => item.sourceCutoffAt)?.sourceCutoffAt || "待核验"}</small></header>
      {data.directions.map((direction) => {
        const progress = direction.latestGmvYuan === null ? null : Math.min(100, direction.latestGmvYuan / direction.nextThresholdGmvYuan * 100);
        return <article className="incentive-direction-card" key={direction.id}>
          <div className="incentive-direction-head">
            <span className={`originality-badge is-${direction.originalityStatus}`}><i />{direction.originalityStatus === "confirmed" ? "已确认全新原创" : direction.originalityStatus === "rejected" ? "未通过原创确认" : "待人工确认原创"}</span>
            <span className="incentive-points">{direction.earnedPoints} 分</span>
          </div>
          <div className="incentive-direction-body">
            <div><span>{direction.center || "中心待回补"} · {direction.creatorName}</span><h3>{direction.directionName}</h3><p>{direction.materialName || "素材名称待回补"} · ID {direction.materialId}</p></div>
            <dl><div><dt>千川归因成交</dt><dd>{formatMoney(direction.latestGmvYuan, true)}</dd></div><div><dt>消耗 / ROI</dt><dd>{formatMoney(direction.latestCostYuan, true)} / {direction.latestRoi === null ? "待核验" : direction.latestRoi.toFixed(2)}</dd></div><div><dt>下一积分节点</dt><dd>{formatMoney(direction.nextThresholdGmvYuan, true)}</dd></div></dl>
          </div>
          <div className={`incentive-progress${progress === null ? " is-pending" : ""}`}><i style={{ width: progress === null ? "0" : `${progress}%` }} /><span>{progress === null ? "成交数据待核验" : `${progress.toFixed(0)}%`}</span></div>
          <footer className="incentive-direction-actions">
            <small>{direction.metricStatus === "unmatched" ? "当前高成交候选未匹配到该素材，未按0处理" : `数据截至 ${direction.sourceCutoffAt || direction.sourceUpdatedAt || "待核验"}`}</small>
            {direction.originalityStatus === "pending" && <Button appearance="primary" size="small" icon={<CheckmarkCircleFilled />} onClick={() => void confirmOriginality(direction.id)}>人工确认原创</Button>}
          </footer>
          {direction.milestones.length > 0 && <div className="incentive-milestones">
            {direction.milestones.map((milestone) => <article key={milestone.id} className={`incentive-milestone is-${milestone.shareStatus}`}>
              <header><span><b>+1分</b><strong>{milestone.shareType === "full" ? "首次2万元完整分享" : `${milestone.thresholdGmvYuan / 10000}万元进阶播报`}</strong></span><em>{milestone.shareStatus === "published" ? "已发群" : "待分享"}</em></header>
              <pre>{milestone.shareText}</pre>
              {milestone.shareStatus !== "published" && <footer><Button appearance="secondary" size="small" onClick={() => void copyDraft(milestone.shareText)}>复制分享文案</Button>{data.groupDelivery.configured && <Button appearance="primary" size="small" icon={<SendRegular />} onClick={() => void markPublished(milestone.id, "feishu")}>发送到群</Button>}<Button appearance="subtle" size="small" onClick={() => void markPublished(milestone.id, "manual")}>我已发群</Button></footer>}
              {milestone.deliveryError && <small>{milestone.deliveryError}</small>}
            </article>)}
          </div>}
        </article>;
      })}
      {!data.directions.length && <div className="incentive-empty"><SparkleRegular /><strong>还没有登记原创方向</strong><p>先登记真实上线素材；人工确认原创后，系统再按2万元节点计分。</p></div>}
    </section>}
    <section className="metric-definition-panel"><strong>边界说明</strong><div><p>{data?.rule.metric || "千川素材归因成交口径"}</p><p>{data?.groupDelivery.fallback || "群发布状态以实际发送为准"}</p></div></section>
  </main>;
}

function ModuleCard({ module, canAccess, launching, onAction, onWarm }: { module: AppModule; canAccess: boolean; launching: boolean; onAction: (module: AppModule) => void; onWarm: (module: AppModule) => void }) {
  const isBuilding = module.status === "building";
  const buttonText = launching ? "正在打开" : !canAccess ? "未开通权限" : isBuilding ? module.id === "live-room-management" ? "服务待恢复" : "正在接入" : "进入系统";
  return (
    <article className={`module-card${canAccess ? "" : " is-restricted"}`} aria-labelledby={`module-${module.id}`}>
      <span className="module-number">{module.index}</span>
      <span className="module-icon" aria-hidden="true">{moduleIcons[module.id]}</span>
      <div className="module-copy">
        <h2 id={`module-${module.id}`}>{module.purpose}</h2>
        <p>{module.title}</p>
      </div>
      <Button
        className="module-entry-button"
        appearance="subtle"
        iconPosition="after"
        icon={launching ? <Spinner size="tiny" /> : <ChevronRightRegular />}
        disabled={launching}
        onClick={() => onAction(module)}
        onPointerEnter={() => onWarm(module)}
        onFocus={() => onWarm(module)}
      >
        {buttonText}
      </Button>
    </article>
  );
}

function WorkspacePublicSummary({ session }: { session: HubSession }) {
  const [summary, setSummary] = useState<WorkspaceHomeSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!session.workspace.can_view_public_summary) return;
    let active = true;
    let retryTimer = 0;
    const load = async (attempt = 0) => {
      try {
        const value = await api.workspaceSummary();
        if (!active) return;
        setSummary(value);
        setError("");
        if (value.status === "pending" && attempt < 2) {
          retryTimer = window.setTimeout(() => void load(attempt + 1), 3_000 + attempt * 3_000);
        }
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "公开经营摘要暂时不可用");
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [session.workspace.can_view_public_summary]);
  if (!session.workspace.can_view_public_summary) return null;
  return (
    <section className="workspace-summary-card" aria-labelledby="workspace-summary-title">
      <header>
        <div><span>PUBLIC PERFORMANCE</span><h2 id="workspace-summary-title">部门公开经营摘要</h2></div>
        <em>{summary?.generatedAt ? `快照生成 ${sourceTime(summary.generatedAt)}` : "快照时间待核验"}</em>
      </header>
      {error ? <p className="workspace-summary-note is-error">{error}</p> : (
        <>
          <div className="workspace-summary-metrics">
            <article><small>{combinedBusinessDateLabel(summary?.channels)} · 抖店＋视频号有效 GSV</small><strong>{summary ? formatMoney(summary.totalGsvYuan, true) : "读取中"}</strong></article>
            {(summary?.channels || []).map((channel) => <article key={channel.key}><small>{channel.label} · {businessDateLabel(channel.todayDate)}</small><strong>{formatMoney(channel.todayTotalYuan, true)}</strong><small>来源更新 {sourceTime(channel.sourceUpdatedAt)}</small></article>)}
          </div>
          <p className="workspace-summary-note">{summary?.note || "根数据公开摘要正在后台读取；未返回前不按 0 展示。"}</p>
        </>
      )}
    </section>
  );
}


function HubHome({ session, notify, onOpenModule }: { session: HubSession; notify: (message: string) => void; onOpenModule: (moduleId: string) => void }) {
  const [routeOrder,setRouteOrder] = useState<string[]>([]);
  const allowed = new Set(session.access.allowed_modules);
  const visibleModules = modules.filter((module) => allowed.has(module.id)).sort((a,b)=>{
    const ai=routeOrder.indexOf(a.id),bi=routeOrder.indexOf(b.id);
    return (ai<0?routeOrder.length:ai)-(bi<0?routeOrder.length:bi);
  });
  const workspace = session.workspace;
  const name = identityValue(session.user.realName, session.user.name) || "当前成员";
  const hero = workspace.role === "director"
    ? { eyebrow: "DEPARTMENT MANAGEMENT", title: "品牌营销部管理首页", description: "查看全部门经营、组织状态、管理待办与已授权业务模块。" }
    : workspace.role === "manager"
      ? { eyebrow: "CENTER MANAGEMENT", title: `${workspace.center || "本中心"}管理与待办`, description: "聚焦本中心经营、团队情况、待处理事项与岗位所需模块。" }
      : workspace.role === "specialist"
        ? { eyebrow: "PERSONAL WORKSPACE", title: `${name}的个人工作台`, description: "" }
        : workspace.role === "maintainer"
          ? { eyebrow: "SYSTEM MAINTENANCE", title: "系统开发维护工作台", description: "以独立维护身份进行系统验收，不参与组织层级归属。" }
          : { eyebrow: "AUTHORIZED MODULES", title: "我的业务入口", description: "只展示当前账号已经明确授权的业务模块。" };
  const [launching, setLaunching] = useState("");
  const warmedModules = useRef(new Set<string>());
  const warmModule = (module: AppModule) => {
    if (!allowed.has(module.id) || module.status === "building" || !module.url || warmedModules.current.has(module.id)) return;
    warmedModules.current.add(module.id);
    const origin = new URL(module.url, window.location.href).origin;
    if (origin !== window.location.origin && !document.head.querySelector(`link[data-module-origin="${origin}"]`)) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.dataset.moduleOrigin = origin;
      document.head.append(link);
    }
    void api.warmLaunch(module.id);
  };
  const openModule = (module: AppModule) => {
    if (!allowed.has(module.id)) {
      notify(`${module.title}未在当前账号的可用界面范围内。`);
      return;
    }
    if (module.status === "building" || !module.url) {
      notify(module.id === "live-room-management" ? module.description : `${module.title}正在接入，正式地址配置后即可进入。`);
      return;
    }
    setLaunching(module.id);
    onOpenModule(module.id);
    window.setTimeout(() => setLaunching((current) => current === module.id ? "" : current), 1200);
  };

  return (
    <main className="hub-main" id="main-content">
      <section className={`hero-panel workspace-hero role-${workspace.role}`}>
        <h1>{hero.title}</h1>
        {hero.description && <p>{hero.description}</p>}
        {workspace.role !== "specialist" && <div className="workspace-hero-meta">
          <span><b>身份</b>{workspace.role_label}</span>
          <span><b>数据范围</b>{workspace.dashboard_scope === "department" ? "全部门" : workspace.dashboard_scope === "center" ? workspace.center || "本中心" : "按模块授权"}</span>
          <span><b>业务模块</b>{visibleModules.length} 个</span>
        </div>}
      </section>
      <FlowInboxSummary session={session} onRouteOrder={setRouteOrder} />
      <WorkspacePublicSummary session={session} />
      {(workspace.role === "director" || workspace.role === "manager") && (
        <section className="workspace-management-strip" aria-label="管理工作摘要">
          <article><span>01</span><div><strong>{workspace.role === "director" ? "部门经营与组织" : "本中心经营与团队"}</strong><p>{workspace.role === "director" ? "首屏进入部门管理视图" : `范围锁定 ${workspace.center || "本中心"} 及下属成员`}</p></div></article>
          <article><span>02</span><div><strong>管理待办</strong><p>从对应业务模块读取真实审核事项；未返回时不补 0</p></div></article>
          <article><span>03</span><div><strong>权限口径</strong><p>{workspace.module_policy_state === 'highest-business-access' ? '来自当前最高权限授权，业务界面统一开放' : workspace.module_policy_state.startsWith('admin-configured') ? '来自管理员当前保存的角色与界面配置' : `岗位模块来自映射表 revision ${workspace.policy_source.revision}`}</p></div></article>
        </section>
      )}
      <section className={`flow-panel${workspace.role === "specialist" ? " is-personal" : ""}`} aria-labelledby="flow-title">
        <header className="flow-heading">
          {workspace.role === "specialist"
            ? <div><h2 id="flow-title">我的应用</h2></div>
            : <><div><span>岗位模块</span><h2 id="flow-title">岗位业务入口</h2></div><p>{visibleModules.length ? `${visibleModules.length} 个可用入口` : "当前没有可用业务模块"}</p></>}
        </header>
        {visibleModules.length ? (
          <div className="role-module-grid">
            {visibleModules.map((module,index) => <ModuleCard key={module.id} module={{...module,index:String(index+1).padStart(2,'0')}} canAccess launching={launching === module.id} onAction={openModule} onWarm={warmModule} />)}
          </div>
        ) : (
          <div className="workspace-empty-state"><ShieldLockRegular /><strong>当前未配置岗位模块</strong><p>系统不会自动补成六个全开；请先在人员映射表中明确岗位权限。</p></div>
        )}
      </section>
    </main>
  );
}

function EmbeddedModulePage({ module, onReturn }: { module: AppModule; onReturn: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  useEffect(() => { setLoaded(false); setFailed(false); setSessionAttempt(0); }, [module.id]);
  const frameUrl = useMemo(() => {
    if (!module.url) return "about:blank";
    const target = new URL(module.url, window.location.href);
    target.searchParams.set("hub_embed_release", "20260921-r9");
    target.searchParams.set("hub_session_attempt", String(sessionAttempt));
    const linkedAsset = module.id === 'cloud-manager' ? embeddedCloudAsset(window.location.hash) : null;
    if (linkedAsset) {
      target.searchParams.set('asset_id', linkedAsset.id);
      if (linkedAsset.etag) target.searchParams.set('asset_etag', linkedAsset.etag);
    }
    return `${target.pathname}${target.search}${target.hash}`;
  }, [module.url, sessionAttempt]);
  const handleFrameLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    setLoaded(true);
    try {
      const current = new URL(event.currentTarget.contentWindow?.location.href || "");
      const staleServiceDenial = current.pathname.endsWith("/access-denied.html")
        && current.searchParams.get("reason") === "service";
      if (staleServiceDenial && sessionAttempt < 1) {
        setLoaded(false);
        window.setTimeout(() => setSessionAttempt(value => value + 1), 250);
      }
    } catch {
      // A genuinely external module is allowed to load without frame inspection.
    }
  };
  return (
    <main className="embedded-module-page" aria-label={`${module.purpose}工作区`}>
      <header className="embedded-module-toolbar">
        <span>{module.title}</span>
        <Button appearance="subtle" size="small" icon={<ChevronLeftRegular />} onClick={onReturn}>返回工作首页</Button>
      </header>
      {!loaded && !failed && <p role="status">正在载入{module.purpose}…</p>}
      {failed && <p role="alert">业务页面暂时无法载入。请返回中枢，原任务与交付仍保留。</p>}
      <iframe
        key={module.id}
        className="embedded-module-frame"
        title={module.purpose}
        src={frameUrl}
        onLoad={handleFrameLoad}
        onError={() => setFailed(true)}
        allowFullScreen
      />
    </main>
  );
}

const assistantWelcome: AssistantMessage = {
  id: "welcome",
  role: "assistant",
  content: "你好，我是 WIS AI 中枢管家。我已经了解六段业务路线和你当前可访问的界面，可以协助查找入口、梳理流程、排查问题并提出优化建议。当前为只读阶段，不会自行修改权限、数据或生产系统。",
};

const assistantPrompts = [
  "根据完整业务路线，帮我判断应该从哪个模块开始工作",
  "素材已经推送但没有数据回流，应该按什么顺序排查",
  "检查中枢目前可能有哪些体验和流程可以优化",
  "帮我打开 WIS 素材工作台",
];

function AssistantText({ content }: { content: string }) {
  const renderLine = (line: string, lineIndex: number) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return <p key={`${lineIndex}-${line}`}>{parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>
      : part)}</p>;
  };
  return (
    <div className="assistant-rich-text">{content.split("\n").map(renderLine)}</div>
  );
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("无法读取图片，请重新选择"));
    reader.readAsDataURL(file);
  });
}

function formatConversationTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const today = new Date();
  return parsed.toDateString() === today.toDateString()
    ? parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : parsed.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function assistantPreviewUrl(value: string) {
  return value.replace(/^\/+/, "");
}

const assistantMessageCache = new Map<string, AssistantMessage[]>();

function AssistantPage({
  session,
  notify,
  initialRequest,
  onInitialRequestConsumed,
  onOpenModule,
}: {
  session: HubSession;
  notify: (message: string) => void;
  initialRequest: AssistantRequest | null;
  onInitialRequestConsumed: (requestId: string) => void;
  onOpenModule: (moduleId: string) => void;
}) {
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<AssistantAttachment[]>([]);
  const [error, setError] = useState("");
  const [retryPrompt, setRetryPrompt] = useState("");
  const [requestSource, setRequestSource] = useState("");
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const refreshAssistantStatus = async () => {
    setStatusLoading(true);
    setStatusError("");
    try { setStatus(await api.assistantStatus()); }
    catch { setStatus(null); setStatusError("AI 服务状态读取未完成，请重试；已填写内容和历史对话保留。"); }
    finally { setStatusLoading(false); }
  };
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeIdRef = useRef("");
  const messageCacheRef = useRef(assistantMessageCache);
  const consumedRequestIdRef = useRef("");
  const allowed = useMemo(() => new Set(session.access.allowed_modules), [session.access.allowed_modules]);
  const activeConversation = conversations.find((item) => item.id === activeId) || null;
  const visibleConversations = useMemo(() => {
    const keyword = conversationQuery.trim().toLocaleLowerCase("zh-CN");
    return keyword ? conversations.filter((item) => `${item.title} ${item.last_message_preview}`.toLocaleLowerCase("zh-CN").includes(keyword)) : conversations;
  }, [conversationQuery, conversations]);

  useEffect(() => {
    void refreshAssistantStatus();
    const bootstrap = async () => {
      setLoadingHistory(true);
      try {
        const result = await api.assistantConversations();
        setConversations(result.items);
        if (result.items[0]) {
          activeIdRef.current = result.items[0].id;
          setActiveId(result.items[0].id);
          setLoadingMessages(true);
          const history = await api.assistantMessages(result.items[0].id);
          messageCacheRef.current.set(result.items[0].id, history.items);
          setMessages(history.items);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法读取个人对话记录");
      } finally {
        setLoadingHistory(false);
        setLoadingMessages(false);
      }
    };
    void bootstrap();
  }, []);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, loadingMessages]);

  const refreshConversations = async (preferred?: AssistantConversation) => {
    const result = await api.assistantConversations();
    const items = preferred
      ? [preferred, ...result.items.filter((item) => item.id !== preferred.id)]
      : result.items;
    setConversations(items);
  };

  const ensureConversation = async () => {
    const currentId = activeIdRef.current;
    if (currentId) {
      const current = conversations.find((item) => item.id === currentId);
      if (current) return current;
    }
    const created = await api.assistantConversationCreate();
    activeIdRef.current = created.id;
    setActiveId(created.id);
    setMessages([]);
    setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    return created;
  };

  const discardPendingAttachments = async () => {
    const items = [...pendingAttachments];
    setPendingAttachments([]);
    if (items.length) await Promise.allSettled(items.map((item) => api.assistantAttachmentDelete(item.id)));
  };

  const selectConversation = async (id: string) => {
    if (id === activeIdRef.current || busy || uploading) return;
    await discardPendingAttachments();
    activeIdRef.current = id;
    setActiveId(id);
    const cachedMessages = messageCacheRef.current.get(id);
    setMessages(cachedMessages || []);
    setError("");
    setRetryPrompt("");
    setRequestSource("");
    setLoadingMessages(!cachedMessages);
    try {
      const nextMessages = (await api.assistantMessages(id)).items;
      messageCacheRef.current.set(id, nextMessages);
      if (activeIdRef.current === id) setMessages(nextMessages);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取这段对话"); }
    finally { setLoadingMessages(false); }
  };

  const createConversation = async () => {
    if (busy || uploading) return;
    await discardPendingAttachments();
    const created = await api.assistantConversationCreate();
    activeIdRef.current = created.id;
    setActiveId(created.id);
    setMessages([]);
    setInput("");
    setError("");
    setRetryPrompt("");
    setRequestSource("");
    setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
  };

  const renameConversation = async (conversation: AssistantConversation) => {
    const next = window.prompt("修改会话名称", conversation.title)?.trim();
    if (!next || next === conversation.title) return;
    try {
      const updated = await api.assistantConversationUpdate(conversation.id, next);
      setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "修改会话名称失败"); }
  };

  const deleteConversation = async (conversation: AssistantConversation) => {
    if (!window.confirm(`确认删除会话“${conversation.title}”？其中的消息和图片将一并删除且无法恢复。`)) return;
    try {
      await api.assistantConversationDelete(conversation.id);
      messageCacheRef.current.delete(conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (activeIdRef.current === conversation.id) {
        activeIdRef.current = "";
        setActiveId("");
        setMessages([]);
        if (remaining[0]) void selectConversation(remaining[0].id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除会话失败"); }
  };

  const openAction = (moduleKey: string) => {
    const target = modules.find((item) => item.id === moduleKey);
    if (!target || !allowed.has(moduleKey)) {
      notify("当前账号未开通该界面权限。");
      return;
    }
    if (target.status === "building" || !target.url) {
      notify(target.id === "live-room-management" ? target.description : `${target.title}正在接入，正式地址配置后即可进入。`);
      return;
    }
    onOpenModule(moduleKey);
  };

  const send = async (preset?: string, reuseLastUserMessage = false) => {
    const content = (preset ?? input).trim();
    if ((!content && !pendingAttachments.length && !reuseLastUserMessage) || busy || uploading) return;
    let conversation: AssistantConversation;
    try { conversation = await ensureConversation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建个人会话"); return; }
    const tempId = `pending-${Date.now()}`;
    if (!reuseLastUserMessage) setMessages((current) => [...current, {
      id: tempId,
      role: "user",
      content: content || "请分析我上传的图片。",
      attachments: pendingAttachments,
    }]);
    const attachmentIds = pendingAttachments.map((item) => item.id);
    setInput("");
    setError("");
    setRetryPrompt("");
    setBusy(true);
    try {
      const result = await api.assistantChat({
        conversation_id: conversation.id,
        content,
        attachment_ids: attachmentIds,
        reuse_last_user_message: reuseLastUserMessage,
        current_view: "AI管家",
      });
      setPendingAttachments([]);
      if (result.user_message && result.assistant_message) {
        setMessages((current) => {
          const nextMessages = [
            ...current.filter((item) => item.id !== tempId),
            ...(reuseLastUserMessage ? [] : [result.user_message as AssistantMessage]),
            result.assistant_message as AssistantMessage,
          ];
          messageCacheRef.current.set(conversation.id, nextMessages);
          return nextMessages;
        });
      } else {
        const nextMessages = (await api.assistantMessages(conversation.id)).items;
        messageCacheRef.current.set(conversation.id, nextMessages);
        setMessages(nextMessages);
      }
      if (result.conversation) await refreshConversations(result.conversation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 管家暂时无法回答，请稍后重试");
      setRetryPrompt(content || "请分析我上传的图片。");
      setPendingAttachments([]);
      try {
        const nextMessages = (await api.assistantMessages(conversation.id)).items;
        messageCacheRef.current.set(conversation.id, nextMessages);
        setMessages(nextMessages);
      } catch { /* 保留当前错误信息 */ }
    } finally {
      setBusy(false);
    }
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length || uploading || busy) return;
    const remaining = Math.max(0, 4 - pendingAttachments.length);
    const selected = Array.from(files).slice(0, remaining);
    if (!selected.length) { setError("每次最多上传 4 张图片"); return; }
    const supported = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const invalid = selected.find((file) => !supported.has(file.type) || file.size > 8 * 1024 * 1024);
    if (invalid) { setError("仅支持 PNG、JPG、WEBP、GIF，且单张不超过 8 MB"); return; }
    setUploading(true);
    setError("");
    try {
      const conversation = await ensureConversation();
      const results = await Promise.allSettled(selected.map(async (file) => {
        const dataUrl = await fileAsDataUrl(file);
        return api.assistantAttachmentUpload(conversation.id, file.name, file.type, dataUrl.split(",", 2)[1] || "");
      }));
      const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      setPendingAttachments((current) => [...current, ...uploaded]);
      if (uploaded.length !== selected.length) setError(`${selected.length - uploaded.length} 张图片上传失败，其余图片已保留`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片上传失败"); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePendingAttachment = async (attachment: AssistantAttachment) => {
    setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
    try { await api.assistantAttachmentDelete(attachment.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "图片移除失败"); }
  };

  useEffect(() => {
    if (loadingHistory || statusLoading || !initialRequest || consumedRequestIdRef.current === initialRequest.id) return;
    consumedRequestIdRef.current = initialRequest.id;
    setRequestSource(initialRequest.source);
    onInitialRequestConsumed(initialRequest.id);
    void send(initialRequest.prompt);
  }, [initialRequest?.id, loadingHistory, statusLoading]);

  return (
    <main className="hub-main assistant-main assistant-conversation-page" id="main-content">
      <section className="assistant-topbar">
        <div><span>WIS AI OPERATIONS</span><h1>AI 中枢管家</h1><p>连续对话、图片理解和业务数据查询都保存在你的个人会话中。</p></div>
        <div className="assistant-connection" role="status"><i /><span><strong>{statusLoading ? "正在读取 AI 服务状态" : statusError ? "AI 服务状态读取失败" : status?.configured ? "AI 服务已配置，调用待验证" : "AI 模型尚未配置"}</strong><small>{statusLoading ? "正在核对服务端配置" : statusError || (status?.configured ? `${status.provider} · 文本 ${status.model} · 实际可用性以本次回答为准` : "模型分析暂不可用；历史对话和已有权限内的数据查询保留")}</small></span><Button appearance="subtle" disabled={statusLoading} onClick={() => void refreshAssistantStatus()}>刷新状态</Button></div>
      </section>

      <section className="assistant-conversation-shell">
        <aside className="assistant-history-panel">
          <header><div><strong>我的对话</strong><small>仅当前 OA 账号可见</small></div><button type="button" aria-label="新建对话" onClick={() => void createConversation()} disabled={busy || uploading}><AddRegular /></button></header>
          <div className="assistant-history-search"><SearchRegular /><input value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder="搜索对话" /></div>
          <div className="assistant-history-list">
            {loadingHistory && <div className="assistant-history-empty"><Spinner size="tiny" /><span>正在读取历史记录</span></div>}
            {!loadingHistory && visibleConversations.map((conversation) => (
              <div className={`assistant-history-item${conversation.id === activeId ? " active" : ""}`} key={conversation.id}>
                <button className="assistant-history-main" type="button" onClick={() => void selectConversation(conversation.id)}>
                  <strong>{conversation.title}</strong><span>{conversation.last_message_preview || "还没有消息"}</span><small>{conversation.message_count} 条 · {formatConversationTime(conversation.updated_at)}</small>
                </button>
                {conversation.id === activeId && <div className="assistant-history-actions"><button type="button" aria-label="重命名" onClick={() => void renameConversation(conversation)}><EditRegular /></button><button type="button" aria-label="删除会话" onClick={() => void deleteConversation(conversation)}><DeleteRegular /></button></div>}
              </div>
            ))}
            {!loadingHistory && !visibleConversations.length && <div className="assistant-history-empty"><ChatMultipleRegular /><span>{conversationQuery ? "没有匹配的对话" : "发送第一条消息后，会话会保存在这里"}</span></div>}
          </div>
          <footer><ShieldLockRegular /><span>管理员只能看到接口调用日志，不能查看你的消息内容。</span></footer>
        </aside>

        <article className="assistant-chat-card assistant-chat-conversation">
          <header>
            <div><ChatMultipleRegular /><span><strong>{activeConversation?.title || "新对话"}</strong><small>支持连续追问，保留完整上下文</small></span></div>
            <Button appearance="subtle" icon={<AddRegular />} onClick={() => void createConversation()} disabled={busy || uploading}>新建对话</Button>
          </header>
          {requestSource && <div className="assistant-request-source"><BotRegular /><span>已接收来自<strong>{requestSource}</strong>的一键提问，{busy ? "正在结合当前可见数据分析" : "请在下方查看发送结果；未发送时问题保留在输入框"}</span></div>}
          <div className="assistant-messages" aria-live="polite">
            {loadingMessages && <div className="assistant-message-loading"><Spinner size="small" label="正在读取这段对话…" /></div>}
            {!loadingMessages && !messages.length && [assistantWelcome].map((message) => (
              <section className="assistant-message is-assistant is-welcome" key={message.id}><span className="assistant-message-mark"><BotRegular /></span><div className="assistant-message-body"><AssistantText content={message.content} /><div className="assistant-welcome-capabilities"><span>连续追问</span><span>查询根数据</span><span>分析图片</span><span>发现有效素材</span></div></div></section>
            ))}
            {!loadingMessages && messages.map((message) => (
              <section className={`assistant-message is-${message.role}`} key={message.id}>
                <span className="assistant-message-mark">{message.role === "assistant" ? <BotRegular /> : "我"}</span>
                <div className="assistant-message-body">
                  {message.attachments?.length ? <div className="assistant-message-images">{message.attachments.map((attachment) => <a href={assistantPreviewUrl(attachment.preview_url)} target="_blank" rel="noreferrer" key={attachment.id}><img src={assistantPreviewUrl(attachment.preview_url)} alt={attachment.filename} loading="lazy" decoding="async" /><span>{attachment.filename}</span></a>)}</div> : null}
                  <AssistantText content={message.content} />
                  {message.actions?.length ? (
                    <div className="assistant-message-actions">
                      {message.actions.map((action) => <Button key={action.module_key} appearance="secondary" icon={<ChevronRightRegular />} iconPosition="after" onPointerEnter={() => void api.warmLaunch(action.module_key)} onFocus={() => void api.warmLaunch(action.module_key)} onClick={() => openAction(action.module_key)}>{action.label}</Button>)}
                    </div>
                  ) : null}
                  {message.meta?.model && (
                    <>
                      <small className="assistant-meta">{message.meta.model} · 只读分析 · {(message.meta.latency_ms / 1000).toFixed(1)} 秒</small>
                      {message.meta.context_sources?.length ? <div className="assistant-source-row">{message.meta.context_sources.map((source) => <span key={source}>{source}</span>)}</div> : null}
                    </>
                  )}
                </div>
              </section>
            ))}
            {busy && (
              <section className="assistant-message is-assistant is-thinking">
                <span className="assistant-message-mark"><BotRegular /></span>
                <div className="assistant-message-body"><div className="thinking-dots"><i /><i /><i /></div><small>正在理解上下文，核对业务数据与图片证据…</small></div>
              </section>
            )}
            <div ref={endRef} />
          </div>
          {error && <div className="assistant-error"><span>{error}</span><div>{retryPrompt && <button type="button" disabled={busy} onClick={() => void send(retryPrompt, true)}>重新发送</button>}<button type="button" onClick={() => { setError(""); setRetryPrompt(""); }}>关闭</button></div></div>}
          <footer className="assistant-composer assistant-modern-composer">
            {pendingAttachments.length ? <div className="assistant-pending-images">{pendingAttachments.map((attachment) => <div key={attachment.id}><img src={assistantPreviewUrl(attachment.preview_url)} alt={attachment.filename} /><span>{attachment.filename}</span><button type="button" aria-label={`移除${attachment.filename}`} onClick={() => void removePendingAttachment(attachment)}><DismissRegular /></button></div>)}</div> : null}
            <textarea
              value={input}
              maxLength={6000}
              rows={3}
              placeholder="输入问题，支持连续追问；也可以上传业务截图、数据图表或素材图片…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => void uploadImages(event.target.files)} />
            <div className="assistant-composer-actions"><Button appearance="subtle" icon={uploading ? <Spinner size="tiny" /> : <AttachRegular />} disabled={busy || uploading || pendingAttachments.length >= 4} onClick={() => fileInputRef.current?.click()}>{uploading ? "上传中" : "上传图片"}</Button><span>Enter 发送 · Shift + Enter 换行 · 图片最多 4 张</span><Button appearance="primary" icon={<SendRegular />} disabled={busy || uploading || (!input.trim() && !pendingAttachments.length)} onClick={() => void send()}>{busy ? "思考中…" : "发送"}</Button></div>
          </footer>
        </article>

        <aside className="assistant-context-panel">
          <section className="assistant-context-block">
            <header><PulseRegular /><span><strong>实时上下文</strong><small>随登录权限自动更新</small></span></header>
            <div className="assistant-context-stat"><strong>{session.access.allowed_modules.length}</strong><span>当前可访问界面</span></div>
            <p>AI 只会推荐当前账号有权限的入口，目标系统仍会再次校验。</p>
          </section>
          <section className="assistant-context-block">
            <header><WrenchRegular /><span><strong>可以帮你</strong><small>连续对话 · 真实证据</small></span></header>
            <ul>{(status?.capabilities || ["业务问答", "模块导航", "故障排查", "优化建议"]).map((capability) => <li key={capability}><CheckmarkCircleFilled />{capability}</li>)}</ul>
          </section>
          <section className="assistant-quick-block">
            <header><SparkleRegular /><strong>试着这样问</strong></header>
            {assistantPrompts.map((prompt) => <button type="button" key={prompt} disabled={busy} onClick={() => void send(prompt)}>{prompt}<ChevronRightRegular /></button>)}
          </section>
          <section className="assistant-context-block assistant-vision-note"><header><ImageRegular /><span><strong>图片理解</strong><small>截图、图表、素材画面</small></span></header><p>会先区分可见事实、合理推断和待核验内容，不会把看不清的信息当作真实数据。</p></section>
        </aside>
      </section>
    </main>
  );
}

function formatScanTime(value?: string | null) {
  if (!value) return "首次巡检中";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "时间待核验";
  return parsed.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const severityLabels = { high: "优先处理", medium: "需要关注", low: "持续优化" } as const;

function OptimizationCenterPage({
  session,
  onAnalyze,
}: {
  session: HubSession;
  onAnalyze: (prompt: string) => void;
}) {
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      setResult(manual ? await api.assistantInsightsRefresh() : await api.assistantInsights());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "系统巡检结果暂时不可用");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const snapshot = result?.snapshot;
  const pending = (result?.summary.high || 0) + (result?.summary.medium || 0);
  return (
    <main className="hub-main management-main optimization-main" id="main-content">
      <section className="optimization-hero">
        <div className="optimization-hero-copy">
          <span>AI OPERATIONS INSIGHT</span>
          <h1>主动优化中心</h1>
          <p>按权限读取系统健康、操作日志、素材推送回流和授权完整度，主动发现问题并给出可核验的优化建议。</p>
        </div>
        <div className={`optimization-state${pending ? " has-attention" : ""}`}>
          <PulseRegular />
          <span><strong>{loading ? "正在巡检" : error ? "巡检读取失败" : !result ? "巡检待核验" : result.status === "stale" ? "巡检结果已过期" : pending ? `${pending} 项需要关注` : "已检查范围内暂无异常"}</strong><small>最近巡检 {formatScanTime(snapshot?.scanned_at)}</small></span>
        </div>
      </section>

      <section className="optimization-toolbar">
        <div><ShieldLockRegular /><span><strong>只读主动巡检</strong><small>建议不会自动变更权限、数据、代码或生产系统</small></span></div>
        {session.permissions.operation_admin ? <Button appearance="secondary" icon={<ArrowClockwiseRegular />} disabled={refreshing} onClick={() => void load(true)}>{refreshing ? "巡检中…" : "立即巡检"}</Button> : <span className="scan-schedule">每 15 分钟自动更新</span>}
      </section>

      {error && <div className="permission-message error">{error}<button type="button" onClick={() => setError("")}>关闭</button></div>}
      <section className="optimization-metrics" aria-label="巡检摘要">
        <article><span>高优先级</span><strong>{loading ? "—" : result?.summary.high ?? "待核验"}</strong><small>建议优先核验</small></article>
        <article><span>需要关注</span><strong>{loading ? "—" : result?.summary.medium ?? "待核验"}</strong><small>进入排查队列</small></article>
        <article><span>业务接入</span><strong>{snapshot?.modules.online != null ? `${snapshot.modules.online}/${snapshot.modules.total}` : "待核验"}</strong><small>{snapshot?.modules.reason || "模块业务可用性需独立验收"}</small></article>
        <article className="is-wide"><span>证据范围</span><strong>{snapshot?.sources.length ?? "—"}</strong><small>{snapshot?.sources.join(" · ") || "正在读取当前账号可见证据"}</small></article>
      </section>

      <section className="optimization-workspace">
        <div className="insight-stream">
          <header><div><span>巡检发现</span><h2>按影响程度安排下一步</h2></div><small>{result ? `共 ${result.summary.total} 项可见建议` : "正在整理"}</small></header>
          {loading ? <div className="optimization-empty"><Spinner size="medium" label="正在读取系统证据并生成确定性检查结果…" /></div> : null}
          {!loading && !error && result && result.status !== "stale" && !result.insights.length ? <div className="optimization-empty"><CheckmarkCircleFilled /><strong>已检查范围内没有待处理巡检项</strong><p>系统会继续定时检查；没有证据的状态不会被判定为正常或 0。</p></div> : null}
          {result?.insights.map((insight, index) => (
            <article className={`insight-card severity-${insight.severity}`} key={insight.key}>
              <div className="insight-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="insight-content">
                <header><div><span>{insight.category}</span><h3>{insight.title}</h3></div><em>{severityLabels[insight.severity]}</em></header>
                <p>{insight.summary}</p>
                <div className="evidence-list"><strong>真实证据</strong>{insight.evidence.map((item) => <span key={item}>{item}</span>)}</div>
                <div className="suggestion-line"><WrenchRegular /><span><strong>建议动作</strong>{insight.suggestion}</span></div>
                <footer><span>{insight.module_key === "hub" ? "中枢平台" : modules.find((item) => item.id === insight.module_key)?.title || "关联模块"}</span><Button appearance="subtle" icon={<BotRegular />} onClick={() => onAnalyze(insight.prompt)}>交给 AI 深入分析</Button></footer>
              </div>
            </article>
          ))}
        </div>

        <aside className="optimization-rail">
          <section>
            <header><CloudArrowUpRegular /><span><strong>素材与回流</strong><small>当前账号可见范围</small></span></header>
            {snapshot?.assets ? <div className="rail-stat-grid"><span><strong>{snapshot.assets.active.toLocaleString()}</strong>有效素材</span><span><strong>{snapshot.assets.trash.toLocaleString()}</strong>回收站</span></div> : <p>当前账号未开通云管家界面，相关数据不会展示。</p>}
          </section>
          <section>
            <header><PulseRegular /><span><strong>近 24 小时操作</strong><small>真实操作日志</small></span></header>
            {snapshot?.operations_24h ? <><div className="operation-rate"><strong>{snapshot.operations_24h.failure_rate == null ? "无操作样本" : `${(snapshot.operations_24h.failure_rate * 100).toFixed(1)}%`}</strong><span>失败比例<br />{snapshot.operations_24h.failed}/{snapshot.operations_24h.total}</span></div>{snapshot.operations_24h.failed_modules.slice(0, 3).map((item) => <div className="failed-module" key={item.module}><span>{item.module}</span><strong>{item.failed} 次</strong></div>)}</> : <p>操作证据随云管家界面权限开放。</p>}
          </section>
          {snapshot?.permissions ? <section><header><KeyRegular /><span><strong>权限资料完整度</strong><small>仅权限负责人可见</small></span></header><div className="permission-quality"><strong>{snapshot.permissions.active}</strong><span>已开通登录</span></div><p>缺部门 {snapshot.permissions.missing_department} 人 · 缺中心 {snapshot.permissions.missing_center} 人 · 指定界面 {snapshot.permissions.scoped} 人</p></section> : null}
          <section className="rail-principle"><SparkleRegular /><strong>管家的判断原则</strong><p>只引用当前账号可见的服务端证据；缺失、未回流和未映射数据统一保留为“待核验”。</p></section>
        </aside>
      </section>
    </main>
  );
}

function PageIntro({ eyebrow, title, description, count }: { eyebrow: string; title: string; description: string; count?: number }) {
  return (
    <section className="management-hero">
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {typeof count === "number" && <strong>{count}</strong>}
    </section>
  );
}

function chinaDateInput(offsetDays = 0) {
  const value = new Date(Date.now() + 8 * 60 * 60 * 1000);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function operationDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "时间待核验";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

function OperationLogsPage() {
  const [rows, setRows] = useState<OperationLog[]>([]);
  const [modulesAvailable, setModulesAvailable] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [result, setResult] = useState<"" | "success" | "failed">("");
  const [dateFrom, setDateFrom] = useState(chinaDateInput(-6));
  const [dateTo, setDateTo] = useState(chinaDateInput());
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.operationLogs({
          q: query.trim(),
          module: moduleName,
          result,
          dateFrom,
          dateTo,
          page,
          pageSize: 20,
        });
        setRows(data.items);
        setModulesAvailable(data.modules);
        setTotal(data.total);
        setTotalPages(data.total_pages);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法读取操作日志");
      } finally {
        setLoading(false);
      }
    }, query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [query, moduleName, result, dateFrom, dateTo, page, refreshKey]);

  const resetPage = (action: () => void) => {
    setPage(1);
    action();
  };

  return (
    <main className="hub-main management-main operation-main" id="main-content">
      <PageIntro eyebrow="OPERATION AUDIT" title="操作日志" description="查看素材、推送、同步、AI 与权限模块中的关键操作；日志不记录密码、令牌或 Cookie。" count={total} />
      <section className="operation-safety-note"><ClipboardBulletListRegular /><span><strong>管理员只读查看</strong><small>操作日志用于追溯问题和核验结果，不提供修改或删除入口。</small></span></section>
      <section className="operation-filter-panel">
        <label className="operation-search"><SearchRegular /><input value={query} onChange={(event) => resetPage(() => setQuery(event.target.value))} placeholder="搜索姓名、工号、路径或目标 ID" /></label>
        <select aria-label="筛选模块" value={moduleName} onChange={(event) => resetPage(() => setModuleName(event.target.value))}><option value="">全部模块</option>{modulesAvailable.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select aria-label="筛选结果" value={result} onChange={(event) => resetPage(() => setResult(event.target.value as "" | "success" | "failed"))}><option value="">全部结果</option><option value="success">成功</option><option value="failed">失败</option></select>
        <label className="operation-date"><span>开始日期</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => resetPage(() => setDateFrom(event.target.value))} /></label>
        <label className="operation-date"><span>结束日期</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => resetPage(() => setDateTo(event.target.value))} /></label>
        <Button appearance="secondary" icon={<ArrowClockwiseRegular />} disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>{loading ? "读取中…" : "刷新"}</Button>
      </section>
      {error && <div className="permission-message error">{error}<button type="button" onClick={() => setError("")}>关闭</button></div>}
      <section className="operation-log-table" aria-label="操作日志列表">
        <header><span>时间 / 操作人</span><span>模块</span><span>操作</span><span>结果</span><span>资源</span></header>
        {loading ? <div className="operation-log-empty"><Spinner size="medium" label="正在读取真实操作日志…" /></div> : null}
        {!loading && rows.map((row) => (
          <article key={row.id}>
            <span className="operation-actor"><strong>{row.actor_name || row.actor_number || "系统"}</strong><small>{operationDateTime(row.created_at)} · {row.department || "部门待读取"}</small></span>
            <span className="operation-module">{row.module || "系统"}</span>
            <span className="operation-action"><strong>{row.action}</strong><small title={row.path}>{row.path}</small></span>
            <span className={`operation-result is-${row.result}`}><strong>{row.result === "success" ? "成功" : "失败"}</strong><small>HTTP {row.status_code}</small></span>
            <span className="operation-resource"><small>{row.resource_type || "资源"}</small><strong title={row.resource_id}>{row.resource_id || "—"}</strong></span>
          </article>
        ))}
        {!loading && !rows.length ? <div className="operation-log-empty"><ClipboardBulletListRegular /><strong>没有匹配的操作记录</strong><span>可以调整日期、模块或搜索条件后重试。</span></div> : null}
        <footer><span>共 {total.toLocaleString()} 条 · 第 {page}/{totalPages} 页</span><div><Button appearance="subtle" icon={<ChevronLeftRegular />} disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><Button appearance="subtle" icon={<ChevronRightRegular />} iconPosition="after" disabled={loading || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button></div></footer>
      </section>
    </main>
  );
}

function OrganizationLine({ userNumber, department, center }: { userNumber: string; department: string; center: string }) {
  let departmentLabel = department.trim();
  let centerLabel = center.trim();
  if (!centerLabel && departmentLabel.includes("中心")) {
    centerLabel = departmentLabel;
    departmentLabel = "";
  }
  if (departmentLabel && departmentLabel === centerLabel) departmentLabel = "";
  return (
    <p className="organization-line">
      <span>工号：{userNumber || "待补全"}</span>
      <span>部门：{departmentLabel || "待登录补全"}</span>
      <span>中心：{centerLabel || "待登录补全"}</span>
    </p>
  );
}

function PermissionToolbar({
  query,
  onQuery,
  name,
  onName,
  department,
  onDepartment,
  center,
  onCenter,
  searchLabel,
  createLabel,
  actionLabel,
  busy,
  onCreate,
}: {
  query: string;
  onQuery: (value: string) => void;
  name: string;
  onName: (value: string) => void;
  department: string;
  onDepartment: (value: string) => void;
  center: string;
  onCenter: (value: string) => void;
  searchLabel: string;
  createLabel: string;
  actionLabel: string;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="permission-toolbar">
      <div className="permission-tool-section">
        <header><strong>{searchLabel}</strong><span>按姓名、工号、部门或中心快速查找</span></header>
        <div className="permission-search"><SearchRegular /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索姓名、工号、部门或中心" /></div>
      </div>
      <div className="permission-tool-section">
        <header><strong>{createLabel}</strong><span>输入 OA 真实姓名开通对应管理权限</span></header>
        <div className="permission-create-row">
          <input value={name} onChange={(event) => onName(event.target.value)} placeholder="输入 OA 完整真实姓名" />
          <input value={department} onChange={(event) => onDepartment(event.target.value)} placeholder="部门备注（可选）" />
          <input value={center} onChange={(event) => onCenter(event.target.value)} placeholder="中心备注（可选）" />
          <Button appearance="primary" disabled={busy || name.trim().length < 2} onClick={onCreate}>{busy ? "处理中…" : actionLabel}</Button>
        </div>
      </div>
    </section>
  );
}

function LoginPermissionsPage({ notify }: { notify: (message: string) => void }) {
  const [rows, setRows] = useState<LoginGrant[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [center, setCenter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try { setRows((await api.loginGrants()).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取登录权限"); }
  };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return rows;
    return rows.filter((row) => [row.real_name, row.user_number, row.department, row.center].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword)));
  }, [query, rows]);
  const create = async () => {
    setBusy("create");
    setError("");
    try {
      await api.loginGrantCreate(name.trim(), department.trim(), center.trim());
      notify("登录权限已更新；首次登录后会自动补全工号、部门和中心。");
      setName(""); setDepartment(""); setCenter("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "开通登录权限失败"); }
    finally { setBusy(""); }
  };
  const revoke = async (row: LoginGrant) => {
    if (!window.confirm(`确认取消“${row.real_name || row.user_number}”的中枢登录权限？此操作会同时阻止其进入已接入系统。`)) return;
    setBusy(row.identifier);
    try { await api.loginGrantRevoke(row.identifier); notify("登录权限已取消。"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消登录权限失败"); }
    finally { setBusy(""); }
  };
  const isDepartmentAutomatic = (row: LoginGrant) => !row.login_blocked && `${row.department} ${row.center}`.includes("品牌营销");

  return (
    <main className="hub-main management-main">
      <PageIntro eyebrow="DEPARTMENT ACCESS" title="成员准入" description="品牌营销部在职成员通过 OA 部门身份自动准入，不再逐人维护登录白名单。" />
      <section className="department-access-policy"><ShieldLockRegular /><span><strong>部门自动准入已启用</strong><small>OA 状态正常且所属部门包含“品牌营销”即可登录。已确认离职、调离部门或 OA 账号异常时自动失效；界面权限仍可单独配置。</small></span><em>无需逐人开通</em></section>
      <PermissionToolbar query={query} onQuery={setQuery} name={name} onName={setName} department={department} onDepartment={setDepartment} center={center} onCenter={setCenter} searchLabel="搜索准入记录" createLabel="添加跨部门例外" actionLabel="开通例外准入" busy={busy === "create"} onCreate={create} />
      {error && <div className="permission-message error">{error}<button onClick={() => setError("")}>关闭</button></div>}
      <section className="permission-table">
        <header><strong>授权成员</strong><span>{visible.length} 条</span></header>
        {visible.map((row) => (
          <article key={row.identifier} className={!row.active ? "is-revoked" : ""}>
            <span className="permission-avatar">{(row.real_name || row.user_number || "?").slice(0, 1)}</span>
            <div className="member-identity-copy"><strong>{row.real_name || "待首次登录补全"}</strong><OrganizationLine userNumber={row.user_number} department={row.department} center={row.center} /></div>
            <span className={row.active ? "status-pill active" : "status-pill"}>{row.login_blocked ? "已确认离职 · 禁止登录" : isDepartmentAutomatic(row) ? "部门自动准入" : row.active ? "例外可登录" : "已取消"}</span>
            {row.active && !isDepartmentAutomatic(row)
              ? <Button appearance="secondary" disabled={busy === row.identifier} onClick={() => revoke(row)}>取消例外</Button>
              : row.active
                ? <span className="row-note">由 OA 部门统管</span>
              : <span className="row-note">保留历史记录</span>}
          </article>
        ))}
        {!visible.length && <div className="permission-empty">暂无匹配的例外记录；品牌营销部成员无需在此逐人出现。</div>}
      </section>
    </main>
  );
}

function AdminPermissionsPage({ notify }: { notify: (message: string) => void }) {
  const [rows, setRows] = useState<AdminGrant[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [center, setCenter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setError("");
    try { setRows((await api.adminGrants()).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取管理员权限"); }
  };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return keyword ? rows.filter((row) => [row.real_name, row.user_number, row.department, row.center].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword))) : rows;
  }, [query, rows]);
  const create = async () => {
    setBusy("create");
    try { await api.adminGrantCreate(name.trim(), department.trim(), center.trim()); notify("管理员权限已更新。"); setName(""); setDepartment(""); setCenter(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "开通管理员权限失败"); }
    finally { setBusy(""); }
  };
  const revoke = async (row: AdminGrant) => {
    if (!window.confirm(`确认取消“${row.real_name || row.user_number}”的管理员权限？`)) return;
    setBusy(row.identifier);
    try { await api.adminGrantRevoke(row.identifier); notify("管理员权限已取消。"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消管理员权限失败"); }
    finally { setBusy(""); }
  };

  return (
    <main className="hub-main management-main">
      <PageIntro eyebrow="OPERATION ADMIN" title="管理员权限" description="用于查看中枢操作日志和运行记录；不包含权限配置权，也不会自动扩大业务界面范围。" count={rows.filter((row) => row.active).length} />
      <PermissionToolbar query={query} onQuery={setQuery} name={name} onName={setName} department={department} onDepartment={setDepartment} center={center} onCenter={setCenter} searchLabel="搜索管理员权限" createLabel="开通管理员权限" actionLabel="开通管理员权限" busy={busy === "create"} onCreate={create} />
      {error && <div className="permission-message error">{error}<button onClick={() => setError("")}>关闭</button></div>}
      <section className="permission-table">
        <header><strong>管理员列表</strong><span>{visible.length} 条</span></header>
        {visible.map((row) => (
          <article key={row.identifier} className={!row.active ? "is-revoked" : ""}>
            <span className="permission-avatar">{(row.real_name || row.user_number || "?").slice(0, 1)}</span>
            <div className="member-identity-copy"><strong>{row.real_name || "待补全"}</strong><OrganizationLine userNumber={row.user_number} department={row.department} center={row.center} /></div>
            <span className={row.active ? "status-pill active" : "status-pill"}>{row.active ? "可查看操作日志" : "已取消"}</span>
            {row.active && !row.protected
              ? <Button appearance="secondary" disabled={busy === row.identifier} onClick={() => revoke(row)}>取消权限</Button>
              : <span className="row-note">{row.protected ? "系统保护" : "保留历史记录"}</span>}
          </article>
        ))}
        {!visible.length && <div className="permission-empty">暂无匹配记录</div>}
      </section>
    </main>
  );
}

function PermissionManagersPage({ notify }: { notify: (message: string) => void }) {
  const [rows, setRows] = useState<AdminGrant[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [center, setCenter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setError("");
    try { setRows((await api.permissionManagers()).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取权限管理员"); }
  };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return keyword ? rows.filter((row) => [row.real_name, row.user_number, row.department, row.center].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword))) : rows;
  }, [query, rows]);
  const create = async () => {
    setBusy("create");
    setError("");
    try {
      await api.permissionManagerCreate(name.trim(), department.trim(), center.trim());
      notify("最高级权限管理权限已开通。");
      setName(""); setDepartment(""); setCenter("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "开通权限管理权限失败"); }
    finally { setBusy(""); }
  };
  const revoke = async (row: AdminGrant) => {
    if (!window.confirm(`确认取消“${row.real_name || row.user_number}”的最高级权限管理权限？`)) return;
    setBusy(row.identifier);
    try { await api.permissionManagerRevoke(row.identifier); notify("权限管理权限已取消。"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消权限管理权限失败"); }
    finally { setBusy(""); }
  };
  return (
    <main className="hub-main management-main">
      <PageIntro eyebrow="HIGHEST ACCESS" title="权限管理" description="开通后获得完整业务导航、部门视角、流程管理与同事视角预览，并可配置登录、管理员和界面权限。" count={rows.filter((row) => row.active).length} />
      <div className="permission-level-note"><ShieldLockRegular /><div><strong>最高权限边界</strong><span>业务界面与部门视角统一开放；取消后恢复原有角色和指定界面配置。素材删除、审核配置等受保护操作仍使用各系统原有授权。系统保护负责人不可取消，且不能取消自己的最高权限。</span></div></div>
      <PermissionToolbar query={query} onQuery={setQuery} name={name} onName={setName} department={department} onDepartment={setDepartment} center={center} onCenter={setCenter} searchLabel="搜索权限管理员" createLabel="开通最高级权限管理" actionLabel="开通权限管理" busy={busy === "create"} onCreate={create} />
      {error && <div className="permission-message error">{error}<button onClick={() => setError("")}>关闭</button></div>}
      <section className="permission-table">
        <header><strong>权限管理员列表</strong><span>{visible.length} 条</span></header>
        {visible.map((row) => (
          <article key={row.identifier} className={!row.active ? "is-revoked" : ""}>
            <span className="permission-avatar">{(row.real_name || row.user_number || "?").slice(0, 1)}</span>
            <div className="member-identity-copy"><strong>{row.real_name || "待补全"}</strong><OrganizationLine userNumber={row.user_number} department={row.department} center={row.center} /></div>
            <span className={row.active ? "status-pill active" : "status-pill"}>{row.active ? "最高权限已开通" : "已取消"}</span>
            {row.active && !row.protected
              ? <Button appearance="secondary" disabled={busy === row.identifier} onClick={() => revoke(row)}>取消权限</Button>
              : <span className="row-note">{row.protected ? "系统保护" : "保留历史记录"}</span>}
          </article>
        ))}
        {!visible.length && <div className="permission-empty">暂无匹配记录</div>}
      </section>
    </main>
  );
}

import {OrganizationEntryControl, OrganizationEntryBatch, type OrganizationEntries, type OrganizationEntry} from './OrganizationEntryControl';

function ModuleScopeCard({
  row,
  catalog,
  busy,
  onSave,
  batchMode,
  batchSelected,
  onBatchToggle,
  organizationEntry,
  onSaveOrganization,
}: {
  row: ModuleAccessGrant;
  catalog: Array<{ key: string; label: string; purpose: string }>;
  busy: boolean;
  onSave: (identifier: string, mode: "all" | "selected", selected: string[]) => Promise<void>;
  batchMode: boolean;
  batchSelected: boolean;
  onBatchToggle: (identifier: string) => void;
  organizationEntry?: OrganizationEntry;
  onSaveOrganization: (identifiers: string[], enabled: boolean) => Promise<void>;
}) {
  const [mode, setMode] = useState<"all" | "selected">(row.access_mode);
  const [selected, setSelected] = useState<string[]>(row.modules);
  const highest = row.highest_business_access === true;
  const effectiveMode = highest ? "all" : mode;
  useEffect(() => { setMode(row.access_mode); setSelected(row.modules); }, [row]);
  const toggle = (key: string) => setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const dirty = mode !== row.access_mode || (mode === "selected" && JSON.stringify([...selected].sort()) !== JSON.stringify([...row.modules].sort()));

  return (
    <article className={`module-scope-card${row.login_active ? "" : " is-revoked"}${batchSelected ? " is-batch-selected" : ""}`}>
      <header>
        <div className="module-member-identity">
          {batchMode && <label className="batch-member-check"><input type="checkbox" disabled={!row.login_active || highest} checked={batchSelected} onChange={() => onBatchToggle(row.identifier)} /><span>选择</span></label>}
          <div className="member-identity-copy"><strong>{row.real_name || row.user_number || "待补全"}</strong><OrganizationLine userNumber={row.user_number} department={row.department} center={row.center} /></div>
        </div>
        <span className={row.login_active ? "status-pill active" : "status-pill"}>{row.login_blocked ? "已确认离职 · 禁止登录" : row.login_active ? "登录已开通" : "登录已取消"}</span>
      </header>
      <div className="scope-mode">
        <label><input type="radio" disabled={highest} checked={effectiveMode === "all"} onChange={() => setMode("all")} />全部界面</label>
        <label><input type="radio" disabled={highest} checked={effectiveMode === "selected"} onChange={() => setMode("selected")} />指定界面</label>
      </div>
      <div className={`module-check-grid${effectiveMode === "all" ? " is-disabled" : ""}`}>
        {catalog.map((module) => (
          <label key={module.key}>
            <input type="checkbox" disabled={effectiveMode === "all"} checked={effectiveMode === "all" || selected.includes(module.key)} onChange={() => toggle(module.key)} />
            <span><strong>{module.purpose}</strong><small>{module.label}</small></span>
          </label>
        ))}
      </div>
      <OrganizationEntryControl row={organizationEntry} busy={busy} onSave={onSaveOrganization} />
      <footer>
        <span>{highest ? "最高权限：全部业务界面和部门视角；取消最高权限后恢复原配置" : mode === "all" ? "全部业务界面；组织经营看板独立配置" : `已选择 ${selected.length} 个业务界面；不含组织经营看板`}</span>
        <Button appearance="primary" disabled={highest || !row.login_active || !dirty || busy} onClick={() => onSave(row.identifier, mode, selected)}>
          {busy ? "保存中…" : "保存界面权限"}
        </Button>
      </footer>
    </article>
  );
}

function ModulePermissionsPage({ notify }: { notify: (message: string) => void }) {
  const [organizationEntries, setOrganizationEntries] = useState<OrganizationEntries>({items: [], version: 0});
  const [rows, setRows] = useState<ModuleAccessGrant[]>([]);
  const [catalog, setCatalog] = useState<Array<{ key: string; label: string; purpose: string }>>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [batchAccessMode, setBatchAccessMode] = useState<"all" | "selected">("all");
  const [batchModules, setBatchModules] = useState<string[]>([]);
  const load = async () => {
    setError("");
    try { const [data, entries] = await Promise.all([api.moduleAccess(), api.organizationEntries()]); setRows(data.items); setCatalog(data.modules.map(item => item.key === "cloud-manager" ? { ...item, purpose: "WIS云管家", label: "素材库 · 审核 · 推送回流" } : item)); setOrganizationEntries(entries); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取界面权限"); }
  };
  useEffect(() => { void load(); }, []);
  const saveOrganization = async (identifiers: string[], enabled: boolean) => {
    setBusy('organization'); setError('');
    try {
      const result = await api.organizationEntryUpdate(identifiers, enabled, organizationEntries.version);
      setOrganizationEntries(result);
      window.dispatchEvent(new Event('wis-permissions-changed'));
      notify(`已保存 ${result.updated} 位成员的看板权限；角色、中心和其他业务界面保持不变。`);
    } catch (cause) {
      // No blind write retry. Read back authoritative state after an uncertain response.
      try { setOrganizationEntries(await api.organizationEntries()); }
      catch { setOrganizationEntries({items: [], version: 0}); }
      setError(`${cause instanceof Error ? cause.message : '保存请求未完成'} 已尝试读取当前权限，请核对后再操作。`);
    } finally { setBusy(''); }
  };
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return keyword ? rows.filter((row) => [row.real_name, row.user_number, row.department, row.center].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword))) : rows;
  }, [query, rows]);
  const save = async (identifier: string, mode: "all" | "selected", selected: string[]) => {
    setBusy(identifier);
    try {
      const updated = await api.moduleAccessUpdate(identifier, mode, selected);
      setRows((current) => current.map((row) => row.identifier === identifier ? updated : row));
      window.dispatchEvent(new Event('wis-permissions-changed'));
      notify("界面权限已保存并立即生效。");
    } catch (cause) {
      try { setRows((await api.moduleAccess()).items); } catch { /* Do not repeat uncertain writes. */ }
      setError(`${cause instanceof Error ? cause.message : "保存界面权限失败"} 已尝试读回当前配置，请核对后继续。`);
    }
    finally { setBusy(""); }
  };
  const activeVisibleIdentifiers = visible.filter((row) => row.login_active && !row.highest_business_access).map((row) => row.identifier);
  const allVisibleSelected = activeVisibleIdentifiers.length > 0 && activeVisibleIdentifiers.every((identifier) => batchSelected.includes(identifier));
  const toggleBatchMember = (identifier: string) => setBatchSelected((current) => current.includes(identifier) ? current.filter((item) => item !== identifier) : [...current, identifier]);
  const toggleBatchModule = (key: string) => setBatchModules((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const toggleVisibleMembers = () => setBatchSelected((current) => {
    if (allVisibleSelected) return current.filter((identifier) => !activeVisibleIdentifiers.includes(identifier));
    return [...new Set([...current, ...activeVisibleIdentifiers])];
  });
  const closeBatchMode = () => { setBatchMode(false); setBatchSelected([]); setBatchAccessMode("all"); setBatchModules([]); };
  const saveBatch = async () => {
    if (!batchSelected.length) return;
    if (!window.confirm(`确认统一修改 ${batchSelected.length} 位成员的界面权限？`)) return;
    setBusy("batch");
    setError("");
    try {
      const result = await api.moduleAccessBatchUpdate(batchSelected, batchAccessMode, batchModules);
      const updated = new Map(result.items.map((row) => [row.identifier, row]));
      setRows((current) => current.map((row) => updated.get(row.identifier) || row));
      window.dispatchEvent(new Event('wis-permissions-changed'));
      notify(`已批量更新 ${result.updated} 位成员的界面权限。`);
      closeBatchMode();
    } catch (cause) {
      try { setRows((await api.moduleAccess()).items); } catch { /* Do not repeat uncertain writes. */ }
      setError(`${cause instanceof Error ? cause.message : "批量保存界面权限失败"} 已尝试读回当前配置，请核对后继续。`);
    }
    finally { setBusy(""); }
  };

  return (
    <main className="hub-main management-main">
      <PageIntro eyebrow="MODULE ACCESS" title="界面权限" description="登录权限是总开关；这里可进一步限定每位授权成员能够使用哪些业务界面。" count={rows.filter((row) => row.login_active).length} />
      <section className="module-filter">
        <div className="module-filter-search"><SearchRegular /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、工号、部门或中心" /></div>
        <Button appearance={batchMode ? "secondary" : "primary"} onClick={() => batchMode ? closeBatchMode() : setBatchMode(true)}>{batchMode ? "取消批量修改" : "批量修改界面权限"}</Button>
      </section>
      {batchMode && (
        <section className="batch-permission-panel">
          <header><div><strong>批量修改界面权限</strong><span>先选择成员，再统一设置可进入的业务界面</span></div><em>已选 {batchSelected.length} 人</em></header>
          <div className="batch-selection-row"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleMembers} />选择当前筛选结果</label><span>仅可选择登录权限已开通的成员</span></div>
          <div className="scope-mode">
            <label><input type="radio" checked={batchAccessMode === "all"} onChange={() => setBatchAccessMode("all")} />全部界面</label>
            <label><input type="radio" checked={batchAccessMode === "selected"} onChange={() => setBatchAccessMode("selected")} />指定界面</label>
          </div>
          <div className={`module-check-grid${batchAccessMode === "all" ? " is-disabled" : ""}`}>
            {catalog.map((module) => (
              <label key={module.key}>
                <input type="checkbox" disabled={batchAccessMode === "all"} checked={batchAccessMode === "all" || batchModules.includes(module.key)} onChange={() => toggleBatchModule(module.key)} />
                <span><strong>{module.purpose}</strong><small>{module.label}</small></span>
              </label>
            ))}
          </div>
          <OrganizationEntryBatch items={organizationEntries.items} selected={batchSelected} busy={!!busy} onSave={saveOrganization} />
          <footer><span>{batchAccessMode === "all" ? "将统一设置全部业务界面；看板权限不变" : `将统一设置 ${batchModules.length} 个业务界面；看板权限不变`}</span><Button appearance="primary" disabled={!batchSelected.length || !!busy} onClick={saveBatch}>{busy === "batch" ? "批量保存中…" : `应用到 ${batchSelected.length} 位成员`}</Button></footer>
        </section>
      )}
      {error && <div className="permission-message error" role="alert">{error}<button disabled={!!busy} onClick={() => void load()}>刷新权限状态</button></div>}
      <section className="module-scope-list">
        {visible.map((row) => <ModuleScopeCard key={row.identifier} row={row} catalog={catalog} busy={!!busy} onSave={save} batchMode={batchMode} batchSelected={batchSelected.includes(row.identifier)} onBatchToggle={toggleBatchMember} organizationEntry={organizationEntries.items.find(item => item.identifier === row.identifier)} onSaveOrganization={saveOrganization} />)}
        {!visible.length && <div className="permission-empty">暂无匹配记录；请先在“登录权限”中开通成员。</div>}
      </section>
    </main>
  );
}

// Business roles are persisted centrally and do not confer admin privileges.
const dashboardScopeLabels: Record<DashboardScope, string> = {
  department: "总监级 · 全部门",
  center: "主管级 · 所属中心",
  personal: "专员级 · 仅本人",
};

function WorkspaceRoleCard({ row, centers, catalog, busy, onSave }: {
  row: DashboardScopeGrant; centers: string[]; catalog: Array<{key: string; label: string}>;
  busy: boolean; onSave: (row: DashboardScopeGrant, role: string, center: string, modules: string[]) => void;
}) {
  const [role, setRole] = useState(row.role);
  const [center, setCenter] = useState(row.center);
  const [modules, setModules] = useState(row.modules);
  const scope = role === "director" ? "department" : role === "manager" ? "center" : "personal";
  const editable = row.editable && !["external", "maintainer"].includes(row.role);
  const dirty = !row.configured || role !== row.role || center !== row.center || [...modules].sort().join() !== [...row.modules].sort().join();
  return <article className="workspace-role-card">
    <header><div><strong>{row.real_name || row.user_number}</strong><OrganizationLine userNumber={row.user_number} department={row.department} center={row.oa_center || row.center} /></div><small>{row.configured ? `已配置 · ${row.updated_by_name}` : "沿用现有映射"}</small></header>
    {editable ? <>
      <div className="workspace-role-fields">
        <label>角色<select aria-label={`${row.real_name}的角色`} value={role} disabled={busy} onChange={e => setRole(e.target.value as DashboardScopeGrant["role"])}><option value="director">总监 / 见习总监</option><option value="manager">主管 / 负责人</option><option value="specialist">专员</option></select></label>
        <label>所属中心<select aria-label={`${row.real_name}的中心`} value={center} disabled={busy} onChange={e => setCenter(e.target.value)}><option value="">请选择中心</option>{centers.map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="workspace-role-summary"><span>登录首页与数据范围</span><strong>{role === "director" ? "部门管理首页" : role === "manager" ? "本中心工作台" : "个人工作台"}</strong><small>{dashboardScopeLabels[scope]}{scope === "center" ? ` · ${center || "待选择"}` : ""}</small></div>
      </div>
      <fieldset disabled={busy}><legend>可用业务模块</legend><div className="workspace-role-modules">{catalog.map(item => <label key={item.key}><input type="checkbox" checked={modules.includes(item.key)} onChange={e => setModules(previous => e.target.checked ? [...previous, item.key] : previous.filter(key => key !== item.key))} />{item.label}</label>)}</div></fieldset>
      <footer><span>{role === "specialist" ? "专员不开放组织经营看板或部门管理功能。" : "业务角色不授予权限管理、开发或系统管理员权限。"}</span><Button appearance="primary" disabled={busy || !dirty || !center || (role !== "director" && center === "未分中心")} onClick={() => onSave(row, role, center, modules)}>{busy ? "正在保存…" : "保存角色与中心"}</Button></footer>
    </> : <p>{!row.login_active ? "登录权限已关闭，不能在这里重新启用。" : row.highest_business_access ? "最高权限使用完整部门视角与全部业务界面；取消最高权限后恢复原角色和界面配置。" : "部门外协作、开发维护或归属待核验成员保留原授权；请先在成员准入中核对身份。"}</p>}
  </article>;
}

function DashboardScopePermissionsPage({ notify }: { notify: (message: string) => void }) {
  const [rows, setRows] = useState<DashboardScopeGrant[]>([]);
  const [centers, setCenters] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Array<{key: string; label: string}>>([]);
  const [query, setQuery] = useState("");
  const [centerFilter, setCenterFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try { const value = await api.dashboardScopeGrants(query); setRows(value.items); setCenters(value.centers); setCatalog(value.catalog.map(item => item.key === "cloud-manager" ? { ...item, label: "WIS云管家" } : item)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取角色与中心配置"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const update = async (row: DashboardScopeGrant, role: string, center: string, modules: string[]) => {
    setBusy(row.identifier);
    setError("");
    try {
      await api.dashboardScopeUpdate(row.identifier, {role, center, modules, version: row.version});
      notify(`已保存 ${row.real_name || row.user_number} 的角色、${center}和业务模块；刷新后按新配置生效。`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存角色与中心失败"); }
    finally { setBusy(""); }
  };
  return (
    <main className="hub-main management-main dashboard-scope-main" id="main-content">
      <PageIntro eyebrow="ROLE & CENTER" title="角色与中心" description="按同事配置角色、所属中心和可用模块，统一影响登录首页、菜单及后台数据范围。修改后点击保存，不会改变真实 OA 部门或管理员身份。" count={rows.length} />
      <div className="permission-level-note"><ShieldLockRegular /><div><strong>新增同事先核对身份，再配置岗位</strong><span>找不到同事时，先到“成员准入”添加。未保存的成员沿用现有映射；已关闭的权限不会自动恢复。</span></div></div>
      <section className="permission-search-only"><SearchRegular /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="搜索姓名、工号、部门或中心" /><Button appearance="secondary" onClick={() => void load()}>搜索</Button></section>
      <div className="workspace-role-filters"><label>筛选中心<select value={centerFilter} onChange={e => setCenterFilter(e.target.value)}><option value="">全部中心</option>{centers.map(value => <option key={value}>{value}</option>)}</select></label><label>筛选角色<select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">全部角色</option><option value="director">总监</option><option value="manager">主管</option><option value="specialist">专员</option></select></label></div>
      {error && <div className="management-error">{error}</div>}
      {loading ? <div className="management-loading"><Spinner label="正在读取授权成员…" /></div> : (
        <section className="workspace-role-list">
          {rows.filter(row => (!centerFilter || row.center === centerFilter) && (!roleFilter || row.role === roleFilter)).map(row => <WorkspaceRoleCard key={`${row.identifier}:${row.version}`} row={row} centers={centers} catalog={catalog} busy={busy === row.identifier} onSave={(...args) => void update(...args)} />)}
          {!rows.length && <div className="management-empty">没有匹配的授权成员。</div>}
        </section>
      )}
    </main>
  );
}

type PermissionCenterSection = "members" | "access" | "highest";
type PermissionAccessSection = "admins" | "modules" | "dashboard";

function PermissionCenterPage({ notify }: { notify: (message: string) => void }) {
  const [section, setSection] = useState<PermissionCenterSection>("members");
  const [accessSection, setAccessSection] = useState<PermissionAccessSection>("dashboard");
  return <div className="permission-center-page">
    <section className="permission-center-hero">
      <div><span>PERMISSION CENTER</span><h1>权限管理</h1><p>一个入口统一管理部门准入、管理身份、界面范围与看板范围。</p></div>
      <ShieldLockRegular />
    </section>
    <nav className="permission-center-tabs" aria-label="权限管理分类">
      <button className={section === "members" ? "active" : ""} onClick={() => setSection("members")}><b>01</b><span><strong>成员准入</strong><small>部门自动登录与跨部门例外</small></span></button>
      <button className={section === "access" ? "active" : ""} onClick={() => setSection("access")}><b>02</b><span><strong>权限配置</strong><small>管理员、可用界面和看板范围</small></span></button>
      <button className={section === "highest" ? "active" : ""} onClick={() => setSection("highest")}><b>03</b><span><strong>最高权限</strong><small>授权权限管理者</small></span></button>
    </nav>
    {section === "members" && <LoginPermissionsPage notify={notify} />}
    {section === "access" && <>
      <div className="permission-config-switch">
        <button className={accessSection === "modules" ? "active" : ""} onClick={() => setAccessSection("modules")}>界面权限</button>
        <button className={accessSection === "dashboard" ? "active" : ""} onClick={() => setAccessSection("dashboard")}>角色与中心</button>
        <button className={accessSection === "admins" ? "active" : ""} onClick={() => setAccessSection("admins")}>操作日志管理员</button>
      </div>
      {accessSection === "modules" && <ModulePermissionsPage notify={notify} />}
      {accessSection === "dashboard" && <DashboardScopePermissionsPage notify={notify} />}
      {accessSection === "admins" && <AdminPermissionsPage notify={notify} />}
    </>}
    {section === "highest" && <PermissionManagersPage notify={notify} />}
  </div>;
}

function PermissionPreviewSwitcher({ preview, busy, onApply }: { preview: PermissionPreview; busy: boolean; onApply: (scope: DashboardScope | "real", center: string, person: string) => void }) {
  const [scope, setScope] = useState<DashboardScope | "real">(preview.scope);
  const [center, setCenter] = useState(preview.center || "营销中心A");
  const [person, setPerson] = useState(preview.person || "");
  const [candidates, setCandidates] = useState<PermissionPreviewSubject[]>([]);
  useEffect(() => { setScope(preview.scope); setCenter(preview.center || "营销中心A"); setPerson(preview.person || ""); }, [preview.updatedAt, preview.scope, preview.center, preview.person]);
  useEffect(() => { api.permissionPreviewCandidates().then((data) => setCandidates(data.items)).catch(() => setCandidates([])); }, []);
  return <div className={`permission-preview-switcher${preview.active ? " is-active" : ""}`}>
    <span><ShieldLockRegular /><small>{preview.active ? "权限预览" : "真实权限"}</small></span>
    <select aria-label="选择权限预览视角" value={scope} onChange={(event) => setScope(event.target.value as DashboardScope | "real")}>
      <option value="real">真实权限</option><option value="department">总监级</option><option value="center">主管级</option><option value="personal">专员级</option>
    </select>
    {scope !== "real" && <input aria-label="预览成员姓名或工号" list="permission-preview-members" value={person} onChange={(event) => setPerson(event.target.value)} placeholder="输入同事姓名或工号（可选）" />}
    <datalist id="permission-preview-members">{candidates.map((candidate) => <option key={`${candidate.userNumber}-${candidate.realName}`} value={candidate.realName} label={`${candidate.userNumber} · ${candidate.department} · ${candidate.center || "未分中心"}${candidate.loginActive ? "" : " · 权限已关闭"}`} />)}</datalist>
    {scope === "center" && !person.trim() && <select aria-label="选择预览中心" value={center} onChange={(event) => setCenter(event.target.value)}><option>营销中心A</option><option>营销中心B</option><option>营销中心C</option><option>营销中心D</option><option>营销中心J</option><option>品牌创意中心</option><option>视频中心</option><option>AI营销中心</option><option>直播中心</option></select>}
    <Button appearance={preview.active ? "primary" : "secondary"} disabled={busy} onClick={() => onApply(scope, center, person)}>{busy ? "切换中…" : scope === "real" ? "退出预览" : "应用视角"}</Button>
  </div>;
}

function sessionForPreview(session: HubSession, preview: PermissionPreview): HubSession {
  if (!preview.active || preview.scope === "real") return session;
  const businessKeys = new Set(["data-dashboard", "material-incentive", "creative-hub", "creative-radar", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management", "workflow-engine"]);
  const specialistDefaults = ["creative-radar", "ai-first-creation", "material-workbench", "cloud-manager", "workflow-engine"];
  const managementDefaults = [...businessKeys];
  const isPersonal = preview.scope === "personal";
  const isCenter = preview.scope === "center";
  const subject = preview.subject;
  const previewModules = subject ? subject.allowedModules : isPersonal ? specialistDefaults : managementDefaults;
  const previewName = subject?.realName || preview.person.trim();
  return {
    ...session,
    user: previewName
      ? {
          ...session.user,
          number: subject?.userNumber || session.user.number,
          realName: previewName,
          name: previewName,
          department: subject?.department || session.user.department,
          center: subject?.center || (isCenter ? preview.center : session.user.center),
          jobTitle: subject?.jobTitle || session.user.jobTitle,
        }
      : session.user,
    permissions: { ...session.permissions, super_admin: false, operation_admin: false, manage_permissions: false },
    access: {
      ...session.access,
      access_mode: "selected",
      allowed_modules: [...new Set(previewModules)],
      policy_state: "development-preview",
    },
    workspace: {
      ...session.workspace,
      role: isPersonal ? "specialist" : isCenter ? "manager" : "director",
      role_label: isPersonal ? "专员预览" : isCenter ? "主管预览" : "总监预览",
      home: isPersonal ? "personal" : isCenter ? "center" : "department",
      dashboard_scope: isPersonal ? "personal" : isCenter ? "center" : "department",
      department: subject?.department || session.workspace.department,
      center: subject?.center || (isCenter ? preview.center : ""),
      manager: subject?.manager || "",
      is_brand_department: subject ? subject.department.includes("品牌营销部") : session.workspace.is_brand_department,
      is_system_maintainer: Boolean(subject?.note.includes("维护")),
      can_configure_workflow: false,
      can_view_organization_dashboard: session.workspace.can_view_organization_dashboard && !isPersonal && subject?.organizationEntryAllowed !== false,
      can_view_spark_library: Boolean(subject && subject.loginActive && subject.department.includes("品牌营销部") && /^(director|manager|总监|主管|主管\/负责人|中心负责人|部门负责人)$/.test(subject.sparkRole ?? subject.mappedRole)),
      can_view_public_summary: true,
      module_policy_state: subject ? `development-preview:${subject.sourceSheet}` : "development-preview",
    },
  };
}

function HubShell({ session, onLogout }: { session: HubSession; onLogout: () => void }) {
  const [view, setView] = useState<ViewKey>(() => window.location.hash === '#spark-library' ? 'spark' : 'hub');
  const [activeModule, setActiveModule] = useState<string | null>(() => {
    const module = initialModule(window.location.hash);
    return module && session.access.allowed_modules.includes(module) ? module : null;
  });
  const hasOpenedOrganizationDashboard = useRef(false);
  const organizationScrollPosition = useRef(0);
  const [organizationEntryScrollTop, setOrganizationEntryScrollTop] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [assistantRequest, setAssistantRequest] = useState<AssistantRequest | null>(null);
  const [preview, setPreview] = useState<PermissionPreview>({ active: false, scope: "real", center: "", person: "", label: "真实权限", subject: null, updatedAt: null });
  const [previewBusy, setPreviewBusy] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const canManage = Boolean(session.permissions.manage_permissions);
  const canViewLogs = Boolean(session.permissions.operation_admin);
  const canManageNavigation = canManage && !preview.active;
  const canViewLogsNavigation = canViewLogs && !preview.active;
  const presentationSession = sessionForPreview(session, preview);
  const canViewOrganization = presentationSession.workspace.can_view_organization_dashboard;
  const canViewSpark = presentationSession.workspace.can_view_spark_library === true;
  const canViewIncentives = presentationSession.access.allowed_modules.includes("material-incentive");
  const canViewRadar = presentationSession.access.allowed_modules.includes("creative-radar");
  const showOptimization = new Set(["director", "manager", "maintainer"]).has(presentationSession.workspace.role);
  useEffect(() => {
    if (!canManage) return;
    api.permissionPreview().then(setPreview).catch(() => undefined);
  }, [canManage]);
  const applyPreview = async (scope: DashboardScope | "real", center: string, person: string) => {
    setPreviewBusy(true);
    try {
      const next = await api.permissionPreviewUpdate(scope, center, person);
      setPreview(next);
      setNotice(next.active ? `已进入${next.label}；不会修改真实权限。` : "已返回真实权限视角。");
      setView("hub");
      setActiveModule(null);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "权限视角切换失败"); }
    finally { setPreviewBusy(false); }
  };
  const askAssistant = (prompt: string, source: string) => {
    setAssistantRequest({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      prompt,
      source,
    });
    setView("assistant");
  };
  const openRadar = () => {
    window.open("api/launch/creative-radar", "_blank", "noopener,noreferrer");
  };
  const openModule = (moduleId: string) => {
    const module = modules.find((item) => item.id === moduleId);
    if (!module || module.status === "building" || !presentationSession.access.allowed_modules.includes(moduleId)) {
      setNotice("当前账号无法进入这个功能区。");
      return;
    }
    setView("hub");
    setActiveModule(moduleId);
    window.history.replaceState(null, "", `#module=${moduleId}`);
  };
  const navigateTo = (nextView: ViewKey) => {
    setActiveModule(null);
    window.history.replaceState(null, '', nextView === 'spark' ? '#spark-library' : window.location.pathname + window.location.search);
    if (view === "organization" && nextView !== "organization") {
      organizationScrollPosition.current = window.scrollY;
    }
    if (nextView === "organization" && view !== "organization") {
      if (!hasOpenedOrganizationDashboard.current) {
        hasOpenedOrganizationDashboard.current = true;
        setOrganizationEntryScrollTop(0);
      } else {
        setOrganizationEntryScrollTop(organizationScrollPosition.current);
      }
    }
    setView(nextView);
  };
  useEffect(() => {
    if (activeModule && !presentationSession.access.allowed_modules.includes(activeModule)) {
      setActiveModule(null);
      setView("hub");
    }
    if (!canManageNavigation && view === "permissions") setView("hub");
    if (!canViewLogsNavigation && view === "logs") setView("hub");
    if (!canViewIncentives && view === "incentives") setView("hub");
    if (!canViewOrganization && view === "organization") setView("hub");
    if (!canViewSpark && view === "spark") setView("hub");
    if (!showOptimization && view === "optimization") setView("hub");
  }, [activeModule, presentationSession.access.allowed_modules, canManageNavigation, canViewIncentives, canViewLogsNavigation, canViewOrganization, canViewSpark, showOptimization, view]);

  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const toggleNavigation = () => {
    if (window.matchMedia("(max-width: 760px)").matches) setMobileNavigationOpen(value => !value);
    else setNavigationCollapsed(value => !value);
  };
  const selectedModule = activeModule ? modules.find((item) => item.id === activeModule) : undefined;

  return (
    <div className={`hub-page${selectedModule ? " hub-module-active" : ""}${navigationCollapsed ? " navigation-collapsed" : ""}${mobileNavigationOpen ? " mobile-navigation-open" : ""}`} data-navigation-release="grouped-workspace-20260920">
      <Sidebar active={view} activeModule={activeModule} canManage={canManageNavigation} canViewLogs={canViewLogsNavigation} canViewOrganization={canViewOrganization} canViewIncentives={canViewIncentives} canViewRadar={canViewRadar} showOptimization={showOptimization} session={presentationSession} onNavigate={(target) => { setMobileNavigationOpen(false); navigateTo(target); }} onOpenModule={(id) => { setMobileNavigationOpen(false); openModule(id); }} onOpenRadar={openRadar} onLogout={onLogout} />
      <div className="hub-shell">
        <header className="hub-header">
          <button className="navigation-toggle" type="button" aria-label="切换中枢导航" onClick={toggleNavigation}><AppsRegular /><span>{navigationCollapsed ? "展开导航" : "导航"}</span></button>
          <div className="breadcrumb"><span>WIS品牌营销部中枢</span><i>/</i><strong>{selectedModule ? selectedModule.purpose : view === "hub" ? workspaceHomeLabel(presentationSession) : viewLabels[view]}</strong></div>
          <div className="header-actions">
            {canManage && <PermissionPreviewSwitcher preview={preview} busy={previewBusy} onApply={applyPreview} />}
            <span className="identity-state"><i />{preview.active ? preview.label : "统一身份已登录"}</span>
            {canManageNavigation && view === "hub" && <Button appearance="secondary" icon={<ShieldLockRegular />} onClick={() => setView("permissions")}>权限管理</Button>}
          </div>
        </header>
        {preview.active && <div className="permission-preview-banner"><ShieldLockRegular /><span><strong>权限视角预览中：{preview.label}</strong><small>只改变当前最高权限账号的展示范围；真实授权、业务数据和其他成员均未改动。</small></span><button onClick={() => void applyPreview("real", "", "")}>退出预览</button></div>}
        {view === "hub" && selectedModule && <EmbeddedModulePage module={selectedModule} onReturn={() => navigateTo("hub")} />}
        {view === "hub" && !selectedModule && <HubHome session={presentationSession} notify={setNotice} onOpenModule={openModule} />}
        {view === "organization" && canViewOrganization && <OrganizationDashboardPage session={presentationSession} preview={preview} entryScrollTop={organizationEntryScrollTop} onAsk={(prompt) => askAssistant(prompt, "组织经营看板")} />}
        {view === "spark" && canViewSpark && <SparkLibrary key={`${session.user.number}:${session.workspace.spark_role}:${preview.updatedAt || 'real'}`} notify={setNotice} />}
        {view === "incentives" && canViewIncentives && <MaterialIncentivePage session={presentationSession} notify={setNotice} />}
        {view === "assistant" && <AssistantPage session={presentationSession} notify={setNotice} initialRequest={assistantRequest} onInitialRequestConsumed={(requestId) => setAssistantRequest((current) => current?.id === requestId ? null : current)} onOpenModule={openModule} />}
        {view === "optimization" && showOptimization && <OptimizationCenterPage session={presentationSession} onAnalyze={(prompt) => askAssistant(prompt, "主动优化中心")} />}
        {view === "logs" && canViewLogsNavigation && <OperationLogsPage />}
        {view === "permissions" && canManageNavigation && <PermissionCenterPage notify={setNotice} />}
        <footer className="hub-footer"><span>WIS品牌营销部中枢</span><span>统一登录 · 业务路线 · AI 管家 · 分界面授权</span></footer>
      </div>
      {view !== "assistant" && view !== "hub" && <button type="button" className="assistant-fab" onClick={() => setView("assistant")}><BotRegular /><span>问 AI 管家</span></button>}
      {notice && <div className="prototype-toast" role="status"><CheckmarkCircleFilled /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示"><DismissRegular /></button></div>}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<HubSession | null>(null);
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const value = await api.session();
        if (alive) setSession(previous => previous && JSON.stringify(previous) !== JSON.stringify(value) ? value : previous);
      } catch (cause) {
        if (alive && cause instanceof ApiError && [401, 403].includes(cause.status)) {
          setSession(null); setError(cause.message);
        }
      } finally { pending = false; }
    };
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('wis-permissions-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false; window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('wis-permissions-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    let retryTimer = 0;
    setError("");
    api.session()
      .then((value) => {
        if (!active) return;
        setRecovering(false);
        setSession(value);
      })
      .catch((cause) => {
        if (!active) return;
        const transient = isTransientApiError(cause);
        setRecovering(transient);
        setError(transient
          ? "权限服务发生了短暂切换，系统会自动重试；这不代表当前账号没有权限。"
          : cause instanceof ApiError ? cause.message : "统一权限校验失败，请重新校验");
        if (transient) retryTimer = window.setTimeout(() => setVerificationAttempt((value) => value + 1), 5_000);
      });
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [verificationAttempt]);
  const retryNow = () => {
    setSession(null);
    setError("");
    setVerificationAttempt((value) => value + 1);
  };
  const logout = async () => {
    try {
      await api.hubLogout();
      setSession(null);
      setRecovering(false);
      setError("已退出中枢，请使用 OA 账号重新登录。");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "退出暂未完成，请稍后重试");
    }
  };
  return (
    <FluentProvider theme={hubTheme}>
      {error ? <AccessError message={error} recovering={recovering} onRetry={retryNow} /> : session ? <HubShell session={session} onLogout={() => void logout()} /> : <LoadingScreen />}
    </FluentProvider>
  );
}
