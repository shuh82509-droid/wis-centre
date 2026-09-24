import {requireFact} from './workflow-store.mjs';
import {fingerprint,text} from './task-workflow.mjs';

const system={number:'SYSTEM',name:'创意来源同步'};
const ideaStates=new Set(['generated','pending_review','pending_team_lead','pending_supervisor','returned_to_creator','approved','archived']);
const topicStates=new Set(['待审核','已通过','未通过']);
export const creativeSystems=Object.freeze({idea:'Idea OS 创意工作台',ppyxzx:'品牌营销创意平台'});
function completionRecipient(task){
 return task.runtime.creative?.local&&task.assignee.number==='LOCAL-CREATIVE'
  ?task.runtime.nodes.at(-1)?.owner.number||task.assignee.number:task.assignee.number;
}

// Normalize only fields whose meaning is established by the archived source
// handlers. A source status is not evidence that unrelated catalog nodes ran.
export function creativeProjection(source,record,users,bindings={}){
 requireFact(record&&typeof record.id==='string'&&record.id.length>0&&record.id.length<=200&&text(record.title),'创意来源记录缺少编号或标题',502);
 requireFact(!record.updatedAt||Number.isFinite(Date.parse(record.updatedAt)),'来源更新时间无效，不能核验记录顺序',502);
 const byId=id=>{
  const matches=users.filter(p=>p.id===id&&p.active!==false);
  requireFact(matches.length===1&&text(matches[0].employeeNo),'来源成员缺少唯一工号，不能按姓名猜测通知对象',409);
  return matches[0].employeeNo;
 };
 let steps,state='running';
 if(source==='idea'){
  requireFact(ideaStates.has(record.status),'创意脚本状态尚未支持，保留原任务等待核对',409);
  const creator=byId(record.creatorId||record.uploaderId);
  // Unsubmitted drafts may not yet have reviewers. Explicit bindings are only
  // used for those future nodes; a source-assigned reviewer always takes priority.
  const lead=record.teamLeadReviewerId?byId(record.teamLeadReviewerId):bindings.reviewer;
  const supervisor=record.supervisorReviewerId?byId(record.supervisorReviewerId):bindings.manager;
  const finished=['approved','archived'].includes(record.status),returned=record.status==='returned_to_creator';
  const active=finished?-1:record.status==='generated'||returned?0:record.status==='pending_supervisor'?2:1;
  if(active===1||active===2)requireFact(byId(record.currentReviewerId)===(active===1?lead:supervisor),'来源当前审核人与审核阶段不一致，请核对原任务',409);
  steps=[['draft','脚本编写与提交',creator],['lead','组长审核',lead],['supervisor','主管终审与归档',supervisor]]
   .map(([key,title,owner],i)=>({key,title,owner,state:finished||i<active?'completed':i===active?'ready':'pending'}));
  // Supervisor returns explicitly resume at supervisor in the source handler,
  // preserving the prior lead approval; other returned approvals are historical.
  if(returned&&record.resumeStage==='pending_supervisor')steps[1].state='completed';
  state=finished?'completed':'running';
 }else{
  requireFact(source==='ppyxzx'&&topicStates.has(record.status),'选题状态尚未支持，保留原任务等待核对',409);
  requireFact(bindings.owner&&bindings.reviewer,'选题接口没有成员工号，请先明确提交人与审核人的对应工号',409);
  const finished=record.status==='已通过',returned=record.status==='未通过';
  steps=[{key:'proposal',title:'选题提交与修改',owner:bindings.owner,state:returned?'ready':'completed'},
   {key:'review',title:'选题审核',owner:bindings.reviewer,state:finished?'completed':returned?'pending':'ready'}];
  state=finished?'completed':'running';
 }
 requireFact(steps.every(n=>typeof n.owner==='string'&&n.owner),'任务办理人尚未完整配置',409);
 return {id:record.id,title:text(record.title,120),product:text(record.product,100),status:record.status,state,steps,
  dueAt:record.dueDate&&Number.isFinite(Date.parse(record.dueDate))?new Date(/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)?record.dueDate+'T23:59:59+08:00':record.dueDate).toISOString():null,
  sourceUpdatedAt:record.updatedAt||null,sourceVersion:record.version??null,note:text(record.feedback||record.reviewComment||'',1500)};
}

export class FlowCreative {
 constructor(runtime,{readSource,sourceUrl}){this.runtime=runtime;this.readSource=readSource;this.sourceUrl=sourceUrl;}
 assertAccess(a){requireFact(a.enabled&&a.canManage&&!a.configurationOnly&&a.modules?.includes('creative-hub'),'需要创意来源及任务管理权限',403);}
 watches(a){this.assertAccess(a);const s=this.runtime.store.read();return (s.creativeWatches||[]).filter(w=>a.department||w.center===a.user.center||w.automatic&&s.tasks.find(t=>t.id===w.taskId)?.runtime?.participants.includes(a.user.number));}
 async candidates(a,req,source,recordIds=[],options={}){
  this.assertAccess(a);requireFact(Object.hasOwn(creativeSystems,source),'未知创意来源');
  requireFact(source!=='ppyxzx'||a.department,'选题来源缺少部门范围字段，当前仅允许部门管理员接入',403);
  const data=await this.readSource({headers:req.headers,flowActorNumber:a.user.number},source,recordIds,options);
  requireFact(Array.isArray(data.records)&&Array.isArray(data.users),'创意来源响应不完整',502);
  requireFact(new Set(data.records.map(d=>d.id)).size===data.records.length,'来源记录编号重复，请先核对原系统',502);
  // Idea API historically returned records from the whole workspace. Filter by
  // verified source employee numbers AND the caller's current center scope.
  const numbers=new Set(this.runtime.people().filter(p=>p.active&&(a.department||p.center===a.user.center)).map(p=>p.number));
  const ids=new Set(data.users.filter(u=>u.active!==false&&numbers.has(u.employeeNo)).map(u=>u.id));
  const records=source==='idea'?data.records.filter(d=>ids.has(d.creatorId||d.uploaderId)||data.local&&[d.teamLeadReviewerId,d.supervisorReviewerId].some(id=>ids.has(id))):data.records;
  // PPYXZX exposes no trustworthy department/employee fields; its directory is
  // available only to a verified department administrator until source ACL exists.
  return {...data,records};
 }
 async configure(a,req,b,key){
  this.assertAccess(a);requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复提交编号');
  requireFact(typeof b.recordId==='string'&&b.recordId.length>0&&b.recordId.length<=200,'请选择来源记录');
  const r=this.runtime,hash=fingerprint(b),dedupeKey=a.user.number+':creative:'+key;
  const prior=r.store.read().flowDedupe?.[dedupeKey];if(prior){requireFact(prior.hash===hash,'重复提交内容不一致',409);return r.get(a,prior.taskId);}
  const data=await this.candidates(a,req,b.source,[b.recordId]),record=data.records.find(d=>d.id===b.recordId);
  requireFact(record,'来源记录未读回或不在当前授权范围，不能新建映射',404);
  const projection=creativeProjection(b.source,record,data.users,b);
  const manager=r.person(b.manager,a);
  requireFact(r.people().some(p=>p.number===manager.number&&['manager','director'].includes(p.role)),'升级负责人须具备主管或总监权限');
  this.validatePeople(a,projection);
  const watch={source:b.source,recordId:b.recordId,center:r.person(projection.steps[0].owner,a).center,manager,
   bindings:{owner:b.owner,reviewer:b.reviewer,manager:b.manager},configuredBy:a.user,configuredAt:r.iso(),enabled:true};
  const taskId=r.store.transaction(s=>{
   r.ensure(s);s.creativeWatches??=[];
   const exists=s.creativeWatches.find(w=>w.source===b.source&&w.recordId===b.recordId);
   requireFact(!exists||a.department||exists.center===a.user.center,'此来源已在其他授权范围接入',403);
   requireFact(!exists,'该创意记录已经接入，请打开原流程任务',409);
   s.creativeWatches.push(watch);
   const task=this.apply(s,watch,projection,data.actionsByRecord?.[b.recordId]||[],a);
   s.flowDedupe[dedupeKey]={hash,taskId:task.id};return task.id;
  });return r.get(a,taskId);
 }
 validatePeople(a,p){for(const step of p.steps){this.runtime.person(step.owner,a);const person=this.runtime.people().find(x=>x.number===step.owner);requireFact(!person.modules||person.modules.includes('creative-hub'),'办理人未开放创意来源权限',403);}}
 async sync(a,req){
  this.assertAccess(a);const results=[];
  for(const source of Object.keys(creativeSystems)){
   const watches=this.watches(a).filter(w=>w.source===source&&w.enabled&&w.configuredBy.number===a.user.number);if(!watches.length)continue;
   let data;try{data=await this.candidates(a,req,source,watches.map(w=>w.recordId));}catch(e){for(const w of watches)this.fail(w,e);results.push({source,state:'attention'});continue;}
   for(const w of watches)try{
    const row=data.records.find(d=>d.id===w.recordId);requireFact(row,'来源记录本次未返回，可能超出接口范围、已删除或权限变化；不推断任务完成',409);
    const p=creativeProjection(source,row,data.users,w.bindings);this.validatePeople(a,p);
    const actions=data.actionsByRecord?.[w.recordId]||[];
    this.runtime.store.transaction(s=>{const current=s.creativeWatches.find(x=>x.source===source&&x.recordId===w.recordId);requireFact(current?.enabled,'创意跟进已停用',409);this.apply(s,current,p,actions,a);return true;});
    results.push({source,recordId:w.recordId,state:'connected'});
   }catch(e){this.fail(w,e);results.push({source,recordId:w.recordId,state:'attention'});}
  }return results;
 }
 fail(w,error){const r=this.runtime,message=error.status?text(error.message,500):'来源读取失败，原任务和通知回执已保留';const prior=r.store.read().creativeWatches?.find(x=>x.source===w.source&&x.recordId===w.recordId);if(!prior||prior.issue===message)return;r.store.transaction(s=>{const row=s.creativeWatches?.find(x=>x.source===w.source&&x.recordId===w.recordId);if(!row||row.issue===message)return true;row.issue=message;row.checkedAt=r.iso();const t=s.tasks.find(t=>t.id===row.taskId);if(t){t.runtime.creative.issue=message;r.log(s,t,null,'creative_sync_attention',system,message);t.version++;}return true;});}
 repairLocalCompletion(s,t){
  const recipient=completionRecipient(t),r=this.runtime;
  if(!t.runtime.creative?.local||t.runtime.state!=='completed'||t.assignee.number!=='LOCAL-CREATIVE'||recipient==='LOCAL-CREATIVE')return;
  const completion=[...s.flowEvents].reverse().find(e=>e.taskId===t.id&&e.action==='flow_completed');if(!completion)return;
  const oldKey=[t.id,'task',0,'completed',completion.id,'LOCAL-CREATIVE'].join(':');
  const old=s.flowNotifications.find(n=>n.key===oldKey);if(!old||old.messageId||old.unknown)return;
  const mappingFailure=old.error==='未找到唯一且在职的飞书收件人映射';
  if(!(old.state==='attention'&&mappingFailure||old.state==='ready'&&(mappingFailure||old.attempts===0&&!old.firstAttemptAt)))return;
  // Never edit a delivered/uncertain notice or reuse its message UUID for a
  // different recipient. Preserve the old record and queue a distinct notice.
  r.notify(s,t,null,'completed',recipient,completion.id);
  const replacement=s.flowNotifications.find(n=>n.key===[t.id,'task',0,'completed',completion.id,recipient].join(':'));
  old.correction={at:r.iso(),previousError:old.error||'',recipient,reason:'local_placeholder_completion'};
  old.state='superseded';old.supersededBy=replacement.id;old.error='本地联调账号无飞书绑定；完成通知已更正为本任务主管审核人。';
  replacement.correctionOf=old.id;
  r.log(s,t,null,'notification_recipient_corrected',system,'完成通知的本地占位收件人已更正为主管审核人 '+t.runtime.nodes.at(-1).owner.name+'（'+recipient+'）；原失败记录保留。');t.version++;
 }
 apply(s,w,p,actions,a){
  const r=this.runtime,sourceKey='creative:'+w.source+':'+w.recordId;
  let t=s.tasks.find(t=>t.runtime?.sourceKey===sourceKey);
  const signature=fingerprint(p);
  if(t?.runtime.creative.sourceUpdatedAt&&p.sourceUpdatedAt){requireFact(Date.parse(p.sourceUpdatedAt)>=Date.parse(t.runtime.creative.sourceUpdatedAt),'读到了旧版本来源记录，保留较新流程状态',409);}
  if(!t){
   const nodes=p.steps.map((n,i)=>({id:'W07.S'+(i+1)+'.E1',stageId:'W07.S'+(i+1),title:n.title,type:'人工',owner:r.person(n.owner,a),state:'pending',attempt:1,dependencies:i?['W07.S'+i+'.E1']:[],slaHours:24,history:[],evidence:[],fields:['source_id','source_status','source_version','employee_number'],inputs:[],outputs:[],done:'以原创意系统的提交、审核和归档结果为准。',entry:'在原创意工作台办理，状态自动同步。',recovery:'在来源系统修改或重新提交，保留退回和重审记录。'}));
   t=r.makeTask(a,{workflow:'07',title:p.title,product:p.product,sourceUrl:this.sourceUrl(w.source),acceptance:'完成原创意任务的提交、审核和归档。',options:{}},nodes,nodes[0].owner,w.manager,sourceKey);
   t.runtime.creative={source:w.source,recordId:w.recordId,actionIds:[]};s.tasks.push(t);w.taskId=t.id;r.log(s,t,null,'creative_connected',a.user,creativeSystems[w.source]+' · '+w.recordId);
  }
  const c=t.runtime.creative,wasCompleted=t.runtime.state==='completed',changed=c.signature!==signature;
  const initial=!c.signature;let addedActions=0,reentered=false;
  // Keep the source action ledger, including transitions that happened between
  // polls. These are history entries, not fresh notifications for obsolete work.
  for(const action of actions){if(!action.id||c.actionIds.includes(action.id))continue;c.actionIds.push(action.id);addedActions++;if(['resubmit','submit'].includes(action.action))reentered=true;const e=r.log(s,t,null,'creative_source_action',system,text([action.action,action.stage,action.actorName,action.comment].filter(Boolean).join(' · '),1500));e.sourceEventId=action.id;e.sourceAt=action.createdAt||null;}
  if(addedActions&&!changed)t.version++;
  if(changed||!initial&&reentered){
   for(let i=0;i<p.steps.length;i++){
    const projected=p.steps[i],node=t.runtime.nodes[i],owner=r.person(projected.owner,a),stateChanged=node.state!==projected.state||!initial&&reentered&&node.state==='ready'&&projected.state==='ready'&&node.creativeNoticeSignature!==signature,ownerChanged=node.owner.number!==owner.number;
    if(stateChanged&&node.state!=='pending'){
     node.history.push({attempt:node.attempt,state:node.state,evidence:structuredClone(node.evidence),startedAt:node.startedAt,completedAt:node.completedAt,note:node.note});
     if(projected.state!=='completed')node.attempt++;
    }
    node.owner=owner;node.state=projected.state;
    if(stateChanged){delete node.startedAt;delete node.completedAt;delete node.dueAt;delete node.warnedAt;delete node.escalatedAt;node.evidence=[];}
    if(projected.state==='completed'&&stateChanged){node.completedAt=r.iso();node.evidence=[{url:t.sourceUrl,reference:p.id,version:String(p.sourceVersion??p.sourceUpdatedAt??signature),source:'creative_root_verified',verifiedAt:r.iso(),summary:'来源状态：'+p.status}];r.log(s,t,node,'node_completed',system,'来源状态：'+p.status,node.evidence);}
    if(projected.state==='ready'){
     node.startedAt??=r.iso();node.dueAt=p.dueAt||node.dueAt||new Date(r.clock()+86400000).toISOString();node.note=p.note;
     if(stateChanged||ownerChanged){const returned=['returned_to_creator','未通过'].includes(p.status);const e=r.log(s,t,node,returned?'node_returned':ownerChanged?'node_assigned':'node_ready',system,p.note||'来源状态：'+p.status);r.notify(s,t,node,returned?'returned':'ready',node.owner.number,e.id);node.creativeNoticeSignature=signature;}
    }
   }
   t.title=p.title;t.assignee=t.runtime.nodes[0].owner;t.assignees=[t.assignee];t.runtime.product=p.product;
   t.runtime.state=p.state;t.status=p.state==='completed'?'completed':'in_progress';
   t.runtime.participants=[...new Set([w.configuredBy.number,w.manager.number,...t.runtime.nodes.map(n=>n.owner.number)])];
   if(p.state==='completed'&&!wasCompleted){t.runtime.completedAt=r.iso();const e=r.log(s,t,null,'flow_completed',system,'原创意任务已通过并归档');if(!initial)r.notify(s,t,null,'completed',completionRecipient(t),e.id);}
   if(p.state!=='completed')delete t.runtime.completedAt;
   Object.assign(c,{signature,status:p.status,sourceUpdatedAt:p.sourceUpdatedAt,sourceVersion:p.sourceVersion});t.version++;
  }
  if(c.issue){r.log(s,t,null,'creative_sync_restored',system,'来源已重新核验');delete c.issue;t.version++;}
  delete w.issue;w.checkedAt=r.iso();c.checkedAt=r.iso();this.repairLocalCompletion(s,t);return t;
 }
}
