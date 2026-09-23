// Adapter for the endpoints present in production root-dashboard release
// 20260901-093456. These counts are observations, not verified publication receipts.

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requestedDate(date) {
  if (!validDate(date)) throw new TypeError('根数据请求必须使用有效的自然日 YYYY-MM-DD');
  return date;
}

function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sourceTime(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function materialPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Array.isArray(value.items) || Array.isArray(value.dailyOnline)) return value;
  if (value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    && (Array.isArray(value.data.items) || Array.isArray(value.data.dailyOnline))) return value.data;
  return null;
}

export function rootMaterialRequest(date) {
  const selected = requestedDate(date);
  return {
    path: `/dashboard/material-online-trend?startDate=${selected}&endDate=${selected}`,
    timeoutMs: 120_000,
  };
}

/**
 * Map the existing single-day aggregate, never the GMV >= 20,000 / LIMIT 500
 * periodMaterials list. A selected date never borrows another day's rows.
 * generatedAt is deliberately the upstream source time, not this adapter's clock.
 */
export function normalizeRootMaterialUploads(value, { date, receivedAt = null } = {}) {
  const selected = requestedDate(date);
  const payload = materialPayload(value);
  if (!payload) return null;
  let row = null;
  let sourceEndpoint;
  if (Array.isArray(payload.items)) {
    if (payload.granularity !== 'day' || payload.startDate !== selected || payload.endDate !== selected) return null;
    if (payload.items.some(item => !item || item.period !== selected)) return null;
    if (payload.items.length > 1) return null;
    row = payload.items[0] || null;
    sourceEndpoint = '/dashboard/material-online-trend';
  } else {
    // The material detail endpoint clamps future ranges and can contain older
    // days. Its reportDate/onlineTotal refer to the last available day, not ours.
    if (payload.requestedTo !== selected) return null;
    const matches = payload.dailyOnline.filter(item => item?.date === selected);
    if (matches.length > 1) return null;
    row = matches[0] || null;
    sourceEndpoint = '/dashboard/materials';
  }
  const observed = count(row?.onlineTotal);
  const updatedAt = sourceTime(row?.sourceUpdatedAt) || sourceTime(payload.sourceUpdatedAt);
  const stale = payload.cacheState === 'stale-while-refresh' || payload.deliveryState === 'stale-cache'
    || payload.status === 'stale' || (validDate(payload.availableTo) && payload.availableTo < selected);
  const douyinNote = observed === null
    ? `${selected} 未返回可核验的素材观测汇总；缺失数量待回补。`
    : `${selected} 根数据观测到 ${observed} 条素材；包含平台创建时间及乘方首次观测日期兜底，不能等同于已核验上线。`;
  return {
    schemaVersion: 2,
    date: selected,
    generatedAt: updatedAt,
    retrievedAt: sourceTime(receivedAt),
    status: stale ? 'stale' : 'partial',
    sourceMode: 'root-data',
    sourceEndpoint,
    availableFrom: validDate(payload.availableFrom) ? payload.availableFrom : null,
    availableTo: validDate(payload.availableTo) ? payload.availableTo : null,
    definition: '按所选自然日读取根数据全量素材聚合；观测数量与已核验上线、视频号发布分别展示，缺失不按 0 计算。',
    channels: [
      {
        key: 'douyin', label: '抖音', confirmedAssets: null, observedAssets: observed,
        state: observed === null ? 'pending' : 'partial', updatedAt,
        sourceTable: 'qianchuan_material_asset_ledger + 千川/乘方素材快照',
        timeField: 'platform_create_time；乘方 material_online_time 缺失时回退首次 report_date',
        dedupeKey: 'advertiser_id + platform_material_type + material_id',
        metadataCoverage: { onlineTimeMaterials: null, totalMaterials: observed, rate: null },
        note: douyinNote,
      },
      {
        key: 'wechat', label: '视频号', confirmedAssets: null, observedAssets: null,
        state: 'pending', updatedAt: null,
        sourceTable: '', timeField: '待接入真实发布时间', dedupeKey: 'finder_account_id + feed_id',
        metadataCoverage: { onlineTimeMaterials: null, totalMaterials: null, rate: null },
        note: `${selected} 当前根数据接口未提供视频号内容发布统计，待回补。`,
      },
    ],
  };
}

/** A disk fallback is only eligible for the exact requested business date. */
export function rootMaterialSnapshotForDate(snapshot, date) {
  requestedDate(date);
  if (!snapshot || snapshot.date !== date || !Array.isArray(snapshot.channels)) return null;
  return snapshot;
}

/** Keep failure evidence even when a same-day successful snapshot is available. */
export function rootSourceRefreshState({ result, pending = false, cached = false } = {}) {
  if (pending) return { state: cached ? 'stale' : 'pending', refreshing: true, failureStatus: null };
  const status = Number(result?.status);
  if (status >= 200 && status < 300) return { state: cached ? 'stale' : 'ready', refreshing: false, failureStatus: null };
  return {
    state: cached ? 'stale' : 'pending', refreshing: false,
    failureStatus: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null,
  };
}
