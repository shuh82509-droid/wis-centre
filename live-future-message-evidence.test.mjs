import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {liveFeishuCard} from './live-feishu-card.mjs';
import {stageFutureLiveIntent,recordFutureLiveResponse,holdFutureLiveUnknown,
  verifyFutureLiveReadback,commitFutureLiveReadback} from './live-future-message-evidence.mjs';

const appId='cli_aa9c744d6ffa1cc4';
const start=Date.parse('2026-09-25T08:00:00Z');
const task=()=>({id:'future-task',workflow:'04',center:'直播中心',title:'测试班次',
  runtime:{state:'running',manager:{number:'M'},participants:['M','A'],liveSession:{date:'2026-09-26',
    signature:'source-v1',roomCode:'guanqi',roomName:'官旗',startAt:'2026-09-26T00:00:00Z',
    endAt:'2026-09-26T12:00:00Z',source:{revision:189107,sheetId:'official-sheet',
      readAt:new Date(start).toISOString()}},nodes:[{id:'W04.S4.E1',title:'直播执行',
    owner:{number:'A',name:'测试主播'},state:'pending',attempt:1}]}});
const notice=()=>({id:'future-notice',kind:'live_assignment',taskId:'future-task',
  nodeId:'W04.S4.E1',attempt:1,recipient:'A',state:'ready',nextAt:start,
  createdAt:new Date(start).toISOString(),attempts:0,messageId:null});

function nativeCard(card){
  // Feishu's raw_card_content expands entities and turns line breaks into br nodes.
  const elements=card.body.elements[0].columns[0].elements.map(element=>{
    const expanded=element.content.replace(/&#(\d+);/gu,
      (_,code)=>String.fromCharCode(Number(code)));
    const parts=expanded.split('\n');
    const native=[];
    for(let i=0;i<parts.length;i++){
      if(i)native.push({tag:'br',property:{}});
      native.push({tag:'plain_text',property:{content:parts[i]}});
    }
    return {property:{elements:native}};
  });
  return JSON.stringify({json_card:JSON.stringify({
    header:{property:{subtitle:{property:{content:card.header.subtitle.content}}}},
    body:{property:{elements:[{property:{columns:[{property:{elements}}]}}]}}})});
}
function fixture(t,{post='ok',mget='ok',onToken}={}){
  const dir=mkdtempSync(join(tmpdir(),'live-future-chain-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new WorkflowStore(join(dir,'workflow.json'));
  store.transaction(s=>{s.tasks.push(task());s.flowNotifications=[notice()];});
  let now=start,posts=0,reads=0,mode=mget,currentOpenId='ou_future001',postBody=null;
  const participants={
    recipient:number=>number==='A'?{id:currentOpenId,type:'open_id',name:'测试主播'}:null,
    verified:number=>number==='A'?{appId,number:'A',openId:currentOpenId,
      checkedAt:now}:null,
    actor:({appId:id,openId,task:current,nodeId})=>{
      assert.equal(id,appId);assert.equal(openId,'ou_future001');
      assert.equal(current.id,'future-task');assert.equal(nodeId,'W04.S4.E1');
      return {channel:'feishu-live',taskId:current.id,nodeId,user:{number:'A'}};
    },
  };
  const cards={has:number=>number==='A',handles:(number,nodeId)=>number==='A'&&nodeId==='W04.S4.E1',ready:()=>true,participants,
    recipient:participants.recipient,
    delivery:(row,current)=>({msg_type:'interactive',channel:'live_feishu_card',
      content:JSON.stringify(liveFeishuCard(row,current))})};
  const fetchImpl=async(url,options)=>{
    if(url.includes('/auth/')){onToken?.(id=>{currentOpenId=id;});
      return {ok:true,json:async()=>({code:0,tenant_access_token:'test',expire:7200})};}
    if(url.includes('/messages?')){
      posts++;postBody=options.body;if(post==='timeout')throw Error('transport result unknown');
      return {ok:true,json:async()=>({code:0,data:post==='incomplete'
        ?{message_id:'om_future001'}:{message_id:'om_future001',chat_id:'oc_future001'}})};
    }
    if(url.includes('/messages/mget?')){
      reads++;if(mode==='unavailable')return {ok:false,json:async()=>({code:500})};
      const row=store.read().flowNotifications[0],current=store.read().tasks[0];
      const content=nativeCard(liveFeishuCard(row,current));
      return {ok:true,json:async()=>({code:0,data:{items:[{message_id:'om_future001',
        chat_id:'oc_future001',msg_type:'interactive',deleted:false,
        sender:{sender_type:'app',id:mode==='wrong-sender'?'cli_other':appId},
        body:{content}}]}})};
    }
    if(url.includes('/chats/'))return {ok:true,json:async()=>({code:0,
      data:{chat_mode:'p2p',chat_status:'normal'}})};
    throw Error('unexpected URL');
  };
  const sourceProof={verified:true,noticeId:'future-notice',taskId:'future-task',
    businessDate:'2026-09-26',roomCode:'guanqi',sessionSignature:'source-v1',
    sheetId:'official-sheet',sourceRevision:189108,
    checkedAt:new Date(start).toISOString()};
  const sender=new FlowFeishu(store,{people:()=>[],clock:()=>now,fetchImpl,
    verifyLiveNoticeSource:async(_notice,options)=>options?.withEvidence?sourceProof:true,
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FLOW_LIVE_FUTURE_EVIDENCE_ENABLED:'true',
      FEISHU_APP_ID:appId,FEISHU_APP_SECRET:'test'}});
  sender.liveCards=cards;
  return {store,sender,get posts(){return posts;},get reads(){return reads;},
    get postBody(){return postBody;},sourceProof,fetchImpl,cards,clock:()=>now,
    advance:ms=>now+=ms,setMget:value=>mode=value};
}

test('future live card freezes exact open_id before POST, then requires bot mget before sent',async t=>{
  const f=fixture(t);await f.sender.flush();
  const row=f.store.read().flowNotifications[0];
  assert.equal(f.posts,1);assert.equal(f.reads,1);assert.equal(row.state,'sent');
  assert.equal(row.futureEvidence.phase,'verified');
  assert.equal(row.futureEvidence.receiveId,'ou_future001');
  assert.equal(row.futureEvidence.recipientNumber,'A');
  assert.equal(row.futureEvidence.taskSourceRevision,189107);
  assert.equal(row.futureEvidence.sourceRevision,189108);
  assert.equal(row.futureEvidence.sourceCheckedAt,new Date(start).toISOString());
  assert.equal(row.futureEvidence.sheetId,'official-sheet');
  assert.equal(row.futureEvidence.sessionSignature,'source-v1');
  assert.equal(row.futureEvidence.bindingCheckedAt,new Date(start).toISOString());
  assert.equal(row.futureEvidence.requestHash,
    createHash('sha256').update(f.postBody).digest('hex'));
  assert.equal(JSON.parse(f.postBody).uuid,row.futureEvidence.uuid);
  assert.equal(row.futureEvidence.readback.independentlyProvedPeer,false);
  assert.equal(row.futureEvidence.readback.humanRead,false);
  await f.sender.flush();assert.equal(f.posts,1);
});

test('mget outage retains verifying state and only retries readback, never POST',async t=>{
  const f=fixture(t,{mget:'unavailable'});await f.sender.flush();
  assert.equal(f.store.read().flowNotifications[0].state,'verifying');
  assert.equal(f.posts,1);f.setMget('ok');f.advance(61000);await f.sender.flush();
  assert.equal(f.store.read().flowNotifications[0].state,'sent');
  assert.equal(f.posts,1);assert.equal(f.reads,2);
});

test('existing verifying intent resumes read-only after both sending switches are OFF',async t=>{
  const f=fixture(t,{mget:'unavailable'});await f.sender.flush();
  assert.equal(f.store.read().flowNotifications[0].state,'verifying');
  assert.equal(f.posts,1);f.setMget('ok');f.advance(61000);
  f.store.transaction(s=>{s.flowNotifications.push({...notice(),id:'new-ready-notice'});});
  const restarted=new FlowFeishu(f.store,{people:()=>[],clock:f.clock,fetchImpl:f.fetchImpl,
    env:{FLOW_NOTIFICATIONS_ENABLED:'false',FLOW_LIVE_FUTURE_EVIDENCE_ENABLED:'false',
      FEISHU_APP_ID:appId,FEISHU_APP_SECRET:'test'}});
  restarted.liveCards=f.cards;
  await restarted.flush();
  assert.equal(f.store.read().flowNotifications[0].state,'sent');
  assert.equal(f.store.read().flowNotifications[1].state,'ready');
  assert.equal(f.posts,1);assert.equal(f.reads,2);
});

test('ambiguous POST and missing chat ID become unknown without another send',async t=>{
  for(const post of ['timeout','incomplete']){
    const f=fixture(t,{post});await f.sender.flush();
    const row=f.store.read().flowNotifications[0];
    assert.equal(row.state,'attention',post);assert.equal(row.unknown,true,post);
    assert.equal(row.futureEvidence.phase,'prepared',post);
    assert.throws(()=>f.sender.retry({user:{number:'M'},canManage:true},row.id),
      error=>error.status===409,post);
    await f.sender.flush();assert.equal(f.posts,1,post);
  }
});

test('wrong bot sender cannot be reported sent or retried',async t=>{
  const f=fixture(t,{mget:'wrong-sender'});await f.sender.flush();
  const row=f.store.read().flowNotifications[0];
  assert.equal(row.state,'attention');assert.equal(row.unknown,true);
  assert.equal(row.futureEvidence.phase,'verifying');
  await f.sender.flush();assert.equal(f.posts,1);
});

test('identity changed while acquiring bot token blocks POST under the durable lease',async t=>{
  const f=fixture(t,{onToken:set=>set('ou_changed')});await f.sender.flush();
  const row=f.store.read().flowNotifications[0];
  assert.equal(f.posts,0);assert.equal(row.state,'superseded');
  assert.equal(row.futureEvidence,undefined);
});

test('crash after prepared intent holds expired lease without a second POST',async t=>{
  const f=fixture(t),leaseId='lease-crash';
  f.store.transaction(s=>{const row=s.flowNotifications[0];row.state='sending';
    row.leaseId=leaseId;row.leaseUntil=start-1;row.delivery=f.sender.liveCards.delivery(row,s.tasks[0]);});
  stageFutureLiveIntent(f.store,{noticeId:'future-notice',leaseId,
    participants:f.sender.liveCards.participants,appId,
    recipient:{id:'ou_future001',type:'open_id'},
    delivery:f.store.read().flowNotifications[0].delivery,
    sourceProof:f.sourceProof,clock:()=>start,validNotice:()=>true});
  await f.sender.flush();const row=f.store.read().flowNotifications[0];
  assert.equal(row.state,'attention');assert.equal(row.unknown,true);assert.equal(f.posts,0);
});

test('tampered POST body cannot be recorded as the prepared intent',t=>{
  const f=fixture(t),leaseId='lease-unchanged';
  f.store.transaction(s=>{const row=s.flowNotifications[0];row.state='sending';
    row.leaseId=leaseId;row.leaseUntil=start+45000;
    row.delivery=f.sender.liveCards.delivery(row,s.tasks[0]);});
  const prepared=stageFutureLiveIntent(f.store,{noticeId:'future-notice',leaseId,
    participants:f.sender.liveCards.participants,appId,
    recipient:{id:'ou_future001',type:'open_id'},
    delivery:f.store.read().flowNotifications[0].delivery,
    sourceProof:f.sourceProof,clock:()=>start,validNotice:()=>true});
  const changed=JSON.stringify({...prepared.request,content:'changed'});
  assert.throws(()=>recordFutureLiveResponse(f.store,{noticeId:'future-notice',leaseId,
    body:changed,httpOk:true,response:{code:0,data:{message_id:'om_one',chat_id:'oc_one'}},
    clock:()=>start}),error=>error.status===409);
  assert.equal(f.store.read().flowNotifications[0].futureEvidence.phase,'prepared');
  assert.equal(f.posts,0);
});

test('missing official source or stale live-person binding blocks before POST',async t=>{
  const f=fixture(t);
  f.store.transaction(s=>{delete s.tasks[0].runtime.liveSession.source;});
  await f.sender.flush();
  assert.equal(f.posts,0);
  assert.equal(f.store.read().flowNotifications[0].futureEvidence,undefined);
  const second=fixture(t);
  second.sender.liveCards.participants.verified=()=>({appId,number:'A',
    openId:'ou_future001',checkedAt:start-16*60000});
  await second.sender.flush();
  assert.equal(second.posts,0);
  assert.equal(second.store.read().flowNotifications[0].futureEvidence,undefined);
});

test('missing current source revision is never mislabeled as the task creation revision',async t=>{
  const f=fixture(t);
  f.sender.verifyLiveNoticeSource=async()=>true;
  await f.sender.flush();
  assert.equal(f.posts,0);
  assert.equal(f.store.read().flowNotifications[0].futureEvidence,undefined);
});

test('stale or mismatched current-source proof cannot authorize POST',async t=>{
  const stale=fixture(t);stale.advance(46000);await stale.sender.flush();
  assert.equal(stale.posts,0);
  const mismatched=fixture(t);mismatched.sourceProof.sessionSignature='other-shift';
  await mismatched.sender.flush();
  assert.equal(mismatched.posts,0);
});

test('future next-day text uses the same exact-open_id and immutable-text proof',t=>{
  const dir=mkdtempSync(join(tmpdir(),'live-nextday-chain-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new WorkflowStore(join(dir,'workflow.json'));
  const row={...notice(),kind:'live_tomorrow',state:'sending',leaseId:'lease-next',
    businessDate:'2026-09-26',signature:'source-v1',delivery:{channel:'live_tomorrow_text',
      msg_type:'text',content:JSON.stringify({text:'次日开播提醒：官旗 · 测试主播'})}};
  store.transaction(s=>{s.tasks.push(task());s.flowNotifications=[row];});
  const participants={recipient:()=>({id:'ou_future001',type:'open_id'}),
    verified:()=>({appId,number:'A',openId:'ou_future001',checkedAt:start}),
    actor:()=>({channel:'feishu-live',taskId:'future-task',nodeId:'W04.S4.E1',user:{number:'A'}})};
  const prepared=stageFutureLiveIntent(store,{noticeId:row.id,leaseId:row.leaseId,
    participants,appId,recipient:{id:'ou_future001',type:'open_id'},
    delivery:row.delivery,sourceProof:{verified:true,noticeId:row.id,
      taskId:'future-task',businessDate:'2026-09-26',roomCode:'guanqi',
      sessionSignature:'source-v1',sheetId:'official-sheet',sourceRevision:189108,
      checkedAt:new Date(start).toISOString()},clock:()=>start,validNotice:()=>true});
  assert.equal(prepared.request.receive_id,'ou_future001');
  recordFutureLiveResponse(store,{noticeId:row.id,leaseId:row.leaseId,
    body:prepared.body,httpOk:true,response:{code:0,data:{message_id:'om_next',chat_id:'oc_next'}},clock:()=>start});
  const pending=store.read().flowNotifications[0];
  const verified=verifyFutureLiveReadback(pending,{message_id:'om_next',chat_id:'oc_next',
    msg_type:'text',deleted:false,sender:{sender_type:'app',id:appId},
    content:row.delivery.content},{chat_mode:'p2p',chat_status:'normal'},appId);
  commitFutureLiveReadback(store,row.id,verified,()=>start);
  assert.equal(store.read().flowNotifications[0].state,'sent');
});
