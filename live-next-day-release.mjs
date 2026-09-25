import {createHash,createPrivateKey,createPublicKey,randomUUID,sign,verify} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {scheduleSessions} from './live-session-flow.mjs';
import {requireFact} from './workflow-store.mjs';

const WORKBOOK='EuYqssm4WhNwAvtyybKcDdk1ned';
const WAR_ROOM='oc_3f92ef62d6160399ee823e74def199e6';
const WAR_ROOM_RECIPIENT='__wis_live_war_room__';
export const NEXT_DAY_PERMIT_MOUNT='/run/live-next-day-release/permit.json';
const ROOM_CODES=new Set(['guanqi','brand_selection','youxuan','wangou']);
const MAX_AGE=120000;
const MAX_PERMIT_MS=30*60000;
const PERMIT_VERSION=2;
const SIGNING_CONTEXT='wis-live-next-day-release:v2\n';
const validIdentity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)&&value!=='local';
const validNonce=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const dateAt=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shiftHash=slot=>sha(slot.assistantShifts||[]).slice(0,32);
const sorted=(rows,key)=>[...rows].sort((a,b)=>String(key(a)).localeCompare(String(key(b))));
const signedFields=permit=>({version:permit.version,businessDate:permit.businessDate,releaseId:permit.releaseId,
  bootId:permit.bootId,scopeHash:permit.scopeHash,sourceHash:permit.sourceHash,
  sourceRevision:permit.sourceRevision,roomCodes:permit.roomCodes,groupChatId:permit.groupChatId,
  issuedAt:permit.issuedAt,expiresAt:permit.expiresAt,evidenceHash:permit.evidenceHash,
  activationNonce:permit.activationNonce});
const signingBytes=permit=>Buffer.from(SIGNING_CONTEXT+JSON.stringify(signedFields(permit)));
const signingPrivateKey=value=>{
  try{const key=value?.type==='private'?value:createPrivateKey(value);return key.asymmetricKeyType==='ed25519'?key:null;}catch{return null;}
};
const verifyingPublicKey=value=>{
  try{
    const key=value?.type==='public'?value:typeof value==='string'&&/^[A-Za-z0-9+/]+={0,2}$/u.test(value)&&value.length<=4096
      ?createPublicKey({key:Buffer.from(value,'base64'),format:'der',type:'spki'}):createPublicKey(value);
    return key.asymmetricKeyType==='ed25519'?key:null;
  }catch{return null;}
};

// The Hub only reads this exact isolated read-only container mount. The
// release operator installs the file on the host; neither DATA_DIR nor an
// arbitrary env path can act as a fallback. Deployment must verify the mount
// is read-only and disjoint from the writable application data volume.
export const isolatedNextDayPermitPath=env=>env?.FLOW_LIVE_NEXT_DAY_PERMIT_FILE===NEXT_DAY_PERMIT_MOUNT
  ?NEXT_DAY_PERMIT_MOUNT:null;

// This is a release-side claim, not authorization by itself. It binds the
// exact official workbook revision, every included shift, task, node, person,
// confirmed recipient, sent assignment-card ID and the approved group. The
// caller must independently read back the card IDs before installing a permit.
export function nextDayReleaseManifest({raw,snapshot,people,participants,recipient,date,now,releaseId,bootId}){
  requireFact(validIdentity(releaseId)&&validIdentity(bootId),'尚未绑定当前候选镜像与运行实例',409);
  requireFact(/^20\d{2}-\d{2}-\d{2}$/u.test(date||'')&&raw?.date===date,'次日放行日期与正式班表不一致',409);
  requireFact(raw?.source?.mode==='official_live'&&raw.source.verified===true&&raw.source.spreadsheetToken===WORKBOOK&&
    !raw.recovery&&Array.isArray(raw.rooms)&&raw.rooms.length===ROOM_CODES.size&&!(raw.issues||[]).length,
  '正式班表来源或四房解析未通过',409);
  const age=now-Date.parse(raw.updatedAt);
  requireFact(Number.isFinite(age)&&age>=-60000&&age<=MAX_AGE,'正式班表读回已过期',409);
  requireFact(Array.isArray(snapshot?.tasks)&&Array.isArray(snapshot?.flowNotifications)&&Array.isArray(people)&&
    typeof recipient==='function'&&participants,'缺少任务、卡片或人员验收数据',409);
  const codes=raw.rooms.map(r=>r.code);
  requireFact(new Set(codes).size===ROOM_CODES.size&&codes.every(code=>ROOM_CODES.has(code)),
    '正式班表没有覆盖全部四个直播间，禁止放行',409);
  const revisions=codes.map(code=>raw.sourceStatus?.[code]);
  requireFact(revisions.every(status=>status?.found===true&&status.sheetId&&Number.isSafeInteger(Number(status.revision))&&Number(status.revision)>0)&&
    new Set(revisions.map(status=>Number(status.revision))).size===1,'正式班表四房版本不一致',409);
  const group=recipient(WAR_ROOM_RECIPIENT);
  requireFact(group?.id===WAR_ROOM&&group.type==='chat_id','直播战队群尚未精确核验',409);
  const refs=[];
  for(const room of raw.rooms){
    const slots=scheduleSessions({...raw,rooms:[room]},date,people,now,participants);
    for(const slot of slots){
      const tasks=snapshot.tasks.filter(t=>t.runtime?.liveSession?.key===slot.key&&t.runtime.liveSession.signature===slot.signature&&
        t.runtime.state==='running'&&!t.runtime.liveSession.sourceIssue);
      requireFact(tasks.length===1,'正式班次任务缺失或重复',409);
      const task=tasks[0];
      for(const number of [slot.anchor,...slot.assistants]){
        const nodes=task.runtime.nodes.filter(n=>/^W04\.S4\.(E1|A[1-9]\d*)$/u.test(n.id)&&n.owner?.number===number);
        requireFact(nodes.length===1&&['pending','ready','completed'].includes(nodes[0].state)&&participants.canOwn(number,nodes[0].id),
          '主播或助理执行节点、在职身份待核验',409);
        const node=nodes[0];
        const cards=snapshot.flowNotifications.filter(n=>n.kind==='live_assignment'&&n.taskId===task.id&&n.nodeId===node.id&&
          n.attempt===node.attempt&&n.recipient===number&&n.state==='sent'&&n.messageId);
        requireFact(cards.length===1,'本人正式派工卡消息 ID 缺失或重复',409);
        const to=recipient(number);
        requireFact(to?.id&&to.type==='open_id','本人飞书收件映射未核验',409);
        refs.push({roomCode:room.code,sessionKey:slot.key,signature:slot.signature,startAt:slot.startAt,endAt:slot.endAt,
          shiftFingerprint:shiftHash(slot),taskId:task.id,nodeId:node.id,attempt:node.attempt,number,
          recipientId:to.id,recipientType:to.type,cardNoticeId:cards[0].id,cardMessageId:cards[0].messageId});
      }
    }
  }
  requireFact(refs.length>0,'正式班表没有可通知的本人班次',409);
  const source={workbook:WORKBOOK,revision:Number(revisions[0].revision),rooms:sorted(raw.rooms,r=>r.code).map(room=>({
    code:room.code,sheetId:raw.sourceStatus[room.code].sheetId,anchors:room.anchors,assistants:room.assistants
  }))};
  const sourceHash=sha(source),orderedRefs=sorted(refs,r=>[r.roomCode,r.sessionKey,r.number,r.nodeId].join('|'));
  const claim={version:PERMIT_VERSION,businessDate:date,releaseId,bootId,sourceRevision:source.revision,sourceHash,roomCodes:sorted(codes,x=>x),
    groupChatId:WAR_ROOM,refs:orderedRefs};
  return {...claim,scopeHash:sha(claim),preparedAt:raw.updatedAt};
}

// The deployment operator supplies the independent message-ID readback. This
// function only writes a separate release file; it NEVER edits task-center.json.
// No HTTP route, environment-only switch or automatic timer can call it.
export function installNextDayReleasePermit(file,{manifest,evidence,privateKey,clock=Date.now,
  ttlMs=MAX_PERMIT_MS,notAfterMs=Infinity}){
  const now=clock(),date=dateAt(now+86400000);
  const {scopeHash,preparedAt,...claim}=manifest||{};
  const signer=signingPrivateKey(privateKey);
  requireFact(signer,'缺少独立 Ed25519 发布私钥，禁止签发次日许可',409);
  requireFact(manifest?.version===PERMIT_VERSION&&manifest.businessDate===date&&manifest.groupChatId===WAR_ROOM&&
    validIdentity(manifest.releaseId)&&validIdentity(manifest.bootId)&&
    scopeHash===sha(claim)&&/^[a-f0-9]{64}$/u.test(manifest.sourceHash||'')&&
    Number.isSafeInteger(manifest.sourceRevision)&&manifest.sourceRevision>0&&
    Array.isArray(manifest.refs)&&manifest.refs.length>0&&Array.isArray(manifest.roomCodes)&&
    manifest.roomCodes.length===ROOM_CODES.size&&
    new Set(manifest.roomCodes).size===ROOM_CODES.size&&manifest.roomCodes.every(code=>ROOM_CODES.has(code)),
  '次日放行清单签名或范围无效',409);
  requireFact(Number.isFinite(ttlMs)&&ttlMs>0&&ttlMs<=MAX_PERMIT_MS,'放行许可有效期过长',409);
  requireFact(notAfterMs===Infinity||Number.isFinite(notAfterMs)&&notAfterMs>now,
    '放行提交截止时刻无效或已过期',409);
  const closesAt=Date.parse(dateAt(now)+'T17:00:00+08:00');
  const firstActivationDeadline=Date.parse(dateAt(now)+'T15:55:00+08:00');
  requireFact(now<closesAt&&new Date(now+8*3600000).getUTCHours()>=15,'不在本次次日提醒放行准备窗口',409);
  requireFact(evidence?.operator==='FD-026222'&&evidence?.scopeHash===manifest.scopeHash&&
    evidence?.sourceRevision===manifest.sourceRevision&&evidence?.groupChatId===WAR_ROOM&&
    evidence?.gatewayReleaseId===manifest.releaseId&&evidence?.gatewayBootId===manifest.bootId&&
    evidence?.gatewayVerified===true&&
    now-Date.parse(evidence.checkedAt)>=0&&now-Date.parse(evidence.checkedAt)<=MAX_AGE&&
    Date.parse(evidence.checkedAt)>=Date.parse(preparedAt)&&now-Date.parse(preparedAt)>=0&&now-Date.parse(preparedAt)<=MAX_AGE,
  '独立来源与群聊读回证据不足或已过期',409);
  // A sent ledger row and mget message ID do not prove delivery to the
  // intended person. Each card needs an independent bot message readback and
  // either that open_id in read_users or independently read P2P membership.
  const cardEvidence=evidence.cardMessages||[];
  requireFact(Array.isArray(cardEvidence)&&cardEvidence.length===manifest.refs.length&&
    new Set(cardEvidence.map(r=>r.cardNoticeId)).size===cardEvidence.length&&
    typeof evidence.botAppId==='string'&&/^cli_[A-Za-z0-9]{8,64}$/u.test(evidence.botAppId),
  '派工卡独立读回未覆盖所有收件人',409);
  const byNotice=new Map(cardEvidence.map(r=>[r.cardNoticeId,r]));
  for(const ref of manifest.refs){
    const row=byNotice.get(ref.cardNoticeId),message=row?.messageReadback,member=row?.recipientReadback;
    const checkedMessage=Date.parse(message?.checkedAt),checkedMember=Date.parse(member?.checkedAt);
    requireFact(row?.cardMessageId===ref.cardMessageId&&row?.recipientId===ref.recipientId&&
      row?.recipientType===ref.recipientType&&ref.recipientType==='open_id'&&
      typeof row.chatId==='string'&&/^oc_[A-Za-z0-9]{8,128}$/u.test(row.chatId)&&
      message?.messageId===ref.cardMessageId&&message?.chatId===row.chatId&&
      message?.senderAppId===evidence.botAppId&&
      member?.chatId===row.chatId&&member?.openId===ref.recipientId&&
      ['read_user','p2p_member'].includes(member?.kind)&&
      Number.isFinite(checkedMessage)&&Number.isFinite(checkedMember)&&
      checkedMessage>=Date.parse(preparedAt)&&checkedMember>=Date.parse(preparedAt)&&
      checkedMessage<=now&&checkedMember<=now&&
      now-checkedMessage<=MAX_AGE&&now-checkedMember<=MAX_AGE,
    '派工卡缺少目标本人 open_id 与会话归属的独立读回，禁止放行',409);
  }
  const expiresAt=Math.min(now+ttlMs,closesAt);
  const permit={version:PERMIT_VERSION,businessDate:date,releaseId:manifest.releaseId,bootId:manifest.bootId,
    scopeHash:manifest.scopeHash,sourceHash:manifest.sourceHash,
    sourceRevision:manifest.sourceRevision,roomCodes:manifest.roomCodes,groupChatId:WAR_ROOM,
    issuedAt:new Date(now).toISOString(),expiresAt:new Date(expiresAt).toISOString(),evidenceHash:sha(evidence),
    activationNonce:randomUUID()};
  permit.signature=sign(null,signingBytes(permit),signer).toString('base64url');
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const guard=file+'.install.lock';let guardFd,temp,committed=false;
  try{
    guardFd=openSync(guard,'wx',0o600);
    const existing=readNextDayReleasePermit(file,{publicKey:createPublicKey(signer)});
    requireFact(!existsSync(file)||existing,'现有放行许可文件不可核验，禁止覆盖',409);
    requireFact(now<firstActivationDeadline||existing&&Date.parse(existing.expiresAt)>now&&
      existing.scopeHash===permit.scopeHash,
    '首次激活必须在上海时间 15:55 前；过期许可不得补签或补发',409);
    requireFact(!existing||Date.parse(existing.expiresAt)<=now||existing.scopeHash===permit.scopeHash,
      '已有不同范围且尚未到期的次日许可，禁止覆盖',409);
    requireFact(!existing||Date.parse(existing.issuedAt)<now,
      '新的放行许可必须晚于上一份，禁止重用同一签发时刻',409);
    temp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
    const fd=openSync(temp,'wx',0o600);
    try{writeFileSync(fd,JSON.stringify(permit));fsyncSync(fd);}finally{closeSync(fd);}
    // This is the atomic activation commit point. A slow lock/fsync or host
    // pause must not slip the first permit past 15:55 or reuse stale evidence.
    const committedAt=clock(),firstActivation=!existing||Date.parse(existing.expiresAt)<=now;
    requireFact(Number.isFinite(committedAt)&&committedAt>=now&&committedAt<notAfterMs&&
      committedAt<expiresAt&&committedAt<closesAt&&
      committedAt-Date.parse(evidence.checkedAt)<=MAX_AGE&&
      committedAt-Date.parse(preparedAt)<=MAX_AGE&&
      (!firstActivation||committedAt<firstActivationDeadline)&&
      (firstActivation||committedAt<Date.parse(existing.expiresAt)),
    '放行原子提交时已超出批准时窗或证据已过期，许可保持关闭',409);
    // Do every fallible durability operation before activation. Once rename
    // succeeds the running Hub may observe the permit immediately, so a
    // post-rename fsync failure must never report "not activated" to the
    // release operator or invite a retry.
    if(process.platform!=='win32'){
      const dirFd=openSync(dirname(file),'r');try{fsyncSync(dirFd);}finally{closeSync(dirFd);}
    }
    renameSync(temp,file);temp=null;committed=true;
    return permit;
  }finally{
    if(temp&&existsSync(temp))unlinkSync(temp);
    if(guardFd!==undefined){
      if(committed){
        // The permit is already live. A failed lock cleanup may block a later
        // renewal, but must not turn an activated release into a false
        // "failed, safe to retry" result for the operator.
        try{closeSync(guardFd);}catch{try{console.error('Next-day permit active; release-lock close needs attention');}catch{}}
        try{unlinkSync(guard);}catch{try{console.error('Next-day permit active; release-lock removal needs attention');}catch{}}
      }else{closeSync(guardFd);unlinkSync(guard);}
    }
  }
}

// A missing verifier is a hard OFF state. The public key is supplied by the
// pinned candidate configuration; the signing private key never enters Hub.
export function readNextDayReleasePermit(file,{publicKey}={}){
  try{
    const verifier=verifyingPublicKey(publicKey);
    if(!verifier)return null;
    const value=JSON.parse(readFileSync(file,'utf8'));
    const issued=Date.parse(value?.issuedAt),expires=Date.parse(value?.expiresAt);
    const close=Number.isFinite(issued)?Date.parse(dateAt(issued)+'T17:00:00+08:00'):NaN;
    return value?.version===PERMIT_VERSION&&value?.groupChatId===WAR_ROOM&&validIdentity(value.releaseId)&&validIdentity(value.bootId)&&
      /^20\d{2}-\d{2}-\d{2}$/u.test(value.businessDate||'')&&
      /^[a-f0-9]{64}$/u.test(value.scopeHash||'')&&/^[a-f0-9]{64}$/u.test(value.sourceHash||'')&&
      /^[a-f0-9]{64}$/u.test(value.evidenceHash||'')&&validNonce(value.activationNonce)&&
      typeof value.signature==='string'&&/^[A-Za-z0-9_-]{86}$/u.test(value.signature)&&
      Number.isSafeInteger(value.sourceRevision)&&value.sourceRevision>0&&
      Array.isArray(value.roomCodes)&&value.roomCodes.length===ROOM_CODES.size&&
      value.roomCodes.every(code=>ROOM_CODES.has(code))&&new Set(value.roomCodes).size===ROOM_CODES.size&&
      Number.isFinite(issued)&&Number.isFinite(expires)&&dateAt(issued+86400000)===value.businessDate&&
      new Date(issued+8*3600000).getUTCHours()>=15&&expires>issued&&expires-issued<=MAX_PERMIT_MS&&expires<=close&&
      verify(null,signingBytes(value),verifier,Buffer.from(value.signature,'base64url'))?value:null;
  }catch{return null;}
}

// A running Hub remembers the newest signed activation it has observed.
// Restoring an earlier but otherwise valid file cannot roll back the release;
// a process restart has a new bootId and cannot reuse any previous permit.
export function createNextDayReleaseReader(file,{publicKey,releaseId,bootId,clock=Date.now}={}){
  let latestIssued=-Infinity,latestNonce=null,lastNow=-Infinity,revoked=false;
  return ()=>{
    const now=clock();
    if(!Number.isFinite(now)||now<lastNow-1000)revoked=true;
    lastNow=Math.max(lastNow,now);
    if(revoked)return null;
    const permit=readNextDayReleasePermit(file,{publicKey});
    if(!permit){if(latestIssued>-Infinity)revoked=true;return null;}
    if(permit.releaseId!==releaseId||permit.bootId!==bootId)return null;
    const issued=Date.parse(permit.issuedAt);
    if(issued<latestIssued||issued===latestIssued&&permit.activationNonce!==latestNonce){revoked=true;return null;}
    if(issued>latestIssued){latestIssued=issued;latestNonce=permit.activationNonce;}
    return permit;
  };
}

export function currentNextDayRelease(permit,{manifest,notice,now,releaseId,bootId}){
  if(!permit||!manifest||permit.version!==PERMIT_VERSION||manifest.version!==PERMIT_VERSION||permit.businessDate!==manifest.businessDate||
    !validIdentity(releaseId)||!validIdentity(bootId)||permit.releaseId!==releaseId||permit.bootId!==bootId||
    manifest.releaseId!==releaseId||manifest.bootId!==bootId||
    permit.scopeHash!==manifest.scopeHash||permit.sourceHash!==manifest.sourceHash||
    permit.sourceRevision!==manifest.sourceRevision||permit.groupChatId!==WAR_ROOM||
    sha(permit.roomCodes)!==sha(manifest.roomCodes)||
    now<Date.parse(permit.issuedAt)||now>=Date.parse(permit.expiresAt)||
    dateAt(now+86400000)!==permit.businessDate||new Date(now+8*3600000).getUTCHours()!==16)return false;
  if(!notice)return true;
  if(notice.releaseScopeHash!==permit.scopeHash||notice.businessDate!==permit.businessDate)return false;
  if(notice.kind==='live_tomorrow')return manifest.refs.some(ref=>ref.taskId===notice.taskId&&ref.nodeId===notice.nodeId&&
    ref.attempt===notice.attempt&&ref.number===notice.recipient&&ref.signature===notice.signature&&
    ref.shiftFingerprint===notice.shiftFingerprint&&ref.roomCode===notice.roomCode);
  if(['live_tomorrow_group_pending','live_tomorrow_group_confirmed'].includes(notice.kind)){
    const expectedRefs=manifest.refs.filter(ref=>ref.roomCode===notice.roomCode);
    if(!expectedRefs.length||!Array.isArray(notice.related)||notice.related.length!==expectedRefs.length)return false;
    const key=(taskId,nodeId,attempt,number,signature,shiftFingerprint)=>
      JSON.stringify([taskId,nodeId,attempt,number,signature,shiftFingerprint]);
    const expected=expectedRefs.map(ref=>key(ref.taskId,ref.nodeId,ref.attempt,ref.number,ref.signature,ref.shiftFingerprint)).sort();
    const actual=notice.related.map(ref=>key(ref.taskId,ref.nodeId,ref.attempt,ref.recipient,ref.signature,ref.shiftFingerprint)).sort();
    return new Set(expected).size===expected.length&&new Set(actual).size===actual.length&&
      expected.every((value,index)=>value===actual[index]);
  }
  return false;
}

// Synchronous guard for the lease and the final no-await interval before
// Feishu POST. The full source/task manifest is separately recomputed by the
// async official-sheet verifier after token acquisition.
export function currentNextDayReleaseLease(permit,notice,now,{releaseId,bootId}={}){
  return !!(permit?.version===PERMIT_VERSION&&notice?.releaseScopeHash===permit.scopeHash&&
    validIdentity(releaseId)&&validIdentity(bootId)&&permit.releaseId===releaseId&&permit.bootId===bootId&&
    notice.businessDate===permit.businessDate&&permit.groupChatId===WAR_ROOM&&
    permit.roomCodes?.includes(notice.roomCode)&&dateAt(now+86400000)===permit.businessDate&&
    new Date(now+8*3600000).getUTCHours()===16&&now>=Date.parse(permit.issuedAt)&&now<Date.parse(permit.expiresAt));
}
