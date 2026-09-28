import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowFeishu} from './flow-feishu.mjs';

// Synthetic, in-memory fixtures only. No real recipients, ledger, credentials,
// provider requests, timers or filesystem state are used by these tests.
const start=Date.parse('2026-09-29T08:00:00Z');
function fixture(){
  let now=start,transactions=0;
  const state={tasks:[],flowNotifications:[]},posts=[];
  const store={read:()=>structuredClone(state),transaction:fn=>{
    transactions++;store.beforeTransaction?.(state);return structuredClone(fn(state));
  }};
  const sender=new FlowFeishu(store,{clock:()=>now,
    people:()=>[{number:'TOY',name:'Synthetic person',active:true}],
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'toy-app',
      FEISHU_APP_SECRET:'toy-secret',FEISHU_RECIPIENT_MAP_JSON:'{"TOY":"toy-open-id"}'},
    verifyLiveNoticeSource:async()=>true,
    fetchImpl:async(url,options)=>{
      if(url==='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')
        return Response.json({code:0,tenant_access_token:'toy-token',expire:7200});
      assert.equal(url,'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
      assert.equal(options.method,'POST');const body=JSON.parse(options.body);
      assert.equal(body.receive_id,'toy-open-id');posts.push(body);
      return Response.json({code:0,data:{message_id:'toy-message-'+posts.length}});
    }});
  function add(id,source,extra={}){
    const task={id,title:'Synthetic '+id,workflow:'04',acceptance:'Toy criterion',
      runtime:{state:'running',participants:['TOY'],manager:{number:'TOY'},nodes:[{
        id:'N',state:'ready',attempt:1,owner:{number:'TOY'},title:'Toy node'}]}};
    if(source!==undefined)task.runtime.localBusiness=structuredClone(source);
    const notice={id:'notice-'+id,taskId:id,nodeId:'N',kind:'ready',recipient:'TOY',
      attempt:1,state:'ready',attempts:0,createdAt:new Date(now).toISOString(),
      nextAt:now,messageId:null,...extra};
    state.tasks.push(task);state.flowNotifications.push(notice);return {task,notice};
  }
  return {state,store,sender,posts,add,advance:ms=>{now+=ms;},
    now:()=>now,transactions:()=>transactions};
}
const stale=()=>({checkedAt:new Date(start-45001).toISOString()});

test('five recurring stale sources cannot starve an independent live notice',async()=>{
  const f=fixture();for(let i=0;i<5;i++)f.add('blocked-'+i,stale());
  const {notice}=f.add('eligible');const originals=structuredClone(f.state.flowNotifications.slice(0,5));
  for(let i=0;i<3;i++){await f.sender.flush();f.advance(31001);}
  assert.equal(notice.state,'sent');assert.equal(notice.attempts,1);assert.equal(f.posts.length,1);
  assert.deepEqual(f.state.flowNotifications.slice(0,5),originals);
});

test('large source-blocked prefix does not consume the five eligible-send limit',async()=>{
  const f=fixture();for(let i=0;i<128;i++)f.add('blocked-'+i,stale());
  for(let i=0;i<7;i++)f.add('eligible-'+i);
  await f.sender.flush();assert.equal(f.posts.length,5);
  assert.equal(f.state.flowNotifications.filter(n=>n.state==='sent').length,5);
  assert.ok(f.state.flowNotifications.slice(0,128).every(n=>n.attempts===0&&!n.firstAttemptAt&&!n.delivery&&!n.messageId));
  await f.sender.flush();assert.equal(f.posts.length,7);
});

for(const [name,source] of [
  ['missing timestamp',{}],['invalid timestamp',{checkedAt:'bad'}],
  ['non-string timestamp',{checkedAt:start}],
  ['future timestamp',{checkedAt:new Date(start+1).toISOString()}],
  ['source issue',{checkedAt:new Date(start).toISOString(),issue:'toy hold'}],
])test(name+' is blocked without blocking another workflow',async()=>{
  const f=fixture(),row=f.add('blocked',source);const original=structuredClone(row.notice);
  f.add('eligible');await f.sender.flush();assert.deepEqual(row.notice,original);
  assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].state,'sent');
});

test('source freshness accepts exactly 45 seconds but not 45 seconds plus one',async()=>{
  const f=fixture();f.add('fresh',{checkedAt:new Date(start-45000).toISOString()});
  const old=f.add('stale',stale());await f.sender.flush();assert.equal(f.posts.length,1);
  assert.equal(old.notice.state,'ready');assert.equal(old.notice.attempts,0);
});

test('blocked source refresh preserves the original notice and sends only once',async()=>{
  const f=fixture(),row=f.add('refresh',stale());await f.sender.flush();assert.equal(f.posts.length,0);
  row.task.runtime.localBusiness.checkedAt=new Date(f.now()).toISOString();
  await f.sender.flush();await f.sender.flush();assert.equal(f.posts.length,1);
  assert.equal(row.notice.id,'notice-refresh');assert.equal(row.notice.attempts,1);
});

for(const [name,extra] of [
  ['result unknown',{unknown:true,nextAt:start+86400000}],
  ['expired sending lease',{state:'sending',leaseId:'toy-old-lease',leaseUntil:start-1}],
  ['durable prepared intent',{futureEvidence:{version:2,phase:'prepared'}}],
])test(name+' reaches fail-closed hold even with stale source',async()=>{
  const f=fixture(),row=f.add('hold',stale(),extra);await f.sender.flush();
  assert.equal(row.notice.state,'attention');assert.equal(row.notice.unknown,true);
  assert.equal(f.posts.length,0);assert.equal(row.notice.attempts,0);
  assert.ok(!row.notice.leaseId&&!row.notice.leaseUntil);
  row.task.runtime.liveSession={date:'2026-09-29',signature:'toy-signature'};
  assert.throws(()=>f.sender.retry({canManage:true,user:{number:'TOY'}},row.notice.id),/发送结果不明|发送意图/);
});

test('selection is repeated inside the transaction if the source changes',async()=>{
  const f=fixture(),row=f.add('changes',{checkedAt:new Date(start).toISOString()});f.add('eligible');
  f.store.beforeTransaction=()=>{row.task.runtime.localBusiness.issue='toy changed source';};
  await f.sender.flush();assert.equal(row.notice.attempts,0);assert.equal(row.notice.state,'ready');
  assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].state,'sent');
});

test('duplicate task IDs cannot replace the first task source gate',async()=>{
  const f=fixture(),row=f.add('duplicate',stale());
  const later=structuredClone(row.task);delete later.runtime.localBusiness;f.state.tasks.push(later);
  f.add('eligible');await f.sender.flush();assert.equal(row.notice.attempts,0);
  assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].state,'sent');
});

test('only stale notices cause no send transaction or provider call',async()=>{
  const f=fixture();for(let i=0;i<6;i++)f.add('blocked-'+i,stale());
  await f.sender.flush();assert.equal(f.transactions(),0);assert.equal(f.posts.length,0);
});

test('disabled sender remains disabled with an eligible live notice',async()=>{
  const f=fixture();f.add('eligible');f.sender.enabled=false;await f.sender.flush();
  assert.equal(f.posts.length,0);assert.equal(f.transactions(),0);
});

test('more than five unknown holds do not consume the eligible lease budget',async()=>{
  const f=fixture();for(let i=0;i<7;i++)f.add('unknown-'+i,stale(),{unknown:true});
  f.add('eligible');await f.sender.flush();assert.equal(f.posts.length,1);
  assert.ok(f.state.flowNotifications.slice(0,7).every(n=>n.state==='attention'&&n.unknown&&n.attempts===0));
  assert.equal(f.state.flowNotifications[7].state,'sent');
});

test('obsolete nodes are retired without spending five delivery leases',async()=>{
  const f=fixture();for(let i=0;i<7;i++)f.add('obsolete-'+i).task.runtime.nodes[0].state='completed';
  f.add('eligible');await f.sender.flush();assert.equal(f.posts.length,1);
  assert.ok(f.state.flowNotifications.slice(0,7).every(n=>n.state==='superseded'&&n.attempts===0));
});

test('slow transactions cannot repeatedly select the same deferred notice',async()=>{
  const f=fixture(),row=f.add('slow',{checkedAt:new Date(start).toISOString()});f.add('eligible');
  f.store.beforeTransaction=()=>f.advance(60001);
  await f.sender.flush();assert.equal(row.notice.state,'ready');assert.equal(row.notice.attempts,0);
  assert.equal(f.posts.length,1);assert.ok(f.transactions()<10);
});

test('a batch is finite and does not drain notices appended during its transactions',async()=>{
  const f=fixture();f.add('first');let added=false;
  f.store.beforeTransaction=()=>{if(!added){added=true;f.add('later');}};
  await f.sender.flush();assert.equal(f.posts.length,1);assert.equal(f.state.flowNotifications[1].attempts,0);
  f.store.beforeTransaction=null;await f.sender.flush();assert.equal(f.posts.length,2);
});
