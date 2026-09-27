// Read-only orchestration contract. The injected adapter must use the pinned
// formal Hub image for slot/card logic and independent bot GETs for messages,
// users, group and P2P members. No send, task mutation or permit installation
// method is accepted here. Missing scopes produce diagnostic NO-GO evidence.
import {createHash} from 'node:crypto';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dateAt=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const keyTopology=x=>{
  const g=x?.gateway||{},service=key=>{const s=x?.services?.[key]||{};return {
    id:s.id,image:s.image,status:s.status,health:s.health,
    dataMount:s.dataMount,runningRwWriters:s.runningRwWriters,
    dormantAutoRestartRw:s.dormantAutoRestartRw};};
  return sha({gateway:{id:g.id,image:g.image,status:g.status,health:g.health,
    routes:g.routes,configHash:g.configHash},
    services:Object.fromEntries(['hub','calendar','dispatch'].map(k=>[k,service(k)]))});
};
const boundedIssue=e=>String(e?.code||e?.status||e?.name||'readback_failed').slice(0,60);
const required=['readTopology','readOfficialSource','readApprovedBindings','readIdentity',
  'deriveRoomSlots','readHubState','readCardMessage','readPersonalChat','readPersonalPeer','cardMatches',
  'readGroup','readGroupTest','readBackup','readOaPage'];

export async function collectReadOnlyEvidence({ops,policy,now=Date.now()}={}){
  if(!ops||required.some(name=>typeof ops[name]!=='function'))
    throw new Error('Read-only collector adapter incomplete');
  const issues=[],date=dateAt(now+86400000),attempt=async(code,fn,fallback=null)=>{
    try{return await fn();}catch(error){issues.push(code+':'+boundedIssue(error));return fallback;}
  };
  const first=await attempt('topology_initial',()=>ops.readTopology());
  const source=await attempt('official_source',()=>ops.readOfficialSource(date,{fresh:true}));
  const bindings=await attempt('approved_bindings',()=>ops.readApprovedBindings(),[]);
  const identityReadbacks=[];
  for(const person of bindings||[]){
    const row=await attempt('person_identity',()=>ops.readIdentity(person.openId,person.number));
    if(row)identityReadbacks.push({...row,number:person.number});
  }
  const rooms=source?.rooms||[],slots=[];
  for(const room of rooms){
    const rows=await attempt('derived_room_'+String(room.code).slice(0,32),()=>
      ops.deriveRoomSlots({...source,rooms:[room]},date,bindings,identityReadbacks));
    if(Array.isArray(rows))slots.push(...rows);
  }
  const rawState=await attempt('formal_hub_state',()=>ops.readHubState());
  const tasks=(rawState?.tasks||[]).map(t=>({id:t.id,workflow:t.workflow,
    state:t.runtime?.state,liveSession:t.runtime?.liveSession,
    nodes:(t.runtime?.nodes||[]).map(n=>({id:n.id,owner:n.owner?.number,
      state:n.state,attempt:n.attempt}))}));
  const notifications=rawState?.flowNotifications||[];
  const targetIds=new Set(tasks.filter(t=>t.workflow==='04'&&t.liveSession?.date===date).map(t=>t.id));
  const cards=notifications.filter(n=>n.kind==='live_assignment'&&targetIds.has(n.taskId));
  const cardReadbacks=[];
  for(const card of cards){
    if(!card.messageId){issues.push('card_message_id_missing');continue;}
    const message=await attempt('card_mget',()=>ops.readCardMessage(card.messageId));
    if(!message)continue;
    // The ledger ID is only a lookup key. The independent bot GET response
    // must identify the same message before any chat/peer evidence is trusted.
    if(message.messageId!==card.messageId){
      issues.push('card_independent_message_id_mismatch');continue;
    }
    const task=rawState.tasks.find(t=>t.id===card.taskId);
    const matches=await attempt('card_immutable_match',()=>ops.cardMatches(card,task,message),false);
    const chat=await attempt('bot_p2p_chat',()=>ops.readPersonalChat(message.chatId));
    const personalChat=chat&&{chatId:chat.chatId,mode:chat.mode,status:chat.status,
      checkedAs:chat.checkedAs,checkedAt:chat.checkedAt};
    const isBotP2p=/^oc_[A-Za-z0-9_-]+$/u.test(message.chatId||'')&&
      personalChat?.chatId===message.chatId&&
      personalChat.mode==='p2p'&&personalChat.status==='normal'&&
      personalChat.checkedAs==='bot';
    if(!isBotP2p)issues.push('card_not_bot_p2p');
    // Never use a group's read_users as the personal-card recipient proof.
    const peer=isBotP2p?
      await attempt('bot_p2p_peer',()=>ops.readPersonalPeer(message.chatId,card.messageId)):null;
    cardReadbacks.push({messageId:card.messageId,independentMessageId:message.messageId,
      chatId:message.chatId,
      senderAppId:message.senderAppId,msgType:message.msgType,deleted:message.deleted,
      immutableCardMatched:matches===true,checkedAt:message.checkedAt,
      personalChat,
      recipientProof:peer&&{kind:peer.kind,checkedAs:peer.checkedAs,chatId:peer.chatId,
        openId:peer.openId,checkedAt:peer.checkedAt,messageId:peer.messageId,
        complete:peer.complete,memberIds:peer.memberIds,readUserIds:peer.readUserIds}});
  }
  const groupReadback=await attempt('group_identity',()=>ops.readGroup(policy?.groupId));
  // A test ID must come from an out-of-band approved scope. Do not search
  // history for a similar-looking message or infer approval from JSON.
  const groupTest=policy?.approvedGroupTestMessageId?
    await attempt('approved_group_test',()=>ops.readGroupTest(policy.approvedGroupTestMessageId)):null;
  if(!policy?.approvedGroupTestMessageId)issues.push('approved_group_test_id_missing');
  else if(groupTest&&groupTest.messageId!==policy.approvedGroupTestMessageId)
    issues.push('approved_group_test_message_id_mismatch');
  const backup=await attempt('stopped_writer_backup',()=>ops.readBackup(first));
  const oaReadback=await attempt('real_oa_page',()=>ops.readOaPage(first));
  const last=await attempt('topology_final',()=>ops.readTopology());
  if(!first||!last||keyTopology(first)!==keyTopology(last))issues.push('topology_changed_during_collection');
  return {collectorIssues:issues,environment:{...(last||first||{}),backup,oaReadback},
    source:{...(source||{}),slots},bindings,identityReadbacks,
    state:{tasks,notifications},cardReadbacks,groupReadback,groupTest};
}
