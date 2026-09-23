// Isolated identities and files only; these tests are not real-role acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {FlowBlueprints} from './flow-blueprints.mjs';
import {modules} from './flow-catalog.mjs';
const env={HUB_INTEGRATED_MODE:'1',FLOW_PUBLIC_URL:'https://example.invalid/new/hub/workflow-panorama/'};
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'wis-handoff-origin-'));
 t.after(()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true});});
 const user={number:'QA',name:'Isolated manager',center:'A',role:'director',active:true,modules:Object.values(modules)};
 const a={enabled:true,canManage:true,department:true,user,modules:user.modules};
 const store=new WorkflowStore(join(dir,'tasks.json')),runtime=new FlowRuntime(store,{people:()=>[user],env});
 const blueprints=new FlowBlueprints(runtime);runtime.blueprints=blueprints;
 const body={workflow:'00',mode:'simple',title:'Isolated handoff',acceptance:'No business production',owner:'QA',manager:'QA',reviewer:'QA'};
 return {a,store,runtime,blueprints,body};
}
test('inline and later-configured handoffs use the deployed origin',t=>{
 const {a,runtime,body}=fixture(t),child={...body,workflow:'01'};
 const inline=runtime.create(a,{...body,handoff:child},'inline-handoff');
 let row=runtime.store.read().tasks.find(x=>x.id===inline.id);
 assert.equal(row.runtime.handoff.draft.sourceUrl,env.FLOW_PUBLIC_URL+'?task='+inline.id);
 const later=runtime.create(a,body,'later-handoff');
 runtime.configureHandoff(a,later.id,{...child,expectedVersion:later.version},'later-config');
 row=runtime.store.read().tasks.find(x=>x.id===later.id);
 assert.equal(row.runtime.handoff.draft.sourceUrl,env.FLOW_PUBLIC_URL+'?task='+later.id);
});
test('published automatic route creates one child with deployed origin and preserves source file reference',t=>{
 const {a,store,runtime,blueprints,body}=fixture(t),cfg=blueprints.default(a);
 cfg.moduleOrder=['00','01'];cfg.defaultRoute=true;
 blueprints.save(a,{config:cfg,expectedVersion:0},'publish-route',{publish:true});
 let task=runtime.create(a,body,'route-parent'),request,key;
 while(task.runtime.state==='running'){
  const n=task.runtime.nodes.find(n=>n.state==='ready');
  request={expectedVersion:task.version,nodeId:n.id,note:'Isolated confirmation',...(n.ownerRule==='owner'?{evidence:[{url:'https://example.invalid/source',reference:'source-v1',version:'v1'}]}:{})};
  key='complete-'+n.id;task=runtime.command(a,task.id,'complete',request,key);
 }
 runtime.command(a,task.id,'complete',request,key);
 assert.equal(store.read().tasks.length,2);
 const child=runtime.get(a,task.runtime.handoff.taskId);
 assert.equal(child.sourceUrl,env.FLOW_PUBLIC_URL+'?task='+task.id);
 assert.ok(child.runtime.handoffEvidence.some(e=>e.reference==='source-v1'));
});
test('integrated runtime fails closed for missing or unsafe public URL',()=>{
 for(const e of [{HUB_INTEGRATED_MODE:'1'},{...env,FLOW_PUBLIC_URL:'https://user:secret@example.invalid/workflow-panorama/'},{...env,FLOW_PUBLIC_URL:'javascript:alert(1)'},{...env,FLOW_PUBLIC_URL:'https://example.invalid/wrong/'}])
  assert.throws(()=>new FlowRuntime(null,{people:()=>[],env:e}));
});
