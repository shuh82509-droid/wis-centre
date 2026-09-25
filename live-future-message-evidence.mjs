// Future-only delivery chain for verified live participants. This proves the
// exact requested open_id and the bot's resulting message, not the identity
// of a P2P peer or that the employee has read/acted on the message.
import {createHash} from 'node:crypto';
import {requireFact} from './workflow-store.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const openId = value => /^ou_[a-z0-9]+$/u.test(value || '');
const messageId = value => /^om_[A-Za-z0-9_-]+$/u.test(value || '');
const chatId = value => /^oc_[A-Za-z0-9_-]+$/u.test(value || '');
const clean = value => String(value || '').replace(/&#(\d+);/gu,
  (_, code) => String.fromCharCode(Number(code))).replace(/[*\n\r]/gu, '');

function expectedCardIdentity(content) {
  const card = JSON.parse(content);
  const subtitle = card?.header?.subtitle?.content;
  const lines = card?.body?.elements?.[0]?.columns?.[0]?.elements?.map(element => clean(element.content));
  requireFact(typeof subtitle === 'string' && lines?.length === 2 && lines.every(Boolean),
    '本人卡缺少可核对的场次标识', 409);
  return sha(JSON.stringify({subtitle,lines}));
}

function returnedContent(message) {
  return message?.body?.content ?? message?.content;
}

function nativeCardIdentity(content) {
  let parsed = JSON.parse(content);
  if (typeof parsed?.json_card === 'string') parsed = JSON.parse(parsed.json_card);
  if (parsed?.header?.subtitle?.content && parsed?.body?.elements)
    return expectedCardIdentity(JSON.stringify(parsed));
  const subtitle = parsed?.header?.property?.subtitle?.property?.content;
  const lines = parsed?.body?.property?.elements?.[0]?.property?.columns?.[0]
    ?.property?.elements?.map(element => clean(element.property?.elements
      ?.map(value => value.property?.content || '').join('')));
  requireFact(typeof subtitle === 'string' && lines?.length === 2 && lines.every(Boolean),
    'bot mget 没有可核对的本人卡原生内容', 409);
  return sha(JSON.stringify({subtitle,lines}));
}

export const futureLivePersonalNotice = (notice, task, liveCards, delivery) => Boolean(
  task?.workflow === '04' && task.runtime?.liveSession && notice?.nodeId &&
  liveCards?.has(notice.recipient) && ['live_feishu_card','live_tomorrow_text'].includes(delivery?.channel) &&
  ['interactive','text'].includes(delivery?.msg_type));

// Must be the last durable transaction before POST, with no intervening await.
// Caller must use the returned request verbatim; the request must never be
// recomputed from a new assignment or a changed card after a timeout.
export function stageFutureLiveIntent(store, {noticeId,leaseId,participants,
  appId,recipient,delivery,clock=Date.now,validNotice}) {
  requireFact(typeof participants?.recipient === 'function' &&
    typeof participants?.actor === 'function' && typeof validNotice === 'function',
  '缺少直播本人身份或发送门禁', 503);
  return store.transaction(s => {
    const row = s.flowNotifications?.find(n => n.id === noticeId);
    const task = s.tasks?.find(t => t.id === row?.taskId);
    const node = task?.runtime?.nodes?.find(n => n.id === row?.nodeId);
    requireFact(row?.state === 'sending' && row.leaseId === leaseId &&
      !row.unknown && !row.messageId && !row.futureEvidence &&
      futureLivePersonalNotice(row,task,{has:number=>number===row.recipient},delivery) &&
      validNotice(row,s,task,node),
    '本人通知已有发送意图，或任务、租约已变化；禁止再次 POST', 409);
    const mapped = participants.recipient(row.recipient);
    requireFact(mapped?.type === 'open_id' && openId(mapped.id) &&
      recipient?.type === 'open_id' && mapped.id === recipient.id,
    '没有新鲜核验的本人 open_id', 409);
    const actor = participants.actor({appId,openId:mapped.id,task,nodeId:row.nodeId});
    requireFact(actor?.user?.number === row.recipient && actor.taskId === task.id &&
      actor.nodeId === node.id && actor.channel === 'feishu-live',
    '收件 open_id 不能办理本人的当前直播节点', 409);
    requireFact(row.delivery?.content === delivery.content &&
      row.delivery?.msg_type === delivery.msg_type &&
      row.delivery?.channel === delivery.channel,
    '已冻结的通知内容发生变化', 409);
    const request = {receive_id:mapped.id,msg_type:delivery.msg_type,
      uuid:sha(row.id).slice(0,32),content:delivery.content};
    const identityHash = delivery.msg_type === 'interactive'
      ? expectedCardIdentity(delivery.content)
      : sha(JSON.parse(delivery.content).text);
    requireFact(identityHash && (delivery.msg_type !== 'text' ||
      typeof JSON.parse(delivery.content).text === 'string'),
    '通知正文不完整', 409);
    row.futureEvidence = {version:1,phase:'prepared',appId,
      noticeId:row.id,taskId:task.id,nodeId:node.id,attempt:row.attempt,
      ownerNumber:row.recipient,leaseId,receiveIdType:'open_id',
      receiveId:mapped.id,requestHash:sha(JSON.stringify(request)),
      contentHash:sha(delivery.content),identityHash,msgType:delivery.msg_type,
      businessDate:task.runtime.liveSession.date,
      sessionSignature:task.runtime.liveSession.signature,
      preparedAt:new Date(clock()).toISOString()};
    return {receiveIdType:'open_id',request};
  });
}

// A complete native acknowledgement is *not* human delivery. It only permits
// a read-only mget phase. Missing fields or an ambiguous HTTP result freeze.
export function recordFutureLiveResponse(store,{noticeId,leaseId,request,response,httpOk,clock=Date.now}) {
  return store.transaction(s => {
    const row = s.flowNotifications?.find(n => n.id === noticeId);
    const evidence = row?.futureEvidence;
    requireFact(row?.state === 'sending' && row.leaseId === leaseId &&
      evidence?.phase === 'prepared' && evidence.leaseId === leaseId &&
      evidence.requestHash === sha(JSON.stringify(request)) &&
      request.receive_id === evidence.receiveId && request.msg_type === evidence.msgType &&
      sha(request.content || '') === evidence.contentHash,
    '平台响应无法绑定原始发送意图', 409);
    const result = response?.data;
    if (httpOk !== true || response?.code !== 0 ||
      !messageId(result?.message_id) || !chatId(result?.chat_id)) {
      row.state='attention';row.unknown=true;
      row.error='本人消息发送结果不明，已停止自动重发；仅可只读核验原消息';
      if (messageId(result?.message_id)) row.pendingMessageId=result.message_id;
      delete row.leaseId;delete row.leaseUntil;
      return {verifying:false,unknown:true};
    }
    evidence.phase='verifying';
    evidence.messageId=result.message_id;
    evidence.chatId=result.chat_id;
    evidence.responseAt=new Date(clock()).toISOString();
    row.messageId=result.message_id;
    row.state='verifying';row.unknown=false;row.error='等待机器人只读回查消息';
    row.nextVerifyAt=clock();
    delete row.leaseId;delete row.leaseUntil;
    return {verifying:true,messageId:result.message_id,chatId:result.chat_id};
  });
}

export function holdFutureLiveUnknown(store,noticeId,reason='发送结果不明') {
  return store.transaction(s => {
    const row=s.flowNotifications?.find(n=>n.id===noticeId);
    requireFact(row?.futureEvidence?.phase==='prepared' && !row.futureEvidence.messageId,
      '没有待核验的本人消息发送意图',409);
    row.state='attention';row.unknown=true;
    row.error=reason+'；已停止自动重发，请只读核验原消息';
    delete row.leaseId;delete row.leaseUntil;
    return {unknown:true};
  });
}

export function verifyFutureLiveReadback(row,message,chat,appId) {
  const evidence=row?.futureEvidence;
  requireFact(row?.state==='verifying' && evidence?.phase==='verifying' &&
    evidence.appId===appId && evidence.receiveIdType==='open_id' &&
    openId(evidence.receiveId) && row.messageId===evidence.messageId &&
    message?.message_id===evidence.messageId && message?.chat_id===evidence.chatId &&
    message?.msg_type===evidence.msgType && message?.deleted===false &&
    message.sender?.sender_type==='app' && message.sender.id===appId &&
    chat?.chat_mode==='p2p' && (!chat.chat_status || chat.chat_status==='normal'),
  'bot mget 未能核对本人消息的发送应用、会话或类型',409);
  const content=returnedContent(message);
  requireFact(typeof content==='string' && (
    evidence.msgType==='interactive'
      ? nativeCardIdentity(content)===evidence.identityHash
      : sha(JSON.parse(content).text)===evidence.identityHash),
  'bot mget 未能核对本人消息的不变内容',409);
  return {messageId:evidence.messageId,chatId:evidence.chatId,
    requestedOpenId:evidence.receiveId,independentlyProvedPeer:false,
    humanRead:false};
}

export function commitFutureLiveReadback(store,noticeId,verified,clock=Date.now) {
  return store.transaction(s => {
    const row=s.flowNotifications?.find(n=>n.id===noticeId);
    requireFact(row?.state==='verifying' && row.futureEvidence?.phase==='verifying' &&
      row.messageId===verified.messageId &&
      row.futureEvidence.chatId===verified.chatId &&
      row.futureEvidence.receiveId===verified.requestedOpenId &&
      verified.independentlyProvedPeer===false && verified.humanRead===false,
    '消息回查无法绑定原始发送意图',409);
    row.futureEvidence.phase='verified';
    row.futureEvidence.readback={...verified,verifiedAt:new Date(clock()).toISOString()};
    row.state='sent';row.unknown=false;row.error='';
    row.sentAt=new Date(clock()).toISOString();
    delete row.nextVerifyAt;
    return {state:'sent',messageId:row.messageId,
      requestedOpenId:row.futureEvidence.receiveId,
      independentlyProvedPeer:false,humanRead:false};
  });
}
