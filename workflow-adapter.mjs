import { randomUUID } from 'node:crypto';
import { requireFact } from './workflow-store.mjs';
import { fingerprint } from './task-workflow.mjs';
import { signEvent } from './workflow-http.mjs';

// This adapter sends receipts ONLY. It cannot upload, create ads, publish or retry a business push.
// Producers enqueue the observed result after committing their own business transaction.
export class WorkflowReceiptOutbox {
  constructor(store,{endpoint,adapterId,secret,fetchImpl=fetch,clock=Date.now,allowLoopback=false}={}) {
    this.store=store;this.endpoint=endpoint;this.adapterId=adapterId;this.secret=secret;this.fetch=fetchImpl;this.clock=clock;this.allowLoopback=allowLoopback;
  }
  enqueue(event) {
    requireFact(event.eventId && event.taskId && ['delivery_receipt','business_feedback','asset_probe'].includes(event.type),'回执字段不完整');
    const hash=fingerprint(event);
    return this.store.transaction(state=>{
      const old=state.outbox.find(item=>item.id===event.eventId);
      if(old){requireFact(old.hash===hash,'同一回执编号不能改变内容',409);return old;}
      const item={id:event.eventId,hash,event,state:'ready',attempts:0,nextAt:this.clock(),createdAt:this.clock()};state.outbox.push(item);return item;
    });
  }
  async flush({limit=5}={}) {
    // Missing integration configuration is visible, and never silently acknowledged.
    if(!this.endpoint || !this.adapterId || !this.secret)return {state:'not_configured',sent:0};
    const url=new URL(this.endpoint);
    requireFact((url.protocol==='https:' || this.allowLoopback && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)) && !url.username && !url.password,'回执目标配置无效');
    requireFact(this.secret.length>=32,'回执密钥长度不足');
    let sent=0;
    for(let i=0;i<Math.min(20,Math.max(1,limit));i++) {
      const lease=this.store.transaction(state=>{
        const item=state.outbox.find(row=>(row.state==='ready' && row.nextAt<=this.clock()) || (row.state==='sending' && row.leaseUntil<=this.clock()));
        if(!item)return null;
        item.state='sending';item.leaseId=randomUUID();item.leaseUntil=this.clock()+60000;item.attempts++;return item;
      });
      if(!lease)break;
      let state='ready',retryAfter=0;
      try {
        const raw=JSON.stringify(lease.event),timestamp=String(this.clock());
        const response=await this.fetch(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','x-workflow-adapter':this.adapterId,'x-workflow-timestamp':timestamp,'x-workflow-signature':signEvent(this.secret,timestamp,raw)},body:raw});
        if(response.ok) {const ack=await response.json();requireFact(ack?.accepted===true,'中枢未确认接收',503);state='delivered';sent++;}
        else if([400,401,403,404,409,422].includes(response.status))state='needs_attention';
        else {const header=response.headers.get('Retry-After');retryAfter=Math.min(3600000,Math.max(0,Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-this.clock() || 0));}
      }catch{/* Unknown acknowledgement: safely replay the SAME event ID, never the underlying business operation. */}
      this.store.transaction(data=>{
        const item=data.outbox.find(row=>row.id===lease.id);if(item?.leaseId!==lease.leaseId)return null;
        item.state=state==='ready' && item.attempts>=6?'needs_attention':state;
        item.nextAt=this.clock()+Math.max(retryAfter,Math.min(300000,1000*2**item.attempts));
        item.leaseUntil=null;item.leaseId=null;item.updatedAt=this.clock();return item;
      });
    }
    return {state:'processed',sent};
  }
  resume(eventId) {return this.store.transaction(state=>{const item=state.outbox.find(i=>i.id===eventId);requireFact(item?.state==='needs_attention','该回执不在待维护状态',409);item.state='ready';item.attempts=0;item.nextAt=this.clock();return item;});}
}
