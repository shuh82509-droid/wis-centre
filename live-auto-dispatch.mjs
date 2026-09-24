import {requireFact} from './workflow-store.mjs';
import {scheduleSessions} from './live-session-flow.mjs';

const day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
// A scoped server job, never a fabricated browser session. Its commissioning
// director is revalidated against the current OA roster on every iteration.
export class LiveAutoDispatch {
  constructor(live,{enabled=false,actorNumber='FD-026222',clock=Date.now,maxNewPerTick=4}={}){
    this.live=live;this.enabled=enabled;this.actorNumber=actorNumber;this.clock=clock;this.maxNewPerTick=maxNewPerTick;this.running=false;this.nextAt=0;this.pendingChanges=new Map();
  }
  status(){return {enabled:this.enabled,...this.live.runtime.store.read().liveDispatchStatus};}
  async tick(){
    if(!this.enabled||!this.live.enabled||this.running||this.clock()<this.nextAt)return;
    this.running=true;this.nextAt=this.clock()+300000;
    const r=this.live.runtime,at=new Date(this.clock()).toISOString(),issues=[],created=[];
    try{
      const p=r.people().find(p=>p.number===this.actorNumber&&p.active&&p.role==='director'&&p.workflowEnabled!==false&&p.modules?.includes('live-room-management')&&p.modules?.includes('workflow-engine'));
      requireFact(p&&r.canNotify(p.number),'派工配置人的当前权限或飞书绑定不可核验，已暂停新增派工',409);
      const actor={user:p,enabled:true,canManage:true,department:true,modules:p.modules};
      const clearCandidates=(date,roomCode)=>{
        for(const [id,pending] of this.pendingChanges)if(pending.date===date&&(!roomCode||pending.roomCode===roomCode))this.pendingChanges.delete(id);
      };
      // A failed read, mixed workbook revision or partially parsed room is not
      // proof that every existing assignment changed. The sender and business
      // actions re-read the official sheet and fail closed while it is broken;
      // do not permanently poison tasks or broadcast a false change alert.
      const confirmChanges=(date,room,slots,readAt,{recoveryOnly=false,todayStart=0}={})=>{
        const currentTasks=r.store.read().tasks.filter(t=>t.runtime?.liveSession?.date===date&&t.runtime.liveSession.roomCode===room.code&&['running','paused'].includes(t.runtime.state)&&!t.runtime.liveSession.sourceIssue&&(!recoveryOnly||Date.parse(t.runtime.liveSession.startAt)>=todayStart&&Date.parse(t.runtime.liveSession.startAt)>this.clock()));
        const confirmed=[];let pending=false;
        for(const task of currentTasks){
          const old=task.runtime.liveSession,actual=slots.find(slot=>slot.key===old.key);
          if(actual?.signature===old.signature){this.pendingChanges.delete(task.id);continue;}
          const observed=actual?.signature||'missing',prior=this.pendingChanges.get(task.id),now=this.clock();
          if(prior?.date===date&&prior.roomCode===room.code&&prior.originalSignature===old.signature&&prior.observed===observed&&prior.readAt!==readAt&&now-prior.firstSeenAt>=300000){
            confirmed.push({id:task.id,originalSignature:old.signature,observed});this.pendingChanges.delete(task.id);
          }else{
            this.pendingChanges.set(task.id,{date,roomCode:room.code,originalSignature:old.signature,observed,readAt,firstSeenAt:prior?.observed===observed?prior.firstSeenAt:now});
            pending=true;
          }
        }
        if(confirmed.length)r.store.transaction(s=>{
          for(const item of confirmed){
            const task=s.tasks.find(t=>t.id===item.id),old=task?.runtime?.liveSession;
            if(!old||old.signature!==item.originalSignature||old.sourceIssue||!['running','paused'].includes(task.runtime.state))continue;
            const reason=item.observed==='missing'?'正式班表原班次已移除，请核对原任务':'正式班表原班次时间或人员已变化，请核对原任务';
            old.sourceIssue=reason;task.version++;
            const event=r.log(s,task,null,'live_source_changed',undefined,reason);
            r.notify(s,task,null,'live_source_changed',task.runtime.manager.number,event.id);
          }
        });
        return pending||confirmed.length>0;
      };
      // Queue the whole following business day early enough for the 16:00
      // reminder, while retaining the per-tick creation limit below. After
      // midnight, recover only yesterday's not-yet-started overnight tail;
      // never replay an already-started or finished prior-day shift.
      const today=day(this.clock()),todayStart=Date.parse(today+'T00:00:00+08:00');
      for(const {date,recoveryOnly} of [{date:day(this.clock()-86400000),recoveryOnly:true},{date:today,recoveryOnly:false},{date:day(this.clock()+86400000),recoveryOnly:false}]){
        let raw;
        try{raw=await this.live.readSchedule(null,date,{fresh:true});}catch(e){issues.push({date,message:e.message});clearCandidates(date);continue;}
        issues.push(...(raw.issues||[]).map(i=>({...i,date})));
        const available=new Set((raw.rooms||[]).map(room=>room.code));
        const invalid=new Set((raw.issues||[]).filter(issue=>issue.roomCode).map(issue=>issue.roomCode));
        const globalIssue=(raw.issues||[]).some(issue=>!issue.roomCode);
        if(globalIssue)clearCandidates(date);
        for(const roomCode of new Set(r.store.read().tasks.filter(t=>t.runtime?.liveSession?.date===date&&['running','paused'].includes(t.runtime.state)&&(!recoveryOnly||Date.parse(t.runtime.liveSession.startAt)>=todayStart&&Date.parse(t.runtime.liveSession.startAt)>this.clock())).map(t=>t.runtime.liveSession.roomCode))){
          if(!available.has(roomCode)&&!globalIssue&&!invalid.has(roomCode))issues.push({date,roomCode,message:'已派工直播间未出现在本次正式班表读取结果，待核验'});
          if(invalid.has(roomCode)||!available.has(roomCode))clearCandidates(date,roomCode);
        }
        for(const room of raw.rooms||[]){
          if(globalIssue||invalid.has(room.code)){clearCandidates(date,room.code);continue;}
          let slots;
          try{slots=scheduleSessions({...raw,rooms:[room]},date,r.people(),this.clock(),r.liveParticipants);}catch(e){issues.push({date,roomCode:room.code,roomName:room.name,message:e.message});clearCandidates(date,room.code);continue;}
          const eligibleSlots=recoveryOnly?slots.filter(slot=>Date.parse(slot.startAt)>=todayStart&&Date.parse(slot.startAt)>this.clock()):slots;
          if(recoveryOnly&&!eligibleSlots.length)continue;
          // Reconcile existing work without changing any completion, owner or
          // evidence. A complete room must show the same real per-session
          // change on two separate fresh polls before manager reconciliation.
          if(confirmChanges(date,room,slots,raw.updatedAt,{recoveryOnly,todayStart})){
            issues.push({date,roomCode:room.code,roomName:room.name,message:'原班次变更待主管核验；稳定来源确认前不创建可能重复的替代场次'});
            continue;
          }
          const unresolved=r.store.read().tasks.filter(t=>t.runtime?.liveSession?.date===date&&t.runtime.liveSession.roomCode===room.code&&t.runtime.liveSession.sourceIssue&&!t.runtime.liveSession.replacedBy&&['running','paused','cancelled'].includes(t.runtime.state)&&(!recoveryOnly||Date.parse(t.runtime.liveSession.startAt)>=todayStart&&Date.parse(t.runtime.liveSession.startAt)>this.clock()));
          if(unresolved.length){issues.push({date,roomCode:room.code,roomName:room.name,message:'原班表任务待主管核验；已终止的变更任务须明确选择替代后再派工',taskIds:unresolved.map(t=>t.id)});continue;}
          for(const slot of eligibleSlots){
            const starts=Date.parse(slot.startAt);
            // The official business date may include 00:00-05:30 on the next
            // civil day. scheduleSessions bounds it to that business date;
            // a civil-midnight horizon would permanently omit those shifts.
            if(starts<=this.clock())continue;
            const existing=r.store.read().tasks.find(t=>t.runtime?.liveSession?.key===slot.key);
            if(existing)continue;
            if(created.length>=this.maxNewPerTick){issues.push({date,roomCode:room.code,message:'正式班次仍在限速派工队列，未派发前不会通知个人或群聊'});continue;}
            // A rescheduled time must not create a second task over the prior
            // day's work. Keep it visible for a manager to reconcile first.
            try{
              const task=await this.live.create(actor,null,{date,sessionKey:slot.key,signature:slot.signature},'auto-'+slot.key.slice(5));
              created.push(task.id);
            }catch(e){issues.push({date,roomCode:room.code,message:e.message});break;}
          }
        }
      }
    }catch(e){issues.push({message:e.message});}
    finally{
      try{r.store.transaction(s=>{s.liveDispatchStatus={checkedAt:at,state:issues.length?'attention':'ready',createdTaskIds:created,issues};});}
      finally{this.running=false;}
    }
  }
}
