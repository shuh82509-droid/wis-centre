import { useMemo, useState } from "react";
import type { OmnichannelRealtimeOverview, OmnichannelRealtimePoint, OmnichannelRealtimeSeries } from "./types";
import { businessDateLabel, combinedBusinessDateLabel } from "./businessDate";
import { sourceTime } from "./sourceTime";
import "./omnichannel-realtime.css";

type ChartMode = "cumulative" | "hourly";

function comparisonTrendClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "omni-change-neutral";
  return value > 0 ? "omni-change-up" : "omni-change-down";
}

function wan(value: number | null | undefined) {
  if (value === null || value === undefined) return "待回补";
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined) return "待回补";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function hourLabel(hour: number | null | undefined) {
  return hour === null || hour === undefined ? "待回补" : `${String(hour).padStart(2, "0")}:00`;
}

function linePath(points: OmnichannelRealtimePoint[], accessor: (point: OmnichannelRealtimePoint) => number | null, max: number) {
  const resolved = points.flatMap((point) => {
    const value = accessor(point);
    if (value === null) return [];
    return [{ x: 24 + point.hour / 23 * 592, y: 194 - value / max * 152 }];
  });
  return resolved.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function RealtimeChannelCard({ channel }: { channel: OmnichannelRealtimeSeries }) {
  const isDouyin = channel.key === "douyin";
  const spendPartial = channel.spendCoverage !== "complete";
  const date = businessDateLabel(channel.todayDate);
  const comparisonDate = businessDateLabel(channel.yesterdayDate);
  return <article className={`omni-live-card is-${channel.key}`}>
    <header><span>{channel.label}</span><em>{isDouyin ? "DOUYIN" : "WECHAT CHANNEL"}</em></header>
    <div className="omni-live-main">
      <div><small>{date} 有效成交 GSV</small><strong>{wan(channel.todayTotalYuan)}</strong><span className={comparisonTrendClass(channel.comparisonPct)}>{percent(channel.comparisonPct, true)} vs {comparisonDate} 完整小时</span></div>
      <div><small>{date} {spendPartial ? "可见投放占比" : "投放占比"}</small><strong className="is-ratio">{percent(channel.todaySpendRatioPct)}</strong><span>已回传投放 {wan(channel.todaySpendYuan)}</span></div>
    </div>
    <div className="omni-spend-breakdown">
      {channel.spendBreakdown.map((item) => <span key={item.key}>{item.label} {wan(item.valueYuan)}</span>)}
      {!channel.spendBreakdown.length && <span>费用分项待回补</span>}
    </div>
    <footer><span>{date} 累计至 {hourLabel(channel.dataThroughHour)}</span><span>对比截至 {hourLabel(channel.comparisonThroughHour)} 完整小时</span>{spendPartial && <em>费用覆盖部分</em>}</footer>
  </article>;
}

function ComparisonChart({ channel }: { channel: OmnichannelRealtimeSeries }) {
  const [mode, setMode] = useState<ChartMode>("cumulative");
  const date = businessDateLabel(channel.todayDate);
  const comparisonDate = businessDateLabel(channel.yesterdayDate);
  const values = useMemo(() => channel.points.flatMap((point) => {
    const today = mode === "cumulative" ? point.todayCumulativeYuan : point.todayHourlyYuan;
    const yesterday = mode === "cumulative" ? point.yesterdayCumulativeYuan : point.yesterdayHourlyYuan;
    return [today, yesterday].filter((value): value is number => value !== null);
  }), [channel.points, mode]);
  const max = Math.max(...values, 1) * 1.08;
  const todayPath = linePath(channel.points, (point) => mode === "cumulative" ? point.todayCumulativeYuan : point.todayHourlyYuan, max);
  const yesterdayPath = linePath(channel.points, (point) => mode === "cumulative" ? point.yesterdayCumulativeYuan : point.yesterdayHourlyYuan, max);
  return <article className={`omni-chart-card is-${channel.key}`}>
    <header>
      <div><span>{channel.key === "douyin" ? "DOUYIN" : "WECHAT CHANNEL"}</span><h3>{channel.label} · {date} vs {comparisonDate}</h3></div>
      <div className="omni-chart-switch"><button className={mode === "cumulative" ? "is-active" : ""} onClick={() => setMode("cumulative")}>累计趋势</button><button className={mode === "hourly" ? "is-active" : ""} onClick={() => setMode("hourly")}>每小时对比</button></div>
    </header>
    <div className="omni-chart-kpis">
      <span><small>{date} 完整小时</small><strong>{wan(channel.todayComparisonYuan)}</strong></span>
      <span><small>{comparisonDate} 同进度</small><strong>{wan(channel.yesterdaySameTimeYuan)}</strong></span>
      <span><small>较 {comparisonDate} 同进度</small><strong className={comparisonTrendClass(channel.comparisonPct)}>{percent(channel.comparisonPct, true)}</strong></span>
      <span><small>对比进度</small><strong>{hourLabel(channel.comparisonThroughHour)}</strong></span>
    </div>
    <div className="omni-svg-wrap">
      <svg viewBox="0 0 640 224" role="img" aria-label={`${channel.label} ${date} 与 ${comparisonDate} GSV ${mode === "cumulative" ? "累计" : "每小时"}趋势`}>
        {[0, 1, 2, 3].map((line) => <line key={line} x1="24" y1={42 + line * 51} x2="616" y2={42 + line * 51} className="grid-line" />)}
        <path d={yesterdayPath} className="yesterday-line" />
        <path d={todayPath} className="today-line" />
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => <text key={hour} x={24 + hour / 23 * 592} y="216">{String(hour).padStart(2, "0")}:00</text>)}
      </svg>
      {!todayPath && <div className="omni-chart-empty">{date} 完整小时数据待回补</div>}
    </div>
    <div className="omni-chart-legend"><span><i className="today" />{date} {mode === "cumulative" ? "累计" : "每小时"} GSV</span><span><i className="yesterday" />{comparisonDate} {mode === "cumulative" ? "累计" : "每小时"} GSV</span></div>
    <footer>数据源更新 {sourceTime(channel.sourceUpdatedAt)} · 当前小时不参与对比</footer>
  </article>;
}

export function OmnichannelRealtime({ data }: { data: OmnichannelRealtimeOverview | null }) {
  if (!data) return <section className="omni-realtime omni-is-empty"><strong>抖店、视频号实时 GSV 正在读取</strong><span>根数据暂未返回时不会用 0 补齐。</span></section>;
  return <section className="omni-realtime">
    <header className="omni-section-head">
      <div><span>GSV · BUSINESS DATE COMPARISON</span><h2>抖店、视频号 GSV 时段对比</h2><p>按下方实际业务日期展示累计 GSV；对比和折线只比较已完整结束的小时，当前小时不参与。</p></div>
      <div className="omni-total"><small>{combinedBusinessDateLabel(data.channels)} · 部门全渠道有效 GSV</small><strong>{wan(data.summary.departmentTodayGsvYuan)}</strong><em>抖店＋视频号</em></div>
      <i><b />5分钟自动更新</i>
    </header>
    <div className="omni-live-grid">{data.channels.map((channel) => <RealtimeChannelCard channel={channel} key={channel.key} />)}</div>
    <div className="omni-chart-grid">{data.channels.map((channel) => <ComparisonChart channel={channel} key={channel.key} />)}</div>
    <footer className="omni-definition"><strong>统一口径</strong><span>{data.definitions.departmentPerformance} {data.definitions.qianchuanAttribution} {data.definitions.spendCoverage}</span>{data.status === "stale" && <em>当前展示最近成功快照</em>}</footer>
  </section>;
}
