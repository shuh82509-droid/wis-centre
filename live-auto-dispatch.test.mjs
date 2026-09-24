import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {LiveSessionFlow} from './live-session-flow.mjs';
import {LiveAutoDispatch} from './live-auto-dispatch.mjs';
import {currentOfficialNextDaySource} from './live-next-day.mjs';
import {currentNodeNotice} from './flow-notice-validity.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'live-auto-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-09-23T08:00:00+08:00');
 const people=[{number:'M',name:'主管',role:'director'},{number:'L',name:'负责人',role:'specialist'},{number:'A',name:'主播',role:'specialist'},{number:'B',name:'助理',role:'specialist'}].map(p=>({...p,center:'直播中心',active:true,modules:['live-room-management','workflow-engine']}));
 const store=new WorkflowStore(join(dir,'data.json')),runtime=new FlowRuntime(store,{people:()=>people,clock:()=>now});
 runtime.liveParticipants={canOwn:(number,nodeId)=>['A','B'].includes(number)&&/^W04\.S4\.(E1|A\d+)$/.test(nodeId)};
 let changed=false;
 const raw=date=>({date,updatedAt:new Date(now).toISOString(),writebackCapability:{enabled:true},rooms:date==='2026-09-23'?[{code:'test',name:'测试',anchors:[[changed?'10:00':'09:00','12:00','主播']],assistants:[['09:00','12:00','助理']]}]:[],sourceStatus:{test:{found:true,revision:4,sheetId:'sheet'}}});
 const live=new LiveSessionFlow(runtime,{enabled:true,readSchedule:async(_,date)=>raw(date),clock:()=>now,leads:{test:{number:'L',name:'负责人'}}});
 const auto=new LiveAutoDispatch(live,{enabled:true,actorNumber:'M',clock:()=>now});
 return {auto,live,store,people,raw,now:()=>now,setNow:value=>{now=Date.parse(value);},advance:()=>now+=301000,change:()=>changed=true};
}
test('后台依正式来源派工，重复轮询不重复任务或通知',async t=>{
 const f=fixture(t);await f.auto.tick();assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().flowNotifications.length,3);
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().flowNotifications.length,3);
 assert.equal(f.store.read().tasks[0].runtime.nodes[0].owner.number,'L');
});
test('默认关闭、主账号撤权及来源故障均不派工',async t=>{
 const f=fixture(t);f.auto.enabled=false;await f.auto.tick();assert.equal(f.store.read().tasks.length,0);
 f.auto.enabled=true;f.people[0].active=false;await f.auto.tick();assert.equal(f.store.read().tasks.length,0);assert.equal(f.auto.status().state,'attention');
 f.people[0].active=true;f.advance();f.live.readSchedule=async()=>{throw Error('来源失效');};await f.auto.tick();assert.equal(f.store.read().tasks.length,0);
});
test('班表变更不重建任务、不开新时间任务，不覆盖已有事实',async t=>{
 const f=fixture(t);await f.auto.tick();const before=f.store.read().tasks[0];f.change();f.advance();await f.auto.tick();
 assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().tasks[0].runtime.liveSession.sourceIssue,undefined);
 assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_changed').length,0);
 assert.equal(f.auto.status().state,'attention');
 f.advance();await f.auto.tick();
 const tasks=f.store.read().tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].id,before.id);assert.ok(tasks[0].runtime.liveSession.sourceIssue);assert.equal(tasks[0].runtime.nodes[0].state,'ready');
 assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_changed').length,1);
 f.advance();await f.auto.tick();assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_changed').length,1);
 assert.equal(f.auto.status().state,'attention');
});

test('主管终止变更任务后仍须明确替代，后台不得偷偷重建另一个时间场次',async t=>{
 const f=fixture(t);await f.auto.tick();f.change();f.advance();await f.auto.tick();f.advance();await f.auto.tick();
 const original=f.store.read().tasks[0],a={enabled:true,canManage:true,department:true,user:f.people[0],modules:f.people[0].modules};
 f.live.runtime.command(a,original.id,'cancel',{expectedVersion:original.version,note:'原班表变更，主管终止'},'cancel-changed-auto');
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks.length,1);assert.equal(f.auto.status().state,'attention');
 const cancelled=f.store.read().tasks[0],slot=(await f.live.preview(a,null,'2026-09-23')).sessions[0];
 const replacement=await f.live.create(a,null,{date:slot.date,sessionKey:slot.key,signature:slot.signature,replacesTaskId:cancelled.id,expectedVersion:cancelled.version,note:'按新时间明确替代原任务'},'manual-replacement-auto');
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks.length,2);assert.equal(f.store.read().tasks.filter(t=>t.runtime.state==='running')[0].id,replacement.id);
});

test('正式房间解析异常只读报 attention，旧任务不永久误置，发送前 fresh 来源仍阻断',async t=>{
 const f=fixture(t);await f.auto.tick();const before=f.store.read(),task=before.tasks[0],ready=before.flowNotifications.find(n=>n.kind==='ready');
 f.live.readSchedule=async(_,date)=>date==='2026-09-23'?{...f.raw(date),issues:[{roomCode:'test',message:'班次人员缺失'}]}:f.raw(date);
 f.advance();await f.auto.tick();const after=f.store.read(),blocked=after.tasks[0];
 assert.equal(after.tasks.length,1);assert.equal(blocked.id,task.id);assert.equal(blocked.runtime.liveSession.sourceIssue,undefined);
 assert.equal(currentNodeNotice(ready,blocked,blocked.runtime.nodes.find(n=>n.id===ready.nodeId),f.now()),true);
 assert.equal(await currentOfficialNextDaySource(ready,{runtime:f.live.runtime,liveSessions:f.live,clock:f.now}),false);
 assert.equal(after.flowNotifications.filter(n=>n.kind==='live_source_changed').length,0);
 f.advance();await f.auto.tick();assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_changed').length,0);
 assert.equal(f.auto.status().state,'attention');
});

test('房间瞬态缺失和读取失败不永久污染任务或群发虚假变更',async t=>{
 const f=fixture(t);await f.auto.tick();
 f.live.readSchedule=async(_,date)=>date==='2026-09-23'?{...f.raw(date),rooms:[],issues:[]}:f.raw(date);
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks[0].runtime.liveSession.sourceIssue,undefined);
 assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_changed').length,0);
 f.live.readSchedule=async()=>{throw Error('跨 revision 读取失败');};
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks[0].runtime.liveSession.sourceIssue,undefined);
 assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_changed').length,0);
 assert.equal(f.auto.status().state,'attention');
 f.live.readSchedule=async(_,date)=>f.raw(date);
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks[0].runtime.liveSession.sourceIssue,undefined);
});

test('全局临时读表故障不把 34 个正式任务永久标成来源变更',async t=>{
 const f=fixture(t);await f.auto.tick();
 f.store.transaction(s=>{const original=s.tasks[0];for(let i=1;i<34;i++){
   const copy=structuredClone(original);copy.id=`existing-${i}`;copy.runtime.liveSession.key=`existing-key-${i}`;s.tasks.push(copy);
 }});
 const before=f.store.read();
 f.live.readSchedule=async()=>{throw Error('四个工作表读取期间版本不一致');};
 f.advance();await f.auto.tick();const after=f.store.read();
 assert.equal(after.tasks.length,34);assert.ok(after.tasks.every(task=>!task.runtime.liveSession.sourceIssue));
 assert.equal(after.flowNotifications.filter(n=>n.kind==='live_source_changed').length,0);
 assert.equal(after.flowNotifications.length,before.flowNotifications.length);
 assert.equal(f.auto.status().state,'attention');
});

test('次日全天班次在前一日上午进入限速派工队列，不等下午才开始建任务',async t=>{
 const f=fixture(t);f.live.readSchedule=async(_,date)=>{
   if(date==='2026-09-23')return {...f.raw(date),rooms:[]};
   return {...f.raw(date),rooms:[{code:'test',name:'测试',anchors:[['09:00','10:00','主播'],['20:00','21:00','主播']],assistants:[['09:00','10:00','助理'],['20:00','21:00','助理']]}]};
 };
 await f.auto.tick();const tasks=f.store.read().tasks;
 assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.runtime.liveSession.date==='2026-09-24'));
 assert.ok(tasks.some(t=>t.runtime.liveSession.startAt==='2026-09-24T12:00:00.000Z'));
});

test('业务日跨午夜的 00:00 和 02:00 班次在前一天一并派工，已开始班次不补发',async t=>{
 const f=fixture(t);f.live.readSchedule=async(_,date)=>{
   if(date==='2026-09-23')return {...f.raw(date),rooms:[]};
   const shifts=[['23:00','00:00','主播'],['00:00','02:00','主播'],['02:00','05:30','主播']];
   return {...f.raw(date),rooms:[{code:'test',name:'测试',anchors:shifts,assistants:shifts.map(row=>[...row.slice(0,2),'助理'])}]};
 };
 await f.auto.tick();const tasks=f.store.read().tasks;
 assert.equal(tasks.length,3);assert.ok(tasks.every(task=>task.runtime.liveSession.date==='2026-09-24'));
 assert.deepEqual(tasks.map(task=>task.runtime.liveSession.startAt).sort(),['2026-09-24T15:00:00.000Z','2026-09-24T16:00:00.000Z','2026-09-24T18:00:00.000Z']);
 const later=fixture(t);later.setNow('2026-09-23T10:00:00+08:00');await later.auto.tick();
 assert.equal(later.store.read().tasks.length,0,'当日 09:00 已开始，不得补发');
});

test('午夜后只补派昨日业务日尚未开始的尾班，重复轮询不重复任务',async t=>{
 const f=fixture(t);f.setNow('2026-09-24T00:30:00+08:00');
 f.live.readSchedule=async(_,date)=>{
   if(date!=='2026-09-23')return {...f.raw(date),rooms:[]};
   const shifts=[['23:00','00:00','主播'],['00:00','02:00','主播'],['02:00','05:30','主播']];
   return {...f.raw(date),rooms:[{code:'test',name:'测试',anchors:shifts,assistants:shifts.map(row=>[...row.slice(0,2),'助理'])}]};
 };
 await f.auto.tick();const tasks=f.store.read().tasks;
 assert.equal(tasks.length,1);assert.equal(tasks[0].runtime.liveSession.date,'2026-09-23');
 assert.equal(tasks[0].runtime.liveSession.startAt,'2026-09-23T18:00:00.000Z');
 f.advance();await f.auto.tick();assert.equal(f.store.read().tasks.length,1);
});

test('午夜后仅对未开始的昨日跨日尾班做稳定漂移核验，不误置已开播场次',async t=>{
 const f=fixture(t);let changed=false;
 f.live.readSchedule=async(_,date)=>{
   if(date!=='2026-09-23')return {...f.raw(date),rooms:[]};
   const anchors=changed?[['23:00','00:00','主播'],['00:15','02:00','主播'],['02:30','05:30','主播']]
     :[['23:00','00:00','主播'],['00:00','02:00','主播'],['02:00','05:30','主播']];
   const assistants=[['23:00','00:00','助理'],['00:00','02:00','助理'],['02:00','05:30','助理']];
   return {...f.raw(date),rooms:[{code:'test',name:'测试',anchors,assistants}]};
 };
 await f.auto.tick();assert.equal(f.store.read().tasks.length,3);
 f.setNow('2026-09-24T00:30:00+08:00');changed=true;await f.auto.tick();
 let tasks=f.store.read().tasks;assert.equal(tasks.length,3);
 assert.equal(tasks.filter(task=>task.runtime.liveSession.sourceIssue).length,0);
 f.advance();await f.auto.tick();tasks=f.store.read().tasks;
 assert.equal(tasks.length,3);assert.equal(tasks.filter(task=>task.runtime.liveSession.sourceIssue).length,1);
 assert.equal(tasks.find(task=>task.runtime.liveSession.sourceIssue).runtime.liveSession.startAt,'2026-09-23T18:00:00.000Z');
 assert.equal(f.store.read().flowNotifications.filter(notice=>notice.kind==='live_source_changed').length,1);
});
