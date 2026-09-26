import {createHash} from 'node:crypto';

const DAY = 86400000;
export const COLLECTION_VERSION = 'yesterday-five-boards-v82';
export const MARKET_BOARDS = Object.freeze({hot_brands:'热门品牌榜',brand_live:'品牌直播榜',today_sales:'今日带货榜',goods_sales:'抖音销量榜',live_creators:'带货达人榜'});
export function unavailableCompetitors(error) {
  return {status:'failed',items:[],error,warnings:[],boards:Object.entries(MARKET_BOARDS).map(([key,label])=>({key,label,status:'failed',items:[],records:[],error})),readyBoards:0,totalBoards:5};
}
export function reportWindow(now = Date.now()) {
  const date = new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10);
  let end = Date.parse(date + 'T09:30:00+08:00');
  if (end > Number(now)) end -= DAY;
  const local = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const dataDate=local(end-DAY).slice(0,10);
  return {date: local(end).slice(0, 10),dataDate, start: dataDate+' 00:00:00', end: dataDate+' 23:59:59', endMs: end, timezone: 'Asia/Shanghai',mode:'yesterday'};
}
export const nextRunAt = (now = Date.now()) => new Date(reportWindow(now).endMs + DAY).toISOString();
export function canReadIntelligence(session) {
  return Boolean(session?.user && (session.permissions?.manage_permissions ||
    session.workspace?.home === 'department' || session.workspace?.role === 'maintainer'));
}
export function safeUrl(value, base) {
  if (!value || typeof value !== 'string') return null;
  try { const u = new URL(value, base); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
export function numberOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
const amount = (row, keys) => keys.map(k => numberOrNull(row[k])).find(n => n !== null) ?? null;
export function overallTransactionAmount(item) {
  return numberOrNull(item.overallTransactionAmount) ?? numberOrNull(item.transactionAmount) ??
    amount(item.raw||item,['pay_order_gmv','overall_transaction_amount','total_transaction_amount','transaction_amount','pay_amount','total_pay_amount']);
}
export function materialTurnover(item) {
  const isWechat=item.platform==='wechat_channel'||(!item.platform&&item.platformLabel==='视频号');
  return isWechat
    ?{label:'净成交',amount:numberOrNull(item.netTransactionAmount)??numberOrNull(item.raw?.net_transaction_amount)}
    :{label:'整体成交',amount:overallTransactionAmount(item)};
}
function metricText(metric) {
  for(const v of [metric?.display,metric?.raw,metric?.value])if(typeof v==='string'||typeof v==='number')return v;
  return null;
}

export function materialReport(payload, window, base) {
  if (payload?.code !== 200 || !payload.data || typeof payload.data !== 'object') throw Error('素材接口返回格式无效');
  const data = payload.data, items = [], warnings = [
    '来源为六榜聚合接口，每榜最多 8 条；本报告仅筛选接口返回的榜单素材，不代表全部在投素材。',
    '每天 09:30 读取昨日自然日数据，素材按请求数据日筛选。',
    '发布时间与上传时间分开显示；成交金额缺失时不使用消耗 × ROI 反推。'
  ];
  const platforms = {douyin: ['top_spend_list', 'rising_list', 'sustained_list'], wechat_channel: ['top_spend_list', 'rising_list', 'net_gmv_list']};
  const seen = new Map(); let returned = 0, unknownSpend = 0;
  for (const [platform, lists] of Object.entries(platforms)) {
    for (const list of lists) {
      if (!Array.isArray(data[platform]?.[list])) throw Error(`素材接口缺少 ${platform}/${list}，不能按空榜处理`);
      for (const row of data[platform][list]) {
        returned++;
        if (!row || row.id === undefined || row.id === null) throw Error('素材接口缺少素材编号');
        const key = platform + ':' + row.id;
        // Rising's today_spend covers a different comparison period. Never use it as window spend.
        const spend = amount(row, ['spend']);
        if (spend === null) unknownSpend++;
        const candidate = {
          id: String(row.id), platform, platformLabel: platform === 'douyin' ? '抖音' : '视频号',
          title: String(row.title || '未提供标题'), brand: String(row.brand || '未提供品牌'),
          accountName: String(row.account_name || ''), spend,
          transactionAmount: amount(row, ['transaction_amount', 'pay_amount', 'total_pay_amount']),
          overallTransactionAmount: amount(row, ['pay_order_gmv','overall_transaction_amount','total_transaction_amount','transaction_amount','pay_amount','total_pay_amount']),
          netTransactionAmount: amount(row, ['net_transaction_amount']), roi: amount(row, ['roi']),
          publishTime: row.publish_time || null, uploadTime: row.upload_time || row.uploaded_at || null,
          videoUrl: safeUrl(row.stream_url, base), downloadUrl: safeUrl(row.download_url, base),
          originalUrl: safeUrl(row.original_url, base), coverUrl: safeUrl(row.thumbnail_url || row.cover_url, base),
          duration: row.duration ?? null, likeCount: numberOrNull(row.like_count),
          commentCount: numberOrNull(row.comment_count), shareCount: numberOrNull(row.share_count),
          metricSource: row.metric_source || null, sourceBoards: [list],
          raw: row,
        };
        const previous = seen.get(key);
        if (!previous) seen.set(key, candidate);
        else {
          previous.sourceBoards.push(list);
          if (previous.spend === null && spend !== null) Object.assign(previous, candidate, {sourceBoards: previous.sourceBoards});
          else if (spend !== null && previous.spend !== spend) warnings.push(`${candidate.title} 的多个榜单消耗不一致，保留消耗榜优先结果。`);
        }
      }
    }
  }
  for (const item of seen.values()) if (item.spend !== null && item.spend >= 20000) items.push(item);
  items.sort((a, b) => b.spend - a.spend || a.id.localeCompare(b.id));
  if (unknownSpend) warnings.push(`${unknownSpend} 条榜单记录未返回区间消耗，未按消耗条件入选。`);
  const cache=data.cache || null;
  if(cache?.stale===true)warnings.push('源榜单快照已过期（超过 10 分钟），当前展示旧快照，不作为本期新鲜采集。');
  if(cache?.refreshing===true)warnings.push('来源正在后台刷新，当前返回最近一次成功快照。');
  if(cache?.refresh_failed_at)warnings.push('来源最近一次刷新失败，失败时间：'+cache.refresh_failed_at);
  return {status: cache?.stale===true?'stale':'ready', items, returned, unique: seen.size, cache, warnings: [...new Set(warnings)],
    requestedWindow: window, sourceUpdatedAt: data.updated_at || data.snapshot_at || null,
    sourceRange: {start: data.start_time || null, end: data.end_time || null}};
}

export function competitorBoardsReport(payload,window,base) {
  if(payload?.code!==200 || !payload.data?.boards || typeof payload.data.boards!=='object')throw Error('竞品五榜接口返回格式无效');
  const requestedDate=payload.data.requested_date||null;
  const boards=Object.entries(MARKET_BOARDS).map(([key,label])=>{
    const b=payload.data.boards[key];
    const meta={key,label,status:'pending',items:[],records:Array.isArray(b?.records)?b.records:[],
      dataDate:b?.batch?.data_date||null,collectedAt:b?.batch?.collected_at||null,snapshotHour:b?.batch?.snapshot_hour??null,
      periodType:b?.batch?.period_type||null,batchId:b?.batch?.batch_id||null,coverage:b?.coverage||null,
      comparisonDate:b?.comparison?.date||null};
    if(!b)return {...meta,status:'failed',error:'接口未返回此榜单，不能按空榜处理'};
    if(b.status!=='ready')return {...meta,error:'此榜单尚无完整批次，等待来源采集'};
    if(!Array.isArray(b.records)||b.coverage?.complete!==true||!meta.dataDate)return {...meta,status:'failed',error:'榜单数据或覆盖信息不完整'};
    if(b.comparison?.status && b.comparison.status!=='comparable')return {...meta,status:'incomparable',error:'缺少同口径历史对比，暂不能判断排名上升'};
    // Keep every board's original records. Brand, product and creator ranks are
    // distinct entities: never invent a brand affiliation for a ranked creator.
    const validComparison=r=>{
      const previous=numberOrNull(r.comparison?.previous_rank),rank=numberOrNull(r.source_rank),change=numberOrNull(r.comparison?.rank_change);
      return previous!==null&&rank!==null&&change!==null&&previous>0&&rank>0&&previous-rank===change&&
        !['new','new_entry','unavailable','missing','not_comparable'].includes(r.comparison?.status);
    };
    if(b.records.length&&!b.comparison&&b.records.every(r=>!r.comparison))return {...meta,status:'incomparable',error:'来源记录未提供昨日排名与变化值，不能推算上升名次'};
    const newEntry=r=>['new','new_entry'].includes(r.comparison?.status)&&numberOrNull(r.comparison?.previous_rank)===null;
    const qualifiesNew=r=>newEntry(r)&&Number.isInteger(numberOrNull(r.source_rank))&&Number(r.source_rank)>=1&&Number(r.source_rank)<=25;
    const seen=new Set();
    const items=b.records.filter(r=>{
      if(!r.entity_id||!(qualifiesNew(r)||(validComparison(r)&&Number(r.comparison.rank_change)>=5))||['internal','fandow'].includes(r.classification))return false;
      const id=String(r.entity_id);if(seen.has(id))return false;seen.add(id);return true;
    }).map(r=>{
      const brandName=r.entity_type==='brand'?r.entity_name:typeof r.brand_name==='string'?r.brand_name:typeof r.brand==='string'?r.brand:null;
      return {id:String(r.entity_id),board:key,boardLabel:label,entityType:r.entity_type||'unknown',entityName:String(r.entity_name||'未提供名称'),brandName,
        name:String(brandName||r.entity_name||'未提供名称'),rank:Number(r.source_rank),previousRank:newEntry(r)?null:Number(r.comparison.previous_rank),rankChange:newEntry(r)?null:Number(r.comparison.rank_change),isNewEntry:newEntry(r),qualification:newEntry(r)?'new_top25':'rise_5',
        salesAmount:metricText(r.metrics?.sales_amount),salesCount:metricText(r.metrics?.sales_count),classification:r.classification||'pending',
        creatorName:typeof r.creator_name==='string'?r.creator_name:null,creatorId:r.creator_id||null,
        creatorUrl:safeUrl(r.creator_detail_url,base),averagePrice:metricText(r.metrics?.average_price),
        detailUrl:safeUrl(r.detail_url,base),dataDate:meta.dataDate,collectedAt:meta.collectedAt,snapshotHour:meta.snapshotHour,periodType:meta.periodType,raw:r};
    }).sort((a,b)=>b.rankChange-a.rankChange||a.rank-b.rank);
    return {...meta,status:'ready',items};
  });
  const readyBoards=boards.filter(b=>b.status==='ready').length;
  return {status:readyBoards===5?'ready':readyBoards?'partial':'pending',boards,readyBoards,totalBoards:5,
    items:boards.flatMap(b=>b.items),requestedDate,requestedWindow:window,
    warnings:['一次采集全部五榜；相同品牌在不同榜单分别保留，排名不可跨榜合并。',
      '各榜使用各自最新完整批次，实际数据日期可能不同；今日带货榜另外保留源站截点。',
      '排名上升至少 5 位，或明确标记新上榜且当前排名前 25；新上榜不虚构昨日名次与具体上升幅度。',
      '达人或商品条目仅使用来源明确给出的品牌关联；未提供品牌时保留原榜单主体，不猜测品牌。']};
}

// Adapter for the observed market-rankings response. Authentication is supplied
// independently, only after the operator provides a documented service credential.
export function competitorReport(payload, window, base) {
  const data = payload?.data;
  if (payload?.code !== 200 || !data || !Array.isArray(data.records)) throw Error('竞品接口返回格式无效');
  if (data.status !== 'ready' || data.coverage?.complete !== true || data.comparison?.status !== 'comparable') {
    throw Error('竞品榜单或同口径昨日比较尚未完整，不能当作无品牌上升');
  }
  // Some versions name the same positive comparable result "rising"/"improved".
  const eligible = data.records.filter(r => r.entity_type === 'brand' &&
    !['new', 'new_entry', 'unavailable', 'missing', 'not_comparable'].includes(r.comparison?.status) &&
    numberOrNull(r.comparison?.rank_change) >= 5 && numberOrNull(r.comparison?.previous_rank) !== null &&
    numberOrNull(r.source_rank) !== null && Number(r.comparison.previous_rank) - Number(r.source_rank) === Number(r.comparison.rank_change) &&
    !['internal', 'fandow'].includes(r.classification));
  return {status: 'ready', items: eligible.map(r => ({
    id: String(r.entity_id), name: String(r.entity_name), rank: Number(r.source_rank),
    previousRank: Number(r.comparison.previous_rank), rankChange: Number(r.comparison.rank_change),
    salesAmount: metricText(r.metrics?.sales_amount),
    salesCount: metricText(r.metrics?.sales_count),
    classification: r.classification, detailUrl: safeUrl(r.detail_url, base),
    dataDate: data.batch?.data_date || data.scope?.data_date || null,
    raw: r,
  })).sort((a, b) => b.rankChange - a.rankChange || a.rank - b.rank),
    sourceUpdatedAt: data.batch?.collected_at || null, dataDate: data.batch?.data_date || null,
    comparisonDate: data.comparison.date, periodType: data.batch?.period_type, batchId: data.batch?.batch_id,
    requestedWindow: window, warnings: ['竞品源榜单按自然日及源站排名比较；09:30 是采集时刻，不代表竞品销售额按 09:30 切分。',
      '新上榜但无昨日名次的品牌不计为上升 5 位；品牌归属待核验的记录保留明确标识。']};
}

const money = n => n === null || n === undefined ? '源接口未提供' : `¥${Number(n).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
export function reportContent(report) {
  const collectedAt=report.finishedAt?new Date(report.finishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未完成';
  const lines = [`【${report.test ? '本地测试 · ' : ''}WIS 每日创意情报】${report.window.dataDate||report.window.date}`,
    `采集区间：${report.window.start} 至 ${report.window.end}（北京时间）`,
    `实际采集：${collectedAt}；视频消耗 ≥ ¥20,000，竞品排名上升 ≥ 5 位。`,
    '素材为来源 TOP8 榜单范围；竞品保留源站自然日口径。缺失字段不视为 0。'];
  const blocks={intro:lines.join('\n'),materials:[],competitors:[]};
  for (const [key, label] of [['materials', '凡岛素材'], ['competitors', '竞品品牌']]) {
    const sections=blocks[key];
    const source = report[key];
    if(key==='competitors'&&source.boards) {
      sections.push(`竞品五榜：${source.readyBoards}/5 榜可用，${source.readyBoards?`已就绪榜单中 ${source.items.length} 条符合条件（上升 ≥5 位或前25名新上榜）`:'筛选数量尚无法确定'}`);
      for(const board of source.boards) {
        sections.push(`${board.label}｜${board.status==='ready'?`${board.items.length} 条符合条件`:board.error||'等待完整批次'}\n数据日：${board.dataDate||'未提供'}${board.snapshotHour!=null?'；源站截点：'+String(board.snapshotHour).padStart(2,'0')+':00':''}`);
        if(board.status!=='ready')continue;
        for(const b of board.items){
          const line=[`${b.entityName||b.raw?.entity_name||b.name}｜${b.isNewEntry?`新上榜 · 第 ${b.rank} 名`:`${b.previousRank} → ${b.rank}（上升 ${b.rankChange} 位）`}`];
          if(board.key==='today_sales')line.push(`达人：${b.creatorName||b.raw?.creator_name||'未提供'}`);
          line.push(board.key==='live_creators'
            ?`直播销售额：${b.salesAmount??'未提供'}；直播销量：${b.salesCount??'未提供'}；销售客单价：${b.averagePrice??metricText(b.raw?.metrics?.average_price)??'未提供'}`
            :`销售额：${b.salesAmount??'未提供'}；销量：${b.salesCount??'未提供'}`);
          line.push(`详情：${b.detailUrl||'未提供'}`);sections.push(line.join('\n'));
        }
      }
      continue;
    }
    sections.push(`${label}：${source.status === 'ready' ? `${source.items.length} 条符合条件` : source.status==='stale'?'来源快照已过期，旧结果未作为本期新数据推送':source.error || '待接入'}`);
    if (source.status !== 'ready') continue;
    if (key === 'materials') for (const v of source.items) sections.push([
      `${v.title}｜${v.brand}｜${v.platformLabel}`,
      `素材 ID：${v.id}`,
      `账号：${v.accountName || '未提供'}`,
      `消耗：${money(v.spend)}`,
      `${materialTurnover(v).label}：${money(materialTurnover(v).amount)}`,
      `ROI：${numberOrNull(v.roi)===null?'未提供':Number(v.roi).toFixed(2)}`,
      `发布时间：${v.publishTime || '源接口未提供'}`,
      `视频：${v.videoUrl || v.originalUrl || '源接口未提供'}`,
    ].join('\n'));
    else for (const [i, b] of source.items.entries()) sections.push([
      `${i+1}. ${b.name}｜${b.previousRank} → ${b.rank}（上升 ${b.rankChange} 位）`,
      `数据日：${b.dataDate || '未提供'}；销售额：${b.salesAmount ?? '未提供'}；销量：${b.salesCount ?? '未提供'}`,
      `详情：${b.detailUrl || '未提供'}`,
    ].join('\n'));
  }
  return blocks;
}
export function reportMessages(report) {
  const blocks=reportContent(report),sections=[blocks.intro,...blocks.materials,...blocks.competitors];
  const chunks = []; let current = '';
  for (let part of sections) {
    // Feishu text supports 150 KB; use small 14 KB pages and preserve each item.
    if (Buffer.byteLength(part) > 13000) part = part.slice(0, 3000) + '\n（过长内容请在中枢详情查看）';
    if (current && Buffer.byteLength(current + '\n\n' + part) > 14000) { chunks.push(current); current = ''; }
    current += (current ? '\n\n' : '') + part;
  }
  if (current) chunks.push(current);
  return chunks.map((text, i) => ({text: `${text}\n\n第 ${i+1}/${chunks.length} 条`,
    uuid: createHash('sha256').update(`${report.id}:${i}`).digest('hex').slice(0,32)}));
}

export function deliveryMessages(report,target) {
  return reportMessages(report).map(m=>({...m,uuid:createHash('sha256').update(`${m.uuid}:${target.type}:${target.id}`).digest('hex').slice(0,32)}));
}
