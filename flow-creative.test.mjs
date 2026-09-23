import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {FlowCreative,creativeProjection} from './flow-creative.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {createCreativeReader} from './flow-creative-reader.mjs';

const staff=[['A','作者','specialist'],['L','组长','manager'],['M','主管','manager']].map(([number,name,role])=>({number,name,role,center:'品牌中心',active:true,modules:['creative-hub','workflow-engine']}));
const access={enabled:true,canManage:true,department:false,user:staff[2],modules:['creative-hub','workflow-engine']};
const users=staff.map(p=>({id:'U'+p.number,employeeNo:p.number,active:true}));
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'creative-flow-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-09-23T00:00:00Z');const clock=()=>now;
 const store=new WorkflowStore(join(dir,'tasks.json')),runtime=new FlowRuntime(store,{people:()=>staff,clock});
 let row={id:'draft-1',title:'测试创意脚本',status:'pending_team_lead',creatorId:'UA',teamLeadReviewerId:'UL',supervisorReviewerId:'UM',currentReviewerId:'UL',version:1,updatedAt:new Date(now).toISOString()},actions=[];
 let missing=false,error=null,sourceUsers=users;
 const readSource=async()=>{if(error)throw error;return {records:missing?[]:[structuredClone(row)],users:sourceUsers,actionsByRecord:{'draft-1':structuredClone(actions)}};};
 const creative=new FlowCreative(runtime,{readSource,sourceUrl:()=> 'https://company.invalid/idea/'}),sent=[];
 const notifier=new FlowFeishu(store,{people:()=>staff,clock,env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_a',L:'ou_l',M:'ou_m'})},fetchImpl:async(url,opts)=>{
  if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture'});
  sent.push(JSON.parse(opts.body));return Response.json({code:0,data:{message_id:'om_'+sent.length}});
 }});
 return {store,runtime,creative,notifier,sent,create:()=>creative.configure(access,{headers:{}},{source:'idea',recordId:'draft-1',manager:'M'},'creative-attach-01'),sync:()=>creative.sync(access,{headers:{}}),
  change:(patch,action)=>{now+=1000;Object.assign(row,patch,{updatedAt:new Date(now).toISOString()});if(action)actions.push({id:'action-'+actions.length,draftId:row.id,action,stage:row.status,createdAt:row.updatedAt});},
  action:action=>actions.push({id:'action-'+actions.length,draftId:row.id,action,stage:row.status,createdAt:row.updatedAt}),advance:ms=>now+=ms,missing:()=>missing=true,restore:()=>missing=false,users:value=>sourceUsers=value,fail:value=>error=value};
}
test('source review, return, resubmit and archive update one durable workflow and notify each actual owner once',async t=>{
 const f=fixture(t);const task=await f.create();await f.notifier.flush();assert.equal(f.sent[0].receive_id,'ou_l');
 assert.equal((await f.create()).id,task.id);await f.sync();await f.notifier.flush();assert.equal(f.sent.length,1);
 f.change({status:'pending_supervisor',currentReviewerId:'UM'},'approve');await f.sync();await f.notifier.flush();assert.equal(f.sent[1].receive_id,'ou_m');
 f.change({status:'returned_to_creator',resumeStage:'pending_supervisor',currentReviewerId:'UA',feedback:'补充产品论据'},'reject');await f.sync();await f.notifier.flush();assert.equal(f.sent[2].receive_id,'ou_a');assert.match(JSON.parse(f.sent[2].content).text,/退回/);
 f.change({status:'pending_supervisor',currentReviewerId:'UM',version:2},'resubmit');await f.sync();await f.notifier.flush();assert.equal(f.sent[3].receive_id,'ou_m');
 f.change({status:'approved',currentReviewerId:''},'approve');await f.sync();await f.notifier.flush();assert.equal(f.sent[4].receive_id,'ou_a');
 const actual=f.runtime.get(access,task.id);assert.equal(actual.runtime.state,'completed');assert.equal(actual.flowEvents.filter(e=>e.sourceEventId).length,4);assert.equal(actual.notifications.filter(n=>n.state==='sent').length,5);assert.ok(actual.runtime.nodes[2].history.length>=2);
 const restarted=new FlowCreative(new FlowRuntime(new WorkflowStore(f.store.file),{people:()=>staff}),{readSource:f.creative.readSource,sourceUrl:f.creative.sourceUrl});await restarted.sync(access,{headers:{}});assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().flowNotifications.length,5);
});
test('missing, unreadable, invalid and stale source records preserve last proven state',async t=>{
 const f=fixture(t);const task=await f.create();f.missing();await f.sync();assert.equal(f.runtime.get(access,task.id).runtime.state,'running');assert.match(f.runtime.get(access,task.id).runtime.creative.issue,/未返回/);
 f.restore();await f.sync();assert.equal(f.runtime.get(access,task.id).runtime.creative.issue,undefined);
 f.change({status:'unknown'});await f.sync();assert.equal(f.runtime.get(access,task.id).runtime.nodes[1].state,'ready');
 f.change({status:'pending_supervisor',currentReviewerId:'UM'});await f.sync();
 const oldRead=f.creative.readSource;f.creative.readSource=async()=>{const data=await oldRead();Object.assign(data.records[0],{status:'pending_team_lead',currentReviewerId:'UL',updatedAt:'2026-01-01T00:00:00Z'});return data;};
 await f.sync();assert.equal(f.runtime.get(access,task.id).runtime.nodes[2].state,'ready');assert.match(f.runtime.get(access,task.id).runtime.creative.issue,/旧版本/);
});
test('source-only tasks cannot be manually completed, reassigned, paused, or spoofed with a reserved source key',async t=>{
 const f=fixture(t),task=await f.create();for(const action of ['complete','assign','pause','cancel','return'])assert.throws(()=>f.runtime.command(access,task.id,action,{expectedVersion:task.version,nodeId:task.runtime.nodes[1].id,note:'test'},'manual-'+action),e=>e.status===409);
 assert.throws(()=>f.runtime.create(access,{workflow:'00',sourceKey:'creative:idea:draft-1'},'spoof-key-0001'),/来源编号/);
});
test('identity mapping fails closed for unknown users, center mismatch, conflicting reviewers and configuration-only users',async t=>{
 const f=fixture(t);f.users(users.filter(u=>u.id!=='UL'));await assert.rejects(f.create(),/唯一工号/);assert.equal(f.store.read().tasks.length,0);
 f.users(users);f.change({currentReviewerId:'UA'});await assert.rejects(f.create(),/不一致/);
 await assert.rejects(f.creative.candidates({...access,configurationOnly:true},{headers:{}},'idea'),e=>e.status===403);
 assert.equal((await f.creative.candidates({...access,user:{...staff[2],center:'其他中心'}},{headers:{}},'idea')).records.length,0);
});
test('source action ledger records skipped transitions without duplicate or obsolete work notifications',async t=>{
 const f=fixture(t),task=await f.create();await f.notifier.flush();
 f.change({status:'returned_to_creator',currentReviewerId:'UA'},'reject');f.change({status:'pending_team_lead',currentReviewerId:'UL',version:2},'resubmit');await f.sync();await f.sync();await f.notifier.flush();
 assert.equal(f.runtime.get(access,task.id).flowEvents.filter(e=>e.sourceEventId).length,2);assert.equal(f.sent.length,2);assert.equal(f.sent[1].receive_id,'ou_l');
});
test('PPYXZX statuses require explicit staff mapping; historical completed imports do not send new completion notices',async t=>{
 assert.throws(()=>creativeProjection('ppyxzx',{id:'p1',title:'选题',status:'待审核'},[],{}),/工号/);
 const rejected=creativeProjection('ppyxzx',{id:'p1',title:'选题',status:'未通过'},[],{owner:'A',reviewer:'L'});assert.deepEqual(rejected.steps.map(n=>n.state),['ready','pending']);
 const f=fixture(t);f.change({status:'approved',currentReviewerId:''});const task=await f.create();await f.notifier.flush();assert.equal(task.runtime.state,'completed');assert.equal(f.sent.length,0);
});
test('reader uses configured same-origin GET routes, verifies source identity and requires audit history',async()=>{
 const calls=[],store={read:()=>({creativeWatches:[]})};let wrong=false;
 const reader=createCreativeReader({paths:{idea:'/creative/api/'},origin:'https://company.invalid',store,remoteGet:async(req,path)=>{
  calls.push(path);assert.equal(req.headers.cookie,'session=fixture');
  return {status:200,payload:{schema:'wis.creative-source.v1',source:'idea',currentUser:{employeeNo:wrong?'X':'M'},users,records:[{id:'d1'}],actionsByRecord:{d1:[]},historyIncluded:true,nextCursor:null}};
 }});
 await reader.read({headers:{cookie:'session=fixture'},flowActorNumber:'M'},'idea',['d1']);assert.deepEqual(calls,['/creative/api/workflow-source?id=d1']);
 wrong=true;await assert.rejects(reader.read({headers:{cookie:'session=fixture'},flowActorNumber:'M'},'idea'),e=>e.status===403);
 assert.throws(()=>createCreativeReader({paths:{idea:'https://other.invalid/'}}));
 await assert.rejects(reader.read({headers:{}},'ppyxzx'),/尚未配置/);
});
test('unverified source state defers Feishu sends and a refreshed current source resumes without duplicates',async t=>{
 const f=fixture(t);await f.create();f.advance(46000);await f.notifier.flush();assert.equal(f.sent.length,0);
 f.advance(31000);await f.sync();await f.notifier.flush();assert.equal(f.sent.length,1);
 f.change({status:'pending_supervisor',currentReviewerId:'UM'});await f.sync();f.missing();await f.sync();await f.notifier.flush();assert.equal(f.sent.length,1);
 f.restore();f.advance(31000);await f.sync();await f.notifier.flush();assert.equal(f.sent.length,2);assert.equal(f.sent[1].receive_id,'ou_m');
});
test('rapid return and reassignment suppress obsolete notices before sending to the new owner',async t=>{
 const f=fixture(t);await f.create();f.change({teamLeadReviewerId:'UA',currentReviewerId:'UA'},'submit');await f.sync();await f.notifier.flush();assert.equal(f.sent.length,1);assert.equal(f.sent[0].receive_id,'ou_a');
 assert.equal(f.store.read().flowNotifications[0].state,'superseded');
});
test('a late source resubmit audit entry does not duplicate an already observed node activation',async t=>{
 const f=fixture(t);await f.create();await f.notifier.flush();
 f.change({status:'returned_to_creator',currentReviewerId:'UA'},'reject');await f.sync();await f.notifier.flush();
 f.change({status:'pending_team_lead',currentReviewerId:'UL',version:2});await f.sync();await f.notifier.flush();assert.equal(f.sent.length,3);
 f.action('resubmit');await f.sync();await f.notifier.flush();assert.equal(f.sent.length,3);
});
test('a late resubmit ledger still notifies when a full return cycle occurred between snapshots',async t=>{
 const f=fixture(t);await f.create();await f.notifier.flush();
 f.change({status:'pending_team_lead',version:2});await f.sync();await f.notifier.flush();assert.equal(f.sent.length,1);
 f.action('reject');f.action('resubmit');await f.sync();await f.notifier.flush();assert.equal(f.sent.length,2);
});
