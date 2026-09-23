import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AddRegular, ArrowClockwiseRegular, ArrowDownloadRegular, ArrowUploadRegular, ChevronLeftRegular, ChevronRightRegular, DismissRegular, EditRegular, FilterRegular, LinkRegular, SearchRegular } from '@fluentui/react-icons';
import type { SparkActor, SparkItem, SparkOverview, SparkScoreKey, SparkSource, SparkStatus } from './spark-types';
import './spark-library.css';

const STATUS: Record<SparkStatus, string> = { draft: '草稿', published: '已发布', implemented: '已落地', failed: '验证失败' };
const DIMENSIONS: Array<{ key: SparkScoreKey; label: string; weight: number }> = [
  { key: 'business', label: '业务价值', weight: 35 }, { key: 'execution', label: '可执行性', weight: 25 },
  { key: 'evidence', label: '证据强度', weight: 25 }, { key: 'reuse', label: '复用潜力', weight: 15 },
];
const PAGE_SIZE = 20;
const text = (value: unknown, missing = '待核验'): string => typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : missing;
const sourceName = (source: SparkSource) => text(source.name || source.channel);
const sourceLimit = (source: SparkSource) => Array.isArray(source.limitations) ? source.limitations.join('；') : source.limitations || source.limitation || '';
const safeUrl = (value: unknown) => { try { const url = new URL(typeof value === 'string' ? value : ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const dateValue = (value?: string) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const dateLabel = (value?: string, time = false) => {
  if (!value) return '待核验';
  if (!dateValue(value)) return text(value);
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) });
};
const score = (item: SparkItem): number | null => DIMENSIONS.every(d => typeof item.scoreDimensions?.[d.key] === 'number' && Number.isFinite(item.scoreDimensions[d.key]) && item.scoreDimensions[d.key]! >= 0 && item.scoreDimensions[d.key]! <= 5)
  ? Math.round(DIMENSIONS.reduce((sum, d) => sum + item.scoreDimensions![d.key]! * d.weight / 5, 0)) : null;
const plainQuote = (quote?: string) => quote?.replace(/<\/(?:p|div|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || '原文待核验';
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const statusLabel = (status: string) => STATUS[status as SparkStatus] || '状态待核验';
const actorLabel = (actor?: SparkActor): string => {
  if (typeof actor === 'string') return text(actor);
  if (!actor || typeof actor !== 'object') return '待核验';
  const name = text(actor.name || actor.realName, ''), number = text(actor.number, '');
  if (actor.role === 'system' || number.startsWith('system:')) return name ? `系统导入（${name}）` : '系统导入';
  return name ? `${name}${number ? `（${number}）` : ''}` : number ? `工号 ${number}（姓名待核验）` : '待核验';
};
const collectionStatus = (value: unknown) => ({ succeeded: '读取成功', success: '读取成功', completed: '读取成功', ok: '读取成功', failed: '读取失败', error: '读取失败', partial: '部分读取', running: '正在读取', pending: '待确认', pending_confirmation: '待确认', unauthorized: '待授权', no_change: '读取成功 · 无新增', unchanged: '读取成功 · 无新增', skipped: '本次未读取' } as Record<string, string>)[text(value, '')] || '读取状态待核验';

class SparkRequestError extends Error {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json', 'x-spark-request': '1' } : {}), ...options.headers } }); }
  catch { throw new SparkRequestError('连接星火库失败，请检查网络后刷新。当前填写内容仍保留在此页。', 0); }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok === false) {
    const messages: Record<number, string> = {
      401: '登录状态已失效，请回到中枢重新登录后再打开星火库。',
      403: '当前账号无权访问部门星火库。首版仅向部门负责人和各中心主管开放。',
      404: '星火库服务尚未接入或该记录已不存在，请刷新核对。',
      409: '这条记录已有新版本。你的编辑仍保留，请对照服务器版本后合并，系统不会覆盖他人的修改。',
      413: '文件超过服务允许的大小，请拆分后重新导入。',
    };
    const detail = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
    throw new SparkRequestError(messages[response.status] || detail || `操作未完成（${response.status}），当前填写内容已保留，请核对后重试。`, response.status, body);
  }
  if (!body) throw new SparkRequestError('服务未返回可读取的数据，请刷新核对。', response.status);
  return body as T;
}
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function freshItem(): SparkItem {
  return { id: `SPARK-${crypto.randomUUID()}`, title: '', center: '', category: '', date: '', summary: '', status: 'draft', sourceIds: [], evidence: '', insight: '', action: '', validation: '', scoreDimensions: {}, scoreReasons: {}, statusEvidence: '', version: 0 };
}

function SourceLink({ source, children = '打开原始来源' }: { source: SparkSource; children?: ReactNode }) {
  const url = safeUrl(source.url);
  return url ? <a className="spark-source-link" href={url} target="_blank" rel="noopener noreferrer"><LinkRegular aria-hidden="true" />{children}</a> : <span className="spark-muted">来源链接待核验</span>;
}
function Drawer({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog className={`spark-drawer${wide ? ' spark-drawer-wide' : ''}`} ref={ref} onCancel={event => { event.preventDefault(); closeRef.current(); }} aria-labelledby="spark-drawer-title">
    <header><h2 id="spark-drawer-title">{title}</h2><button className="spark-icon-button" type="button" aria-label="关闭面板" onClick={onClose}><DismissRegular /></button></header>
    <div className="spark-drawer-body">{children}</div>
  </dialog>;
}

function SourceBlock({ source }: { source: SparkSource }) {
  return <article className="spark-source-block">
    <div className="spark-source-title"><h4>{sourceName(source)}</h4><SourceLink source={source} /></div>
    <p className="spark-meta">{text(source.type)} · {text(source.author)} · {text(source.date)}</p>
    <blockquote>{plainQuote(source.quote)}</blockquote>
    <p className="spark-meta">原文定位：{text(source.location || source.locator)}</p>
    {sourceLimit(source) && <p className="spark-limitation">证据边界：{sourceLimit(source)}</p>}
    {source.quote && source.quote !== plainQuote(source.quote) && <details><summary>查看采集原文格式</summary><pre className="spark-raw">{source.quote}</pre></details>}
  </article>;
}

function ItemDetail({ item, sources, onClose, onEdit, canEdit }: { item: SparkItem; sources: SparkSource[]; onClose: () => void; onEdit: () => void; canEdit: boolean }) {
  const linked = sources.filter(source => item.sourceIds.includes(source.id));
  const missingIds = item.sourceIds.filter(id => !sources.some(source => source.id === id));
  return <Drawer title={item.title} onClose={onClose}>
    <div className="spark-detail-meta"><span className={`spark-status spark-status-${item.status}`}>{statusLabel(item.status)}</span><span>{text(item.center)} · {text(item.category)}</span></div>
    <p className="spark-meta">原文日期 {dateLabel(item.date)} · 最后修改 {dateLabel(item.updatedAt, true)} · 修改人 {actorLabel(item.updatedBy)}</p>
    <section><h3>原文与来源</h3><p className="spark-prose">{text(item.evidence, '事实摘录待核验')}</p>{linked.map(source => <SourceBlock key={source.id} source={source} />)}
      {!linked.length && <p className="spark-limitation">尚未关联可读来源，请先补充来源再推进状态。</p>}
      {!!missingIds.length && <p className="spark-limitation">{missingIds.length} 个来源记录当前不可读，不能视为已核验。</p>}
    </section>
    <section><h3>AI 整合与建议</h3><p className="spark-meta">以下提炼用于讨论与验证，不能替代原作者的判断或承诺。</p>
      <h4>价值发现</h4><p className="spark-prose">{text(item.insight || item.summary)}</p>
      <h4>建议行动</h4><p className="spark-prose">{text(item.action)}</p>
    </section>
    <section><h3>价值判断与验证</h3><p className="spark-prose">{text(item.validation, '验证安排待补充')}</p>
      <p className="spark-score-explanation">优先级参考 {score(item) === null ? '待评分' : `${score(item)} / 100`}，不代表已实现收益。</p>
      <div className="spark-score-list">{DIMENSIONS.map(d => <div key={d.key}><strong>{d.label}<small>{d.weight}%</small></strong><span>{typeof item.scoreDimensions?.[d.key] === 'number' ? `${item.scoreDimensions[d.key]} / 5` : '待评分'}</span><p>{text(item.scoreReasons?.[d.key], '评分依据待补充')}</p></div>)}</div>
      <h4>当前状态佐证</h4><p className="spark-prose">{text(item.statusEvidence, '尚未登记，保持草稿')}</p>
    </section>
    <section><h3>状态记录</h3>{item.statusHistory?.length ? <ol className="spark-history">{item.statusHistory.map((history, index) => <li key={`${history.at}-${index}`}><strong>{history.from ? `${statusLabel(history.from)} → ` : ''}{statusLabel(history.to)}</strong><time>{dateLabel(history.at, true)}{history.by || history.actor ? ` · ${actorLabel(history.by || history.actor)}` : ''}</time><p>{text(history.note, '未填写说明')}</p></li>)}</ol> : <p className="spark-muted">暂无可读的状态记录。</p>}</section>
    {canEdit && <div className="spark-drawer-actions"><button className="spark-primary" type="button" onClick={onEdit}><EditRegular />编辑这条星火</button></div>}
  </Drawer>;
}

type EditorProps = { original: SparkItem | null; sources: SparkSource[]; centers: string[]; apiBase: string; onSaved: () => Promise<void>; onClose: () => void };
function ItemEditor({ original, sources, centers, apiBase, onSaved, onClose }: EditorProps) {
  const [draft, setDraft] = useState<SparkItem>(() => original ? structuredClone(original) : freshItem());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false), [confirmClose, setConfirmClose] = useState(false);
  const [sourceSearch, setSourceSearch] = useState(''), [serverItem, setServerItem] = useState<SparkItem | null>(null), [conflict, setConflict] = useState(false), [conflictAgreed, setConflictAgreed] = useState(false);
  const [savedPending, setSavedPending] = useState(false);
  const locked = useRef(false);
  const change = <K extends keyof SparkItem>(key: K, value: SparkItem[K]) => { setDraft(current => ({ ...current, [key]: value })); setDirty(true); };
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const requestClose = () => { if (!busy) dirty && !savedPending ? setConfirmClose(true) : onClose(); };
  const fetchLatest = async () => {
    setBusy(true);
    try { const latest = await request<SparkOverview>(apiBase); const current = latest.items.find(item => item.id === (original?.id || draft.id)); if (!current) throw Error('这条记录已不存在，请导出当前编辑，再关闭面板刷新列表。'); setServerItem(current); setConflictAgreed(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取最新版本失败，请重试。'); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (locked.current || savedPending) return;
    if (!draft.title.trim()) { setError('请填写星火标题。'); return; }
    const knownSources = draft.sourceIds.filter(id => sources.some(source => source.id === id && safeUrl(source.url) && source.quote?.trim()));
    if (draft.status !== 'draft' && (!knownSources.length || !draft.evidence?.trim())) { setError('推进状态前，请关联至少一个有原文和有效链接的来源，并填写事实摘录。'); return; }
    if (draft.status !== 'draft' && (draft.statusEvidence?.trim().length || 0) < 12) { setError('请填写至少 12 个字的状态佐证，说明审核、验证结果或回执。'); return; }
    if (conflict && (!serverItem || !conflictAgreed)) { setError('请先读取服务器版本，逐项核对后确认合并。当前内容不会被覆盖。'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const payload = { ...draft, title: draft.title.trim(), center: draft.center?.trim(), category: draft.category?.trim() };
      const existing = serverItem || original;
      await request(apiBase + (existing ? `/items/${encodeURIComponent(existing.id)}` : '/items'), {
        method: existing ? 'PATCH' : 'POST', headers: !existing ? { 'Idempotency-Key': draft.id } : {}, body: JSON.stringify(existing ? { expectedVersion: existing.version, item: payload } : { item: payload }),
      });
      setDirty(false); setSavedPending(true);
      try { await onSaved(); onClose(); } catch { setError('保存已成功，列表刷新失败。请点击“刷新已保存记录”，无需重复提交。'); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存未完成，当前编辑内容仍保留。');
      if (cause instanceof SparkRequestError && cause.status === 409) { setConflict(true); setConflictAgreed(false); setServerItem(null); }
    } finally { locked.current = false; setBusy(false); }
  };
  const visibleSources = sources.filter(source => `${sourceName(source)} ${source.author || ''} ${source.quote || ''} ${source.date || ''}`.toLocaleLowerCase().includes(sourceSearch.trim().toLocaleLowerCase()));
  const fields: Array<{ key: 'evidence' | 'insight' | 'action' | 'validation'; label: string; help: string }> = [
    { key: 'evidence', label: '原文事实摘录', help: '仅记录来源中已有的事实，缺失数据写待核验。' },
    { key: 'insight', label: '价值发现', help: '写清楚你的提炼与判断，区分原作者表述。' },
    { key: 'action', label: '建议行动', help: '写出下一步、涉及对象和实际交付。' },
    { key: 'validation', label: '验证安排与证据边界', help: '记录验证样本、通过条件和仍待确认的问题。' },
  ];
  return <Drawer title={original ? '编辑星火' : '记录一条新星火'} onClose={requestClose} wide>
    <p className="spark-meta">保存到部门星火库，负责人和各中心主管共同查看。未保存内容仅保留在当前页面。</p>
    <form onSubmit={event => void save(event)} className="spark-editor">
      <fieldset disabled={busy || savedPending}><legend className="spark-sr-only">星火内容</legend>
        <label>标题<input value={draft.title} onChange={event => change('title', event.target.value)} maxLength={200} required autoFocus /></label>
        <div className="spark-form-grid"><label>所属中心<input list="spark-center-options" value={draft.center || ''} onChange={event => change('center', event.target.value)} placeholder="未确认可留空" maxLength={80} /><datalist id="spark-center-options">{centers.map(center => <option key={center} value={center} />)}</datalist></label>
          <label>主题分类<input value={draft.category || ''} onChange={event => change('category', event.target.value)} placeholder="例如：素材内容、跨中心协作" maxLength={80} /></label>
          <label>原文日期<input type="date" value={/^\d{4}-\d{2}-\d{2}/.test(draft.date || '') ? draft.date!.slice(0, 10) : ''} onChange={event => change('date', event.target.value)} /><small>日期不确定时留空，不用入库日期代替。</small></label>
          <label>状态<select aria-label="状态" value={draft.status} onChange={event => change('status', event.target.value as SparkStatus)}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>发布、落地和验证失败均需来源与佐证。</small></label></div>
        <section><h3>关联真实来源 <span className="spark-muted">已选 {draft.sourceIds.length}</span></h3>
          <label className="spark-source-search"><span className="spark-sr-only">查找可关联来源</span><input value={sourceSearch} onChange={event => setSourceSearch(event.target.value)} placeholder="搜索群名、作者、日期或原文" /></label>
          <div className="spark-source-checks">{visibleSources.length ? visibleSources.map(source => <label key={source.id}><input type="checkbox" checked={draft.sourceIds.includes(source.id)} onChange={event => change('sourceIds', event.target.checked ? [...draft.sourceIds, source.id] : draft.sourceIds.filter(id => id !== source.id))} /><span><strong>{sourceName(source)}</strong><small>{text(source.author)} · {text(source.date)}</small><span className="spark-source-preview">{plainQuote(source.quote)}</span></span></label>) : <p className="spark-muted">没有匹配的来源。可先保存草稿，待采集或导入真实来源后补充。</p>}</div>
        </section>
        {fields.map(field => <label key={field.key}>{field.label}<textarea value={text(draft[field.key], '')} onChange={event => change(field.key, event.target.value)} rows={3} maxLength={12000} /><small>{field.help}</small></label>)}
        <section><h3>价值优先级评分</h3><p className="spark-meta">各项 0–5 分，未评价可留空。评分用于安排验证顺序，不代表已实现收益。</p>
          <div className="spark-score-edit">{DIMENSIONS.map(d => <div key={d.key}><label>{d.label} · {d.weight}%<input type="number" min="0" max="5" step="1" value={draft.scoreDimensions?.[d.key] ?? ''} onChange={event => { const dimensions = { ...draft.scoreDimensions }; if (event.target.value === '') delete dimensions[d.key]; else dimensions[d.key] = Number(event.target.value); change('scoreDimensions', dimensions); }} /></label><label><span className="spark-sr-only">{d.label}评分依据</span><input value={draft.scoreReasons?.[d.key] || ''} onChange={event => change('scoreReasons', { ...draft.scoreReasons, [d.key]: event.target.value })} placeholder="填写本项评分依据" maxLength={1200} /></label></div>)}</div>
          <p className="spark-score-explanation">综合参考：{score(draft) === null ? '待完成评分' : `${score(draft)} / 100`}</p>
        </section>
        <label>状态佐证<textarea value={draft.statusEvidence || ''} onChange={event => change('statusEvidence', event.target.value)} rows={3} maxLength={12000} /><small>记录审核结论、真实验证结果和回执链接。保留草稿时可暂不填写。</small></label>
      </fieldset>
      {conflict && <section className="spark-conflict"><h3>先核对新版本，再合并保存</h3><p>服务器已有其他修改，你的内容仍在上方表单中。读取最新版本不会替换你的编辑。</p>
        <button type="button" disabled={busy} onClick={() => void fetchLatest()}>读取服务器最新版本</button>
        {serverItem && <><details open><summary>服务器版本 {serverItem.version} · {dateLabel(serverItem.updatedAt, true)}</summary><dl>{(['title', 'center', 'category', 'date', 'evidence', 'insight', 'action', 'validation', 'statusEvidence'] as const).map((key, index) => <div key={key}><dt>{['标题', '所属中心', '分类', '原文日期', '事实摘录', '价值发现', '建议行动', '验证安排', '状态佐证'][index]}</dt><dd>{text(serverItem[key])}</dd></div>)}<div><dt>状态</dt><dd>{statusLabel(serverItem.status)}</dd></div><div><dt>来源</dt><dd>{serverItem.sourceIds.map(id => sourceName(sources.find(source => source.id === id) || { id })).join('；') || '待补充'}</dd></div><div><dt>评分</dt><dd>{DIMENSIONS.map(d => `${d.label} ${serverItem.scoreDimensions?.[d.key] ?? '待评分'}：${text(serverItem.scoreReasons?.[d.key])}`).join('\n')}</dd></div></dl></details>
          <label className="spark-check"><input type="checkbox" checked={conflictAgreed} onChange={event => setConflictAgreed(event.target.checked)} />我已对照最新版本，并在表单中合并需要保留的内容</label></>}
      </section>}
      {error && <p className="spark-error" role="alert">{error}</p>}
      {confirmClose && <div className="spark-close-confirm" role="alert"><p>当前有未保存的编辑。返回继续编辑，或导出草稿后关闭。</p><div className="spark-actions"><button type="button" onClick={() => setConfirmClose(false)}>继续编辑</button><button type="button" onClick={() => downloadJson({ item: draft }, `星火编辑草稿-${Date.now()}.json`)}>导出草稿</button><button type="button" onClick={onClose}>放弃未保存内容</button></div></div>}
      <div className="spark-drawer-actions"><button type="button" disabled={busy} onClick={requestClose}>取消</button><button type="button" disabled={busy} onClick={() => downloadJson({ item: draft }, `星火编辑草稿-${Date.now()}.json`)}>导出当前编辑</button>
        {savedPending ? <button type="button" className="spark-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onSaved(); onClose(); } catch { setError('记录已保存，刷新仍未完成，请稍后重试。'); } finally { setBusy(false); } }}>刷新已保存记录</button> : <button className="spark-primary" type="submit" disabled={busy || (conflict && (!serverItem || !conflictAgreed))}>{busy ? '正在保存…' : conflict ? '保存合并结果' : '保存到部门库'}</button>}
      </div>
    </form>
  </Drawer>;
}

function Coverage({ data, onClose }: { data: SparkOverview; onClose: () => void }) {
  const coverage = data.coverage || {};
  const schedule = asRecord(coverage.schedule || coverage.automation);
  const failures = Array.isArray(coverage.failures) ? coverage.failures : Array.isArray(coverage.errors) ? coverage.errors : [];
  const sourceStates = Array.isArray(coverage.sources) ? coverage.sources : [];
  const start = text(coverage.rangeStart || coverage.startDate || coverage.start, ''), end = text(coverage.rangeEnd || coverage.endDate || coverage.end, '');
  return <Drawer title="更新范围与采集记录" onClose={onClose}>
    <p className="spark-prose">{text(coverage.summary, '本页仅展示已经入库的真实来源；具体覆盖范围待采集记录确认。')}</p>
    <dl className="spark-coverage-facts"><div><dt>最近成功入库</dt><dd>{dateLabel(data.lastSuccessfulAt || undefined, true)}</dd></div><div><dt>当前入库</dt><dd>{data.items.length} 条星火 · {data.sources.length} 个来源记录</dd></div><div><dt>读取时间范围</dt><dd>{start || end ? `${start || '待核验'} 至 ${end || '待核验'}` : '待核验'}</dd></div><div><dt>每日更新</dt><dd>{schedule.enabled === true ? `已启用${schedule.time ? ` · ${text(schedule.time)}` : ''}${schedule.timezone ? `（${text(schedule.timezone)}）` : ''}` : '更新计划待接入或待核验'}</dd></div><div><dt>下次运行</dt><dd>{dateLabel(typeof schedule.nextRunAt === 'string' ? schedule.nextRunAt : undefined, true)}</dd></div></dl>
    <p className="spark-limitation">无法读取、撤回或未覆盖的内容不会当作零数据。每日采集形成的观点以草稿入库，已有人工编辑和验证结论需保留。</p>
    {Boolean(coverage.sourceLimit || coverage.limitations) && <p className="spark-limitation">覆盖边界：{Array.isArray(coverage.limitations) ? coverage.limitations.map(value => text(value)).join('；') : text(coverage.sourceLimit || coverage.limitations)}</p>}
    <section><h3>需要关注的来源</h3>{failures.length ? <ul className="spark-run-list">{failures.map((failure, index) => { const row = asRecord(failure); return <li key={index}><strong>{text(row.name || row.source || row.sourceId, '来源待核验')}</strong><p>{typeof failure === 'string' ? failure : text(row.error || row.reason || row.message, '失败原因待核验')}</p></li>; })}</ul> : <p className="spark-muted">{coverage.failures || coverage.errors ? '本次记录没有报告失败来源；不代表尚未接入的来源已读取。' : '失败来源统计待接入，暂不能判定采集完整。'}</p>}</section>
    {!!sourceStates.length && <section><h3>各来源读取状态</h3><ul className="spark-run-list">{sourceStates.map((value, index) => { const row = asRecord(value); return <li key={index}><strong>{text(row.name || row.source || row.id)}</strong><span>{collectionStatus(row.status)}</span><p>{text(row.error || row.summary || row.message, '')}</p>{Boolean(row.updatedAt) && <time>{text(row.updatedAt)}</time>}</li>; })}</ul></section>}
    <section><h3>最近更新记录</h3>{data.runs?.length ? <ul className="spark-run-list">{data.runs.slice(0, 10).map((run, index) => <li key={run.id || index}><strong>{({ succeeded: '更新完成', success: '更新完成', completed: '更新完成', no_change: '更新完成 · 无新增', unchanged: '更新完成 · 无新增', failed: '更新失败', partial: '部分来源未完成', running: '正在更新' } as Record<string, string>)[run.status || ''] || '更新状态待核验'}</strong><time>{dateLabel(run.finishedAt || run.startedAt || run.at, true)}</time><p>{text(run.summary || run.error, '详细记录待核验')}</p>{typeof run.added === 'number' && <span>新增 {run.added} 条</span>}</li>)}</ul> : <p className="spark-muted">尚无可读的更新运行记录。</p>}</section>
  </Drawer>;
}

function ImportPanel({ data, apiBase, onClose, onImported }: { data: SparkOverview; apiBase: string; onClose: () => void; onImported: () => Promise<void> }) {
  const [batch, setBatch] = useState<Record<string, unknown> | null>(null), [filename, setFilename] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const locked = useRef(false), batchId = useRef('');
  const readFile = async (file?: File) => {
    if (!file) return; setError(''); setReceipt(null); setBatch(null); setFilename(file.name); batchId.current = `spark-import-${crypto.randomUUID()}`;
    if (file.size > 10 * 1024 * 1024) { setError('文件超过 10MB，请拆分后导入。'); return; }
    try { const parsed: unknown = JSON.parse(await file.text()); const value = asRecord(parsed); if (!Array.isArray(value.items) || !Array.isArray(value.sources)) throw Error('文件需要包含 items 和 sources 数组，请使用星火库导出的 JSON 文件。'); if (value.items.length > 10000 || value.sources.length > 30000) throw Error('文件记录过多，请拆分后导入。'); if (!value.items.every(item => typeof item === 'object' && item && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.sourceIds))) throw Error('星火记录缺少 id、title 或 sourceIds，请修正后再导入。'); setBatch(value); }
    catch (cause) { setError(cause instanceof Error ? `文件未载入：${cause.message}` : '文件无法读取。当前部门库未被修改。'); }
  };
  const items = Array.isArray(batch?.items) ? batch.items as SparkItem[] : [];
  const duplicateCount = items.filter(item => data.items.some(existing => existing.id === item.id)).length;
  const submit = async () => {
    if (!batch || locked.current || receipt) return; locked.current = true; setBusy(true); setError('');
    try {
      const backup = await request<unknown>(`${apiBase}/export`); downloadJson(backup, `部门星火库-导入前备份-${Date.now()}.json`);
      const result = await request<Record<string, unknown>>(`${apiBase}/import`, { method: 'POST', headers: { 'Idempotency-Key': batchId.current }, body: JSON.stringify({ ...batch, batchId: batchId.current, expectedRevision: data.revision, conflictPolicy: 'keep-existing' }) });
      setReceipt(result); setBatch(null);
      try { await onImported(); } catch { setError('导入已成功，列表刷新暂未完成。请关闭此面板后刷新，无需重复导入。'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入未完成，请刷新核对。'); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Drawer title="导入星火记录" onClose={() => { if (!busy) onClose(); }}>
    <p className="spark-prose">导入前会下载当前部门库备份。遇到相同编号时保留服务器已有记录，已有修改通过编辑面板核对后合并。</p>
    <label className="spark-file-label">选择 JSON 文件<input type="file" accept="application/json,.json" disabled={busy} onChange={event => void readFile(event.target.files?.[0])} /></label>
    {batch && <section><h3>{filename}</h3><p>包含 {items.length} 条星火、{(batch.sources as unknown[]).length} 个来源。</p><p>{duplicateCount} 条与当前库编号重复，将保留服务器已有内容。</p><p className="spark-meta">来源与状态将在服务端再次校验，验证未通过时不会替换部门库。</p></section>}
    {receipt && <div className="spark-success" role="status"><strong>导入已完成</strong><p>{text(receipt.message || receipt.summary, '已收到服务器成功回执。最新记录以部门库刷新结果为准。')}</p><button type="button" onClick={() => downloadJson(receipt, `星火导入回执-${Date.now()}.json`)}>下载导入回执</button></div>}
    {error && <p className="spark-error" role="alert">{error}</p>}
    <div className="spark-drawer-actions"><button type="button" disabled={busy} onClick={onClose}>{receipt ? '完成' : '取消'}</button>{batch && !receipt && <button type="button" className="spark-primary" disabled={busy} onClick={() => void submit()}>{busy ? '备份并导入中…' : '备份并导入'}</button>}</div>
  </Drawer>;
}

export type SparkLibraryProps = { apiBase?: string; notify?: (message: string) => void };
export function SparkLibrary({ apiBase = './api/spark-library', notify }: SparkLibraryProps) {
  const [data, setData] = useState<SparkOverview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [errorStatus, setErrorStatus] = useState(0), [notice, setNotice] = useState(''), [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState(''), [center, setCenter] = useState(''), [sourceFilter, setSourceFilter] = useState(''), [status, setStatus] = useState(''), [sortBy, setSortBy] = useState('value'), [page, setPage] = useState(1), [showFilters, setShowFilters] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null), [editor, setEditor] = useState<{ item: SparkItem | null } | null>(null), [showCoverage, setShowCoverage] = useState(false), [showImport, setShowImport] = useState(false);
  const loadId = useRef(0), mounted = useRef(true);
  const load = useCallback(async () => {
    const id = ++loadId.current; setLoading(true);
    try {
      const response = await request<SparkOverview>(apiBase);
      if (!Array.isArray(response.items) || !Array.isArray(response.sources)) throw new SparkRequestError('星火库返回的数据结构不完整，请联系维护人核对。', 502);
      if (mounted.current && id === loadId.current) { setData(response); setError(''); setErrorStatus(0); }
    } catch (cause) {
      if (mounted.current && id === loadId.current) { setError(cause instanceof Error ? cause.message : '读取星火库失败，请稍后重试。'); setErrorStatus(cause instanceof SparkRequestError ? cause.status : 0); if (cause instanceof SparkRequestError && [401, 403].includes(cause.status)) { setData(null); setDetailId(null); setShowCoverage(false); setShowImport(false); } }
      throw cause;
    } finally { if (mounted.current && id === loadId.current) setLoading(false); }
  }, [apiBase]);
  useEffect(() => { mounted.current = true; void load().catch(() => {}); return () => { mounted.current = false; loadId.current++; }; }, [load]);
  useEffect(() => { setPage(1); }, [search, center, sourceFilter, status, sortBy]);
  const sources = data?.sources || [], items = data?.items || [];
  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources]);
  const centers = useMemo(() => [...new Set(items.map(item => item.center?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [items]);
  const sourceNames = useMemo(() => [...new Set(sources.map(sourceName))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [sources]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const list = items.filter(item => {
      if (center && (center === '__unknown' ? Boolean(item.center?.trim()) : item.center !== center)) return false;
      if (status && item.status !== status) return false;
      const linked = item.sourceIds.map(id => sourceMap.get(id)).filter((value): value is SparkSource => Boolean(value));
      if (sourceFilter && !linked.some(source => sourceName(source) === sourceFilter)) return false;
      return !query || [item.title, item.summary, item.center, item.category, item.evidence, item.insight, item.action, ...linked.map(source => `${sourceName(source)} ${source.author || ''} ${source.quote || ''}`)].join(' ').toLocaleLowerCase().includes(query);
    });
    return list.sort((a, b) => sortBy === 'oldest' ? (dateValue(a.date) || Number.MAX_SAFE_INTEGER) - (dateValue(b.date) || Number.MAX_SAFE_INTEGER) : sortBy === 'newest' ? dateValue(b.date) - dateValue(a.date) : sortBy === 'created' ? dateValue(b.createdAt) - dateValue(a.createdAt) : (score(b) ?? -1) - (score(a) ?? -1) || dateValue(b.date) - dateValue(a.date));
  }, [items, sourceMap, search, center, sourceFilter, status, sortBy]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, totalPages), currentItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedItem = detailId ? items.find(item => item.id === detailId) : null;
  const coverage = data?.coverage || {}, schedule = asRecord(coverage.schedule || coverage.automation);
  const failures = Array.isArray(coverage.failures) ? coverage.failures.length : Array.isArray(coverage.errors) ? coverage.errors.length : null;
  const canEdit = Boolean(data?.access?.canEdit) && ![401, 403].includes(errorStatus);
  const saved = async () => { await load(); const message = '已保存到部门星火库。'; setNotice(message); notify?.(message); };
  const exportData = async () => { if (exporting) return; setExporting(true); setNotice(''); try { const value = await request<unknown>(`${apiBase}/export`); downloadJson(value, `部门星火库-${new Date().toISOString().slice(0, 10)}.json`); setNotice('已下载服务器最新记录。'); } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败，请稍后重试。'); } finally { setExporting(false); } };
  const clear = () => { setSearch(''); setCenter(''); setSourceFilter(''); setStatus(''); setSortBy('value'); };
  const hasFilters = Boolean(search || center || sourceFilter || status);
  return <section className="spark-library" aria-labelledby="spark-library-heading">
    <header className="spark-heading"><div><h1 id="spark-library-heading">部门星火库</h1><p>从真实记录中发现价值，让想法进入验证。</p></div><div className="spark-actions"><button type="button" disabled={loading || Boolean(editor)} onClick={() => void load().catch(() => {})}><ArrowClockwiseRegular aria-hidden="true" />{loading ? '读取中' : '刷新'}</button>{data && <><button type="button" disabled={exporting} onClick={() => void exportData()}><ArrowDownloadRegular aria-hidden="true" />{exporting ? '导出中' : '导出'}</button>{canEdit && <><button type="button" onClick={() => setShowImport(true)}><ArrowUploadRegular aria-hidden="true" />导入</button><button className="spark-primary" type="button" onClick={() => setEditor({ item: null })}><AddRegular aria-hidden="true" />记录星火</button></>}</>}</div></header>
    {error && <div className="spark-error spark-load-error" role="alert"><p>{error}</p>{data && ![401, 403].includes(errorStatus) && <p>当前仍显示上次成功读取的记录，最新状态待核验。</p>}<button type="button" disabled={loading} onClick={() => void load().catch(() => {})}>重新读取</button></div>}
    {notice && <p className="spark-notice" role="status">{notice}</p>}
    {loading && !data && <div className="spark-empty" role="status"><span className="spark-loading-line" /><h2>正在读取部门星火库</h2><p>加载已入库观点、原始来源与更新记录。</p></div>}
    {!loading && !data && <div className="spark-empty"><h2>{errorStatus === 403 ? '当前账号尚未获得访问权限' : errorStatus === 401 ? '请重新登录中枢' : '暂时无法打开星火库'}</h2><p>{errorStatus === 403 ? '部门负责人和各中心主管可访问整个部门库。请由维护人核对当前账号的真实角色。' : '恢复连接后重新读取，系统不会用示例数据代替真实记录。'}</p></div>}
    {data && <>
      <div className="spark-overview"><div className="spark-counts"><strong>{items.length}<span> 条星火</span></strong><span>{sources.length} 个来源</span><span>{items.filter(item => item.status === 'draft').length} 条待审阅</span><span>{items.filter(item => item.status === 'implemented').length} 条已落地</span></div><button type="button" className="spark-text-button" onClick={() => setShowCoverage(true)}>更新范围与记录<ChevronRightRegular aria-hidden="true" /></button></div>
      <div className="spark-update-line"><span>最近成功入库 {dateLabel(data.lastSuccessfulAt || undefined, true)}</span><span>{schedule.enabled === true ? '每日更新已启用' : '更新计划待接入'}</span>{failures !== null && failures > 0 && <button type="button" onClick={() => setShowCoverage(true)}>{failures} 个来源未完成读取</button>}<span>负责人及主管可见 · {canEdit ? '协作编辑' : '只读'}</span></div>
      <div className="spark-toolbar"><label className="spark-search"><SearchRegular aria-hidden="true" /><span className="spark-sr-only">搜索星火、原文或作者</span><input type="search" placeholder="搜索星火、原文或作者" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="spark-filter-toggle" type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><FilterRegular aria-hidden="true" />筛选{hasFilters ? ' · 已启用' : ''}</button>
        <div className={`spark-filter-fields${showFilters ? ' is-open' : ''}`}><label><span className="spark-sr-only">所属中心</span><select aria-label="所属中心" value={center} onChange={event => setCenter(event.target.value)}><option value="">全部中心</option>{centers.map(name => <option key={name} value={name}>{name}</option>)}<option value="__unknown">中心待核验</option></select></label><label><span className="spark-sr-only">信息来源</span><select aria-label="信息来源" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="">全部来源</option>{sourceNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label><span className="spark-sr-only">星火状态</span><select aria-label="星火状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label className="spark-sort"><span className="spark-sr-only">排序方式</span><select aria-label="排序方式" value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="value">价值优先</option><option value="newest">原文由新到旧</option><option value="oldest">原文由旧到新</option><option value="created">最近入库</option></select></label>
      </div>
      <div className="spark-list-caption"><p>{hasFilters ? `找到 ${filtered.length} 条` : `同批 ${filtered.length} 条星火，按行对应三个阶段`}</p><span>{hasFilters && <button type="button" className="spark-text-button" onClick={clear}>清除筛选</button>}评分为优先级参考，效果需验证</span></div>
      {!!currentItems.length && <div className="spark-pipeline"><div className="spark-column-heads" aria-hidden="true"><div><span>原文保留</span><small>真实来源与上下文</small></div><div><span>AI 整合</span><small>价值发现与建议行动</small></div><div><span>价值与验证</span><small>优先级、证据与结果</small></div></div>
        {currentItems.map(item => { const linked = item.sourceIds.map(id => sourceMap.get(id)).filter((value): value is SparkSource => Boolean(value)); const firstSource = linked[0]; const valueScore = score(item); return <article className="spark-pipeline-row" key={item.id} aria-labelledby={`spark-title-${item.id}`}>
          <div className="spark-cell spark-original"><span className="spark-mobile-stage">原文保留</span><div className="spark-row-meta"><span>{text(item.center)} · {text(item.category)}</span><time>{dateLabel(item.date)}</time></div><h2 id={`spark-title-${item.id}`}><button type="button" onClick={() => setDetailId(item.id)}>{item.title}</button></h2><blockquote>{plainQuote(firstSource?.quote || item.evidence)}</blockquote><div className="spark-source-footer"><span>{firstSource ? `${sourceName(firstSource)} · ${text(firstSource.author)}` : '来源待核验'}</span><button type="button" className="spark-text-button" onClick={() => setDetailId(item.id)}>查看 {linked.length || ''}{linked.length ? ' 个' : ''}来源<ChevronRightRegular aria-hidden="true" /></button></div></div>
          <div className="spark-cell spark-insight"><span className="spark-mobile-stage">AI 整合</span><span className="spark-content-label">价值发现 · 待验证</span><p className="spark-insight-text">{text(item.insight || item.summary)}</p><span className="spark-content-label">建议行动</span><p className="spark-action-text">{text(item.action, '行动安排待补充')}</p></div>
          <div className="spark-cell spark-validation"><span className="spark-mobile-stage">价值与验证</span><div className="spark-value-heading"><strong className="spark-score">{valueScore === null ? '待评分' : <>{valueScore}<span>/100</span></>}</strong><span className={`spark-status spark-status-${item.status}`}>{statusLabel(item.status)}</span></div><p className="spark-validation-text">{text(item.validation, '验证安排待补充')}</p><div className="spark-card-actions"><button type="button" onClick={() => setDetailId(item.id)}>查看完整证据</button>{canEdit && <button className="spark-text-button" type="button" onClick={() => setEditor({ item })}><EditRegular aria-hidden="true" />编辑</button>}</div></div>
        </article>; })}
      </div>}
      {!currentItems.length && <div className="spark-empty"><h2>{items.length ? '没有符合筛选条件的星火' : '部门星火库等待真实记录入库'}</h2><p>{items.length ? '调整关键词、中心、来源或状态后再查看。' : '采集完成后，原文、提炼和验证安排会在这里逐行对应。'}</p>{hasFilters && <button type="button" onClick={clear}>清除筛选</button>}</div>}
      <nav className="spark-pagination" aria-label="星火库分页"><span>每页 {PAGE_SIZE} 条 · 共 {filtered.length} 条</span><div><button type="button" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeftRegular /></button><span>第 {currentPage} / {totalPages} 页</span><button type="button" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRightRegular /></button></div></nav>
    </>}
    {selectedItem && !editor && <ItemDetail item={selectedItem} sources={sources} onClose={() => setDetailId(null)} canEdit={canEdit} onEdit={() => { setEditor({ item: selectedItem }); setDetailId(null); }} />}
    {editor && <ItemEditor original={editor.item} sources={sources} centers={centers} apiBase={apiBase} onSaved={saved} onClose={() => setEditor(null)} />}
    {showCoverage && data && <Coverage data={data} onClose={() => setShowCoverage(false)} />}
    {showImport && data && canEdit && <ImportPanel data={data} apiBase={apiBase} onClose={() => setShowImport(false)} onImported={load} />}
  </section>;
}
export default SparkLibrary;
