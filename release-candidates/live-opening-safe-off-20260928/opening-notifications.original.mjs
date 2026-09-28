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
export class OpeningNotifications{
 constructor({store,readSchedule,participants,send,clock=Date.now,enabled=false,sendHour=16,maxPerTick=3,enabledRooms=['brand_selection','youxuan','wangou']}){
  Object.assign(this,{store,readSchedule,participants,send,clock,enabled,sendHour,maxPerTick,enabledRooms});this.running=false;this.nextAt=0;
 }
 async plan(){
  const now=this.clock(),date=day(now+86400000),raw=await this.readSchedule(null,date,{fresh:true});
  const disabledRooms=(raw.rooms||[]).filter(r=>!this.enabledRooms.includes(r.code)).map(r=>({roomCode:r.code,room:r.name,reason:'暂未启用'}));
  return {...buildOpeningPlan({...raw,rooms:(raw.rooms||[]).filter(r=>this.enabledRooms.includes(r.code))},date,this.participants(),this.clock()),disabledRooms};
 }
 async tick(){
  if(!this.enabled||this.running||this.clock()<this.nextAt)return;
  this.running=true;this.nextAt=this.clock()+60000;
  try{
   const plan=await this.plan(),now=this.clock(),due=hour(now)>=this.sendHour;
   this.store.transaction(s=>{s.openingStatus={checkedAt:new Date(now).toISOString(),date:plan.date,state:due?'active':'waiting',sendHour:this.sendHour,rooms:plan.rooms,issues:plan.issues,disabledRooms:plan.disabledRooms};s.openingReceipts||=[]});
   if(!due)return;
   let sent=0;
   for(const message of plan.messages){
    if(sent>=this.maxPerTick)break;
    const lease=this.store.transaction(s=>{
     s.openingReceipts||=[];
     if(message.kind==='group'&&!message.requires.every(key=>s.openingReceipts.some(r=>r.key===key&&r.state==='sent'&&r.messageId)))return null;
     let row=s.openingReceipts.find(r=>r.key===message.key);
     if(row?.state==='sent'||row?.state==='attention'||row?.leaseUntil>this.clock())return null;
     if(row?.firstAttemptAt&&this.clock()-Date.parse(row.firstAttemptAt)>=3600000){row.state='attention';row.reason='超过平台幂等窗口，停止自动重发';return null}
     row||={key:message.key,date:message.date,room:message.room,kind:message.kind,recipientId:message.recipient.id,recipientName:message.recipient.name,firstAttemptAt:new Date(this.clock()).toISOString(),uuid:message.key.slice(0,32),attempts:0};
     if(!s.openingReceipts.includes(row))s.openingReceipts.push(row);
     row.state='sending';row.lease=randomUUID();row.leaseUntil=this.clock()+120000;row.attempts++;
     return {...row};
    });
    if(!lease)continue;
    let result;
    try{
     // Never send yesterday's queue or a now-stale personnel assignment.
     const fresh=await this.plan();
     if(fresh.date!==message.date||!fresh.messages.some(x=>x.key===message.key))result={state:'attention',reason:'发送前班表已变化或身份无法核验，本条未发送'};
     else result=await this.send(message,lease.uuid,async()=>{
      const latest=await this.plan(),row=this.store.read().openingReceipts.find(x=>x.key===message.key);
      return row?.state==='sending'&&row.lease===lease.lease&&latest.date===message.date&&latest.messages.some(x=>x.key===message.key);
     });
    }catch{result={state:'uncertain',reason:'发送结果待核验，使用同一消息编号重试'};}
    this.store.transaction(s=>{
     const row=s.openingReceipts.find(r=>r.key===message.key);if(row?.lease!==lease.lease)return;
     row.state=result.state;row.reason=result.reason||'';
     if(result.state==='sent'){row.messageId=result.messageId;row.sentAt=new Date(this.clock()).toISOString()}
     delete row.lease;delete row.leaseUntil;
    });sent++;
   }
  }catch(error){this.store.transaction(s=>{s.openingStatus={date:day(this.clock()+86400000),checkedAt:new Date(this.clock()).toISOString(),state:'attention',issues:[{message:'次日班表或收件人读取失败，本轮未继续发送'}]}})}
  finally{this.running=false}
 }
}
export function createOpeningSender(notifier){
 return async(message,uuid,stillValid)=>{
  if(!notifier.enabled||notifier.appId!=='cli_aa9c744d6ffa1cc4'||!['direct','group'].includes(message.kind)||message.kind==='group'&&(message.recipient.id!==groupId||message.recipient.type!=='chat_id')||message.kind==='direct'&&(message.recipient.type!=='open_id'||!message.recipient.id.startsWith('ou_')))return {state:'attention',reason:'通知应用或群收件人未核验'};
  const token=await notifier.tenantToken();
  if(!stillValid||!await stillValid())return {state:'attention',reason:'发送前班表或身份已变化，本条未发送'};
  const response=await notifier.fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type='+message.recipient.type,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({receive_id:message.recipient.id,msg_type:'text',uuid,content:JSON.stringify({text:message.text})})});
  const data=await response.json();
  if(response.ok&&data.code===0&&data.data?.message_id)return {state:'sent',messageId:data.data.message_id};
  if(response.status===429||response.status>=500)return {state:'uncertain',reason:'飞书暂时繁忙，使用同一消息编号重试'};
  return {state:'attention',reason:'飞书拒绝发送，错误码 '+String(data.code??response.status)};
 };
}
