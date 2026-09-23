import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwiseRegular, CheckmarkCircleFilled, LockClosedRegular, PeopleRegular, WarningRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";
import type { HubSession, LibTvCreditAuthStatus, LibTvCreditTrend, PermissionPreview } from "./types";
import "./organization-libtv-credits.css";

function points(value: number | null | undefined) {
  return value === null || value === undefined
    ? "待回补"
    : `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)} 点`;
}

function compactDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}.${Number(day)}`;
}

function timeText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function TrendChart({ series, title }: { series: Array<{ date: string; consumed: number | null }>; title: string }) {
  const width = 1000;
  const height = 230;
  const padX = 42;
  const padTop = 18;
  const padBottom = 40;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padTop - padBottom;
  const values = series.map((item) => item.consumed ?? 0);
  const max = Math.max(...values, 1);
  const step = series.length > 1 ? chartWidth / (series.length - 1) : chartWidth;
  const coordinates = series.map((item, index) => ({
    x: series.length > 1 ? padX + index * step : width / 2,
    y: padTop + chartHeight - (item.consumed ?? 0) / max * chartHeight,
    ...item,
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = coordinates.length
    ? `M ${coordinates[0].x} ${padTop + chartHeight} L ${coordinates.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${coordinates.at(-1)?.x} ${padTop + chartHeight} Z`
    : "";
  const labelEvery = Math.max(1, Math.ceil(series.length / 12));
  return <div className="libtv-trend-chart" role="img" aria-label={`${title}每日积分消耗趋势`}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {[0, 0.5, 1].map((ratio) => <g key={ratio}>
        <line x1={padX} x2={width - padX} y1={padTop + chartHeight * ratio} y2={padTop + chartHeight * ratio} />
        <text x={4} y={padTop + chartHeight * ratio + 4}>{Math.round(max * (1 - ratio)).toLocaleString("zh-CN")}</text>
      </g>)}
      {area && <path className="libtv-trend-area" d={area} />}
      {line && <polyline className="libtv-trend-line" points={line} />}
      {coordinates.map((point, index) => <g key={point.date}>
        <circle className="libtv-trend-point" cx={point.x} cy={point.y} r={series.length > 30 ? 2 : 3.5}><title>{point.date} · {points(point.consumed)}</title></circle>
        {(index % labelEvery === 0 || index === coordinates.length - 1) && <text className="libtv-trend-date" x={point.x} y={height - 10}>{compactDate(point.date)}</text>}
      </g>)}
    </svg>
  </div>;
}

export function LibTvCreditTrendPanel({ session, preview }: { session: HubSession; preview?: PermissionPreview | null }) {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [data, setData] = useState<LibTvCreditTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMember, setSelectedMember] = useState("all");
  const [memberQuery, setMemberQuery] = useState("");
  const [auth, setAuth] = useState<LibTvCreditAuthStatus | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");

  const load = async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const value = await api.libtvCredits(days, preview, force);
      setData(value);
      if (value.status === "auth_required" && session.permissions.operation_admin) {
        setAuth(await api.libtvCreditAuth().catch(() => null));
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "LibTV 积分数据读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [days, preview?.updatedAt]);
  useEffect(() => {
    const timer = window.setInterval(() => { void api.libtvCredits(days, preview).then(setData).catch(() => undefined); }, 300_000);
    return () => window.clearInterval(timer);
  }, [days, preview?.updatedAt]);

  const currentMember = data?.members.find((member) => member.userId === selectedMember) || null;
  const chartSeries = currentMember?.series || data?.series || [];
  const memberMax = Math.max(...(data?.members || []).flatMap((member) => member.series.map((item) => item.consumed)), 1);
  const normalizedQuery = memberQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleMembers = (data?.members || []).filter((member) => !normalizedQuery || member.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  const visibleTransactions = (data?.transactions || [])
    .filter((item) => selectedMember === "all" || item.userId === selectedMember)
    .slice(0, 12);

  const authRequired = data?.status === "auth_required";
  const sendCode = async () => {
    setLoginBusy(true);
    setLoginMessage("");
    try {
      const result = await api.libtvCreditLoginSend(phone);
      setAuth(result);
      setLoginMessage(result.message);
    } catch (cause) {
      setLoginMessage(cause instanceof ApiError ? cause.message : "验证码发送失败");
    } finally {
      setLoginBusy(false);
    }
  };
  const verifyCode = async () => {
    setLoginBusy(true);
    setLoginMessage("");
    try {
      const result = await api.libtvCreditLoginVerify(phone, code);
      setAuth(result);
      setCode("");
      setLoginMessage(result.message);
      await load(true);
    } catch (cause) {
      setLoginMessage(cause instanceof ApiError ? cause.message : "验证码验证失败");
    } finally {
      setLoginBusy(false);
    }
  };

  return <section className={`libtv-credit-panel is-${data?.status || "loading"}`}>
    <header className="libtv-credit-header">
      <div><span>AI PRODUCTION COST</span><h2>LibTV 积分消耗趋势</h2><p>团队总消耗与各子账号每日明细；积分代表 AI 生产资源，不等同于绩效。</p></div>
      <div className="libtv-credit-controls">
        <label><span>统计周期</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label>
        <label><span>子账号</span><select value={selectedMember} onChange={(event) => setSelectedMember(event.target.value)}><option value="all">全部子账号</option>{(data?.members || []).map((member) => <option value={member.userId} key={member.userId}>{member.name}</option>)}</select></label>
        <Button appearance="secondary" disabled={loading} icon={loading ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />} onClick={() => void load(true)}>刷新</Button>
      </div>
    </header>

    {error && <div className="libtv-credit-alert"><WarningRegular />{error}</div>}
    {data?.status === "stale" && <div className="libtv-credit-alert is-stale"><WarningRegular />{data.source.note}</div>}

    {authRequired ? <div className="libtv-credit-auth">
      <LockClosedRegular />
      <div><strong>连接 LibTV 团队管理员账号</strong><p>{data?.source.note || auth?.message || "连接后自动读取团队积分明细；凭证只保存在服务器私有数据卷。"}</p></div>
      {session.permissions.operation_admin ? <div className="libtv-credit-login-fields">
        <label><span>LibTV 手机号</span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入 11 位手机号" /></label>
        <Button disabled={loginBusy || !phone} onClick={() => void sendCode()}>{loginBusy ? "处理中" : auth?.status === "code_sent" ? "重新发送" : "发送验证码"}</Button>
        {auth?.status === "code_sent" && <><label><span>短信验证码</span><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))} placeholder="6 位验证码" /></label><Button appearance="primary" disabled={loginBusy || code.length !== 6} onClick={() => void verifyCode()}>完成连接</Button></>}
        {loginMessage && <em>{loginMessage}</em>}
      </div> : <em>请联系中枢运营管理员完成一次团队账号连接。</em>}
    </div> : <>
      <div className="libtv-credit-summary">
        <article><span>今日消耗</span><strong>{points(data?.summary.todayConsumed)}</strong><small>{data?.range.endDate || "今日"}</small></article>
        <article><span>周期总消耗</span><strong>{points(data?.summary.consumed)}</strong><small>{data ? `${data.range.startDate} 至 ${data.range.endDate}` : "周期待回补"}</small></article>
        <article><span>日均消耗</span><strong>{points(data?.summary.dailyAverage)}</strong><small>按所选完整自然日平均</small></article>
        <article><span>当前余额</span><strong>{points(data?.summary.currentBalance)}</strong><small>{data?.summary.currentBalance === null ? "余额接口待回补" : data?.team.name || "团队账号"}</small></article>
      </div>

      <div className="libtv-credit-chart-card">
        <header><div><strong>{currentMember ? `${currentMember.name}每日消耗` : "团队每日总消耗"}</strong><small>{data?.summary.transactionCount === null ? "任务笔数待回补" : `${data?.summary.transactionCount.toLocaleString("zh-CN")} 笔消耗记录`}</small></div><em className={`is-${data?.status}`}>{data?.status === "ready" ? "实时接口" : "最近快照"}</em></header>
        <TrendChart series={chartSeries} title={currentMember?.name || "团队"} />
      </div>

      <div className="libtv-member-breakdown">
        <header><div><span>SUBACCOUNT DAILY BREAKDOWN</span><h3>各子账号每日细分</h3><p>颜色越深表示当日积分消耗越高；无消耗的完整日显示 0。</p></div><label><span>搜索子账号</span><input type="search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="输入子账号名称" /></label></header>
        <div className="libtv-member-table" style={{ minWidth: `${180 + Math.max(data?.series.length || 0, 1) * 54}px` }}>
          <div className="libtv-member-row is-head" style={{ gridTemplateColumns: `180px repeat(${Math.max(data?.series.length || 0, 1)}, minmax(48px, 1fr))` }}><b>子账号 / 周期总计</b>{(data?.series || []).map((item) => <span key={item.date}>{compactDate(item.date)}</span>)}</div>
          {visibleMembers.map((member) => <button type="button" className={`libtv-member-row${selectedMember === member.userId ? " is-selected" : ""}`} style={{ gridTemplateColumns: `180px repeat(${Math.max(member.series.length, 1)}, minmax(48px, 1fr))` }} onClick={() => setSelectedMember(member.userId)} key={member.userId}><b>{member.name}<small>{points(member.total)}</small></b>{member.series.map((item) => <span style={{ backgroundColor: `rgba(16, 137, 110, ${0.08 + item.consumed / memberMax * 0.72})` }} title={`${item.date} · ${points(item.consumed)}`} key={item.date}>{item.consumed.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</span>)}</button>)}
        </div>
        {!visibleMembers.length && <div className="libtv-credit-empty"><PeopleRegular /><strong>{data?.members.length ? "没有匹配的子账号" : "本周期没有消耗记录"}</strong><span>{data?.members.length ? "请更换搜索关键词。" : "接口已成功返回，完整日按实际 0 消耗展示。"}</span></div>}
      </div>

      <div className="libtv-credit-transactions">
        <header><div><span>RECENT TASK DETAIL</span><h3>最近消耗明细</h3></div><small>{selectedMember === "all" ? "全部子账号" : currentMember?.name}</small></header>
        {visibleTransactions.length ? <div className="libtv-transaction-list">{visibleTransactions.map((item) => <article key={item.id}><time>{timeText(item.occurredAt)}</time><strong>{item.userName}</strong><span>{item.sourceName || "任务类型待回补"}<small>{[item.modelName, item.projectName].filter(Boolean).join(" · ") || "模型/项目待回补"}</small></span><em>-{points(item.consumed)}</em></article>)}</div> : <div className="libtv-credit-empty"><CheckmarkCircleFilled /><strong>当前筛选没有消耗明细</strong><span>这表示接口成功范围内没有记录，不会用示例数据填充。</span></div>}
      </div>
    </>}

    <footer><span>{data?.source.label || "LibTV 团队积分管理"} · {data?.source.note || "正在读取"}</span><small>{data?.source.updatedAt ? `更新 ${timeText(data.source.updatedAt)}` : "更新时间待回补"}</small></footer>
  </section>;
}
