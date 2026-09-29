import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FlowFeishu} from '../candidate/flow-feishu.mjs';
import {FlowFeishu as BaselineFlowFeishu} from '../baseline/flow-feishu.mjs';
import {WorkflowStore} from '../baseline/workflow-store.mjs';

// Author-only, finite synthetic fixtures. This file must be run only by the
// separately approved isolated QA runner. Every sender receives fetchImpl.
// No default server, OAuth grant, real source, recipient or credential is used.
// Native store faults below are explicitly synthetic transaction wrappers;
// they are not evidence that a real kernel write/fsync/rename failed.
const START=Date.parse('2026-09-29T08:00:00Z');
const TOKEN_URL='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const IM_PREFIX='https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=';
const sha=value=>createHash('sha256').update(value).digest('hex');
const jsonSha=value=>sha(JSON.stringify(value));
const uuid=id=>sha(id).slice(0,32);
const stale=()=>({checkedAt:new Date(START-45001).toISOString()});
const fresh=()=>({checkedAt:new Date(START).toISOString()});
const manager={canManage:true,user:{number:'TOY'}};
const clone=value=>structuredClone(value);

function fixture(Sender=FlowFeishu){
  const f={now:START,transactions:0,tokenCalls:0,officialCalls:0,posts:[],errors:[],
    state:{schemaVersion:3,tasks:[],flowNotifications:[]},
    people:[{number:'TOY',name:'Synthetic person',active:true}],
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'toy-app',
      FEISHU_APP_SECRET:'toy-secret',FEISHU_RECIPIENT_MAP_JSON:'{"TOY":"toy-open-id"}',
      FLOW_PUBLIC_URL:'https://fixture.invalid/workflow-panorama/'}};
  f.store={read:()=>clone(f.state),transaction:fn=>{
    f.transactions++;f.beforeTransaction?.(f.state);
    return clone(fn(f.state));
  }};
  f.read=()=>f.store.read();
  f.change=fn=>f.store.transaction(fn);
  f.fetch=async(url,options)=>{
    assert.equal(options?.method,'POST');
    if(url===TOKEN_URL){
      f.tokenCalls++;await f.tokenHook?.(f);
      return f.tokenResponse?f.tokenResponse(f):Response.json({code:0,tenant_access_token:'toy-token',expire:7200});
    }
    assert.equal(url,IM_PREFIX+'open_id','all IM traffic stays in this explicit toy stub');
    const body=JSON.parse(options.body);
    assert.equal(body.receive_id,'toy-open-id');
    assert.equal(options.redirect,'error');
    f.posts.push({body:clone(body),url});
    return f.postResponse?f.postResponse(f,body):Response.json({code:0,data:{message_id:'toy-message-'+f.posts.length}});
  };
  f.makeSender=store=>new Sender(store||f.store,{clock:()=>f.now,people:()=>clone(f.people),env:clone(f.env),
    fetchImpl:f.fetch,verifyLiveNoticeSource:async n=>{
      f.officialCalls++;return f.officialHook?f.officialHook(f,n):true;
    }});
  f.sender=f.makeSender();
  f.add=(id,source,extra={})=>{
    const task={id,title:'Synthetic '+id,workflow:'04',acceptance:'Toy criterion',
      runtime:{state:'running',participants:['TOY'],manager:{number:'TOY'},nodes:[{
        id:'N',state:'ready',attempt:1,owner:{number:'TOY'},title:'Toy node'}]}};
    if(source!==undefined)task.runtime.localBusiness=clone(source);
    const notice={id:'notice-'+id,taskId:id,nodeId:'N',kind:'ready',recipient:'TOY',
      attempt:1,state:'ready',attempts:0,createdAt:new Date(f.now).toISOString(),
      nextAt:f.now,messageId:null,...clone(extra)};
    f.state.tasks.push(task);f.state.flowNotifications.push(notice);return {task,notice};
  };
  f.row=id=>f.read().flowNotifications.find(n=>n.id===id);
  f.advance=ms=>{f.now+=ms;};
  return f;
}

async function settle(sender,f){
  try{await sender.flush();return {fulfilled:true};}
  catch(error){f.errors.push({name:error?.name,status:error?.status});return {fulfilled:false};}
}
function expectNoPost(f){assert.equal(f.posts.length,0);}
function assertNotSent(row){assert.notEqual(row.state,'sent');assert.equal(row.messageId,null);}
function heldDigest(state){return jsonSha(state.flowNotifications.filter(n=>n.unknown===true));}
function assertOriginalMessage(f,id){
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].body.uuid,uuid(id));
  assert.equal(f.read().flowNotifications.filter(n=>n.id===id).length,1);
}
function writeChange(f,fn){f.change(s=>{fn(s);return true;});}

function nativeFixture(t,seed){
  const f=fixture();seed(f);
  const dir=mkdtempSync(join(tmpdir(),'wis-exact-fairness-toy-'));
  const resolved=resolve(dir),parent=resolve(tmpdir())+sep;
  assert.ok(resolved.startsWith(parent)&&resolved!==resolve(tmpdir()));
  t.after(()=>rmSync(resolved,{recursive:true,force:true}));
  const native=new WorkflowStore(join(resolved,'toy-state.json'));
  native.transaction(s=>{Object.assign(s,clone(f.state));return true;});
  f.native=native;f.store=native;f.sender=f.makeSender(native);return f;
}

test('scope: all 16 baseline pins and 15 unchanged candidate dependencies are exact ordinary source',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const pins={
    'flow-feishu.mjs':'58a94eb60df9021193c9b23480b73910ef857ade0428b655f21566e83954a635',
    'workflow-store.mjs':'2e1637b0a8f5d0f486a6b0c9de9841b6cce7762e7dedf905338fd0a784546c68',
    'flow-notice-validity.mjs':'be08a5cddc55a69a7a7798ee74a82b3e06781c1f8ff9806644a409f9fca8e80f',
    'live-next-day.mjs':'1c8bd853d58065f85287be896ae42930147f764b017f7c8c616bd167d0405b4e',
    'live-session-flow.mjs':'92fec5cd6a2178dfc74b3891da2ab959ec5383d262c74a924f5d716a9881d42c',
    'flow-runtime.mjs':'c09903abced2bd42548c4639341a52f9eca8d55f13f9989cbbc156e6e74f214c',
    'task-workflow.mjs':'0fe8dd453b96b7eb2a5df7bbd5a57ede1fd93aafa0e40d67abd344fb15bde45c',
    'flow-catalog.mjs':'26f2b8c009d19d21753a3968bb760e6b80be23d48f89593da86569582d8cac4c',
    'flow-evidence.mjs':'e65fbcb222f3c4631cc53cce1c6efb14199b351abfbc17988fd5750e4d1c7f4b',
    'flow-model.mjs':'6d5b6f81820c9ba593f0fe914e3842c650cd3b917190ecdfa6084064663ed4ee',
    'live-feishu-participants.mjs':'b043a6ec858af26b47e426e8650235c3679cc34e2c9bebb8eabf74e906d62d3b',
    'flow-definitions.mjs':'0ec1d5834a4dd4c52ebeb02254a61e3828c408b6156da3b925dd73029b9ce2a8',
    'flow-product.mjs':'c8b4cc9a66ea825a5de029ea3f86d3bbdf7f81564e0e6cc37a27cd033f1854df',
    'workflow-cloud.mjs':'c0f0415e7e5279586d6dbe5ccd74b1e9b802e6810993bee0ae3b9dffa1d563b6',
    'flow-locations.mjs':'f1a69978b20ac5db7f992c30f037a5f344705298a80661d77aff3dc0ae94c98e',
    'hr-data.mjs':'e4b0b3be8273862ebea24728adc3e4997ce9da9137593af3b923a01b1d4a0756',
  };
  for(const [name,pin] of Object.entries(pins)){
    const original=readFileSync(join(root,'baseline',name));assert.equal(sha(original),pin,name);
    if(name!=='flow-feishu.mjs')assert.deepEqual(readFileSync(join(root,'candidate',name)),original,name);
  }
  assert.equal(sha(readFileSync(join(root,'candidate','flow-feishu.mjs'))),
    'cae7fc8df477f14d851df939e58d27d4121a6f955f543d755bae15cb5d939e6c');
});

// These four tests reproduce unsafe behaviour of the byte-pinned actual
// baseline, not a hand-transcribed/shimmed class. Their assertions are NOT the
// candidate's desired behaviour and do not count as production acceptance.
test('baseline reproduction: five recurring stale rows starve sixth eligible row',async()=>{
  const f=fixture(BaselineFlowFeishu);for(let i=0;i<5;i++)f.add('old-stale-'+i,stale());
  const row=f.add('old-eligible');
  for(let i=0;i<3;i++){await f.sender.flush();f.advance(31001);}
  expectNoPost(f);assert.equal(row.notice.state,'ready');assert.equal(row.notice.attempts,0);
  assert.ok(f.state.flowNotifications.slice(0,5).every(n=>n.nextAt>START));
});
test('baseline reproduction: unknown under one hour is POSTed again and marked sent',async()=>{
  const f=fixture(BaselineFlowFeishu),row=f.add('old-unknown',undefined,{unknown:true,attempts:1,
    firstAttemptAt:new Date(START-1000).toISOString()});
  await f.sender.flush();assertOriginalMessage(f,row.notice.id);
  assert.equal(row.notice.state,'sent');assert.equal(row.notice.unknown,false);
});
test('baseline reproduction: known pre-POST token error is misclassified unknown',async()=>{
  const f=fixture(BaselineFlowFeishu),row=f.add('old-token');
  f.tokenResponse=()=>{throw new Error('toy baseline token failure');};
  await f.sender.flush();expectNoPost(f);assert.equal(row.notice.unknown,true);assertNotSent(row.notice);
});
test('baseline reproduction: ambiguous first POST auto-repeats same original UUID under one hour',async()=>{
  const f=fixture(BaselineFlowFeishu),row=f.add('old-post');
  f.postResponse=()=>{if(f.posts.length===1)throw new Error('toy baseline ambiguous POST');return Response.json({code:0,data:{message_id:'toy-later'}});};
  await f.sender.flush();assert.equal(f.posts.length,1);assert.equal(row.notice.unknown,true);
  f.advance(120001);await f.makeSender().flush();assert.equal(f.posts.length,2);
  assert.equal(f.posts[0].body.uuid,uuid(row.notice.id));assert.equal(f.posts[1].body.uuid,uuid(row.notice.id));
});

// 15 original Git fairness assertion bodies plus one explicitly adapted slow
// fixture. The immutable Git 20-case file remains separate and unchanged.
test('fairness: five recurring stale sources cannot starve an independent notice',async()=>{
  const f=fixture();for(let i=0;i<5;i++)f.add('blocked-'+i,stale());
  const {notice}=f.add('eligible'),originals=clone(f.state.flowNotifications.slice(0,5));
  for(let i=0;i<3;i++){await f.sender.flush();f.advance(31001);}
  assert.equal(notice.state,'sent');assert.equal(notice.attempts,1);assert.equal(f.posts.length,1);
  assert.deepEqual(f.state.flowNotifications.slice(0,5),originals);
});
test('fairness: 128 blocked rows do not consume five eligible leases',async()=>{
  const f=fixture();for(let i=0;i<128;i++)f.add('blocked-'+i,stale());
  for(let i=0;i<7;i++)f.add('eligible-'+i);
  await f.sender.flush();assert.equal(f.posts.length,5);
  assert.equal(f.state.flowNotifications.filter(n=>n.state==='sent').length,5);
  assert.ok(f.state.flowNotifications.slice(0,128).every(n=>n.attempts===0&&!n.firstAttemptAt&&!n.delivery&&!n.messageId));
  await f.sender.flush();assert.equal(f.posts.length,7);
});
const BLOCKED_SOURCES=[
  ['missing timestamp',{}],['invalid timestamp',{checkedAt:'bad'}],
  ['non-string timestamp',{checkedAt:START}],
  ['future timestamp',{checkedAt:new Date(START+1).toISOString()}],
  ['source issue',{checkedAt:new Date(START).toISOString(),issue:'toy hold'}],
];
for(const [name,source] of BLOCKED_SOURCES)test('fairness: '+name+' blocks only its source',async()=>{
  const f=fixture(),row=f.add('blocked',source),original=clone(row.notice);
  f.add('eligible');await f.sender.flush();assert.deepEqual(row.notice,original);
  assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].state,'sent');
});
test('fairness: source age 45000 is accepted and 45001 is not',async()=>{
  const f=fixture();f.add('fresh',{checkedAt:new Date(START-45000).toISOString()});
  const old=f.add('stale',stale());await f.sender.flush();assert.equal(f.posts.length,1);
  assert.equal(old.notice.state,'ready');assert.equal(old.notice.attempts,0);
});
test('fairness: refreshed source preserves ID and sends original once',async()=>{
  const f=fixture(),row=f.add('refresh',stale());await f.sender.flush();expectNoPost(f);
  row.task.runtime.localBusiness.checkedAt=new Date(f.now).toISOString();
  await f.sender.flush();await f.sender.flush();assert.equal(f.posts.length,1);
  assert.equal(row.notice.id,'notice-refresh');assert.equal(row.notice.attempts,1);
});
test('fairness: transaction selection rechecks source changes',async()=>{
  const f=fixture(),row=f.add('changes',fresh());f.add('eligible');
  f.beforeTransaction=()=>{row.task.runtime.localBusiness.issue='toy changed source';};
  await f.sender.flush();assert.equal(row.notice.attempts,0);assert.equal(row.notice.state,'ready');
  assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].state,'sent');
});
test('fairness: duplicate task IDs preserve first source gate',async()=>{
  const f=fixture(),row=f.add('duplicate',stale());
  const later=clone(row.task);delete later.runtime.localBusiness;f.state.tasks.push(later);
  f.add('eligible');await f.sender.flush();assert.equal(row.notice.attempts,0);
  assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].state,'sent');
});
test('fairness: only stale rows produce zero transactions and provider calls',async()=>{
  const f=fixture();for(let i=0;i<6;i++)f.add('blocked-'+i,stale());
  await f.sender.flush();assert.equal(f.transactions,0);expectNoPost(f);assert.equal(f.tokenCalls,0);
});
test('fairness: explicit disabled sender performs no transaction or provider call',async()=>{
  const f=fixture();f.add('eligible');f.sender.enabled=false;await f.sender.flush();
  expectNoPost(f);assert.equal(f.transactions,0);assert.equal(f.tokenCalls,0);
});
test('fairness: seven obsolete nodes retire without consuming acquired leases',async()=>{
  const f=fixture();for(let i=0;i<7;i++)f.add('obsolete-'+i).task.runtime.nodes[0].state='completed';
  f.add('eligible');await f.sender.flush();assert.equal(f.posts.length,1);
  assert.ok(f.state.flowNotifications.slice(0,7).every(n=>n.state==='superseded'&&n.attempts===0));
});
test('fairness: one slow selection ages source without repeatedly selecting deferred row',async()=>{
  const f=fixture(),row=f.add('slow',fresh());f.add('eligible');let once=false;
  // Deliberate adaptation of Git #19: only the selection phase is delayed.
  // Every-phase +60001ms would also expire final lease and must send zero.
  f.beforeTransaction=()=>{if(!once){once=true;f.advance(60001);}};
  await f.sender.flush();assert.equal(row.notice.state,'ready');assert.equal(row.notice.attempts,0);
  assert.equal(f.posts.length,1);assert.ok(f.transactions<10);
});
test('fairness: finite batch ignores notices appended during its transactions',async()=>{
  const f=fixture();f.add('first');let added=false;
  f.beforeTransaction=()=>{if(!added){added=true;f.add('later');}};
  await f.sender.flush();assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].attempts,0);
  f.beforeTransaction=null;await f.sender.flush();assert.equal(f.posts.length,2);
});

const UNKNOWN_STATES=['ready','sending','attention','sent','superseded','failed','prepared'];
const UNKNOWN_AGES=[
  ['new',0],['under one hour',3599999],['exactly one hour',3600000],
  ['older than one hour',3600001],['malformed',null],['future',-1],['missing',undefined],
];
for(const [ageName,age] of UNKNOWN_AGES)for(const order of ['forward','reverse'])
test('immutable barrier: seven unknown states / '+ageName+' / '+order,async()=>{
  const f=fixture();const states=order==='forward'?UNKNOWN_STATES:[...UNKNOWN_STATES].reverse();
  for(let i=0;i<states.length;i++){
    const extra={unknown:true,state:states[i],attempts:3,messageId:'toy-existing-'+i,
      delivery:{channel:'toy-history',msg_type:'text',content:'{"text":"Synthetic prior body"}'},
      nextAt:i%2?START+86400000:START-1,
      leaseId:'toy-prior-lease-'+i,leaseUntil:i%2?START+60000:START-1};
    if(age===null)extra.firstAttemptAt='malformed';
    else if(age!==undefined)extra.firstAttemptAt=new Date(START-age).toISOString();
    else extra.createdAt='malformed';
    f.add('history-'+i,i%2?fresh():stale(),extra);
  }
  const original=clone(f.state.flowNotifications),digest=heldDigest(f.read());
  for(let i=0;i<7;i++)f.add('eligible-'+i);
  await f.sender.flush();assert.equal(f.posts.length,5);
  assert.equal(heldDigest(f.read()),digest);assert.deepEqual(f.read().flowNotifications.slice(0,7),original);
  f.advance(120001);const restarted=f.makeSender();await restarted.flush();
  assert.equal(f.posts.length,7);assert.equal(heldDigest(f.read()),digest);
  assert.deepEqual(f.read().flowNotifications.slice(0,7),original);
  for(const n of original){assert.throws(()=>restarted.retry(manager,n.id));}
  assert.equal(heldDigest(f.read()),digest);assert.deepEqual(f.read().flowNotifications.slice(0,7),original);
});

// Isolate unknown from every other hold signal: no receipt/sentAt/intent,
// all sources valid (or absent), and every ready row due. The attention row also
// isolates retry's unknown guard from its ordinary state precondition.
for(const sourceMode of ['all fresh','all no-source'])
test('isolated unknown barrier: seven states without delivery facts / '+sourceMode,async()=>{
  const f=fixture();for(let i=0;i<UNKNOWN_STATES.length;i++){
    const [ageName,age]=UNKNOWN_AGES[i];
    const extra={unknown:true,state:UNKNOWN_STATES[i],attempts:i+1,messageId:null,nextAt:START-1};
    if(ageName==='malformed')extra.firstAttemptAt='malformed';
    else if(age!==undefined)extra.firstAttemptAt=new Date(START-age).toISOString();
    else extra.createdAt='malformed';
    f.add('isolated-unknown-'+i,sourceMode==='all fresh'?fresh():undefined,extra);
  }
  const original=clone(f.state.flowNotifications),digest=heldDigest(f.read());
  for(const row of original){
    assert.equal(row.messageId,null);
    for(const key of ['sentAt','sendIntent','futureEvidence'])assert.equal(Object.hasOwn(row,key),false);
  }
  for(let i=0;i<7;i++)f.add('isolated-eligible-'+i);
  await f.sender.flush();assert.equal(f.posts.length,5);
  assert.equal(heldDigest(f.read()),digest);assert.deepEqual(f.read().flowNotifications.slice(0,7),original);
  f.advance(120001);const restarted=f.makeSender();await restarted.flush();assert.equal(f.posts.length,7);
  assert.equal(heldDigest(f.read()),digest);assert.deepEqual(f.read().flowNotifications.slice(0,7),original);
  for(const row of original)assert.throws(()=>restarted.retry(manager,row.id));
  assert.equal(heldDigest(f.read()),digest);assert.deepEqual(f.read().flowNotifications.slice(0,7),original);
});
test('isolated sending barrier: expired lease without unknown, source or delivery facts remains immutable',async()=>{
  const f=fixture(),row=f.add('isolated-sending',undefined,{state:'sending',unknown:false,
    leaseId:'toy-expired-only',leaseUntil:START-1,attempts:1,
    firstAttemptAt:new Date(START-1000).toISOString(),messageId:null});
  for(const key of ['sentAt','sendIntent','futureEvidence'])assert.equal(Object.hasOwn(row.notice,key),false);
  const original=clone(row.notice),digest=jsonSha(original);
  for(let i=0;i<7;i++)f.add('sending-eligible-'+i);
  await f.sender.flush();assert.equal(f.posts.length,5);assert.equal(jsonSha(f.row(original.id)),digest);
  assert.deepEqual(f.read().flowNotifications[0],original);
  f.advance(120001);const restarted=f.makeSender();await restarted.flush();assert.equal(f.posts.length,7);
  assert.deepEqual(f.read().flowNotifications[0],original);assert.equal(jsonSha(f.row(original.id)),digest);
  assert.throws(()=>restarted.retry(manager,original.id));assert.equal(jsonSha(f.row(original.id)),digest);
});

for(const [name,leaseUntil] of [['expired',START-1],['future',START+60000],['missing',undefined]])
test('immutable barrier: pre-existing sending '+name+' lease is never re-acquired',async()=>{
  const f=fixture(),row=f.add('sending',fresh(),{state:'sending',leaseId:'toy-previous',leaseUntil,
    firstAttemptAt:new Date(START-1000).toISOString(),attempts:1,messageId:'toy-old-receipt'});
  const original=clone(row.notice),digest=jsonSha(original);
  for(let i=0;i<6;i++)f.add('eligible-'+i);
  await f.sender.flush();assert.equal(f.posts.length,5);assert.equal(jsonSha(f.row(original.id)),digest);
  f.advance(3600001);await f.makeSender().flush();assert.equal(f.posts.length,6);
  assert.deepEqual(f.row(original.id),original);assert.throws(()=>f.sender.retry(manager,original.id));
  assert.deepEqual(f.row(original.id),original);
});
const UNSUPPORTED_INTENTS=[
  ['future evidence prepared',{futureEvidence:{version:2,phase:'prepared'}}],
  ['future evidence null',{futureEvidence:null}],
  ['send intent prepared',{sendIntent:{leaseId:'toy-old',preparedAt:new Date(START).toISOString()}}],
  ['send intent null',{sendIntent:null}],
];
for(const [name,extra] of UNSUPPORTED_INTENTS)test('immutable barrier: '+name+' does not auto or manual retry',async()=>{
  const f=fixture(),row=f.add('intent',fresh(),extra),original=clone(row.notice);
  f.add('eligible');await f.sender.flush();assert.equal(f.posts.length,1);assert.deepEqual(row.notice,original);
  f.advance(3600001);await f.makeSender().flush();assert.equal(f.posts.length,1);assert.deepEqual(row.notice,original);
  // An explicitly constructed attention-view of the same unsupported intent
  // tests retry's own guard, not merely its existing state=attention check.
  row.notice.state='attention';const retryView=clone(row.notice);
  assert.throws(()=>f.sender.retry(manager,row.notice.id));assert.deepEqual(row.notice,retryView);
});

const FINAL_SOURCE_MUTATIONS=[
  ['aged to 45001',f=>f.advance(45001)],
  ['invalid checkedAt',f=>writeChange(f,s=>{s.tasks[0].runtime.localBusiness.checkedAt='bad';})],
  ['future checkedAt',f=>writeChange(f,s=>{s.tasks[0].runtime.localBusiness.checkedAt=new Date(f.now+1).toISOString();})],
  ['non-string checkedAt',f=>writeChange(f,s=>{s.tasks[0].runtime.localBusiness.checkedAt=f.now;})],
  ['missing checkedAt',f=>writeChange(f,s=>{delete s.tasks[0].runtime.localBusiness.checkedAt;})],
  ['new source issue',f=>writeChange(f,s=>{s.tasks[0].runtime.localBusiness.issue='toy new issue';})],
  ['creative source invalid',f=>writeChange(f,s=>{delete s.tasks[0].runtime.localBusiness;s.tasks[0].runtime.creative={checkedAt:'bad'};})],
];
for(const [name,change] of FINAL_SOURCE_MUTATIONS)test('final token boundary: '+name+' blocks IM POST',async()=>{
  const f=fixture(),{notice}=f.add('final-source',fresh());f.tokenHook=change;
  await settle(f.sender,f);expectNoPost(f);assertNotSent(f.row(notice.id));
});

const FINAL_STATE_MUTATIONS=[
  ['lease expires during token',f=>f.advance(45000)],
  ['lease ID changes',f=>writeChange(f,s=>{s.flowNotifications[0].leaseId='toy-replaced';})],
  ['lease removed',f=>writeChange(f,s=>{delete s.flowNotifications[0].leaseId;})],
  ['lease expiry removed',f=>writeChange(f,s=>{delete s.flowNotifications[0].leaseUntil;})],
  ['lease expiry extended',f=>writeChange(f,s=>{s.flowNotifications[0].leaseUntil+=45000;})],
  ['node owner changes',f=>writeChange(f,s=>{s.tasks[0].runtime.nodes[0].owner.number='TOY-OTHER';})],
  ['node attempt changes',f=>writeChange(f,s=>{s.tasks[0].runtime.nodes[0].attempt++;})],
  ['node completes',f=>writeChange(f,s=>{s.tasks[0].runtime.nodes[0].state='completed';})],
  ['task pauses',f=>writeChange(f,s=>{s.tasks[0].runtime.state='paused';})],
  ['recipient map changes',f=>{f.sender.map.TOY='toy-other-open-id';}],
  ['recipient is no longer active',f=>{f.people[0].active=false;}],
  ['notice recipient changes',f=>writeChange(f,s=>{s.flowNotifications[0].recipient='TOY-OTHER';})],
  ['persisted delivery changes',f=>writeChange(f,s=>{s.flowNotifications[0].delivery.content='{"text":"Synthetic changed body"}';})],
];
for(const [name,change] of FINAL_STATE_MUTATIONS)test('final token boundary: '+name+' is fail closed',async()=>{
  const f=fixture(),{notice}=f.add('final-state');f.tokenHook=change;
  await settle(f.sender,f);expectNoPost(f);assertNotSent(f.row(notice.id));
});
const CUSTOM_REASON_MUTATIONS=[
  ['source_attention issue cleared','source_attention',
    t=>{t.runtime.automation={issue:'toy source issue'};},
    t=>{t.runtime.automation.issue='';}],
  ['assignment_attention issue cleared','assignment_attention',
    t=>{t.runtime.assignmentIssue={message:'toy assignment issue'};},
    t=>{delete t.runtime.assignmentIssue;}],
  ['handoff_blocked attention cleared','handoff_blocked',
    t=>{t.runtime.handoff={state:'attention',error:'toy blocked'};},
    t=>{t.runtime.handoff.state='linked';}],
  ['routing_attention reasons cleared','routing_attention',
    t=>{t.runtime.routingIssues={toy:{message:'toy routing reason'}};},
    t=>{t.runtime.routingIssues={};}],
  ['creative completed becomes running','completed',
    t=>{t.runtime.creative=fresh();t.runtime.state='completed';},
    t=>{t.runtime.state='running';}],
];
for(const [name,kind,prepare,change] of CUSTOM_REASON_MUTATIONS)
test('custom reason token boundary: '+name+' blocks IM POST',async()=>{
  const f=fixture(),{task,notice}=f.add('custom-reason',undefined,{kind});prepare(task);
  f.tokenHook=()=>writeChange(f,s=>change(s.tasks[0]));
  await settle(f.sender,f);assert.equal(f.tokenCalls,1);expectNoPost(f);
  const row=f.row(notice.id);assert.equal(row.attempts,1);assertNotSent(row);
  assert.notEqual(row.unknown,true);assert.equal(Object.hasOwn(row,'sendIntent'),false);
});
for(const [name,change] of [
  ['source_attention reason changes',t=>{t.runtime.automation.issue='toy different issue';}],
  ['source_attention task stops running',t=>{t.runtime.state='paused';}],
])test('custom reason token boundary: '+name+' blocks IM POST',async()=>{
  const f=fixture(),{task,notice}=f.add('source-reason',undefined,{kind:'source_attention',reason:'toy initial issue'});
  task.runtime.automation={issue:'toy initial issue'};
  f.tokenHook=()=>writeChange(f,s=>change(s.tasks[0]));
  await settle(f.sender,f);assert.equal(f.tokenCalls,1);expectNoPost(f);
  const row=f.row(notice.id);assert.equal(row.attempts,1);assertNotSent(row);
  assert.notEqual(row.unknown,true);assert.equal(Object.hasOwn(row,'sendIntent'),false);
});
test('custom reason source boundary: creative completed becomes running blocks IM POST',async()=>{
  const f=fixture(),{task,notice}=f.add('completed-source',undefined,{kind:'completed'});
  task.runtime.creative=fresh();task.runtime.state='completed';
  task.runtime.liveSession={date:'2026-09-29',signature:'toy-completed-source'};
  f.officialHook=()=>{writeChange(f,s=>{s.tasks[0].runtime.state='running';});return true;};
  await settle(f.sender,f);assert.equal(f.tokenCalls,1);assert.equal(f.officialCalls,1);expectNoPost(f);
  const row=f.row(notice.id);assert.equal(row.attempts,1);assertNotSent(row);
  assert.notEqual(row.unknown,true);assert.equal(Object.hasOwn(row,'sendIntent'),false);
});
test('final synchronous transaction: lease expires after callback before store returns, zero POST',async()=>{
  const f=fixture(),{notice}=f.add('last-tx');const original=f.store.transaction;let injected=false;
  f.store.transaction=fn=>{
    const result=original(fn);
    if(!injected&&f.row(notice.id)?.sendIntent){injected=true;f.advance(45001);}
    return result;
  };
  await settle(f.sender,f);assert.equal(injected,true);expectNoPost(f);assertNotSent(f.row(notice.id));
  f.advance(3600001);await settle(f.makeSender(),f);expectNoPost(f);
});
for(const [name,clock] of [['invalid clock',NaN],['clock rollback',START-1]])
test('final token boundary: '+name+' blocks POST and preserves original ID',async()=>{
  const f=fixture(),{notice}=f.add('clock');f.tokenHook=()=>{f.now=clock;};
  await settle(f.sender,f);expectNoPost(f);assertNotSent(f.row(notice.id));assert.equal(f.row(notice.id).id,notice.id);
});

test('lease budget: five unmapped rows consume acquired leases, sixth waits until next flush',async()=>{
  const f=fixture();for(let i=0;i<5;i++){
    const recipient='TOY-UNMAPPED-'+i,row=f.add('unmapped-'+i,undefined,{recipient});
    row.task.runtime.nodes[0].owner.number=recipient;
    f.people.push({number:recipient,name:'Synthetic unmapped '+i,active:true});
  }
  f.add('eligible');await f.sender.flush();expectNoPost(f);
  assert.ok(f.state.flowNotifications.slice(0,5).every(n=>n.state==='attention'&&n.attempts===1));
  await f.sender.flush();assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[5].state,'sent');
});
test('lease budget: five unavailable cards consume acquired leases, sixth waits until next flush',async()=>{
  const f=fixture();for(let i=0;i<5;i++){
    const recipient='TOY-CARD-'+i,row=f.add('card-'+i,undefined,{recipient});
    row.task.runtime.nodes[0].owner.number=recipient;
    f.people.push({number:recipient,name:'Synthetic card '+i,active:true});
  }
  f.add('eligible');f.sender.liveCards={has:n=>n.startsWith('TOY-CARD-'),ready:()=>false,
    recipient:()=>({id:'toy-open-id',type:'open_id',name:'Synthetic card person'}),
    delivery:()=>{throw new Error('unavailable card must never build delivery');}};
  await f.sender.flush();expectNoPost(f);
  assert.ok(f.state.flowNotifications.slice(0,5).every(n=>n.state==='ready'&&n.nextAt>f.now&&!n.sendIntent));
  await f.sender.flush();assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[5].state,'sent');
});
for(const mode of ['false','throw'])test('official source: unreadable '+mode+' produces zero IM POST',async()=>{
  const f=fixture(),row=f.add('official');row.task.runtime.liveSession={date:'2026-09-29',signature:'toy-signature'};
  f.officialHook=()=>{if(mode==='throw')throw new Error('toy source unreadable');return false;};
  await settle(f.sender,f);assert.equal(f.officialCalls,1);expectNoPost(f);
  const current=f.row(row.notice.id);assertNotSent(current);assert.notEqual(current.unknown,true);
});

const TOKEN_FAILURES=[
  ['network throw',()=>{throw new Error('toy token network failure');}],
  ['JSON throw',()=>({ok:true,status:200,json:async()=>{throw new Error('toy token JSON failure');}})],
  ['authentication rejected',()=>Response.json({code:40001},{status:401})],
  ['server error',()=>Response.json({code:500},{status:500})],
  ['successful code missing token',()=>Response.json({code:0,expire:7200})],
  ['malformed token type',()=>Response.json({code:0,tenant_access_token:{toy:'not a token'},expire:7200})],
];
for(const [name,response] of TOKEN_FAILURES)test('known pre-POST token failure: '+name+' is not sent or unknown',async()=>{
  const f=fixture(),{notice}=f.add('token-fail');f.tokenResponse=response;
  await settle(f.sender,f);expectNoPost(f);let current=f.row(notice.id);
  assertNotSent(current);assert.notEqual(current.unknown,true);assert.equal(Object.hasOwn(current,'sendIntent'),false);
  f.advance(120001);await settle(f.makeSender(),f);expectNoPost(f);current=f.row(notice.id);
  assertNotSent(current);assert.notEqual(current.unknown,true);assert.equal(Object.hasOwn(current,'sendIntent'),false);
});

const POST_FAILURES=[
  ['network result unknown',()=>{throw new Error('toy IM uncertain');},true],
  ['response JSON unknown',()=>({ok:true,status:200,json:async()=>{throw new Error('toy IM JSON uncertain');}}),true],
  ['HTTP 500',()=>Response.json({code:500},{status:500}),true],
  ['HTTP 408',()=>Response.json({code:408},{status:408}),true],
  ['HTTP 409',()=>Response.json({code:409},{status:409}),true],
  ['HTTP 499',()=>Response.json({code:499},{status:499}),true],
  ['HTTP 429',()=>Response.json({code:429},{status:429}),false],
  ['success missing ID',()=>Response.json({code:0,data:{}}),true],
  ['success empty ID',()=>Response.json({code:0,data:{message_id:''}}),true],
  ['success object ID',()=>Response.json({code:0,data:{message_id:{toy:'invalid'}}}),true],
  ['explicit expired token response',()=>Response.json({code:99991663},{status:401}),false],
];
for(const [name,response,expectedUnknown] of POST_FAILURES)test('one-use IM POST: '+name+' holds original message across restart',async()=>{
  const f=fixture(),{notice}=f.add('post-fail');f.postResponse=response;
  await settle(f.sender,f);assertOriginalMessage(f,notice.id);let current=f.row(notice.id);
  assertNotSent(current);assert.equal(current.unknown,expectedUnknown);assert.ok(current.sendIntent);
  const digest=jsonSha(current);for(const age of [1,3599999,3600000,3600001]){
    f.now=START+age;await settle(f.makeSender(),f);assert.equal(f.posts.length,1);assert.equal(jsonSha(f.row(notice.id)),digest);
  }
  assert.throws(()=>f.makeSender().retry(manager,notice.id));assert.equal(jsonSha(f.row(notice.id)),digest);
  assert.equal(f.read().flowNotifications.length,1);
});

test('native store: two sender instances concurrently sharing one toy file POST only once',async t=>{
  const f=nativeFixture(t,x=>x.add('shared-native'));const second=f.makeSender(f.native);
  await Promise.all([settle(f.sender,f),settle(second,f)]);assertOriginalMessage(f,'notice-shared-native');
  assert.equal(f.row('notice-shared-native').state,'sent');f.advance(120001);
  await settle(f.makeSender(f.native),f);assert.equal(f.posts.length,1);
});
test('native store: successful sender reconstruction retains ID, receipt and permanent send intent',async t=>{
  const f=nativeFixture(t,x=>x.add('restart-native'));await settle(f.sender,f);
  assertOriginalMessage(f,'notice-restart-native');const prior=f.row('notice-restart-native');
  assert.equal(prior.state,'sent');assert.equal(typeof prior.messageId,'string');assert.ok(prior.sendIntent);
  f.advance(3600001);await settle(f.makeSender(new WorkflowStore(f.native.file)),f);
  assert.equal(f.posts.length,1);assert.deepEqual(f.row(prior.id),prior);assert.throws(()=>f.makeSender().retry(manager,prior.id));
});

for(const mode of ['before result mutation','after result mutation before native write','after native result write'])
test('native synthetic wrapper: '+mode+' failure cannot duplicate POST after restart',async t=>{
  const f=nativeFixture(t,x=>x.add('result-fault'));const native=f.native;let injected=false;
  f.store={read:()=>native.read(),transaction:fn=>{
    const resultPhase=f.posts.length===1&&!injected;
    if(resultPhase&&mode==='before result mutation'){injected=true;throw new Error('synthetic before result mutation');}
    const result=native.transaction(s=>{
      const output=fn(s);
      if(resultPhase&&mode==='after result mutation before native write'){
        injected=true;throw new Error('synthetic after result mutation before commit');
      }
      return output;
    });
    if(resultPhase&&mode==='after native result write'){injected=true;throw new Error('synthetic after committed native result');}
    return result;
  }};
  f.sender=f.makeSender(f.store);await settle(f.sender,f);assert.equal(injected,true);
  assertOriginalMessage(f,'notice-result-fault');const risk=native.read().flowNotifications[0];assert.ok(risk.sendIntent);
  f.advance(3600001);await settle(f.makeSender(new WorkflowStore(native.file)),f);assert.equal(f.posts.length,1);
  assert.throws(()=>f.makeSender(native).retry(manager,risk.id));assert.equal(f.posts[0].body.uuid,uuid(risk.id));
});

for(const mode of ['before intent mutation','after intent mutation before native write','after native intent write'])
test('native synthetic wrapper: '+mode+' failure produces zero first POST',async t=>{
  const f=nativeFixture(t,x=>x.add('intent-fault'));const native=f.native;let injected=false;
  f.store={read:()=>native.read(),transaction:fn=>{
    const before=native.read(),beforeRow=before.flowNotifications[0];
    const intentPhase=f.tokenCalls>0&&!f.posts.length&&!injected&&beforeRow.state==='sending'&&!Object.hasOwn(beforeRow,'sendIntent');
    if(intentPhase&&mode==='before intent mutation'){injected=true;throw new Error('synthetic before intent mutation');}
    const result=native.transaction(s=>{
      const output=fn(s),row=s.flowNotifications[0];
      if(intentPhase&&Object.hasOwn(row,'sendIntent')&&mode==='after intent mutation before native write'){
        injected=true;throw new Error('synthetic after intent mutation before commit');
      }
      return output;
    });
    if(intentPhase&&Object.hasOwn(native.read().flowNotifications[0],'sendIntent')&&mode==='after native intent write'){
      injected=true;throw new Error('synthetic after committed native intent');
    }
    return result;
  }};
  f.sender=f.makeSender(f.store);await settle(f.sender,f);assert.equal(injected,true);expectNoPost(f);
  const row=native.read().flowNotifications[0];assertNotSent(row);
  if(mode==='after native intent write'){
    assert.ok(row.sendIntent);const digest=jsonSha(row);f.advance(3600001);
    await settle(f.makeSender(new WorkflowStore(native.file)),f);expectNoPost(f);
    assert.equal(jsonSha(native.read().flowNotifications[0]),digest);
    assert.throws(()=>f.makeSender(native).retry(manager,'notice-intent-fault'));
  }else{
    // Callback-aborted/pre-mutation fault is proven not persisted and no IM
    // invocation occurred. The known pre-POST ready row may be retried safely.
    assert.equal(Object.hasOwn(row,'sendIntent'),false);assert.notEqual(row.unknown,true);
    assert.equal(row.state,'ready');f.advance(120001);
    await settle(f.makeSender(new WorkflowStore(native.file)),f);
    assertOriginalMessage(f,'notice-intent-fault');assert.equal(native.read().flowNotifications[0].state,'sent');
    await settle(f.makeSender(new WorkflowStore(native.file)),f);assert.equal(f.posts.length,1);
  }
});

test('native synthetic wrapper: result stored as ready then throw still leaves durable barrier',async t=>{
  const f=nativeFixture(t,x=>x.add('ready-after-write'));const native=f.native;let injected=false;
  f.store={read:()=>native.read(),transaction:fn=>{
    const resultPhase=f.posts.length===1&&!injected;
    const result=native.transaction(s=>{
      const output=fn(s);if(resultPhase){s.flowNotifications[0].state='ready';s.flowNotifications[0].unknown=false;}
      return output;
    });
    if(resultPhase){injected=true;throw new Error('synthetic applied ready result then throw');}
    return result;
  }};
  f.sender=f.makeSender(f.store);await settle(f.sender,f);assert.equal(injected,true);assertOriginalMessage(f,'notice-ready-after-write');
  const row=native.read().flowNotifications[0];assert.equal(row.state,'ready');assert.ok(row.sendIntent);
  f.advance(3600001);await settle(f.makeSender(new WorkflowStore(native.file)),f);assert.equal(f.posts.length,1);
  const attentionView=clone(row);attentionView.state='attention';native.transaction(s=>{s.flowNotifications[0]=attentionView;return true;});
  assert.throws(()=>f.makeSender(native).retry(manager,row.id));assert.equal(f.posts.length,1);
});
test('native store: seven synthetic historical unknown rows keep exact ordered SHA through independent sender restart',async t=>{
  const f=nativeFixture(t,x=>{
    for(let i=0;i<7;i++)x.add('native-history-'+i,stale(),{unknown:true,state:UNKNOWN_STATES[i],attempts:i,
      firstAttemptAt:i%2?'malformed':new Date(START-3600001).toISOString(),messageId:'toy-preserved-'+i,
      nextAt:i%2?START+86400000:START-1});
    x.add('native-eligible');
  });
  const before=f.native.read(),digest=heldDigest(before);await settle(f.sender,f);assert.equal(f.posts.length,1);
  assert.equal(heldDigest(f.native.read()),digest);f.advance(3600001);
  await settle(f.makeSender(new WorkflowStore(f.native.file)),f);assert.equal(f.posts.length,1);
  assert.equal(heldDigest(f.native.read()),digest);
  assert.deepEqual(f.native.read().flowNotifications.slice(0,7),before.flowNotifications.slice(0,7));
});

// r2 adds real native persistence semantics without replacing or weakening
// r1's shared-object memory alias case (#65) or any of its first 107 cases.
for(const mode of ['content changed in place','whole delivery replaced'])
test('native final token boundary: delivery '+mode+' blocks IM POST',async t=>{
  const f=nativeFixture(t,x=>x.add('native-delivery-race'));let changed=false;
  const content=JSON.stringify({text:'Synthetic native '+mode});
  f.tokenHook=()=>writeChange(f,s=>{
    const row=s.flowNotifications[0];assert.ok(row.delivery);
    if(mode==='content changed in place')row.delivery.content=content;
    else row.delivery={...row.delivery,content};
    changed=true;
  });
  await settle(f.sender,f);assert.equal(changed,true);assert.equal(f.tokenCalls,1);expectNoPost(f);
  const row=f.native.read().flowNotifications[0];assertNotSent(row);
  assert.equal(row.delivery.content,content);assert.equal(Object.hasOwn(row,'sendIntent'),false);
  assert.notEqual(row.unknown,true);assert.equal(row.id,'notice-native-delivery-race');
  f.advance(120001);await settle(f.makeSender(new WorkflowStore(f.native.file)),f);expectNoPost(f);
});
const NATIVE_CONCURRENT_SIGNALS=[
  ['unknown',{unknown:true}],
  ['futureEvidence',{futureEvidence:{version:999,phase:'toy-foreign-intent'}}],
  ['sendIntent',{sendIntent:{leaseId:'toy-foreign-lease',preparedAt:new Date(START).toISOString()}}],
  ['messageId',{messageId:'toy-independently-recorded-receipt'}],
  ['sentAt',{sentAt:new Date(START-1).toISOString()}],
];
for(const [name,signal] of NATIVE_CONCURRENT_SIGNALS)
test('native final token boundary: newly recorded '+name+' is preserved without IM POST or retry',async t=>{
  const f=nativeFixture(t,x=>x.add('native-new-signal'));let captured=null;
  f.tokenHook=()=>{
    writeChange(f,s=>{Object.assign(s.flowNotifications[0],clone(signal));});
    captured=clone(f.native.read().flowNotifications[0]);
    assert.equal(captured.state,'sending');
    for(const key of ['unknown','futureEvidence','sendIntent','sentAt']){
      if(key!==name)assert.equal(Object.hasOwn(captured,key),false);
    }
    if(name!=='messageId')assert.equal(captured.messageId,null);
    assert.deepEqual(captured[name],signal[name]);
  };
  await settle(f.sender,f);assert.ok(captured);assert.equal(f.tokenCalls,1);expectNoPost(f);
  const digest=jsonSha(captured);let current=f.native.read().flowNotifications[0];
  assert.notEqual(current.state,'sent');assert.deepEqual(current,captured);assert.equal(jsonSha(current),digest);
  // A new store/reader does not claim the signal disappeared, unlock the old
  // in-flight row or invent a receipt. This remains same-process toy storage,
  // not a provider readback, cross-process crash or kernel-fsync claim.
  f.advance(120001);const restarted=f.makeSender(new WorkflowStore(f.native.file));
  await settle(restarted,f);expectNoPost(f);current=f.native.read().flowNotifications[0];
  assert.deepEqual(current,captured);assert.equal(jsonSha(current),digest);
  assert.throws(()=>restarted.retry(manager,captured.id));expectNoPost(f);
  assert.deepEqual(f.native.read().flowNotifications[0],captured);
  assert.equal(f.native.read().flowNotifications.length,1);
});
