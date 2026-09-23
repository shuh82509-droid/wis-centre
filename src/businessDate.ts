/** Dates describe the source business window, never the browser clock or fetch time. */
export function businessDate(value: string | null | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function businessDateLabel(value: string | null | undefined) {
  return businessDate(value) || "日期待核验";
}

export function combinedBusinessDateLabel(channels: Array<{ todayDate?: string | null }> | null | undefined) {
  const dates = (channels || []).map(channel => businessDate(channel.todayDate));
  if (!dates.length || dates.some(date => !date)) return "日期待核验";
  return new Set(dates).size === 1 ? dates[0]! : "跨日期快照（日期不一致）";
}
