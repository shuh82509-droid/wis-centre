import {fingerprint} from './task-workflow.mjs';
import {requireFact} from './workflow-store.mjs';

// A durable, bounded callback inbox keeps the transport response under 3 s.
// Only the authenticated SDK adapter may call accept(). All business work and
// authoritative schedule reads happen after acceptance, never inside a DB lock.
export class LiveFeishuInbox {
  constructor({actions,updateCard,clock=Date.now}){Object.assign(this,{actions,updateCard,clock});this.running=false;}
  accept(event){
    requireFact(event?.verified===true&&event.appId===this.actions.appId&&['live_ack','live_issue','live_complete'].includes(event.action),'无效的飞书卡片回调',403);
    requireFact(typeof event.eventId==='string'&&event.eventId.length>=8&&event.eventId.length<=200,'缺少飞书事件编号',403);
    requireFact(JSON.stringify(event.form||{}).length<=12000,'表单过长');
    const s=this.actions.runtime.store.read(),notice=s.flowNotifications?.find(n=>n.messageId===event.messageId&&n.channel==='live_feishu_card'&&n.state==='sent');
    requireFact(notice,'找不到已确认的卡片发送记录',403);
    const task=s.tasks.find(t=>t.id===notice.taskId);
    const actor=this.actions.participants.actor({appId:event.appId,openId:event.openId,task,nodeId:notice.nodeId});
    requireFact(actor.user.number===notice.recipient,'只能处理发给本人的工作',403);
    const clean={verified:true,appId:event.appId,eventId:event.eventId,messageId:event.messageId,openId:event.openId,action:event.action,form:{}};
    for(const key of ['note','actualStart','actualEnd','platformSessionId','evidenceUrl']){
      if(event.form?.[key]!==undefined){requireFact(typeof event.form[key]==='string'&&event.form[key].length<=1000,'卡片字段格式无效');clean.form[key]=event.form[key];}
    }
    const id=fingerprint([clean.appId,clean.eventId]),hash=fingerprint(clean);
    return this.actions.runtime.store.transaction(store=>{
      store.liveFeishuInbox??={};const old=store.liveFeishuInbox[id];
      if(old){requireFact(old.hash===hash,'事件编号重复但内容不同',409);return {status:old.state};}
      requireFact(Object.values(store.liveFeishuInbox).filter(x=>!['done','attention'].includes(x.state)).length<1000,'通知办理队列繁忙，请稍后重试',503);
      store.liveFeishuInbox[id]={id,hash,event:clean,state:'ready',attempts:0,nextAt:this.clock(),createdAt:new Date(this.clock()).toISOString()};
      return {status:'queued'};
    });
  }
  async flush(){
    if(this.running)return;this.running=true;
    const store=this.actions.runtime.store;
    try{for(let i=0;i<5;i++){
      const row=store.transaction(s=>{
        const job=Object.values(s.liveFeishuInbox||{}).find(x=>(x.state==='ready'&&x.nextAt<=this.clock())||(x.state==='working'&&x.leaseUntil<=this.clock()));
        if(!job)return null;job.state='working';job.attempts++;job.leaseUntil=this.clock()+120000;return structuredClone(job);
      });
      if(!row)break;
      let outcome=row.result;
      try{
        if(!outcome)outcome=await this.actions.handle(row.event);
        // Keep successful business result before attempting the card update.
        store.transaction(s=>{s.liveFeishuInbox[row.id].result=outcome;});
        await this.updateCard(row.event.messageId,outcome.card);
        store.transaction(s=>{const j=s.liveFeishuInbox[row.id];j.state='done';j.completedAt=new Date(this.clock()).toISOString();delete j.leaseUntil;});
      }catch(error){
        store.transaction(s=>{
          const j=s.liveFeishuInbox[row.id];j.state=(outcome||error.status>=500)&&j.attempts<5?'ready':'attention';
          j.error=outcome?'工作已保存，飞书卡片更新待重试':String(error.message||'办理暂不可用').slice(0,500);
          j.nextAt=this.clock()+Math.min(120000,5000*2**j.attempts);delete j.leaseUntil;
          if(j.state==='attention'){
            const n=s.flowNotifications.find(n=>n.messageId===row.event.messageId),t=s.tasks.find(t=>t.id===n?.taskId);
            if(t){const ev=this.actions.runtime.log(s,t,null,'live_card_attention',undefined,j.error);this.actions.runtime.notify(s,t,null,'live_card_attention',t.runtime.manager.number,ev.id);}
          }
        });
      }
    }}finally{this.running=false;}
  }
}
