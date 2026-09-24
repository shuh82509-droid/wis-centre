import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime,runVisible} from './flow-runtime.mjs';
import {LiveSessionFlow} from './live-session-flow.mjs';
import {LiveFeishuParticipants} from './live-feishu-participants.mjs';
import {LiveFeishuActions} from './live-feishu-actions.mjs';
import {liveFeishuCard} from './live-feishu-card.mjs';
const appId='cli_aa9c744d6ffa1cc4',modules=['live-room-management','workflow-engine'];
async function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'live-feishu-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let now=Date.parse('2026-09-23T08:00:00+08:00');
  const bindings=['主播','助理'].map((name,i)=>({appId,openId:'ou_test'+i,name,number:'TEST-'+i,center:'直播中心',departmentIds:['od_test'],approvedBy:'FD-026222',approvedAt:new Date(now).toISOString()}));
  const directory=new LiveFeishuParticipants({bindings,clock:()=>now,fetchUser:async open_id=>({open_id,name:bindings.find(x=>x.openId===open_id).name,department_ids:['od_test'],status:{is_activated:true,is_resigned:false,is_frozen:false,is_exited:false}})});
  await directory.refresh();
  const managers=[{number:'M',name:'主管',role:'manager'},{number:'L',name:'房间负责人',role:'specialist'}].map(p=>({...p,center:'直播中心',active:true,workflowEnabled:true,modules}));
  const access=number=>({enabled:true,canManage:number==='M',department:false,modules,user:managers.find(p=>p.number===number)});
  const store=new WorkflowStore(join(dir,'store.json')), runtime=new FlowRuntime(store,{people:()=>directory.merge(managers),clock:()=>now,env:{FLOW_PUBLIC_URL:'https://example.com/workflow-panorama/'}});
  runtime.liveParticipants=directory;
  const raw=()=>({date:'2026-09-23',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},rooms:[{code:'test',name:'测试间',anchors:[['09:00','12:00','主播']],assistants:[['09:00','12:00','助理']]}],sourceStatus:{test:{found:true,revision:1,sheetId:'official'}}});
  const live=new LiveSessionFlow(runtime,{enabled:true,clock:()=>now,leads:{test:{number:'L',name:'房间负责人'}},readSchedule:async()=>raw()});
  const slot=(await live.preview(access('M'),null,'2026-09-23')).sessions[0];assert.ok(slot);
  let task=await live.create(access('M'),null,{date:slot.date,sessionKey:slot.key,signature:slot.signature},'create-feishu-test');
  const sendReceipt=nodeId=>store.transaction(s=>{const n=s.tasks[0].runtime.nodes.find(n=>n.id===nodeId);const id='om_'+nodeId.replaceAll('.','');s.flowNotifications.push({id:'notice_'+id,kind:'ready',channel:'live_feishu_card',state:'sent',messageId:id,taskId:task.id,nodeId,attempt:n.attempt,recipient:n.owner.number});return id;});
  const actions=new LiveFeishuActions({runtime,participants:directory,liveSessions:live,appId,clock:()=>now});
  const event=(messageId,action='live_ack',form={note:'本人确认收到'})=>({verified:true,appId,eventId:'event-'+action,messageId,openId:'ou_test0',action,form});
  return {store,runtime,directory,live,actions,event,access,sendReceipt,get task(){return runtime.get(access('M'),task.id);},async ready(){
    for(let i=0;i<4;i++){task=this.task;const n=task.runtime.nodes.find(n=>n.state==='ready');task=runtime.command(access(n.owner.number),task.id,'complete',{nodeId:n.id,expectedVersion:task.version,note:'测试真实事实校验',evidence:[{url:'https://example.com/evidence'}],liveFacts:{confirmed:true,people:true,equipment:true,goods:true,risks:true}},'manager-complete-'+i);}
    now=Date.parse('2026-09-23T12:10:00+08:00');await directory.refresh();
  }};
}
test('formal roster dispatch without OA login does not grant module or management access',async t=>{
  const f=await setup(t),task=f.task;assert.equal(task.assignee.number,'TEST-0');
  const actor=f.directory.actor({appId,openId:'ou_test0',task,nodeId:'W04.S4.E1'});
  assert.equal(runVisible(task,actor),true);assert.equal(runVisible(task,{...actor,channel:undefined}),false);
  assert.throws(()=>f.runtime.command(actor,task.id,'cancel',{nodeId:actor.nodeId,expectedVersion:task.version,note:'not allowed'},'try-cancel'),e=>e.status===403);
  const body={workflow:'04',options:{anchorMode:'existing'},owner:'TEST-0',manager:'M',title:'generic flow',acceptance:'test',sourceUrl:'https://example.com'};
  assert.throws(()=>f.runtime.create(f.access('M'),body,'generic-create-no-grant'),e=>e.status===403);
});
test('acknowledgement and exception preserve pending execution and notify only manager',async t=>{
  const f=await setup(t),messageId=f.sendReceipt('W04.S4.E1');
  const before=f.store.read().flowNotifications.length;
  assert.equal((await f.actions.handle(f.event(messageId))).status,'acknowledged');
  await f.actions.handle(f.event(messageId));
  const n=f.task.runtime.nodes.find(n=>n.id==='W04.S4.E1');assert.equal(n.state,'pending');assert.equal(n.liveAcknowledgements.length,1);
  assert.equal(n.liveAcknowledgements[0].attempt,n.attempt);assert.equal(n.liveAcknowledgements[0].by,n.owner.number);
  await f.actions.handle(f.event(messageId,'live_issue',{note:'设备异常，申请协助'}));
  assert.equal(f.store.read().flowNotifications.length,before+1);assert.equal(f.store.read().flowNotifications.at(-1).recipient,'M');
});
test('forged, forwarded and premature completion requests cannot advance work',async t=>{
  const f=await setup(t),id=f.sendReceipt('W04.S4.E1'),e=f.event(id);
  for(const change of [{verified:false},{openId:'ou_test1'},{messageId:'om_forged'},{appId:'other'},{action:'cancel'}])await assert.rejects(f.actions.handle({...e,...change}));
  await assert.rejects(f.actions.handle(f.event(id,'live_complete',{note:'提前点击'})),/前置工作/);
  assert.equal(f.task.runtime.nodes.find(n=>n.id==='W04.S4.E1').state,'pending');
});
test('Feishu completion checks actual times and evidence, then waits for assistant before review',async t=>{
  const f=await setup(t);await f.ready();const id=f.sendReceipt('W04.S4.E1');
  const form={note:'已核对本场记录',actualStart:'2026-09-23 09:01',actualEnd:'2026-09-23 12:00',platformSessionId:'test-session',evidenceUrl:'https://example.com/session'};
  await assert.rejects(f.actions.handle(f.event(id,'live_complete',{...form,actualEnd:'2026-02-30 12:00'})),/时间无效/);
  await assert.rejects(f.actions.handle(f.event(id,'live_complete',{...form,evidenceUrl:''})),/HTTPS/);
  const result=await f.actions.handle(f.event(id,'live_complete',form));assert.equal(result.status,'completed');
  assert.equal(f.task.runtime.nodes.find(n=>n.id==='W04.S5.E1').state,'pending');
  const count=f.store.read().flowEvents.length;await f.actions.handle(f.event(id,'live_complete',form));assert.equal(f.store.read().flowEvents.length,count);
  f.store.transaction(s=>{s.liveFeishuReceipts={};}); // crash after business commit, before card cache
  assert.equal((await f.actions.handle(f.event(id,'live_complete',form))).status,'completed');assert.equal(f.store.read().flowEvents.length,count);
  await assert.rejects(f.actions.handle(f.event(id,'live_complete',{...form,note:'changed replay'})),/内容发生变化/);
});
test('card content has no hub URL, credentials or cross-person actions and respects stage',async t=>{
  const f=await setup(t),id=f.sendReceipt('W04.S4.E1'),notice=f.store.read().flowNotifications.find(x=>x.messageId===id);
  let card=liveFeishuCard(notice,f.task),encoded=JSON.stringify(card);
  assert.equal(card.schema,'2.0');assert.equal(card.config.enable_forward,false);assert.ok(!encoded.includes('workflow-panorama'));assert.ok(!encoded.includes('live_complete'));assert.ok(encoded.includes('live_ack'));
  await f.ready();card=liveFeishuCard(notice,f.task);assert.ok(JSON.stringify(card).includes('actualStart'));assert.ok(card.body.elements.length<=5);
  const cohostTask=structuredClone(f.task);cohostTask.runtime.liveSession.cohostDisplay='曹总（老板场）';
  assert.match(JSON.stringify(liveFeishuCard(notice,cohostTask)),/共播：曹总/);
  const names=[];const walk=v=>{if(!v||typeof v!=='object')return;if(v.name)names.push(v.name);for(const x of Object.values(v))if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object')walk(x);};walk(card);assert.equal(names.length,new Set(names).size,'all card form field names must be globally unique');
  const ack=await f.actions.handle(f.event(id));
  assert.ok(JSON.stringify(ack.card).includes('live_complete'),'acknowledgement must not hide ready completion');
  assert.ok(JSON.stringify(ack.card).includes('live_issue'),'acknowledgement must not hide exception reporting');
});
