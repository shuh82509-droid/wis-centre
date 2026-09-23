import {createHash} from 'node:crypto';
import {FlowFeishu} from './flow-feishu.mjs';
import {notificationLinks} from './notification-links.mjs';
// Business outbox delivery is independent of the workflow engine and browser.
// Reuse its tested Feishu UUID, retry, lease and uncertain-result handling.
export class ServiceNotifications {
 constructor(store,{people,fetchImpl,env,clock=Date.now}){
  this.store=store;this.clock=clock;this.links=notificationLinks(env);this.sender=new FlowFeishu(store,{people,fetchImpl,env,clock});
  this.sender.message=(_n,t)=>{const value=String(t.native.createdAt||''),when=new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+'Z');const time=Number.isFinite(when.getTime())?when.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':value;return ['【'+t.native.service+'】'+t.title,t.native.message,'事件时间：'+time,'打开工作台：'+(t.native.deliveryUrl||this.links[t.native.source]||t.native.url)].join('\n');};
 }
 import(source,events){return this.store.transaction(s=>{
  s.nativeSources??={};s.flowNotifications??=[];
  let state=s.nativeSources[source];
  // Enable from now on. Never flood people with historical review reminders.
  if(!state){state=s.nativeSources[source]={seen:events.map(e=>e.key),initializedAt:new Date(this.clock()).toISOString()};return 0;}
  let added=0;const seen=new Set(state.seen);
  for(const e of events){if(!e.recipient||!e.key||!e.title||!/^https?:\/\//.test(e.url))throw Error('Invalid business notification');
   let correction=null,deliveryKey=source+':'+e.key;
   if(seen.has(e.key)){
    const prior=[...s.tasks].reverse().find(t=>t.native?.source===source&&t.native.key===e.key);
    const old=prior&&s.flowNotifications.find(n=>n.taskId===prior.id);
    // History-baseline events, delivered messages and uncertain sends are immutable.
    if(!old||old.messageId||old.unknown||!['ready','attention'].includes(old.state))continue;
    if(e.active===false){old.state='superseded';old.previousError=old.error||'';old.error='原审核待办已过期，不再补发';continue;}
    const safeMappingFailure=old.state==='attention'&&old.error==='未找到唯一且在职的飞书收件人映射'||old.state==='ready'&&old.attempts===0;
    if(source!=='creative'||!e.localRecipientAlias||old.recipient!=='LOCAL-CREATIVE'||e.recipient===old.recipient||!safeMappingFailure)continue;
    correction=old;deliveryKey+=':recipient:'+e.recipient;
   }
   const digest=createHash('sha256').update(deliveryKey).digest('hex'),taskId='native_'+digest;
   if(s.tasks.some(t=>t.id===taskId))continue;
   s.tasks.push({id:taskId,title:e.title,workflow:'native',native:{...e,source},runtime:{nodes:[],state:'running'}});
   const notice={id:'native_notice_'+digest,key:deliveryKey,taskId,nodeId:null,attempt:0,kind:'native',recipient:e.recipient,state:e.active===false?'superseded':'ready',attempts:0,nextAt:this.clock(),createdAt:new Date(this.clock()).toISOString(),messageId:null};
   if(correction){correction.state='superseded';correction.supersededBy=notice.id;correction.correction={at:notice.createdAt,previousRecipient:correction.recipient,newRecipient:e.recipient,reason:'explicit_local_creative_alias'};notice.correctionOf=correction.id;}
   s.flowNotifications.push(notice);
   if(!seen.has(e.key)){state.seen.push(e.key);seen.add(e.key);}added++;
  }return added;
 });}
 receipts(source){const s=this.store.read();return s.tasks.filter(t=>t.native?.source===source).map(t=>({event:t.native,receipt:s.flowNotifications.find(n=>n.taskId===t.id)}));}
 async flush(){
  // Freeze the URL before first dispatch. A retry with the same platform UUID
  // must retain the original body, including when a previous result is unknown.
  this.store.transaction(s=>{for(const n of s.flowNotifications||[]){if(!['ready','sending'].includes(n.state))continue;const t=s.tasks.find(t=>t.id===n.taskId);if(t?.native&&!t.native.deliveryUrl)t.native.deliveryUrl=n.attempts>0||n.unknown?t.native.url:this.links[t.native.source]||t.native.url;}return true;});
  await this.sender.flush();
 }
}
