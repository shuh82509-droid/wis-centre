// Independent synthetic review only: no external APIs, formal data, permits, or production writes.
// Data-URL imports keep the reviewed runtime bytes unchanged. The source scheduler is explicitly
// substituted; these fixtures prove safety state/clock behavior, not real schedule or human receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const base=new URL('.',import.meta.url);
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const runtimeBytes=readFileSync(new URL('opening-notifications.mjs',base));
const runtimeUrl=dataUrl(runtimeBytes.toString().replace("import {scheduleSessions} from './live-session-flow.mjs';","const scheduleSessions=()=>{throw Error('Independent safety fixtures do not exercise the real source scheduler')};"));
const supportUrl=dataUrl(readFileSync(new URL('fixture-support.mjs',base),'utf8').replace("'/app/opening-notifications.mjs'",JSON.stringify(runtimeUrl)));
const {clone,message,plan,MemoryStore,laneFixture,legacyRow}=await import(supportUrl);
const instant=time=>Date.parse(`2026-09-28T${time}+08:00`);
const sourceHash=createHash('sha256').update(runtimeBytes).digest('hex');
test(`independent fixture source SHA ${sourceHash}`,()=>assert.equal(sourceHash,'320af5fda2726b2b5ec7d45185929f48dac9f6fbbbf597209b4b76327952a9e7'));

// Exercise the reviewed plan()'s own before/after readSchedule clock checks. Only the
// scheduler dependency is a fictional-slot surrogate; neither a real table nor identity is read.
const scheduleSurrogate="const scheduleSessions=()=>[{anchor:'fictional-only',assistantShifts:[],assistants:[],startAt:'2026-09-29T16:00:00+08:00',endAt:'2026-09-29T17:00:00+08:00'}];";
const planRuntimeUrl=dataUrl(runtimeBytes.toString().replace("import {scheduleSessions} from './live-session-flow.mjs';",scheduleSurrogate));
const {OpeningNotifications:PlanLane,createOpeningSender:planSender}=await import(planRuntimeUrl);
function actualPlanFixture(stage,bad){
 const store=new MemoryStore(),clock={now:instant('16:00:00')},counts={sourceReads:0,posts:0};
 const notifier={enabled:true,appId:'cli_aa9c744d6ffa1cc4',tenantToken:async()=>'synthetic-token-only',fetch:async()=>{counts.posts++;return {ok:true,json:async()=>({code:0,data:{message_id:'synthetic-plan-transport-id'}})};}};
 const lane=new PlanLane({store,clock:()=>clock.now,enabled:true,send:planSender(notifier),readSchedule:async()=>{
  counts.sourceReads++;if(counts.sourceReads===stage)clock.now=bad;
  return {rooms:[{code:'youxuan',name:'Fictional source room'}],issues:[]};
 },participants:()=>({people:()=>[],recipient:()=>({id:'ou_fictional_only',type:'open_id',name:'Fictional recipient'})})});
 return {lane,store,clock,counts};
}
test('unmodified plan() clock route reaches one synthetic POST on stable valid fixture',async()=>{
 const fixture=actualPlanFixture(0,undefined);await fixture.lane.tick();
 assert.equal(fixture.counts.sourceReads,4);assert.equal(fixture.counts.posts,1);
});

const invalidTimes=[['NaN',NaN],['Infinity',Infinity],['negative Infinity',-Infinity],['beyond Date range',8640000000000001]];
for(const [label,bad] of invalidTimes)for(const stage of [1,2,3,4])test(`unmodified plan() source read ${stage} returning invalid ${label} blocks before POST`,async()=>{
 const fixture=actualPlanFixture(stage,bad);await fixture.lane.tick();
 assert.equal(fixture.counts.posts,0);assert.equal(fixture.lane.clockBlocked,true);
 const held=clone(fixture.store.state),reads=fixture.counts.sourceReads;
 fixture.clock.now=instant('16:02:00');await fixture.lane.tick();
 assert.equal(fixture.counts.posts,0);assert.equal(fixture.counts.sourceReads,reads);assert.deepEqual(fixture.store.state,held);
});
const stages=['token','source 1','source 2','source 3','source 4','status commit','prepared commit','intent commit','prepared readback','intent readback','final readback'];
for(const [label,bad] of invalidTimes)for(const stage of stages){
 test(`invalid ${label} at ${stage}: no POST, no invented POST evidence, same instance stays blocked`,async()=>{
  let fixture,sendingReads=0;
  const store=new MemoryStore([],{
   onCommit:(_s,phase)=>{if(stage===`${phase} commit`)fixture.clock.now=bad;},
   onRead:(_s,row)=>{
    const state=row.openingReceipts[0]?.state;
    if(state==='sending')sendingReads++;
    if(stage==='prepared readback'&&state==='prepared'||stage==='intent readback'&&state==='sending'&&sendingReads===1||stage==='final readback'&&state==='sending'&&sendingReads===2)fixture.clock.now=bad;
   }
  });
  fixture=laneFixture({store,now:instant('16:00:00'),token:clock=>{if(stage==='token')clock.now=bad;return 'synthetic-only';},readPlan:(n,clock)=>{if(stage===`source ${n}`)clock.now=bad;return plan([message()]);}});
  await fixture.lane.tick();
  assert.equal(fixture.counts.posts,0);
  assert.equal(fixture.lane.clockBlocked,true);
  for(const row of store.state.openingReceipts){
   assert.equal(row.unknown,false);
   assert.notEqual(row.postAttempted,true);
   assert.equal(row.messageId,undefined);
   assert.equal(row.autoHold,true);
  }
  const held=clone(store.state);
  fixture.clock.now=instant('16:02:00');await fixture.lane.tick();
  assert.equal(fixture.counts.posts,0);assert.deepEqual(store.state,held);
 });
}
for(const [label,bad] of invalidTimes){
 test(`invalid ${label} after actual synthetic POST: preserve intent, not sent, no same-instance or new-key restart retry`,async()=>{
  const original=message();
  const fixture=laneFixture({now:instant('16:00:00'),messages:[original],fetch:({clock})=>{clock.now=bad;return {ok:true,status:200,json:async()=>({code:0,data:{message_id:'synthetic-transport-id-only'}})};}});
  await fixture.lane.tick();assert.equal(fixture.counts.posts,1);
  assert.equal(fixture.lane.clockBlocked,true);assert.equal(fixture.lane.storageBlocked,true);
  const receipt=fixture.store.state.openingReceipts[0];
  assert.equal(receipt.state,'sending');assert.equal(receipt.postAttempted,null);
  assert.equal(receipt.unknown,false);assert.equal(receipt.messageId,undefined);assert.equal(receipt.autoHold,true);
  assert.ok(receipt.postIntentAt);
  const held=clone(fixture.store.state);
  fixture.clock.now=instant('16:02:00');await fixture.lane.tick();
  assert.equal(fixture.counts.posts,1);assert.deepEqual(fixture.store.state,held);
  const restart=laneFixture({store:fixture.store,now:instant('16:02:00'),messages:[message({...original,text:'Changed synthetic body'})]});
  await restart.lane.tick();assert.equal(restart.counts.posts,0);assert.deepEqual(restart.store.state.openingReceipts,held.openingReceipts);
 });
}
for(const resultMode of ['transport unknown','result before commit fault','result after commit fault','successful new held result']){
 test(`in-window 16:00 to 16:02 restart changed body remains held: ${resultMode}`,async()=>{
  const original=message(),store=new MemoryStore([],resultMode.startsWith('result ')?{fault:{phase:'result',mode:resultMode.includes('before')?'before':'after'}}:{});
  const first=laneFixture({store,now:instant('16:00:00'),messages:[original],fetch:resultMode==='transport unknown'?()=>{throw Error('Synthetic network result unknown');}:undefined});
  await first.lane.tick();assert.equal(first.counts.posts,1);assert.equal(store.state.openingReceipts[0].autoHold,true);
  const held=clone(store.state.openingReceipts);
  const restart=laneFixture({store,now:instant('16:02:00'),messages:[message({...original,text:'Changed synthetic body'})]});
  await restart.lane.tick();assert.equal(restart.counts.posts,0);assert.deepEqual(store.state.openingReceipts,held);
 });
}
for(const state of ['prepared','sending','uncertain','unknown']){
 test(`expired legacy ${state} and changed key at 16:02 freeze affected scope only`,async()=>{
  const original=message(),row=legacyRow(original,{state,unknown:state==='unknown'||state==='uncertain'}),store=new MemoryStore([row]);
  const changed=message({...original,text:'Changed synthetic body'}),other=message({room:'Other synthetic room',roomCode:'fixture_other'});
  const fixture=laneFixture({store,now:instant('16:02:00'),messages:[changed,other]});
  await fixture.lane.tick();assert.equal(fixture.counts.posts,1);assert.deepEqual(store.state.openingReceipts[0],row);
  assert.equal(store.state.openingReceipts.length,2);assert.equal(store.state.openingReceipts[1].key,other.key);
 });
}
for(const phase of ['intent','final'])test(`readback ${phase} releases microtask invalid clock before final actual sender continuation`,async()=>{
 let fixture,queued=false,sendingReads=0;
 const store=new MemoryStore([],{onRead:(_s,row)=>{
  if(row.openingReceipts[0]?.state==='sending')sendingReads++;
  if(!queued&&row.openingReceipts[0]?.state==='sending'&&(phase==='intent'?sendingReads===1:sendingReads===2)){
   queued=true;queueMicrotask(()=>{fixture.clock.now=NaN;});
  }
 }});
 fixture=laneFixture({store,now:instant('16:00:00')});await fixture.lane.tick();
 if(phase==='intent'){
  assert.equal(fixture.counts.posts,0);assert.equal(fixture.lane.clockBlocked,true);
  assert.equal(store.state.openingReceipts[0].postAttempted,false);assert.equal(store.state.openingReceipts[0].unknown,false);
 }else{
  // The final guard and fetch are the same synchronous continuation: a queued microtask cannot
  // run in between. It runs only after the synthetic fetch has already been invoked.
  assert.equal(fixture.counts.posts,1);assert.equal(fixture.lane.clockBlocked,true);
  assert.equal(store.state.openingReceipts[0].state,'sending');assert.equal(store.state.openingReceipts[0].autoHold,true);
 }
});
