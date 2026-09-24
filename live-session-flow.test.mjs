import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {LiveSessionFlow,scheduleSessions,liveStages} from './live-session-flow.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {currentOfficialNextDaySource} from './live-next-day.mjs';
import {createLiveScheduleReader} from './live-schedule-reader.mjs';
import {currentNodeNotice} from './flow-notice-validity.mjs';
const modules=['workflow-engine','live-room-management'];
const staff=[{number:'M',name:'主管',role:'manager'},{number:'L',name:'房间主责',role:'specialist'},{number:'A',name:'主播',role:'specialist'},{number:'B',name:'助理',role:'specialist'},{number:'X',name:'无关同事',role:'specialist'}].map(p=>({...p,active:true,workflowEnabled:true,center:'直播中心',modules}));
const access=(number='M')=>({enabled:true,canManage:number==='M',department:false,user:staff.find(p=>p.number===number),modules});
const evidence=[{url:'https://example.com/approved',reference:'versioned-evidence',version:'v1'}];
test('只接受四个已确认岗位别名，仍要求正式来源、唯一身份与即时核验',()=>{
 const now=Date.parse('2026-09-23T08:00:00+08:00');
 const people=['李凯彤','李彩红','谷子晴','邓淑环','未确认'].map((name,i)=>({name,number:'feishu-'+i,active:true,center:'直播中心',modules:[],workflowEnabled:false}));
 const participants={verified:number=>people.some(p=>p.number===number),canOwn:number=>people.some(p=>p.number===number)};
 const raw=name=>({date:'2026-09-23',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},rooms:[{code:'wangou',name:'王鸥美肤',anchors:[['09:00','12:00',name]],assistants:[['09:00','12:00','谷子晴']]}],sourceStatus:{wangou:{found:true,revision:42,sheetId:'real-sheet'}}});
 for(const name of ['李凯彤','李彩红','谷子晴','邓淑环'])for(const suffix of ['(金牌导购)','（金牌导购）']){
   assert.equal(scheduleSessions(raw(name+suffix),'2026-09-23',people,now,participants)[0].anchor,people.find(p=>p.name===name).number);
 }
 for(const name of ['未确认(金牌导购)','李彩红(临时)','李彩红（金牌导购）其他'])assert.throws(()=>scheduleSessions(raw(name),'2026-09-23',people,now,participants),/唯一有效/);
 assert.throws(()=>scheduleSessions(raw('李彩红(金牌导购)'),'2026-09-23',[...people,{...people[1],number:'duplicate'}],now,{verified:()=>true,canOwn:()=>true}),/唯一有效/);
 assert.throws(()=>scheduleSessions(raw('李彩红(金牌导购)'),'2026-09-23',people,now,{verified:()=>false}),/唯一有效/);
 const nonOfficial=raw('李彩红(金牌导购)');delete nonOfficial.source;nonOfficial.writebackCapability={enabled:true};
 assert.throws(()=>scheduleSessions(nonOfficial,'2026-09-23',people,now,participants),/唯一有效/);
});
test('正式房间仅解析该房间已核验的精确岗位标注，借调主播按本人身份派工',()=>{
 const now=Date.parse('2026-09-24T08:00:00+08:00');
 const people=['陈璐','王思佳','李楚晴','罗梓欣','刘睿','杨晓彤','助理'].map((name,i)=>({name,number:'person-'+i,active:true,center:'直播中心',modules:[],workflowEnabled:false}));
 const participants={verified:number=>people.some(p=>p.number===number),canOwn:number=>people.some(p=>p.number===number)};
 const raw=(roomCode,anchor)=>({date:'2026-09-25',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},rooms:[{code:roomCode,name:roomCode,anchors:[['09:00','12:00',anchor]],assistants:[['09:00','12:00','助理']]}],sourceStatus:{[roomCode]:{found:true,revision:189095,sheetId:'official-sheet'}}});
 for(const [label,name] of [['陈璐（销冠）','陈璐'],['王思佳（福利官）','王思佳'],['李楚晴（福利官）','李楚晴'],['罗梓欣（销冠）','罗梓欣']]){
  const slot=scheduleSessions(raw('brand_selection',label),'2026-09-25',people,now,participants)[0];
  assert.equal(slot.anchor,people.find(p=>p.name===name).number);
  assert.throws(()=>scheduleSessions(raw('youxuan',label),'2026-09-25',people,now,participants),/唯一有效/);
 }
 assert.equal(scheduleSessions(raw('wangou','刘睿（金牌导购）'),'2026-09-25',people,now,participants)[0].anchor,people.find(p=>p.name==='刘睿').number);
 assert.equal(scheduleSessions(raw('youxuan','杨晓彤'),'2026-09-25',people,now,participants)[0].anchor,people.find(p=>p.name==='杨晓彤').number);
 assert.throws(()=>scheduleSessions(raw('brand_selection','陈璐（临时）'),'2026-09-25',people,now,participants),/唯一有效/);
 assert.throws(()=>scheduleSessions(raw('brand_selection','陈璐（销冠）'),'2026-09-25',[...people,{...people[0],number:'duplicate'}],now,{verified:()=>true,canOwn:()=>true}),/唯一有效/);
});
test('主播或助理只有 OA 身份而无本人飞书卡片资格时整房间不派工',async t=>{
 const f=fixture(t),raw=f.raw();
 raw.source={mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'};
 assert.throws(()=>scheduleSessions(raw,raw.date,staff,f.clock(),{verified:()=>null,canOwn:()=>false}),/飞书卡片身份绑定/);
 assert.throws(()=>scheduleSessions(raw,raw.date,staff,f.clock(),{verified:()=>null,canOwn:(number)=>number==='A'}),/飞书卡片身份绑定/);
 f.runtime.liveParticipants={canOwn:()=>false};
 await assert.rejects(f.create('oa-only-person-1'),/飞书卡片身份绑定/);
 assert.equal(f.store.read().tasks.length,0);
});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'wis-live-session-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-09-23T08:00:00+08:00');
 const raw=()=>({date:'2026-09-23',updatedAt:new Date(now).toISOString(),writebackCapability:{enabled:true},rooms:[{code:'test',name:'测试直播间',anchors:[['09:00','12:00','主播']],assistants:[['08:30','12:00','助理']]}],sourceStatus:{test:{found:true,revision:42,sheetId:'verified'}}});
 const store=new WorkflowStore(join(dir,'workflow.json')),runtime=new FlowRuntime(store,{people:()=>staff,clock:()=>now,env:{FLOW_PUBLIC_URL:'https://example.com/hub/workflow-panorama/'}});
 runtime.liveParticipants={canOwn:(number,nodeId)=>['A','B'].includes(number)&&/^W04\.S4\.(E1|A\d+)$/.test(nodeId)};
 const live=new LiveSessionFlow(runtime,{clock:()=>now,readSchedule:async()=>raw(),leads:{test:{number:'L',name:'房间主责'}},enabled:true});
 return {store,runtime,live,raw,clock:()=>now,setNow:v=>now=Date.parse(v),async create(key='create-live-001'){const s=(await live.preview(access(),{},'2026-09-23')).sessions[0];return live.create(access(),{}, {date:s.date,sessionKey:s.key,signature:s.signature},key);}};
}
function complete(f,task,facts={confirmed:true},key){const node=task.runtime.nodes.find(n=>n.state==='ready');return f.runtime.command(access(node.owner.number),task.id,'complete',{expectedVersion:task.version,nodeId:node.id,note:'核对真实证据后确认',evidence,liveFacts:facts},key||'done-'+node.id+'-'+node.attempt);}

test('只读备份、过期、日期错误、缺失人员和助理空档都阻止派工',t=>{
 const f=fixture(t);for(const mutate of [r=>r.recovery={readOnly:true},r=>r.updatedAt='2026-09-22T00:00:00Z',r=>r.date='2026-09-22',r=>r.rooms[0].anchors[0][2]='不存在',r=>r.rooms[0].assistants=[['09:30','12:00','助理']],r=>r.sourceStatus.test.found=false]){const raw=f.raw();mutate(raw);assert.throws(()=>scheduleSessions(raw,'2026-09-23',staff,f.clock()));}assert.equal(f.store.read().tasks.length,0);
});
test('同一房间有未核验共播或全局来源问题时不以部分班次派工',async t=>{
 const f=fixture(t),roomIssue={roomCode:'test',code:'cohost_requires_manual_identity',message:'共播身份待核验'};
 const partial={...f.raw(),issues:[roomIssue]};
 assert.throws(()=>scheduleSessions(partial,'2026-09-23',staff,f.clock()),/未核验班次/);
 f.live.readSchedule=async()=>partial;
 const preview=await f.live.preview(access(),{},'2026-09-23');
 assert.equal(preview.sessions.length,0);
 assert.ok(preview.issues.some(issue=>issue.code==='cohost_requires_manual_identity'));
 assert.equal(f.store.read().tasks.length,0);
 const global={...f.raw(),issues:[{message:'来源读取不完整'}]};
 assert.throws(()=>scheduleSessions(global,'2026-09-23',staff,f.clock()),/未核验班次/);
 const otherRoom={...f.raw(),issues:[{roomCode:'other',message:'其它直播间待核验'}]};
 assert.equal(scheduleSessions(otherRoom,'2026-09-23',staff,f.clock()).length,1);
});
test('跨日班次按原表顺序归入次日且助理覆盖完整',t=>{
 const f=fixture(t),r=f.raw();r.rooms[0].anchors=[['21:00','02:00','主播'],['02:00','05:30','主播']];r.rooms[0].assistants=[['21:00','02:00','助理'],['02:00','05:30','助理']];const rows=scheduleSessions(r,r.date,staff,f.clock());assert.equal(rows[1].startAt,'2026-09-23T18:00:00.000Z');assert.equal(rows[1].endAt,'2026-09-23T21:30:00.000Z');
});
test('五阶段、主播助理并行及房间主责只在本任务受托，不改变全局角色',async t=>{
 const f=fixture(t),task=await f.create();assert.deepEqual([...new Set(task.runtime.nodes.map(n=>n.liveStage))],liveStages);assert.equal(task.runtime.nodes[0].owner.number,'L');assert.equal(task.runtime.nodes.find(n=>n.id==='W04.S2.E2').owner.number,'L');assert.equal(staff.find(p=>p.number==='L').role,'specialist');assert.equal(task.runtime.nodes[0].dueAt,task.runtime.liveSession.startAt);assert.equal(task.notifications[0].recipient,'L');assert.ok(task.runtime.nodes.find(n=>n.id==='W04.S5.E1').dependencies.includes('W04.S4.A1'));
});
test('重复派工、重复请求和重启保留同一任务及通知',async t=>{
 const f=fixture(t),first=await f.create();assert.equal((await f.create()).id,first.id);assert.equal((await f.create('different-key')).id,first.id);assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().flowNotifications.length,3);assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_assignment').length,2);assert.equal(new FlowRuntime(f.store,{people:()=>staff}).get(access(),first.id).runtime.liveSession.key,first.runtime.liveSession.key);
});
test('默认关闭、未授权人员和当前源变更不能创建或推进',async t=>{
 const f=fixture(t);f.live.enabled=false;await assert.rejects(f.create(),e=>e.status===409);f.live.enabled=true;await assert.rejects(f.live.preview(access('A'),{},'2026-09-23'),e=>e.status===403);const task=await f.create();f.live.readSchedule=async()=>{const raw=f.raw();raw.rooms[0].anchors[0][2]='无关同事';return raw;};await assert.rejects(f.live.verifyCurrent(access('L'),{},task.id),e=>e.status===409);assert.equal(f.store.read().tasks[0].runtime.nodes[0].state,'ready');
});
test('其它单元格变化不阻止原场次继续办理，原派工版本仍留痕',async t=>{const f=fixture(t),task=await f.create();f.live.readSchedule=async()=>({...f.raw(),sourceStatus:{test:{found:true,revision:43,sheetId:'verified'}}});await f.live.verifyCurrent(access('L'),{},task.id);assert.equal(f.runtime.get(access(),task.id).runtime.liveSession.source.revision,42);});
test('未勾选、未放行、未结束和无行动结论不能自动完成',async t=>{
 const f=fixture(t);let task=await f.create();assert.throws(()=>complete(f,task,{}));task=complete(f,task);task=complete(f,task);task=complete(f,task);assert.equal(task.runtime.nodes.find(n=>n.state==='ready').id,'W04.S3.E2');assert.throws(()=>complete(f,task));task=complete(f,task,{confirmed:true,people:true,equipment:true,goods:true,risks:true});assert.throws(()=>complete(f,task));assert.equal(task.runtime.nodes.filter(n=>n.state==='ready').length,2);
 f.setNow('2026-09-23T12:10:00+08:00');const facts={confirmed:true,actualStart:'2026-09-23T09:01:00+08:00',actualEnd:'2026-09-23T12:00:00+08:00',platformSessionId:'real-sample'};task=complete(f,task,facts);assert.equal(task.runtime.nodes.find(n=>n.id==='W04.S5.E1').state,'pending');task=complete(f,task,facts);task=complete(f,task);assert.throws(()=>complete(f,task));task=complete(f,task,{confirmed:true,noAction:true,noActionReason:'本场复核无新增改进行动'});assert.equal(task.runtime.state,'completed');assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='ready').length,task.runtime.nodes.length);
});
test('待办仅包含本人的当前或等待节点，无关同事为空',async t=>{const f=fixture(t);await f.create();assert.ok(f.live.today(access('L')).items.length>0);assert.equal(f.live.today(access('X')).items.length,0);assert.ok(f.live.today(access('A')).items.every(i=>i.node.owner.number==='A'&&i.waitingFor.length));});
test('飞书每个到达节点有独立幂等消息回执，不真实发送',async t=>{
 const f=fixture(t);let task=await f.create(),sent=[];const n=new FlowFeishu(f.store,{people:()=>staff,clock:f.clock,env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({L:'ou_l',A:'ou_a',B:'ou_b',M:'ou_m'})},verifyLiveNoticeSource:notice=>currentOfficialNextDaySource(notice,{runtime:f.runtime,liveSessions:f.live,clock:f.clock}),fetchImpl:async(url,o)=>({ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'test'}:(sent.push(JSON.parse(o.body)),{code:0,data:{message_id:'om_mock_'+sent.length}})})});await n.flush();task=complete(f,task);await n.flush();await n.flush();assert.equal(sent.length,4);assert.equal(new Set(sent.map(item=>item.uuid)).size,4);assert.ok(f.store.read().flowNotifications.every(n=>n.state==='sent'));
});
test('同源班表读取不接受客户端地址、不跟随重定向',async()=>{let called;const read=createLiveScheduleReader({publicUrl:'https://example.com/hub/workflow-panorama/',fetchImpl:async(url,opts)=>{called={url:url.href,opts};return {ok:true,json:async()=>({date:'2026-09-23'})};}});await read({headers:{cookie:'test_session',authorization:'do-not-forward'}},'2026-09-23');assert.match(called.url,/^https:\/\/example.com\/hub\/modules\/dispatch-center\/api\/schedule\?/);assert.equal(called.opts.redirect,'error');assert.equal(called.opts.headers.Authorization,undefined);});

test('取消后不能默默复用旧任务，明确替代保留证据且重试不重复派工',async t=>{
 const f=fixture(t);let original=await f.create();original=complete(f,original);
 const cancelled=f.runtime.command(access(),original.id,'cancel',{expectedVersion:original.version,note:'正式班表换人，先终止原任务'},'cancel-original-1');
 await assert.rejects(f.create('new-request-without-replacement'),/原任务已终止/);
 await assert.rejects(f.create(),/原任务已终止/);
 const slot=(await f.live.preview(access(),{},'2026-09-23')).sessions[0];
 assert.equal(slot.cancelledTasks[0].id,original.id);
 const body={date:slot.date,sessionKey:slot.key,signature:slot.signature,replacesTaskId:original.id,expectedVersion:cancelled.version,note:'主管核验已恢复原班次，重新派工'};
 const replacement=await f.live.create(access(),{},body,'replacement-0001');
 assert.notEqual(replacement.id,original.id);assert.equal((await f.live.create(access(),{},body,'replacement-0001')).id,replacement.id);
 assert.equal(f.store.read().tasks.length,2);const old=f.runtime.get(access(),original.id);
 assert.equal(old.runtime.state,'cancelled');assert.deepEqual(old.runtime.nodes,cancelled.runtime.nodes);
 assert.equal(old.runtime.liveSession.replacedBy,replacement.id);assert.equal(replacement.runtime.liveSession.replacesTaskId,original.id);
 assert.equal(replacement.runtime.nodes[0].state,'ready');assert.equal(replacement.runtime.nodes[0].evidence.length,0);
 assert.equal(f.store.read().flowNotifications.filter(n=>n.taskId===replacement.id&&n.kind==='ready').length,1);
 await assert.rejects(f.live.create(access(),{},body,'replacement-new-request'),/尚未重新派工/);
});

test('重新派工校验主管权限、原任务版本、结束状态和目标日期直播间',async t=>{
 const f=fixture(t),original=await f.create(),slot=(await f.live.preview(access(),{},'2026-09-23')).sessions[0];
 const body={date:slot.date,sessionKey:slot.key,signature:slot.signature,replacesTaskId:original.id,expectedVersion:original.version,note:'重新核对来源并派工'};
 await assert.rejects(f.live.create(access('A'),{},body,'replacement-unauthorized'),e=>e.status===403);
 await assert.rejects(f.live.create(access(),{},body,'replacement-still-running'),/已终止/);
 const cancelled=f.runtime.command(access(),original.id,'cancel',{expectedVersion:original.version,note:'取消旧场次'},'cancel-original-2');
 await assert.rejects(f.live.create(access(),{},body,'replacement-stale-version'),/已变化/);
 f.live.readSchedule=async()=>{const raw=f.raw();raw.rooms[0].code='other';raw.sourceStatus.other=raw.sourceStatus.test;return raw;};
 f.live.leads.other={number:'L',name:'房间主责'};
 const other=(await f.live.preview(access(),{},body.date)).sessions[0];
 await assert.rejects(f.live.create(access(),{},{...body,sessionKey:other.key,signature:other.signature,expectedVersion:cancelled.version},'replacement-other-room'),/同一日期和直播间/);
 assert.equal(f.store.read().tasks.length,1);
});

test('班表恢复必须重新读取原班次，一次解除阻断且不篡改已完成证据',async t=>{
 const f=fixture(t);let task=complete(f,await f.create());
 f.store.transaction(s=>{const row=s.tasks[0];row.runtime.liveSession.sourceIssue='来源变化';row.version++;for(const n of s.flowNotifications)if(n.kind==='ready')n.state='superseded';});
 task=f.runtime.get(access(),task.id);const before=structuredClone(task.runtime.nodes);
 const body={taskId:task.id,expectedVersion:task.version,note:'原班表已恢复，重新核验'};
 await assert.rejects(f.live.restoreSource(access('A'),{},body,'restore-forbidden'),e=>e.status===403);
 f.live.readSchedule=async()=>{const raw=f.raw();raw.rooms[0].anchors[0][2]='无关同事';return raw;};
 await assert.rejects(f.live.restoreSource(access(),{},body,'restore-change-remains'),/来源已变化/);
 assert.ok(f.runtime.get(access(),task.id).runtime.liveSession.sourceIssue);
 f.live.readSchedule=async()=>f.raw();const restored=await f.live.restoreSource(access(),{},body,'restore-once-0001');
 await f.live.restoreSource(access(),{},body,'restore-once-0001');
 assert.equal(restored.runtime.liveSession.sourceIssue,undefined);assert.deepEqual(restored.runtime.nodes,before);
 assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_restored').length,1);
 assert.equal(f.store.read().flowEvents.filter(n=>n.action==='live_source_restored').length,1);
 const notice=f.store.read().flowNotifications.find(n=>n.kind==='live_source_restored'),node=restored.runtime.nodes.find(n=>n.id===notice.nodeId);
 assert.equal(currentNodeNotice(notice,restored,node,f.clock()),true);
 assert.equal(currentNodeNotice({...notice,recipient:'X'},restored,node,f.clock()),false);
 assert.equal(currentNodeNotice({kind:'live_source_changed',recipient:'M'},restored,null,f.clock()),false);
});

test('原班表核验不会恢复主管手动暂停的流程，也不发送误导性可办理通知',async t=>{
 const f=fixture(t),task=await f.create();f.runtime.command(access(),task.id,'pause',{expectedVersion:task.version,note:'等待主管确认'},'pause-before-source');
 f.store.transaction(s=>{s.tasks[0].runtime.liveSession.sourceIssue='班表待核验';s.tasks[0].version++;});
 const old=f.runtime.get(access(),task.id),restored=await f.live.restoreSource(access(),{},{taskId:old.id,expectedVersion:old.version,note:'源表恢复一致，仍保持暂停'},'restore-paused-1');
 assert.equal(restored.runtime.state,'paused');assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='live_source_restored').length,0);
});
