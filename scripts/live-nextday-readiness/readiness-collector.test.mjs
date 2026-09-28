import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReadOnlyEvidence, topologyIdentityProjection} from './readiness-collector.mjs';

const NOW=Date.parse('2026-09-27T07:45:00.000Z');
const at=new Date(NOW).toISOString();
const rooms=['guanqi','brand_selection','youxuan','wangou'].map(code=>({code,anchors:[]}));
const topology=()=>({gateway:{id:'g',image:'i',status:'running',health:'healthy',
  configHash:'hash',routes:{hub:'h',calendar:'c',dispatch:'d'},checkedAt:at},
  services:{hub:{id:'h',checkedAt:at,dormantRwContainers:[],startedAt:at,
    release:'hub-synthetic-release',liveNextDayInstance:'boot-synthetic-instance'},
    calendar:{id:'c',checkedAt:at,dormantRwContainers:[],startedAt:at},
    dispatch:{id:'d',checkedAt:at,dormantRwContainers:[],startedAt:at}}});
const backupRows=()=>Object.fromEntries(['hub','calendar','dispatch'].map(key=>[key,{
  fullBackup:true,stoppedWriter:true,verified:true,restoreProbePassed:true,
  sourceContainerId:{hub:'h',calendar:'c',dispatch:'d'}[key],sourceDataMount:'/data/'+key,
  sourceImage:'sha256:'+'d'.repeat(64),sourceStartedAt:at,
  archiveSha256:'a'.repeat(64),sourceManifestSha256:'b'.repeat(64),restoredManifestSha256:'b'.repeat(64),
  restoreProbeHash:'c'.repeat(64),capturedAt:at,checkedAt:at}]));
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
    readBackup:async()=>backupRows(),readOaPage:async()=>null,...overrides};
}
const cardState=count=>({tasks:Array.from({length:count},(_,i)=>({id:'task-'+i,
  workflow:'04',runtime:{state:'running',liveSession:{date:'2026-09-28'},nodes:[]}})),
  flowNotifications:Array.from({length:count},(_,i)=>({id:'card-'+i,key:'card-'+i,
    kind:'live_assignment',taskId:'task-'+i,recipient:'N'+i,messageId:'om_card_'+i}))});
const cardMessage=(messageId,chatId='oc_'+messageId)=>({messageId,chatId,
  senderAppId:'cli_app',msgType:'interactive',deleted:false,checkedAt:at});
const peerProof=(chatId,messageId)=>({kind:'read_user',checkedAs:'bot',chatId,
  messageId,openId:'ou_'+messageId,checkedAt:at,complete:true,readUserIds:['ou_'+messageId]});
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(predicate){
  for(let i=0;i<100&&!predicate();i++)await nextTurn();
  assert.ok(predicate(),'expected pending reads did not start');
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
test('even a stopped restart=no same-volume RW container changes the topology gate',async()=>{
  for(const key of ['hub','calendar','dispatch']){
    let calls=0;const result=await collectReadOnlyEvidence({ops:ops({readTopology:async()=>{
      const value=topology();if(++calls===2)value.services[key].dormantRwContainers.push({id:'old',restart:'no'});
      return value;}}),policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
    assert.ok(result.collectorIssues.includes('topology_changed_during_collection'));
  }
});
test('same-ID service restart or Hub release/instance change invalidates first/last collection',async()=>{
  for(const [key,field] of [['hub','startedAt'],['calendar','startedAt'],['dispatch','startedAt'],
    ['hub','release'],['hub','liveNextDayInstance']]){
    let calls=0;const result=await collectReadOnlyEvidence({ops:ops({readTopology:async()=>{
      const value=topology();if(++calls===2)value.services[key][field]='changed';return value;}}),
      policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
    assert.ok(result.collectorIssues.includes('topology_changed_during_collection'));
  }
});

const kernelIdentity=()=>({pid:1234,startTicks:'5678',mountNamespace:'mnt:[90210]',
  mountinfoSha256:'a'.repeat(64),mounts:[{destination:'/app/data',dev:'64771',ino:'123'}],checkedAt:at});
test('kernel process, namespace and mount drift survives whole-round topology projection',async()=>{
  for(const role of ['hub','calendar','dispatch'])for(const mutate of [
    value=>{value.pid++;},value=>{value.startTicks='new';},
    value=>{value.mountNamespace='mnt:[90211]';},value=>{value.mountinfoSha256='b'.repeat(64);},
    value=>{value.mounts[0].ino='456';},value=>{value.mounts[0].dev='64772';}]){
    let calls=0;const result=await collectReadOnlyEvidence({ops:ops({readTopology:async()=>{
      const value=topology();value.services[role].kernelMountIdentity=kernelIdentity();
      if(++calls===2)mutate(value.services[role].kernelMountIdentity);return value;}}),
      policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
    assert.ok(result.collectorIssues.includes('topology_changed_during_collection'));
  }
});

test('only kernel observation time is ignored, while disappearance is drift',async()=>{
  for(const disappear of [false,true]){
    let calls=0;const result=await collectReadOnlyEvidence({ops:ops({readTopology:async()=>{
      const value=topology();value.services.hub.kernelMountIdentity=kernelIdentity();
      if(++calls===2){if(disappear)delete value.services.hub.kernelMountIdentity;
        else value.services.hub.kernelMountIdentity.checkedAt=new Date(NOW+1000).toISOString();}
      return value;}}),policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
    assert.equal(result.collectorIssues.includes('topology_changed_during_collection'),disappear);
  }
  const value=topology();value.services.hub.kernelMountIdentity=kernelIdentity();
  const projected=topologyIdentityProjection(value).services.hub.kernelMountIdentity;
  assert.equal(projected.checkedAt,undefined);assert.deepEqual(projected.mounts,[{destination:'/app/data',dev:'64771',ino:'123'}]);
  assert.equal(value.services.hub.kernelMountIdentity.checkedAt,at);
});
test('the same backup GET preserves three separate role proofs and never fills missing evidence from policy',async()=>{
  let reads=0;const rows=backupRows();
  const result=await collectReadOnlyEvidence({ops:ops({readBackup:async first=>{
    reads++;assert.equal(first.services.hub.id,'h');return rows;}}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_test',dataMounts:{calendar:'/invented'}},now:NOW});
  assert.equal(reads,1);assert.deepEqual(result.environment.backup,rows);
  for(const key of ['hub','calendar','dispatch'])assert.equal(result.environment.backup[key].sourceDataMount,'/data/'+key);
  for(const key of ['hub','calendar','dispatch']){
    const missing=backupRows();delete missing[key];
    const incomplete=await collectReadOnlyEvidence({ops:ops({readBackup:async()=>missing}),
      policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
    assert.ok(incomplete.collectorIssues.includes(`stopped_writer_backup_${key}_missing`));
    assert.equal(incomplete.environment.backup[key],null);
    assert.ok(incomplete.environment.backup[['hub','calendar','dispatch'].find(x=>x!==key)]);
  }
});
test('one failed aggregate backup read remains explicit for all services without another read',async()=>{
  let reads=0;const result=await collectReadOnlyEvidence({ops:ops({readBackup:async()=>{
    reads++;throw {code:'backup_read_failed'};}}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
  assert.equal(reads,1);assert.deepEqual(result.environment.backup,{hub:null,calendar:null,dispatch:null});
  assert.deepEqual(result.collectorIssues,['stopped_writer_backup:backup_read_failed',
    'stopped_writer_backup_hub_missing','stopped_writer_backup_calendar_missing','stopped_writer_backup_dispatch_missing']);
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

test('concurrency is validated before any read and only integers from 1 to 4 are accepted',async()=>{
  let reads=0;const adapter=ops({readTopology:async()=>{reads++;return topology();}});
  for(const concurrency of [0,5,-1,1.5,'4',null,NaN,Infinity])
    await assert.rejects(()=>collectReadOnlyEvidence({ops:adapter,concurrency,now:NOW}),
      /concurrency must be an integer from 1 to 4/u);
  assert.equal(reads,0);
});

test('identity and per-card GET phases share the requested bounded concurrency, defaulting to 4',async()=>{
  for(const requested of [undefined,1,2,3,4]){
    const expected=requested??4,state=cardState(9),bindings=state.tasks.map((_,i)=>(
      {number:'N'+i,openId:'ou_person_'+i}));
    let inFlight=0,maxInFlight=0,identityMax=0,cardMax=0,topologyReads=0;
    const read=async(phase,value)=>{
      inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      if(phase==='identity')identityMax=Math.max(identityMax,inFlight);
      else cardMax=Math.max(cardMax,inFlight);
      try{await nextTurn();return value;}finally{inFlight--;}
    };
    const result=await collectReadOnlyEvidence({ops:ops({
      readTopology:async()=>{topologyReads++;assert.equal(inFlight,0);return topology();},
      readApprovedBindings:async()=>bindings,
      readIdentity:async(openId)=>read('identity',{openId,checkedAt:at}),
      readHubState:async()=>state,
      readCardMessage:async id=>read('card',cardMessage(id)),cardMatches:async()=>true,
      readPersonalChat:async chatId=>read('card',{chatId,mode:'p2p',status:'normal',
        checkedAs:'bot',checkedAt:at}),
      readPersonalPeer:async(chatId,id)=>read('card',peerProof(chatId,id))}),
      policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW,
      ...(requested===undefined?{}:{concurrency:requested})});
    assert.equal(maxInFlight,expected);assert.equal(identityMax,expected);
    assert.equal(cardMax,expected);assert.equal(inFlight,0);assert.equal(topologyReads,2);
    assert.deepEqual(result.identityReadbacks.map(x=>x.number),bindings.map(x=>x.number));
    assert.deepEqual(result.cardReadbacks.map(x=>x.messageId),state.flowNotifications.map(x=>x.messageId));
    assert.ok(result.cardReadbacks.every(x=>x.checkedAt===at));
  }
});

test('out-of-order identity and card completion keeps evidence and errors in source order',async()=>{
  const state=cardState(4),bindings=state.tasks.map((_,i)=>({number:'N'+i,openId:'ou_person_'+i}));
  const identityGates=new Map(),cardGates=new Map(),completed=[];
  const collection=collectReadOnlyEvidence({ops:ops({readApprovedBindings:async()=>bindings,
    readIdentity:(openId,number)=>new Promise((resolve,reject)=>identityGates.set(number,{resolve,reject})),
    readHubState:async()=>state,
    readCardMessage:id=>new Promise((resolve,reject)=>cardGates.set(id,{resolve,reject})),
    cardMatches:async()=>true,readPersonalPeer:async(chatId,id)=>peerProof(chatId,id)}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
  await waitFor(()=>identityGates.size===4);
  for(const i of [3,2,1,0]){
    completed.push('N'+i);
    if(i===3||i===0)identityGates.get('N'+i).reject({code:'identity_'+i});
    else identityGates.get('N'+i).resolve({openId:'ou_person_'+i,checkedAt:at});
  }
  await waitFor(()=>cardGates.size===4);
  for(const i of [3,2,1,0]){
    completed.push('om_card_'+i);
    if(i===3||i===0)cardGates.get('om_card_'+i).reject({code:'message_'+i});
    else cardGates.get('om_card_'+i).resolve(cardMessage('om_card_'+i));
  }
  const result=await collection;
  assert.deepEqual(completed,['N3','N2','N1','N0','om_card_3','om_card_2','om_card_1','om_card_0']);
  assert.deepEqual(result.identityReadbacks.map(x=>x.number),['N1','N2']);
  assert.deepEqual(result.cardReadbacks.map(x=>x.messageId),['om_card_1','om_card_2']);
  assert.deepEqual(result.collectorIssues,[
    'person_identity:identity_0','person_identity:identity_3','card_mget:message_0','card_mget:message_3']);
});

test('a failed card read preserves every other card and a later per-card failure remains explicit',async()=>{
  const state=cardState(7);
  const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
    readCardMessage:async id=>{await nextTurn();if(id==='om_card_2')throw {code:'single_read_failed'};
      return cardMessage(id);},
    cardMatches:async card=>{if(card.messageId==='om_card_5')throw {code:'match_failed'};return true;},
    readPersonalPeer:async(chatId,id)=>peerProof(chatId,id)}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
  assert.deepEqual(result.cardReadbacks.map(x=>x.messageId),[
    'om_card_0','om_card_1','om_card_3','om_card_4','om_card_5','om_card_6']);
  assert.deepEqual(result.collectorIssues,['card_mget:single_read_failed','card_immutable_match:match_failed']);
  assert.equal(result.cardReadbacks.find(x=>x.messageId==='om_card_5').immutableCardMatched,false);
  assert.ok(result.cardReadbacks.every(x=>x.recipientProof.messageId===x.messageId));
});

test('shared bot chat detail is read once while recipient/read-user proofs stay message-specific',async()=>{
  const state=cardState(6),chatReads=[],peerReads=[];
  const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
    readCardMessage:async id=>cardMessage(id,'oc_shared'),cardMatches:async()=>true,
    readPersonalChat:async chatId=>{chatReads.push(chatId);await nextTurn();return {
      chatId,mode:'p2p',status:'normal',checkedAs:'bot',checkedAt:at};},
    readPersonalPeer:async(chatId,id)=>{peerReads.push([chatId,id]);await nextTurn();return peerProof(chatId,id);}}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
  assert.deepEqual(chatReads,['oc_shared']);
  assert.deepEqual(peerReads.map(x=>x[1]).sort(),state.flowNotifications.map(x=>x.messageId).sort());
  for(const row of result.cardReadbacks){
    assert.equal(row.chatId,'oc_shared');assert.equal(row.recipientProof.messageId,row.messageId);
    assert.equal(row.recipientProof.openId,'ou_'+row.messageId);
    assert.deepEqual(row.recipientProof.readUserIds,['ou_'+row.messageId]);
  }
});

test('a shared chat-detail failure retains an issue for every card and never reads a peer',async()=>{
  let chatReads=0,peerReads=0;const state=cardState(4);
  const result=await collectReadOnlyEvidence({ops:ops({readHubState:async()=>state,
    readCardMessage:async id=>cardMessage(id,'oc_shared'),cardMatches:async()=>true,
    readPersonalChat:async()=>{chatReads++;await nextTurn();throw {code:'missing_scope'};},
    readPersonalPeer:async()=>{peerReads++;return null;}}),
    policy:{groupId:'group',approvedGroupTestMessageId:'om_test'},now:NOW});
  assert.equal(chatReads,1);assert.equal(peerReads,0);assert.equal(result.cardReadbacks.length,4);
  assert.equal(result.collectorIssues.filter(x=>x==='bot_p2p_chat:missing_scope').length,4);
  assert.equal(result.collectorIssues.filter(x=>x==='card_not_bot_p2p').length,4);
  assert.ok(result.cardReadbacks.every(x=>x.recipientProof===null));
});
