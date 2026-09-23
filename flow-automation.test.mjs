import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';import {FlowRuntime} from './flow-runtime.mjs';import {FlowAutomation,automationProgress} from './flow-automation.mjs';
import {FlowBlueprints} from './flow-blueprints.mjs';
const people=[{number:'M',name:'主管',center:'A',role:'manager',active:true},{number:'A',name:'制作',center:'A',role:'specialist',active:true}],access={enabled:true,canManage:true,modules:['material-workbench','cloud-manager'],user:people[0]};
const stageKeys=['source_selection','source_slicing','clip_calibration','clip_review','remix_generation','output_review'];
function data(){return {sources:[{id:'cloud',state:'connected'},{id:'remix',state:'connected'}],jobs:[{id:'job1',name:'隔离自动批次',product:'黑晶面膜',owner:'A',pushEnabled:false,runs:[{id:'run1',date:'2026-09-08',state:'completed',target:1,generated:1,startedAt:'2026-09-08T00:00:00Z',stages:stageKeys.map(key=>({key,state:'completed'}))}]}],renders:[{id:'render1',automation:{jobId:'job1',runId:'run1'},variants:[{id:'variant1',filePresent:true,sha256:'hash',duration:30,review:'approved',assessment:'passed',autoApproved:true,visualReview:{status:'passed',sha256:'hash',version:'test-version',confidence:.95,issues:[]},sourceClipsApproved:true,returnVerified:true,cloudReview:{status:'approved'},receipts:[]}]}]};}
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'auto-flow-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new WorkflowStore(join(dir,'tasks.json'));const runtime=new FlowRuntime(store,{people:()=>people,clock:()=>Date.parse('2026-09-08T01:00:00Z')});const view=data();return {store,runtime,view,auto:new FlowAutomation(runtime,{view:()=>view})};}
test('待办概览为自动成片检查返回中文标题，保持原批次编号和版本',t=>{const f=fixture(t);f.view.renders[0].variants[0].assessment='review_required';f.auto.configure(access,{jobId:'job1',manager:'M'},'inbox-title-001');const before=JSON.stringify(f.store.read()),task=f.store.read().tasks[0];const overview=f.runtime.overview(access).tasks.find(x=>x.id===task.id),node=overview.nodes.find(n=>n.id==='AUTO02.output_review');assert.equal(node.title,'成片自动检查');assert.equal(node.state,task.runtime.nodes.find(n=>n.id===node.id).state);assert.equal(overview.version,task.version);assert.equal(JSON.stringify(f.store.read()),before);});
test('已生成不会冒充回传和审核已闭环',()=>{const view=data();view.renders[0].variants[0].returnVerified=false;const p=automationProgress(view.jobs[0],view.jobs[0].runs[0],view);assert.equal(p.generated,1);assert.equal(p.complete,false);assert.equal(p.returned,0);});
test('全批目标以及当前自动检查、文件和来源同时通过才完成',()=>{for(const change of [{filePresent:false},{assessment:'failed'},{sourceClipsApproved:false},{autoApproved:false},{visualReview:null},{visualReview:{status:'passed',sha256:'other-file',version:'v1',confidence:.95,issues:[]}},{quarantined:true},{conflict:true}]){const view=data();Object.assign(view.renders[0].variants[0],change);assert.equal(automationProgress(view.jobs[0],view.jobs[0].runs[0],view).complete,false);}const view=data();view.jobs[0].runs[0].target=2;assert.equal(automationProgress(view.jobs[0],view.jobs[0].runs[0],view).complete,false);});
test('平台成功凭证必须覆盖本计划所有真实目标',()=>{const view=data(),j=view.jobs[0];j.pushEnabled=true;j.targets=[{account:'a',plan:'p'},{account:'a',plan:'p2'}];view.renders[0].variants[0].receipts=[{account:'a',plan:'p',verified:true}];assert.equal(automationProgress(j,j.runs[0],view).complete,false);view.renders[0].variants[0].receipts.push({account:'a',plan:'p2',verified:true});assert.equal(automationProgress(j,j.runs[0],view).complete,true);});
test('仅显式接入的计划创建实际批次跟进，重复核对和重启不会重复任务',t=>{const f=fixture(t);f.auto.reconcile();assert.equal(f.store.read().tasks.length,0);f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.auto.reconcile();new FlowAutomation(f.runtime,{view:()=>f.view}).reconcile();const tasks=f.store.read().tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].status,'completed');assert.equal(tasks[0].runtime.nodes.length,8);assert.ok(tasks[0].runtime.nodes.every(n=>n.evidence.length===1));assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='completed').length,2);assert.throws(()=>f.runtime.command(access,tasks[0].id,'complete',{expectedVersion:tasks[0].version},'manual-001'),e=>e.status===409);});
test('原凭证失效会重开核验并只通知一次，原历史交付保留',t=>{const f=fixture(t);f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.view.renders[0].variants[0].conflict=true;f.auto.reconcile();f.auto.reconcile();let task=f.store.read().tasks[0];assert.equal(task.status,'in_progress');assert.ok(task.runtime.nodes.find(n=>n.id==='AUTO02.output_review').history.length);assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='source_attention').length,1);assert.ok(task.runtime.nodes.find(n=>n.state==='ready').dueAt);f.view.renders[0].variants[0].conflict=false;f.auto.reconcile();assert.equal(f.store.read().tasks[0].status,'completed');});
test('根数据断开不把旧快照作为自动完成凭证',t=>{const f=fixture(t);f.view.renders=[];f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.view.renders=data().renders;f.view.sources[0].state='unavailable';f.auto.reconcile();assert.equal(f.store.read().tasks[0].status,'in_progress');});
test('暂停新增跟进后既有批次继续核验且不创建新批次',t=>{const f=fixture(t);f.view.renders=[];f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.auto.configure(access,{jobId:'job1',manager:'M',enabled:false},'watch-002');f.view.renders=data().renders;f.view.jobs[0].runs.unshift({...f.view.jobs[0].runs[0],id:'run2',startedAt:'2026-09-08T02:00:00Z'});f.auto.reconcile();assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().tasks[0].status,'completed');});
test('已排除的不合格备用片段不会阻断合格目标批次，硬失败仍阻断',()=>{const v=data(),j=v.jobs[0],run=j.runs[0];run.stages[3].state='partial';assert.equal(automationProgress(j,run,v).complete,true);run.stages[3].state='failed';assert.equal(automationProgress(j,run,v).complete,false);});
test('原计划后来开启推送只影响新批次，既有批次的固定节点不扩展',t=>{const f=fixture(t);f.view.renders[0].variants[0].returnVerified=false;f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');const old=f.store.read().tasks[0],j=f.view.jobs[0];j.pushEnabled=true;j.targets=[{account:'a',plan:'p'}];j.runs.unshift({...j.runs[0],id:'run2',startedAt:'2026-09-08T02:00:00Z'});f.view.renders[0].variants[0].returnVerified=true;assert.doesNotThrow(()=>f.auto.reconcile());const tasks=f.store.read().tasks,original=tasks.find(x=>x.id===old.id),next=tasks.find(x=>x.runtime.automation.runId==='run2');assert.equal(original.runtime.nodes.length,8);assert.equal(original.runtime.state,'completed');assert.deepEqual(original.runtime.automation.deliveryPlan,{pushEnabled:false,targets:[],target:1});assert.equal(next.runtime.nodes.length,9);assert.equal(next.runtime.state,'running');assert.deepEqual(next.runtime.automation.deliveryPlan.targets,[{account:'a',plan:'p'}]);});
test('关闭推送或更换目标不绕过原批次固定的目标回执',t=>{const f=fixture(t),j=f.view.jobs[0];j.pushEnabled=true;j.targets=[{account:'a',plan:'original'}];f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');j.pushEnabled=false;j.targets=[{account:'a',plan:'replacement'}];f.view.renders[0].variants[0].receipts=[{account:'a',plan:'replacement',verified:true}];f.auto.reconcile();let row=f.store.read().tasks[0];assert.equal(row.runtime.nodes.length,9);assert.equal(row.runtime.state,'running');assert.equal(row.runtime.nodes.find(n=>n.id==='AUTO02.platform_receipt').state,'ready');f.view.renders[0].variants[0].receipts.push({account:'a',plan:'original',verified:true});f.auto.reconcile();assert.equal(f.store.read().tasks[0].runtime.state,'completed');});
test('旧版未保存推送范围的批次不擅自采用当前目标',t=>{const f=fixture(t),j=f.view.jobs[0];j.pushEnabled=true;j.targets=[{account:'a',plan:'p'}];f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.store.transaction(s=>{delete s.tasks[0].runtime.automation.deliveryPlan;return true;});f.view.renders[0].variants[0].receipts=[{account:'a',plan:'p',verified:true}];f.auto.reconcile();const row=f.store.read().tasks[0];assert.equal(row.runtime.nodes.length,9);assert.equal(row.runtime.state,'running');assert.deepEqual(row.runtime.automation.deliveryPlan.targets,[]);assert.match(row.runtime.automation.issue,/未保存平台目标范围/);});
test('内容复核失败按照已发布质量分支派发一次下游任务',t=>{const f=fixture(t);f.runtime.blueprints=new FlowBlueprints(f.runtime);const b=f.runtime.blueprints,d=b.default(access);d.moduleOrder=['02','03'];d.branches=[{after:'02',next:'03',when:'quality_issue'}];b.save(access,{config:d,expectedVersion:0},'publish-001',{publish:true});const run=f.view.jobs[0].runs[0],v=f.view.renders[0].variants[0];run.state='awaiting_review';v.review='changes_requested';v.assessment='review_required';v.autoApproved=false;v.visualReview={...v.visualReview,status:'review_required',issues:[{summary:'画面与口播明显不一致'}]};f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.auto.reconcile();const tasks=f.store.read().tasks,parent=tasks.find(x=>x.runtime.automation);assert.equal(tasks.length,2);assert.equal(parent.runtime.state,'running');assert.ok(parent.runtime.blueprintTriggers['source:quality_issue'].taskId);assert.equal(tasks.find(x=>!x.runtime.automation).workflow,'03');assert.equal(f.store.read().flowEvents.filter(e=>e.action==='data_branch_triggered').length,1);});
test('质量状态变化即使尚未改变合格计数也会触发根数据规则',t=>{const f=fixture(t);f.runtime.blueprints=new FlowBlueprints(f.runtime);const d=f.runtime.blueprints.default(access);d.moduleOrder=['02','03'];d.branches=[{after:'02',next:'03',when:'quality_issue'}];f.runtime.blueprints.save(access,{config:d,expectedVersion:0},'publish-001',{publish:true});const v=f.view.renders[0].variants[0];v.review='pending';v.assessment=null;v.autoApproved=false;v.visualReview=null;f.view.jobs[0].runs[0].state='generating';f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');assert.equal(f.store.read().tasks.length,1);v.assessment='failed';f.auto.reconcile();assert.equal(f.store.read().tasks.length,2);});
test('按稳定节点键写入凭证，存储数组顺序不改变证据归属',t=>{const f=fixture(t);f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.store.transaction(s=>{s.tasks[0].runtime.nodes.reverse();return true;});f.view.renders[0].variants[0].returnVerified=false;f.auto.reconcile();let row=f.store.read().tasks[0];assert.equal(row.runtime.nodes.find(n=>n.id==='AUTO02.material_center_return').state,'ready');assert.equal(row.runtime.nodes.find(n=>n.id==='AUTO02.source_selection').state,'completed');f.view.renders[0].variants[0].returnVerified=true;f.auto.reconcile();row=f.store.read().tasks[0];assert.ok(row.runtime.nodes.every(n=>n.evidence[0].reference==='run1:'+n.id.slice('AUTO02.'.length)));});
test('单批次步骤异常不会阻断其他批次核验且告警不重复',t=>{const f=fixture(t);f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-001');f.store.transaction(s=>{s.tasks[0].runtime.nodes[0].id='AUTO02.invalid';return true;});const j=f.view.jobs[0];j.runs[0].error='原批次根记录已变化';j.runs.push({...j.runs[0],id:'run2',startedAt:'2026-09-08T02:00:00Z',error:''});f.view.renders.push({...structuredClone(f.view.renders[0]),id:'render2',automation:{jobId:'job1',runId:'run2'}});assert.doesNotThrow(()=>f.auto.reconcile());assert.doesNotThrow(()=>f.auto.reconcile());let rows=f.store.read().tasks;assert.ok(rows.find(x=>x.runtime.automation.runId==='run1').runtime.automation.reconcileIssue);assert.equal(rows.find(x=>x.runtime.automation.runId==='run2').runtime.state,'completed');assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='source_attention').length,1);f.store.transaction(s=>{s.tasks.find(x=>x.runtime.automation.runId==='run1').runtime.nodes[0].id='AUTO02.source_selection';return true;});f.auto.reconcile();assert.equal(f.store.read().tasks.find(x=>x.runtime.automation.runId==='run1').runtime.automation.reconcileIssue,undefined);});

function waterShortage(view){
 const job=view.jobs[0],run=job.runs[0];job.state='paused';job.product='隐形水润面膜';
 Object.assign(run,{state:'awaiting_sources',target:10,generated:0,error:'以下框架位缺少审核通过的切片：痛点/场景'});
 run.stages=[...stageKeys.slice(0,4).map(key=>({key,state:'completed',total:0,passed:0,summary:'无新增素材，检查已有切片池'})),
  {key:'remix_generation',state:'blocked',total:10,passed:0,summary:'合格切片或不同开头不足，补源后续跑'},
  {key:'output_review',state:'partial',total:48,passed:0,summary:'已有48条不合格成片被退回'}];
 view.renders[0].variants=Array.from({length:48},(_,i)=>({...data().renders[0].variants[0],id:'rejected-'+i,sha256:'rejected-'+i,review:'changes_requested',assessment:'failed',autoApproved:false}));
 return {job,run};
}
test('真实水润形态：缺源阻断且48条旧退回文件不能把混剪标记完成',()=>{
 const view=data(),{job,run}=waterShortage(view),p=automationProgress(job,run,view);
 assert.equal(p.generated,0);assert.equal(p.complete,false);
 assert.equal(p.steps.find(s=>!s.complete).key,'remix_generation');
 assert.ok(p.steps.slice(0,4).every(s=>s.complete),'明确完成的0新增检查保留原执行事实，不伪称库存充足');
 assert.match(p.steps.find(s=>s.key==='remix_generation').summary,/不足/);
});
test('真实黑晶形态：63切片待审优先处理，8条待终审真实成片可记为已生成',()=>{
 const view=data(),job=view.jobs[0],run=job.runs[0];Object.assign(run,{state:'awaiting_review',target:8,generated:8});
 run.stages.find(s=>s.key==='clip_review').state='needs_review';run.stages.find(s=>s.key==='output_review').state='needs_review';
 view.renders[0].variants=Array.from({length:8},(_,i)=>({...data().renders[0].variants[0],id:'pending-'+i,sha256:'pending-'+i,review:'pending',assessment:'passed',autoApproved:false,sourceClipsApproved:false,visualReview:null}));
 const p=automationProgress(job,run,view);
 assert.equal(p.generated,8);assert.equal(p.approved,0);assert.equal(p.steps.find(s=>!s.complete).key,'clip_review');
 assert.equal(p.steps.find(s=>s.key==='remix_generation').complete,true);
 assert.equal(p.steps.find(s=>s.key==='output_review').complete,false);
});
test('混剪需要根阶段明确完成，blocked/partial/缺阶段及整体待补源均不能完成',()=>{
 for(const state of ['blocked','partial','failed','pending',null]){
  const view=data(),run=view.jobs[0].runs[0];
  if(state===null)run.stages=run.stages.filter(s=>s.key!=='remix_generation');else run.stages.find(s=>s.key==='remix_generation').state=state;
  assert.equal(automationProgress(view.jobs[0],run,view).steps.find(s=>s.key==='remix_generation').complete,false,String(state));
 }
 const view=data(),run=view.jobs[0].runs[0];run.state='awaiting_sources';
 assert.equal(automationProgress(view.jobs[0],run,view).steps.find(s=>s.key==='remix_generation').complete,false);
});
test('保留部分产出不等于达到固定目标，重复同文件版本也不补足数量',()=>{
 const view=data(),job=view.jobs[0],run=job.runs[0];run.target=2;
 let p=automationProgress(job,run,view);assert.equal(p.generated,1);assert.equal(p.steps.find(s=>s.key==='remix_generation').complete,false);
 view.renders[0].variants.push({...view.renders[0].variants[0],id:'duplicate-same-file'});
 p=automationProgress(job,run,view);assert.equal(p.generated,1);assert.equal(p.approved,1);assert.equal(p.complete,false);
});
test('隔离失败无效文件不计生成目标，等待人工审核的有效版本仍保留',()=>{
 for(const change of [{filePresent:false},{sha256:''},{duration:0},{duration:Infinity},{quarantined:true},{conflict:true},{assessment:'failed'},{review:'changes_requested'},{visualReview:{status:'failed'}},{visualReview:{status:'rejected'}}]){
  const view=data();Object.assign(view.renders[0].variants[0],change);const p=automationProgress(view.jobs[0],view.jobs[0].runs[0],view);
  assert.equal(p.generated,0);assert.equal(p.steps.find(s=>s.key==='remix_generation').complete,false);
 }
 const view=data();Object.assign(view.renders[0].variants[0],{review:'pending',assessment:'review_required',visualReview:{status:'review_required'}});
 const p=automationProgress(view.jobs[0],view.jobs[0].runs[0],view);assert.equal(p.generated,1);assert.equal(p.steps.find(s=>s.key==='remix_generation').complete,true);assert.equal(p.complete,false);
});
test('整体仍待补源时不以旧合格片把partial上游自动抹成完成',()=>{
 const view=data(),job=view.jobs[0],run=job.runs[0];run.state='awaiting_sources';run.stages[0].state='partial';
 const p=automationProgress(job,run,view);assert.equal(p.steps[0].complete,false);assert.equal(p.steps.find(s=>s.key==='remix_generation').complete,false);
 run.stages[0].state='blocked';assert.equal(automationProgress(job,run,view).steps[0].complete,false);
});
test('修复后原误推进任务回到混剪节点，沿用原ID/版本蓝图且不重发相同缺源通知',t=>{
 const f=fixture(t),{job}=waterShortage(f.view),originalJob=structuredClone(job);
 f.auto.configure(access,{jobId:'job1',manager:'M'},'watch-water-001');
 const original=f.store.read().tasks[0];
 f.store.transaction(s=>{const row=s.tasks[0];row.runtime.blueprint={version:1};row.runtime.automation.signature='before-semantic-fix';
  const generation=row.runtime.nodes.find(n=>n.id==='AUTO02.remix_generation');generation.state='completed';generation.completedAt=f.runtime.iso();generation.evidence=[{reference:'run1:remix_generation',source:'old-file-existence'}];
  row.runtime.nodes.find(n=>n.id==='AUTO02.output_review').state='ready';return true;});
 f.auto.reconcile();f.auto.reconcile();const rows=f.store.read().tasks,row=rows[0];
 assert.equal(rows.length,1);assert.equal(row.id,original.id);assert.equal(row.runtime.blueprint.version,1);
 assert.equal(row.runtime.nodes.find(n=>n.state==='ready').id,'AUTO02.remix_generation');
 assert.equal(row.runtime.nodes.find(n=>n.id==='AUTO02.output_review').state,'pending');
 assert.equal(row.runtime.nodes.find(n=>n.id==='AUTO02.remix_generation').history.length,1);
 assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='source_attention').length,1);
 assert.deepEqual(job,originalJob);
});

test('automatic task and evidence use integrated remix entry without changing root job',t=>{
 const f=fixture(t),before=JSON.stringify(f.view);
 f.auto=new FlowAutomation(f.runtime,{view:()=>f.view},{env:{HUB_INTEGRATED_MODE:'1',FLOW_PUBLIC_URL:'https://example.invalid/deployed/hub/workflow-panorama/'}});
 f.auto.configure(access,{jobId:'job1',manager:'M'},'new-origin-watch');
 const rows=f.store.read().tasks;
 assert.equal(rows.length,1);assert.equal(rows[0].sourceUrl,'https://example.invalid/deployed/hub/#module=material-workbench');
 assert.ok(rows[0].runtime.nodes.every(n=>n.evidence[0].url===rows[0].sourceUrl));
 f.auto.reconcile();assert.equal(f.store.read().tasks.length,1);assert.equal(JSON.stringify(f.view),before);
});
