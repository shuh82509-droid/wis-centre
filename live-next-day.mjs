import {randomUUID,createHash} from 'node:crypto';
import {scheduleSessions} from './live-session-flow.mjs';
import {withinNextDaySendWindow} from './flow-notice-validity.mjs';
import {currentNextDayRelease,nextDayReleaseManifest} from './live-next-day-release.mjs';

export const LIVE_WAR_ROOM_RECIPIENT='__wis_live_war_room__';
const localDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const localHour=ms=>new Date(ms+8*3600000).getUTCHours();
const weekday=date=>'日一二三四五六'[new Date(date+'T12:00:00+08:00').getUTCDay()];
const time=value=>new Date(value).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const shiftRange=(startAt,endAt,date)=>`${time(startAt)}-${localDate(Date.parse(endAt))===date?'':'次日'}${time(endAt)}`;
const shift=slot=>shiftRange(slot.startAt,slot.endAt,slot.date);
const assistantPeriods=(slot,number)=>{
  const rows=(slot.assistantShifts||[]).filter(item=>item.number===number);
  if(!rows.length)throw new Error('助理本人正式班次待核验，不能生成次日通知');
  return rows.map(item=>({own:shiftRange(item.startAt,item.endAt,slot.date),overlap:shiftRange(item.overlapStartAt,item.overlapEndAt,slot.date)}));
};
const assistantShiftFingerprint=slot=>createHash('sha256').update(JSON.stringify(slot.assistantShifts||[])).digest('hex').slice(0,32);
const title=(room,date,suffix)=>`【${room}直播间${suffix} - ${Number(date.slice(5,7))}月${Number(date.slice(8))}日（星期${weekday(date)}）】`;
const executionNode=(task,number)=>task.runtime.nodes.find(n=>/^W04\.S4\.(E1|A\d+)$/.test(n.id)&&n.owner.number===number);
const acknowledged=node=>node?.liveAcknowledgements?.some(x=>x.kind==='live_ack'&&x.at&&x.attempt===node.attempt&&x.by===node.owner.number);
const reminderFor=(s,task,node,recipient,date,signature,shiftFingerprint)=>s.flowNotifications?.find(n=>
  n.kind==='live_tomorrow'&&n.taskId===task.id&&n.nodeId===node.id&&n.attempt===node.attempt&&
  n.recipient===recipient&&n.businessDate===date&&n.signature===signature&&n.shiftFingerprint===shiftFingerprint);
const assignedCard=(s,task,node,recipient)=>s.flowNotifications?.some(n=>
  n.kind==='live_assignment'&&n.taskId===task.id&&n.nodeId===node.id&&n.attempt===node.attempt&&
  n.recipient===recipient&&n.state==='sent'&&Boolean(n.messageId));
const groupKey=(kind,date,room,refs)=>[kind,date,room,refs.map(x=>`${x.taskId}/${x.nodeId}/${x.attempt}/${x.recipient}/${x.signature}/${x.shiftFingerprint}`).join('|')].join(':');
const nextDayKinds=new Set(['live_tomorrow','live_tomorrow_group_pending','live_tomorrow_group_confirmed']);
export const isNextDayNotice=notice=>nextDayKinds.has(notice?.kind);
// Source-change and exception notices must still reach the manager when the
// sheet is unavailable. Every other formal live-task notice, including a
// newly assigned node card, is bound to the current official shift.
const sourceExceptionKinds=new Set(['live_source_changed','live_participant_issue','live_card_attention','assignment_attention','source_attention','routing_attention','handoff_blocked','pause','resume','cancel']);
export const needsOfficialLiveSource=(notice,task)=>nextDayKinds.has(notice?.kind)||Boolean(task?.runtime?.liveSession&&!sourceExceptionKinds.has(notice?.kind));

export function nextDayDirectMessage(slot,number,role,name){
  const assignment=role==='anchor'
    ?`明天你被安排为${slot.roomName}直播间 ${shift(slot)} 时段开播主播${slot.cohostDisplay?`（共播：${slot.cohostDisplay}）`:''}`
    :`明天你被安排为${slot.roomName}直播间 ${shift(slot)} 主播班次的直播助理；你本人班表时段：${assistantPeriods(slot,number).map(row=>row.own).join('、')}，本场协助时段：${assistantPeriods(slot,number).map(row=>row.overlap).join('、')}`;
  return `${title(slot.roomName,slot.date,'开播提醒')}\n${name}你好！${assignment}，请提前做好开播准备～\n⏰请确认是否能准时开播，如有问题请及时沟通🙏\n请在本人收到的正式派工卡中点击“确认收到排班”；该回执不会把工作标记为完成。`;
}
const related=(s,slots)=>slots.flatMap(slot=>{
  const task=s.tasks.find(t=>t.runtime?.liveSession?.key===slot.key&&t.runtime.liveSession.signature===slot.signature&&t.runtime.state==='running'&&!t.runtime.liveSession.sourceIssue);
  if(!task)return [];
  return [slot.anchor,...slot.assistants].map(recipient=>{
    const node=executionNode(task,recipient);
    return node&&{taskId:task.id,nodeId:node.id,attempt:node.attempt,recipient,signature:slot.signature,shiftFingerprint:assistantShiftFingerprint(slot)};
  }).filter(Boolean);
});
export function currentNextDayGroup(notice,s,now){
  if(!['live_tomorrow_group_pending','live_tomorrow_group_confirmed'].includes(notice.kind))return true;
  if(localDate(now+86400000)!==notice.businessDate||!withinNextDaySendWindow(now)||!notice.related?.length)return false;
  const delivered=notice.related.every(ref=>{
    const task=s.tasks.find(t=>t.id===ref.taskId),node=task?.runtime.nodes.find(n=>n.id===ref.nodeId);
    const dm=node&&reminderFor(s,task,node,ref.recipient,notice.businessDate,ref.signature,ref.shiftFingerprint);
    return task?.runtime.state==='running'&&!task.runtime.liveSession.sourceIssue&&task.runtime.liveSession.signature===ref.signature&&['pending','ready'].includes(node?.state)&&node.attempt===ref.attempt&&node.owner.number===ref.recipient&&assignedCard(s,task,node,ref.recipient)&&dm?.state==='sent'&&Boolean(dm.messageId);
  });
  if(!delivered)return false;
  const allConfirmed=notice.related.every(ref=>{
    const task=s.tasks.find(t=>t.id===ref.taskId),node=task?.runtime.nodes.find(n=>n.id===ref.nodeId);
    return acknowledged(node);
  });
  return notice.kind==='live_tomorrow_group_confirmed'?allConfirmed:!allConfirmed;
}

// Re-read the actual official workbook immediately before a Feishu POST. The
// persisted task can lag a sheet edit until the next auto-dispatch tick, so a
// task/signature check alone does not prove the recipient is still scheduled.
// This protects both next-day reminders and all source-bound live task cards.
export async function currentOfficialNextDaySource(notice,{runtime,liveSessions,notifier,readReleasePermit=()=>null,releaseId=null,bootId=null,clock=Date.now}={}){
  if(!runtime?.store)return false;
  const snapshot=runtime.store.read(),noticeTask=snapshot.tasks.find(t=>t.id===notice?.taskId);
  if(!needsOfficialLiveSource(notice,noticeTask))return true;
  const nextDay=nextDayKinds.has(notice.kind),businessDate=nextDay?notice.businessDate:noticeTask?.runtime?.liveSession?.date;
  if(!liveSessions?.readSchedule||!/^20\d{2}-\d{2}-\d{2}$/u.test(businessDate||''))return false;
  const refs=notice.kind==='live_tomorrow'
    ?[{taskId:notice.taskId,signature:notice.signature,recipient:notice.recipient,shiftFingerprint:notice.shiftFingerprint}]
    :nextDay?notice.related:[{taskId:notice.taskId,signature:noticeTask?.runtime?.liveSession?.signature,recipient:notice.recipient}];
  if(!Array.isArray(refs)||!refs.length)return false;
  const raw=await liveSessions.readSchedule(null,businessDate,{fresh:true});
  const current=runtime.store.read(),rooms=new Map();
  for(const ref of refs){
    const task=current.tasks.find(t=>t.id===ref.taskId),session=task?.runtime?.liveSession;
    if(!session||session.date!==businessDate||session.signature!==ref.signature||!session.roomCode)return false;
    if(!rooms.has(session.roomCode)){
      const room=raw.rooms?.find(r=>r.code===session.roomCode);
      if(!room)return false;
      try{rooms.set(session.roomCode,scheduleSessions({...raw,rooms:[room]},businessDate,runtime.people(),clock(),runtime.liveParticipants));}
      catch{return false;}
    }
    const slot=rooms.get(session.roomCode).find(s=>s.key===session.key);
    if(!slot||slot.signature!==ref.signature||nextDay&&(ref.shiftFingerprint!==assistantShiftFingerprint(slot)||![slot.anchor,...slot.assistants].includes(ref.recipient)))return false;
  }
  if(nextDay){
    try{
      const manifest=nextDayReleaseManifest({raw,snapshot:current,people:runtime.people(),participants:runtime.liveParticipants,
        recipient:number=>notifier?.recipient(number),date:businessDate,now:clock(),releaseId,bootId});
      return currentNextDayRelease(readReleasePermit(),{manifest,notice,now:clock(),releaseId,bootId});
    }catch{return false;}
  }
  return true;
}

// The official sheet is read afresh. A task is required before a person may
// receive a reminder; a missing or changed task is never silently recreated.
export class LiveNextDayReminder {
  constructor({runtime,liveSessions,notifier,readReleasePermit=()=>null,releaseId=null,bootId=null,clock=Date.now,enabled=false,sendHour=16}){
    Object.assign(this,{runtime,liveSessions,notifier,readReleasePermit,releaseId,bootId,clock,enabled,sendHour});this.running=false;this.nextAt=0;
  }
  async tick(){
    const now=this.clock();
    if(!this.enabled||this.running||now<this.nextAt||localHour(now)<this.sendHour||!withinNextDaySendWindow(now))return;
    this.running=true;this.nextAt=now+300000;
    const date=localDate(now+86400000),issues=[];
    try{
      if(!this.liveSessions.enabled||!this.notifier.enabled||!this.runtime.liveParticipants?.people().length)return;
      const raw=await this.liveSessions.readSchedule(null,date,{fresh:true}),people=this.runtime.people(),rooms=[];
      const blockedRoom=room=>raw.issues?.some(issue=>!issue.roomCode||issue.roomCode===room.code);
      for(const room of raw.rooms||[]){
        if(blockedRoom(room))continue;
        try{rooms.push({room,slots:scheduleSessions({...raw,rooms:[room]},date,people,now,this.runtime.liveParticipants)});}
        catch(error){issues.push({room:room.code,message:error.message});}
      }
      for(const issue of raw.issues||[])issues.push({room:issue.roomCode,message:issue.message});
      const snapshot=this.runtime.store.read(),verifiedRooms=[];
      const release=()=>{
        const permit=this.readReleasePermit();
        const manifest=nextDayReleaseManifest({raw,snapshot:this.runtime.store.read(),people:this.runtime.people(),
          participants:this.runtime.liveParticipants,recipient:number=>this.notifier.recipient(number),date,now:this.clock(),
          releaseId:this.releaseId,bootId:this.bootId});
        return currentNextDayRelease(permit,{manifest,now:this.clock(),releaseId:this.releaseId,bootId:this.bootId})?permit:null;
      };
      for(const entry of rooms){
        const {room,slots}=entry;let eligible=true;
        for(const slot of slots){
          const task=snapshot.tasks.find(t=>t.runtime?.liveSession?.key===slot.key&&t.runtime.liveSession.signature===slot.signature&&t.runtime.state==='running'&&!t.runtime.liveSession.sourceIssue);
          if(!task){issues.push({room:room.code,message:`${shift(slot)} 正式场次尚未派工，无法发送次日提醒`});eligible=false;continue;}
          for(const recipient of [slot.anchor,...slot.assistants]){
            const node=executionNode(task,recipient),person=people.find(p=>p.number===recipient);
            const card=node&&assignedCard(snapshot,task,node,recipient);
            if(!node||!['pending','ready'].includes(node.state)||!person||!this.notifier.recipient(recipient)||!this.runtime.liveParticipants?.canOwn(recipient,node.id)||!card){
              issues.push({room:room.code,message:`${shift(slot)} 的主播或助理本人派工卡、人员或飞书收件人待核验`});eligible=false;
            }
          }
        }
        if(eligible)verifiedRooms.push(entry);
      }
      const permit=release();
      if(!permit){issues.push({message:'次日正式通知尚无本日期、班表、任务及收件人一致的有效发布许可'});return;}
      // Fresh source/identity checks may have crossed the end of the hour.
      // Do not persist late notices that the sender must subsequently retire.
      if(!withinNextDaySendWindow(this.clock())){
        issues.push({message:'次日提醒发送窗口已过，本次不补发'});
        return;
      }
      if(!release()){issues.push({message:'次日通知放行许可或正式来源在入队前失效'});return;}
      // One missing person's card blocks the whole room; a partial DM must
      // never imply that everyone can acknowledge the formal schedule.
      const needsWork=verifiedRooms.some(({slots})=>slots.some(slot=>{
        const task=snapshot.tasks.find(t=>t.runtime?.liveSession?.key===slot.key&&t.runtime.liveSession.signature===slot.signature&&t.runtime.state==='running'&&!t.runtime.liveSession.sourceIssue);
        return task&&[slot.anchor,...slot.assistants].some(recipient=>{
          const node=executionNode(task,recipient);
          return node&&!reminderFor(snapshot,task,node,recipient,date,slot.signature,assistantShiftFingerprint(slot));
        });
      }));
      if(needsWork)this.runtime.store.transaction(s=>{
        this.runtime.ensure(s);
        const currentManifest=nextDayReleaseManifest({raw,snapshot:s,people:this.runtime.people(),
          participants:this.runtime.liveParticipants,recipient:number=>this.notifier.recipient(number),date,now:this.clock(),
          releaseId:this.releaseId,bootId:this.bootId});
        if(!currentNextDayRelease(this.readReleasePermit(),{manifest:currentManifest,now:this.clock(),
          releaseId:this.releaseId,bootId:this.bootId}))return;
        for(const {slots} of verifiedRooms)for(const slot of slots){
          const task=s.tasks.find(t=>t.runtime?.liveSession?.key===slot.key&&t.runtime.liveSession.signature===slot.signature&&t.runtime.state==='running'&&!t.runtime.liveSession.sourceIssue);
          if(!task)continue;
          for(const recipient of [slot.anchor,...slot.assistants]){
            const node=executionNode(task,recipient),person=people.find(p=>p.number===recipient);
            if(!node||!person||!this.notifier.recipient(recipient)||!['pending','ready'].includes(node.state))continue;
            const shiftFingerprint=assistantShiftFingerprint(slot);
            if(reminderFor(s,task,node,recipient,date,slot.signature,shiftFingerprint))continue;
            this.runtime.notify(s,task,node,'live_tomorrow',recipient,`next-day:${date}:${shiftFingerprint}`);
            const notice=s.flowNotifications.at(-1);
            notice.businessDate=date;notice.signature=slot.signature;notice.shiftFingerprint=shiftFingerprint;notice.roomCode=slot.roomCode;
            notice.releaseScopeHash=permit.scopeHash;
            notice.delivery={channel:'live_tomorrow_text',msg_type:'text',content:JSON.stringify({text:nextDayDirectMessage(slot,recipient,recipient===slot.anchor?'anchor':'assistant',person.name)})};
          }
        }
      });
      const canGroup=this.notifier.recipient(LIVE_WAR_ROOM_RECIPIENT);
      const current=this.runtime.store.read();
      const groupDue=canGroup&&verifiedRooms.some(({room,slots})=>{
        if(blockedRoom(room))return false;
        const refs=related(current,slots);
        if(!refs.length||refs.length!==slots.reduce((n,slot)=>n+1+slot.assistants.length,0))return false;
        return ['live_tomorrow_group_pending','live_tomorrow_group_confirmed'].some(kind=>{
          const key=groupKey(kind,date,room.code,refs);
          return !current.flowNotifications?.some(n=>n.key===key)&&currentNextDayGroup({kind,businessDate:date,related:refs},current,now);
        });
      });
      if(groupDue)this.runtime.store.transaction(s=>{
        this.runtime.ensure(s);
        const currentManifest=nextDayReleaseManifest({raw,snapshot:s,people:this.runtime.people(),
          participants:this.runtime.liveParticipants,recipient:number=>this.notifier.recipient(number),date,now:this.clock(),
          releaseId:this.releaseId,bootId:this.bootId});
        if(!currentNextDayRelease(this.readReleasePermit(),{manifest:currentManifest,now:this.clock(),
          releaseId:this.releaseId,bootId:this.bootId}))return;
        for(const {room,slots} of verifiedRooms){
          if(blockedRoom(room))continue;
          const refs=related(s,slots);
          if(!refs.length||refs.length!==slots.reduce((n,slot)=>n+1+slot.assistants.length,0))continue;
          const first=s.tasks.find(t=>t.id===refs[0].taskId);
          const lines=slots.map(slot=>`${shift(slot)} 主播班次，主播 ${people.find(p=>p.number===slot.anchor)?.name||'待核验'}${slot.cohostDisplay?`（共播：${slot.cohostDisplay}）`:''}，助理 ${slot.assistants.map(n=>`${people.find(p=>p.number===n)?.name||'待核验'}（本场协助 ${assistantPeriods(slot,n).map(row=>row.overlap).join('、')}）`).join('、')}`);
          const alreadyConfirmed=currentNextDayGroup({kind:'live_tomorrow_group_confirmed',businessDate:date,related:refs},s,now);
          for(const [kind,confirmed] of [['live_tomorrow_group_pending',false],['live_tomorrow_group_confirmed',true]]){
            if(alreadyConfirmed&&!confirmed)continue;
            const key=groupKey(kind,date,room.code,refs);
            if(s.flowNotifications.some(n=>n.key===key))continue;
            const draft={kind,businessDate:date,related:refs};
            if(!currentNextDayGroup(draft,s,now))continue;
            s.flowNotifications.push({id:`notice_${randomUUID()}`,key,taskId:first.id,nodeId:null,attempt:0,kind,recipient:LIVE_WAR_ROOM_RECIPIENT,state:'ready',attempts:0,nextAt:now,createdAt:new Date(now).toISOString(),messageId:null,businessDate:date,roomCode:room.code,releaseScopeHash:permit.scopeHash,related:refs,delivery:{channel:'live_tomorrow_group',msg_type:'text',content:JSON.stringify({text:`${title(room.name,date,confirmed?'以下已核验班次人员已确认':'以下已核验班次人员已通知（待确认）')}\n本消息仅汇总以下已核验班次；正式班表后续新增或调整的其他班次，以后续通知为准。\n${lines.join('\n')}\n${confirmed?'以下列出的班次，主播及助理均已在本人派工卡确认收到，请准时开播！':'以下列出的班次，次日提醒已送达，等待主播及助理本人确认；请以卡片回执为准。'}`})}});
          }
        }
      });
    }catch(error){
      issues.push({message:String(error?.message||'次日班表读取待核验').slice(0,240)});
    }finally{
      try{
        const status=this.runtime.store.read().liveNextDayStatus;
        if(!status||status.date!==date||status.state!==(issues.length?'attention':'ready')||JSON.stringify(status.issues)!==JSON.stringify(issues)||now-Date.parse(status.checkedAt)>1800000)
          this.runtime.store.transaction(s=>{s.liveNextDayStatus={checkedAt:new Date(now).toISOString(),date,state:issues.length?'attention':'ready',issues};});
      }finally{this.running=false;}
    }
  }
}
