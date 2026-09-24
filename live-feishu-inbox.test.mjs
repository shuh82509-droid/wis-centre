import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveFeishuInbox} from './live-feishu-inbox.mjs';
const setup=()=>{
  const state={tasks:[{id:'t',runtime:{manager:{number:'manager'}}}],flowNotifications:[{taskId:'t',nodeId:'n',recipient:'person',messageId:'om_test',channel:'live_feishu_card',state:'sent'}]};
  let clock=1000,handled=0,updated=0,fail=false,transactions=0;
  const actions={appId:'app',participants:{actor:({openId})=>{assert.equal(openId,'ou_test');return {user:{number:'person'}};}},runtime:{store:{read:()=>structuredClone(state),transaction:fn=>{transactions++;return fn(state);}},log:()=>({id:'event'}),notify:()=>{}},handle:async()=>{handled++;return {status:'completed',card:{schema:'2.0'}};}};
  const inbox=new LiveFeishuInbox({actions,clock:()=>clock,updateCard:async()=>{updated++;if(fail)throw Error('network');}});
  const event={verified:true,appId:'app',eventId:'test-event-001',openId:'ou_test',messageId:'om_test',action:'live_complete',form:{note:'真实完成'}};
  return {inbox,event,state,actions,fail:v=>fail=v,advance:()=>clock+=200000,counts:()=>({handled,updated,transactions})};
};
test('durable intake is fast, duplicate transport deliveries do not double-handle',async()=>{
  const f=setup();assert.equal(f.inbox.accept(f.event).status,'queued');assert.equal(f.inbox.accept(f.event).status,'ready');assert.deepEqual(f.counts(),{handled:0,updated:0,transactions:2});
  await f.inbox.flush();await f.inbox.flush();assert.deepEqual(f.counts(),{handled:1,updated:1,transactions:5});assert.equal(f.inbox.accept(f.event).status,'done');
});
test('card update retry does not repeat successful business handling',async()=>{
  const f=setup();f.inbox.accept(f.event);f.fail(true);await f.inbox.flush();assert.equal(Object.values(f.state.liveFeishuInbox)[0].state,'ready');
  f.advance();f.fail(false);await f.inbox.flush();assert.deepEqual(f.counts(),{handled:1,updated:2,transactions:7});
});
test('idle polls and future retry leases do not rewrite the durable task store',async()=>{
  const f=setup();await f.inbox.flush();await f.inbox.flush();assert.equal(f.counts().transactions,0);
  f.inbox.accept(f.event);assert.equal(f.counts().transactions,1);
  const pending=Object.values(f.state.liveFeishuInbox)[0];pending.nextAt=2000;
  await f.inbox.flush();assert.equal(f.counts().transactions,1);
  pending.state='working';pending.leaseUntil=2000;
  await f.inbox.flush();assert.equal(f.counts().transactions,1);
  f.advance();await f.inbox.flush();assert.equal(f.counts().handled,1);assert.equal(pending.state,'done');
});
test('unverified callbacks, forwarded cards and changed duplicate payloads are rejected',()=>{
  const f=setup();assert.throws(()=>f.inbox.accept({...f.event,verified:false}));assert.throws(()=>f.inbox.accept({...f.event,openId:'ou_other'}));assert.throws(()=>f.inbox.accept({...f.event,messageId:'om_other'}));
  f.inbox.accept(f.event);assert.throws(()=>f.inbox.accept({...f.event,form:{note:'changed'}}));
});
