import {randomUUID,createHash} from 'node:crypto';
import {requireFact} from './workflow-store.mjs';
import {currentNodeNotice} from './flow-notice-validity.mjs';
import {currentNextDayGroup,LIVE_WAR_ROOM_RECIPIENT,needsOfficialLiveSource} from './live-next-day.mjs';
function retireInvalidNotice(n,{expiredLease=false}={}){
 const uncertain=Boolean(n.unknown||expiredLease);
 n.state=uncertain?'attention':'superseded';
 n.error=uncertain?'通知已失效；此前发送结果不明，已停止重发，请人工核验原消息':'通知已失效，本次未发送';
 if(uncertain)n.unknown=true;
 delete n.leaseId;delete n.leaseUntil;
}
function freshBusinessSource(task,now){
 const source=task?.runtime?.localBusiness||task?.runtime?.creative;
 if(!source)return true;
 const checked=typeof source.checkedAt==='string'?Date.parse(source.checkedAt):NaN;
 return Boolean(!source.issue&&Number.isFinite(now)&&Number.isFinite(checked)&&checked<=now&&now-checked<=45000);
}
const hasIntent=n=>Boolean(n&&(Object.hasOwn(n,'futureEvidence')||Object.hasOwn(n,'sendIntent')));
const hasDeliveryFact=n=>Boolean(n?.messageId||n?.sentAt);
// Historical uncertain/in-flight rows are immutable here. No hold migration,
// expired-lease recovery, intent release or independent provider readback exists.
const immutableNotice=n=>Boolean(n&&(n.unknown||n.state==='sending'||hasIntent(n)||hasDeliveryFact(n)));
const dueNotice=(n,now)=>(n.state==='ready'&&n.nextAt<=now)||(n.state==='sending'&&n.leaseUntil<=now);
function nextFlushNotice(snapshot,now,remaining){
 const firstTasks=new Map();
 for(const task of snapshot.tasks||[])if(!firstTasks.has(task.id))firstTasks.set(task.id,task);
 return (snapshot.flowNotifications||[]).find(n=>remaining.has(n.id)&&dueNotice(n,now)&&!immutableNotice(n)&&freshBusinessSource(firstTasks.get(n.taskId),now))||null;
}
function sameIntent(left,right){return Boolean(left&&right&&JSON.stringify(left)===JSON.stringify(right));}
function ownedLease(row,notice,intent=null){
 if(!row||row.state!=='sending'||row.leaseId!==notice.leaseId||row.unknown||Object.hasOwn(row,'futureEvidence')||hasDeliveryFact(row))return false;
 return Object.hasOwn(row,'sendIntent')?sameIntent(row.sendIntent,intent):intent===null;
}
function currentBusinessReason(n,t,node){
 if(!t?.runtime)return false;
 const runtime=t.runtime;
 if(runtime.creative&&n.kind==='completed'&&runtime.state!=='completed')return false;
 return !(n.kind==='routing_attention'&&!Object.keys(runtime.routingIssues||{}).length||
  n.kind==='source_attention'&&(!runtime.automation?.issue||runtime.state!=='running'||n.reason&&n.reason!==runtime.automation.issue)||
  n.kind==='assignment_attention'&&(!runtime.assignmentIssue||runtime.state!=='running')||
  n.kind==='handoff_blocked'&&runtime.handoff?.state!=='attention'||
  ['ready','overdue','escalated','returned'].includes(n.kind)&&(runtime.state!=='running'||node?.state!=='ready'||node.attempt!==n.attempt||n.kind==='ready'&&node.owner.number!==n.recipient));
}
export class FlowFeishu{
  constructor(store,{people,fetchImpl=fetch,clock=Date.now,env=process.env,verifyLiveNoticeSource=null}={}){this.store=store;this.people=people;this.fetch=fetchImpl;this.clock=clock;this.verifyLiveNoticeSource=verifyLiveNoticeSource;this.enabled=env.FLOW_NOTIFICATIONS_ENABLED==='true';this.appId=env.FEISHU_APP_ID||'';this.secret=env.FEISHU_APP_SECRET||'';this.receiveType=env.FEISHU_RECEIVE_ID_TYPE||'open_id';this.warRoomChatId=env.FLOW_LIVE_WAR_ROOM_CHAT_ID==='oc_3f92ef62d6160399ee823e74def199e6'?env.FLOW_LIVE_WAR_ROOM_CHAT_ID:null;try{this.map=JSON.parse(env.FEISHU_RECIPIENT_MAP_JSON||'{}');}catch{this.map={};}this.base=env.FLOW_PUBLIC_URL||'https://app.fandow.top/fd-026222/wis-marketing-hub/workflow-panorama/';this.includeTaskId=env.FLOW_NOTIFICATION_INCLUDE_TASK_ID!=='false';this.token=null;this.flushing=false;}
 recipient(number){if(number===LIVE_WAR_ROOM_RECIPIENT)return this.warRoomChatId?{id:this.warRoomChatId,type:'chat_id',name:'WIS直播战队'}:null;if(this.liveCards?.has(number))return this.liveCards.recipient(number);const p=this.people().find(p=>p.active&&p.number===number);if(!p)return null;let value=this.map[number];if(!value&&this.people().filter(r=>r.name===p.name).length===1)value=this.map[p.name];return value?{id:value,type:this.receiveType,name:p.name}:null;}
 // Pausing dispatch does not remove a person's verified binding. Queueing and
 // sending remain separate, and flush() still sends nothing while disabled.
 canQueue(number){return !!(this.appId&&this.secret&&this.recipient(number)&&(!this.liveCards?.has(number)||this.liveCards.ready()));}
 delivery(n,t){return this.liveCards?.has(n.recipient)?this.liveCards.delivery(n,t):{msg_type:'text',content:JSON.stringify({text:this.message(n,t)}),channel:'text'};}
 status(){const people=this.people();return {enabled:this.enabled,configured:!!(this.appId&&this.secret),mapped:people.filter(p=>this.recipient(p.number)).length,total:people.length};}
 async tenantToken(){if(this.token&&this.token.until>this.clock())return this.token.value;const r=await this.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),body:JSON.stringify({app_id:this.appId,app_secret:this.secret})});const d=await r.json();requireFact(r.ok&&d.code===0&&d.tenant_access_token,'飞书应用认证暂不可用',503);this.token={value:d.tenant_access_token,until:this.clock()+Math.max(60,Number(d.expire||7200)-120)*1000};return this.token.value;}
 message(n,t){const node=t.runtime.nodes.find(x=>x.id===n.nodeId);const labels={ready:'有一项工作待你办理',returned:'工作已退回，请补充修改',overdue:'节点已超时，请处理或申请延期',escalated:'超时事项需要你协调',completed:'流程已完成',pause:'流程已暂停',resume:'流程已恢复',cancel:'流程已终止',source_attention:'自动流程需要处理',handoff_linked:'已有任务新增了上游交接，请核对',handoff_blocked:'流程交接需要你协调',assignment_attention:'流程负责人需要调整',routing_attention:'条件分支需要你协调'};
  Object.assign(labels,{live_source_changed:'直播班表已变化，请核验原任务',live_source_restored:'直播班表已重新核验，可继续办理',live_participant_issue:'主播或助理反馈异常，请协调',live_card_attention:'飞书卡片办理待核验，请协调'});
  const title=t.workflow==='06'?'部门管理事项':t.title;return ['【WIS 中枢】'+(labels[n.kind]||'任务状态更新'),title,node?`当前环节：${node.title}`:'',n.kind==='live_source_changed'?t.runtime.liveSession?.sourceIssue||'':n.kind==='routing_attention'?Object.values(t.runtime.routingIssues||{}).map(x=>x.message).join('；'):n.kind==='assignment_attention'?t.runtime.assignmentIssue?.message||'':n.kind==='source_attention'?t.runtime.automation?.issue||'':n.kind==='handoff_blocked'?t.runtime.handoff?.error||'':'',node?.dueAt?'截止：'+new Date(node.dueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'',t.workflow==='06'?'详细资料请在受限任务页面查看。':'完成标准：'+(node?.done||t.acceptance),this.includeTaskId?this.base+'?task='+encodeURIComponent(t.id):this.base].filter(Boolean).join('\n');}
 async flush(){
  if(this.flushing||!this.enabled||!this.appId||!this.secret)return;
  this.flushing=true;
  try{
   const batch=this.store.read(),batchAt=this.clock();
   const remaining=new Set((batch.flowNotifications||[]).filter(n=>dueNotice(n,batchAt)).map(n=>n.id));
   let leases=0;
   while(leases<5&&remaining.size){
    const selected=nextFlushNotice(this.store.read(),this.clock(),remaining);
    if(!selected)break;
    remaining.delete(selected.id);
    const lease=this.store.transaction(s=>{
     const n=(s.flowNotifications||[]).find(n=>n.id===selected.id),now=this.clock();
     if(!n||!dueNotice(n,now)||immutableNotice(n))return null;
     const t=s.tasks.find(t=>t.id===n.taskId),node=t?.runtime?.nodes?.find(x=>x.id===n.nodeId);
     if(!freshBusinessSource(t,now))return null;
     if(!currentNodeNotice(n,t,node,now)||!currentNextDayGroup(n,s,now)||!currentBusinessReason(n,t,node)){retireInvalidNotice(n);return null;}
     n.firstAttemptAt??=new Date(now).toISOString();n.state='sending';n.attempts++;
     n.leaseId=randomUUID();n.leaseUntil=now+45000;
     return {notice:n,task:t};
    });
    if(!lease)continue;
    leases++;
    const n=lease.notice;
    if(this.liveCards?.has(n.recipient)&&!this.liveCards.ready()){
     this.store.transaction(s=>{
      const row=s.flowNotifications.find(x=>x.id===n.id);
      if(!ownedLease(row,n))return null;
      row.state='ready';row.attempts--;row.nextAt=this.clock()+30000;row.error='飞书卡片通道待恢复，尚未发送';
      delete row.leaseId;delete row.leaseUntil;return true;
     });
     continue;
    }
    let state='ready',messageId=null,error='',unknown=false,postInvoked=false,intent=null;
    try{
     const recipient=this.recipient(n.recipient);
     if(!recipient){state='attention';error='未找到唯一且在职的飞书收件人映射';}
     else{
      const delivery=n.delivery||this.delivery(n,lease.task);
      // Pin serialized facts before a store write or await can alias/mutate delivery.
      const deliverySignature=JSON.stringify(delivery);
      const body=JSON.stringify({receive_id:recipient.id,msg_type:delivery.msg_type,uuid:createHash('sha256').update(n.id).digest('hex').slice(0,32),content:delivery.content});
      this.store.transaction(s=>{
       const row=s.flowNotifications.find(x=>x.id===n.id);
       requireFact(ownedLease(row,n),'发送租约或不明结果已变化；本次未发送',409);
       row.delivery??=delivery;row.channel=delivery.channel;
      });
      const token=await this.tenantToken();
      requireFact(typeof token==='string'&&token.trim().length>0,'飞书认证令牌格式异常，本次未调用消息 POST',503);
      let sourceValid=true;
      if(needsOfficialLiveSource(n,lease.task)){
       sourceValid=false;
       try{sourceValid=Boolean(await this.verifyLiveNoticeSource?.(n));}catch{ /* An unreadable official source blocks POST. */ }
      }
      if(!sourceValid){state='attention';error='正式班表在通知发送前已变化或无法重新核验；本次未发送，请主管核对';}
      else{
       const finalGuard=(s,expectedIntent=null)=>{
        const row=s.flowNotifications?.find(x=>x.id===n.id),task=s.tasks.find(x=>x.id===row?.taskId);
        const node=task?.runtime?.nodes?.find(x=>x.id===row?.nodeId),mapped=row&&this.recipient(row.recipient),now=this.clock();
        return {row,valid:Boolean(ownedLease(row,n,expectedIntent)&&Number.isFinite(now)&&Number.isFinite(row.leaseUntil)&&
         row.leaseUntil===n.leaseUntil&&now>=n.leaseUntil-45000&&row.leaseUntil>now&&
         row.taskId===n.taskId&&row.nodeId===n.nodeId&&row.recipient===n.recipient&&row.kind===n.kind&&row.attempt===n.attempt&&
         task&&mapped?.id===recipient.id&&mapped?.type===recipient.type&&freshBusinessSource(task,now)&&
         JSON.stringify(row.delivery)===deliverySignature&&currentNodeNotice(row,task,node,now)&&currentNextDayGroup(row,s,now)&&currentBusinessReason(row,task,node))};
       };
       // A same-file, conservative durable intent is not a send result. It has
       // no credentials/body and is never automatically released, even when a
       // response explicitly rejects this POST. Persist before invoking fetch.
       const prepared=this.store.transaction(s=>{
        const check=finalGuard(s);
        if(!check.valid)return null;
        check.row.sendIntent={leaseId:n.leaseId,preparedAt:new Date(this.clock()).toISOString()};
        return check.row.sendIntent;
       });
       if(!prepared){state='superseded';error='发送前租约、来源、节点、本人身份或群状态已变化，本次未发送';}
       else{
        intent=prepared;
        // Synchronous persistence itself may be slow or fail after rename.
        // Re-read after it, then perform no await before invoking the POST.
        const final=finalGuard(this.store.read(),intent);
        if(!final.valid){state='attention';error='发送意图已持久保存，但最后状态或来源门禁不符；本次未发送，保留原意图待只读核验';}
        else{
         postInvoked=true;
         const r=await this.fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type='+encodeURIComponent(recipient.type),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},signal:AbortSignal.timeout(12000),redirect:'error',body});
         const d=await r.json();
         if(r.ok&&d?.code===0&&typeof d.data?.message_id==='string'&&d.data.message_id.trim()){state='sent';messageId=d.data.message_id;}
         else{
          state='attention';
          const explicitRejection=Boolean(d&&typeof d==='object'&&!Array.isArray(d)&&Number.isFinite(d.code)&&d.code!==0&&
           Number.isFinite(r.status)&&r.status>=200&&r.status<500&&![408,409,499].includes(r.status));
          unknown=!explicitRejection;
          error=unknown?'飞书发送结果不明或成功回执缺少消息 ID，保留原发送意图，停止重发，请只读核验原消息':'飞书明确拒绝发送，错误码 '+String(d?.code??r.status)+'；保留原发送意图，不自动或手动重发';
          if(d?.code===99991663||d?.code===99991668)this.token=null;
         }
        }
       }
      }
     }
    }catch{
     if(postInvoked){state='attention';unknown=true;error='消息 POST 已调用但结果不确定，保留原发送意图，停止重发，请只读核验原消息';}
     else if(intent){state='attention';error='发送意图已持久保存但发送前读取失败，保留原意图，本次不重发';}
     else{state='ready';error='认证或发送准备失败，本次未调用消息 POST；待安全重试';}
    }
    this.store.transaction(s=>{
     const row=s.flowNotifications.find(x=>x.id===n.id);
     // Never overwrite a concurrently introduced unknown/foreign intent or a
     // different lease. A prepared intent whose transaction threw stays held.
     if(!ownedLease(row,n,intent))return null;
     row.state=state==='ready'&&row.attempts>=5?'attention':state;row.error=error;
     row.unknown=state==='sent'?false:Boolean(row.unknown||unknown);row.messageId=messageId||row.messageId;
     if(state==='sent')row.sentAt=new Date(this.clock()).toISOString();
     row.nextAt=this.clock()+Math.min(120000,5000*2**row.attempts);
     delete row.leaseId;delete row.leaseUntil;return true;
    });
   }
  }finally{this.flushing=false;}
 }
 retry(a,id){return this.store.transaction(s=>{const n=s.flowNotifications?.find(n=>n.id===id);const t=s.tasks.find(t=>t.id===n?.taskId);requireFact(n&&t&&t.runtime?.participants.includes(a.user.number)&&a.canManage,'没有该通知的处理权限',403);requireFact(!immutableNotice(n),'通知结果、租约或发送意图待核验，已停止自动与手动重发',409);requireFact(n.state==='attention','只允许重试待处理通知',409);n.state='ready';n.attempts=0;n.nextAt=this.clock();return {id:n.id,state:n.state};});}
}
