/** A source timestamp is never a browser-local timestamp. */
export function sourceTime(value: string | null | undefined) {
  if (!value) return "尚无记录";
  const text = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    // Preserve source-local values without assuming the source timezone.
    return text.replace("T", " ") + (/\d{2}:\d{2}/.test(text) ? "（时区未标注）" : "");
  }
  if (!Number.isFinite(Date.parse(text))) return "时间格式待核验";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(text));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}（北京时间）`;
}
