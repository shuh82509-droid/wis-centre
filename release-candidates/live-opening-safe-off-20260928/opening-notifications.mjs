import {createHash,randomUUID} from 'node:crypto';
import {scheduleSessions} from './live-session-flow.mjs';
const groupId='oc_3f92ef62d6160399ee823e74def199e6';
const day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const hour=ms=>new Date(ms+8*3600000).getUTCHours();
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const time=x=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x));
const range=(start,end,date)=>`${day(Date.parse(start))===date?'':'次日'}${time(start)}-${day(Date.parse(end))===date?'':'次日'}${time(end)}`;
const dateLabel=date=>`${Number(date.slice(5,7))}月${Number(date.slice(8))}日（星期${'日一二三四五六'[new Date(date+'T12:00:00+08:00').getUTCDay()]}）`;

// Only this narrow lane may run while general workflow dispatch is in pilot.
// Its own journal, sources and sender never enqueue or flush historical tasks.
export function buildOpeningPlan(raw,date,participants,now){
 const people=participants.people(),messages=[],issues=[...(raw.issues||[])],rooms=[];
 for(const room of raw.rooms||[]){
  try{
   const slots=scheduleSessions({...raw,rooms:[room]},date,people,now,participants),recipients=new Map();
   const add=(number,role,start,end)=>{
    const target=participants.recipient(number);if(!target?.id||target.type!=='open_id')throw Error('个人飞书收件人未核验');
    const k=number+'|'+role,entry=recipients.get(k)||{number,role,target,periods:[]};
    const period=range(start,end,date);if(!entry.periods.includes(period))entry.periods.push(period);recipients.set(k,entry);
   };
   for(const slot of slots){add(slot.anchor,'主播',slot.startAt,slot.endAt);for(const shift of slot.assistantShifts)add(shift.number,'助理',shift.startAt,shift.endAt)}
   const direct=[...recipients.values()].map(entry=>{
    const text=`【${room.name}直播间开播提醒 - ${dateLabel(date)}】\n${entry.target.name}你好！明天你被安排为以下时段的开播${entry.role}：\n${entry.periods.join('、')}\n请提前做好开播准备～\n⏰ 请确认是否能准时开播，如有问题请及时沟通 🙏\n如排班有调整，请以最新安排为准。`;
    return {kind:'direct',date,room:room.name,roomCode:room.code,recipient:entry.target,key:digest([date,room.code,entry.target.id,entry.role,text]),text};
   });
   const lines=slots.map(slot=>`${range(slot.startAt,slot.endAt,date)}时段：\n🎙️ 主播：${participants.recipient(slot.anchor).name}${slot.cohostDisplay?`（共播：${slot.cohostDisplay}）`:''}\n🤝 助理：${slot.assistants.map(n=>participants.recipient(n).name).join('、')}`);
   const group={kind:'group',date,room:room.name,roomCode:room.code,recipient:{id:groupId,type:'chat_id',name:'WIS直播战队'},requires:direct.map(x=>x.key),key:digest(['group',date,room.code,direct.map(x=>x.key)]),text:`【${room.name}直播间开播主播助理已通知 - ${dateLabel(date)}】\n${lines.join('\n\n')}\n已通知到位，请准时开播！\n本通知表示私信已发送成功，不代表本人已确认收到。`};
   group.key=digest([group.key,group.text]);
   messages.push(...direct,group);rooms.push({room:room.name,roomCode:room.code,slots:slots.length,privateMessages:direct.length});
  }catch(error){issues.push({roomCode:room.code,roomName:room.name,message:String(error.message).slice(0,180)})}
 }
 return {date,messages,rooms,issues};
}
const messageIdValid=value=>typeof value==='string'&&value.trim().length>0;
const provedSent=row=>row?.state==='sent'&&row.unknown!==true&&messageIdValid(row.messageId);
// Newly held receipts require independent readback before releasing group summaries.
const groupDependencyProved=row=>provedSent(row)&&row.autoHold!==true;
// Result capabilities are private, invocation-bound and immutable; callers cannot fake them.
const senderEvidence=new WeakMap();
function attestSenderResult(result,requestHash,uuid,beforePost,identity){
 const outcome=Object.freeze({...result});senderEvidence.set(outcome,Object.freeze({requestHash,uuid,beforePost,...identity}));return outcome;
}
const unresolved=row=>row?.autoHold===true||row?.unknown===true||['prepared','sending','uncertain','unknown'].includes(row?.state)||row?.state==='sent'&&!messageIdValid(row.messageId)||!provedSent(row)&&row?.postAttempted!==false&&Boolean(row?.postIntentAt||row?.firstAttemptAt||row?.attempts);
const known=value=>typeof value==='string'&&value.length>0;
function sameScope(row,message){
 // Missing legacy context is not proof that an unknown POST belongs elsewhere.
 if(known(row?.date)&&row.date!==message.date)return false;
 if(known(row?.kind)&&row.kind!==message.kind)return false;
 if(known(row?.recipientId)&&row.recipientId!==message.recipient.id)return false;
 if(known(row?.roomCode)&&known(message.roomCode))return row.roomCode===message.roomCode;
 if(known(row?.room)&&known(message.room))return row.room===message.room;
 return true;
}
function receipts(state){
 if(!state||state.openingReceipts!=null&&!Array.isArray(state.openingReceipts))throw Error('Opening journal cannot be verified');
 const rows=state.openingReceipts||[];
 if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Opening receipt cannot be verified');
 return rows;
}
const notPosted=reason=>({state:'attention',unknown:false,postAttempted:false,reason});
const unknownPost=reason=>({state:'attention',unknown:true,postAttempted:true,reason});
const unverifiedInvocation=reason=>({state:'attention',unknown:true,postAttempted:null,reason});
function messageRequest(message,uuid){
 const url='https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type='+message.recipient.type;
 const body=JSON.stringify({receive_id:message.recipient.id,msg_type:'text',uuid,content:JSON.stringify({text:message.text})});
 return {url,body,hash:digest([url,body])};
}

export class OpeningNotifications{
 constructor({store,readSchedule,participants,send,clock=Date.now,enabled=false,sendHour=16,maxPerTick=3,enabledRooms=['brand_selection','youxuan','wangou']}){
  Object.assign(this,{store,readSchedule,participants,send,clock,enabled,sendHour,maxPerTick,enabledRooms});this.running=false;this.nextAt=0;this.storageBlocked=false;
 }
 async plan(){
  const now=this.clock(),date=day(now+86400000),raw=await this.readSchedule(null,date,{fresh:true});
  const disabledRooms=(raw.rooms||[]).filter(r=>!this.enabledRooms.includes(r.code)).map(r=>({roomCode:r.code,room:r.name,reason:'暂未启用'}));
  return {...buildOpeningPlan({...raw,rooms:(raw.rooms||[]).filter(r=>this.enabledRooms.includes(r.code))},date,this.participants(),this.clock()),disabledRooms};
 }
 persist(mutate){
  try{const value=this.store.transaction(mutate);if(value?.then)throw Error('Opening transaction must be synchronous');return value;}
  catch{this.storageBlocked=true;throw Error('Opening persistence is unverified; automatic sending stopped');}
 }
 confirm(check){
  try{const state=this.store.read();if(state?.then||!check(receipts(state)))throw Error('Opening commit readback mismatch');return true;}
  catch{this.storageBlocked=true;throw Error('Opening commit readback is unverified; automatic sending stopped');}
 }
 async tick(){
  if(!this.enabled||this.storageBlocked||this.running||this.clock()<this.nextAt)return;
  this.running=true;this.nextAt=this.clock()+60000;
  try{
   const plan=await this.plan(),now=this.clock(),due=hour(now)>=this.sendHour;
   this.persist(s=>{receipts(s);s.openingStatus={checkedAt:new Date(now).toISOString(),date:plan.date,state:due?'active':'waiting',sendHour:this.sendHour,rooms:plan.rooms,issues:plan.issues,disabledRooms:plan.disabledRooms};s.openingReceipts||=[]});
   if(!due)return;
   let sent=0;
   for(const message of plan.messages){
    if(sent>=this.maxPerTick)break;
    const expectedRequest=messageRequest(message,message.key.slice(0,32));
    const lease=this.persist(s=>{
     const rows=receipts(s);
     s.openingReceipts||=[];
     // No automatic retry, including expired legacy leases or a changed body key.
     if(rows.some(r=>r.key===message.key||unresolved(r)&&sameScope(r,message)))return null;
     if(message.kind==='group'&&(!Array.isArray(message.requires)||!message.requires.every(key=>rows.some(r=>r.key===key&&groupDependencyProved(r)))))return null;
     // The scope hold is never auto-cleared, even after a success/result commit.
     // Releasing it needs an independently reviewed message/source readback protocol.
     const row={key:message.key,date:message.date,room:message.room,roomCode:message.roomCode,kind:message.kind,recipientId:message.recipient.id,recipientName:message.recipient.name,firstAttemptAt:new Date(this.clock()).toISOString(),uuid:message.key.slice(0,32),requestHash:expectedRequest.hash,autoHold:true,attempts:0,state:'prepared',preparedAt:new Date(this.clock()).toISOString(),lease:randomUUID(),unknown:false,postAttempted:false};
     s.openingReceipts.push(row);
     return {...row};
    });
    if(!lease)continue;
    this.confirm(rows=>rows.some(r=>r.key===lease.key&&r.lease===lease.lease&&r.uuid===lease.uuid&&r.requestHash===expectedRequest.hash&&r.state==='prepared'&&r.unknown===false&&r.postAttempted===false));
    let result,invocationGate,gateOpened=false,senderInvoked=false;
    try{
     // Never send yesterday's queue or a now-stale personnel assignment.
     const fresh=await this.plan();
     if(fresh.date!==message.date||!fresh.messages.some(x=>x.key===message.key))result=notPosted('发送前班表已变化或身份无法核验，本条未发送');
     else {senderInvoked=true;result=await this.send(message,lease.uuid,async()=>{
      const latest=await this.plan(),row=this.store.read().openingReceipts.find(x=>x.key===message.key);
      return row?.state==='prepared'&&row.lease===lease.lease&&latest.date===message.date&&latest.messages.some(x=>x.key===message.key);
     },invocationGate=async actualRequestHash=>{
      const latest=await this.plan();
      const sourceCheckedAt=this.clock();
      if(actualRequestHash!==expectedRequest.hash||latest.date!==message.date||!latest.messages.some(x=>x.key===message.key&&messageRequest(x,lease.uuid).hash===expectedRequest.hash)||day(this.clock()+86400000)!==message.date||hour(this.clock())<this.sendHour)return null;
      const intentAt=new Date(sourceCheckedAt).toISOString();
      const committed=this.persist(s=>{
       const rows=receipts(s),row=rows.find(r=>r.key===message.key);
       if(row?.state!=='prepared'||row.lease!==lease.lease||rows.some(r=>r!==row&&unresolved(r)&&sameScope(r,message)))return false;
       // Intent is a risk hold, not evidence that fetch/POST was invoked.
       row.state='sending';row.unknown=false;row.postAttempted=null;row.postIntentAt=intentAt;row.attempts++;
       return true;
      });
      if(!committed)return null;
      const ownsIntent=rows=>rows.some(r=>r.key===lease.key&&r.lease===lease.lease&&r.requestHash===expectedRequest.hash&&r.state==='sending'&&r.unknown===false&&r.postAttempted===null&&r.postIntentAt===intentAt)&&!rows.some(r=>r.key!==lease.key&&unresolved(r)&&sameScope(r,message));
      this.confirm(ownsIntent);
      // Called synchronously in the sender's resumed continuation immediately before fetch.
      return finalRequestHash=>{
       if(this.storageBlocked||finalRequestHash!==expectedRequest.hash||messageRequest(message,lease.uuid).hash!==expectedRequest.hash)return false;
       this.confirm(ownsIntent);
       const finalNow=this.clock();
       if(!Number.isFinite(finalNow)||finalNow<sourceCheckedAt||finalNow-sourceCheckedAt>1000||day(finalNow+86400000)!==message.date||hour(finalNow)<this.sendHour)return false;
       gateOpened=true;return true;
      };
     });}
    }catch{result=senderInvoked?unverifiedInvocation('发送器调用结果无法核验，是否调用消息POST待核；已停止自动重发'):notPosted('发送前来源无法核验，本条未发送');}
    if(this.storageBlocked)break;
    const evidence=senderEvidence.get(result),attested=evidence?.requestHash===expectedRequest.hash&&evidence?.uuid===lease.uuid&&evidence?.beforePost===invocationGate&&evidence?.key===lease.key&&evidence?.recipientId===message.recipient.id&&evidence?.recipientType===message.recipient.type;
    const accepted=gateOpened&&attested&&result?.state==='sent'&&result.unknown===false&&result.postAttempted===true&&messageIdValid(result.messageId);
    const knownNotSent=(!senderInvoked||attested)&&result?.state==='attention'&&result.unknown===false&&result.postAttempted===false;
    const observedUnknown=gateOpened&&attested&&result?.state==='attention'&&result.unknown===true&&result.postAttempted===true;
    const outcome=accepted?result:knownNotSent?notPosted(result.reason||'已核实尚未调用消息POST，本条未发送'):observedUnknown?result:unverifiedInvocation('发送器结果无法确证，是否调用消息POST待核；已停止自动重发');
    const recorded=this.persist(s=>{
     receipts(s);
     const row=s.openingReceipts.find(r=>r.key===message.key);if(row?.lease!==lease.lease)return;
     row.state=outcome.state;row.reason=outcome.reason||'';row.unknown=outcome.unknown;row.postAttempted=outcome.postAttempted;
     if(accepted){row.messageId=outcome.messageId;row.sentAt=new Date(this.clock()).toISOString()}
     if(!outcome.unknown)delete row.lease;
     return true;
    });
    if(!recorded){this.storageBlocked=true;break;}
    this.confirm(rows=>rows.some(r=>r.key===lease.key&&r.state===outcome.state&&r.unknown===outcome.unknown&&r.postAttempted===outcome.postAttempted&&(!accepted||r.messageId===outcome.messageId)));
    sent++;
   }
  }catch{if(!this.storageBlocked){try{this.persist(s=>{s.openingStatus={date:day(this.clock()+86400000),checkedAt:new Date(this.clock()).toISOString(),state:'attention',issues:[{message:'次日班表或发送证据无法核验，本轮未继续发送'}]}})}catch{}}}
  finally{this.running=false}
 }
}
export function createOpeningSender(notifier){
 return async(message,uuid,stillValid,beforePost)=>{
  let request,url,requestHash,identity;
  const attest=result=>attestSenderResult(result,requestHash,uuid,beforePost,identity);
  try{
   identity={key:message.key,recipientId:message.recipient.id,recipientType:message.recipient.type};
   const prepared=messageRequest(message,uuid);url=prepared.url;requestHash=prepared.hash;
   if(!notifier.enabled||notifier.appId!=='cli_aa9c744d6ffa1cc4'||!['direct','group'].includes(message.kind)||message.kind==='group'&&(message.recipient.id!==groupId||message.recipient.type!=='chat_id')||message.kind==='direct'&&(message.recipient.type!=='open_id'||!message.recipient.id.startsWith('ou_')))return attest(notPosted('通知应用或群收件人未核验，本条未发送'));
   const token=await notifier.tenantToken();
   if(typeof token!=='string'||!token.trim()||typeof stillValid!=='function'||typeof beforePost!=='function')return attest(notPosted('发送前凭据或持久意图门禁无法核验，本条未发送'));
   request={method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:prepared.body};
   if(!await stillValid())return attest(notPosted('发送前班表或身份无法核验，本条未发送'));
   const finalCheck=await beforePost(requestHash);
   if(typeof finalCheck!=='function'||finalCheck(requestHash)!==true||request.signal.aborted)return attest(notPosted('发送前持久意图或最终同步检查无法核验，本条未发送'));
  }catch{return attest(notPosted('已核实尚未调用消息POST，发送前检查失败'));}
  try{
   // Intent was durably committed and read back before entering fetch.
   const response=await notifier.fetch(url,request);
   const data=await response.json();
   if(response.ok===true&&data?.code===0&&messageIdValid(data.data?.message_id))return attest({state:'sent',messageId:data.data.message_id,unknown:false,postAttempted:true});
   return attest(unknownPost('消息POST已调用，但发送结果无法确证；已停止自动重发'));
  }catch{return attest(unknownPost('消息POST已调用，结果待核验；已停止自动重发'));}
 };
}
