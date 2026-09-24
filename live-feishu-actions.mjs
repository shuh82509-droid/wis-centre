import {requireFact} from './workflow-store.mjs';
import {fingerprint,text} from './task-workflow.mjs';
import {liveFeishuCard} from './live-feishu-card.mjs';

const actions = new Set(['live_ack','live_issue','live_complete']);
const outcome = action => action==='live_complete'?{status:'completed',message:'本人执行节点已完成；流程将按前置条件推进，不代表全场所有人都已完成。'}:action==='live_ack'?{status:'acknowledged',message:'已记录本人收到排班，尚未标记工作完成。'}:{status:'reported',message:'异常已记录并进入负责人通知队列，未自动完成工作。'};
const actualTime = value => {
  requireFact(typeof value === 'string' && /^20\d\d-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(value), '请填写北京时间，格式为 YYYY-MM-DD HH:mm');
  const normalized=value.replace(' ','T'), ms=Date.parse(normalized+'+08:00');
  requireFact(Number.isFinite(ms) && new Date(ms+8*3600000).toISOString().slice(0,normalized.length)===normalized, '实际时间无效');
  return new Date(ms).toISOString();
};
// handle() accepts ONLY an event verified by the Feishu transport. Do not mount
// this class directly as a JSON endpoint. Message receipt + actor + node round
// remain authoritative; action payload never selects a task or recipient.
export class LiveFeishuActions {
  constructor({runtime,participants,liveSessions,appId,clock=Date.now}) {Object.assign(this,{runtime,participants,liveSessions,appId,clock});}
  async handle(event) {
    requireFact(event.verified === true && event.appId === this.appId && typeof event.eventId === 'string' && event.eventId.length >= 8 && event.eventId.length <= 200, '飞书回调未经验证', 403);
    requireFact(actions.has(event.action), '不支持此卡片操作', 400);
    const r=this.runtime,s=r.store.read(), notice=s.flowNotifications?.find(n=>n.messageId===event.messageId && n.state==='sent' && n.channel==='live_feishu_card');
    requireFact(notice,'卡片没有已确认的发送回执',403);
    const task=s.tasks.find(t=>t.id===notice.taskId),node=task?.runtime?.nodes.find(n=>n.id===notice.nodeId);
    const actor=this.participants.actor({appId:event.appId,openId:event.openId,task,nodeId:notice.nodeId});
    requireFact(notice.recipient===actor.user.number && node?.attempt===notice.attempt,'卡片已换人或进入新轮次，请使用最新通知',409);
    const data={action:event.action,form:event.form||{},messageId:event.messageId,openId:event.openId},hash=fingerprint(data),key='feishu-'+fingerprint([event.appId,event.eventId]);
    const previous=s.liveFeishuReceipts?.[key];
    if(previous){requireFact(previous.hash===hash,'同一回执内容发生变化',409);return previous.result;}
    // Business commit and optional card-cache write are separate. Recover a
    // committed operation after a crash without repeating its transition.
    const committed=node.liveFeishuReceipt?.key===key&&node.liveFeishuReceipt.attempt===notice.attempt?node.liveFeishuReceipt:node.liveAcknowledgements?.find(x=>x.key===key);
    if(committed){requireFact(committed.hash===hash,'同一回执内容发生变化',409);const result=outcome(event.action);return {...result,card:liveFeishuCard(notice,task,{receipt:result.message})};}
    requireFact(task.runtime.state==='running'&&!task.runtime.liveSession.sourceIssue&&['pending','ready'].includes(node.state),'节点已结束、暂停或来源待核验',409);
    await this.liveSessions.verifyCurrent(actor,null,task.id);
    // Revalidate after the asynchronous authoritative roster read.
    const current=r.store.read().tasks.find(t=>t.id===task.id);
    requireFact(current?.version===task.version,'任务刚刚变化，请重新办理',409);
    this.participants.actor({appId:event.appId,openId:event.openId,task:current,nodeId:notice.nodeId});
    const note=text(event.form?.note,1000);requireFact(note.length>=2,'请填写确认说明或交付结论');
    let result;
    if(event.action==='live_complete') {
      requireFact(node.state==='ready','前置工作尚未完成',409);
      const liveFacts={confirmed:true,actualStart:actualTime(event.form.actualStart),actualEnd:actualTime(event.form.actualEnd),platformSessionId:text(event.form.platformSessionId,100)};
      const url=String(event.form.evidenceUrl||'');requireFact(/^https:\/\//.test(url),'请提供真实场次记录的 HTTPS 链接');
      const body={expectedVersion:task.version,nodeId:node.id,note,evidence:[{url,summary:note}],liveFacts};
      r.command(actor,task.id,'complete',body,key,{liveReceipt:{key,hash}});
      result=outcome(event.action);
    } else {
      r.store.transaction(store=>{
        const t=store.tasks.find(x=>x.id===task.id),n=t.runtime.nodes.find(x=>x.id===node.id);
        requireFact(t.version===task.version&&n.attempt===notice.attempt,'任务刚刚变化，请重新办理',409);
        n.liveAcknowledgements??=[];
        if(!n.liveAcknowledgements.some(x=>x.key===key)){
          n.liveAcknowledgements.push({key,hash,kind:event.action,attempt:n.attempt,at:r.iso(),by:actor.user.number,note});
          const log=r.log(store,t,n,event.action,actor.user,note);
          if(event.action==='live_issue')r.notify(store,t,n,'live_participant_issue',t.runtime.manager.number,log.id);
          t.version++;
        }
      });
      result=outcome(event.action);
    }
    const latest=r.store.read().tasks.find(t=>t.id===task.id);
    result.card=liveFeishuCard(notice,latest,{receipt:result.message});
    r.store.transaction(store=>{store.liveFeishuReceipts??={};store.liveFeishuReceipts[key]={hash,result,at:r.iso(),taskId:task.id,nodeId:node.id,actor:actor.user.number};});
    return result;
  }
}
