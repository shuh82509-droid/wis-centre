import {requireFact} from './workflow-store.mjs';
import {fingerprint,text} from './task-workflow.mjs';
const system={number:'SYSTEM',name:'二创自动流程'};
import {flowModuleLocations} from './flow-locations.mjs';
const definitions=[['source_selection','自动选源与范围核验'],['source_slicing','自动拆解与切片'],['clip_calibration','切片边界自动校准'],['clip_review','有效切片自动检查'],['remix_generation','按批准框架组合成片'],['output_review','成片自动检查'],['material_center_return','成片版本幂等回传'],['cloud_review','云管家交付审核核验']];
const deliveryPlan=(job,run)=>({pushEnabled:job.pushEnabled===true,targets:structuredClone(job.targets||[]),target:Number(run.target)||0});
function pinnedPlan(task,job,run){
 if(task?.runtime.automation?.deliveryPlan)return task.runtime.automation.deliveryPlan;
 if(!task)return deliveryPlan(job,run);
 // Old tasks did not retain target accounts. Never infer their original delivery
 // scope from a plan that may already have changed since those tasks started.
 const pushEnabled=task.runtime.nodes.some(n=>n.id==='AUTO02.platform_receipt');
 return {pushEnabled,targets:[],target:Number(task.runtime.automation?.progress?.target)||Number(run.target)||0,legacyTargetsUnverified:pushEnabled};
}
function qualityAttention(job,run,view){return run.state==='awaiting_review'||view.renders.filter(r=>r.automation?.jobId===job.id&&r.automation?.runId===run.id).some(r=>r.variants.some(v=>v.assessment==='failed'||v.review==='changes_requested'||v.visualReview?.status==='review_required'));}
export function automationProgress(job,run,view){
 const target=Number(run.target)||0,variants=view.renders.filter(r=>r.automation?.jobId===job.id&&r.automation?.runId===run.id).flatMap(r=>r.variants);
 // Historical rejected files are retained for recovery; their mere existence
 // cannot satisfy a new generation target. Pending human review is allowed at
 // this step, while failed/quarantined versions and duplicate files are not.
 const generatedCandidates=variants.filter(v=>v.filePresent===true&&v.sha256&&Number.isFinite(v.duration)&&v.duration>0&&!v.quarantined&&!v.conflict&&v.assessment!=='failed'&&v.review!=='changes_requested'&&!['failed','rejected'].includes(v.visualReview?.status));
 const distinct=rows=>[...new Map(rows.map(v=>[v.sha256,v])).values()];
 const generated=distinct(generatedCandidates);
 const approved=distinct(generatedCandidates.filter(v=>v.review==='approved'&&v.assessment==='passed'&&v.autoApproved&&v.visualReview?.status==='passed'&&v.visualReview.sha256===v.sha256&&v.visualReview.version&&v.visualReview.confidence>=0.9&&Array.isArray(v.visualReview.issues)&&v.visualReview.issues.length===0&&v.sourceClipsApproved));
 const sufficient=target>0&&approved.length>=target,returned=approved.filter(v=>v.returnVerified),reviewed=returned.filter(v=>v.cloudReview?.status==='approved');
 const stage=key=>run.stages?.find(s=>s.key===key);
 const generationComplete=run.state!=='awaiting_sources'&&stage('remix_generation')?.state==='completed'&&target>0&&generated.length>=target;
 // Explicit upstream completion means that operation ran, including a valid
 // zero-new-source check using an existing clip pool. It never proves inventory
 // sufficiency: a source shortage still blocks generation. Partial upstream
 // work is accepted only when the complete approved target proves adequacy.
 const steps=definitions.map(([key,title])=>({key,title,complete:key==='remix_generation'?generationComplete:key==='output_review'?sufficient:key==='material_center_return'?target>0&&returned.length>=target:key==='cloud_review'?target>0&&reviewed.length>=target:stage(key)?.state==='completed'||stage(key)?.state==='partial'&&sufficient&&run.state!=='awaiting_sources',summary:stage(key)?.summary||'',reference:run.id+':'+key}));
 if(job.pushEnabled)steps.push({key:'platform_receipt',title:'目标账户与计划回执核验',complete:target>0&&reviewed.filter(v=>(job.targets||[]).length>0&&job.targets.every(t=>v.receipts.some(r=>r.verified&&String(r.account)===String(t.account)&&String(r.plan)===String(t.plan)))).length>=target,summary:'逐一核对本计划的账户、计划与平台素材编号。',reference:run.id+':platform_receipt'});
 return {steps,target,generated:generated.length,approved:approved.length,returned:returned.length,reviewed:reviewed.length,complete:steps.every(s=>s.complete),conflicts:variants.filter(v=>v.conflict||v.quarantined||!v.filePresent).length};
}
export class FlowAutomation{
 constructor(runtime,sources,{env=process.env}={}){this.runtime=runtime;this.sources=sources;this.locations=flowModuleLocations(env);}
 configure(a,b,key){const r=this.runtime;requireFact(a.canManage&&a.modules.includes('material-workbench'),'需要二创工作流管理权限',403);requireFact(typeof key==='string'&&key.length>=8&&key.length<=128,'缺少防重复操作编号');
  const view=this.sources.view(a);requireFact(view.sources.find(s=>s.id==='remix')?.state==='connected'&&view.sources.find(s=>s.id==='cloud')?.state==='connected','根记录连接尚未完成，请稍后接入',409);
  const job=view.jobs.find(j=>j.id===b.jobId);requireFact(job,'此自动任务不在当前授权范围',404);const owner=r.person(job.owner,a),manager=r.person(b.manager||a.user.number,a);requireFact(['director','manager'].includes(r.people().find(p=>p.number===manager.number)?.role),'升级负责人须具备管理角色');requireFact(r.canNotify(owner.number)&&r.canNotify(manager.number),'主责或升级负责人的飞书尚未绑定',409);
  const slaHours=Number(b.slaHours||4);requireFact(Number.isFinite(slaHours)&&slaHours>=1&&slaHours<=168,'自动任务异常跟进时限须为1至168小时');const hash=fingerprint(b),dedupeKey=a.user.number+':watch:'+key;
  const result=r.store.transaction(s=>{r.ensure(s);s.flowAutomationWatches??=[];const old=s.flowDedupe[dedupeKey];if(old){requireFact(old.hash===hash,'重复提交内容不一致',409);return s.flowAutomationWatches.find(w=>w.jobId===old.jobId);}
   let w=s.flowAutomationWatches.find(w=>w.jobId===job.id);requireFact(!w||a.department||w.owner.center===a.user.center,'没有此跟进配置的管理权限',403);if(!w){w={jobId:job.id,createdAt:r.iso(),initialRunId:job.runs?.[0]?.id||null};s.flowAutomationWatches.push(w);}Object.assign(w,{enabled:b.enabled!==false,owner,manager,slaHours,configuredBy:a.user,blueprint:r.blueprints?.pinForExecution(a,r.blueprints.active(a))||null,updatedAt:r.iso()});s.flowDedupe[dedupeKey]={hash,jobId:job.id};return w;});this.reconcile();return result;
 }
 view(a){return (this.runtime.store.read().flowAutomationWatches||[]).filter(w=>a.department||w.owner.center===a.user.center&&(a.canManage||w.owner.number===a.user.number));}
 recordFailure(w,runId){const r=this.runtime,message='原批次的流程凭证暂时无法核验，已有任务和素材已保留；请核对原批次后继续。';try{const current=r.store.read(),prior=current.tasks.find(x=>x.runtime?.sourceKey==='auto:'+w.jobId+':'+runId),watchIssue=current.flowAutomationWatches?.find(x=>x.jobId===w.jobId)?.reconcileIssue;if(watchIssue?.runId===runId&&(!prior||prior.runtime.automation.reconcileIssue))return;r.store.transaction(s=>{r.ensure(s);const watch=s.flowAutomationWatches?.find(x=>x.jobId===w.jobId),t=s.tasks.find(x=>x.runtime?.sourceKey==='auto:'+w.jobId+':'+runId);if(watch&&watch.reconcileIssue?.runId!==runId)watch.reconcileIssue={runId,message,at:r.iso()};if(t&&!t.runtime.automation.reconcileIssue){t.runtime.automation.reconcileIssue={message,at:r.iso()};t.runtime.automation.issue=message;const n=t.runtime.nodes.find(x=>x.state==='ready'),ev=r.log(s,t,n,'source_attention',system,message);r.notify(s,t,n,'source_attention',w.owner.number,ev.id);t.version++;}return true;});}catch{console.error('Automatic workflow evidence pending; original records retained');}}
 reconcile(){const url=this.locations.remix,r=this.runtime,people=r.people(),watches=r.store.read().flowAutomationWatches||[];
  for(const w of watches){
   try{
   const p=people.find(p=>p.number===w.owner.number&&p.active);if(!p||!r.canNotify(p.number))continue;
   const view=this.sources.view({enabled:true,department:false,canManage:false,user:p,modules:['material-workbench','cloud-manager']});
   if(view.sources.some(s=>['cloud','remix'].includes(s.id)&&s.state!=='connected'))continue;
   const job=view.jobs.find(j=>j.id===w.jobId&&j.owner===p.number);if(!job)continue;
   for(const run of (job.runs||[]).filter(x=>x.id===w.initialRunId||Date.parse(x.startedAt)>=Date.parse(w.createdAt))){
    try{
    const sourceKey='auto:'+job.id+':'+run.id,prior=r.store.read().tasks.find(t=>t.runtime?.sourceKey===sourceKey);if(!w.enabled&&!prior)continue;
    const plan=pinnedPlan(prior,job,run),progress=automationProgress({...job,pushEnabled:plan.pushEnabled,targets:plan.targets},{...run,target:plan.target},view),hasQualityIssue=qualityAttention(job,run,view),signature=fingerprint({progress,state:run.state,error:run.error,plan,hasQualityIssue});
    if(prior?.runtime.automation?.signature===signature&&!prior.runtime.automation.reconcileIssue)continue;
    r.store.transaction(s=>{r.ensure(s);let t=s.tasks.find(t=>t.runtime?.sourceKey===sourceKey);
     if(!t){const nodes=progress.steps.map((step,i)=>({id:'AUTO02.'+step.key,title:step.title,type:'系统',owner:w.owner,state:'pending',attempt:1,dependencies:i?['AUTO02.'+progress.steps[i-1].key]:[],slaHours:w.slaHours,history:[],evidence:[],fields:['job_id','run_id','stage','source_version','output_sha256','notification_receipt'],inputs:[],outputs:[],done:'根记录核验通过后自动推进；异常在原二创任务中处理。',entry:'进入二创工作台查看此自动计划',recovery:'保留原批次与成片版本，按失败环节修复后续跑。',evidenceKind:'automated_root'}));
      t=r.makeTask({user:w.configuredBy},{workflow:'02',title:job.product+' · '+job.name+' · '+run.date,sourceUrl:url,acceptance:'自动完成 '+progress.target+' 条合格成片，并核验云管家审核'+(plan.pushEnabled?'及已配置目标计划的真实回执。':'与回传凭证。'),product:job.product,options:{}},nodes,w.owner,w.manager,sourceKey);t.runtime.blueprint=w.blueprint||null;t.runtime.automation={jobId:job.id,runId:run.id};s.tasks.push(t);r.log(s,t,null,'automation_started',system,'已接入生产批次，系统自动记录流转，异常通知主责。');
     }
     const byKey=new Map(t.runtime.nodes.map(n=>[n.id,n]));requireFact(byKey.size===progress.steps.length&&progress.steps.every(step=>byKey.has('AUTO02.'+step.key)),'原批次固定流程与待核验步骤不一致，不能自动修改流程范围',409);
     const firstInvalid=progress.steps.findIndex(x=>!x.complete);
     if(t.runtime.state==='completed'&&firstInvalid>=0){t.runtime.state='running';t.status='in_progress';delete t.runtime.completedAt;r.log(s,t,null,'automation_evidence_changed',system,'原批次凭证发生变化，重新核验受影响节点。');}
     let upstream=true;for(let i=0;i<progress.steps.length;i++){const step=progress.steps[i],node=byKey.get('AUTO02.'+step.key);const valid=upstream&&step.complete;if(valid){if(node.state!=='completed'){node.startedAt??=r.iso();node.state='completed';node.completedAt=r.iso();node.durationSeconds=Math.max(0,(r.clock()-Date.parse(node.startedAt))/1000);node.evidence=[{url,reference:step.reference,version:run.id,source:'automation_root_verified',verifiedAt:r.iso(),summary:text(step.summary||step.title+' 已核验',500)}];r.log(s,t,node,'node_completed',system,node.evidence[0].summary,node.evidence);}}
      else{if(node.state==='completed'){node.history.push({attempt:node.attempt,state:node.state,evidence:node.evidence,completedAt:node.completedAt,note:'生产根凭证发生变化'});node.attempt++;node.evidence=[];delete node.completedAt;delete node.startedAt;delete node.dueAt;delete node.warnedAt;delete node.escalatedAt;}const becameReady=upstream&&node.state!=='ready';node.state=upstream?'ready':'pending';if(upstream&&!node.startedAt){node.startedAt=r.iso();node.dueAt=new Date(r.clock()+w.slaHours*3600000).toISOString();}if(becameReady){const event=r.log(s,t,node,'node_ready',system);r.notify(s,t,node,'ready',node.owner.number,event.id);}upstream=false;}}
     t.runtime.automation={...t.runtime.automation,signature,deliveryPlan:structuredClone(plan),progress:{target:progress.target,generated:progress.generated,approved:progress.approved,returned:progress.returned,reviewed:progress.reviewed},lastCheckedAt:r.iso()};delete t.runtime.automation.reconcileIssue;const watch=s.flowAutomationWatches?.find(x=>x.jobId===w.jobId);if(watch?.reconcileIssue?.runId===run.id)delete watch.reconcileIssue;
     const issue=progress.complete?'':progress.conflicts?'存在文件缺失、平台退回或审核状态冲突':text(run.error,500)||(hasQualityIssue?'原批次成片质量或内容复核需处理':plan.legacyTargetsUnverified?'原批次未保存平台目标范围，不能用当前计划配置替代原交付凭证':(['failed','awaiting_sources'].includes(run.state)?'原批次需补源或恢复':''));
     if(issue&&t.runtime.automation.issue!==issue){t.runtime.automation.issue=issue;const n=t.runtime.nodes.find(n=>n.state==='ready'),ev=r.log(s,t,n,'source_attention',system,issue);r.notify(s,t,n,'source_attention',w.owner.number,ev.id);}
     if(!issue)delete t.runtime.automation.issue;if(issue&&t.runtime.blueprint){const reason=run.state==='awaiting_sources'?'source_shortage':progress.conflicts||hasQualityIssue?'quality_issue':'';if(reason)r.blueprints?.triggerSource(s,t,reason);}
     if(progress.complete&&t.runtime.state!=='completed'){t.runtime.state='completed';t.status='completed';t.runtime.completedAt=r.iso();const ev=r.log(s,t,null,'flow_completed',system,'本批自动生产、审核和交付凭证均通过根记录核验。');r.notify(s,t,null,'completed',w.owner.number,ev.id);if(w.manager.number!==w.owner.number)r.notify(s,t,null,'completed',w.manager.number,ev.id);r.dispatchHandoff(s,t);}
     t.version++;return t;
    });
    }catch{this.recordFailure(w,run.id);}
   }
   }catch{this.recordFailure(w,null);}
  }
 }
}
