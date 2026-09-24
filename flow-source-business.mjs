import {requireFact} from './workflow-store.mjs';
import {fingerprint,text} from './task-workflow.mjs';
const actor={number:'SYSTEM-BUSINESS',name:'业务来源自动同步'};
const definitions={remix:{workflow:'02',name:'二创混剪',url:'https://hub.fandow.com/yxb/wis-marketing-hub/modules/material-workbench/'},cloud:{workflow:'03',name:'WIS 云管家',url:'https://hub.fandow.com/yxb/wis-marketing-hub/modules/cloud-manager/'}};
export class SourceBusinessBridge{
 constructor(runtime){this.runtime=runtime;this.connections={};}
 status(){return structuredClone(this.connections);}
 apply(source,row,{prior:knownPrior,known=false}={}){const r=this.runtime,d=definitions[source];
  requireFact(row.id&&row.title&&Array.isArray(row.steps)&&row.steps.length>0,'业务来源缺少任务或步骤');
  const owners=[row.owner,...row.steps.map(n=>n.owner||row.owner)];requireFact(owners.every(n=>this.runtime.people().some(p=>p.active&&p.number===n)),'原任务人员缺少有效业务授权');if(source==='cloud')requireFact(row.steps.every(n=>n.owner),'审核人尚未唯一指定，请在云管家核对候选人');
  requireFact(new Set(row.steps.map(n=>n.id)).size===row.steps.length&&row.steps.every(n=>n.id.startsWith('W'+d.workflow+'.')&&['pending','ready','completed'].includes(n.state)),'来源节点或状态无效');
  const sourceKey='source:'+source+':'+row.id,signature=fingerprint(row);
  const access={enabled:true,department:true,user:actor};
  // Notifications require a persisted source check less than 45 seconds old.
  // Keep that heartbeat at most 20 seconds old, but avoid rewriting the full
  // task store on every unchanged 5-second mirror poll.
  const prior=known?knownPrior:r.store.read().tasks.find(t=>t.runtime?.sourceKey===sourceKey),local=prior?.runtime?.localBusiness;
  const age=r.clock()-Date.parse(local?.checkedAt);
  if(local?.production&&local.source===source&&local.recordId===row.id&&local.signature===signature&&!local.issue&&age>=0&&age<20000)return prior;
  return r.store.transaction(s=>{r.ensure(s);let t=s.tasks.find(t=>t.runtime?.sourceKey===sourceKey);
   if(!t){const nodes=row.steps.map((n,i)=>({id:n.id,stageId:n.id.split('.').slice(0,2).join('.'),title:n.title,owner:r.person(n.owner||row.owner,access),type:'系统',state:'pending',attempt:1,dependencies:i?[row.steps[i-1].id]:[],slaHours:24,history:[],evidence:[],fields:['source_id','source_version','employee_number'],inputs:[],outputs:[],done:'以原业务任务与真实文件、审核结果为准。',entry:'在'+d.name+'办理，状态自动同步。',recovery:'保留原任务编号和历史，在来源系统处理。'}));const owner=r.person(row.owner,access);t=r.makeTask(access,{workflow:d.workflow,title:row.title,sourceUrl:d.url,product:row.product,acceptance:source==='remix'?'混剪成片通过审核并回传云管家。':'完成素材审核，并取得获准渠道的真实分发回执。'},nodes,owner,owner,sourceKey);t.runtime.localBusiness={source,recordId:row.id,production:true};s.tasks.push(t);r.log(s,t,null,'business_connected',actor,d.name+' · '+row.id);}
   const local=t.runtime.localBusiness;requireFact(local?.production&&local.source===source&&local.recordId===row.id,'来源编号已被其他任务占用，保留原任务');requireFact(t.runtime.nodes.length===row.steps.length&&row.steps.every((n,i)=>n.id===t.runtime.nodes[i].id),'来源步骤变化，需核对后同步');
   if(signature!==local.signature){const wasComplete=t.runtime.state==='completed';
    for(let i=0;i<row.steps.length;i++){const p=row.steps[i],n=t.runtime.nodes[i],owner=r.person(p.owner||row.owner,access);if(n.state===p.state&&n.owner.number===owner.number)continue;
     if(n.state!=='pending'){n.history.push({attempt:n.attempt,state:n.state,completedAt:n.completedAt,evidence:n.evidence});n.attempt++;}
     n.owner=owner;n.state=p.state;n.evidence=[];for(const k of ['completedAt','startedAt','dueAt','warnedAt','escalatedAt'])delete n[k];
     if(n.state==='completed'){n.completedAt=r.iso();n.evidence=[{url:t.sourceUrl,reference:row.id,version:String(row.version),source:'business_source_record',verifiedAt:r.iso(),summary:row.status}];r.log(s,t,n,'node_completed',actor,row.status,n.evidence);}
     if(n.state==='ready'){n.startedAt=r.iso();n.dueAt=new Date(r.clock()+86400000).toISOString();const ev=r.log(s,t,n,'node_ready',actor,row.note||row.status);r.notify(s,t,n,'ready',n.owner.number,ev.id);}
    }
    const complete=t.runtime.nodes.every(n=>n.state==='completed');t.runtime.state=complete?'completed':'running';t.status=complete?'completed':'in_progress';t.title=text(row.title,120);t.runtime.participants=[...new Set([row.owner,...t.runtime.nodes.map(n=>n.owner.number)])];
    if(complete&&!wasComplete){t.runtime.completedAt=r.iso();const ev=r.log(s,t,null,'flow_completed',actor,'原业务任务已完成');r.notify(s,t,null,'completed',row.owner,ev.id);}else if(!complete)delete t.runtime.completedAt;
    Object.assign(local,{signature,status:row.status,version:row.version,note:row.note||'',assetId:row.assetId||null,upstreamRenderId:row.upstreamRenderId||null});t.version++;t.updatedAt=r.iso();
   }
   delete local.issue;local.checkedAt=r.iso();return t;
  });
 }

 sync(snapshot){
  const r=this.runtime;
  for(const source of ['remix','cloud']){
   const baseline=new Set(snapshot.baselines[source]||[]),rows=snapshot[source].records,issues=[];
   const prefix='source:'+source+':',known=new Map(r.store.read().tasks.filter(t=>t.runtime?.sourceKey?.startsWith(prefix)).map(t=>[t.runtime.sourceKey.slice(prefix.length),t]));
   for(const row of rows){if(baseline.has(row.id)&&!known.has(row.id))continue;try{known.set(row.id,this.apply(source,row,{prior:known.get(row.id),known:true}));}catch(e){const issue={recordId:row.id,message:e.status?e.message:'来源任务暂未完成核验'};issues.push(issue);const current=known.get(row.id);if(current?.runtime?.localBusiness?.issue!==issue.message&&current)r.store.transaction(s=>{const t=s.tasks.find(t=>t.runtime?.sourceKey==='source:'+source+':'+row.id);if(t)t.runtime.localBusiness.issue=issue.message;return true;});}}
   const missing='原记录暂不可读，保留最后核验状态',present=new Set(rows.map(x=>x.id));
   if(r.store.read().tasks.some(t=>t.runtime?.localBusiness?.production&&t.runtime.localBusiness.source===source&&!present.has(t.runtime.localBusiness.recordId)&&t.runtime.localBusiness.issue!==missing))r.store.transaction(s=>{for(const t of s.tasks.filter(t=>t.runtime?.localBusiness?.production&&t.runtime.localBusiness.source===source&&!present.has(t.runtime.localBusiness.recordId)))t.runtime.localBusiness.issue=missing;return true;});
   this.connections[source]={state:issues.length?'attention':'connected',name:definitions[source].name,url:definitions[source].url,checkedAt:r.iso(),count:rows.length,issues};
  }
  const snapshotState=r.store.read();
  const needsHandoff=snapshotState.tasks.some(child=>{const local=child.runtime?.localBusiness;if(!local?.production||!local.upstreamRenderId)return false;const parent=snapshotState.tasks.find(t=>t.runtime?.sourceKey==='source:remix:'+local.upstreamRenderId);return parent?.runtime.localBusiness?.production&&parent.runtime.state==='completed'&&!parent.runtime.handoff;});
  if(needsHandoff)r.store.transaction(s=>{for(const child of s.tasks.filter(t=>t.runtime?.localBusiness?.production&&t.runtime.localBusiness.upstreamRenderId)){
   const parent=s.tasks.find(t=>t.runtime?.sourceKey==='source:remix:'+child.runtime.localBusiness.upstreamRenderId);
   if(parent?.runtime.localBusiness?.production&&parent.runtime.state==='completed'&&!parent.runtime.handoff){parent.runtime.handoff={state:'dispatched',taskId:child.id,workflow:'03',owner:child.assignee,manager:child.runtime.manager};child.runtime.parentTaskId=parent.id;r.log(s,parent,null,'handoff_dispatched',actor,'成片回传已对应云管家审核任务 '+child.id);r.log(s,child,null,'handoff_linked',actor,'来自二创成片 '+parent.id);parent.version++;child.version++;}
  }return true;});
 }
}
