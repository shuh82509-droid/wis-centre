import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore,normalizeStore} from './workflow-store.mjs';

test('production v1 task shape retains identity, assignment, attachment and progress',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wis-v1-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'task-center.json');
  const task={id:'task_legacy_v1',center:'AI营销中心',kind:'formal',status:'in_progress',sourceKind:'text',sourceUrl:'',title:'legacy',description:'existing task',dueAt:'2026-09-03T04:41:00Z',assignee:{number:'FD-TEST',name:'Test'},attachment:null,externalNotificationState:'in_hub',createdBy:{number:'FD-OWNER',name:'Owner'},createdAt:'2026-09-02',updatedAt:'2026-09-03',events:[{action:'claim',by:'Test',byNumber:'FD-TEST',at:'2026-09-03'}]};
  const original=JSON.stringify({schemaVersion:1,pilotCenter:'AI营销中心',updatedAt:'2026-09-03',tasks:[task]});
  writeFileSync(file,original);
  const store=new WorkflowStore(file),old=store.read().tasks[0];
  for(const key of Object.keys(task))assert.deepEqual(old[key],task[key]);
  assert.deepEqual(old.assignees,[task.assignee]);assert.equal(old.version,1);assert.equal(old.legacyUnverified,false);
  assert.equal(readFileSync(file,'utf8'),original,'reading must not migrate the file');
  store.transaction(state=>{state.updatedAt='test';});
  assert.equal(JSON.parse(readFileSync(file)).schemaVersion,3);
  assert.equal(readFileSync(file+'.pre-v3.json','utf8'),original);
  store.transaction(()=>{});assert.equal(readFileSync(file+'.pre-v3.json','utf8'),original);
});
test('v1 completion is not platform proof and unknown schemas still fail closed',()=>{
  const migrated=normalizeStore({schemaVersion:1,tasks:[{id:'old',status:'completed'}]});
  assert.equal(migrated.tasks[0].legacyUnverified,true);
  for(const schemaVersion of [0,4,undefined])assert.throws(()=>normalizeStore({schemaVersion,tasks:[]}));
});
