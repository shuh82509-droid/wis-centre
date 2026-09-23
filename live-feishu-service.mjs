import {readFileSync} from 'node:fs';
import {requireFact} from './workflow-store.mjs';
import {LiveFeishuParticipants} from './live-feishu-participants.mjs';
import {createLiveDirectoryReader} from './live-feishu-directory.mjs';
import {LiveFeishuActions} from './live-feishu-actions.mjs';
import {LiveFeishuInbox} from './live-feishu-inbox.mjs';
import {LiveFeishuTransport} from './live-feishu-transport.mjs';
import {liveFeishuCard} from './live-feishu-card.mjs';

// Disabled unless explicitly commissioned. No fallback to personal CLI tokens.
export class LiveFeishuService {
  constructor({runtime,notifier,liveSessions,env=process.env,clock=Date.now}) {
    Object.assign(this,{runtime,notifier,clock});this.enabled=env.FLOW_LIVE_FEISHU_CARDS==='true';this.running=false;this.closed=false;this.nextRefresh=0;
    this.bindings=[];
    if(!this.enabled)return;
    requireFact(env.FLOW_LIVE_PARTICIPANTS_FILE,'未配置直播参与人名单',503);
    this.bindings=JSON.parse(readFileSync(env.FLOW_LIVE_PARTICIPANTS_FILE,'utf8'));
    requireFact(Array.isArray(this.bindings)&&this.bindings.length>0&&this.bindings.length<=100,'参与人名单无效',503);
    // No employee_no comparison here: that field is outside the approved
    // retained data set. Identity is the app-scoped immutable open_id.
    requireFact(this.bindings.every(b=>!b.employeeNo),'名单不得保存额外受雇字段',409);
    this.participants=new LiveFeishuParticipants({bindings:this.bindings,appId:notifier.appId,clock,
      fetchUser:createLiveDirectoryReader({bindings:this.bindings,notifier,fetchImpl:notifier.fetch})});
    this.actions=new LiveFeishuActions({runtime,participants:this.participants,liveSessions,appId:notifier.appId,clock});
    this.inbox=new LiveFeishuInbox({actions:this.actions,clock,updateCard:async(messageId,card)=>{
      const token=await notifier.tenantToken();
      const response=await notifier.fetch('https://open.feishu.cn/open-apis/im/v1/messages/'+encodeURIComponent(messageId),{
        method:'PATCH',headers:{authorization:'Bearer '+token,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),body:JSON.stringify({content:JSON.stringify(card)}),
      });
      const data=await response.json();requireFact(response.ok&&data.code===0,'飞书卡片更新待重试',503);
    }});
    this.transport=new LiveFeishuTransport({appId:notifier.appId,appSecret:notifier.secret,inbox:this.inbox,enabled:true});
    runtime.liveParticipants=this.participants;notifier.liveCards=this;
    // Cold identity cache or disconnected transport is not proof that an
    // employee lost eligibility. Actions/dispatch still fail closed via their
    // own live identity and transport guards; defer only personnel alarms.
    runtime.assignmentChecksReady=task=>!task.runtime?.liveSession||this.assignmentChecksReady();
  }
  assignmentChecksReady(){return this.ready()&&this.participants.bindings.every(b=>this.participants.verified(b.number)||this.participants.issues.some(i=>i.number===b.number));}
  has(number){return this.enabled&&this.participants.bindings.some(b=>b.number===number);}
  recipient(number){return this.participants?.recipient(number)||null;}
  ready(){return !!(this.enabled&&!this.closed&&this.transport.ready());}
  people(hubPeople){return this.participants?.merge(hubPeople)||hubPeople;}
  status(){return {enabled:this.enabled,transport:this.transport?.status()||null,verified:this.participants?.people().length||0,configured:this.bindings.length,issues:this.participants?.issues||[]};}
  async refreshIdentities(){
    if(!this.enabled||this.closed)return;
    if(this.identityRefreshPromise)return this.identityRefreshPromise;
    if(this.clock()<this.nextRefresh)return;
    this.nextRefresh=this.clock()+300000;
    // Read-only identity verification must also work in a no-dispatch candidate.
    // Never start a callback consumer, queue notifications or mutate tasks here.
    this.identityRefreshPromise=Promise.resolve().then(()=>this.participants.refresh());
    try{return await this.identityRefreshPromise;}
    finally{this.identityRefreshPromise=null;}
  }
  delivery(notice,task){
    requireFact(this.ready()&&this.recipient(notice.recipient),'飞书办理通道或身份待核验',503);
    requireFact(task.workflow==='04'&&task.runtime?.liveSession,'非直播场次不得向此名单通知',403);
    if(notice.nodeId)return {msg_type:'interactive',channel:'live_feishu_card',content:JSON.stringify(liveFeishuCard(notice,task))};
    const labels={pause:'流程已暂停',resume:'流程已恢复',cancel:'流程已终止'};
    requireFact(labels[notice.kind],'不支持此类外部参与人通知',409);
    return {msg_type:'text',channel:'live_feishu_text',content:JSON.stringify({text:`【WIS 直播工作通知】${labels[notice.kind]}\n${task.runtime.liveSession.date} · ${task.runtime.liveSession.roomName}\n请以最新工作卡片和直播负责人说明为准，无需登录中枢。`})};
  }
  async tick(){
    if(!this.enabled||this.closed||this.running)return;this.running=true;
    try{
      await this.refreshIdentities();
      if(!this.closed&&!this.transport.client)await this.transport.start();
      if(!this.closed){this.queueMorning();await this.inbox.flush();}
    }finally{this.running=false;}
  }
  queueMorning(){
    if(!this.ready())return;
    const local=new Date(this.clock()+8*3600000),date=local.toISOString().slice(0,10);
    if(local.getUTCHours()<8)return;
    const tomorrow=Date.parse(date+'T00:00:00+08:00')+86400000;
    const participants=this.participants;
    function* due(s){
      for(const task of s.tasks.filter(t=>t.runtime?.liveSession&&t.runtime.state==='running'&&!t.runtime.liveSession.sourceIssue&&Date.parse(t.runtime.liveSession.startAt)<tomorrow)){
        for(const node of task.runtime.nodes.filter(n=>['pending','ready'].includes(n.state)&&participants.canOwn(n.owner.number,n.id))){
          const exists=(s.flowNotifications||[]).some(n=>n.taskId===task.id&&n.nodeId===node.id&&n.attempt===node.attempt&&n.recipient===node.owner.number&&n.kind==='live_today'&&n.businessDate===date);
          if(exists)continue;
          yield {task,node};
        }
      }
    }
    // Avoid locking, fsync and replacing the entire store on every idle tick.
    // The snapshot only skips idle work; eligibility and dedupe are rechecked
    // under the existing transaction lock before any notification is created.
    if(due(this.runtime.store.read()).next().done)return;
    this.runtime.store.transaction(s=>{
      for(const {task,node} of due(s)){
        const event=this.runtime.log(s,task,node,'live_today_queued',undefined,'北京时间 '+date+' 本人直播待办');
        this.runtime.notify(s,task,node,'live_today',node.owner.number,event.id);
        const notice=s.flowNotifications.at(-1);notice.businessDate=date;
      }
    });
  }
  stop(){this.closed=true;this.transport?.stop();}
}
