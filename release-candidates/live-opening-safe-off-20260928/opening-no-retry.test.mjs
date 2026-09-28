import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {WorkflowStore} from '/app/workflow-store.mjs';
import {createOpeningSender} from '/app/opening-notifications.mjs';
import {clone,message,plan,MemoryStore,laneFixture,legacyRow} from './fixture-support.mjs';

// Preserve the original 86 protocol cases at two valid times; late-window rejection is separate.
const times=['16:00:00','16:30:00'];
const current=readFileSync('/app/server.mjs');
test('frozen hard-OFF server and original actual source are preserved',()=>{
 assert.equal(createHash('sha256').update(current).digest('hex'),'af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd');
 assert.equal(createHash('sha256').update(readFileSync('/qa/opening-notifications.original.mjs')).digest('hex'),'8c1346a53ff70b6d49a0d5a7885645e77dd4914e62ddd3283f802eed36affd1a');
 assert.match(current.toString(),/Hard OFF[^\n]*\n\s*enabled:false,/u);
});

for(const time of times){
 const now=Date.parse(`2026-09-28T${time}+08:00`);
 test(`OFF remains inert at ${time}`,async()=>{
  const fixture=laneFixture({now,enabled:false});
  const before=clone(fixture.store.state);
  await Promise.all(Array.from({length:257},()=>fixture.lane.tick()));
  assert.equal(fixture.counts.plans,0);assert.equal(fixture.counts.posts,0);assert.equal(fixture.store.events.length,0);assert.deepEqual(fixture.store.state,before);
 });
 test(`valid opaque success at ${time} needs prepared and durable intent before actual fake fetch`,async()=>{
  const fixture=laneFixture({now,fetch:async({store})=>{
   const row=store.read().openingReceipts[0];assert.equal(row.state,'sending');assert.equal(row.unknown,false);assert.equal(row.postAttempted,null);assert.equal(row.autoHold,true);assert.ok(row.postIntentAt);assert.match(row.requestHash,/^[a-f0-9]{64}$/u);
   return {ok:true,status:200,json:async()=>({code:0,data:{message_id:'not-an-invented-id-format'}})};
  }});
  await fixture.lane.tick();assert.equal(fixture.counts.posts,1);assert.equal(fixture.store.state.openingReceipts[0].state,'sent');assert.equal(fixture.store.state.openingReceipts[0].unknown,false);assert.equal(fixture.store.state.openingReceipts[0].autoHold,true);
 });
 const failures={throw:()=>{throw Error('synthetic network uncertainty');},invalidJson:()=>({ok:true,status:200,json:async()=>{throw Error('bad JSON');}}),rateLimit:()=>({ok:false,status:429,json:async()=>({code:999})}),serverError:()=>({ok:false,status:500,json:async()=>({})}),missingId:()=>({ok:true,status:200,json:async()=>({code:0,data:{}})}),blankId:()=>({ok:true,status:200,json:async()=>({code:0,data:{message_id:'  '}})}),nonStringId:()=>({ok:true,status:200,json:async()=>({code:0,data:{message_id:{id:'fixture'}}})}),wrongCode:()=>({ok:true,status:200,json:async()=>({code:'0',data:{message_id:'synthetic'}})}),truthyOk:()=>({ok:'yes',status:200,json:async()=>({code:0,data:{message_id:'synthetic'}})})};
 for(const [name,response] of Object.entries(failures))test(`POST ${name} is unknown and never retried at ${time}`,async()=>{
  const fixture=laneFixture({now,fetch:response});await fixture.lane.tick();assert.equal(fixture.counts.posts,1);
  const row=clone(fixture.store.state.openingReceipts[0]);assert.equal(row.state,'attention');assert.equal(row.unknown,true);assert.equal(row.postAttempted,true);
  for(const elapsed of [125000,3599999,3600000,3600001]){
   const again=laneFixture({store:fixture.store,now:now+elapsed,messages:[message({text:'changed source key'})]});await again.lane.tick();assert.equal(again.counts.posts,0);assert.deepEqual(fixture.store.state.openingReceipts[0],row);
  }
 });
 for(const phase of ['prepared','intent','result'])for(const mode of ['before','after'])test(`${phase} persistence ${mode} failure cannot automatically resend at ${time}`,async()=>{
  const store=new MemoryStore([],{fault:{phase,mode}}),fixture=laneFixture({store,now});await fixture.lane.tick();assert.equal(fixture.lane.storageBlocked,true);
  assert.equal(fixture.counts.posts,phase==='result'?1:0);if(phase==='prepared')assert.equal(fixture.counts.sendCalls,0);
  fixture.clock.now+=125000;await fixture.lane.tick();assert.equal(fixture.counts.posts,phase==='result'?1:0);
  if(store.state.openingReceipts.length){
   const previous=clone(store.state.openingReceipts[0]);const restarted=laneFixture({store,now:now+125000,messages:[message({text:'new body new key after storage fault'})]});await restarted.lane.tick();assert.equal(restarted.counts.posts,0);assert.deepEqual(store.state.openingReceipts[0],previous);
  }
 });
 for(const phase of ['prepared','sending','sent'])test(`${phase} readback failure holds restart and does not invent post evidence at ${time}`,async()=>{
  const store=new MemoryStore([],{readFail:s=>s.openingReceipts.some(r=>r.state===phase)}),fixture=laneFixture({store,now});await fixture.lane.tick();assert.equal(fixture.lane.storageBlocked,true);assert.equal(fixture.counts.posts,phase==='sent'?1:0);
  const held=clone(store.state.openingReceipts[0]);const restarted=laneFixture({store,now:now+125000,messages:[message({text:'changed after readback failure'})]});await restarted.lane.tick();assert.equal(restarted.counts.posts,0);assert.deepEqual(store.state.openingReceipts[0],held);
  if(phase==='sending'){assert.equal(held.postAttempted,null);assert.equal(held.unknown,false);}
 });
 for(const state of ['prepared','sending','uncertain','unknown'])test(`legacy ${state} old-room/no-role receipt freezes changed-key scope at ${time}`,async()=>{
  const old=message(),row=legacyRow(old,{state,unknown:state==='uncertain',leaseUntil:now-1}),store=new MemoryStore([row]);
  const fixture=laneFixture({store,now,messages:[message({text:'new plan and body'})]});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.deepEqual(store.state.openingReceipts,[row]);
 });
 test(`known pre-token failure at ${time} is not falsely labelled POST or unknown`,async()=>{
  const fixture=laneFixture({now,token:()=>{throw Error('synthetic credential read failure');}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);const row=fixture.store.state.openingReceipts[0];assert.equal(row.state,'attention');assert.equal(row.unknown,false);assert.equal(row.postAttempted,false);assert.equal(row.autoHold,true);
 });
 test(`stillValid throw at ${time} is known before POST`,async()=>{
  const fixture=laneFixture({now,readPlan:n=>{if(n===3)throw Error('fixture source failure');return plan([message()]);}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.store.state.openingReceipts[0].unknown,false);assert.equal(fixture.store.state.openingReceipts[0].postAttempted,false);
 });
 test(`custom sent without mandatory final barrier at ${time} cannot satisfy group dependency`,async()=>{
  const direct=message(),group=message({kind:'group',recipient:{id:'oc_3f92ef62d6160399ee823e74def199e6',type:'chat_id',name:'Fixture only'},requires:[direct.key],text:'Synthetic group summary'});
  const fixture=laneFixture({now,messages:[direct,group],customSend:async()=>({state:'sent',messageId:'fake-untrusted',unknown:false,postAttempted:true})});await fixture.lane.tick();assert.equal(fixture.counts.sendCalls,1);assert.equal(fixture.store.state.openingReceipts[0].unknown,true);assert.equal(fixture.store.state.openingReceipts[0].postAttempted,null);assert.equal(fixture.store.state.openingReceipts[0].state,'attention');assert.equal(fixture.store.state.openingReceipts.length,1);
 });
 test(`custom sender throw at ${time} holds risk without inventing actual POST evidence`,async()=>{
  const fixture=laneFixture({now,customSend:async()=>{throw Error('synthetic uninstrumented sender');}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);const held=clone(fixture.store.state.openingReceipts[0]);assert.equal(held.unknown,true);assert.equal(held.postAttempted,null);assert.equal(held.autoHold,true);const restart=laneFixture({store:fixture.store,messages:[message({text:'new key after uninstrumented sender'})],now:now+125000});await restart.lane.tick();assert.equal(restart.counts.posts,0);assert.deepEqual(fixture.store.state.openingReceipts[0],held);
 });
 test(`same-instance and two-instance concurrent ticks allow at most one POST at ${time}`,async()=>{
  const store=new MemoryStore(),one=laneFixture({store,now}),two=laneFixture({store,now});await Promise.all([...Array.from({length:257},()=>one.lane.tick()),two.lane.tick()]);assert.equal(one.counts.posts+two.counts.posts,1);assert.equal(store.state.openingReceipts.length,1);
 });
 test(`marker-readback continuation delay is caught by final fresh clock at ${time}`,async()=>{
  let fixture,queued=false;const store=new MemoryStore([],{onRead:(_s,r)=>{if(!queued&&r.openingReceipts[0]?.state==='sending'){queued=true;queueMicrotask(()=>{fixture.clock.now+=1200;});}}});fixture=laneFixture({store,now});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(store.state.openingReceipts[0].unknown,false);assert.equal(store.state.openingReceipts[0].postAttempted,false);assert.equal(store.state.openingReceipts[0].autoHold,true);
 });
 test(`final synchronous journal read delay is checked after IO at ${time}`,async()=>{
  let fixture,reads=0;const store=new MemoryStore([],{onRead:(_s,r)=>{if(r.openingReceipts[0]?.state==='sending'&&++reads===2)fixture.clock.now+=1200;}});fixture=laneFixture({store,now});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(store.state.openingReceipts[0].unknown,false);
 });
}

test('unknown legacy scope does not freeze other room day or recipient; valid old sent is not uncertain',async()=>{
 const old=message(),row=legacyRow(old);
 for(const changed of [{room:'Fixture room B',roomCode:'fixture_b'},{date:'2026-09-30'},{recipient:{id:'ou_fixture_other',type:'open_id',name:'Fixture other'}}]){
  const candidate=message({...changed,text:'changed independently'}),store=new MemoryStore([row]),now=Date.parse(`${candidate.date}T16:00:00+08:00`)-86400000;const fixture=laneFixture({store,now,messages:[candidate]});await fixture.lane.tick();assert.equal(fixture.counts.posts,1);assert.deepEqual(store.state.openingReceipts[0],row);
 }
 const good=legacyRow(old,{state:'sent',unknown:false,messageId:'opaque-valid-old-id'}),store=new MemoryStore([good]),fixture=laneFixture({store,messages:[message({text:'new verified plan'})]});await fixture.lane.tick();assert.equal(fixture.counts.posts,1);assert.deepEqual(store.state.openingReceipts[0],good);
});
test('new persisted autoHold remains after confirmed success and blocks changed-key scope',async()=>{
 const fixture=laneFixture();await fixture.lane.tick();const good=clone(fixture.store.state.openingReceipts[0]);assert.equal(good.state,'sent');assert.equal(good.autoHold,true);const restart=laneFixture({store:fixture.store,messages:[message({text:'new source text after known success'})],now:fixture.clock.now+125000});await restart.lane.tick();assert.equal(restart.counts.posts,0);assert.deepEqual(fixture.store.state.openingReceipts[0],good);
});
test('known no-POST sender does not accept missing durable intent callback',async()=>{
 let posts=0;const sender=createOpeningSender({enabled:true,appId:'cli_aa9c744d6ffa1cc4',tenantToken:async()=> 'synthetic-token',fetch:async()=>{posts++;}});const result=await sender(message(),'fixture-uuid',async()=>true);assert.equal(posts,0);assert.equal(result.unknown,false);assert.equal(result.postAttempted,false);
});
test('source delay across midnight cannot send the stale original day',async()=>{
 const fixture=laneFixture({now:Date.parse('2026-09-28T16:30:00+08:00'),token:clock=>{clock.now+=8*3600000;return 'synthetic-token';}});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.store.state.openingReceipts[0].unknown,false);
});
test('missing legacy scope identity and invalid success IDs fail closed without changing old rows',async()=>{
 for(const row of [{state:'unknown',unknown:true},{...legacyRow(message()),state:'sent',unknown:false,messageId:{unverified:'not a string'}}]){
  const store=new MemoryStore([row]),fixture=laneFixture({store,messages:[message({text:'new key'})]});await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.deepEqual(store.state.openingReceipts,[row]);
 }
});

function requestHash(msg,uuid){
 const url='https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type='+msg.recipient.type;
 const body=JSON.stringify({receive_id:msg.recipient.id,msg_type:'text',uuid,content:JSON.stringify({text:msg.text})});
 return createHash('sha256').update(JSON.stringify([url,body])).digest('hex');
}
async function openFixtureBarrier(msg,uuid,stillValid,beforePost){
 assert.equal(await stillValid(),true);const hash=requestHash(msg,uuid),check=await beforePost(hash);assert.equal(typeof check,'function');assert.equal(check(hash),true);
}
for(const time of times){
 const now=Date.parse(`2026-09-28T${time}+08:00`);
 for(const claim of ['sent','knownNotPosted'])test(`custom sender barrier then fake ${claim} is not an attested outcome at ${time}`,async()=>{
  const direct=message(),group=message({kind:'group',recipient:{id:'oc_3f92ef62d6160399ee823e74def199e6',type:'chat_id',name:'Fixture only'},requires:[direct.key],text:'Synthetic group summary'});
  const fixture=laneFixture({now,messages:[direct,group],customSend:async(...args)=>{await openFixtureBarrier(...args);return claim==='sent'?{state:'sent',messageId:'fabricated',unknown:false,postAttempted:true}:{state:'attention',unknown:false,postAttempted:false};}});
  await fixture.lane.tick();assert.equal(fixture.counts.posts,0);assert.equal(fixture.counts.sendCalls,1);assert.equal(fixture.store.state.openingReceipts.length,1);assert.equal(fixture.store.state.openingReceipts[0].unknown,true);assert.equal(fixture.store.state.openingReceipts[0].postAttempted,null);
 });
 test(`actual adapter result is immutable and copied or mutated claims are rejected at ${time}`,async()=>{
  let actualPosts=0;const sender=createOpeningSender({enabled:true,appId:'cli_aa9c744d6ffa1cc4',tenantToken:async()=> 'synthetic-only',fetch:async()=>{actualPosts++;return {ok:true,json:async()=>({code:0,data:{message_id:'opaque-native-fixture'}})};}});
  const fixture=laneFixture({now,customSend:async(...args)=>{const trusted=await sender(...args);assert.equal(Object.isFrozen(trusted),true);assert.throws(()=>{trusted.messageId='mutated';},TypeError);return {...trusted,messageId:'copied-unverified'};}});await fixture.lane.tick();assert.equal(actualPosts,1);assert.equal(fixture.store.state.openingReceipts[0].unknown,true);assert.equal(fixture.store.state.openingReceipts[0].postAttempted,null);assert.equal(fixture.store.state.openingReceipts[0].messageId,undefined);
 });
 test(`previous adapter capability cannot be replayed for another scope or invocation at ${time}`,async()=>{
  let prior,actualPosts=0;const sender=createOpeningSender({enabled:true,appId:'cli_aa9c744d6ffa1cc4',tenantToken:async()=> 'synthetic-only',fetch:async()=>{actualPosts++;return {ok:true,json:async()=>({code:0,data:{message_id:'opaque-once'}})};}});
  const first=laneFixture({now,customSend:async(...args)=>(prior=await sender(...args))});await first.lane.tick();assert.equal(first.store.state.openingReceipts[0].state,'sent');
  for(const candidate of [message(),message({room:'Fixture room B',roomCode:'fixture_b',recipient:{id:'ou_fixture_b',type:'open_id',name:'Fixture B'}})]){
   const replay=laneFixture({now,messages:[candidate],customSend:async(...args)=>{await openFixtureBarrier(...args);return prior;}});await replay.lane.tick();assert.equal(replay.store.state.openingReceipts[0].unknown,true);assert.equal(replay.store.state.openingReceipts[0].postAttempted,null);assert.equal(replay.store.state.openingReceipts[0].messageId,undefined);
  }
  assert.equal(actualPosts,1);
 });
 for(const mode of ['before','after'])test(`direct result commit ${mode} failure cannot release group on restart or changed group key at ${time}`,async()=>{
  const direct=message(),group=message({kind:'group',recipient:{id:'oc_3f92ef62d6160399ee823e74def199e6',type:'chat_id',name:'Fixture only'},requires:[direct.key],text:'Synthetic summary'}),store=new MemoryStore([],{fault:{phase:'result',mode}}),first=laneFixture({store,now,messages:[direct,group]});await first.lane.tick();assert.equal(first.counts.posts,1);assert.equal(first.lane.storageBlocked,true);const held=clone(store.state.openingReceipts[0]);
  for(const nextGroup of [group,message({...group,key:undefined,text:'changed summary key'})]){
   const restart=laneFixture({store,now:now+125000,messages:[direct,nextGroup]});await restart.lane.tick();assert.equal(restart.counts.posts,0);assert.deepEqual(store.state.openingReceipts,[held]);
  }
 });
 test(`new confirmed sent remains group-held while valid legacy no-hold receipt releases its own dependency at ${time}`,async()=>{
  const direct=message(),group=message({kind:'group',recipient:{id:'oc_3f92ef62d6160399ee823e74def199e6',type:'chat_id',name:'Fixture only'},requires:[direct.key],text:'Synthetic summary'}),fresh=laneFixture({now,messages:[direct,group]});await fresh.lane.tick();assert.equal(fresh.counts.posts,1);assert.equal(fresh.store.state.openingReceipts.length,1);assert.equal(fresh.store.state.openingReceipts[0].autoHold,true);
  const valid=legacyRow(direct,{state:'sent',unknown:false,messageId:'opaque-valid-legacy'}),store=new MemoryStore([valid]),legacy=laneFixture({store,now,messages:[direct,group]});await legacy.lane.tick();assert.equal(legacy.counts.posts,1);assert.equal(store.state.openingReceipts[1].kind,'group');assert.equal(store.state.openingReceipts[1].state,'sent');assert.deepEqual(store.state.openingReceipts[0],valid);
 });
}

function startWorker(journal,log,now,text,mode='normal'){
 const child=fork('/qa/opening-no-retry-worker.mjs',[journal,log,String(now),text,mode],{stdio:['ignore','pipe','pipe','ipc']});
 let errorText='';child.stderr.on('data',chunk=>{errorText+=chunk.toString();});child.stdout.resume();
 const ready=new Promise((resolve,reject)=>{child.once('error',reject);child.on('message',message=>{if(message.ready)resolve();});});
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,errorText}));});
 return {child,ready,exit};
}
for(const time of times){
 const now=Date.parse(`2026-09-28T${time}+08:00`);
 test(`actual WorkflowStore across two independent Node processes holds a single scope at ${time}`,{timeout:10000},async()=>{
  const root=mkdtempSync('/tmp/opening-no-retry-race-'),journal=root+'/journal.json',log=root+'/synthetic-posts.ndjson',store=new WorkflowStore(journal);store.transaction(s=>{s.openingReceipts=[];s.fixturePreserved={unknownCount:7};});
  const a=startWorker(journal,log,now,'shared synthetic body'),b=startWorker(journal,log,now,'shared synthetic body');await Promise.all([a.ready,b.ready]);a.child.send({start:true});b.child.send({start:true});const ended=await Promise.all([a.exit,b.exit]);for(const e of ended)assert.equal(e.code,0,e.errorText);
  const lines=existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean):[];assert.equal(lines.length,1);assert.equal(store.read().openingReceipts.length,1);assert.equal(store.read().openingReceipts[0].autoHold,true);assert.deepEqual(store.read().fixturePreserved,{unknownCount:7});
 });
 test(`actual child exits after fake POST; restart after expired old lease with new key stays held at ${time}`,{timeout:10000},async()=>{
  const root=mkdtempSync('/tmp/opening-no-retry-crash-'),journal=root+'/journal.json',log=root+'/synthetic-posts.ndjson',store=new WorkflowStore(journal);store.transaction(s=>{s.openingReceipts=[];});
  const first=startWorker(journal,log,now,'synthetic old body','exit-after-post');await first.ready;first.child.send({start:true});assert.equal((await first.exit).code,23);const intent=clone(store.read().openingReceipts[0]);assert.equal(intent.state,'sending');assert.equal(intent.postAttempted,null);assert.equal(intent.unknown,false);assert.equal(intent.autoHold,true);
  const restarted=startWorker(journal,log,now+125000,'new body new key after restart');await restarted.ready;restarted.child.send({start:true});const result=await restarted.exit;assert.equal(result.code,0,result.errorText);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);assert.deepEqual(store.read().openingReceipts[0],intent);
 });
}
