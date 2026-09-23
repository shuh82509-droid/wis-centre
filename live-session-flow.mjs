import {requireFact} from './workflow-store.mjs';
import {fingerprint, safeUrl, text} from './task-workflow.mjs';
import {flowAllowed} from './flow-catalog.mjs';
import {runVisible} from './flow-runtime.mjs';

export const liveStages=['备播与排班','话术与素材准备','上播准备','直播执行','复盘与行动'];
export const roomLeads=Object.freeze({guanqi:{number:'FD-024035',name:'曾泳淇'},brand_selection:{number:'FD-023807',name:'梁瑜涵'},youxuan:{number:'FD-028493',name:'李爽'},wangou:{number:'FD-026339',name:'鲍敏纳'}});
// Exact roster abbreviations confirmed by the commissioning owner on 2026-09-23.
// This does not grant access or accept fuzzy / partial-name matches.
const confirmedRosterNames=Object.freeze({
  '梦怡':'曾梦怡','佩娜':'黄佩娜',
  // These four job-label aliases were individually confirmed by the owner.
  // Do not strip arbitrary suffixes or apply this to unverified backup sources.
  '李凯彤(金牌导购)':'李凯彤','李凯彤（金牌导购）':'李凯彤',
  '李彩红(金牌导购)':'李彩红','李彩红（金牌导购）':'李彩红',
  '谷子晴(金牌导购)':'谷子晴','谷子晴（金牌导购）':'谷子晴',
  '邓淑环(金牌导购)':'邓淑环','邓淑环（金牌导购）':'邓淑环',
});
const stageFor=id=>id.startsWith('W04.S2.')?0:id==='W04.S3.E1'?1:id==='W04.S3.E2'?2:id.startsWith('W04.S4.')?3:4;
const dateAt=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
function validDate(date){return /^20\d{2}-\d{2}-\d{2}$/.test(date)&&dateAt(Date.parse(date+'T00:00:00+08:00'))===date;}
function timeline(rows,date){
  let previous=-1,offset=0;
  const base=Date.parse(date+'T00:00:00+08:00');
  return (rows||[]).map(row=>{
    requireFact(Array.isArray(row)&&row.length>=3,'班次格式不完整',409);
    const minute=value=>{requireFact(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value)),'班次时间无法核验',409);const [h,m]=value.split(':').map(Number);return h*60+m;};
    const start=minute(row[0]),end=minute(row[1]);if(start<previous)offset+=1440;previous=start;
    const from=start+offset,to=end+offset+(end<start?1440:0);
    requireFact(to>from&&to-from<=1440&&to<=2880,'班次顺序或跨日时间无法核验',409);
    return {startAt:new Date(base+from*60000).toISOString(),endAt:new Date(base+to*60000).toISOString(),name:text(row[2],80)};
  });
}
// This adapter consumes the existing dispatch response, never browser-submitted
// people or a last-good snapshot masquerading as a current schedule.
export function scheduleSessions(raw,date,people,now=Date.now(),participants=null){
  requireFact(validDate(date)&&raw?.date===date,'班表业务日期不一致',409);
  const age=now-Date.parse(raw.updatedAt);
  requireFact(Number.isFinite(age)&&age>=-60000&&age<=15*60000,'班表读取时间过期，需刷新真实来源后派工',409);
  const direct=raw.source?.mode==='official_live'&&raw.source?.verified===true&&raw.source?.spreadsheetToken==='EuYqssm4WhNwAvtyybKcDdk1ned';
  requireFact(!raw.recovery&&!raw.source?.mode?.includes('backup')&&(direct||raw.writebackCapability?.enabled===true),'当前班表仍为只读恢复来源，不能据此自动派工',409);
  const resolve=name=>{
    const fullName=direct?confirmedRosterNames[name]||name:name;
    const matches=people.filter(p=>p.active&&p.name===fullName&&(!direct||p.center==='直播中心')&&((p.workflowEnabled!==false&&p.modules?.includes('live-room-management')&&p.modules?.includes('workflow-engine'))||(direct&&participants?.verified(p.number))));
    requireFact(matches.length===1,`${name||'未命名人员'} 尚无唯一有效的直播或飞书参与人身份`,409);return matches[0].number;
  };
  const sessions=[];
  for(const room of raw.rooms||[]){
    const src=raw.sourceStatus?.[room.code];
    requireFact(src?.found===true&&Number(src.revision)>0&&src.sheetId,'部分房间未取得完整来源，暂不派工',409);
    const anchors=timeline(room.anchors,date),assistants=timeline(room.assistants,date);
    for(const shift of anchors){
      const start=Date.parse(shift.startAt),end=Date.parse(shift.endAt);
      const overlaps=assistants.filter(s=>Date.parse(s.startAt)<end&&Date.parse(s.endAt)>start).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
      let covered=start;for(const s of overlaps){requireFact(Date.parse(s.startAt)<=covered,'主播班次存在助理空档，请先确认排班',409);covered=Math.max(covered,Date.parse(s.endAt));}
      requireFact(covered>=end,'主播班次没有完整助理覆盖，请先确认排班',409);
      const slot={date,roomCode:room.code,roomName:room.name,startAt:shift.startAt,endAt:shift.endAt,anchor:resolve(shift.name),assistants:[...new Set(overlaps.map(s=>resolve(s.name)))],source:{revision:src.revision,sheetId:src.sheetId,readAt:raw.updatedAt}};
      slot.key='live:'+fingerprint([slot.roomCode,slot.date,slot.startAt,slot.endAt]).slice(0,40);
      // Unrelated edits increment the workbook revision too. Bind consent to
      // this slot's actual people/times/sheet; retain revision as audit evidence.
      slot.signature=fingerprint({...slot,source:{sheetId:src.sheetId}});
      sessions.push(slot);
    }
  }
  requireFact(sessions.length>0,'指定日期尚无可核验班次',409);return sessions;
}

export function validateLiveCompletion(task,node,body,store,now){
  if(!task.runtime.liveSession)return;
  requireFact(node,'执行节点不存在',404);
  requireFact(!task.runtime.liveSession.sourceIssue,'场次来源已变化或无法核验，请先由主管处理',409);
  const facts=body.liveFacts;
  requireFact(facts&&facts.confirmed===true,'请从直播今日工作确认本节点完成条件');
  if(node.id==='W04.S3.E2')requireFact(['people','equipment','goods','risks'].every(k=>facts[k]===true),'开播检查缺项，不允许自动放行');
  if(node.id.startsWith('W04.S4.')){
    const start=Date.parse(facts.actualStart),end=Date.parse(facts.actualEnd),slot=task.runtime.liveSession;
    requireFact(Number.isFinite(start)&&end>start&&end<=now&&start>=Date.parse(slot.startAt)-12*3600000&&end<=Date.parse(slot.endAt)+12*3600000&&text(facts.platformSessionId,100),'需填写本场真实开始、结束时间及平台场次编号，不能用计划时间代替');
  }
  if(node.id==='W04.S5.E2'){
    const ids=Array.isArray(facts.actionTaskIds)?[...new Set(facts.actionTaskIds)]:[];
    requireFact(facts.noAction===true?ids.length===0&&text(facts.noActionReason).length>=4:ids.length>0,'请关联改进行动任务，或明确记录无需行动的原因');
    for(const id of ids){const action=store.tasks.find(t=>t.id===id);requireFact(action&&action.id!==task.id&&action.center===task.center&&action.assignee?.number&&Number.isFinite(Date.parse(action.dueAt))&&text(action.acceptance)&&action.status!=='cancelled','改进行动须为同中心已有任务，包含负责人、期限和验收标准',409);}
  }
}

export class LiveSessionFlow {
  constructor(runtime,{readSchedule,clock=Date.now,leads=roomLeads,enabled=false}){this.runtime=runtime;this.readSchedule=readSchedule;this.clock=clock;this.leads=leads;this.enabled=enabled;}
  check(a,manage=false){requireFact(a.enabled&&!a.configurationOnly&&flowAllowed(a,'04')&&(!manage||a.canManage),'没有当前直播工作流操作权限',403);}
  async preview(a,req,date){
    this.check(a,true);requireFact(validDate(date),'日期格式无效');requireFact(this.readSchedule,'正式班表读取尚未配置',503);
    const people=this.runtime.people(),raw=await this.readSchedule(req,date),issues=[...(raw.issues||[])],sessions=[];
    for(const room of raw.rooms||[]){try{sessions.push(...scheduleSessions({...raw,rooms:[room]},date,people,this.clock(),this.runtime.liveParticipants));}catch(e){issues.push({roomCode:room.code,roomName:room.name,message:e.message});}}
    const cancelled=this.runtime.store.read().tasks.filter(t=>t.runtime?.liveSession?.date===date&&t.runtime.state==='cancelled'&&!t.runtime.liveSession.replacedBy&&runVisible(t,a));
    return {date,stages:liveStages,issues,sessions:sessions.map(s=>({...s,anchorName:people.find(p=>p.number===s.anchor)?.name,assistantNames:s.assistants.map(number=>people.find(p=>p.number===number)?.name),roomLead:this.leads[s.roomCode],cancelledTasks:cancelled.filter(t=>t.runtime.liveSession.roomCode===s.roomCode).map(t=>({id:t.id,version:t.version,title:t.title,sessionKey:t.runtime.liveSession.key,taskUrl:this.runtime.taskUrl(t.id)}))}))};
  }
  async create(a,req,b,key){
    this.check(a,true);requireFact(this.enabled,'直播场次派工尚未启用，先完成来源与真实收件验收',409);requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复提交编号');
    const r=this.runtime,dedupeKey=a.user.number+':live:'+key,hash=fingerprint(b),old=r.store.read().flowDedupe?.[dedupeKey];
    if(old){requireFact(old.hash===hash,'重复提交内容不一致',409);const previous=r.get(a,old.taskId);requireFact(previous.runtime.state!=='cancelled','原任务已终止；如需重新派工，请明确选择被替代的原任务并记录原因',409);return previous;}
    const slot=(await this.preview(a,req,b.date)).sessions.find(s=>s.key===b.sessionKey);
    requireFact(slot&&slot.signature===b.signature,'班表已变化，请重新预览本班次',409);
    requireFact(Date.parse(slot.endAt)>this.clock(),'已结束的计划班次不能补发开播任务',409);
    if(b.replacesTaskId){
      const previous=r.get(a,b.replacesTaskId);
      requireFact(a.department||previous.center===a.user.center,'没有原任务管理权限',403);
      requireFact(previous.runtime?.liveSession&&previous.runtime.state==='cancelled'&&!previous.runtime.liveSession.replacedBy,'只能替代已终止且尚未重新派工的直播任务',409);
      requireFact(previous.version===b.expectedVersion,'原任务已变化，请重新读取班表和任务',409);
      requireFact(previous.runtime.liveSession.date===slot.date&&previous.runtime.liveSession.roomCode===slot.roomCode,'替代任务必须属于同一日期和直播间',409);
      requireFact(text(b.note).length>=4,'请记录终止后重新派工的原因');
    }
    const confirmedLead=this.leads[slot.roomCode];requireFact(confirmedLead,'本直播间主负责人尚未确认',409);
    const lead=r.person(confirmedLead.number,a);requireFact(lead.name===confirmedLead.name,'直播间主负责人身份发生变化，请核验工号',409);
    const manager=r.person(a.user.number,a),bindings={
      'W04.S2.E1':lead.number,'W04.S2.E2':manager.number,'W04.S3.E1':lead.number,
      'W04.S3.E2':lead.number,'W04.S4.E1':slot.anchor,'W04.S5.E1':manager.number,'W04.S5.E2':manager.number};
    requireFact(Object.values(bindings).every(Boolean),'请确认排班、素材、放行和复盘负责人');
    const prepared=r.create(a,{workflow:'04',options:{anchorMode:'existing'},owner:slot.anchor,manager:manager.number,bindings,title:`${slot.roomName} ${slot.date} ${new Date(slot.startAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false})} 直播工作`,sourceKey:slot.key,sourceUrl:r.taskUrl(''),acceptance:'五环节真实办理、资料可追溯、复盘行动有结论',slaHours:24},'prepare-'+key,{prepareOnly:true,definition:{moduleOrder:[]},liveExecution:true});
    // A live session follows this explicit role plan, not another published
    // flow's task_owner defaults or unrelated automatic cross-module routing.
    for(const n of prepared.runtime.nodes){
      // Room responsibility is a per-task delegation, not an account role grant.
      // Existing standard workflows keep their original manager-only rules.
      if(n.managerRequired){n.managerRequired=false;n.delegatedBy=a.user.number;bindings[n.id]=lead.number;}
      n.owner=r.person(bindings[n.id],a);r.validateOwner(n,n.owner.number,prepared.runtime.nodes);requireFact(r.canNotify(n.owner.number),'负责人飞书身份尚未绑定',409);n.liveStage=liveStages[stageFor(n.id)];
    }
    const anchorNode=prepared.runtime.nodes.find(n=>n.id==='W04.S4.E1'),assistantNodes=slot.assistants.filter(number=>number!==slot.anchor).map((number,i)=>{
      const owner=r.person(number,a);r.validateOwner(anchorNode,number,prepared.runtime.nodes);requireFact(r.canNotify(number),'助理飞书身份尚未绑定',409);
      return {...structuredClone(anchorNode),id:`W04.S4.A${i+1}`,title:'助理执行与下播确认',owner};
    });
    prepared.runtime.nodes.splice(prepared.runtime.nodes.indexOf(anchorNode)+1,0,...assistantNodes);
    prepared.runtime.nodes.find(n=>n.id==='W04.S5.E1').dependencies.push(...assistantNodes.map(n=>n.id));
    prepared.runtime.blueprint=null;prepared.runtime.liveSession={...slot,stages:liveStages};
    prepared.runtime.participants=[...new Set([a.user.number,manager.number,...prepared.runtime.nodes.map(n=>n.owner.number)])];
    for(const n of prepared.runtime.nodes)n.plannedDueAt=stageFor(n.id)<=2?slot.startAt:stageFor(n.id)===3?slot.endAt:new Date(Date.parse(slot.endAt)+24*3600000).toISOString();
    const task=r.store.transaction(s=>{
      r.ensure(s);const prior=s.flowDedupe[dedupeKey];if(prior){requireFact(prior.hash===hash,'重复提交内容不一致',409);return s.tasks.find(t=>t.id===prior.taskId);}
      const existing=s.tasks.find(t=>t.runtime?.liveSession?.key===slot.key&&!t.runtime.liveSession.replacedBy);
      if(b.replacesTaskId){
        const previous=s.tasks.find(t=>t.id===b.replacesTaskId&&runVisible(t,a));
        requireFact(previous&&previous.version===b.expectedVersion&&previous.runtime.state==='cancelled'&&!previous.runtime.liveSession.replacedBy,'原任务已变化，请重新读取后办理',409);
        requireFact(!existing||existing.id===previous.id,'目标班次已有其他任务，不能重复或覆盖',409);
        previous.runtime.liveSession.replacedBy=prepared.id;previous.version++;
        prepared.runtime.liveSession.replacesTaskId=previous.id;
        r.log(s,previous,null,'live_session_replaced',a.user,`重新派工至 ${prepared.id}：${text(b.note)}`);
        r.log(s,prepared,null,'live_session_replacement',a.user,`保留已终止原任务 ${previous.id}：${text(b.note)}`);
      }else{
      requireFact(!existing||existing.runtime.state!=='cancelled','原任务已终止；请明确选择被替代的原任务并记录原因，不能自动重发',409);
      requireFact(!existing||existing.runtime.liveSession.signature===slot.signature,'此班次已有任务且来源变化，请在原任务处理，不能重复派工',409);
      if(existing){s.flowDedupe[dedupeKey]={hash,taskId:existing.id};return existing;}
      }
      s.tasks.push(prepared);const created=r.log(s,prepared,null,'live_session_created',a.user,'来源版本 '+slot.source.revision);r.route(s,prepared);
      for(const n of prepared.runtime.nodes.filter(n=>r.liveParticipants?.canOwn(n.owner.number,n.id)))r.notify(s,prepared,n,'live_assignment',n.owner.number,created.id);
      s.flowDedupe[dedupeKey]={hash,taskId:prepared.id};return prepared;
    });return r.get(a,task.id);
  }
  today(a){
    this.check(a);const r=this.runtime,date=dateAt(this.clock()),start=Date.parse(date+'T00:00:00+08:00'),end=start+86400000;
    const tasks=r.store.read().tasks.filter(t=>t.runtime?.liveSession&&runVisible(t,a)&&['running','paused'].includes(t.runtime.state));
    const items=tasks.flatMap(t=>t.runtime.nodes.filter(n=>n.owner.number===a.user.number&&n.state!=='completed'&&(Date.parse(t.runtime.liveSession.startAt)<end||Date.parse(n.dueAt)<=end)).map(n=>({taskId:t.id,version:t.version,title:t.title,state:t.runtime.state,session:t.runtime.liveSession,node:n,waitingFor:n.dependencies.filter(id=>t.runtime.nodes.find(x=>x.id===id)?.state!=='completed').map(id=>t.runtime.nodes.find(x=>x.id===id)?.title),taskUrl:r.taskUrl(t.id)})));
    items.sort((a,b)=>(a.node.state==='ready'?0:1)-(b.node.state==='ready'?0:1)||Date.parse(a.node.dueAt||a.node.plannedDueAt)-Date.parse(b.node.dueAt||b.node.plannedDueAt));
    return {date,generatedAt:r.iso(),items,canManage:a.canManage,enabled:this.enabled,roomLeads:this.leads,...(a.canManage?{dispatch:r.store.read().liveDispatchStatus||null,reconciliationTasks:tasks.filter(t=>t.runtime.liveSession.sourceIssue).map(t=>({id:t.id,version:t.version,title:t.title,state:t.runtime.state,issue:t.runtime.liveSession.sourceIssue,taskUrl:r.taskUrl(t.id)}))}:{})};
  }
  async restoreSource(a,req,b,key){
    this.check(a,true);requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复提交编号');
    const r=this.runtime,previous=r.get(a,b.taskId),hash=fingerprint(b),dedupeKey=[a.user.number,b.taskId,'live-restore',key].join(':');
    requireFact(a.department||previous.center===a.user.center,'没有原任务管理权限',403);
    const prior=r.store.read().flowDedupe?.[dedupeKey];if(prior){requireFact(prior.hash===hash,'重复操作内容不一致',409);return previous;}
    requireFact(previous.runtime.liveSession?.sourceIssue&&['running','paused'].includes(previous.runtime.state),'任务没有待核验班表变更，或已经结束',409);
    requireFact(previous.version===b.expectedVersion,'任务已更新，请刷新后继续',409);requireFact(text(b.note).length>=4,'请记录重新核验的原因');
    // Only the exact original slot may resume: this never edits owners, times,
    // evidence, completed nodes or a paused task's state to fit a changed sheet.
    await this.verifyCurrent(a,req,b.taskId);
    r.store.transaction(s=>{
      r.ensure(s);const repeated=s.flowDedupe[dedupeKey];if(repeated){requireFact(repeated.hash===hash,'重复操作内容不一致',409);return;}
      const t=s.tasks.find(t=>t.id===b.taskId&&runVisible(t,a));requireFact(t?.version===b.expectedVersion&&t.runtime.liveSession.sourceIssue,'任务已更新，请刷新后继续',409);
      delete t.runtime.liveSession.sourceIssue;t.version++;
      const event=r.log(s,t,null,'live_source_restored',a.user,text(b.note));
      if(t.runtime.state==='running')for(const n of t.runtime.nodes.filter(n=>n.state==='ready')){
        const pending=s.flowNotifications.some(v=>v.taskId===t.id&&v.nodeId===n.id&&v.attempt===n.attempt&&v.recipient===n.owner.number&&['ready','sending'].includes(v.state)&&['ready','returned','live_source_restored'].includes(v.kind));
        if(!pending)r.notify(s,t,n,'live_source_restored',n.owner.number,event.id);
      }
      s.flowDedupe[dedupeKey]={hash,taskId:t.id};
    });return r.get(a,b.taskId);
  }
  async verifyCurrent(a,req,taskId){
    const task=this.runtime.get(a,taskId);if(!task.runtime.liveSession)return;
    const slot=task.runtime.liveSession;
    requireFact(this.readSchedule,'正式班表读取尚未配置',503);
    const raw=await this.readSchedule(req,slot.date);
    const current=scheduleSessions({...raw,rooms:(raw.rooms||[]).filter(room=>room.code===slot.roomCode)},slot.date,this.runtime.people(),this.clock(),this.runtime.liveParticipants).find(s=>s.key===slot.key);
    requireFact(current?.signature===slot.signature,'班次来源已变化，请由主管核对原任务；本次未完成或重复派工',409);
  }
}
