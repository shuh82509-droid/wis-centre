import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {clone,message,plan,MemoryStore,laneFixture,legacyRow} from './fixture-support.mjs';

const instant=time=>Date.parse(`2026-09-28T${time}+08:00`);
test('frozen no-retry source reference and hard-OFF server stay unchanged',()=>{
 assert.equal(createHash('sha256').update(readFileSync('/qa/opening-notifications.no-retry.original.mjs')).digest('hex'),'1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381');
 assert.equal(createHash('sha256').update(readFileSync('/app/server.mjs')).digest('hex'),'af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd');
});
for(const [time,expected] of [['15:59:59.999',0],['16:00:00.000',1],['16:59:59.999',1],['17:00:00.000',0],['23:59:59.999',0],['00:00:00.000',0]]){
 test(`fixed Shanghai window at ${time} permits ${expected} synthetic POST`,async()=>{
  const row=legacyRow(message({room:'Old other room',roomCode:'fixture_old'})),fixture=laneFixture({now:instant(time),store:new MemoryStore([row])});const original=clone(fixture.store.state);
  await fixture.lane.tick();assert.equal(fixture.counts.posts,expected);assert.deepEqual(fixture.store.state.openingReceipts[0],row);
  if(!expected){assert.equal(fixture.counts.plans,0);assert.equal(fixture.counts.sendCalls,0);assert.deepEqual(fixture.store.state,original);}
 });
}
for(const configured of [0,17,NaN,'16',16.5])for(const time of ['00:00:00','15:59:00','16:00:00','16:59:59','17:00:00','23:59:00']){
 test(`sendHour ${String(configured)} cannot widen or move fixed window at ${time}`,async()=>{
  const fixture=laneFixture({now:instant(time)});fixture.lane.sendHour=configured;const original=clone(fixture.store.state);await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.counts.plans,0);assert.deepEqual(fixture.store.state,original);
 });
}
test('tick before 16 then at 16 may run; after 17 never drains prior scope',async()=>{
 const fixture=laneFixture({now:instant('15:59:59.999')});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);fixture.clock.now=instant('16:00:00');await fixture.lane.tick();assert.equal(fixture.counts.posts,1);const held=clone(fixture.store.state.openingReceipts);fixture.clock.now=instant('17:00:00');await fixture.lane.tick();assert.equal(fixture.counts.posts,1);assert.deepEqual(fixture.store.state.openingReceipts,held);
});
test('token await crossing 17 never invokes message fetch',async()=>{
 const fixture=laneFixture({now:instant('16:59:59.900'),token:clock=>{clock.now=instant('17:00:00');return 'synthetic-only';}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.store.state.openingReceipts[0].postAttempted,false);assert.equal(fixture.store.state.openingReceipts[0].unknown,false);
});
for(const stage of [1,2,3,4])test(`source await ${stage} crossing 17 never invokes message fetch`,async()=>{
 const fixture=laneFixture({now:instant('16:59:59.900'),readPlan:(n,clock)=>{if(n===stage)clock.now=instant('17:00:00');return plan([message()]);}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);if(fixture.store.state.openingReceipts.length){assert.equal(fixture.store.state.openingReceipts[0].postAttempted,false);assert.equal(fixture.store.state.openingReceipts[0].unknown,false);}
});
for(const phase of ['status','prepared','intent'])test(`persistence ${phase} crossing 17 holds without message fetch`,async()=>{
 let fixture;const store=new MemoryStore([],{onCommit:(_s,current)=>{if(current===phase)fixture.clock.now=instant('17:00:00');}});fixture=laneFixture({store,now:instant('16:59:59.900')});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);if(store.state.openingReceipts.length){assert.equal(store.state.openingReceipts[0].postAttempted,false);assert.equal(store.state.openingReceipts[0].autoHold,true);}
});
for(const readPhase of ['prepared','intent','final'])test(`readback ${readPhase} crossing 17 holds without message fetch`,async()=>{
 let fixture,sendingReads=0;const store=new MemoryStore([],{onRead:(_s,row)=>{
  const state=row.openingReceipts[0]?.state;if(state==='sending')sendingReads++;
  if(readPhase==='prepared'&&state==='prepared'||readPhase==='intent'&&state==='sending'&&sendingReads===1||readPhase==='final'&&state==='sending'&&sendingReads===2)fixture.clock.now=instant('17:00:00');
 }});fixture=laneFixture({store,now:instant('16:59:59.900')});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(store.state.openingReceipts[0].postAttempted,false);assert.equal(store.state.openingReceipts[0].unknown,false);assert.equal(store.state.openingReceipts[0].autoHold,true);
});
test('microtask continuation after intent readback crossing 17 is checked at actual sender continuation',async()=>{
 let fixture,queued=false;const store=new MemoryStore([],{onRead:(_s,row)=>{if(!queued&&row.openingReceipts[0]?.state==='sending'){queued=true;queueMicrotask(()=>{fixture.clock.now=instant('17:00:00');});}}});fixture=laneFixture({store,now:instant('16:59:59.900')});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(store.state.openingReceipts[0].postAttempted,false);
});
for(const bad of [NaN,Infinity,-Infinity,'178',null,undefined,instant('16:00:00')+.5,Number.MAX_SAFE_INTEGER])test(`invalid clock ${String(bad)} fails before reads or writes and permanently blocks instance`,async()=>{
 const fixture=laneFixture({now:instant('16:00:00')});fixture.clock.now=bad;const original=clone(fixture.store.state);await fixture.lane.tick();assert.equal(fixture.counts.plans,0);assert.equal(fixture.counts.posts,0);assert.equal(fixture.lane.clockBlocked,true);assert.deepEqual(fixture.store.state,original);fixture.clock.now=instant('16:30:00');await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.deepEqual(fixture.store.state,original);
});
for(const phase of ['source','token','prepared','intent','readback','final'])test(`observed ${phase} clock rollback permanently blocks automatic sending`,async()=>{
 let fixture,sendingReads=0;const store=new MemoryStore([],{onCommit:(_s,current)=>{if(phase===current)fixture.clock.now=instant('16:00:00')-1;},onRead:(_s,row)=>{if(row.openingReceipts[0]?.state==='sending')sendingReads++;if(phase==='readback'&&sendingReads===1||phase==='final'&&sendingReads===2)fixture.clock.now=instant('16:00:00')-1;}});
 fixture=laneFixture({store,now:instant('16:00:00'),token:clock=>{if(phase==='token')clock.now-=1;return 'synthetic-only';},readPlan:(n,clock)=>{if(phase==='source'&&n===1)clock.now-=1;return plan([message()]);}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.lane.clockBlocked,true);const held=clone(store.state.openingReceipts);fixture.clock.now=instant('16:30:00');await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.deepEqual(store.state.openingReceipts,held);
});
test('observed after-window time followed by earlier in-window time cannot reopen on rollback',async()=>{
 const fixture=laneFixture({now:instant('17:00:00')});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);fixture.clock.now=instant('16:59:59');await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.lane.clockBlocked,true);
});
test('wrong business next-day date is rejected despite source giving a matching key',async()=>{
 const candidate=message({date:'2026-09-30'}),fixture=laneFixture({now:instant('16:00:00'),messages:[candidate]});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.store.state.openingReceipts.length,0);
});
test('final readback changing next-day/source clock across midnight cannot invoke fetch',async()=>{
 let fixture,sendingReads=0;const store=new MemoryStore([],{onRead:(_s,row)=>{if(row.openingReceipts[0]?.state==='sending'&&++sendingReads===2)fixture.clock.now=Date.parse('2026-09-29T00:00:00+08:00');}});fixture=laneFixture({store,now:instant('16:59:59.900')});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(store.state.openingReceipts[0].postAttempted,false);assert.equal(store.state.openingReceipts[0].unknown,false);
});
test('source content with same key but changed recipient cannot pass final request hash gate',async()=>{
 const original=message(),changed=message({...original,recipient:{id:'ou_fixture_changed',type:'open_id',name:'Changed synthetic'},key:original.key}),fixture=laneFixture({now:instant('16:59:59'),readPlan:n=>plan([n===4?changed:original])});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.store.state.openingReceipts[0].postAttempted,false);assert.equal(fixture.store.state.openingReceipts[0].unknown,false);
});
test('clock reader throw also closes instance before source reads or writes',async()=>{
 const fixture=laneFixture({now:instant('16:00:00')}),original=clone(fixture.store.state);fixture.lane.clock=()=>{throw Error('synthetic clock read failure');};await fixture.lane.tick();assert.equal(fixture.lane.clockBlocked,true);assert.equal(fixture.counts.plans,0);assert.equal(fixture.counts.posts,0);assert.deepEqual(fixture.store.state,original);fixture.lane.clock=()=>instant('16:30:00');await fixture.lane.tick();assert.equal(fixture.counts.posts,0);
});
test('already invoked in-window POST may finish after 17 but cannot start next recipient',async()=>{
 const next=message({recipient:{id:'ou_fixture_next',type:'open_id',name:'Next synthetic'}}),fixture=laneFixture({now:instant('16:59:59.900'),messages:[message(),next],fetch:async({clock})=>{clock.now=instant('17:00:00');return {ok:true,json:async()=>({code:0,data:{message_id:'opaque-completed-after-window'}})};}});await fixture.lane.tick();assert.equal(fixture.counts.posts,1);assert.equal(fixture.store.state.openingReceipts.length,1);assert.equal(fixture.store.state.openingReceipts[0].state,'sent');assert.equal(fixture.store.state.openingReceipts[0].autoHold,true);
});
