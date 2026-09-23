import {requireFact} from './workflow-store.mjs';
import {scheduleSessions} from './live-session-flow.mjs';

const day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
// A scoped server job, never a fabricated browser session. Its commissioning
// director is revalidated against the current OA roster on every iteration.
export class LiveAutoDispatch {
  constructor(live,{enabled=false,actorNumber='FD-026222',clock=Date.now,maxNewPerTick=4}={}){
    this.live=live;this.enabled=enabled;this.actorNumber=actorNumber;this.clock=clock;this.maxNewPerTick=maxNewPerTick;this.running=false;this.nextAt=0;
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
      for(const date of [day(this.clock()),day(this.clock()+86400000)]){
        let raw;
        try{raw=await this.live.readSchedule(null,date);}catch(e){issues.push({date,message:e.message});continue;}
        issues.push(...(raw.issues||[]).map(i=>({...i,date})));
        for(const room of raw.rooms||[]){
          let slots;
          try{slots=scheduleSessions({...raw,rooms:[room]},date,r.people(),this.clock(),r.liveParticipants);}catch(e){issues.push({date,roomCode:room.code,roomName:room.name,message:e.message});continue;}
          // Reconcile existing work without changing any completion, owner or
          // evidence. A changed schedule requires explicit manager resolution.
          r.store.transaction(s=>{
            for(const t of s.tasks.filter(t=>t.runtime?.liveSession?.date===date&&t.runtime.liveSession.roomCode===room.code&&['running','paused'].includes(t.runtime.state))){
              const current=slots.find(x=>x.key===t.runtime.liveSession.key),changed=current?.signature!==t.runtime.liveSession.signature;
              if(changed&&!t.runtime.liveSession.sourceIssue){
                t.runtime.liveSession.sourceIssue='正式班表时间或人员已变化，请核对原任务';t.version++;
                const event=r.log(s,t,null,'live_source_changed',undefined,t.runtime.liveSession.sourceIssue);
                r.notify(s,t,null,'live_source_changed',t.runtime.manager.number,event.id);
              }
            }
          });
          const unresolved=r.store.read().tasks.filter(t=>t.runtime?.liveSession?.date===date&&t.runtime.liveSession.roomCode===room.code&&t.runtime.liveSession.sourceIssue&&!t.runtime.liveSession.replacedBy&&['running','paused','cancelled'].includes(t.runtime.state));
          if(unresolved.length){issues.push({date,roomCode:room.code,roomName:room.name,message:'原班表任务待主管核验；已终止的变更任务须明确选择替代后再派工',taskIds:unresolved.map(t=>t.id)});continue;}
          for(const slot of slots){
            const starts=Date.parse(slot.startAt);
            if(starts<=this.clock()||starts>this.clock()+86400000||created.length>=this.maxNewPerTick)continue;
            const existing=r.store.read().tasks.find(t=>t.runtime?.liveSession?.key===slot.key);
            if(existing)continue;
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
