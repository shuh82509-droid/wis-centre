import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProductionSources} from './flow-production-sources.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {WorkflowStore} from './workflow-store.mjs';
import {verifiedSources,heartbeatSources} from './source-sync-state.mjs';

test('active snapshot mirror and Git idle guards keep source fresh with fewer writes', async t => {
  const dir=mkdtempSync(join(tmpdir(),'wis-active-merge-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let now=Date.parse('2026-09-24T03:00:00Z');
  const owner={number:'FD-1',name:'负责人',center:'直播中心',active:true,role:'manager',
    modules:['workflow-engine','material-workbench','cloud-manager']};
  const sources={people:()=>[owner]},store=new WorkflowStore(join(dir,'task-center.json'));
  const runtime=new FlowRuntime(store,{people:()=>sources.people(),canNotify:()=>true,clock:()=>now});
  const path=join(dir,'source-snapshot.json'),mirror=new ProductionSources(runtime,sources,{file:path});
  const row={id:'source-1',title:'业务任务',owner:owner.number,version:'1',status:'待办理',
    steps:[{id:'W02.S1.E1',title:'准备',state:'pending'}]};
  const data={schemaVersion:1,people:[],baselines:{creative:[],remix:[],cloud:[]},
    creative:{records:[],users:[],actionsByRecord:{}},remix:{records:[row]},cloud:{records:[]},
    notificationsEnabled:true};
  const refresh=()=>{data.checkedAt=new Date(now).toISOString();writeFileSync(path,JSON.stringify(data));};
  const original=store.transaction.bind(store);let writes=0;
  store.transaction=mutate=>{writes++;return original(mutate);};
  refresh();await mirror.sync();const first=writes;
  assert.equal(store.read().tasks.length,1);
  assert.equal(store.read().flowNotifications.length,0);
  for(let i=0;i<3;i++){
    now+=5000;refresh();await mirror.sync();
    assert.equal(writes,first,'5s, 10s and 15s unchanged polls must not persist');
  }
  now+=5000;refresh();await mirror.sync();
  assert.equal(writes,first+1,'20s identical source renews one durable heartbeat');
  assert.equal(now-Date.parse(store.read().tasks[0].runtime.localBusiness.checkedAt),0);
  now+=5000;refresh();await mirror.sync();assert.equal(writes,first+1);
  now+=5000;refresh();await mirror.sync();
  assert.equal(writes,first+2,'30s full cooperative sync writes once');
  assert.equal(store.read().tasks.length,1);
  assert.equal(store.read().flowNotifications.length,0);

  now+=5000;row.status='已确认';refresh();await mirror.sync();
  assert.equal(store.read().tasks[0].runtime.localBusiness.status,'已确认');
  assert.equal(now-Date.parse(store.read().tasks[0].runtime.localBusiness.checkedAt),0);
  assert.equal(store.read().tasks.length,1);
});

test('heartbeat cannot renew a task changed after its last verified source read', () => {
  const since=Date.parse('2026-09-24T03:00:00Z');
  const task={id:'t1',version:7,runtime:{sourceKey:'source:remix:one',
    localBusiness:{signature:'sig',checkedAt:new Date(since).toISOString()}}};
  const state={tasks:[task],creativeWatches:[]},verified=verifiedSources(state,since);
  assert.equal(verified.size,1);
  task.version=8;
  assert.equal(heartbeatSources(state,verified,new Date(since+20000).toISOString()),0);
  assert.equal(task.runtime.localBusiness.checkedAt,new Date(since).toISOString());
});
