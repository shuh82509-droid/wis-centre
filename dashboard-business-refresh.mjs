const OFFICIAL_MODE = 'verified-official-qianchuan-video-financial-partitions';
export const BUSINESS_RECHECK_INTERVAL_MS = 5_000;
export const BUSINESS_RECHECK_LIMIT = 24;
export const BUSINESS_RECHECK_WINDOW_MS = 180_000;

function officialScope(job) {
  const value = job.results.business;
  if (value?.status !== 200) return null;
  const material = value.payload?.coverage?.material;
  if (material?.sourceMode !== OFFICIAL_MODE) return null;
  const coverage = material.importCoverage;
  const start = new Date(`${job.businessDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - job.materialDays + 1);
  const matches = Number.isFinite(start.getTime()) && coverage?.startDate === start.toISOString().slice(0, 10)
    && coverage?.endDate === job.businessDate && coverage?.requestedDays === job.materialDays;
  return { material, coverage, matches, summary: value.payload?.summary };
}

export function officialBusinessRefreshState(job, now = Date.now()) {
  const scope = officialScope(job);
  if (!scope) return null;
  // Read the current official coverage, never the legacy root-MCP sourceStates.
  if (scope.material.state === 'available' && scope.matches
      && Number.isFinite(scope.summary?.materialActualPayGmvYuan)
      && Number.isFinite(scope.summary?.materialCouponInclusiveGmvYuan)) {
    return { state: 'ready', pending: false, exhausted: false, checks: job.businessRecheck?.checks || 0, note: '' };
  }
  if (!scope.matches || scope.coverage.state !== 'complete' || scope.coverage.missingDays?.length) {
    return { state: 'unavailable', pending: false, exhausted: false, checks: 0,
      note: '所选周期的官方日文件尚未齐备，保留真实缺口；不会用其他日期或旧账户范围补齐。' };
  }
  if (!job.businessRecheck) job.businessRecheck = { startedAt: now, checks: 0, nextCheckAt: now + BUSINESS_RECHECK_INTERVAL_MS };
  const current = job.businessRecheck;
  const exhausted = current.checks >= BUSINESS_RECHECK_LIMIT || now - current.startedAt >= BUSINESS_RECHECK_WINDOW_MS;
  return { state: exhausted ? 'waiting' : 'reading', pending: !exhausted, exhausted, checks: current.checks,
    note: exhausted ? '官方日文件已齐备，本次自动复查已结束，汇总仍待返回；可稍后刷新看板。'
      : '官方日文件已齐备，正在读取所选周期的素材成交；结果返回后自动显示。' };
}

export function recheckOfficialBusiness(job, read, now = Date.now()) {
  const state = officialBusinessRefreshState(job, now);
  if (!state?.pending || job.pending.has('business') || now < job.businessRecheck.nextCheckAt) return null;
  job.pending.add('business');job.completedAt = null;
  job.businessRecheck.checks += 1;
  const settle = (value) => {
    job.attempts.business = value;
    const transient = value.status >= 500 || [408, 425, 429].includes(value.status);
    if (value.status === 200 || !transient || job.results.business?.status !== 200) job.results.business = value;
  };
  const operation = Promise.resolve().then(read).then(settle).catch(() => settle({ status: 503, payload: { detail: '官方周期汇总暂时无法读取，保留最近返回结果' } })).finally(() => {
    job.pending.delete('business');job.updatedAt = Date.now();
    job.businessRecheck.nextCheckAt = job.updatedAt + BUSINESS_RECHECK_INTERVAL_MS;
    if (!job.pending.size) job.completedAt = job.updatedAt;
  });
  return operation;
}
