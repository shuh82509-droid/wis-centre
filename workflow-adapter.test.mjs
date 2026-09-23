import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowStore } from './workflow-store.mjs';
import { WorkflowReceiptOutbox } from './workflow-adapter.mjs';
const event={eventId:'event-1',taskId:'task_1',type:'asset_probe',outputId:'out_1'};
function fixture(t,fetchImpl){const dir=mkdtempSync(join(tmpdir(),'wis-receipt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new WorkflowStore(join(dir,'receipts.json'));let clock=1788500000000;const config={endpoint:'https://hub.example.test/api/task-center/events',adapterId:'video',secret:'s'.repeat(40),fetchImpl,clock:()=>clock};return {store,config,advance:ms=>clock+=ms,box:new WorkflowReceiptOutbox(store,config)};}
test('收到有效接收确认才清除待发送状态',async t=>{const f=fixture(t,async()=>new Response('{"accepted":true}',{status:200}));f.box.enqueue(event);assert.equal((await f.box.flush()).sent,1);assert.equal(f.store.read().outbox[0].state,'delivered');});
test('中枢已接收但响应丢失，重启后只重发相同回执',async t=>{const seen=[];let calls=0;const f=fixture(t,async(_,init)=>{seen.push(JSON.parse(init.body).eventId);if(++calls===1)throw Error('lost response');return new Response('{"accepted":true,"duplicate":true}');});f.box.enqueue(event);await f.box.flush();assert.equal(f.store.read().outbox[0].state,'ready');f.advance(10000);await new WorkflowReceiptOutbox(f.store,f.config).flush();assert.deepEqual(seen,['event-1','event-1']);assert.equal(f.store.read().outbox[0].state,'delivered');});
test('回执内容冲突拒绝',t=>{const f=fixture(t);f.box.enqueue(event);assert.throws(()=>f.box.enqueue({...event,outputId:'other'}),e=>e.status===409);});
test('没有配置不发送，也不虚报成功',async t=>{const f=fixture(t);const box=new WorkflowReceiptOutbox(f.store);box.enqueue(event);assert.equal((await box.flush()).state,'not_configured');assert.equal(f.store.read().outbox[0].state,'ready');});
for(const status of [400,401,403,404,409,422]) test(`回执 HTTP ${status} 转人工处理`,async t=>{const f=fixture(t,async()=>new Response('{}',{status}));f.box.enqueue(event);await f.box.flush();assert.equal(f.store.read().outbox[0].state,'needs_attention');});
test('429 遵守 Retry-After，不循环压垮服务',async t=>{let calls=0;const f=fixture(t,async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'120'}});});f.box.enqueue(event);await f.box.flush();f.advance(110000);await f.box.flush();assert.equal(calls,1);f.advance(10001);await f.box.flush();assert.equal(calls,2);});
test('错误的 200 响应不算确认，六次后停止自动重试',async t=>{const f=fixture(t,async()=>new Response('{}'));f.box.enqueue(event);for(let i=0;i<6;i++){await f.box.flush();f.advance(400000);}assert.equal(f.store.read().outbox[0].state,'needs_attention');});
test('发送进程中断，租约过期后恢复同一事件',async t=>{const f=fixture(t,async()=>new Response('{"accepted":true}'));f.box.enqueue(event);f.store.transaction(s=>{Object.assign(s.outbox[0],{state:'sending',leaseUntil:f.config.clock()+60000});});assert.equal((await f.box.flush()).sent,0);f.advance(60001);assert.equal((await f.box.flush()).sent,1);});
test('并发发送不会双领同一回执',async t=>{let calls=0;const f=fixture(t,async()=>{calls++;await new Promise(r=>setTimeout(r,20));return new Response('{"accepted":true}');});f.box.enqueue(event);await Promise.all([f.box.flush(),new WorkflowReceiptOutbox(f.store,f.config).flush()]);assert.equal(calls,1);});
