import test from 'node:test';
import assert from 'node:assert/strict';
import {EventDispatcher} from '@larksuiteoapi/node-sdk';
import {LiveFeishuTransport} from './live-feishu-transport.mjs';
const appId='cli_aa9c744d6ffa1cc4';
class MockClient {
  constructor(options){this.options=options;this.state='idle';}
  start({eventDispatcher}){this.dispatcher=eventDispatcher;this.state='connected';this.options.onReady();}
  getConnectionStatus(){return {state:this.state};}
  close(){this.state='idle';}
}
const raw=(changes={})=>({schema:'2.0',header:{app_id:appId,event_id:'event-12345678',event_type:'card.action.trigger'},event:{operator:{open_id:'ou_test'},context:{open_message_id:'om_test'},action:{tag:'button',name:'live_ack',form_value:{feedbackNote:'本人确认收到'}},...changes}});
test('disabled callback transport never connects',()=>{
  const t=new LiveFeishuTransport({appId,appSecret:'test',inbox:{},Client:MockClient});t.start();assert.equal(t.client,null);assert.equal(t.ready(),false);
});
test('official SDK parses authenticated events into bounded durable inbox',async()=>{
  const accepted=[],t=new LiveFeishuTransport({appId,appSecret:'test',enabled:true,inbox:{accept:e=>{accepted.push(e);return {status:'queued'};}},Client:MockClient,Dispatcher:EventDispatcher});
  t.start();assert.equal(t.ready(),true);
  const reply=await t.client.dispatcher.invoke(raw(),{needCheck:false}); // mock of SDK-authenticated WS, not public HTTP
  assert.equal(reply.toast.type,'info');assert.match(reply.toast.content,/尚未标记完成/);
  assert.deepEqual(JSON.parse(JSON.stringify(accepted[0])),{verified:true,appId,eventId:'event-12345678',openId:'ou_test',messageId:'om_test',action:'live_ack',form:{note:'本人确认收到'}});
  const other=raw();other.header.app_id='wrong';assert.equal((await t.client.dispatcher.invoke(other,{needCheck:false})).toast.type,'error');assert.equal(accepted.length,1);
  assert.equal((await t.client.dispatcher.invoke(raw({action:{tag:'select_static'}}),{needCheck:false})).toast.type,'error');
  t.stop();assert.equal(t.ready(),false);
});
test('callback errors expose no private payloads and do not report success',async()=>{
  const t=new LiveFeishuTransport({appId,appSecret:'secret',enabled:true,inbox:{accept(){throw new Error('private payload');}},Client:MockClient});t.start();
  const result=await t.client.dispatcher.invoke(raw(),{needCheck:false});assert.equal(result.toast.type,'error');assert.ok(!JSON.stringify(result).includes('private payload'));t.stop();
});
test('the existing formal WS routes an approved test receipt to its isolated ledger, never business inbox',async()=>{
  const accepted=[];
  const t=new LiveFeishuTransport({appId,appSecret:'test',enabled:true,
    inbox:{accept(){throw new Error('business inbox must not receive test');}},
    testCards:{accept:event=>{accepted.push(event);return {status:'done'};}},Client:MockClient});
  t.start();const event=raw({action:{tag:'button',value:{action:'confirm_live_test',testId:'test',nonce:'nonce'}}});
  const result=await t.client.dispatcher.invoke(event,{needCheck:false});
  assert.equal(result.toast.type,'success');assert.match(result.toast.content,/未办理正式业务/);
  assert.equal(accepted.length,1);
  const invalid=raw({action:{tag:'button',value:{action:'confirm_live_test'}}});invalid.header.app_id='wrong';
  assert.equal((await t.client.dispatcher.invoke(invalid,{needCheck:false})).toast.type,'error');
  assert.equal(accepted.length,1);t.stop();
});
