import { Button, Spinner } from '@fluentui/react-components';
import { AddRegular, ArrowClockwiseRegular } from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';
import { modules } from './data';
import { workflowApi } from './workflow-api';
import type { TaskDraft } from './workflow-api';
import type { HubSession, TaskAssistantResult, TaskCenterItem, TaskCenterOverview, TaskCenterSourceKind } from './types';
import './task-workflow.css';

// Operate-mode extension: preserve WIS controls; task, next action and evidence lead.
// Details expand in place. No separate module, decorative hero or role badge.
const sources: Record<TaskCenterSourceKind,string> = {text:'文字需求',video_link:'参考视频链接',video_file:'参考视频文件',creative_radar:'创意雷达',meeting_action:'会议行动项',business_anomaly:'经营异常',live_session:'直播场次'};
const states: Record<string,string> = {opportunity:'机会提醒',pending_claim:'待领取',in_progress:'进行中',pending_review:'待审核',approved:'审核通过',rework:'需调整',pushed:'已推送 · 待回流',completed:'已完成',cancelled:'已取消'};
const deliveryStates: Record<string,string> = {awaiting_adapter:'待关联平台任务',queued:'平台处理中',unknown:'结果待核验',succeeded:'平台已核验成功',failed:'平台处理失败'};
const eventLabels: Record<string,string> = {task_dispatched:'任务已下发',opportunity_created:'机会已记录',convert:'已转正式任务',claim:'任务已领取',assign:'负责人已调整',output:'已登记交付版本',status:'审核状态更新',incident:'已提交问题',resolve_incident:'问题已处理',delivery:'已登记目标关联',delivery_receipt:'平台回执更新',business_feedback:'经营数据回流',accept:'主管验收完成',asset_probe:'资产技术检查完成'};
const flowModules: Record<string,string> = {'00':'creative-hub','01':'ai-first-creation','02':'material-workbench','03':'cloud-manager','04':'live-room-management','05':'data-dashboard'};
const emptyDraft=():TaskDraft=>({workflow:'02',sourceKind:'text',title:'',description:'',acceptance:'',sourceUrl:'',sourceReference:'',assignees:[],dueAt:''});
const personId=(session:HubSession)=>session.user.number || session.user.userId || session.user.id || '';
const dateLabel=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'未设截止时间';
const readDraft=(key:string):TaskDraft=>{try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.at>Date.now()-86400000)return {...emptyDraft(),...saved.draft,video:undefined};}catch{/* unavailable */}return emptyDraft();};
const fileData=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('视频读取失败，请重新选择文件'));reader.onload=()=>resolve(String(reader.result).split(',',2)[1]||'');reader.readAsDataURL(file);});

function Assignees({people,value,onChange}:{people:Array<{number:string;name:string}>;value:string[];onChange:(value:string[])=>void}) {
  const primary=value[0]||'';
  return <div className="workflow-people">
    <label>主责人<select value={primary} onChange={e=>onChange(e.target.value?[e.target.value,...value.filter(n=>n!==primary && n!==e.target.value)]:[])}><option value="">暂不指定，等待领取</option>{people.map(p=><option key={p.number} value={p.number}>{p.name}</option>)}</select></label>
    {primary && <details><summary>协作人{value.length>1?` · ${value.length-1} 人`:''}</summary><div className="workflow-collaborators">{people.filter(p=>p.number!==primary).map(p=><label key={p.number}><input type="checkbox" checked={value.includes(p.number)} onChange={()=>onChange(value.includes(p.number)?value.filter(n=>n!==p.number):[...value,p.number])}/>{p.name}</label>)}</div></details>}
  </div>;
}

type PanelProps={session:HubSession;notify:(message:string)=>void};
export function TaskCenterPanel(props:PanelProps) {
  const {session}=props;
  const enabled=session.workspace.is_brand_department && session.workspace.center==='AI营销中心' && ['director','manager','specialist'].includes(session.workspace.role);
  return enabled && personId(session)?<TaskWorkspace key={JSON.stringify([personId(session),session.access.policy_state,session.workspace.role,session.workspace.center,session.workspace.dashboard_scope,session.access.allowed_modules])} {...props}/>:null;
}
function TaskWorkspace({session,notify}:PanelProps) {
  const [overview,setOverview]=useState<TaskCenterOverview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [creating,setCreating]=useState(false),[busy,setBusy]=useState(''),[filter,setFilter]=useState('active'),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const draftKey=`wis-task-draft:${personId(session)}`;
  const [draft,setDraft]=useState<TaskDraft>(()=>readDraft(draftKey)),[video,setVideo]=useState<File|null>(null);
  const locked=useRef(false),alive=useRef(true),loadSequence=useRef(0);
  const maintenance=overview?.capabilities?.writesEnabled===false;
  const readOnly=Boolean(maintenance || overview?.preview || session.access.policy_state==='development-preview');
  const canManage=Boolean(overview?.access.canManage && !readOnly);
  const load=async()=>{
    const sequence=++loadSequence.current;setLoading(true);
    try {const data=await api.taskCenter();if(alive.current && sequence===loadSequence.current){setOverview(data);setError('');}}
    catch(cause){if(alive.current && sequence===loadSequence.current)setError(cause instanceof Error?cause.message:'暂时无法读取任务，请稍后刷新');}
    finally{if(alive.current && sequence===loadSequence.current)setLoading(false);}
  };
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;loadSequence.current++;};},[]);
  useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify({at:Date.now(),draft:{...draft,video:undefined}}));}catch{/* draft still remains in current form */}},[draft,draftKey]);
  useEffect(()=>{setPage(1);},[search,filter]);
  const change=<K extends keyof TaskDraft>(key:K,value:TaskDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const transact=async(key:string,action:()=>Promise<unknown>,success:string)=>{
    if(locked.current || readOnly)return false;locked.current=true;setBusy(key);setError('');
    try{await action();await load();notify(success);return true;}
    catch(cause){setError(cause instanceof Error?cause.message:'操作未完成，填写内容已保留，请刷新核对');return false;}
    finally{locked.current=false;setBusy('');}
  };
  const create=async(event:FormEvent)=>{
    event.preventDefault();
    if(!canManage || locked.current)return;
    if(draft.sourceKind==='video_file' && (!video || video.size>30*1024*1024)){setError('请选择不超过 30MB 的参考视频，也可改用视频链接');return;}
    const ok=await transact('create',async()=>{
      const payload={...draft,dueAt:draft.dueAt?new Date(draft.dueAt).toISOString():''};
      if(draft.sourceKind==='video_file' && video)payload.video={filename:video.name,mimeType:video.type,dataBase64:await fileData(video)};
      return workflowApi.create(personId(session),payload);
    },draft.sourceKind==='creative_radar'?'机会已记录，等待主管确认。':'任务已下发。');
    if(ok){setDraft(emptyDraft());setVideo(null);setCreating(false);}
  };
  const command=(item:TaskCenterItem,action:string,body:Record<string,unknown>={},success='任务已更新。')=>transact(item.id,()=>workflowApi.command(personId(session),item,action,body),success);
  const all=overview?[...overview.tasks,...overview.opportunities]:[];
  const items=all.filter(t=>(filter==='opportunity'?t.kind==='opportunity':t.kind==='formal' && (filter==='history'?['completed','cancelled'].includes(t.status):!['completed','cancelled'].includes(t.status))) && `${t.title} ${t.assignees.map(p=>p.name).join(' ')} ${t.id}`.toLowerCase().includes(search.toLowerCase()));
  const pages=Math.max(1,Math.ceil(items.length/15)),currentPage=Math.min(page,pages);
  return <section className="task-center-panel workflow-panel" aria-labelledby="workflow-heading">
    <header className="task-center-heading"><div><h2 id="workflow-heading">工作任务</h2><p>领取、交付和审核，在这里接续。</p></div><div className="workflow-actions"><Button icon={<ArrowClockwiseRegular/>} disabled={loading || Boolean(busy)} onClick={()=>void load()}>{loading?'读取中':'刷新'}</Button>{canManage && <Button appearance="primary" icon={<AddRegular/>} onClick={()=>setCreating(!creating)}>{creating?'收起需求':'下发需求'}</Button>}</div></header>
    {error && <div className="workflow-error" role="alert"><p>{error}</p><Button size="small" disabled={loading || Boolean(busy)} onClick={()=>void load()}>刷新核对</Button></div>}
    {readOnly && <p className="workflow-notice">{maintenance?'任务服务正在维护，已有记录可以查看，暂不接受新操作。':'当前为权限预览，不读取管理员的团队任务，也不执行实际操作。'}</p>}
    {loading && !overview && <div className="workflow-loading"><Spinner size="small" label="正在读取任务和最新状态…"/></div>}
    {creating && canManage && <form className="task-center-composer workflow-composer" onSubmit={create}>
      <fieldset disabled={Boolean(busy)}><legend>新需求</legend>
        <div className="workflow-grid"><label>工作流<select value={draft.workflow} onChange={e=>change('workflow',e.target.value)}>{overview?.templates.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><label>需求来源<select value={draft.sourceKind} onChange={e=>change('sourceKind',e.target.value as TaskCenterSourceKind)}>{Object.entries(sources).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
        <label>需要完成什么<input required minLength={2} maxLength={100} value={draft.title} onChange={e=>change('title',e.target.value)} placeholder="写清需要交付的成果"/></label>
        {draft.sourceKind!=='text' && draft.sourceKind!=='video_file' && <label>原始来源链接<input type="url" required value={draft.sourceUrl} onChange={e=>change('sourceUrl',e.target.value)} placeholder="视频、会议记录、异常数据或场次资料链接"/></label>}
        {draft.sourceKind==='video_file' && <label>参考视频<input type="file" accept="video/mp4,video/quicktime,video/webm" required onChange={e=>setVideo(e.target.files?.[0]||null)}/><small>最多 30MB。文字会保留；重新打开页面后，视频文件需要重新选择。</small></label>}
        {draft.sourceKind==='creative_radar' && <p className="workflow-notice">先记为机会提醒，由主管确认后转为正式任务。</p>}
        <label>要求与参考<textarea value={draft.description} maxLength={2000} onChange={e=>change('description',e.target.value)} placeholder="说明产品、方向、数量和注意事项；尚未确认的内容请注明待补充"/></label>
        <label>验收要求<textarea value={draft.acceptance} maxLength={2000} onChange={e=>change('acceptance',e.target.value)} placeholder={overview?.templates.find(t=>t.id===draft.workflow)?.acceptance}/></label>
        <div className="workflow-grid"><Assignees people={overview?.assignees||[]} value={draft.assignees} onChange={v=>change('assignees',v)}/><label>截止时间<input type="datetime-local" value={draft.dueAt} onChange={e=>change('dueAt',e.target.value)}/></label></div>
        <details><summary>来源定位与查重</summary><label>原始记录编号<input value={draft.sourceReference} maxLength={200} onChange={e=>change('sourceReference',e.target.value)} placeholder="例如会议行动项、异常或场次的唯一编号"/></label><small>同一工作流内，相同原始记录只创建一次。</small></details>
        <Button type="submit" appearance="primary" disabled={Boolean(busy)}>{busy==='create'?'正在保存…':draft.sourceKind==='creative_radar'?'记录机会':'确认下发'}</Button>
      </fieldset>
    </form>}
    {overview && <div className="task-center-stream">
      <div className="workflow-toolbar"><div className="workflow-filters" role="group" aria-label="任务分类">{[['active','待处理'],['opportunity','机会提醒'],['history','已结束']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div><label className="workflow-search"><span className="workflow-sr-only">搜索任务或负责人</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索任务或负责人"/></label></div>
      <div className="task-center-items">{items.slice((currentPage-1)*15,currentPage*15).map(item=><TaskCard key={item.id} item={item} overview={overview} session={session} busy={Boolean(busy)} canManage={canManage} readOnly={readOnly} command={command} transact={transact}/>)}{!items.length && <p className="task-center-empty">{maintenance?'暂无可查看记录。':readOnly?'退出预览后可处理真实任务。':search?'没有匹配的任务，请调整搜索内容。':filter==='history'?'尚无已结束的任务。':filter==='opportunity'?'还没有机会提醒。':canManage?'还没有待处理任务，点击“下发需求”开始。':'暂无待处理任务。有新任务时会出现在这里。'}</p>}</div>
      <div className="workflow-pagination"><span>{items.length} 项</span>{pages>1 && <><Button size="small" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</Button><span>{currentPage} / {pages}</span><Button size="small" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一页</Button></>}</div>
      <p className="task-center-boundary">{overview.pilot.note}</p>
    </div>}
  </section>;
}

type CardProps={item:TaskCenterItem;overview:TaskCenterOverview;session:HubSession;busy:boolean;canManage:boolean;readOnly:boolean;command:(item:TaskCenterItem,action:string,body?:Record<string,unknown>,success?:string)=>Promise<boolean>;transact:(key:string,action:()=>Promise<unknown>,success:string)=>Promise<boolean>};
function TaskCard({item,overview,session,busy,canManage,readOnly,command,transact}:CardProps) {
  const [mode,setMode]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[people,setPeople]=useState(item.assignees.map(p=>p.number)),[assistant,setAssistant]=useState<TaskAssistantResult|null>(null);
  const field=(name:string,value:string)=>setFields(current=>({...current,[name]:value}));
  const own=item.assignees.some(p=>p.number===overview.access.personNumber),editable=(canManage||own)&&!readOnly,terminal=['completed','cancelled'].includes(item.status);
  const output=item.outputs.at(-1),review=item.reviews.at(-1),overdue=overview.alerts?.some(a=>a.taskId===item.id);
  const canReadCloud=session.access.allowed_modules.includes('cloud-manager');
  const app=modules.find(m=>m.id===flowModules[item.workflow] && session.access.allowed_modules.includes(m.id));
  const open=(value:string)=>{setMode(mode===value?'':value);setFields({});setPeople(item.assignees.map(p=>p.number));};
  const submit=async(e:FormEvent)=>{e.preventDefault();const body:Record<string,unknown>={...fields};if(mode==='assign' || mode==='convert')body.assignees=people;if(mode==='review'){body.status='rework';}
    if(mode==='delivery'){body.platform=fields.platform || 'qianchuan';}
    const ok=await command(item,mode==='review'?'status':mode,body,mode==='delivery'?'关联已登记，尚未向外部平台推送。':mode==='incident'?'问题已记录，维护人员可在任务中接续处理。':'任务已更新。');
    if(ok){setMode('');setFields({});}
  };
  const ask=(kind:'prepare'|'preflight')=>void transact(item.id,async()=>{setAssistant(await workflowApi.assistant(personId(session),item,kind));},'检查结果已返回，请核对后使用。');
  return <article className={`task-center-item workflow-item status-${item.status}`}>
    <div className="workflow-item-top"><div><div className="task-center-item-meta"><span>{overview.templates.find(t=>t.id===item.workflow)?.title || '工作任务'}</span><em>{states[item.status] || item.status}</em>{overdue && <span className="workflow-overdue">已到期</span>}</div><h3>{item.title}</h3><div className="task-center-item-facts"><span>{item.primaryOwner?`主责 ${item.primaryOwner.name}`:'等待领取'}</span>{item.collaborators.length>0 && <span>协作 {item.collaborators.map(p=>p.name).join('、')}</span>}<span>{dateLabel(item.dueAt)}</span></div></div>
      <div className="workflow-actions">
        {!readOnly && !canManage && item.status==='pending_claim' && <Button appearance="primary" disabled={busy} onClick={()=>void command(item,'claim')}>领取任务</Button>}
        {canManage && item.kind==='opportunity' && <Button appearance="primary" disabled={busy} onClick={()=>open('convert')}>转为任务</Button>}
        {editable && ['in_progress','rework'].includes(item.status) && <><Button disabled={busy} onClick={()=>open(item.lane==='content' && canReadCloud?'cloud_output':'output')}>登记交付</Button><Button appearance="primary" disabled={busy || !output || review?.decision==='rework' && review.outputId===output.id} onClick={()=>void command(item,'status',{status:'pending_review'})}>提交审核</Button></>}
        {canManage && item.status==='pending_review' && <><Button appearance="primary" disabled={busy} onClick={()=>void command(item,'status',{status:'approved'})}>通过当前版本</Button><Button disabled={busy} onClick={()=>open('review')}>退回修改</Button></>}
        {canManage && item.status==='approved' && item.lane==='action' && <Button appearance="primary" disabled={busy} onClick={()=>open('accept')}>验收完成</Button>}
        {canManage && item.status==='approved' && item.lane==='content' && <Button disabled={busy} onClick={()=>open('delivery')}>登记推送关联</Button>}
      </div>
    </div>
    {item.status==='rework' && review?.note && <p className="workflow-return">修改要求：{review.note}</p>}
    {output && <p className="workflow-latest">当前交付：<a href={output.cloudSnapshot?`api/task-center/tasks/${item.id}/outputs/${output.id}/content`:output.url} target="_blank" rel="noreferrer">{output.cloudSnapshot?`云管家素材 ${output.assetId}`:`${output.assetId} · ${output.assetVersion}`}</a>{output.productionJobId && <span> · 制作任务 {output.productionJobId}</span>}</p>}
    {item.legacyUnverified && <p className="workflow-notice">历史完成记录尚未核验平台回执，暂不计入自动闭环。</p>}
    {mode && <form className="workflow-inline-form" onSubmit={submit}><fieldset disabled={busy}><legend>{{output:'登记交付版本',cloud_output:'从云管家登记交付',reconcile:'核验平台回执',review:'退回修改',delivery:'关联推送目标',accept:'验收结论',assign:'调整主责与协作',convert:'确认正式任务',incident:'报告问题',resolve_incident:'记录恢复结果'}[mode]}</legend>
      {mode==='cloud_output' && <><p className="workflow-notice">读取现有资产并锁定版本，不重新上传文件。</p><label>云管家资产编号<input required inputMode="numeric" pattern="[0-9]+" value={fields.assetId||''} onChange={e=>field('assetId',e.target.value)}/></label><label>制作任务编号（可选）<input value={fields.productionJobId||''} maxLength={150} onChange={e=>field('productionJobId',e.target.value)}/></label><Button type="button" onClick={()=>open('output')}>改为登记文档或其他交付链接</Button></>}
      {mode==='reconcile' && <><p className="workflow-notice">自动查找该素材与目标对应的推送记录，并核对平台回执；不会新增推送或重试。存在多条记录时，由你指定。</p><details><summary>指定推送记录（可选）</summary><label>云管家推送任务编号<input maxLength={120} value={fields.cloudTaskId||''} onChange={e=>field('cloudTaskId',e.target.value)} placeholder="留空即可自动核对"/></label></details></>}
      {(mode==='assign'||mode==='convert') && <Assignees people={overview.assignees} value={people} onChange={setPeople}/>}
      {mode==='output' && <><label>交付链接<input type="url" required value={fields.url||''} onChange={e=>field('url',e.target.value)} placeholder="成片、脚本、复盘或执行记录链接"/></label><div className="workflow-grid"><label>资产或文档编号<input required maxLength={150} value={fields.assetId||''} onChange={e=>field('assetId',e.target.value)}/></label><label>版本<input required maxLength={100} value={fields.assetVersion||''} onChange={e=>field('assetVersion',e.target.value)} placeholder="例如 v2"/></label></div><label>制作任务编号（可选）<input maxLength={150} value={fields.productionJobId||''} onChange={e=>field('productionJobId',e.target.value)}/></label><label>交付说明<textarea maxLength={1000} value={fields.summary||''} onChange={e=>field('summary',e.target.value)}/></label></>}
      {mode==='delivery' && <><p className="workflow-notice">这里只登记已审核版本与目标的关联，不会执行真实推送。平台回执接入后才能核验成功。</p><label>平台<select value={fields.platform||'qianchuan'} onChange={e=>field('platform',e.target.value)}><option value="qianchuan">千川</option><option value="wechat_channels">视频号</option></select></label><div className="workflow-grid"><label>目标账号编号<input required maxLength={120} value={fields.accountId||''} onChange={e=>field('accountId',e.target.value)}/></label><label>计划编号<input required={(fields.platform||'qianchuan')==='qianchuan'} maxLength={120} value={fields.planId||''} onChange={e=>field('planId',e.target.value)}/></label></div></>}
      {['review','accept','incident','resolve_incident'].includes(mode) && <label>{mode==='review'?'需要修改什么':mode==='incident'?'遇到什么问题':'结果与核验说明'}<textarea required maxLength={500} value={fields.note||''} onChange={e=>field('note',e.target.value)}/></label>}
      <div className="workflow-actions"><Button appearance="primary" type="submit" disabled={busy}>{mode==='reconcile'?(busy?'正在核验…':'核验现有回执'):(busy?'正在保存…':'确认保存')}</Button><Button type="button" disabled={busy} onClick={()=>setMode('')}>收起</Button></div>
    </fieldset></form>}
    <details className="workflow-detail"><summary>要求、记录与结果</summary>
      <p>{item.description || '暂无补充说明'}</p><p><strong>验收要求：</strong>{item.acceptance}</p><p>{sources[item.sourceKind]}{item.sourceUrl && <> · <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></>}{item.attachment && <> · <a href={item.attachment.contentUrl} target="_blank" rel="noreferrer">{item.attachment.filename}</a></>}</p>
      {editable && !terminal && <div className="workflow-actions">{app && <a href={app.url} target="_blank" rel="noreferrer">打开{app.title}</a>}{canManage && <Button size="small" disabled={busy} onClick={()=>open('assign')}>调整负责人</Button>}<Button size="small" disabled={busy} onClick={()=>open('incident')}>遇到问题</Button>{overview.capabilities?.aiConfigured && <><Button size="small" disabled={busy} onClick={()=>ask('prepare')}>准备任务说明</Button><Button size="small" disabled={busy || !output} onClick={()=>ask('preflight')}>素材文字预检</Button></>}</div>}
      {item.deliveries.length>0 && <div className="workflow-receipts"><h4>推送记录</h4>{item.deliveries.map(d=><p key={d.id}><strong>{deliveryStates[d.state] || '待核验'}</strong> · {d.platform==='qianchuan'?'千川':'视频号'} · {d.accountId}{d.planId?` / ${d.planId}`:''}{d.receiptUrl && <> · <a href={d.receiptUrl} target="_blank" rel="noreferrer">平台回执</a></>}{editable && canReadCloud && <Button size="small" disabled={busy} onClick={()=>{setMode('reconcile');setFields({deliveryId:d.id});}}>核验回执</Button>}<small>关联编号 {d.id}</small></p>)}</div>}
      {item.feedback.length>0 && <div><h4>结果回流</h4>{item.feedback.map(f=><p key={f.id}>{f.businessDate} · {f.coverage==='complete'?'数据完整':f.coverage==='partial'?'部分回流':'待回补'} · <a href={f.sourceUrl} target="_blank" rel="noreferrer">数据来源</a>{Object.entries(f.metrics).map(([key,value])=><span key={key}> · {{netGsv:'有效 GSV',paidGmv:'支付 GMV',spend:'消耗',orders:'订单'}[key]||key} {value===null?'待回补':value.toLocaleString('zh-CN')}</span>)}</p>)}</div>}
      {overview.assistance.filter(i=>i.taskId===item.id).map(i=><p key={i.id}>问题处理：{i.status==='resolved'?'已处理':'待维护处理'} · {dateLabel(i.createdAt)}{overview.capabilities?.canMaintain && i.status==='open' && <Button size="small" disabled={busy} onClick={()=>{setMode('resolve_incident');setFields({incidentId:i.id});}}>记录恢复结果</Button>}</p>)}
      {assistant && <div className="workflow-assistant-result"><h4>辅助检查 · 需人工核对</h4><p>{assistant.stale?'任务已有更新，请以最新交付版本为准。':assistant.note}</p>{assistant.technical && <p>{assistant.technical.note}</p>}<p>{assistant.result?.brief || assistant.result?.summary}</p>{assistant.result?.checklist?.map((s,i)=><p key={i}>{s}</p>)}{assistant.result?.risks?.map((r,i)=><p key={i}>{r.location}：{r.reason}</p>)}{assistant.result?.missing.map((s,i)=><p key={i}>待补充：{s}</p>)}</div>}
      <ol className="workflow-timeline">{item.events.slice(-8).map((e,i)=><li key={i}><time>{dateLabel(e.at)}</time> {eventLabels[e.action] || '任务记录更新'}{e.note && ` · ${e.note}`}</li>)}</ol><small>任务编号 {item.id}</small>
    </details>
  </article>;
}
