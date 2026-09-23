// Isolated backend fixtures only. These identities and receipts are not OA logins,
// real colleagues, real business acceptance, or external platform evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {FlowBlueprints} from './flow-blueprints.mjs';
import {catalog, graphFor, modules} from './flow-catalog.mjs';
import {resolvedCatalog,graphDetails} from './flow-model.mjs';
import {createFlowHandler} from './flow-http.mjs';
import {FlowEvidence} from './flow-evidence.mjs';

const allModules = Object.values(modules).filter(Boolean);
const reference = (version = 'v1') => ({url:'https://example.invalid/isolated-artifact/'+version, reference:'isolated-file-'+version, version});
const simpleBody = (extra = {}) => ({workflow:'02', mode:'simple', title:'隔离测试：单项交付', acceptance:'交付指定版本并由指定人员确认', owner:'QA-A', manager:'QA-M', reviewer:'QA-R', sourceUrl:'', product:'晶润紧致眼膜', ...extra});
// WorkflowStore timestamps every committed transaction, including idempotent
// command reads; compare every business field and each task's own timestamp.
const assertBusinessEqual = (actual, expected) => {
  const {updatedAt:actualStoreCommit, ...actualBusiness}=actual;
  const {updatedAt:expectedStoreCommit, ...expectedBusiness}=expected;
  assert.deepEqual(actualBusiness,expectedBusiness);
};

test('交错执行节点的展示环节保持实际顺序，不把原环节折叠成伪回路',()=>{
  const nodes=[['a','S1',[]],['b','S2',['a']],['c','S1',['b']],['d','S2',['c']]].map(([id,stageId,dependencies])=>({id,stageId,title:id,dependencies}));
  const detail=graphDetails(nodes,'00');
  assert.deepEqual(detail.stages.flatMap(s=>s.nodes),nodes.map(n=>n.id));
  assert.equal(new Set(detail.stages.map(s=>s.id)).size,4);
  const positions=new Map(detail.stages.map((s,i)=>[s.id,i]));
  const display=new Map(detail.nodes.map(n=>[n.id,n.displayStageId]));
  for(const edge of detail.edges)assert.ok(positions.get(display.get(edge.from))<positions.get(display.get(edge.to)));
});

function fixture(t) {
  const tempRoot = resolve(tmpdir());
  const dir = mkdtempSync(join(tempRoot, 'flow-usability-isolated-'));
  t.after(() => {assert.ok(resolve(dir).startsWith(tempRoot+sep)); rmSync(dir,{recursive:true,force:true});});
  const people = [
    {number:'QA-M',name:'隔离主管',role:'manager',center:'隔离中心'},
    {number:'QA-A',name:'隔离主责',role:'specialist',center:'隔离中心'},
    {number:'QA-R',name:'隔离审核',role:'specialist',center:'隔离中心'},
    {number:'QA-C',name:'隔离接收',role:'specialist',center:'隔离中心'},
    {number:'QA-N',name:'隔离无关人',role:'specialist',center:'隔离中心'},
    {number:'QA-X',name:'隔离异中心',role:'manager',center:'其他隔离中心'},
    {number:'QA-L',name:'隔离受限人',role:'specialist',center:'隔离中心',modules:['ai-first-creation']},
  ].map(p=>({active:true,modules:allModules,...p}));
  const access = (number='QA-M') => {const user=people.find(p=>p.number===number);return {enabled:true,canManage:user.role==='manager',department:false,modules:user.modules,user};};
  const store=new WorkflowStore(join(dir,'tasks.json'));
  let now=Date.parse('2026-09-09T00:00:00Z'), sequence=0;
  const runtime=new FlowRuntime(store,{people:()=>people,canNotify:n=>people.some(p=>p.number===n&&p.active),clock:()=>now});
  const blueprints=new FlowBlueprints(runtime);runtime.blueprints=blueprints;
  const key=()=> 'isolated-operation-'+(++sequence);
  const finish=(task,{who,nodeId,evidence,note='隔离 fixture：核对交付',operationKey}={})=>{
    const node=task.runtime.nodes.find(n=>nodeId?n.id===nodeId:n.state==='ready');
    const body={expectedVersion:task.version,nodeId:node.id,note};
    if(evidence!==undefined)body.evidence=evidence;
    return runtime.command(access(who||node.owner.number),task.id,'complete',body,operationKey||key());
  };
  const completeSimple=task=>{let current=task;while(current.runtime.state==='running'){const n=current.runtime.nodes.find(n=>n.state==='ready');current=finish(current,{evidence:n.ownerRule==='owner'?[reference()]:undefined});}return current;};
  const publish=(order,change=()=>{})=>{const config=blueprints.default(access());config.moduleOrder=order;config.modules=Object.fromEntries(order.map(f=>[f,config.modules[f]]));change(config);return blueprints.save(access(),{expectedVersion:blueprints.view(access()).draft.version,config},key(),{publish:true}).published;};
  return {dir,people,access,store,runtime,blueprints,key,finish,completeSimple,publish,advance:ms=>now+=ms};
}

test('简洁模式允许空来源和非双品；两节点由独立主责与审核人完成并记录实际执行人',t=>{
  const f=fixture(t);let task=f.runtime.create(f.access(),simpleBody(),f.key());
  assert.equal(task.sourceUrl,'');assert.equal(task.runtime.product,'晶润紧致眼膜');
  assert.deepEqual(task.runtime.nodes.map(n=>[n.ownerRule,n.owner.number,n.state]),[['owner','QA-A','ready'],['reviewer','QA-R','pending']]);
  task=f.finish(task,{evidence:[reference()]});assert.equal(task.runtime.state,'running');
  task=f.finish(task);assert.equal(task.runtime.state,'completed');
  assert.deepEqual(task.runtime.nodes.map(n=>n.completedBy.number),['QA-A','QA-R']);
  assert.equal(task.runtime.nodes[1].evidence[0].url,reference().url);
  assert.deepEqual(task.runtime.nodes[1].evidence[0].reusedFrom,{nodeId:task.runtime.nodes[0].id,attempt:1});
  assert.ok(task.runtime.nodes.every(n=>n.evidence.every(e=>e.source==='human_attested')));
  assert.deepEqual(task.flowEvents.filter(e=>e.action==='node_completed').map(e=>e.actor.number),['QA-A','QA-R']);
});

test('未指定审核人时使用任务主管；未指定接收人不生成第三节点',t=>{
  const f=fixture(t),body=simpleBody();delete body.reviewer;
  const task=f.runtime.create(f.access(),body,f.key());
  assert.equal(task.runtime.nodes.length,2);assert.equal(task.runtime.nodes[1].owner.number,'QA-M');
});

test('本人办理同一简洁任务时只向本人排队通知，不把同一执行人伪装成独立审核',t=>{
  const f=fixture(t),task=f.completeSimple(f.runtime.create(f.access(),simpleBody({owner:'QA-M',reviewer:'QA-M',receiver:'QA-M'}),f.key()));
  assert.deepEqual(task.runtime.nodes.map(n=>n.completedBy.number),['QA-M','QA-M','QA-M']);
  assert.ok(task.notifications.length>0&&task.notifications.every(n=>n.recipient==='QA-M'));
  assert.ok(task.notifications.every(n=>n.state==='ready'&&n.messageId===null));
  assert.ok(task.runtime.nodes.flatMap(n=>n.evidence).every(e=>e.source==='human_attested'));
});

test('指定接收人的三节点必须等真实模拟接收角色确认，接收沿用审核证据并保留来源',t=>{
  const f=fixture(t);let task=f.runtime.create(f.access(),simpleBody({receiver:'QA-C'}),f.key());
  task=f.finish(task,{evidence:[reference()]});task=f.finish(task);
  assert.equal(task.status,'in_progress');assert.equal(task.runtime.nodes[2].state,'ready');
  const before=structuredClone(f.store.read());
  assert.throws(()=>f.finish(task,{who:'QA-R'}),e=>e.status===403);assert.deepEqual(f.store.read(),before);
  task=f.finish(task);assert.equal(task.status,'completed');
  assert.equal(task.runtime.nodes[2].completedBy.number,'QA-C');
  assert.equal(task.runtime.nodes[2].evidence[0].reference,'isolated-file-v1');
  assert.equal(task.runtime.nodes[2].evidence[0].reusedFrom.nodeId,task.runtime.nodes[1].id);
});

test('WORK 没有文件或链接不能完成，后续审核也不能越过未完成工作',t=>{
  const f=fixture(t),task=f.runtime.create(f.access(),simpleBody(),f.key()),before=structuredClone(f.store.read());
  for(const evidence of [undefined,[],[{reference:'only-a-text-label',version:'v1'}]])
    assert.throws(()=>f.finish(task,{evidence}),e=>e.status===400);
  assert.throws(()=>f.finish(task,{nodeId:task.runtime.nodes[1].id}),e=>e.status===409);
  assert.deepEqual(f.store.read(),before);
});

test('审核退回原 WORK，原证据、审核动作和任务 ID 保留，重做只用新版证据',t=>{
  const f=fixture(t);let task=f.runtime.create(f.access(),simpleBody(),f.key());const originalId=task.id;
  task=f.finish(task,{evidence:[reference()]});
  const body={expectedVersion:task.version,nodeId:task.runtime.nodes[1].id,targetNodeId:task.runtime.nodes[0].id,note:'隔离 fixture：版本需要补正'},key=f.key();
  task=f.runtime.command(f.access('QA-R'),task.id,'return',body,key);
  const afterReturn=structuredClone(f.store.read());
  assert.equal(f.runtime.command(f.access('QA-R'),task.id,'return',body,key).version,task.version);
  assertBusinessEqual(f.store.read(),afterReturn);
  assert.equal(task.runtime.nodes[0].attempt,2);assert.equal(task.runtime.nodes[0].history[0].evidence[0].reference,'isolated-file-v1');
  assert.deepEqual(task.runtime.nodes.map(n=>n.state),['ready','pending']);
  task=f.finish(task,{evidence:[reference('v2')]});task=f.finish(task);
  assert.equal(task.id,originalId);assert.equal(f.store.read().tasks.length,1);
  assert.equal(task.runtime.nodes[1].evidence[0].reference,'isolated-file-v2');
  assert.equal(task.runtime.nodes[0].history[0].evidence[0].reference,'isolated-file-v1');
  assert.equal(task.flowEvents.filter(e=>e.action==='node_returned').length,1);
});

test('接收人退回已审核成果时两步旧证据进入历史，原独立审核执行人事件不丢',t=>{
  const f=fixture(t);let task=f.runtime.create(f.access(),simpleBody({receiver:'QA-C'}),f.key());
  task=f.finish(task,{evidence:[reference()]});task=f.finish(task);
  task=f.runtime.command(f.access('QA-C'),task.id,'return',{expectedVersion:task.version,nodeId:task.runtime.nodes[2].id,targetNodeId:task.runtime.nodes[0].id,note:'隔离 fixture：接收规格不符'},f.key());
  assert.deepEqual(task.runtime.nodes.map(n=>n.state),['ready','pending','pending']);
  assert.equal(task.runtime.nodes[1].history[0].evidence[0].reference,'isolated-file-v1');
  assert.equal(task.flowEvents.find(e=>e.action==='node_completed'&&e.nodeId===task.runtime.nodes[1].id).actor.number,'QA-R');
  assert.ok(task.runtime.nodes.every(n=>n.attempt===2&&n.evidence.length===0));
});

test('创建和完成幂等重放无额外任务、消息或事件；内容冲突和陈旧版本拒绝',t=>{
  const f=fixture(t),body=simpleBody(),createKey=f.key();let task=f.runtime.create(f.access(),body,createKey);
  const created=structuredClone(f.store.read());assert.equal(f.runtime.create(f.access(),body,createKey).id,task.id);assert.deepEqual(f.store.read(),created);
  assert.throws(()=>f.runtime.create(f.access(),{...body,title:'不同内容'},createKey),e=>e.status===409);
  const completion={expectedVersion:task.version,nodeId:task.runtime.nodes[0].id,note:'隔离交付',evidence:[reference()]},key=f.key();
  task=f.runtime.command(f.access('QA-A'),task.id,'complete',completion,key);const advanced=structuredClone(f.store.read());
  f.runtime.command(f.access('QA-A'),task.id,'complete',completion,key);assertBusinessEqual(f.store.read(),advanced);
  assert.throws(()=>f.runtime.command(f.access('QA-A'),task.id,'complete',{...completion,note:'改变操作'},key),e=>e.status===409);
  assert.throws(()=>f.runtime.command(f.access('QA-R'),task.id,'complete',{expectedVersion:1,nodeId:task.runtime.nodes[1].id,note:'过期页面'},f.key()),e=>e.status===409);
  assertBusinessEqual(f.store.read(),advanced);
});

test('参与审核者不能替主责办理，无关人和异中心不可读，专员不能自行发起',t=>{
  const f=fixture(t),task=f.runtime.create(f.access(),simpleBody(),f.key()),before=structuredClone(f.store.read());
  assert.throws(()=>f.finish(task,{who:'QA-R',evidence:[reference()]}),e=>e.status===403);
  for(const who of ['QA-N','QA-X'])assert.throws(()=>f.runtime.get(f.access(who),task.id),e=>e.status===404);
  assert.throws(()=>f.runtime.create(f.access('QA-A'),simpleBody(),f.key()),e=>e.status===403);
  assert.deepEqual(f.store.read(),before);
});

test('无模块权限者不能在创建时被指派为主责、审核人或接收人',t=>{
  const f=fixture(t),before=structuredClone(f.store.read());
  for(const slot of ['owner','reviewer','receiver']){
    assert.throws(()=>f.runtime.create(f.access(),simpleBody({[slot]:'QA-L'}),f.key()),e=>e.status===403&&e.message.includes('模块'));
    assert.deepEqual(f.store.read(),before);
  }
});

test('运行中重分配给无模块人员原子拒绝，已分配人员模块撤销后也不能完成',t=>{
  const f=fixture(t),task=f.runtime.create(f.access(),simpleBody(),f.key()),before=structuredClone(f.store.read());
  assert.throws(()=>f.runtime.command(f.access(),task.id,'assign',{expectedVersion:task.version,nodeId:task.runtime.nodes[0].id,owner:'QA-L',note:'隔离权限测试'},f.key()),e=>e.status===403);
  assert.deepEqual(f.store.read(),before);
  f.people.find(p=>p.number==='QA-A').modules=[];
  assert.throws(()=>f.finish(task,{evidence:[reference()]}),e=>e.status===403||e.status===404);
  assert.deepEqual(f.store.read(),before);
});

test('简洁模式不能替代人事独立授权流程；未带 mode 的旧 API 仍是标准图',t=>{
  const f=fixture(t);
  assert.throws(()=>f.runtime.create(f.access(),simpleBody({workflow:'06',options:{stage:'W06.S4'}}),f.key()),e=>e.status===400);
  const body=simpleBody({workflow:'00'});delete body.mode;
  const task=f.runtime.create(f.access(),body,f.key());
  assert.equal(task.runtime.mode,'standard');assert.deepEqual(task.runtime.nodes.map(n=>n.id),graphFor('00').map(n=>n.id));
  assert.ok(task.runtime.nodes.every(n=>!n.canReuseUpstreamEvidence));
});

test('旧任务重启不迁移到简洁模式，新发布配置不改旧节点或历史',t=>{
  const f=fixture(t),body=simpleBody({workflow:'00'});delete body.mode;
  let task=f.runtime.create(f.access(),body,f.key());task=f.finish(task,{evidence:[reference()]});
  f.store.transaction(s=>{const old=s.tasks.find(t=>t.id===task.id);delete old.runtime.mode;delete old.runtime.templateVersion;return true;});
  const old=structuredClone(f.store.read().tasks[0]);
  f.publish(['02','00'],c=>{c.defaultRoute=true;});
  const restarted=new FlowRuntime(new WorkflowStore(join(f.dir,'tasks.json')),{people:()=>f.people});
  const read=restarted.get(f.access(),task.id);assert.equal(read.runtime.mode,undefined);assert.deepEqual(f.store.read().tasks[0],old);
  assert.equal(read.runtime.nodes[0].state,'completed');assert.equal(read.runtime.nodes.length,10);
  f.runtime.create(f.access(),simpleBody(),f.key());assert.deepEqual(f.store.read().tasks.find(x=>x.id===old.id),old);
});

test('发布节点顺序在 catalog、预览模型与新标准实例的依赖和阶段顺序一致',t=>{
  const f=fixture(t),custom=catalog.stages.filter(s=>s.flow==='00').toReversed().flatMap(s=>s.steps.map(n=>n.id));
  const revision=f.publish(['02','00','01'],c=>{c.modules['00'].nodeOrder=custom;});
  const rendered=resolvedCatalog(f.access(),revision),flow=rendered.flows.find(x=>x.id==='00');
  const task=f.runtime.create(f.access(),{...simpleBody({workflow:'00'}),mode:'standard'},f.key());
  assert.deepEqual(flow.resolvedNodes.map(n=>n.id),custom);
  assert.deepEqual(task.runtime.nodes.map(n=>({id:n.id,dependencies:n.dependencies})),flow.resolvedNodes.map(n=>({id:n.id,dependencies:n.dependencies})));
  assert.deepEqual(rendered.stages.filter(s=>s.flow==='00').flatMap(s=>s.steps.map(n=>n.id)),custom);
  assert.deepEqual(flow.resolvedEdges,custom.slice(1).map((id,i)=>({from:custom[i],to:id,type:'dependency',enabled:true})));
  assert.equal(task.runtime.blueprint.version,revision.version);
});

test('图上只有已开启的顺序和条件才标自动，静态关联线不会冒称自动派发',t=>{
  const f=fixture(t),revision=f.publish(['02','00','01'],c=>{c.branches=[{after:'02',next:'01',when:'black_mask',enabled:true},{after:'02',next:'00',when:'water_mask',enabled:false}];});
  const rendered=resolvedCatalog(f.access(),revision);
  assert.ok(rendered.moduleEdges.filter(e=>e.type==='sequence').every(e=>e.enabled===false));
  assert.equal(rendered.moduleEdges.find(e=>e.type==='condition'&&e.condition==='black_mask').enabled,true);
  assert.equal(rendered.moduleEdges.find(e=>e.type==='condition'&&e.condition==='water_mask').enabled,false);
  assert.ok(rendered.moduleEdges.filter(e=>e.type==='reference').every(e=>e.enabled===false));
  const task=f.completeSimple(f.runtime.create(f.access(),simpleBody(),f.key()));
  assert.equal(task.runtime.handoff,undefined);assert.equal(f.store.read().tasks.length,1);
  const restricted=resolvedCatalog(f.access('QA-L'),revision),visible=new Set(restricted.flows.map(x=>x.id));
  assert.ok(restricted.moduleEdges.every(e=>visible.has(e.from)&&visible.has(e.to)));
});

test('简洁流程忽略标准 nodeOrder，自动跨模块交接沿用原版本、简洁模式和独立审核人',t=>{
  const f=fixture(t);f.publish(['02','01'],c=>{c.defaultRoute=true;c.modules['02'].nodeOrder=graphFor('02').map(n=>n.id);});
  let task=f.runtime.create(f.access(),simpleBody(),f.key());assert.equal(task.runtime.nodes.length,2);
  f.publish(['02','00'],c=>{c.defaultRoute=true;});
  task=f.completeSimple(task);assert.equal(task.runtime.handoff,undefined);task=f.runtime.get(f.access(),task.id);assert.equal(task.runtime.handoff.state,'dispatched');
  const child=f.runtime.get(f.access(),task.runtime.handoff.taskId);
  assert.equal(child.workflow,'01');assert.equal(child.runtime.mode,'simple');assert.equal(child.runtime.nodes.length,2);
  assert.equal(child.runtime.nodes[1].owner.number,'QA-R');assert.equal(child.runtime.product,'晶润紧致眼膜');
  assert.equal(child.runtime.blueprint.version,1);assert.equal(f.blueprints.active(f.access()).version,2);
  assert.equal(child.runtime.parentTaskId,task.id);assert.ok(child.runtime.handoffEvidence.some(e=>e.reference==='isolated-file-v1'));
});

test('create 原子交接草案校验失败不留下上游、幂等记录或通知',t=>{
  const f=fixture(t),before=structuredClone(f.store.read());
  const badChildren=[simpleBody({workflow:'06'}),simpleBody({owner:'QA-L'}),simpleBody({receiver:'QA-X'}),simpleBody({handoff:simpleBody()})];
  for(const handoff of badChildren){
    assert.throws(()=>f.runtime.create(f.access(),simpleBody({workflow:'00',handoff}),f.key()));
    assert.deepEqual(f.store.read(),before);
  }
});

test('create 原子保存交接并仅在完成后派下游，响应丢失重放和重启不复制任务或消息',t=>{
  const f=fixture(t),body=simpleBody({workflow:'00',handoff:simpleBody({receiver:'QA-C'})}),key=f.key();
  let task=f.runtime.create(f.access(),body,key);assert.equal(f.store.read().tasks.length,1);
  assert.equal(task.runtime.handoff.state,'waiting');assert.equal(task.runtime.handoff.draft,undefined);
  assert.ok(f.store.read().tasks[0].runtime.handoff.draft);
  const created=structuredClone(f.store.read());assert.equal(f.runtime.create(f.access(),body,key).id,task.id);assert.deepEqual(f.store.read(),created);
  task=f.finish(task,{evidence:[reference()]});
  const review={expectedVersion:task.version,nodeId:task.runtime.nodes[1].id,note:'隔离审核通过'},reviewKey=f.key();
  task=f.runtime.command(f.access('QA-R'),task.id,'complete',review,reviewKey);
  const dispatched=structuredClone(f.store.read());assert.equal(dispatched.tasks.length,2);
  f.runtime.command(f.access('QA-R'),task.id,'complete',review,reviewKey);assertBusinessEqual(f.store.read(),dispatched);
  const restarted=new FlowRuntime(f.store,{people:()=>f.people});
  assert.equal(task.runtime.handoff,undefined);task=restarted.get(f.access(),task.id);
  const child=restarted.get(f.access(),task.runtime.handoff.taskId);
  assert.equal(child.runtime.mode,'simple');assert.equal(child.runtime.nodes.length,3);assert.equal(child.runtime.parentTaskId,task.id);
  assert.equal(child.notifications.filter(n=>n.kind==='ready').length,1);
  assertBusinessEqual(f.store.read(),dispatched);
});

test('下游人员权限在上游执行中被撤销时保留完成上游与待处理交接，不派无法办理的下游',t=>{
  const f=fixture(t);let task=f.runtime.create(f.access(),simpleBody({workflow:'00',handoff:simpleBody({receiver:'QA-C'})}),f.key());
  f.people.find(p=>p.number==='QA-C').modules=[];
  task=f.completeSimple(task);assert.equal(task.runtime.state,'completed');assert.equal(task.runtime.handoff,undefined);task=f.runtime.get(f.access(),task.id);assert.equal(task.runtime.handoff.state,'attention');
  assert.equal(f.store.read().tasks.length,1);assert.equal(task.notifications.filter(n=>n.kind==='handoff_blocked').length,1);
  assert.ok(task.runtime.nodes[0].evidence.some(e=>e.reference==='isolated-file-v1'));
});

function httpFixture(f) {
  return async(method,path,{body={},who='QA-M',auth=200,preview=false,key=f.key(),writeAccounts=null}={})=>{
    let result;
    const handler=createFlowHandler({runtime:f.runtime,blueprints:f.blueprints,sources:{},notifier:{status:()=>({enabled:false})},writeAccounts,
      evidenceReader:new FlowEvidence({sources:{},readCloud:async()=>{throw Error('This isolated simple-flow test must not fetch or invent a business receipt');}}),
      currentSession:async()=>({status:auth,payload:{isolatedFixture:true}}),accessFor:()=>f.access(who),previewFor:()=>({active:preview}),
      readJson:async()=>body,sendJson:(_res,status,body)=>{result={status,body};}});
    await handler({method,headers:{'x-flow-request':'1','content-type':'application/json',host:'isolated.invalid',origin:'https://isolated.invalid','idempotency-key':key}}, {},new URL('https://isolated.invalid/api/flows/'+path));
    return result;
  };
}

test('候选写入范围只按真实账号白名单限制，生产未配置时保留原权限',async t=>{
 const f=fixture(t),call=httpFixture(f),before=structuredClone(f.store.read());
 const rejected=await call('POST','runs',{body:simpleBody(),writeAccounts:['QA-X']});assert.equal(rejected.status,403);assert.deepEqual(f.store.read(),before);
 const preview=await call('POST','preview',{body:simpleBody(),writeAccounts:['QA-X']});assert.equal(preview.status,200);
 const accepted=await call('POST','runs',{body:simpleBody(),writeAccounts:['QA-M']});assert.equal(accepted.status,201);
});

test('HTTP 预览和创建得到同一两节点图，主责交付后审核无重复附件也能完成',async t=>{
  const f=fixture(t),call=httpFixture(f),body=simpleBody();
  const preview=await call('POST','preview',{body});assert.equal(preview.status,200);assert.equal(preview.body.mode,'simple');
  let response=await call('POST','runs',{body});assert.equal(response.status,201);let task=response.body;
  assert.deepEqual(preview.body.nodes.map(n=>n.id),task.runtime.nodes.map(n=>n.id));
  response=await call('POST','runs/'+task.id+'/complete',{who:'QA-A',body:{expectedVersion:task.version,nodeId:task.runtime.nodes[0].id,note:'隔离上传结果',evidence:[reference()]}});assert.equal(response.status,200);task=response.body;
  response=await call('POST','runs/'+task.id+'/complete',{who:'QA-R',body:{expectedVersion:task.version,nodeId:task.runtime.nodes[1].id,note:'隔离独立审核'}});
  assert.equal(response.status,200);assert.equal(response.body.runtime.state,'completed');assert.equal(response.body.runtime.nodes[1].completedBy.number,'QA-R');
});

test('HTTP 鉴权、权限预览和原子交接拒绝均不留下草稿业务数据',async t=>{
  const f=fixture(t),call=httpFixture(f),before=structuredClone(f.store.read());
  for(const options of [{auth:401},{preview:true},{who:'QA-A'}]){const r=await call('POST','runs',{body:simpleBody(),...options});assert.ok([401,403].includes(r.status));assert.deepEqual(f.store.read(),before);}
  const r=await call('POST','runs',{body:simpleBody({workflow:'00',handoff:simpleBody({owner:'QA-L'})})});
  assert.equal(r.status,403);assert.deepEqual(f.store.read(),before);
});
