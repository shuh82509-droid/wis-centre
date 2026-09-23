import {randomUUID} from 'node:crypto';
import {requireFact} from './workflow-store.mjs';
import {fingerprint,safeUrl,text} from './task-workflow.mjs';
import {catalogVersion,catalog,graphFor,flowAllowed} from './flow-catalog.mjs';
import {evidenceKinds} from './flow-evidence.mjs';
import {executionGraph, simpleVersion} from './flow-model.mjs';
const id=p=>p+'_'+randomUUID().replaceAll('-','');
const actorSystem={number:'SYSTEM',name:'流程引擎'};
const closed=new Set(['completed','cancelled']);
export const immediateHandoffNodes=Object.freeze({'00':'W00.S4.E1','05':'W05.S5.E1'});
export function runVisible(t,a){return !!(t.runtime&&a.enabled&&!a.configurationOnly&&flowAllowed(a,t.workflow)&&(t.workflow==='06'?t.runtime.participants.includes(a.user.number):a.department||t.center===a.user.center&&(a.canManage||t.runtime.participants.includes(a.user.number))));}
// A relationship is informational: it never grants task, attachment or action
// permission. Only reciprocal links persisted by the dispatcher are displayed.
function relationIndex(tasks){const byId=new Map(tasks.map(t=>[t.id,t])),children=new Map();for(const child of tasks){const parent=byId.get(child.runtime?.parentTaskId);if(!parent?.runtime||parent.id===child.id||parent.workflow==='06'||child.workflow==='06')continue;const dispatched=parent.runtime.handoff?.state==='dispatched'&&parent.runtime.handoff.taskId===child.id,branched=Object.values(parent.runtime.blueprintTriggers||{}).some(v=>v.taskId===child.id);if(!dispatched&&!branched)continue;if(!children.has(parent.id))children.set(parent.id,[]);children.get(parent.id).push(child);}return {byId,children};}
function taskRelations(t,a,index){const summary=(row,direction)=>{const canOpen=runVisible(row,a);return {...(canOpen?{taskId:row.id,title:row.title}:{title:direction==='upstream'?'上游交接':'下游接收'}),workflow:row.workflow,state:row.runtime.state,owner:{name:row.assignee.name,number:row.assignee.number},canOpen};},parent=index.byId.get(t.runtime.parentTaskId);return {upstream:parent&&index.children.get(parent.id)?.some(row=>row.id===t.id)?[summary(parent,'upstream')]:[],downstream:(index.children.get(t.id)||[]).map(row=>summary(row,'downstream'))};}
function taskEvents(events,t,a,relations){const visibleIds=new Set([...relations.upstream,...relations.downstream].filter(r=>r.canOpen&&r.taskId).map(r=>r.taskId)),hiddenChild=[t.runtime.handoff?.taskId,...Object.values(t.runtime.blueprintTriggers||{}).map(v=>v.taskId)].some(id=>id&&!visibleIds.has(id));return events.filter(e=>e.taskId===t.id).map(e=>{let note=e.note;const routing=['handoff_configured','handoff_dispatched','data_branch_triggered','data_branch_blocked','handoff_blocked'].includes(e.action),hiddenParent=['flow_started','handoff_linked'].includes(e.action)&&t.runtime.parentTaskId&&!visibleIds.has(t.runtime.parentTaskId);if(routing&&(!a.canManage||hiddenChild)||hiddenParent)note=({handoff_configured:'主管已配置本任务完成后的交接。',handoff_dispatched:'本任务已完成交接；可查看的上下游显示在任务关系中。',data_branch_triggered:'已按本任务配置完成后续派发。',data_branch_blocked:'后续派发待主管核对，本任务与交付已保留。',handoff_blocked:'后续交接待主管核对，本任务与交付已保留。',flow_started:'由业务上游交接至本任务。',handoff_linked:'已关联业务上游，原任务内容与办理状态保留。'})[e.action];return {...e,note};});}
export class FlowRuntime{
 constructor(store,{people,canNotify=()=>true,clock=Date.now,env=process.env}={}){this.store=store;this.people=people;this.canNotify=canNotify;this.clock=clock;this.publicUrl=env.FLOW_PUBLIC_URL||'https://app.fandow.top/fd-026222/wis-marketing-hub/workflow-panorama/';const url=new URL(this.publicUrl);requireFact(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&/\/workflow-panorama\/$/.test(url.pathname),'流程公开地址配置无效');requireFact(env.HUB_INTEGRATED_MODE!=='1'||env.FLOW_PUBLIC_URL,'整合中枢必须配置当前流程公开地址');}
 taskUrl(taskId){const url=new URL(this.publicUrl);url.search='';url.hash='';url.searchParams.set('task',taskId);return url.href;}
 iso(){return new Date(this.clock()).toISOString();}
 ensure(s){s.flowNotifications??=[];s.flowEvents??=[];s.flowDedupe??={};s.flowSettings??={};}
 person(number,a){const p=this.people().find(p=>p.number===number&&p.active);requireFact(p&& (a.department||p.center===a.user.center),'负责人不在当前授权的在职人员范围',403);return {number:p.number,name:p.name,center:p.center};}
 validateOwner(n,number,nodes){const person=this.people().find(p=>p.number===number),flow=n.id.match(/^W(\d{2})\./)?.[1];if(flow&&Array.isArray(person?.modules))requireFact(flowAllowed({enabled:person.active,modules:person.modules},flow),(person.name||number)+' 尚未开放此业务模块，请选择已有权限的同事或先完成授权',403);if(n.managerRequired)requireFact(['manager','director'].includes(person?.role),'此决定节点须由具备原业务授权的主管或总监办理',403);if(['W06.S6.E3','W06.S6.E4'].includes(n.id)){const other=nodes.find(x=>x.id===(n.id==='W06.S6.E3'?'W06.S6.E4':'W06.S6.E3'));requireFact(!other||other.owner.number!==number,'绩效复核负责人须与原评议负责人分开',403);}}
 log(s,t,n,action,actor=actorSystem,note='',evidence=null){const e={id:id('flowevt'),taskId:t.id,nodeId:n?.id||null,attempt:n?.attempt||null,action,actor:{number:actor.number,name:actor.name},at:this.iso(),note:text(note,1500),evidence};s.flowEvents.push(e);t.updatedAt=e.at;return e;}
 notify(s,t,n,kind,recipient,eventId){if(!recipient)return;const key=[t.id,n?.id||'task',n?.attempt||0,kind,eventId,recipient].join(':');if(s.flowNotifications.some(x=>x.key===key))return;s.flowNotifications.push({id:id('notice'),key,taskId:t.id,nodeId:n?.id||null,attempt:n?.attempt||0,kind,recipient,state:'ready',attempts:0,nextAt:this.clock(),createdAt:this.iso(),messageId:null,...(kind==='source_attention'?{reason:t.runtime.automation?.issue}: {})});}
 route(s,t){if(t.runtime.state!=='running')return;for(const n of t.runtime.nodes){if(n.state!=='pending'||!n.dependencies.every(k=>t.runtime.nodes.find(x=>x.id===k)?.state==='completed'))continue;n.state='ready';n.startedAt=this.iso();n.dueAt=new Date(this.clock()+n.slaHours*3600000).toISOString();const e=this.log(s,t,n,'node_ready');this.notify(s,t,n,'ready',n.owner.number,e.id);}
  if(t.runtime.nodes.every(n=>n.state==='completed')){t.runtime.state='completed';t.status='completed';t.runtime.completedAt=this.iso();const e=this.log(s,t,null,'flow_completed');this.notify(s,t,null,'completed',t.runtime.manager.number,e.id);this.dispatchHandoff(s,t);}
 }
 create(a,b,key,{prepareOnly=false,definition=null}={}){requireFact(a.canManage&&flowAllowed(a,b.workflow),'当前账号不能发起此流程',403);requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复提交编号');
  requireFact(prepareOnly||!(/^(auto|handoff|blueprint):/.test(String(b.sourceKey||''))),'此来源编号前缀由流程引擎管理，请使用原业务编号');
  const h=fingerprint(b),k=a.user.number+':'+key;const old=this.store.read().flowDedupe?.[k];if(old){requireFact(old.hash===h,'重复提交内容不一致',409);return this.get(a,old.taskId);}
  b=this.blueprints?.resolveForCreate(a,b,definition)||{...b,_blueprint:null};
  const nodes=executionGraph(b),owner=this.person(b.owner,a),manager=this.person(b.manager||a.user.number,a);const people=this.people();
  requireFact(['manager','director'].includes(people.find(p=>p.number===manager.number)?.role),'升级负责人需要主管或总监角色');
  const title=text(b.title,120);safeUrl(b.sourceUrl);requireFact(title.length>=2&&text(b.acceptance),'请填写工作事项和交付标准');
  requireFact(b.workflow==='06'||!b.options?.stage,'业务主流程不能跳过必选阶段');
  for(const n of nodes){const selected=b.bindings?.[n.id]||(n.ownerRule==='reviewer'?(b.reviewer||manager.number):n.ownerRule==='receiver'?b.receiver:n.managerRequired?manager.number:owner.number);n.owner=this.person(selected,a);n.slaHours=Number(b.slaHours||n.slaHours);requireFact(Number.isFinite(n.slaHours)&&n.slaHours>=1/60&&n.slaHours<=720,'节点时限须在1分钟至30天内');n.state='pending';n.attempt=1;n.evidence=[];n.history=[];}
  for(const n of nodes)this.validateOwner(n,n.owner.number,nodes);
  for(const p of [owner,manager,...nodes.map(n=>n.owner)])requireFact(this.canNotify(p.number),p.name+' 的飞书通知尚未绑定，请完成绑定后发起；本次填写内容保留',409);
  if(prepareOnly){requireFact(!b.handoff,'下游任务不能嵌套配置另一份交接，请使用已发布路由');return this.makeTask(a,b,nodes,owner,manager,text(b.sourceKey,200));}
  const prepared=this.makeTask(a,b,nodes,owner,manager,text(b.sourceKey,200));
  if(b.handoff){this.assertHandoffDirection(prepared,b.handoff.workflow);const child=this.create(a,{...b.handoff,product:prepared.runtime.product,sourceUrl:this.taskUrl(prepared.id),sourceKey:'handoff:'+prepared.id},'draft-'+key,{prepareOnly:true});prepared.runtime.handoff={state:'waiting',workflow:child.workflow,owner:child.assignee,manager:child.runtime.manager,draft:child,authorizedBy:a.user,configuredAt:this.iso()};}
  const task=this.store.transaction(s=>{this.ensure(s);const prior=s.flowDedupe[k];if(prior){requireFact(prior.hash===h,'重复提交内容不一致',409);return s.tasks.find(t=>t.id===prior.taskId);}
   const sourceKey=text(b.sourceKey,200);if(sourceKey){const previous=s.tasks.find(t=>t.runtime?.sourceKey===sourceKey&&t.center===owner.center&&t.workflow===b.workflow&&!closed.has(t.status));if(previous){s.flowDedupe[k]={hash:h,taskId:previous.id};return previous;}}
   const t=prepared;
   s.tasks.push(t);this.log(s,t,null,'flow_started',a.user);this.route(s,t);s.flowDedupe[k]={hash:h,taskId:t.id};return t;});return this.get(a,task.id);
 }
 makeTask(a,b,nodes,owner,manager,sourceKey){const title=text(b.title,120),sourceUrl=safeUrl(b.sourceUrl);return {id:id('task'),version:1,workflow:b.workflow,lane:'action',kind:'formal',status:'in_progress',center:owner.center,title,description:text(b.description),acceptance:text(b.acceptance),sourceKind:'text',sourceUrl,sourceReference:sourceKey,assignee:owner,assignees:[owner],createdBy:a.user,createdAt:this.iso(),updatedAt:this.iso(),dueAt:null,outputs:[],reviews:[],deliveries:[],feedback:[],events:[],runtime:{blueprint:b._blueprint||null,version:catalogVersion,mode:b.mode||'standard',templateVersion:b.mode==='simple'?simpleVersion:catalogVersion,state:'running',sourceKey,product:text(b.product,100),options:b.options||{},manager,participants:[...new Set([a.user.number,manager.number,...nodes.map(n=>n.owner.number)])],nodes}};}
 assertHandoffDirection(task,target){requireFact((catalog.edges.some(([from,to])=>from===task.workflow&&to===target&&from!=='06'&&to!=='06')||task.workflow!=='06'&&target!=='06'&&task.runtime.blueprint?.moduleOrder.includes(target))&&target!==task.workflow,'请选择此流程允许的业务交接方向；人事资料按原独立授权流程办理');}
 assertImmediateHandoff(t){
  requireFact(immediateHandoffNodes[t.workflow]&&t.runtime.state==='running'&&!t.runtime.automation,'只有情报任务下发或数据回流行动节点可以立即交接',409);
  const n=t.runtime.nodes.find(n=>n.id===immediateHandoffNodes[t.workflow]);requireFact(n?.state==='ready','请先完成前置环节，到达任务下发或下游行动节点后再交接',409);
  const seen=new Set(),visit=node=>{for(const key of node.dependencies||[]){if(seen.has(key))continue;seen.add(key);const prior=t.runtime.nodes.find(x=>x.id===key);requireFact(prior?.state==='completed','下游行动的前置环节尚未全部完成',409);visit(prior);}};visit(n);
 }
 configureHandoff(a,taskId,b,key){
  requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复操作编号');
  const dispatchMode=b.dispatchMode===undefined?'after_completion':b.dispatchMode;requireFact(['after_completion','now'].includes(dispatchMode),'交接时机无效');
  const priorTask=this.get(a,taskId);requireFact(a.canManage&&(a.department||priorTask.center===a.user.center),'需要本流程管理权限',403);
  const hash=fingerprint(b),dedupeKey=[a.user.number,taskId,'handoff',key].join(':');
  const existing=this.store.read().flowDedupe?.[dedupeKey];if(existing){requireFact(existing.hash===hash,'重复操作内容不一致',409);return priorTask;}
  requireFact(priorTask.runtime.state!=='cancelled','已终止流程不能交接',409);
  requireFact(priorTask.version===b.expectedVersion,'任务已更新，请刷新后继续',409);
  if(dispatchMode==='now')this.assertImmediateHandoff(priorTask);
  this.assertHandoffDirection(priorTask,b.workflow);
  if(b.existingTaskId!==undefined)return this.linkExistingHandoff(a,priorTask,b,key,{hash,dedupeKey,dispatchMode});
  const child=this.create(a,{...b,product:priorTask.runtime.product,sourceUrl:this.taskUrl(taskId),sourceKey:'handoff:'+taskId},'draft-'+key,{prepareOnly:true});
  this.store.transaction(s=>{this.ensure(s);const t=s.tasks.find(x=>x.id===taskId&&runVisible(x,a));requireFact(t,'流程不存在或没有权限',404);const prior=s.flowDedupe[dedupeKey];if(prior){requireFact(prior.hash===hash,'重复操作内容不一致',409);return t;}requireFact(t.version===b.expectedVersion,'任务已更新，请刷新后继续',409);requireFact(!t.runtime.handoff||t.runtime.handoff.state!=='dispatched','已经生成下游任务，请在原下游任务办理',409);
   if(dispatchMode==='now'){this.assertImmediateHandoff(t);this.assertHandoffDirection(t,b.workflow);}
   t.runtime.handoff={state:'waiting',workflow:b.workflow,owner:child.assignee,manager:child.runtime.manager,draft:child,authorizedBy:a.user,configuredAt:this.iso(),dispatchMode};
   this.log(s,t,null,'handoff_configured',a.user,(dispatchMode==='now'?'本节点立即交接至 ':'完成后交接至 ')+catalog.flows.find(x=>x.id===b.workflow).name+' · '+child.assignee.name);t.version++;s.flowDedupe[dedupeKey]={hash,taskId};if(dispatchMode==='now')this.dispatchHandoff(s,t,{immediate:true,strict:true});else if(t.runtime.state==='completed')this.dispatchHandoff(s,t);return t;});return this.get(a,taskId);
 }
 linkExistingHandoff(a,priorTask,b,key,{hash,dedupeKey,dispatchMode}){
  requireFact(dispatchMode==='now','关联已有任务须在明确的即时交接节点办理',409);
  requireFact(/^task_[a-z0-9]+$/.test(String(b.existingTaskId||'')),'请选择现有任务');
  // Use the same visibility response for a nonexistent or inaccessible target.
  this.get(a,b.existingTaskId);
  requireFact(Number.isInteger(b.existingTaskVersion)&&b.existingTaskVersion>0,'缺少现有任务版本，请先读取任务后再关联',409);
  this.store.transaction(s=>{
   this.ensure(s);const t=s.tasks.find(x=>x.id===priorTask.id&&runVisible(x,a)),child=s.tasks.find(x=>x.id===b.existingTaskId&&runVisible(x,a));
   requireFact(t&&child,'流程不存在或没有查看权限',404);
   const repeated=s.flowDedupe[dedupeKey];if(repeated){requireFact(repeated.hash===hash,'重复操作内容不一致',409);return t;}
   requireFact(t.version===b.expectedVersion,'任务已更新，请刷新后继续',409);
   this.assertImmediateHandoff(t);this.assertHandoffDirection(t,child.workflow);
   requireFact(child.workflow===b.workflow&&child.workflow!=='06'&&t.id!==child.id,'现有任务与本次交接方向不一致',409);
   requireFact(child.version===b.existingTaskVersion,'现有任务已更新，请重新核对原任务后关联',409);
   requireFact(['running','paused'].includes(child.runtime.state)&&!child.runtime.automation,'只能关联仍在办理的人工业务任务',409);
   requireFact(!t.runtime.handoff||t.runtime.handoff.state!=='dispatched','已经生成或关联下游，请在原下游任务办理',409);
   requireFact(!child.runtime.parentTaskId,'现有任务已有上游，不能重接或抢占原关系',409);
   const seen=new Set([t.id]);let parent=t;
   while(parent.runtime.parentTaskId){const id=parent.runtime.parentTaskId;requireFact(id!==child.id&&!seen.has(id),'不能把上游任务关联为下游形成循环',409);seen.add(id);parent=s.tasks.find(x=>x.id===id);requireFact(parent?.runtime,'原上游关系不完整，请先核对',409);}
   const people=this.people(),actor=people.find(p=>p.number===a.user.number&&p.active);
   requireFact(actor&&['director','manager'].includes(actor.role),'交接配置人的当前管理授权已变化',409);
   for(const row of [t,child]){const manager=people.find(p=>p.number===row.runtime.manager.number&&p.active);requireFact(manager&&['director','manager'].includes(manager.role)&&this.canNotify(manager.number),'流程管理人员或飞书绑定待核验',409);}
   this.person(child.assignee.number,a);requireFact(this.canNotify(child.assignee.number),'下游主责飞书绑定待核验',409);
   requireFact(flowAllowed({enabled:actor.active,modules:actor.modules||a.modules},t.workflow)&&flowAllowed({enabled:actor.active,modules:actor.modules||a.modules},child.workflow),'交接配置人的当前业务模块权限已变化',403);
   for(const node of child.runtime.nodes){this.person(node.owner.number,a);requireFact(this.canNotify(node.owner.number),'下游人员飞书绑定待核验',409);this.validateOwner(node,node.owner.number,child.runtime.nodes);}
   child.runtime.parentTaskId=t.id;child.version++;child.updatedAt=this.iso();
   t.runtime.handoff={state:'dispatched',workflow:child.workflow,taskId:child.id,owner:structuredClone(child.assignee),manager:structuredClone(child.runtime.manager),authorizedBy:structuredClone(a.user),configuredAt:this.iso(),dispatchedAt:this.iso(),dispatchMode:'now',linkedExisting:true};
   const event=this.log(s,child,null,'handoff_linked',a.user,'已关联上游任务 '+t.id+'；原任务内容与办理状态保留');
   this.notify(s,child,null,'handoff_linked',child.assignee.number,event.id);
   this.log(s,t,null,'handoff_dispatched',a.user,'已关联现有下游任务 '+child.id+'；原任务不重新创建');
   t.version++;s.flowDedupe[dedupeKey]={hash,taskId:t.id};return t;
  });return this.get(a,priorTask.id);
 }
 dispatchHandoff(s,t,{immediate=false,strict=false}={}){if(immediate)this.assertImmediateHandoff(t);this.blueprints?.ensureHandoff(s,t);const h=t.runtime.handoff;if(!h||!h.draft||h.state==='dispatched'||!immediate&&t.runtime.state!=='completed')return;
  try{if(h.blueprintRule&&t.runtime.blueprint?.configurationGrant){const access=this.blueprints.executionAccess(t,h.draft.workflow);for(const n of h.draft.runtime.nodes)this.person(n.owner.number,access);this.person(h.manager.number,access);}
   const people=this.people(),author=people.find(p=>p.number===h.authorizedBy.number&&p.active);requireFact(author&&['director','manager'].includes(author.role),'交接配置人的当前管理授权已变化',409);
   if(Array.isArray(author.modules))requireFact(flowAllowed({enabled:true,modules:author.modules},t.workflow)&&flowAllowed({enabled:true,modules:author.modules},h.draft.workflow),'交接配置人的当前业务模块权限已变化',403);
   for(const n of h.draft.runtime.nodes){requireFact(people.some(p=>p.number===n.owner.number&&p.active)&&this.canNotify(n.owner.number),'下游人员状态或飞书绑定待核验',409);this.validateOwner(n,n.owner.number,h.draft.runtime.nodes);}
   requireFact(people.some(p=>p.number===h.manager.number&&p.active&&['director','manager'].includes(p.role))&&this.canNotify(h.manager.number),'下游升级负责人状态或飞书绑定待核验',409);
   const child=structuredClone(h.draft);child.createdAt=this.iso();child.updatedAt=this.iso();child.runtime.parentTaskId=t.id;child.runtime.inheritedContext=structuredClone(['03','05'].includes(child.workflow)?t.runtime.sourceContext||{}:{});child.runtime.sourceContext=structuredClone(child.runtime.inheritedContext);
   child.runtime.handoffEvidence=t.runtime.nodes.flatMap(n=>n.evidence||[]).slice(-12);s.tasks.push(child);h.state='dispatched';h.taskId=child.id;h.dispatchedAt=this.iso();delete h.draft;delete h.error;
   this.log(s,child,null,'flow_started',actorSystem,'由上游任务 '+t.id+' 自动交接');this.route(s,child);this.log(s,t,null,'handoff_dispatched',actorSystem,'已生成下游任务 '+child.id);t.version++;
  }catch(e){if(strict)throw e;if(h.state!=='attention'){h.state='attention';h.error=text(e.message,500);const ev=this.log(s,t,null,'handoff_blocked',actorSystem,h.error);this.notify(s,t,null,'handoff_blocked',t.runtime.manager.number,ev.id);}}
 }
 get(a,taskId){const s=this.store.read();const t=s.tasks.find(t=>t.id===taskId&&runVisible(t,a));requireFact(t,'流程不存在或没有查看权限',404);const result=structuredClone(t),relations=taskRelations(t,a,relationIndex(s.tasks)),visibleChildren=new Set(relations.downstream.filter(r=>r.canOpen&&r.taskId).map(r=>r.taskId));
  if(result.runtime.handoff){delete result.runtime.handoff.draft;if(result.runtime.handoff.taskId&&!visibleChildren.has(result.runtime.handoff.taskId))result.runtime.handoff={state:result.runtime.handoff.state};}
  if(!relations.upstream.some(r=>r.canOpen&&r.taskId===t.runtime.parentTaskId)){delete result.runtime.parentTaskId;delete result.runtime.handoffEvidence;for(const key of ['sourceReference'])if(/^(handoff|blueprint):/.test(result[key]||''))result[key]='';if(/^(handoff|blueprint):/.test(result.runtime.sourceKey||''))delete result.runtime.sourceKey;try{const url=new URL(result.sourceUrl);if(url.searchParams.get('task')===t.runtime.parentTaskId)result.sourceUrl='';}catch{}}
  if(a.canManage){if(result.runtime.blueprintTriggers)result.runtime.blueprintTriggers=Object.fromEntries(Object.entries(result.runtime.blueprintTriggers).filter(([,v])=>visibleChildren.has(v.taskId)));}
  else for(const key of ['blueprint','blueprintDepth','blueprintTriggers','blueprintError','routingIssues','handoff','options'])delete result.runtime[key];
  return {...result,relations,flowEvents:taskEvents(s.flowEvents||[],t,a,relations),notifications:(s.flowNotifications||[]).filter(n=>n.taskId===taskId).map(({id,nodeId,kind,recipient,state,messageId,createdAt,sentAt,error,attempts})=>({id,nodeId,kind,recipient,state,messageId,createdAt,sentAt,error,attempts}))};}
 command(a,taskId,action,b,key,{verifiedEvidence=null}={}){requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复操作编号');const h=fingerprint(b),k=[a.user.number,taskId,action,key].join(':');
  this.store.transaction(s=>{this.ensure(s);const t=s.tasks.find(t=>t.id===taskId&&runVisible(t,a));requireFact(t,'流程不存在或没有权限',404);const prior=s.flowDedupe[k];if(prior){requireFact(prior.hash===h,'重复操作内容不一致',409);return t;}
   requireFact(b.expectedVersion===t.version,'任务已更新，请刷新后继续',409);requireFact(!t.runtime.automation,'此任务由二创生产记录自动推进；请到二创工作台处理原任务',409);requireFact(!closed.has(t.runtime.state),'流程已经结束',409);
   const manage=a.canManage&&(a.department||t.center===a.user.center),n=t.runtime.nodes.find(n=>n.id===b.nodeId);
   if(['pause','resume','cancel'].includes(action)){
    requireFact(manage,'需要本流程管理权限',403);requireFact(text(b.note),'请记录操作原因');
    requireFact(action!=='resume'||t.runtime.state==='paused','流程未暂停',409);
    requireFact(action!=='pause'||t.runtime.state==='running','流程已经暂停',409);
    if(action==='pause')t.runtime.pausedAt=this.iso();
    if(action==='resume'){
     const pausedMs=Math.max(0,this.clock()-Date.parse(t.runtime.pausedAt||this.iso()));
     for(const row of t.runtime.nodes.filter(x=>x.state==='ready')){row.dueAt=new Date(Date.parse(row.dueAt)+pausedMs).toISOString();row.pausedMs=(row.pausedMs||0)+pausedMs;}
     t.runtime.totalPausedMs=(t.runtime.totalPausedMs||0)+pausedMs;delete t.runtime.pausedAt;
    }
    t.runtime.state=action==='pause'?'paused':action==='resume'?'running':'cancelled';if(action==='cancel')t.status='cancelled';
    const e=this.log(s,t,null,action,a.user,b.note);for(const p of t.runtime.participants)this.notify(s,t,null,action,p,e.id);
    if(action==='resume')for(const row of t.runtime.nodes.filter(x=>x.state==='ready'))this.notify(s,t,row,'ready',row.owner.number,e.id);
    this.route(s,t);
   }
   else{requireFact(t.runtime.state==='running','流程已暂停，请先恢复',409);requireFact(n,'执行节点不存在',404);requireFact(manage||n.owner.number===a.user.number,'只有当前主责或流程管理人可以办理',403);
    if(action==='complete'){
     requireFact(n.state==='ready','节点尚未到达或已经完成',409);this.validateOwner(n,a.user.number,t.runtime.nodes);requireFact(text(b.note),'请记录交付结论');const refs=Array.isArray(b.evidence)?b.evidence:[];
     const inherited=n.canReuseUpstreamEvidence&&!refs.length?t.runtime.nodes.filter(x=>n.dependencies.includes(x.id)&&x.state==='completed').flatMap(x=>x.evidence.map(e=>({...e,reusedFrom:{nodeId:x.id,attempt:x.attempt}}))).slice(0,12):[];
     requireFact((refs.length>=1||inherited.length>=1)&&refs.length<=12,'请上传交付文件、截图，添加链接或关联云管家素材');
     if(evidenceKinds[n.id])requireFact(verifiedEvidence?.length,'此节点须由业务根记录核验，不能手填成功凭证',409);
     const evidence=verifiedEvidence|| (inherited.length?inherited:refs.map(r=>({url:safeUrl(r.url),reference:text(r.reference,200)||'link-'+fingerprint(safeUrl(r.url)).slice(0,20),version:text(r.version,100)||'link-reference-v1',summary:text(r.summary,500),source:'human_attested'})));requireFact(evidence.every(r=>r.url&&r.reference&&r.version),'证据必须包含有效文件引用或链接');
     if(verifiedEvidence?.[0]?.context)t.runtime.sourceContext={...t.runtime.sourceContext,...verifiedEvidence[0].context};
     n.state='completed';n.completedAt=this.iso();n.completedBy={number:a.user.number,name:a.user.name};n.durationSeconds=Math.max(0,(this.clock()-Date.parse(n.startedAt))/1000);n.activeDurationSeconds=Math.max(0,n.durationSeconds-(n.pausedMs||0)/1000);n.evidence=evidence;n.note=text(b.note);this.log(s,t,n,'node_completed',a.user,b.note,evidence);this.route(s,t);
    }else if(action==='return'){
     requireFact(n.state==='ready'&&text(b.note),'请选择当前节点并记录退回原因',409);const target=t.runtime.nodes.find(x=>x.id===b.targetNodeId);requireFact(target&&target.id!==n.id&&target.state==='completed','只能退回已完成的上游节点');
     const affected=new Set([target.id]);let changed=true;while(changed){changed=false;for(const row of t.runtime.nodes)if(!affected.has(row.id)&&row.dependencies.some(d=>affected.has(d))){affected.add(row.id);changed=true;}}
     requireFact(affected.has(n.id),'目标不是本节点的上游',409);for(const row of t.runtime.nodes.filter(x=>affected.has(x.id))){row.history.push({attempt:row.attempt,state:row.state,evidence:row.evidence,startedAt:row.startedAt,completedAt:row.completedAt,note:row.note});row.attempt++;row.state='pending';row.evidence=[];delete row.completedAt;delete row.completedBy;delete row.startedAt;delete row.dueAt;delete row.durationSeconds;delete row.activeDurationSeconds;delete row.pausedMs;delete row.warnedAt;delete row.escalatedAt;delete row.note;}
     t.runtime.sourceContext=Object.assign({},t.runtime.inheritedContext||{},...t.runtime.nodes.filter(x=>x.state==='completed').flatMap(x=>x.evidence.map(e=>e.context||{})));
     const e=this.log(s,t,n,'node_returned',a.user,b.note);this.notify(s,t,target,'returned',target.owner.number,e.id);this.route(s,t);
    }else if(action==='assign'){requireFact(manage,'需要流程管理权限',403);requireFact(n.state!=='completed','已完成节点不可改主责',409);this.validateOwner(n,b.owner,t.runtime.nodes);n.owner=this.person(b.owner,a);requireFact(this.canNotify(n.owner.number),'新主责的飞书尚未绑定，请先完成绑定',409);t.runtime.participants=[...new Set([...t.runtime.participants,n.owner.number])];const e=this.log(s,t,n,'node_assigned',a.user,b.note);if(n.state==='ready')this.notify(s,t,n,'ready',n.owner.number,e.id);
    }else if(action==='extend'){requireFact(manage&&n.state==='ready','只有流程管理人可调整当前节点时限',403);requireFact(text(b.note)&&Number.isFinite(Date.parse(b.dueAt))&&Date.parse(b.dueAt)>this.clock(),'请填写延期原因与有效未来时间');n.dueAt=new Date(b.dueAt).toISOString();delete n.warnedAt;delete n.escalatedAt;this.log(s,t,n,'deadline_extended',a.user,b.note);
    }else requireFact(false,'未知流程操作',404);
   }
   t.version++;t.updatedAt=this.iso();s.flowDedupe[k]={hash:h,taskId};return t;
  });return this.get(a,taskId);
 }
 checkAssignments(){const people=this.people();if(!people.length)return;const active=new Set(people.filter(p=>p.active).map(p=>p.number));const problems=t=>[...new Map([t.runtime.manager,...t.runtime.nodes.filter(n=>n.state!=='completed').map(n=>n.owner)].filter(p=>!active.has(p.number)||!this.canNotify(p.number)).map(p=>[p.number,p])).values()];
  const needs=t=>t.runtime?.state==='running'&&fingerprint(problems(t).map(p=>p.number))!==(t.runtime.assignmentIssue?.signature||fingerprint([]));if(!this.store.read().tasks.some(needs))return;
  this.store.transaction(s=>{this.ensure(s);for(const t of s.tasks.filter(needs)){const rows=problems(t);if(!rows.length){delete t.runtime.assignmentIssue;this.log(s,t,null,'assignment_restored');}else{t.runtime.assignmentIssue={signature:fingerprint(rows.map(p=>p.number)),message:rows.map(p=>p.name+'（'+p.number+'）').join('、')+' 已不在有效人员或飞书绑定范围，请在原任务调整主责。',at:this.iso()};const ev=this.log(s,t,null,'assignment_attention',actorSystem,t.runtime.assignmentIssue.message);const targets=active.has(t.runtime.manager.number)&&this.canNotify(t.runtime.manager.number)?[t.runtime.manager]:people.filter(p=>p.active&&p.role==='director'&&this.canNotify(p.number));for(const target of targets)this.notify(s,t,null,'assignment_attention',target.number,ev.id);}t.version++;}return true;});
 }
 tick(){this.checkAssignments();const prior=this.store.read();if(!prior.tasks.some(t=>t.runtime?.state==='running'&&t.runtime.nodes.some(n=>n.state==='ready'&&Date.parse(n.dueAt)<=this.clock()&&(!n.warnedAt||!n.escalatedAt&&this.clock()-Date.parse(n.dueAt)>=86400000))))return;
  return this.store.transaction(s=>{this.ensure(s);for(const t of s.tasks.filter(t=>t.runtime?.state==='running'))for(const n of t.runtime.nodes.filter(n=>n.state==='ready'&&Date.parse(n.dueAt)<=this.clock())){if(!n.warnedAt){n.warnedAt=this.iso();const e=this.log(s,t,n,'node_overdue');this.notify(s,t,n,'overdue',n.owner.number,e.id);this.blueprints?.triggerSource(s,t,'node_overdue');}if(!n.escalatedAt&&this.clock()-Date.parse(n.dueAt)>=86400000){n.escalatedAt=this.iso();const e=this.log(s,t,n,'node_escalated');this.notify(s,t,n,'escalated',t.runtime.manager.number,e.id);}}return true;});
 }
 overview(a){const s=this.store.read(),tasks=s.tasks.filter(t=>runVisible(t,a)),index=relationIndex(s.tasks),relations=new Map(tasks.map(t=>[t.id,taskRelations(t,a,index)]));const ids=new Set(tasks.map(t=>t.id));const notices=(s.flowNotifications||[]).filter(n=>ids.has(n.taskId));
  return {generatedAt:this.iso(),catalogVersion,access:{name:a.user.name,number:a.user.number,role:a.user.role,center:a.user.center,canManage:a.canManage,department:!!a.department},
   tasks:tasks.map(t=>({id:t.id,title:t.title,workflow:t.workflow,center:t.center,product:t.runtime.product,state:t.runtime.state,version:t.version,owner:t.assignee,updatedAt:t.updatedAt,relations:relations.get(t.id),nodes:t.runtime.nodes.map(({id,title,state,owner,dueAt,completedAt,attempt,dependencies})=>({id,title,state,owner,dueAt,completedAt,attempt,dependencies:[...dependencies]}))})),
   metrics:{runs:tasks.length,active:tasks.filter(t=>t.runtime.state==='running').length,completed:tasks.filter(t=>t.runtime.state==='completed').length,overdue:tasks.filter(t=>t.runtime.state==='running').flatMap(t=>t.runtime.nodes).filter(n=>n.state==='ready'&&Date.parse(n.dueAt)<this.clock()).length,notificationSent:notices.filter(n=>n.state==='sent').length,notificationAttention:notices.filter(n=>n.state==='attention').length},
   ...(a.canManage?{flows:catalog.flows.filter(f=>flowAllowed(a,f.id)).map(f=>({...f,capability:'L2 已实现，待业务样本验收',completedRuns:tasks.filter(t=>t.workflow===f.id&&t.runtime.state==='completed').length}))}:{taskCatalog:{flows:catalog.flows.filter(f=>tasks.some(t=>t.workflow===f.id)).map(({id,name,short,module})=>({id,name,short,module})),stages:[]}}),
   events:(s.flowEvents||[]).filter(e=>ids.has(e.taskId)).slice(-40).reverse().flatMap(e=>taskEvents([e],index.byId.get(e.taskId),a,relations.get(e.taskId)))};
 }
}
