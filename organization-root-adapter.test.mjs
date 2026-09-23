import test from 'node:test';
import assert from 'node:assert/strict';
import { rootMaterialRequest, normalizeRootMaterialUploads, rootMaterialSnapshotForDate, rootSourceRefreshState } from './organization-root-adapter.mjs';

const date = '2026-09-08';
const receivedAt = '2026-09-09T14:00:00+08:00';
const sourceUpdatedAt = '2026-09-09T08:00:00+08:00';
const trend = overrides => ({ granularity: 'day', startDate: date, endDate: date, availableFrom: date, availableTo: date,
  items: [{ period: date, onlineTotal: 231, mappedOnline: 210, unmappedOnline: 21, sourceUpdatedAt, state: 'partial' }], ...overrides });

test('request uses the deployed single-day aggregate endpoint and rejects invalid dates', () => {
  assert.equal(rootMaterialRequest(date).path, '/dashboard/material-online-trend?startDate=2026-09-08&endDate=2026-09-08');
  for (const invalid of ['2026-02-30', '2026-9-8', '', null, '2026-09-08&force=1']) assert.throws(() => rootMaterialRequest(invalid), TypeError);
});

test('full aggregate remains observed, never claims verified publication or metadata coverage', () => {
  const value = normalizeRootMaterialUploads(trend(), { date, receivedAt });
  assert.equal(value.status, 'partial');
  assert.equal(value.channels[0].observedAssets, 231);
  assert.equal(value.channels[0].confirmedAssets, null);
  assert.equal(value.channels[0].metadataCoverage.rate, null);
  assert.equal(value.channels[0].metadataCoverage.onlineTimeMaterials, null);
  assert.equal(value.channels[1].observedAssets, null);
  assert.equal(value.channels[1].confirmedAssets, null);
  assert.equal(value.channels[1].state, 'pending');
  assert.equal(value.generatedAt, sourceUpdatedAt);
  assert.equal(value.retrievedAt, receivedAt);
  assert.match(value.channels[0].note, /首次观测日期兜底/u);
});

test('same source supports the platform data envelope, without mistaking an error for data', () => {
  assert.equal(normalizeRootMaterialUploads({ data: trend() }, { date }).channels[0].observedAssets, 231);
  assert.equal(normalizeRootMaterialUploads({ error: { code: 'UNAUTHORIZED' } }, { date }), null);
  assert.equal(normalizeRootMaterialUploads('<html>login</html>', { date }), null);
});

test('empty, missing and invalid counts stay null; a real observed zero stays zero', () => {
  assert.equal(normalizeRootMaterialUploads(trend({ items: [] }), { date }).channels[0].observedAssets, null);
  for (const count of [null, undefined, '12', -1, 1.5, NaN, Infinity]) {
    const value = normalizeRootMaterialUploads(trend({ items: [{ period: date, onlineTotal: count }] }), { date });
    assert.equal(value.channels[0].observedAssets, null);
    assert.equal(value.generatedAt, null);
  }
  assert.equal(normalizeRootMaterialUploads(trend({ items: [{ period: date, onlineTotal: 0 }] }), { date }).channels[0].observedAssets, 0);
});

test('date, aggregation and duplicate guards cannot relabel another period', () => {
  for (const payload of [trend({ endDate: '2026-09-01' }), trend({ granularity: 'week' }),
    trend({ items: [{ period: '2026-09-01', onlineTotal: 999 }] }), trend({ items: [trend().items[0], trend().items[0]] })]) {
    assert.equal(normalizeRootMaterialUploads(payload, { date }), null);
  }
});

test('materials snapshot uses exact daily aggregate, ignoring its latest-day total and limited winners', () => {
  const payload = { requestedTo: date, reportDate: '2026-09-01', availableTo: '2026-09-01', onlineTotal: 999,
    periodMaterials: Array.from({ length: 500 }, () => ({ gmvYuan: 20_000 })), dailyOnline: [] };
  const missing = normalizeRootMaterialUploads(payload, { date });
  assert.equal(missing.status, 'stale');
  assert.equal(missing.channels[0].observedAssets, null);
  const value = normalizeRootMaterialUploads({ ...payload, availableTo: date, dailyOnline: [{ date, onlineTotal: 1200 }] }, { date });
  assert.equal(value.channels[0].observedAssets, 1200);
  assert.equal(value.generatedAt, null);
  assert.equal(normalizeRootMaterialUploads({ ...payload, requestedTo: '2026-09-01' }, { date }), null);
});

test('source staleness and exact-date disk fallback preserve business date', () => {
  const value = normalizeRootMaterialUploads(trend({ deliveryState: 'stale-cache' }), { date });
  assert.equal(value.status, 'stale');
  assert.equal(rootMaterialSnapshotForDate(value, date), value);
  assert.equal(rootMaterialSnapshotForDate(value, '2026-09-07'), null);
});

test('a failed refresh retains the error and stops claiming it is still running', () => {
  assert.deepEqual(rootSourceRefreshState({ cached: true, pending: true }), { state: 'stale', refreshing: true, failureStatus: null });
  for (const status of [401, 403, 404, 429, 503]) {
    assert.deepEqual(rootSourceRefreshState({ result: { status }, cached: true }), { state: 'stale', refreshing: false, failureStatus: status });
  }
  assert.deepEqual(rootSourceRefreshState({ result: { status: 200 } }), { state: 'ready', refreshing: false, failureStatus: null });
});
