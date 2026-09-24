import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveTestCard,LIVE_TEST_APP_ID,LIVE_TEST_RECIPIENT,LIVE_TEST_RUN_ID,liveTestCard} from './live-test-card.mjs';

function fixture(t,{failPost=false,failPatch=false,department=LIVE_TEST_RECIPIENT.department}={}){
  const dir=mkdtempSync(join(tmpdir(),'liu-test-card-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const notifier={tenantToken:async()=> 'test-token',fetch:async(url,options)=>{
    calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
    if(url.includes('/contact/v3/users/'))return {ok:true,json:async()=>({code:0,data:{user:{name:LIVE_TEST_RECIPIENT.name,open_id:LIVE_TEST_RECIPIENT.openId,
      department_ids:[department],status:{is_activated:true,is_resigned:false,is_frozen:false,is_exited:false}}}})};
    if(options.method==='POST'){
      if(failPost)throw new Error('post result unknown');
      return {ok:true,json:async()=>({code:0,data:{message_id:'om_liu_test'}})};
    }
    if(options.method==='PATCH'){
      if(failPatch)throw new Error('patch result unknown');
      return {ok:true,json:async()=>({code:0,data:{}})};
    }
    return {ok:true,json:async()=>({code:0,data:{items:[{message_id:'om_liu_test',msg_type:'interactive'}]}})};
  }};
  let now=Date.parse('2026-09-24T09:00:00+08:00');
  const subject=new LiveTestCard({appId:LIVE_TEST_APP_ID,notifier,ledgerPath:join(dir,'ledger.json'),clock:()=>now});
  const event=()=>({app_id:LIVE_TEST_APP_ID,event_id:'event-12345678',operator:{open_id:LIVE_TEST_RECIPIENT.openId},
    context:{open_message_id:'om_liu_test'},action:{tag:'button',value:{action:'confirm_live_test',testId:LIVE_TEST_RUN_ID,nonce:subject.read().entry.nonce}}});
  return {subject,calls,event,advance:()=>{now+=1000;}};
}

test('approved one-person card preserves r51 wording, single callback, no business selectors',t=>{
  const {subject}=fixture(t);subject.mutate(()=>{}, {create:true});
  const card=liveTestCard(subject.read().entry),json=JSON.stringify(card);
  assert.equal(card.schema,'2.0');assert.equal(card.config.width_mode,'compact');assert.equal(card.config.enable_forward,false);
  assert.equal(card.body.elements.length,2);assert.equal(card.body.elements[1].text.content,'确认测试回执');
  assert.match(json,/不是正式排班，不创建或完成业务任务/);
  assert.ok(!json.includes('taskId')&&!json.includes('nodeId')&&!json.includes('live_complete'));
});

test('exact current bot recipient is verified; send once with stable UUID and readback',async t=>{
  const {subject,calls}=fixture(t);
  const first=await subject.sendApproved();assert.equal(first.state,'sent');assert.equal(first.messageId,'om_liu_test');assert.ok(first.readBackAt);
  const post=calls.filter(x=>x.method==='POST');assert.equal(post.length,1);assert.equal(post[0].body.receive_id,LIVE_TEST_RECIPIENT.openId);
  assert.equal(post[0].body.msg_type,'interactive');assert.equal(post[0].body.uuid.length,32);
  await subject.sendApproved();assert.equal(calls.filter(x=>x.method==='POST').length,1);
  assert.equal(subject.read().entry.sentCard.body.elements[1].tag,'button');
});

test('wrong department blocks POST and leaves only a prepared test ledger',async t=>{
  const {subject,calls}=fixture(t,{department:'od_other'});
  await assert.rejects(()=>subject.sendApproved(),/收件人姓名、部门或在职状态不符/);
  assert.equal(subject.status().state,'prepared');assert.equal(calls.filter(x=>x.method==='POST').length,0);
});

test('unknown POST result is never automatically retried',async t=>{
  const {subject,calls}=fixture(t,{failPost:true});
  await assert.rejects(()=>subject.sendApproved(),/post result unknown/);
  assert.equal(subject.status().state,'uncertain');
  await assert.rejects(()=>subject.sendApproved(),/必须先人工读回/);
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
});

test('only exact app, person, message, nonce, test run and event may save a test receipt',async t=>{
  const {subject,event,calls,advance}=fixture(t);await subject.sendApproved();
  const alterations=[e=>{e.app_id='other';},e=>{e.operator.open_id='ou_other';},e=>{e.context.open_message_id='om_other';},
    e=>{e.action.value.nonce='wrong';},e=>{e.action.value.action='live_complete';},e=>{e.action.value.testId='other';},e=>{delete e.event_id;}];
  for(const change of alterations){const e=event();change(e);assert.throws(()=>subject.accept(e));}
  const first=subject.accept(event());assert.equal(first.status,'done');const saved=subject.status().confirmedAt;
  advance();assert.equal(subject.accept(event()).status,'done');assert.equal(subject.status().confirmedAt,saved);
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
  assert.equal(subject.read().tasks,undefined);assert.equal(subject.read().flowNotifications,undefined);
  await subject.flush();assert.equal(subject.status().updateState,'done');assert.ok(subject.status().updatedAt);
  const patch=calls.filter(x=>x.method==='PATCH');assert.equal(patch.length,1);
  assert.match(patch[0].body.content,/已收到本人测试回执/);
  assert.ok(!patch[0].body.content.includes('确认测试回执'));
});

test('uncertain card PATCH is attention, not automatically sent again; receipt stays saved',async t=>{
  const {subject,event,calls}=fixture(t,{failPatch:true});await subject.sendApproved();subject.accept(event());
  await subject.flush();await subject.flush();
  assert.equal(subject.status().updateState,'attention');assert.ok(subject.status().confirmedAt);
  assert.equal(calls.filter(x=>x.method==='PATCH').length,1);
});
