import {sameFlowProduct} from './flow-product.mjs';
import {randomUUID} from 'node:crypto';
import {catalog,graphFor,flowAllowed} from './flow-catalog.mjs';
import {requireFact} from './workflow-store.mjs';
import {fingerprint,text} from './task-workflow.mjs';
import {canConfigure,configurationDepartment,configurationPeopleAccess} from './flow-configuration-access.mjs';
export const branchConditions=[{id:'black_mask',name:'产品为黑晶面膜',event:'completed'},{id:'water_mask',name:'产品为隐形水润面膜',event:'completed'},{id:'asset_ready',name:'已取得核验通过的云管家资产',event:'completed'},{id:'source_shortage',name:'自动批次缺少合格来源素材',event:'source'},{id:'quality_issue',name:'自动批次出现成片质量或审核异常',event:'source'},{id:'node_overdue',name:'当前办理节点超时',event:'source'}];
const defaultOptions=flow=>flow==='01'?{production:'ai'}:flow==='04'?{anchorMode:'existing'}:{};
const clone=v=>structuredClone(v);
const scopeKey=a=>configurationDepartment(a)?'department':'center:'+a.user.center;
export class FlowBlueprints{
 constructor(runtime){this.runtime=runtime;}
 default(a){return {id:scopeKey(a),name:configurationDepartment(a)?'品牌营销部工作流':'工作流 · '+a.user.center,scope:configurationDepartment(a)?'department':'center',center:configurationDepartment(a)?'':a.user.center,version:0,moduleOrder:catalog.flows.filter(f=>f.id!=='06'&&!f.sourceManaged&&flowAllowed(a,f.id)).map(f=>f.id),modules:Object.fromEntries(catalog.flows.filter(f=>f.id!=='06'&&!f.sourceManaged&&flowAllowed(a,f.id)).map(f=>[f.id,{owner:'task_owner',manager:'task_manager',slaHours:24,options:defaultOptions(f.id),nodeOrder:[],bindings:{}}])),branches:[],defaultRoute:false};}
 canRead(a,d){return a.enabled&&(d.scope==='department'||!a.configurationOnly&&d.center===a.user.center);}
 canEdit(a,d){return canConfigure(a)&&(d.scope==='department'?configurationDepartment(a):!a.configurationOnly&&(d.center===a.user.center||a.department));}
 active(a,s=this.runtime.store.read()){const revisions=s.flowBlueprintRevisions||[];return (!a.configurationOnly&&[...revisions].reverse().find(d=>d.active&&d.scope==='center'&&d.center===a.user.center))||[...revisions].reverse().find(d=>d.active&&d.scope==='department')||null;}
 view(a){requireFact(canConfigure(a),'当前身份没有流程编排授权',403);const s=this.runtime.store.read(),draft=(s.flowBlueprintDrafts||[]).find(d=>d.id===scopeKey(a)),active=this.active(a,s);return {active:active?clone(active):null,draft:draft?clone(draft):this.default(a),canEdit:!!canConfigure(a),conditions:branchConditions,revisions:(s.flowBlueprintRevisions||[]).filter(d=>this.canRead(a,d)).map(({id,version,name,scope,center,active,publishedAt,publishedBy,moduleOrder,defaultRoute})=>({id,version,name,scope,center,active,publishedAt,publishedBy,moduleOrder,defaultRoute})).reverse().slice(0,30)};}
 validate(a,input){requireFact(canConfigure(a),'当前身份没有流程发布授权',403);const peopleAccess=configurationPeopleAccess(a);const base=this.default(a),draft={...base,name:text(input.name,100),moduleOrder:input.moduleOrder,modules:{},branches:[],defaultRoute:input.defaultRoute===true};requireFact(draft.name.length>=2,'请填写流程配置名称');requireFact(Array.isArray(input.moduleOrder)&&input.moduleOrder.length>=1&&input.moduleOrder.length<=6&&new Set(input.moduleOrder).size===input.moduleOrder.length,'模块须为1至6个互不重复的业务模块');
  for(const flow of input.moduleOrder){requireFact(flow!=='06'&&flow!=='07'&&flowAllowed(a,flow),'模块不在当前配置权限内；部门人事事项保持独立授权',403);const cfg=input.modules?.[flow]||{},owner=cfg.owner||'task_owner',manager=cfg.manager||'task_manager',options={...defaultOptions(flow),...cfg.options};delete options.nodeOrder;requireFact(!options.stage,'业务模块须保留完整阶段，独立事项在部门人事范围办理');
   if(!['task_owner','task_manager'].includes(owner))this.runtime.person(owner,peopleAccess);if(manager!=='task_manager'){this.runtime.person(manager,peopleAccess);requireFact(['manager','director'].includes(this.runtime.people().find(p=>p.number===manager)?.role),'升级负责人须具备管理角色');}
   const hours=Number(cfg.slaHours||24);requireFact(Number.isFinite(hours)&&hours>=1/60&&hours<=720,'节点时限须为1分钟至30天');
   const nodeOrder=Array.isArray(cfg.nodeOrder)?cfg.nodeOrder:[],graph=graphFor(flow,{...options,nodeOrder});const bindings={};for(const [nodeId,number]of Object.entries(cfg.bindings||{})){requireFact(graph.some(n=>n.id===nodeId),'负责人绑定包含不存在的节点');if(!number||number==='task_owner'||number==='task_manager')bindings[nodeId]=number||'task_owner';else{this.runtime.person(number,peopleAccess);bindings[nodeId]=number;}}
   for(const p of [owner,manager,...Object.values(bindings)].filter(x=>!['task_owner','task_manager'].includes(x)))requireFact(this.runtime.canNotify(p),'指定人员的飞书尚未绑定，请先核验再发布',409);
   for(const n of graph.filter(n=>n.managerRequired)){const value=bindings[n.id]||'task_manager',chosen=value==='task_owner'?(owner==='task_manager'?manager:owner):value==='task_manager'?manager:value;if(!['task_owner','task_manager'].includes(chosen))requireFact(['manager','director'].includes(this.runtime.people().find(p=>p.number===chosen)?.role),'决定节点须绑定具备业务授权的管理角色',403);}draft.modules[flow]={owner,manager,slaHours:hours,options,nodeOrder,bindings};
  }
  requireFact(!input.branches||Array.isArray(input.branches)&&input.branches.length<=12,'每套流程最多配置12条条件分支');
  const pairs=new Set();for(const [i,rule]of (input.branches||[]).entries()){requireFact(draft.moduleOrder.includes(rule.after)&&draft.moduleOrder.includes(rule.next)&&rule.after!==rule.next,'分支起点和终点须是两个已选模块');const condition=branchConditions.find(c=>c.id===rule.when);requireFact(condition,'请选择已接入的根数据条件');requireFact(!['source_shortage','quality_issue'].includes(rule.when)||rule.after==='02','补源和成片质量条件来自二创根记录，请选择二创作为判断起点');const pair=rule.after+':'+rule.when;requireFact(!pairs.has(pair),'同一模块的同一条件只保留一个目标，避免多次派发');pairs.add(pair);draft.branches.push({id:'branch-'+i,after:rule.after,next:rule.next,when:rule.when,event:condition.event,enabled:rule.enabled!==false});}
  return draft;
 }
 save(a,b,key,{publish=false}={}){requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复保存编号');const input=b.config||b,draft=this.validate(a,input),r=this.runtime,hash=fingerprint(b),dedupeKey=a.user.number+':blueprint:'+(publish?'publish:':'save:')+key;
  return r.store.transaction(s=>{r.ensure(s);s.flowBlueprintDrafts??=[];s.flowBlueprintRevisions??=[];const old=s.flowDedupe[dedupeKey];if(old){requireFact(old.hash===hash,'重复提交内容不一致',409);return old.result;}
   const prior=s.flowBlueprintDrafts.find(d=>d.id===draft.id);requireFact(Number(b.expectedVersion||0)===(prior?.version||0),'流程配置已被更新，请重新读取后比较',409);draft.version=(prior?.version||0)+1;draft.updatedAt=r.iso();draft.updatedBy={number:a.user.number,name:a.user.name};
   if(prior)s.flowBlueprintDrafts.splice(s.flowBlueprintDrafts.indexOf(prior),1,draft);else s.flowBlueprintDrafts.push(draft);
   let result={draft:clone(draft),published:null};if(publish){const revision={...clone(draft),revisionId:'blueprint_'+randomUUID().replaceAll('-',''),active:true,publishedAt:r.iso(),publishedBy:{number:a.user.number,name:a.user.name,center:a.user.center,role:a.user.role},...(a.configurationOnly?{configurationGrant:clone(a.configurationGrant)}:{})};for(const d of s.flowBlueprintRevisions.filter(d=>d.id===draft.id))d.active=false;s.flowBlueprintRevisions.push(revision);result.published=clone(revision);}
   s.flowBlueprintEvents??=[];s.flowBlueprintEvents.push({id:randomUUID(),action:publish?'published':'draft_saved',blueprintId:draft.id,version:draft.version,actor:a.user.number,at:r.iso(),moduleOrder:draft.moduleOrder});s.flowDedupe[dedupeKey]={hash,result};return result;
  });
 }
 preview(a,b){const d=this.validate(a,b.config||b),active=this.active(a);const tasks=a.configurationOnly?null:this.runtime.overview(a).tasks.filter(t=>['running','paused'].includes(t.state));return {config:d,steps:d.moduleOrder.map((flow,i)=>({flow,title:catalog.flows.find(f=>f.id===flow).name,position:i+1,next:d.moduleOrder[i+1]||null,nodeCount:graphFor(flow,{...d.modules[flow].options,nodeOrder:d.modules[flow].nodeOrder}).length})),currentVersion:active?.version||0,runningInstancesKept:tasks?.length??null,effect:'发布后，新任务按本配置办理和交接；已开始的任务保留原版本。',branches:d.branches};}
 resolveForCreate(a,b,pinned=null){const source=pinned||this.active(a),def=source?.configurationGrant?this.pinForExecution(a,source):source;if(!def||b.workflow==='06'||!def.moduleOrder.includes(b.workflow))return {...b,_blueprint:null};requireFact(this.canRead(a,def),'无权使用此流程配置',403);const cfg=def.modules[b.workflow],manager=cfg.manager==='task_manager'?(b.manager||a.user.number):cfg.manager,owner=cfg.owner==='task_owner'?b.owner:cfg.owner==='task_manager'?manager:cfg.owner;
  const resolve=value=>value==='task_manager'?manager:value==='task_owner'?owner:value;
  const bindings=Object.fromEntries(Object.entries(cfg.bindings||{}).map(([id,v])=>[id,resolve(v)]));
  return {...b,owner,manager,slaHours:cfg.slaHours,options:{...b.options,...cfg.options,...(b.mode==='simple'?{nodeOrder:[]}:{nodeOrder:cfg.nodeOrder})},bindings:b.mode==='simple'?{...b.bindings}:{...b.bindings,...bindings},_blueprint:clone(def)};
 }
 // Published configuration records the real editor. Execution is separately
 // accepted by a real business manager when starting a task or configuring a
 // production watch. The server never takes this authority from request data.
 pinForExecution(a,definition){
  if(!definition?.configurationGrant)return definition;
  requireFact(a.canManage&&!a.configurationOnly,'编排授权不包含任务执行授权',403);
  if(definition.executionAuthorizedBy)return clone(definition);
  return {...clone(definition),executionAuthorizedBy:{number:a.user.number,name:a.user.name,
   center:a.user.center,role:a.user.role,department:a.department===true,
   modules:[...(a.modules||[])],blueprintRevisionId:definition.revisionId}};
 }
 executionAccess(t,nextFlow){
  const d=t.runtime.blueprint,pin=d?.executionAuthorizedBy;
  requireFact(pin&&pin.blueprintRevisionId===d.revisionId,'本任务尚未取得流程执行授权，请业务主管核对',409);
  const p=this.runtime.people().find(p=>p.number===pin.number&&p.active);
  requireFact(p&&['manager','director'].includes(p.role)&&p.workflowEnabled===true,
   '任务发起人的当前管理或流程权限已变化，请业务主管核对',409);
  const department=pin.department===true&&p.role==='director';
  requireFact(department||p.center===pin.center&&p.center===t.center,
   '任务发起人的当前中心范围已变化，请业务主管核对',403);
  const modules=(p.modules||[]).filter(module=>pin.modules.includes(module));
  const access={enabled:true,canManage:true,department,user:p,modules};
  requireFact(flowAllowed(access,t.workflow)&&flowAllowed(access,nextFlow),
   '任务发起人的当前业务模块权限已变化，请业务主管核对',403);
  return access;
 }
 nextFlow(t,event='completed',reason=''){const d=t.runtime.blueprint;if(!d)return null;const matches=when=>when==='black_mask'?t.runtime.product==='黑晶面膜':when==='water_mask'?sameFlowProduct(t.runtime.product,'隐形水润面膜'):when==='asset_ready'?!!t.runtime.sourceContext?.assetId:when===reason;
  const rule=d.branches.find(x=>x.enabled&&x.after===t.workflow&&x.event===event&&matches(x.when));if(rule)return {flow:rule.next,rule:rule.id,reason:rule.when};if(event!=='completed'||!d.defaultRoute)return null;return d.moduleOrder[d.moduleOrder.indexOf(t.workflow)+1]?{flow:d.moduleOrder[d.moduleOrder.indexOf(t.workflow)+1],rule:'sequence',reason:'completed'}:null;
 }
 prepareNext(s,t,event='completed',reason=''){const next=this.nextFlow(t,event,reason);if(!next)return null;const depth=t.runtime.blueprintDepth||0;requireFact(depth<12,'本次流程已达到12次跨模块交接上限，请主管确认新的业务目标',409);
  const d=t.runtime.blueprint;let a,p;if(d.configurationGrant){a=this.executionAccess(t,next.flow);p=a.user;}else{p=this.runtime.people().find(p=>p.number===d.publishedBy.number&&p.active);requireFact(p&&['manager','director'].includes(p.role),'流程配置发布人的当前授权需重新核验',409);a={enabled:true,canManage:true,department:p.role==='director'&&d.scope==='department',user:p,modules:p.modules||d.moduleOrder.map(f=>catalog.flows.find(x=>x.id===f).module)};}
  const sourceKey='blueprint:'+t.id+':'+event+':'+next.rule;requireFact(!s.tasks.some(x=>x.runtime?.sourceKey===sourceKey),'该根事件已生成下游任务',409);
  const child=this.runtime.create(a,{workflow:next.flow,mode:t.runtime.mode||'standard',reviewer:t.runtime.nodes.find(n=>n.ownerRule==='reviewer')?.owner.number,title:text(t.title.replace(/ · 后续交付$/,'')+' · 后续交付',120),acceptance:t.acceptance,sourceUrl:this.runtime.taskUrl(t.id),sourceKey,product:t.runtime.product,owner:t.assignee.number,manager:t.runtime.manager.number},'blueprint-'+t.id+'-'+next.rule,{prepareOnly:true,definition:d});child.runtime.blueprintDepth=depth+1;child.runtime.parentTaskId=t.id;
  return {next,child,authorizedBy:p};
 }
 ensureHandoff(s,t){if(t.runtime.handoff||!t.runtime.blueprint)return;try{const result=this.prepareNext(s,t);if(!result)return;t.runtime.handoff={state:'waiting',workflow:result.next.flow,owner:result.child.assignee,manager:result.child.runtime.manager,draft:result.child,authorizedBy:result.authorizedBy,configuredAt:this.runtime.iso(),blueprintRule:result.next.rule};}catch(e){const ev=this.runtime.log(s,t,null,'handoff_blocked',undefined,text(e.message,500));t.runtime.blueprintError=text(e.message,500);t.runtime.handoff={state:'attention',error:t.runtime.blueprintError,workflow:this.nextFlow(t)?.flow,blueprintRule:'failed'};this.runtime.notify(s,t,null,'handoff_blocked',t.runtime.manager.number,ev.id);}}
 triggerSource(s,t,reason){const marker='source:'+reason;t.runtime.blueprintTriggers??={};if(t.runtime.blueprintTriggers[marker])return;try{const result=this.prepareNext(s,t,'source',reason);if(!result)return;const child=result.child;if(t.runtime.routingIssues)delete t.runtime.routingIssues[reason];child.runtime.handoffEvidence=[{url:t.sourceUrl,reference:t.runtime.automation?.runId||t.id,version:t.runtime.automation?.runId||String(t.version),summary:t.runtime.automation?.issue||'节点到期后触发数据规则',source:'automation_root_verified'}];s.tasks.push(child);this.runtime.log(s,child,null,'flow_started',undefined,'根数据条件 '+reason+' 自动触发，来源 '+t.id);this.runtime.route(s,child);t.runtime.blueprintTriggers[marker]={taskId:child.id,at:this.runtime.iso(),rule:result.next.rule};this.runtime.log(s,t,null,'data_branch_triggered',undefined,'根记录触发 '+reason+'，已派发 '+child.id);}catch(e){const message=text(e.message,500);t.runtime.routingIssues??={};if(t.runtime.routingIssues[reason]?.message!==message){t.runtime.routingIssues[reason]={message,at:this.runtime.iso()};const ev=this.runtime.log(s,t,null,'data_branch_blocked',undefined,message);this.runtime.notify(s,t,null,'routing_attention',t.runtime.manager.number,ev.id);}}}
}
