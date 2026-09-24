import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {LiveFeishuService} from './live-feishu-service.mjs';
import {scheduleSessions} from './live-session-flow.mjs';
import {currentOfficialNextDaySource} from './live-next-day.mjs';
const appId='cli_aa9c744d6ffa1cc4';
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'live-service-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'bindings.json');writeFileSync(file,JSON.stringify([{appId,openId:'ou_test',number:'A',name:'测试同事',center:'直播中心',departmentIds:['od_test'],approvedBy:'FD-026222',approvedAt:'2026-09-23T00:00:00Z'}]));
 let now=Date.parse('2026-09-23T08:00:00+08:00'),connected=true;const sent=[];
 const store=new WorkflowStore(join(dir,'tasks.json'));
 const fetchImpl=async(url,options)=>({ok:true,status:200,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'test'}:url.includes('/contact/')?{code:0,data:{user:{open_id:'ou_test',name:'测试同事',department_ids:['od_test'],status:{is_activated:true,is_resigned:false,is_frozen:false,is_exited:false}}}}:(sent.push(JSON.parse(options.body)),{code:0,data:{message_id:'om_'+sent.length}})});
 const notifier=new FlowFeishu(store,{people:()=>[],clock:()=>now,fetchImpl,env:{FEISHU_APP_ID:appId,FEISHU_APP_SECRET:'test',FLOW_NOTIFICATIONS_ENABLED:'true'}});
 const people=[{number:'A',name:'测试同事',active:true,center:'直播中心',workflowEnabled:true,modules:['live-room-management','workflow-engine']}];
 const runtime=new FlowRuntime(store,{people:()=>people,clock:()=>now});
 const officialSheet=()=>({date:'2026-09-23',updatedAt:new Date(now).toISOString(),
   source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},
   sourceStatus:{test:{found:true,revision:42,sheetId:'test-official-sheet'}},
   rooms:[{code:'test',name:'测试间',anchors:[['09:00','12:00','测试同事']],assistants:[['09:00','12:00','测试同事']]}]});
 const liveSessions={readSchedule:async(_request,date,{fresh}={})=>{assert.equal(fresh,true);assert.equal(date,'2026-09-23');return officialSheet();}};
 const service=new LiveFeishuService({runtime,notifier,clock:()=>now,liveSessions,env:{FLOW_LIVE_FEISHU_CARDS:'true',FLOW_LIVE_PARTICIPANTS_FILE:file}});
 await service.participants.refresh();service.transport={ready:()=>connected,stop(){},status:()=>({state:connected?'connected':'idle'})};
 notifier.verifyLiveNoticeSource=notice=>currentOfficialNextDaySource(notice,{runtime,liveSessions,clock:()=>now});
 const slot=scheduleSessions(officialSheet(),'2026-09-23',people,now,service.participants)[0];
 const task={id:'live_test',workflow:'04',title:'测试场',center:'直播中心',runtime:{state:'running',manager:{number:'M'},liveSession:slot,nodes:[{id:'W04.S4.E1',title:'直播执行',owner:{number:'A',name:'测试同事'},attempt:1,state:'pending'}]}};
 store.transaction(s=>{runtime.ensure(s);s.tasks.push(task);});
 return {service,store,notifier,sent,connect:v=>connected=v,advance:()=>{now+=60000;},setTime:v=>{now=Date.parse(v);}};
}
test('disabled service has no scopes, callbacks or network work',async()=>{
 const s=new LiveFeishuService({runtime:{},notifier:{},liveSessions:{},env:{}});assert.equal(s.has('A'),false);await s.refreshIdentities();await s.tick();assert.equal(s.status().enabled,false);s.stop();
});

test('read-only identity refresh works without callback startup, task writes or notifications',async t=>{
 const f=await fixture(t),before=readFileSync(f.store.file,'utf8');f.service.participants.cache.clear();
 f.service.transport.start=()=>{throw Error('must not start a callback consumer');};
 f.service.inbox.flush=()=>{throw Error('must not process business callbacks');};
 f.service.queueMorning=()=>{throw Error('must not enqueue notices');};
 await f.service.refreshIdentities();assert.equal(f.service.status().verified,1);
 assert.equal(readFileSync(f.store.file,'utf8'),before);assert.equal(f.sent.length,0);
});

test('concurrent read-only identity refreshes coalesce and respect the refresh interval',async t=>{
 const f=await fixture(t);let calls=0,resolve;
 f.service.participants.refresh=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const a=f.service.refreshIdentities(),b=f.service.refreshIdentities();await Promise.resolve();
 assert.equal(calls,1);resolve({verified:1,issues:[]});await Promise.all([a,b]);
 await f.service.refreshIdentities();assert.equal(calls,1);
 f.service.stop();f.setTime('2026-09-23T09:00:00+08:00');await f.service.refreshIdentities();assert.equal(calls,1);
});
test('morning reminders are durable, one per current node/day, and exclude paused or source-invalid work',async t=>{
 const f=await fixture(t);f.setTime('2026-09-23T07:59:00+08:00');f.service.queueMorning();assert.equal(f.store.read().flowNotifications.length,0);
 f.setTime('2026-09-23T08:00:00+08:00');f.service.queueMorning();f.service.queueMorning();assert.equal(f.store.read().flowNotifications.length,1);
 assert.equal(f.store.read().flowNotifications[0].businessDate,'2026-09-23');
 f.store.transaction(s=>{s.tasks[0].runtime.state='paused';s.flowNotifications=[];});f.service.queueMorning();assert.equal(f.store.read().flowNotifications.length,0);
 f.store.transaction(s=>{s.tasks[0].runtime.state='running';s.tasks[0].runtime.liveSession.sourceIssue='changed';});f.service.queueMorning();assert.equal(f.store.read().flowNotifications.length,0);
});
test('external staff receive interactive cards without hub link and callback receipt is stored',async t=>{
 const f=await fixture(t);f.service.queueMorning();await f.notifier.flush();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].msg_type,'interactive');assert.equal(f.sent[0].receive_id,'ou_test');assert.ok(!f.sent[0].content.includes('workflow-panorama'));
 const notice=f.store.read().flowNotifications[0];assert.equal(notice.channel,'live_feishu_card');assert.equal(notice.state,'sent');assert.equal(notice.messageId,'om_1');
 await f.notifier.flush();assert.equal(f.sent.length,1);
});
test('disconnected callback transport retains unsent work, without burning retries or inventing delivery',async t=>{
 const f=await fixture(t);f.service.queueMorning();f.connect(false);assert.equal(f.notifier.canQueue('A'),false);await f.notifier.flush();
 assert.equal(f.sent.length,0);const notice=f.store.read().flowNotifications[0];assert.equal(notice.state,'ready');assert.equal(notice.attempts,0);assert.equal(notice.unknown,undefined);
 f.connect(true);f.advance();await f.notifier.flush();assert.equal(f.sent.length,1);
});
test('idle morning polls do not acquire a transaction or rewrite the task store',async t=>{
 const f=await fixture(t);f.service.queueMorning();
 const before=readFileSync(f.store.file,'utf8');let writes=0;
 const transaction=f.store.transaction.bind(f.store);f.store.transaction=fn=>{writes++;return transaction(fn);};
 for(let i=0;i<10;i++){f.advance();f.service.queueMorning();}
 assert.equal(writes,0);assert.equal(readFileSync(f.store.file,'utf8'),before);
 f.setTime('2026-09-24T08:00:00+08:00');await f.service.participants.refresh();f.service.queueMorning();
 assert.equal(writes,1);assert.equal(f.store.read().flowNotifications.length,2);
});
test('empty, paused, future and source-invalid stores are read-only during morning polls',async t=>{
 const f=await fixture(t),transaction=f.store.transaction.bind(f.store);let writes=0;
 f.store.transaction=fn=>{writes++;return transaction(fn);};
 for(const mutate of [
   s=>{s.tasks[0].runtime.state='paused';},
   s=>{s.tasks[0].runtime.state='running';s.tasks[0].runtime.liveSession.sourceIssue='changed';},
   s=>{delete s.tasks[0].runtime.liveSession.sourceIssue;s.tasks[0].runtime.liveSession.startAt='2026-09-24T04:00:00Z';},
   s=>{s.tasks=[];},
 ]){
   transaction(mutate);const before=readFileSync(f.store.file,'utf8');f.service.queueMorning();
   assert.equal(writes,0);assert.equal(readFileSync(f.store.file,'utf8'),before);
 }
});
test('morning eligibility and dedupe are rechecked under the transaction lock',async t=>{
 const f=await fixture(t),transaction=f.store.transaction.bind(f.store);
 let competingWrite=true;
 f.store.transaction=fn=>{
   if(competingWrite){competingWrite=false;transaction(s=>{s.flowNotifications.push({taskId:s.tasks[0].id,nodeId:'W04.S4.E1',attempt:1,recipient:'A',kind:'live_today',businessDate:'2026-09-23'});});}
   return transaction(fn);
 };
 f.service.queueMorning();assert.equal(f.store.read().flowNotifications.length,1);
 transaction(s=>{s.flowNotifications=[];});
 f.store.transaction=fn=>{transaction(s=>{s.tasks[0].runtime.liveSession.sourceIssue='changed';});return transaction(fn);};
 f.service.queueMorning();assert.equal(f.store.read().flowNotifications.length,0);
});
