import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReadOnlyEvidence} from './readiness-collector.mjs';

const NOW=Date.parse('2026-09-27T07:45:00.000Z');
const at=new Date(NOW).toISOString();
const rooms=['guanqi','brand_selection','youxuan','wangou'].map(code=>({code,anchors:[]}));
const topology=()=>({gateway:{id:'g',image:'i',status:'running',health:'healthy',
  configHash:'hash',routes:{hub:'h',calendar:'c',dispatch:'d'},checkedAt:at},
  services:{hub:{id:'h',checkedAt:at},calendar:{id:'c',checkedAt:at},dispatch:{id:'d',checkedAt:at}}});
function ops(overrides={}){
  return {readTopology:async()=>topology(),
    readOfficialSource:async(date)=>({date,rooms,issues:[],updatedAt:at}),
    readApprovedBindings:async()=>[{number:'N1',name:'演练',openId:'ou_person'}],
    readIdentity:async()=>({openId:'ou_person',name:'演练',checkedAt:at}),
    deriveRoomSlots:async()=>[],readHubState:async()=>({tasks:[],flowNotifications:[]}),
    readCardMessage:async()=>null,
    readPersonalChat:async chatId=>({chatId,mode:'p2p',status:'normal',
      checkedAs:'bot',checkedAt:at}),
    readPersonalPeer:async()=>null,cardMatches:async()=>false,
    readGroup:async()=>({id:'group',checkedAt:at}),readGroupTest:async()=>null,
    readBackup:async()=>null,readOaPage:async()=>null,...overrides};
}

test('collector uses current D+1 and performs only the injected read operations',async()=>{
  const calls=[];const adapter=ops({readOfficialSource:async(date,{fresh})=>{
    calls.push(['source',date,fresh]);return {date,rooms,issues:[],updatedAt:at};},
    readGroupTest:async id=>{calls.push(['group_test',id]);return {messageId:id};}});
  const result=await collectReadOnlyEvidence({ops:adapter,policy:{groupId:'group',
    approvedGroupTestMessageId:'om_approved'},now:NOW});
  assert.deepEqual(calls,[['source','2026-09-28',true],['group_test','om_approved']]);
  assert.deepEqual(result.collectorIssues,[]);
  assert.equal(result.source.slots.length,0);
  assert.equal(result.state.tasks.length,0);
});

test('one room identity failure does not become an approved three-room schedule',async()=>{
  const result=await collectReadOnlyEvidence({ops:ops({deriveRoomSlots:async raw=>{
    if(raw.rooms[0].code==='wangou')throw Object.assign(new Error('identity'),{code:'identity_unverified'});
    return [{roomCode:raw.rooms[0].code}];}}),policy:{groupId:'group'},now:NOW});
  assert.equal(result.source.slots.length,3);
  assert.ok(result.collectorIssues.some(x=>x.startsWith('derived_room_wangou:')));
  assert.ok(result.collectorIssues.includes('approved_group_test_id_missing'));
});

test('bot P2P permission failure is an explicit NO-GO, not an inferred recipient',async()=>{
  const state={tasks:[{id:'task-1',workflow:'04',runtime:{state:'running',
    liveSession:{date:'2026-09-28'},nodes:[{id:'W04.S4.E1',owner:{number:'N1'},state:'ready',attempt:1}]}}],
    flowNotifications:[{id:'card-1',key:'card-1',kind:'live_assignment',taskId:'task-1',
      nodeId:'W04.S4.E1',recipient:'N1',messageId:'om_card'}]};
  const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
    readCardMessage:async()=>({messageId:'om_card',chatId:'oc_p2p',
      senderAppId:'cli_app',msgType:'interactive',
      deleted:false,checkedAt:at}),cardMatches:async()=>true,
    readPersonalPeer:async()=>{throw Object.assign(new Error('missing scope'),{code:99991672});}}),
    policy:{groupId:'group'},now:NOW});
  assert.ok(result.collectorIssues.includes('bot_p2p_peer:99991672'));
  assert.equal(result.cardReadbacks[0].recipientProof,null);
});

test('group card never queries read users as a surrogate for personal delivery',async()=>{
  let peerCalls=0;
  const state={tasks:[{id:'task-1',workflow:'04',runtime:{state:'running',
    liveSession:{date:'2026-09-28'},nodes:[{id:'W04.S4.E1',owner:{number:'N1'},state:'ready',attempt:1}]}}],
    flowNotifications:[{id:'card-1',key:'card-1',kind:'live_assignment',taskId:'task-1',
      nodeId:'W04.S4.E1',recipient:'N1',messageId:'om_card'}]};
  const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
    readCardMessage:async()=>({messageId:'om_card',chatId:'oc_group',
      senderAppId:'cli_app',msgType:'interactive',
      deleted:false,checkedAt:at}),cardMatches:async()=>true,
    readPersonalChat:async chatId=>({chatId,mode:'group',status:'normal',
      checkedAs:'bot',checkedAt:at}),
    readPersonalPeer:async()=>{peerCalls++;return {kind:'read_user',openId:'ou_person'};}}),
    policy:{groupId:'group'},now:NOW});
  assert.equal(peerCalls,0);
  assert.ok(result.collectorIssues.includes('card_not_bot_p2p'));
  assert.equal(result.cardReadbacks[0].recipientProof,null);
});

test('bot chat-detail permission failure is an explicit NO-GO',async()=>{
  let peerCalls=0;
  const state={tasks:[{id:'task-1',workflow:'04',runtime:{state:'running',
    liveSession:{date:'2026-09-28'},nodes:[{id:'W04.S4.E1',owner:{number:'N1'},state:'ready',attempt:1}]}}],
    flowNotifications:[{id:'card-1',key:'card-1',kind:'live_assignment',taskId:'task-1',
      nodeId:'W04.S4.E1',recipient:'N1',messageId:'om_card'}]};
  const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
    readCardMessage:async()=>({messageId:'om_card',chatId:'oc_unverified',
      senderAppId:'cli_app',msgType:'interactive',
      deleted:false,checkedAt:at}),cardMatches:async()=>true,
    readPersonalChat:async()=>{throw Object.assign(new Error('missing scope'),{code:99991672});},
    readPersonalPeer:async()=>{peerCalls++;return {kind:'p2p_member',openId:'ou_person'};}}),
    policy:{groupId:'group'},now:NOW});
  assert.equal(peerCalls,0);
  assert.ok(result.collectorIssues.includes('bot_p2p_chat:99991672'));
  assert.ok(result.collectorIssues.includes('card_not_bot_p2p'));
  assert.equal(result.cardReadbacks[0].recipientProof,null);
});

test('current gateway or writer drift during collection invalidates the snapshot',async()=>{
  let count=0;const result=await collectReadOnlyEvidence({ops:ops({readTopology:async()=>{
    count++;const t=topology();if(count===2)t.gateway.routes.hub='other';return t;}}),
    policy:{groupId:'group'},now:NOW});
  assert.ok(result.collectorIssues.includes('topology_changed_during_collection'));
});

test('missing read adapter rejects before any external operation',async()=>{
  await assert.rejects(()=>collectReadOnlyEvidence({ops:{readTopology:async()=>topology()},
    policy:{groupId:'group'},now:NOW}),/adapter incomplete/u);
});

test('a bot GET response for a different or missing message ID is never a card readback',async()=>{
  const state={tasks:[{id:'task-1',workflow:'04',runtime:{state:'running',
    liveSession:{date:'2026-09-28'},nodes:[]}}],
    flowNotifications:[{id:'card-1',key:'card-1',kind:'live_assignment',taskId:'task-1',
      messageId:'om_card'}]};
  for(const returnedId of ['om_other',undefined]){
    let chatReads=0,peerReads=0;
    const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
      readCardMessage:async()=>({messageId:returnedId,chatId:'oc_p2p',checkedAt:at}),
      readPersonalChat:async()=>{chatReads++;return null;},
      readPersonalPeer:async()=>{peerReads++;return null;}}),
      policy:{groupId:'group'},now:NOW});
    assert.ok(result.collectorIssues.includes('card_independent_message_id_mismatch'));
    assert.deepEqual(result.cardReadbacks,[]);
    assert.equal(chatReads,0);
    assert.equal(peerReads,0);
  }
});

test('group test GET must return the exact externally approved message ID',async()=>{
  const result=await collectReadOnlyEvidence({ops:ops({readGroupTest:async()=>({
    messageId:'om_other',chatId:'group',checkedAt:at})}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_approved'},now:NOW});
  assert.ok(result.collectorIssues.includes('approved_group_test_message_id_mismatch'));
});
