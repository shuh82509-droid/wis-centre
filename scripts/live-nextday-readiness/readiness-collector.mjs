// Read-only orchestration contract. The injected adapter must use the pinned
// formal Hub image for slot/card logic and independent bot GETs for messages,
// users, group and P2P members. No send, task mutation or permit installation
// method is accepted here. Missing scopes produce diagnostic NO-GO evidence.
import {createHash} from 'node:crypto';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dateAt=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const keyTopology=x=>{
  const g=x?.gateway||{},service=key=>{const s=x?.services?.[key]||{};return {
    id:s.id,image:s.image,status:s.status,health:s.health,startedAt:s.startedAt,
    release:s.release,liveNextDayInstance:s.liveNextDayInstance,
    dataMount:s.dataMount,runningRwWriters:s.runningRwWriters,
    dormantAutoRestartRw:s.dormantAutoRestartRw,dormantRwContainers:s.dormantRwContainers};};
  return sha({gateway:{id:g.id,image:g.image,status:g.status,health:g.health,
    routes:g.routes,configHash:g.configHash},
    services:Object.fromEntries(['hub','calendar','dispatch'].map(k=>[k,service(k)]))});
};
const boundedIssue=e=>String(e?.code||e?.status||e?.name||'readback_failed').slice(0,60);
const required=['readTopology','readOfficialSource','readApprovedBindings','readIdentity',
  'deriveRoomSlots','readHubState','readCardMessage','readPersonalChat','readPersonalPeer','cardMatches',
  'readGroup','readGroupTest','readBackup','readOaPage'];
// Keep each row's evidence and issues in source order even when GETs finish
// out of order. A worker runs one row at a time, so all per-row reads share
// the same small in-flight bound; no background reads survive this phase.
const mapBounded=async(rows,concurrency,read)=>{
  const results=new Array(rows.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async()=>{
    while(next<rows.length){const index=next++;results[index]=await read(rows[index]);}
  }));
  return results;
};

export async function collectReadOnlyEvidence({ops,policy,now=Date.now(),concurrency=4}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)
    throw new Error('Read-only collector concurrency must be an integer from 1 to 4');
  if(!ops||required.some(name=>typeof ops[name]!=='function'))
    throw new Error('Read-only collector adapter incomplete');
  const issues=[],date=dateAt(now+86400000),attemptInto=target=>async(code,fn,fallback=null)=>{
    try{return await fn();}catch(error){target.push(code+':'+boundedIssue(error));return fallback;}
  };
  const attempt=attemptInto(issues);
  const first=await attempt('topology_initial',()=>ops.readTopology());
  const source=await attempt('official_source',()=>ops.readOfficialSource(date,{fresh:true}));
  const bindings=await attempt('approved_bindings',()=>ops.readApprovedBindings(),[]);
  const identityReadbacks=[];
  const identityResults=await mapBounded(bindings||[],concurrency,async person=>{
    const rowIssues=[],row=await attemptInto(rowIssues)('person_identity',()=>
      ops.readIdentity(person.openId,person.number));
    return {issues:rowIssues,row:row&&{...row,number:person.number}};
  });
  for(const result of identityResults){
    issues.push(...result.issues);if(result.row)identityReadbacks.push(result.row);
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
  const cardReadbacks=[],chatReads=new Map();
  // Chat detail describes only the bot's chat, not a card's recipient. Cache
  // that read within this collection, but never cache message-specific peers
  // or read_users across cards sharing a chat.
  const readChat=chatId=>{
    if(!chatReads.has(chatId))chatReads.set(chatId,
      Promise.resolve().then(()=>ops.readPersonalChat(chatId)));
    return chatReads.get(chatId);
  };
  const cardResults=await mapBounded(cards,concurrency,async card=>{
    const rowIssues=[],rowAttempt=attemptInto(rowIssues),finish=row=>({issues:rowIssues,row});
    if(!card.messageId){rowIssues.push('card_message_id_missing');return finish(null);}
    const message=await rowAttempt('card_mget',()=>ops.readCardMessage(card.messageId));
    if(!message)return finish(null);
    // The ledger ID is only a lookup key. The independent bot GET response
    // must identify the same message before any chat/peer evidence is trusted.
    if(message.messageId!==card.messageId){
      rowIssues.push('card_independent_message_id_mismatch');return finish(null);
    }
    const task=rawState.tasks.find(t=>t.id===card.taskId);
    const matches=await rowAttempt('card_immutable_match',()=>ops.cardMatches(card,task,message),false);
    const chat=await rowAttempt('bot_p2p_chat',()=>readChat(message.chatId));
    const personalChat=chat&&{chatId:chat.chatId,mode:chat.mode,status:chat.status,
      checkedAs:chat.checkedAs,checkedAt:chat.checkedAt};
    const isBotP2p=/^oc_[A-Za-z0-9_-]+$/u.test(message.chatId||'')&&
      personalChat?.chatId===message.chatId&&
      personalChat.mode==='p2p'&&personalChat.status==='normal'&&
      personalChat.checkedAs==='bot';
    if(!isBotP2p)rowIssues.push('card_not_bot_p2p');
    // Never use a group's read_users as the personal-card recipient proof.
    const peer=isBotP2p?
      await rowAttempt('bot_p2p_peer',()=>ops.readPersonalPeer(message.chatId,card.messageId)):null;
    return finish({messageId:card.messageId,independentMessageId:message.messageId,
      chatId:message.chatId,
      senderAppId:message.senderAppId,msgType:message.msgType,deleted:message.deleted,
      immutableCardMatched:matches===true,checkedAt:message.checkedAt,
      personalChat,
      recipientProof:peer&&{kind:peer.kind,checkedAs:peer.checkedAs,chatId:peer.chatId,
        openId:peer.openId,checkedAt:peer.checkedAt,messageId:peer.messageId,
        complete:peer.complete,memberIds:peer.memberIds,readUserIds:peer.readUserIds}});
  });
  for(const result of cardResults){
    issues.push(...result.issues);if(result.row)cardReadbacks.push(result.row);
  }
  const groupReadback=await attempt('group_identity',()=>ops.readGroup(policy?.groupId));
  // A test ID must come from an out-of-band approved scope. Do not search
  // history for a similar-looking message or infer approval from JSON.
  const groupTest=policy?.approvedGroupTestMessageId?
    await attempt('approved_group_test',()=>ops.readGroupTest(policy.approvedGroupTestMessageId)):null;
  if(!policy?.approvedGroupTestMessageId)issues.push('approved_group_test_id_missing');
  else if(groupTest&&groupTest.messageId!==policy.approvedGroupTestMessageId)
    issues.push('approved_group_test_message_id_mismatch');
  // One read-only adapter call returns all three independently verified
  // archives. Never clone Hub evidence into another role or fill from policy.
  const rawBackup=await attempt('stopped_writer_backup',()=>ops.readBackup(first));
  const backup=Object.fromEntries(['hub','calendar','dispatch'].map(key=>{
    const row=rawBackup?.[key];
    if(!row||typeof row!=='object'||Array.isArray(row)){
      issues.push(`stopped_writer_backup_${key}_missing`);return [key,null];
    }
    return [key,row];
  }));
  const oaReadback=await attempt('real_oa_page',()=>ops.readOaPage(first));
  const last=await attempt('topology_final',()=>ops.readTopology());
  if(!first||!last||keyTopology(first)!==keyTopology(last))issues.push('topology_changed_during_collection');
  return {collectorIssues:issues,environment:{...(last||first||{}),backup,oaReadback},
    source:{...(source||{}),slots},bindings,identityReadbacks,
    state:{tasks,notifications},cardReadbacks,groupReadback,groupTest};
}
