import {useCallback, useEffect, useRef, useState} from 'react';
import type {HubSession} from './types';
import './daily-intelligence.css';

type Material = {coverUrl?:string|null;raw?:{cover_url?:string;thumbnail_url?:string};id:string;title:string;brand:string;platform?:string;platformLabel:string;netTransactionAmount?:number|null;accountName:string;spend:number;transactionAmount:number|null;overallTransactionAmount?:number|null;roi:number|null;uploadTime:string|null;publishTime:string|null;videoUrl:string|null;originalUrl:string|null;downloadUrl:string|null;duration:string|number|null;sourceBoards:string[]};
type Brand = {creatorName?:string|null;averagePrice?:string|number|null;raw?:{creator_name?:string;metrics?:{average_price?:{display?:string;value?:number}}};id:string;name:string;rank:number;previousRank:number|null;rankChange:number|null;isNewEntry?:boolean;salesAmount:string|number|null;salesCount:string|number|null;dataDate:string|null;classification:string;detailUrl:string|null;board?:string;boardLabel?:string;entityType?:string;entityName?:string;brandName?:string|null;snapshotHour?:number|null;collectedAt?:string|null};
type MarketBoard = {key:string;label:string;status:string;error?:string;dataDate?:string|null;snapshotHour?:number|null;collectedAt?:string|null;items:Brand[];records:unknown[]};
type Source<T> = {status:string;items:T[];error?:string;warnings?:string[];sourceUpdatedAt?:string;dataDate?:string;boards?:MarketBoard[];readyBoards?:number;cache?:{generated_at?:string;stale?:boolean;refreshing?:boolean;refresh_failed_at?:string}};
type Report = {id:string;test:boolean;state:string;window:{date:string;dataDate?:string;start:string;end:string};startedAt:string;finishedAt?:string;materials:Source<Material>;competitors:Source<Brand>;delivery?:{state:string;messageId?:string;error?:string}[]};
type Overview = {report:Report|null;history:{id:string;date:string;state:string;test:boolean}[];schedule:{enabled:boolean;time:string;timezone:string;nextRunAt:string};sendingEnabled:boolean;manualTestEnabled?:boolean;recipient?:{name:string;employeeNumber:string;type:string}|null};
const money=(n:number|null|undefined)=>n==null?'未提供':`¥${n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const isWechat=(v:Material)=>v.platform==='wechat_channel'||(!v.platform&&v.platformLabel==='视频号');
const stamp=(s:string|null|undefined)=>!s?'未提供':/Z$|[+-]\d\d:\d\d$/.test(s)?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):s;
const stateName=(s:string)=>({ready:'已采集',partial:'部分来源完成',failed:'本期采集失败',running:'采集中',unconfigured:'待接入',pending:'等待完整批次',incomparable:'历史对比待补齐',stale:'快照已过期'}[s]||s);
const link=(url:string|null,text:string)=>url?<a href={url} target="_blank" rel="noopener noreferrer">{text} ↗</a>:<span className="di-muted">链接未提供</span>;

function MaterialPreview({item}:{item:Material}) {
  const [failed,setFailed]=useState<string[]>([]);
  const cover=[item.raw?.cover_url,item.coverUrl,item.raw?.thumbnail_url].find((url):url is string=>!!url&&!failed.includes(url));
  const video=item.videoUrl||item.originalUrl;
  const preview=cover?<><img src={cover} alt={`${item.title} 视频封面`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(old=>[...old,cover])}/>{video&&<span className="di-play" aria-hidden="true">▶</span>}</>:<span className="di-cover-empty">暂无预览图</span>;
  return video?<a className="di-video-cover" href={video} target="_blank" rel="noopener noreferrer" aria-label={`查看视频：${item.title}`}>{preview}</a>:<span className="di-video-cover">{preview}</span>;
}

const chartRise=(item:Brand)=>item.isNewEntry?30-item.rank:item.rankChange??0;
const subject=(item:Brand)=>item.entityName||item.name;
const average=(item:Brand)=>item.averagePrice??item.raw?.metrics?.average_price?.display??item.raw?.metrics?.average_price?.value??'未提供';
function CompetitorChart({board}:{board:MarketBoard}) {
  const items=[...board.items].sort((a,b)=>a.rank-b.rank);
  const maximum=Math.max(30,Math.ceil(Math.max(0,...items.map(chartRise))/5)*5);
  const [active,setActive]=useState<string|null>(null);
  const selected=items.find(item=>item.id===active);
  const creators=board.key==='live_creators',today=board.key==='today_sales';
  return <section className="di-chart-section" aria-label={board.label}>
    <header className="di-chart-heading"><div><h3>{board.label}</h3><p>数据日 {board.dataDate||'待提供'}{board.snapshotHour!=null?` · ${String(board.snapshotHour).padStart(2,'0')}:00 截点`:''}</p></div><span>{board.status==='ready'?`${items.length} 条入选`:stateName(board.status)}</span></header>
    {board.status!=='ready'?<p className="di-empty">{board.error||'当前榜单尚无完整数据，请稍后刷新。'}</p>:!items.length?<p className="di-empty">本榜暂无上升至少 5 位或前 25 名新上榜的记录。</p>:<>
      <div className="di-chart-legend"><span><i/>原榜上升</span><span><i className="new"/>新上榜</span></div>
      <div className="di-rank-chart" role="group" aria-label={`${board.label}排名上升图`} onMouseLeave={()=>setActive(null)}>
        <div className="di-chart-axis"><span aria-hidden="true"/><div>{Array.from({length:7},(_,i)=><span key={i}>{Number((maximum*i/6).toFixed(1))}</span>)}</div></div>
        {items.map(item=><div className="di-chart-row" key={item.id}>
          <div className="di-chart-name"><b>{item.rank}</b>{item.detailUrl?<a href={item.detailUrl} target="_blank" rel="noopener noreferrer" title={subject(item)}>{subject(item)}</a>:<span title={subject(item)}>{subject(item)}</span>}</div>
          <div className="di-chart-track"><button className={`di-chart-bar${item.isNewEntry?' is-new':''}`} style={{width:`${chartRise(item)/maximum*100}%`}} onMouseEnter={()=>setActive(item.id)} onFocus={()=>setActive(item.id)} onBlur={()=>setActive(null)} onClick={()=>setActive(item.id)} aria-label={`${subject(item)}，第 ${item.rank} 名，上升 ${chartRise(item)} 位${item.isNewEntry?'，新上榜':''}`} aria-describedby={active===item.id?`chart-tip-${board.key}`:undefined}><span>+{chartRise(item)}</span></button></div>
        </div>)}
        <div className="di-chart-axis-title">排名上升数（位）</div>
        {selected&&<div className="di-chart-tooltip" style={{top:items.findIndex(item=>item.id===active)*38+52}} role="tooltip" id={`chart-tip-${board.key}`}><strong>{subject(selected)}</strong><span>第 {selected.rank} 名 · {selected.isNewEntry?'新上榜':`${selected.previousRank} → ${selected.rank}`} · 上升 {chartRise(selected)} 位</span>{today&&<span>达人：{selected.creatorName||selected.raw?.creator_name||'未提供'}</span>}<span>{creators?'直播':''}销售额：{selected.salesAmount??'未提供'}　{creators?'直播':''}销量：{selected.salesCount??'未提供'}</span>{creators&&<span>销售客单价：{average(selected)}</span>}</div>}
      </div>
      <details className="di-chart-details" open><summary>榜单详情 <span>{items.length} 条</span></summary><div className="di-table-wrap"><table><thead><tr><th>排名</th><th>品牌/达人</th>{today&&<th>达人</th>}<th>上升数</th><th>{creators?'直播':''}销售额</th><th>{creators?'直播':''}销量</th>{creators&&<th>销售客单价</th>}</tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.rank}</td><td>{item.detailUrl?link(item.detailUrl,subject(item)):subject(item)}</td>{today&&<td>{item.creatorName||item.raw?.creator_name||'未提供'}</td>}<td className="di-rise">+{chartRise(item)}{item.isNewEntry&&<small>新上榜</small>}</td><td>{item.salesAmount??'未提供'}</td><td>{item.salesCount??'未提供'}</td>{creators&&<td>{average(item)}</td>}</tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
function CompetitorBoards({source}:{source:Source<Brand>}) {
  const [selected,setSelected]=useState('hot_brands');
  const boards=source.boards||[];
  return <div className="di-competitors">
    {source.error&&<p className="di-alert">{source.error}</p>}
    <div className="di-board-filter" role="group" aria-label="筛选竞品榜单">{boards.map(b=><button key={b.key} aria-pressed={selected===b.key} onClick={()=>setSelected(b.key)}>{b.label}<b>{b.status==='ready'?b.items.length:'—'}</b></button>)}<button aria-pressed={selected==='all'} onClick={()=>setSelected('all')}>全部五榜</button></div>
    {boards.length?boards.filter(b=>selected==='all'||b.key===selected).map(board=><CompetitorChart key={board.key} board={board}/>):<p className="di-empty">当前尚无可展示的榜单数据。</p>}
  </div>;
}

export function DailyIntelligence({session}:{session:HubSession}) {
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState('');
  const [tab,setTab]=useState<'materials'|'competitors'>('materials');
  const requestRef=useRef<AbortController|null>(null);
  const visible=session.workspace.home==='department'||session.workspace.role==='maintainer'||session.permissions.manage_permissions;
  const load=useCallback(async()=>{
    requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;
    try {const r=await fetch('api/daily-intelligence',{signal:controller.signal});const d=await r.json();if(!r.ok)throw Error(d.detail||'采集记录读取失败');if(!controller.signal.aborted){setData(d);setError('');}}
    catch(e){if(!controller.signal.aborted)throw e;}
  },[]);
  useEffect(()=>{if(!visible)return;let mounted=true;const refresh=()=>load().catch(e=>{if(mounted)setError(e.message)});void refresh();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},60000);
    return()=>{mounted=false;clearInterval(timer);requestRef.current?.abort()};
  // Session changes re-check authorization. Data polling never triggers collection or sending.
  },[visible,session.user.number,load]);
  if(!visible)return null;
  const report=data?.report,source=report?.[tab];
  const exportReport=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`每日创意情报-${report.window.dataDate||report.window.date}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  return <section className="daily-intelligence" aria-labelledby="daily-intelligence-title">
    <header className="di-heading"><div><span className="di-eyebrow">DAILY CREATIVE INTELLIGENCE</span><h2 id="daily-intelligence-title">每日创意情报 <em>09:30</em></h2><p>高消耗素材与快速上升品牌，每天一次集中查看。</p></div>
      <div className="di-actions"><button onClick={()=>void load().catch(e=>setError(e.message))}>刷新展示</button>{report&&<button onClick={exportReport}>导出完整记录</button>}</div>
    </header>
    <div className="di-facts"><span><small>采集窗口 · 北京时间</small><strong>{report?`${report.window.start} → ${report.window.end}`:'昨日 00:00:00 → 23:59:59'}</strong></span><span><small>最近批次</small><strong>{report?`${report.test?'本地测试 · ':''}${stateName(report.state)}`:'尚无采集记录'}</strong></span><span><small>下次采集</small><strong>{data?.schedule.enabled?stamp(data.schedule.nextRunAt):'计划状态待核对'}</strong></span></div>
    {error&&<p className="di-alert" role="alert">{error}</p>}
    <div className="di-tabs" role="tablist" aria-label="每日情报类型"><button role="tab" aria-selected={tab==='materials'} onClick={()=>setTab('materials')}>凡岛素材 <b>{['ready','stale'].includes(report?.materials.status||'')?report?.materials.items.length:'—'}</b><small>消耗 ≥ ¥20,000</small></button><button role="tab" aria-selected={tab==='competitors'} onClick={()=>setTab('competitors')}>竞品品牌 <b>{['ready','partial'].includes(report?.competitors.status||'')?report?.competitors.items.length:'—'}</b><small>五榜 · 上升 ≥5 位或前25名新上榜</small></button></div>
    <div role="tabpanel" className="di-content">
      {source?.status==='stale'&&<p className="di-alert">来源快照已过期，以下为旧结果。快照生成：{stamp(source.cache?.generated_at)}；不是上游数据采集时间。</p>}
      {!report?<p className="di-empty">尚未采集。后台将在每天北京时间 09:30 生成一份报告。</p>:tab==='competitors'?<CompetitorBoards source={report.competitors}/>:!['ready','stale'].includes(source?.status||'')?<div className="di-empty"><strong>{stateName(source?.status||'pending')}</strong><p>{source?.error||'正在读取来源数据，请稍后刷新。'}</p><p>未完成采集不代表没有符合条件的数据。</p></div>:source?.items.length===0?<p className="di-empty">{source.status==='stale'?'旧快照':'本次成功返回的榜单'}中没有符合筛选条件的素材。</p>:<div className="di-table-wrap"><table className="di-material-table"><thead><tr><th>视频预览</th><th>素材 / 品牌</th><th>消耗</th><th>成交金额</th><th>ROI</th><th>发布时间</th><th>下载</th></tr></thead><tbody>{report.materials.items.map(v=><tr key={`${v.platformLabel}-${v.id}`}><td><MaterialPreview item={v}/></td><td><strong>{v.title}</strong><small>{v.brand} · {v.platformLabel} · {v.accountName||'账号未提供'}</small><details><summary>更多信息</summary><small>素材 ID：{v.id}<br/>时长：{v.duration??'未提供'}<br/>来源榜单：{v.sourceBoards.join('、')}</small></details></td><td className="di-amount">{money(v.spend)}</td><td>{money(isWechat(v)?v.netTransactionAmount:(v.overallTransactionAmount ?? v.transactionAmount))}<small>{isWechat(v)?'净成交':'整体成交'}</small></td><td>{v.roi==null?'未提供':v.roi.toFixed(2)}</td><td>{stamp(v.publishTime)}</td><td>{v.downloadUrl?<a href={'api/daily-intelligence/download?'+new URLSearchParams({report:report.id,id:v.id,platform:v.platform||''})} download>点击下载</a>:<span className="di-muted">链接未提供</span>}</td></tr>)}</tbody></table></div>}
    </div>

  </section>;
}
