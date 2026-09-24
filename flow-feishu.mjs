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
 async flush(){if(this.flushing||!this.enabled||!this.appId||!this.secret)return;this.flushing=true;try{for(let i=0;i<5;i++){
   const snapshot=this.store.read();const due=(snapshot.flowNotifications||[]).some(n=>(n.state==='ready'&&n.nextAt<=this.clock())||(n.state==='sending'&&n.leaseUntil<=this.clock()));if(!due)break;
   const lease=this.store.transaction(s=>{const n=(s.flowNotifications||[]).find(n=>(n.state==='ready'&&n.nextAt<=this.clock())||(n.state==='sending'&&n.leaseUntil<=this.clock()));if(!n)return null;const t=s.tasks.find(t=>t.id===n.taskId);const node=t?.runtime.nodes.find(x=>x.id===n.nodeId);const source=t?.runtime.localBusiness||t?.runtime.creative;if(source&&(source.issue||!source.checkedAt||this.clock()-Date.parse(source.checkedAt)>45000)){n.nextAt=this.clock()+30000;return null;}if(t?.runtime.creative&&n.kind==='completed'&&t.runtime.state!=='completed'){retireInvalidNotice(n,{expiredLease:n.state==='sending'});return null;}if(!currentNodeNotice(n,t,node,this.clock())||!currentNextDayGroup(n,s,this.clock())||!t||n.kind==='routing_attention'&&!Object.keys(t.runtime.routingIssues||{}).length||n.kind==='source_attention'&&(!t.runtime.automation?.issue||t.runtime.state!=='running'||n.reason&&n.reason!==t.runtime.automation.issue)||n.kind==='assignment_attention'&&(!t.runtime.assignmentIssue||t.runtime.state!=='running')||n.kind==='handoff_blocked'&&t.runtime.handoff?.state!=='attention'||['ready','overdue','escalated','returned'].includes(n.kind)&&(t.runtime.state!=='running'||node?.state!=='ready'||node.attempt!==n.attempt||n.kind==='ready'&&node.owner.number!==n.recipient)){retireInvalidNotice(n,{expiredLease:n.state==='sending'});return null;}if((n.unknown||n.state==='sending')&&this.clock()-Date.parse(n.firstAttemptAt||n.createdAt)>=3600000){n.state='attention';n.unknown=true;n.error='发送结果不明且超出平台幂等窗口，已停止重发，请核验原消息';return null;}if(n.state==='sending')n.unknown=true;n.firstAttemptAt??=new Date(this.clock()).toISOString();n.state='sending';n.attempts++;n.leaseId=randomUUID();n.leaseUntil=this.clock()+45000;return {notice:n,task:t};});if(!lease)continue;
   const n=lease.notice;
   if(this.liveCards?.has(n.recipient)&&!this.liveCards.ready()){
     this.store.transaction(s=>{const row=s.flowNotifications.find(x=>x.id===n.id);if(row?.leaseId!==n.leaseId)return;row.state='ready';row.attempts--;row.nextAt=this.clock()+30000;row.error='飞书卡片通道待恢复，尚未发送';delete row.leaseId;delete row.leaseUntil;});continue;
   }
   let state='ready',messageId=null,error='',unknown=false;try{const recipient=this.recipient(n.recipient);if(!recipient){state='attention';error='未找到唯一且在职的飞书收件人映射';}else{
     const delivery=n.delivery||this.delivery(n,lease.task);
     this.store.transaction(s=>{const row=s.flowNotifications.find(x=>x.id===n.id);requireFact(row?.leaseId===n.leaseId,'发送租约已变化',409);row.delivery??=delivery;row.channel=delivery.channel;});
      let refreshAttempt=0;while(true){const token=await this.tenantToken();
      if(needsOfficialLiveSource(n,lease.task)){
        let sourceValid=false;
        try{sourceValid=Boolean(await this.verifyLiveNoticeSource?.(n));}catch{ /* Unreadable official source must block the POST. */ }
        if(!sourceValid){state='attention';unknown=Boolean(n.unknown);error=unknown?'正式班表在通知发送前已变化或无法重新核验；此前发送结果不明，已停止重发，请人工核验原消息':'正式班表在通知发送前已变化或无法重新核验；本次未发送，请主管核对';break;}
      }
     // Token acquisition can yield while a person's card acknowledgement,
     // node attempt, owner or schedule source changes. Re-read the durable
     // lease and business state immediately before the first/renewed POST.
     // There is no await between this check and invoking fetch.
     const fresh=this.store.transaction(s=>{
       const row=s.flowNotifications?.find(x=>x.id===n.id),task=s.tasks.find(x=>x.id===row?.taskId),node=task?.runtime.nodes.find(x=>x.id===row.nodeId),mapped=row&&this.recipient(row.recipient);
       return {valid:Boolean(row?.state==='sending'&&row.leaseId===n.leaseId&&task&&mapped?.id===recipient.id&&mapped?.type===recipient.type&&currentNodeNotice(row,task,node,this.clock())&&currentNextDayGroup(row,s,this.clock())),uncertain:Boolean(row?.unknown)};
     });
     if(!fresh.valid){state=fresh.uncertain?'attention':'superseded';unknown=fresh.uncertain;error=fresh.uncertain?'通知已失效；此前发送结果不明，本次未重发，请人工核验原消息':'发送前任务、本人身份或群确认状态已变化，本次未发送';break;}
     const r=await this.fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type='+encodeURIComponent(recipient.type),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},signal:AbortSignal.timeout(12000),redirect:'error',body:JSON.stringify({receive_id:recipient.id,msg_type:delivery.msg_type,uuid:createHash('sha256').update(n.id).digest('hex').slice(0,32),content:delivery.content})});const d=await r.json();
     if([99991663,99991668].includes(d.code)&&refreshAttempt++===0){this.token=null;continue;}if(r.ok&&d.code===0&&d.data?.message_id){state='sent';messageId=d.data.message_id;}else if([429,500,502,503,504].includes(r.status)){unknown=r.status>=500;error='飞书暂时繁忙，原事件将退避重试';}else{state='attention';error='飞书发送失败，错误码 '+String(d.code??r.status);if(d.code===99991663||d.code===99991668)this.token=null;}break;}
    }}catch{unknown=true;error='发送结果暂不确定，将用同一消息编号核验重试';}
   this.store.transaction(s=>{const row=s.flowNotifications.find(x=>x.id===n.id);if(row?.leaseId!==n.leaseId)return null;row.state=state==='ready'&&row.attempts>=5?'attention':state;row.error=error;row.unknown=state==='sent'?false:Boolean(row.unknown||unknown);row.messageId=messageId||row.messageId;if(state==='sent')row.sentAt=new Date(this.clock()).toISOString();row.nextAt=this.clock()+Math.min(120000,5000*2**row.attempts);delete row.leaseId;delete row.leaseUntil;return true;});
  }}finally{this.flushing=false;}}
 retry(a,id){return this.store.transaction(s=>{const n=s.flowNotifications?.find(n=>n.id===id);const t=s.tasks.find(t=>t.id===n?.taskId);requireFact(n&&t&&t.runtime?.participants.includes(a.user.number)&&a.canManage,'没有该通知的处理权限',403);requireFact(n.state==='attention','只允许重试待处理通知',409);requireFact(!n.unknown||this.clock()-Date.parse(n.firstAttemptAt||n.createdAt)<3600000,'消息结果不明且超出幂等核验窗口，请人工核验，已停止重发',409);n.state='ready';n.attempts=0;n.nextAt=this.clock();return {id:n.id,state:n.state};});}
}
