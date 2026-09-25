import {useEffect, useRef, useState} from 'react';
import type {HubSession} from './types';
import './live-daily-work.css';
import {LiveCalendarAuthorization} from './LiveCalendarAuthorization';
import {linkedLiveTask} from './moduleLocation';

type Slot={key:string;signature:string;date:string;roomName:string;startAt:string;endAt:string;anchor:string;assistants:string[];anchorName?:string;assistantNames?:string[];cohostDisplay?:string;roomLead?:{number:string;name:string};sourceIssue?:string;cancelledTasks?:{id:string;version:number;title:string;sessionKey:string;taskUrl:string}[]};
type Item={taskId:string;version:number;title:string;state:string;taskUrl:string;session:Slot;waitingFor:string[];node:{id:string;title:string;state:string;liveStage:string;dueAt?:string;plannedDueAt:string;attempt:number}};
type Issue={roomCode?:string;roomName?:string;date?:string;message:string};
type Today={date:string;generatedAt:string;enabled:boolean;canManage:boolean;items:Item[];dispatch?:{checkedAt:string;state:string;issues:Issue[]};reconciliationTasks?:{id:string;version:number;title:string;state:string;issue:string;taskUrl:string}[]};
type Run={id:string;version:number;title:string;runtime:{state:string;liveSession?:Slot;nodes:Array<Item['node']&{owner:{number:string};dependencies:string[]}>}};
type Submission={path:string;body:Record<string,unknown>;key:string;label:string;item?:Item};
const when=(s:string)=>new Date(s).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const recordUrl=(taskId:string)=>{const url=new URL('workflow-panorama/',window.location.href);url.searchParams.set('task',taskId);url.searchParams.set('view','record');return url.pathname+url.search;};
async function request(path:string, options:RequestInit={}){
  const response=await fetch('api/flows/'+path,{cache:'no-store',signal:AbortSignal.timeout(20000),...options});
  const result=await response.json().catch(()=>({error:'响应格式异常，请读回原任务确认结果。'}));
  if(!response.ok)throw Object.assign(new Error(result.detail||result.error||result.message||'请求未完成'),{status:response.status});
  return result;
}
export function LiveDailyWork({session,compact=false}:{session:HubSession;compact?:boolean}){
  const enabled=session.access.allowed_modules.includes('workflow-engine')&&session.access.allowed_modules.includes('live-room-management')&&!session.access.policy_state?.startsWith('development-preview');
  const linkedTask=linkedLiveTask(window.location.hash);
  const scope=JSON.stringify([session.user.number,session.workspace.role,session.workspace.center,session.access.allowed_modules,session.access.policy_state,linkedTask]);
  if(!enabled)return null;
  return <LiveWork key={scope} compact={compact} calendarAdmin={!!(session.permissions?.super_admin||session.permissions?.manage_permissions)} ownerNumber={session.user.number||''} linkedTask={linkedTask}/>;
}
function LiveWork({compact,calendarAdmin,ownerNumber,linkedTask}:{compact:boolean;calendarAdmin:boolean;ownerNumber:string;linkedTask:string|null}){
  const [data,setData]=useState<Today|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [chosen,setChosen]=useState<Item|null>(null),[date,setDate]=useState(''),[slots,setSlots]=useState<Slot[]>([]),[uncertain,setUncertain]=useState<Submission|null>(null);
  const [sourceIssues,setSourceIssues]=useState<Issue[]>([]);
  const [expanded,setExpanded]=useState(false),initialRead=useRef(true);
  const alive=useRef(true),epoch=useRef(0),linkedReadEpoch=useRef(0),locked=useRef(false);
  async function refresh(preserveError=false){const version=++epoch.current;try{const next=await request('live/today');if(alive.current&&version===epoch.current){setData(next);if(initialRead.current){initialRead.current=false;setExpanded(!!linkedTask||next.items.some((i:Item)=>i.state==='running'&&i.node.state==='ready'&&!i.session.sourceIssue));}if(!preserveError)setError('');setDate(v=>v||next.date);}}catch(e){if(alive.current&&version===epoch.current){setData(null);if(!linkedTask)setChosen(null);setError(e instanceof Error?e.message:'读取失败');}}}
  useEffect(()=>{alive.current=true;void refresh();const id=window.setInterval(()=>{if(!document.hidden&&!locked.current)void refresh(true);},30000);return()=>{alive.current=false;epoch.current++;window.clearInterval(id);};},[]);
  async function readLinkedTask(taskId:string,active:()=>boolean=()=>alive.current){
    const read=++linkedReadEpoch.current;
    setChosen(null);
    const task:Run=await request('runs/'+taskId);
    if(!active()||read!==linkedReadEpoch.current)return;
    setError('');
    if(!task.runtime?.liveSession){setError('原任务不是正式直播场次，请返回流程引擎核对。');return;}
    if(task.runtime.state!=='running'||task.runtime.liveSession.sourceIssue){setMessage('原任务已暂停、结束或班表来源待核验；当前不能办理，请查看原任务记录。');return;}
    const node=task.runtime.nodes.find(n=>n.owner.number===ownerNumber&&n.state==='ready');
    if(!node){setMessage('已读取原任务，但当前没有轮到本人办理的节点；不会代替他人或重复完成。');return;}
    setChosen({taskId:task.id,version:task.version,title:task.title,state:task.runtime.state,taskUrl:recordUrl(task.id),session:task.runtime.liveSession,node,waitingFor:[]});
    setMessage('已读取此场次当前待本人办理的节点；请核对真实交付后再提交。');
  }
  useEffect(()=>{if(!linkedTask)return;let active=true;setExpanded(true);void readLinkedTask(linkedTask,()=>active).catch(e=>{if(active)setError(e instanceof Error?e.message:'原任务读取失败');});return()=>{active=false;};},[linkedTask,ownerNumber]);
  async function submit(s:Submission){
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setMessage('');
    try{await request(s.path,{method:'POST',headers:{'content-type':'application/json','x-flow-request':'1','idempotency-key':s.key},body:JSON.stringify(s.body)});if(!alive.current)return;setUncertain(null);setChosen(null);setSlots([]);setMessage(s.label+'已保存。下一节点通知进入发送队列，实际送达以任务中的飞书回执为准。');await refresh();}
    catch(e){if(!alive.current)return;const status=(e as {status?:number}).status;if(!status||status>=500){setUncertain(s);setError('提交结果尚不确定。请先读回原任务；继续同一次提交会沿用原编号，避免重复办理。');}else{setUncertain(null);setError(e instanceof Error?e.message:'未完成');if(status===409&&linkedTask&&s.item?.taskId===linkedTask){try{await readLinkedTask(linkedTask);}catch(readError){setError(readError instanceof Error?readError.message:'原任务重新读取失败');}}}await refresh(true);}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  async function readBack(){if(!uncertain)return;setBusy(true);try{if(uncertain.item){const t=await request('runs/'+uncertain.item.taskId),n=t.runtime?.nodes.find((x:{id:string})=>x.id===uncertain.item?.node.id);if(n?.attempt===uncertain.item.node.attempt&&n.state==='completed'){setUncertain(null);setChosen(null);setMessage('已读回：原节点已完成，没有再次提交。');}else setMessage('原节点尚未读到完成状态，可继续同一次提交。');}else setMessage('请沿用原提交编号核验派工结果，系统会返回原场次任务。');await refresh();}catch(e){setError(e instanceof Error?e.message:'读回失败');}finally{setBusy(false);}}
  async function preview(){if(locked.current)return;setBusy(true);setSlots([]);setSourceIssues([]);setError('');try{const r=await request('live/schedule?date='+encodeURIComponent(date));setSlots(r.sessions);setSourceIssues(r.issues||[]);}catch(e){setError(e instanceof Error?e.message:'班表尚不可读取');}finally{setBusy(false);}}
  const content=<>
    <header><div><h2>直播今日工作</h2><p>备播与排班 → 话术与素材准备 → 上播准备 → 直播执行 → 复盘与行动</p></div><button type="button" disabled={busy} onClick={()=>void refresh()}>刷新我的工作</button>{linkedTask&&<button type="button" disabled={busy||!!uncertain} onClick={()=>{void readLinkedTask(linkedTask).catch(e=>setError(e instanceof Error?e.message:'原任务重新读取失败'));}}>重新读取原任务</button>}</header>
    {error&&<p role="alert" className="live-work-alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {calendarAdmin&&<LiveCalendarAuthorization/>}
    {data?.dispatch&&data.canManage&&<details><summary>自动派工检查 · {when(data.dispatch.checkedAt)} · {data.dispatch.state==='ready'?'来源核验通过':'有待处理项'}</summary><ul>{data.dispatch.issues.map((x,i)=><li key={i}>{x.date} {x.roomName||x.roomCode}：{x.message}</li>)}</ul></details>}
    {data?.canManage&&!!data.reconciliationTasks?.length&&<details open><summary>待核验的班表变更（主管处理）</summary><p>若原表已恢复为原人员与时间，可重新核验。若确实换人或改时间，请在原任务记录原因并终止，再在班表预览中明确选择替代任务；原交付记录不会删除或冒充新任务完成。</p>{data.reconciliationTasks.map(t=><form key={t.id+':'+t.version} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void submit({path:'live/restore-source',key:crypto.randomUUID(),body:{taskId:t.id,expectedVersion:t.version,note:f.get('note')},label:'班表重新核验'});}}><p><strong>{t.title}</strong>：{t.issue} <a href={recordUrl(t.id)}>查看及处理原任务</a></p><label>核验说明<input name="note" required minLength={4} maxLength={500}/></label> <button disabled={busy||!!uncertain}>核验原班表并解除阻断</button></form>)}</details>}
    {uncertain&&<div className="live-work-alert"><button disabled={busy} onClick={()=>void readBack()}>读回原任务</button> <button disabled={busy} onClick={()=>void submit(uncertain)}>继续同一次提交</button><p>未确认结果前，请勿关闭本页或另建同一任务。</p></div>}
    {!data&&!error&&<p role="status">正在读取本人真实待办…</p>}
    {data&&<><p className="live-work-meta">{data.date} · 最近读取 {when(data.generatedAt)}{!data.enabled?' · 新场次派工待启用；未启用不代表当天无工作。':''}</p>
      {data.items.length===0?<p>当前尚无已派发给你的直播工作。请以正式班表为准，不能据此认定今天无需上班。</p>:<ul>{data.items.map(item=><li key={item.taskId+item.node.id}><div><strong>{item.node.liveStage} · {item.node.title}</strong><p>{item.title}{item.session.cohostDisplay?` · 共播 ${item.session.cohostDisplay}（仅展示）`:''} · 截止 {when(item.node.dueAt||item.node.plannedDueAt)}</p><small>{item.session.sourceIssue|| (item.state==='paused'?'任务已暂停':item.node.state==='ready'?'轮到我办理':'等待：'+item.waitingFor.join('、'))}</small></div><div><a href={recordUrl(item.taskId)}>查看原任务</a><button disabled={busy||!!uncertain||!!item.session.sourceIssue||item.state!=='running'||item.node.state!=='ready'} onClick={()=>setChosen(item)}>办理</button></div></li>)}</ul>}
      {data.canManage&&<details><summary>按正式班表预览场次与负责人</summary><p>仅实时完整班表可派工。恢复备份、身份未映射或助理空档会阻止派工。</p><label>业务日期 <input type="date" value={date} onChange={e=>{setDate(e.target.value);setSlots([]);}}/></label> <button disabled={busy||!!uncertain} onClick={()=>void preview()}>读取正式班表</button>
        {sourceIssues.length>0&&<ul className="live-work-alert">{sourceIssues.map((x,i)=><li key={i}>{x.roomName||x.roomCode}：{x.message}</li>)}</ul>}
        {slots.map(slot=><DispatchSlot key={slot.key+slot.signature} slot={slot} disabled={!data.enabled||busy||!!uncertain} submit={body=>void submit({path:'live/sessions',key:crypto.randomUUID(),body,label:'班次工作'})}/>)}
      </details>}
    </>}
    {chosen&&<CompletionForm key={chosen.taskId+chosen.node.id+chosen.version} item={chosen} disabled={busy||!!uncertain} close={()=>setChosen(null)} submit={(body)=>void submit({path:'runs/'+chosen.taskId+'/complete',key:crypto.randomUUID(),body,label:'节点完成结果',item:chosen})}/>}
  </>;
  const ready=data?.items.filter(i=>i.state==='running'&&i.node.state==='ready'&&!i.session.sourceIssue).length;
  return compact?<details className="live-daily-work live-daily-compact" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>直播今日工作与节点办理 <span aria-live="polite">{data?`· 待我办理 ${ready} 项 · 等待及暂停 ${data.items.length-(ready||0)} 项`:error?'· 读取失败，请核验':'· 正在读取'}</span></summary>{content}</details>:<section className="live-daily-work" aria-label="直播今日工作">{content}</section>;
}
function DispatchSlot({slot,disabled,submit}:{slot:Slot;disabled:boolean;submit:(body:Record<string,unknown>)=>void}){
  const [replacement,setReplacement]=useState('');
  return <article><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),previous=slot.cancelledTasks?.find(t=>t.id===replacement);if(!window.confirm(`${previous?'保留已终止的原任务，并重新派发':'创建'} ${slot.roomName} ${when(slot.startAt)} 的工作，先通知 ${slot.roomLead?.name||'待核验'}，执行节点再通知主播与助理，确认？`))return;submit({date:slot.date,sessionKey:slot.key,signature:slot.signature,...(previous?{replacesTaskId:previous.id,expectedVersion:previous.version,note:f.get('note')}:{})});}}><strong>{slot.roomName} · {when(slot.startAt)} — {when(slot.endAt)}</strong><p>主负责人 {slot.roomLead?.name||'待核验'}；主播 {slot.anchorName||slot.anchor}{slot.cohostDisplay?`（共播：${slot.cohostDisplay}，不自动派工）`:''}；助理 {(slot.assistantNames||slot.assistants).join('、')}</p>
    {!!slot.cancelledTasks?.length&&<><label>是否替代本直播间已终止的任务<select disabled={disabled} value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">不替代原任务</option>{slot.cancelledTasks.map(t=><option key={t.id} value={t.id}>{t.title} · {t.id.slice(-8)}</option>)}</select></label>{replacement&&<><a href={slot.cancelledTasks.find(t=>t.id===replacement)?.taskUrl}>核对已终止的原任务</a><label>重新派工原因<input name="note" required minLength={4} maxLength={500}/></label></>}</>}
    <button disabled={disabled}>{replacement?'保留原记录并重新派工':'确认此场次并派工'}</button></form></article>;
}
function CompletionForm({item,disabled,close,submit}:{item:Item;disabled:boolean;close:()=>void;submit:(b:Record<string,unknown>)=>void}){
  const readiness=item.node.id==='W04.S3.E2',execution=item.node.id.startsWith('W04.S4.'),action=item.node.id==='W04.S5.E2';
  const [noAction,setNoAction]=useState(false);
  return <form className="live-work-form" aria-label={'办理'+item.node.title} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const facts:Record<string,unknown>={confirmed:f.has('confirmed')};if(readiness)for(const k of ['people','equipment','goods','risks'])facts[k]=f.has(k);if(execution){facts.actualStart=new Date(String(f.get('actualStart'))+'+08:00').toISOString();facts.actualEnd=new Date(String(f.get('actualEnd'))+'+08:00').toISOString();facts.platformSessionId=f.get('platformSessionId');}if(action){facts.noAction=noAction;facts.noActionReason=f.get('noActionReason');facts.actionTaskIds=noAction?[]:String(f.get('actionTaskIds')||'').split(/[\s,，]+/).filter(Boolean);}submit({expectedVersion:item.version,nodeId:item.node.id,note:f.get('note'),evidence:[{url:f.get('evidence'),version:f.get('evidenceVersion')}],liveFacts:facts});}}>
    <h3>{item.node.title}</h3><fieldset disabled={disabled}>
      <label>真实交付链接<input name="evidence" type="url" required placeholder="https://…"/></label><label>交付版本 / 日期<input name="evidenceVersion" required maxLength={100}/></label>
      <label>完成结论<textarea name="note" required maxLength={1500}/></label>
      {readiness&&<div>{[['people','主播与助理到位'],['equipment','设备与网络检查'],['goods','商品与机制核对'],['risks','风险与合规检查']].map(([key,label])=><label key={key}><input type="checkbox" name={key} required/>{label}</label>)}</div>}
      {execution&&<><label>实际开始时间（北京时间）<input type="datetime-local" name="actualStart" required/></label><label>实际结束时间（北京时间）<input type="datetime-local" name="actualEnd" required/></label><label>平台真实场次编号<input name="platformSessionId" required maxLength={100}/></label></>}
      {action&&<><label><input type="checkbox" checked={noAction} onChange={e=>setNoAction(e.target.checked)}/>经复盘无需新增行动</label>{noAction?<label>无需行动的原因<textarea name="noActionReason" required minLength={4}/></label>:<label>已建立的改进行动任务编号（空格分隔）<input name="actionTaskIds" required placeholder="task_…"/><small>任务必须包含同中心负责人、期限及验收标准。</small></label>}</>}
      <label><input type="checkbox" name="confirmed" required/>我已核对本环节的真实工作及证据；提交后交接下一节点。</label>
      <button type="submit">确认完成并交接</button> <button type="button" onClick={close}>取消</button>
    </fieldset>
  </form>;
}
