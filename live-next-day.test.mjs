import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveNextDayReminder,LIVE_WAR_ROOM_RECIPIENT,currentNextDayGroup,currentOfficialNextDaySource,needsOfficialLiveSource,nextDayDirectMessage} from './live-next-day.mjs';
import {scheduleSessions} from './live-session-flow.mjs';
import {currentNodeNotice} from './flow-notice-validity.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {FlowRuntime} from './flow-runtime.mjs';

function fixture(){
  let now=Date.parse('2026-09-24T16:00:00+08:00');
  const date='2026-09-25',room={code:'guanqi',name:'官旗',anchors:[['09:00','10:00','主播甲']],assistants:[['09:00','10:00','助理乙']]};
  const people=['主播甲','助理乙'].map((name,i)=>({number:i?'B':'A',name,active:true,center:'直播中心',workflowEnabled:true,modules:['live-room-management','workflow-engine']}));
  const raw={date,updatedAt:new Date(now).toISOString(),rooms:[room],source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},sourceStatus:{guanqi:{found:true,revision:15,sheetId:'NYB2iu'}}};
  const cardEligible={verified:number=>['A','B'].includes(number),canOwn:number=>['A','B'].includes(number)};
  const slot=scheduleSessions(raw,date,people,now,cardEligible)[0];
  const nodes=[{id:'W04.S4.E1',state:'pending',attempt:1,owner:{number:'A'}},{id:'W04.S4.A1',state:'pending',attempt:1,owner:{number:'B'}}];
  const task={id:'T1',runtime:{state:'running',liveSession:slot,nodes}};
  const data={tasks:[task],flowNotifications:nodes.map((node,i)=>({id:`card-${i}`,taskId:task.id,nodeId:node.id,attempt:node.attempt,recipient:node.owner.number,kind:'live_assignment',state:'sent',messageId:`om_card_${i}`}))};
  const store={read:()=>structuredClone(data),transaction:fn=>fn(data)};
  const runtime={store,people:()=>people,liveParticipants:{people:()=>people,canOwn:(number,nodeId)=>['A','B'].includes(number)&&/^W04\.S4\.(E1|A\d+)$/.test(nodeId)},ensure:s=>{s.flowNotifications??=[];},notify:(s,t,n,kind,recipient,eventId)=>s.flowNotifications.push({id:'notice'+s.flowNotifications.length,key:[t.id,n?.id,kind,recipient,eventId].join(':'),taskId:t.id,nodeId:n?.id||null,attempt:n?.attempt||0,kind,recipient,state:'ready',attempts:0,nextAt:now,createdAt:new Date(now).toISOString()})};
  const notifier={enabled:true,recipient:n=>({id:n===LIVE_WAR_ROOM_RECIPIENT?'oc_test':n})};
  const liveSessions={enabled:true,readSchedule:async()=>({...raw,updatedAt:new Date(now).toISOString()})};
  const job=new LiveNextDayReminder({runtime,liveSessions,notifier,enabled:true,clock:()=>now});
  return {job,data,nodes,slot,advance:()=>{now+=300001;},setNow:v=>{now=Date.parse(v);},now:()=>now};
}

test('next-day messages are queued once; group confirms only after delivery and real acknowledgements',async()=>{
  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow');
  assert.equal(direct.length,2);
  assert.ok(direct.every(n=>n.delivery.channel==='live_tomorrow_text'&&currentNodeNotice(n,f.data.tasks[0],f.nodes.find(x=>x.id===n.nodeId),f.now())));
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.includes('group')).length,0);
  direct.forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(pending&&currentNextDayGroup(pending,f.data,f.now()));
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_confirmed').length,0);
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');
  assert.ok(confirmed&&currentNextDayGroup(confirmed,f.data,f.now()));
  assert.match(JSON.parse(confirmed.delivery.content).text,/已确认/);
  f.advance();await f.job.tick();assert.equal(f.data.flowNotifications.filter(n=>n.kind!=='live_assignment').length,4);
});

test('outdated date or changed official schedule invalidates unsent messages',async()=>{
  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow');
  f.data.tasks[0].runtime.liveSession.signature='changed';
  assert.equal(currentNodeNotice(direct,f.data.tasks[0],f.nodes[0],f.now()),false);
  f.data.tasks[0].runtime.liveSession.signature=f.slot.signature;
  f.setNow('2026-09-25T00:01:00+08:00');
  assert.equal(currentNodeNotice(direct,f.data.tasks[0],f.nodes[0],f.now()),false);
});

test('an official source issue blocks reminders for that room',async()=>{
  const f=fixture(),read=f.job.liveSessions.readSchedule;
  f.job.liveSessions.readSchedule=async(...args)=>({...await read(...args),issues:[{roomCode:'guanqi',message:'班表待核验'}]});
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind!=='live_assignment').length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
});

test('a new official-sheet assignment during token wait blocks wrong-person POST even while the task is stale',async()=>{
  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  const oldRead=f.job.liveSessions.readSchedule;
  const sent=await flushAfterTokenWait(f,()=>{
    f.job.liveSessions.readSchedule=async(req,date,options)=>{
      assert.equal(options?.fresh,true);
      const raw=await oldRead(req,date,options);
      return {...raw,rooms:raw.rooms.map(room=>({...room,anchors:[['09:00','10:00','主播丙']]}))};
    };
  },{map:{A:'ou_anchor',B:'ou_assistant'}});
  assert.deepEqual(sent,[]);
  assert.equal(direct.state,'attention');
  assert.match(direct.error,/正式班表.*核验/);
});

test('formal live assignment, today, ready and returned cards recheck the official sheet after token wait',async()=>{
  for(const kind of ['live_assignment','live_today','ready','returned']){
    const f=fixture(),notice=f.data.flowNotifications.find(n=>n.recipient==='A');
    notice.state='ready';notice.kind=kind;notice.nextAt=f.now();
    if(['ready','returned'].includes(kind))f.nodes[0].state='ready';
    if(kind==='live_today'){f.setNow('2026-09-25T08:00:00+08:00');notice.businessDate='2026-09-25';}
    assert.equal(needsOfficialLiveSource(notice,f.data.tasks[0]),true);
    const originalRead=f.job.liveSessions.readSchedule,sent=[];
    const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
      env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
      verifyLiveNoticeSource:row=>currentOfficialNextDaySource(row,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),
      fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))sent.push(url);return Response.json({code:0,data:{message_id:'om_unexpected'}});}});
    let releaseToken;
    sender.tenantToken=()=>new Promise(resolve=>{releaseToken=resolve;});
    const sending=sender.flush();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof releaseToken,'function');
    f.job.liveSessions.readSchedule=async(req,date,options)=>{
      assert.equal(options?.fresh,true);
      const raw=await originalRead(req,date,options);
      return {...raw,rooms:raw.rooms.map(room=>({...room,anchors:[['09:00','10:00','助理乙']]}))};
    };
    releaseToken('token');await sending;
    assert.deepEqual(sent,[],kind);
    assert.equal(notice.state,'attention',kind);
    assert.match(notice.error,/正式班表.*核验/,kind);
  }
});

test('a source-unreadable live card stays attention and manual retry cannot POST while source remains unreadable',async()=>{
  const f=fixture(),notice=f.data.flowNotifications.find(n=>n.recipient==='A');
  notice.state='ready';notice.kind='live_assignment';notice.nextAt=f.now();
  f.job.liveSessions.readSchedule=async()=>{throw new Error('official sheet unavailable');};
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
    verifyLiveNoticeSource:row=>currentOfficialNextDaySource(row,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),
    fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))posts++;return Response.json({code:0,data:{message_id:'om_unexpected'}});}});
  sender.token={value:'token',until:f.now()+3600000};
  await sender.flush();
  assert.equal(notice.state,'attention');assert.equal(notice.unknown,false);assert.equal(posts,0);
  f.data.tasks[0].runtime.participants=['A'];
  sender.retry({user:{number:'A'},canManage:true},notice.id);
  await sender.flush();
  assert.equal(notice.state,'attention');assert.equal(posts,0);
});

test('a current formal live card is allowed, while a source-change alert needs no current shift',async()=>{
  const f=fixture(),card=f.data.flowNotifications.find(n=>n.recipient==='A');
  card.state='ready';card.nextAt=f.now();
  assert.equal(await currentOfficialNextDaySource(card,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),true);
  const alert={...card,kind:'live_source_changed'};
  f.job.liveSessions.readSchedule=async()=>{throw new Error('official sheet unavailable');};
  assert.equal(needsOfficialLiveSource(alert,f.data.tasks[0]),false);
  assert.equal(await currentOfficialNextDaySource(alert,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),true);
});

test('manager source-change alert still sends when the official sheet cannot be read',async()=>{
  const f=fixture(),task=f.data.tasks[0];
  task.runtime.manager={number:'A'};task.runtime.liveSession.sourceIssue='正式班表发生变化';
  const alert={id:'source-alert',taskId:task.id,nodeId:null,attempt:0,recipient:'A',kind:'live_source_changed',state:'ready',attempts:0,nextAt:f.now(),createdAt:new Date(f.now()).toISOString()};
  f.data.flowNotifications.push(alert);
  f.job.liveSessions.readSchedule=async()=>{throw new Error('official sheet unavailable');};
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
    verifyLiveNoticeSource:row=>currentOfficialNextDaySource(row,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),
    fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))posts++;return Response.json({code:0,data:{message_id:'om_source_alert'}});}});
  sender.token={value:'token',until:f.now()+3600000};
  await sender.flush();
  assert.equal(posts,1);assert.equal(alert.state,'sent');
});

test('a verified shift without a formal task is reported instead of marked ready',async()=>{
  const f=fixture();f.data.tasks=[];
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind!=='live_assignment').length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
  assert.match(f.data.liveNextDayStatus.issues[0].message,/尚未派工/);
});

test('an unmapped assistant is reported and the group is not told everyone was notified',async()=>{
  const f=fixture();f.job.notifier.recipient=number=>number==='A'?{id:'ou_anchor'}:null;
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
  f.advance();await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.includes('group')).length,0);
});
test('OA-only participant or unsent assignment card blocks all next-day messages for the room',async()=>{
  for(const failure of ['no-card','no-card-permission']){
    const f=fixture();
    if(failure==='no-card')f.data.flowNotifications.find(n=>n.kind==='live_assignment'&&n.recipient==='B').state='ready';
    else f.job.runtime.liveParticipants.canOwn=number=>number==='A';
    await f.job.tick();
    assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'||n.kind.includes('group')).length,0);
    assert.equal(f.data.liveNextDayStatus.state,'attention');
    assert.match(f.data.liveNextDayStatus.issues[0].message,/派工卡|卡片身份绑定/);
  }
});

test('a new execution attempt gets a fresh reminder and cannot reuse the old group acknowledgement',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const previous=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(previous);
  f.nodes[0].attempt=2;
  f.data.flowNotifications.push({id:'card-retry',taskId:'T1',nodeId:f.nodes[0].id,attempt:2,recipient:'A',kind:'live_assignment',state:'sent',messageId:'om_card_retry'});
  f.nodes[0].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'A',at:new Date(f.now()).toISOString()}];
  assert.equal(currentNextDayGroup(previous,f.data,f.now()),false);
  f.advance();await f.job.tick();
  const fresh=f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  assert.deepEqual(fresh.map(n=>n.attempt),[1,2]);
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_pending').length,1);
  fresh.at(-1).state='sent';fresh.at(-1).messageId='om_direct_retry';f.advance();await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_pending').length,2);
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_confirmed').length,0);
});

test('queued group summary is invalid if a formal assignment card loses its sent receipt',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(currentNextDayGroup(pending,f.data,f.now()));
  f.data.flowNotifications.find(n=>n.kind==='live_assignment'&&n.recipient==='B').messageId=null;
  assert.equal(currentNextDayGroup(pending,f.data,f.now()),false);
});

test('旧轮次和非本人回执不能确认新轮次，排队中的待确认群消息在全员确认后失效',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(pending&&currentNextDayGroup(pending,f.data,f.now()));
  f.nodes[0].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'B',at:new Date(f.now()).toISOString()}];
  f.nodes[1].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'B',at:new Date(f.now()).toISOString()}];
  assert.equal(currentNextDayGroup({kind:'live_tomorrow_group_confirmed',businessDate:pending.businessDate,related:pending.related},f.data,f.now()),false);
  f.nodes[0].liveAcknowledgements.push({kind:'live_ack',attempt:1,by:'A',at:new Date(f.now()).toISOString()});
  assert.equal(currentNextDayGroup(pending,f.data,f.now()),false);
  f.advance();await f.job.tick();assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_confirmed').length,1);
});

test('direct reminder states assigned role and does not claim completion',()=>{
  const f=fixture();const message=nextDayDirectMessage(f.slot,'B','assistant','助理乙');
  assert.match(message,/9月25日（星期五）/);assert.match(message,/直播助理/);assert.match(message,/确认收到不等于|不会把工作标记为完成/);
});

test('two assistants covering different parts of one anchor shift receive their own times, not the anchor full shift',async()=>{
  const f=fixture(),raw=await f.job.liveSessions.readSchedule();
  const people=f.job.runtime.people();
  people.push({...people[1],number:'C',name:'助理丙'});
  f.job.runtime.liveParticipants.canOwn=number=>['A','B','C'].includes(number);
  raw.rooms[0].anchors=[['09:00','17:00','主播甲']];
  raw.rooms[0].assistants=[['09:00','13:00','助理乙'],['13:00','17:00','助理丙']];
  const slot=scheduleSessions(raw,raw.date,people,f.now(),f.job.runtime.liveParticipants)[0];
  const early=nextDayDirectMessage(slot,'B','assistant','助理乙');
  const late=nextDayDirectMessage(slot,'C','assistant','助理丙');
  assert.match(early,/09:00-17:00 主播班次/);
  assert.match(early,/本人班表时段：09:00-13:00，本场协助时段：09:00-13:00/);
  assert.match(late,/本人班表时段：13:00-17:00，本场协助时段：13:00-17:00/);
  assert.doesNotMatch(early,/本人班表时段：09:00-17:00/);
  assert.doesNotMatch(late,/本人班表时段：09:00-17:00/);
});

test('assistant-time correction preserves formal task signature but invalidates the old queued text and queues a corrected reminder',async()=>{
  const f=fixture();await f.job.tick();
  const old=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B');
  assert.ok(old);
  const originalRead=f.job.liveSessions.readSchedule;
  f.job.liveSessions.readSchedule=async(...args)=>{
    const raw=await originalRead(...args);
    return {...raw,rooms:raw.rooms.map(room=>({...room,assistants:[['08:30','10:00','助理乙']]}))};
  };
  const changed=await f.job.liveSessions.readSchedule();
  assert.equal(scheduleSessions(changed,changed.date,f.job.runtime.people(),f.now(),f.job.runtime.liveParticipants)[0].signature,f.slot.signature);
  assert.equal(await currentOfficialNextDaySource(old,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),false);
  f.advance();await f.job.tick();
  const notices=f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'&&n.recipient==='B');
  assert.equal(notices.length,2);
  assert.notEqual(notices[0].shiftFingerprint,notices[1].shiftFingerprint);
  assert.match(JSON.parse(notices[1].delivery.content).text,/本人班表时段：08:30-10:00，本场协助时段：09:00-10:00/);
});

test('confirmed group notice routes to the exact approved Feishu chat with a stable message UUID',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const sent=[];
  const sender=new FlowFeishu(f.job.runtime.store,{people:()=>[],clock:f.now,env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6'},fetchImpl:async(url,options)=>{
    if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'token',expire:7200});
    sent.push({url,body:JSON.parse(options.body)});return Response.json({code:0,data:{message_id:'om_group'}});
  },verifyLiveNoticeSource:()=>currentOfficialNextDaySource(f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed'),{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now})});
  assert.equal(sender.recipient(LIVE_WAR_ROOM_RECIPIENT).type,'chat_id');
  await sender.flush();
  assert.equal(sent.length,1);
  assert.equal(sent[0].body.receive_id,'oc_3f92ef62d6160399ee823e74def199e6');
  assert.match(sent[0].url,/receive_id_type=chat_id/);
  assert.equal(f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed').state,'sent');
});

async function flushAfterTokenWait(f,mutate,{map={}}={}){
  const sent=[];
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify(map)},
    verifyLiveNoticeSource:notice=>currentOfficialNextDaySource(notice,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,clock:f.now}),
    fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))sent.push(url);return Response.json({code:0,data:{message_id:'om_unexpected'}});}});
  let releaseToken;
  sender.tenantToken=()=>new Promise(resolve=>{releaseToken=resolve;});
  const flushing=sender.flush();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof releaseToken,'function','send lease should wait for token before POST');
  mutate(sender);
  releaseToken('token');
  await flushing;
  return sent;
}

test('confirmed group is superseded if an acknowledgement changes during token acquisition',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');assert.ok(confirmed);
  const sent=await flushAfterTokenWait(f,()=>{f.nodes[1].liveAcknowledgements=[];});
  assert.deepEqual(sent,[]);
  assert.equal(confirmed.state,'superseded');
});

test('group summary cannot POST after an official-sheet edit that the persisted task has not reconciled',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');assert.ok(pending);
  const oldRead=f.job.liveSessions.readSchedule;
  const sent=await flushAfterTokenWait(f,()=>{
    f.job.liveSessions.readSchedule=async(req,date,options)=>{
      assert.equal(options?.fresh,true);
      const raw=await oldRead(req,date,options);
      return {...raw,rooms:raw.rooms.map(room=>({...room,assistants:[['09:00','10:00','助理丙']]}))};
    };
  });
  assert.deepEqual(sent,[]);
  assert.equal(pending.state,'attention');
});

test('pending group is superseded if everyone confirms while token is being obtained',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');assert.ok(pending);
  const sent=await flushAfterTokenWait(f,()=>{f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);});
  assert.deepEqual(sent,[]);
  assert.equal(pending.state,'superseded');
});

test('direct reminder is superseded if the owner, attempt or Feishu recipient changes before POST',async()=>{
  for(const change of ['owner','attempt','recipient']){
    const f=fixture();await f.job.tick();
    const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
    f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
    const sent=await flushAfterTokenWait(f,sender=>{
      if(change==='owner')f.nodes[0].owner.number='B';
      if(change==='attempt')f.nodes[0].attempt=2;
      if(change==='recipient')sender.map.A='ou_changed';
    },{map:{A:'ou_anchor',B:'ou_assistant'}});
    assert.deepEqual(sent,[],change);
    assert.equal(direct.state,'superseded',change);
  }
});

test('group confirmation is explicitly scoped to listed verified shifts if another room shift is added later',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');assert.ok(confirmed);
  f.data.tasks.push({id:'T-later',runtime:{state:'running',liveSession:{...f.slot,key:'live:later',signature:'later-shift',startAt:'2026-09-25T02:00:00.000Z',endAt:'2026-09-25T03:00:00.000Z'},nodes:[]}});
  assert.equal(currentNextDayGroup(confirmed,f.data,f.now()),true,'the original notice still describes its immutable listed shifts');
  const message=JSON.parse(confirmed.delivery.content).text;
  assert.match(message,/以下已核验班次人员已确认/);
  assert.match(message,/仅汇总以下已核验班次/);
  assert.match(message,/后续新增或调整的其他班次，以后续通知为准/);
  assert.doesNotMatch(message,/本直播间所有班次.*已确认/);
});

function managementReceipt(f,notice){
  const task=f.data.tasks[0];
  Object.assign(task,{workflow:'04',center:'直播中心',title:'隔离直播场次',assignee:{name:'主管甲',number:'A'}});
  task.runtime.participants=['A','B'];task.runtime.manager={number:'A'};
  for(const node of task.runtime.nodes)node.dependencies=[];
  const runtime=new FlowRuntime(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now});
  const manager={enabled:true,canManage:true,department:false,modules:['live-room-management'],user:{number:'A',name:'主管甲',center:'直播中心'}};
  const detail=runtime.get(manager,task.id);
  assert.deepEqual(detail.notifications.find(row=>row.id===notice.id)?.state,'attention');
  assert.match(detail.notifications.find(row=>row.id===notice.id)?.error||'',/发送结果不明.*人工核验/);
  assert.ok(runtime.overview(manager).metrics.notificationAttention>=1);
}

test('previously unknown group send becomes visible attention, never superseded or resent when acknowledgement changes during token wait',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');assert.ok(confirmed);
  confirmed.unknown=true;confirmed.firstAttemptAt=new Date(f.now()-60000).toISOString();
  const sent=await flushAfterTokenWait(f,()=>{f.nodes[1].liveAcknowledgements=[];});
  assert.deepEqual(sent,[]);assert.equal(confirmed.state,'attention');assert.equal(confirmed.unknown,true);
  managementReceipt(f,confirmed);
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6'},fetchImpl:async()=>{throw Error('must not retry')}});
  await sender.flush();assert.equal(confirmed.state,'attention');
});

test('stale unknown ready notice and expired sending lease both remain attention without another POST',async()=>{
  for(const prior of ['unknown-ready','expired-sending']){
    const f=fixture();await f.job.tick();
    const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
    f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
    direct.firstAttemptAt=new Date(f.now()-60000).toISOString();
    if(prior==='unknown-ready'){direct.unknown=true;direct.state='ready';}
    else{direct.state='sending';direct.leaseId='old-lease';direct.leaseUntil=f.now()-1;}
    f.nodes[0].attempt++;
    let posts=0;
    const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},fetchImpl:async()=>{posts++;throw Error('must not send')}});
    await sender.flush();await sender.flush();
    assert.equal(posts,0,prior);assert.equal(direct.state,'attention',prior);assert.equal(direct.unknown,true,prior);
    assert.match(direct.error,/发送结果不明.*人工核验/,prior);
    assert.equal(direct.leaseId,undefined,prior);
    managementReceipt(f,direct);
  }
});
