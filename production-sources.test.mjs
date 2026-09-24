import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourcePeople} from './service-source-records.mjs';
import {ProductionSources} from './flow-production-sources.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {WorkflowStore} from './workflow-store.mjs';
import {SourceBusinessBridge} from './flow-source-business.mjs';

test('external collaborator requires explicit participation scope and real active OA grant; module denials stay effective',()=>{
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE oa_access_grants(identifier TEXT,real_name TEXT,user_number TEXT,department TEXT,center TEXT,active INTEGER);CREATE TABLE workspace_role_grants(identifier TEXT,role TEXT,center TEXT);CREATE TABLE module_access_grants(identifier TEXT,access_mode TEXT,modules TEXT);INSERT INTO oa_access_grants VALUES('cui','崔经瀚','FD-227829','AI效率流程部','AI中心',1);INSERT INTO module_access_grants VALUES('cui','selected','["workflow-engine","creative-hub"]');`);
 assert.equal(sourcePeople(db)[0].flowEligible,false);assert.equal(sourcePeople(db,['FD-227829'])[0].flowEligible,true);assert.equal(sourcePeople(db,['FD-227829'])[0].role,'specialist');
 db.exec("UPDATE module_access_grants SET modules='[\"creative-hub\"]'");assert.equal(sourcePeople(db,['FD-227829'])[0].flowEligible,false);
 db.exec('DELETE FROM module_access_grants');assert.equal(sourcePeople(db,['FD-227829'])[0].flowEligible,true);assert.ok(sourcePeople(db,['FD-227829'])[0].modules.includes('creative-hub'));db.exec("INSERT INTO module_access_grants VALUES('number:FD-227829','selected','[]')");assert.equal(sourcePeople(db,['FD-227829'])[0].flowEligible,false);
 db.exec('UPDATE oa_access_grants SET active=0');assert.deepEqual(sourcePeople(db,['FD-227829']),[]);db.close();
});
test('production mirror baselines old records, imports new review once, and preserves source-only actions',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wis-production-sources-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const person={number:'FD-227829',name:'崔经瀚',center:'AI中心',role:'specialist',active:true,modules:['workflow-engine','creative-hub','material-workbench','cloud-manager'],source:'verified_oa_grant'};
 const sources={people:()=>[]};const store=new WorkflowStore(join(dir,'tasks.json'));const r=new FlowRuntime(store,{people:()=>sources.people(),canNotify:()=>true});
 const file=join(dir,'snapshot.json');const integration=new ProductionSources(r,sources,{file,externalNumbers:['FD-227829']});
 const draft=id=>({id,title:'测试脚本',creatorId:'U',teamLeadReviewerId:'U',supervisorReviewerId:'U',currentReviewerId:'U',status:'pending_team_lead',version:1,updatedAt:new Date().toISOString()});
 const data={schemaVersion:1,checkedAt:new Date().toISOString(),people:[person],baselines:{creative:['old'],cloud:[],remix:[]},creative:{records:[draft('old'),draft('new')],users:[{id:'U',employeeNo:person.number,name:person.name,active:true,role:'contributor'}],actionsByRecord:{}},cloud:{records:[]},remix:{records:[]},notificationsEnabled:true};
 writeFileSync(file,JSON.stringify(data));await integration.sync();await integration.sync();const tasks=store.read().tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].runtime.creative.recordId,'new');assert.equal(tasks[0].runtime.creative.local,false);assert.equal(tasks[0].runtime.creative.automatic,true);assert.equal(store.read().flowNotifications.length,0);
 assert.equal(sources.people()[0].role,'specialist');
 const a={enabled:true,canManage:true,department:true,modules:person.modules,user:person};assert.throws(()=>r.command(a,tasks[0].id,'complete',{expectedVersion:tasks[0].version,nodeId:tasks[0].runtime.nodes[1].id},'test-command-1'),/原创意工作台/);
 data.checkedAt='2020-01-01T00:00:00Z';writeFileSync(file,JSON.stringify(data));await integration.sync();assert.deepEqual(sources.people(),[]);assert.equal(store.read().tasks.length,1);
});
test('source candidate reading does not expose another creator to a source contributor',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wis-source-acl-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const r=new FlowRuntime(new WorkflowStore(join(dir,'tasks.json')),{people:()=>[]});const s=new ProductionSources(r,{people:()=>[]},{file:join(dir,'none')});
 s.snapshot={checkedAt:new Date().toISOString(),baselines:{creative:[]},creative:{users:[{id:'A',employeeNo:'FD-1',active:true,role:'contributor'},{id:'B',employeeNo:'FD-2',active:true,role:'contributor'}],records:[{id:'own',creatorId:'A'},{id:'other',creatorId:'B'}],actionsByRecord:{}}};
 assert.deepEqual((await s.readCreative({flowActorNumber:'FD-1'},'idea')).records.map(x=>x.id),['own']);await assert.rejects(s.readCreative({flowActorNumber:'FD-3'},'idea'),/有效身份/);
});
test('real remix return links one cloud review and unresolved group reviewers are not guessed',t=>{
 const dir=mkdtempSync(join(tmpdir(),'wis-business-handoff-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const p={number:'FD-1',name:'测试人',center:'中心',active:true,role:'manager',modules:['workflow-engine','material-workbench','cloud-manager']};const store=new WorkflowStore(join(dir,'tasks.json'));const r=new FlowRuntime(store,{people:()=>[p],canNotify:()=>true});r.serviceNotificationOwners=new Set(['remix','cloud']);const bridge=new SourceBusinessBridge(r);
 const render={id:'R',title:'成片',owner:p.number,version:'1',status:'已回传',steps:[{id:'W02.S1.E1',title:'生成',state:'completed'}]};
 const review={id:'C',title:'素材审核',owner:p.number,version:'1',status:'pending',upstreamRenderId:'R',steps:[{id:'W03.S1.E1',title:'审核',state:'ready',owner:p.number}]};const snapshot={baselines:{remix:[],cloud:[]},remix:{records:[render]},cloud:{records:[review]}};
 bridge.sync(snapshot);const before=store.read();const parent=before.tasks.find(t=>t.workflow==='02'),child=before.tasks.find(t=>t.workflow==='03');assert.equal(parent.runtime.handoff.taskId,child.id);assert.equal(child.runtime.parentTaskId,parent.id);bridge.sync(snapshot);assert.equal(store.read().flowEvents.length,before.flowEvents.length);
 assert.throws(()=>bridge.apply('cloud',{...review,id:'ambiguous',steps:[{...review.steps[0],owner:''}]}),/审核人尚未唯一指定/);assert.equal(store.read().tasks.length,2);
 assert.throws(()=>r.create({enabled:true,canManage:true,department:true,modules:p.modules,user:p},{workflow:'02',sourceKey:'source:remix:spoof'},'test-spoof-key'),/来源编号前缀/);
});
test('unchanged business sources skip idle writes but refresh within the 45-second notification gate',t=>{
 const dir=mkdtempSync(join(tmpdir(),'wis-business-idle-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-09-24T03:00:00Z');const p={number:'FD-1',name:'负责人',center:'直播中心',active:true,role:'manager',modules:['workflow-engine','material-workbench','cloud-manager']};
 const store=new WorkflowStore(join(dir,'tasks.json')),r=new FlowRuntime(store,{people:()=>[p],canNotify:()=>true,clock:()=>now}),bridge=new SourceBusinessBridge(r);
 const original=store.transaction.bind(store);let writes=0;store.transaction=fn=>{writes++;return original(fn);};
 const row={id:'source-1',title:'业务任务',owner:p.number,version:'1',status:'待办理',steps:[{id:'W02.S1.E1',title:'准备',state:'pending'}]};
 const snapshot={baselines:{remix:[],cloud:[]},remix:{records:[row]},cloud:{records:[]}};
 bridge.sync(snapshot);const first=writes,task=store.read().tasks[0];assert.ok(first>0);assert.equal(Date.parse(task.runtime.localBusiness.checkedAt),now);
 for(let i=0;i<3;i++){now+=5000;bridge.sync(snapshot);assert.equal(writes,first);}
 now+=5000;bridge.sync(snapshot);assert.equal(writes,first+1);assert.equal(now-Date.parse(store.read().tasks[0].runtime.localBusiness.checkedAt),0);
 now+=5000;row.status='已确认';bridge.sync(snapshot);assert.equal(writes,first+2);assert.equal(store.read().tasks[0].runtime.localBusiness.status,'已确认');
 now+=5000;bridge.sync({...snapshot,remix:{records:[]}});assert.equal(store.read().tasks[0].runtime.localBusiness.issue,'原记录暂不可读，保留最后核验状态');
 const missingWrites=writes;bridge.sync({...snapshot,remix:{records:[]}});assert.equal(writes,missingWrites);
 now+=5000;bridge.sync(snapshot);assert.equal(store.read().tasks[0].runtime.localBusiness.issue,undefined);assert.equal(now-Date.parse(store.read().tasks[0].runtime.localBusiness.checkedAt),0);
});
test('creative mirror skips unchanged polls but processes actions, owner changes and source recovery',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wis-creative-idle-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-09-24T03:00:00Z');
 const people=['FD-1','FD-2'].map((number,i)=>({number,name:'审核人'+i,center:'直播中心',role:'manager',active:true,modules:['workflow-engine','creative-hub']}));
 const sources={people:()=>people},store=new WorkflowStore(join(dir,'tasks.json'));
 const r=new FlowRuntime(store,{people:()=>sources.people(),canNotify:()=>true,clock:()=>now});
 const file=join(dir,'snapshot.json'),bridge=new ProductionSources(r,sources,{file});
 const row={id:'script-1',title:'直播脚本',creatorId:'U',teamLeadReviewerId:'U',supervisorReviewerId:'V',currentReviewerId:'U',status:'pending_team_lead',version:1,updatedAt:new Date(now).toISOString()};
 const data={schemaVersion:1,checkedAt:new Date(now).toISOString(),people:[],baselines:{creative:[],cloud:[],remix:[]},creative:{records:[row],users:[{id:'U',employeeNo:'FD-1',name:'审核人0',active:true,role:'contributor'},{id:'V',employeeNo:'FD-2',name:'审核人1',active:true,role:'contributor'}],actionsByRecord:{}},cloud:{records:[]},remix:{records:[]},notificationsEnabled:true};
 const refresh=()=>{data.checkedAt=new Date(now).toISOString();writeFileSync(file,JSON.stringify(data));};
 const original=store.transaction.bind(store);let writes=0;store.transaction=fn=>{writes++;return original(fn);};
 refresh();await bridge.sync();const first=writes,task=store.read().tasks[0];assert.ok(first>0);assert.equal(task.runtime.creative.local,false);
 for(let i=0;i<3;i++){now+=5000;refresh();await bridge.sync();assert.equal(writes,first);}
 now+=5000;refresh();await bridge.sync();assert.equal(writes,first+1);assert.equal(now-Date.parse(store.read().tasks[0].runtime.creative.checkedAt),0);
 now+=5000;data.creative.actionsByRecord[row.id]=[{id:'source-action-1',action:'review',createdAt:new Date(now).toISOString()}];refresh();await bridge.sync();assert.equal(writes,first+2);assert.ok(store.read().tasks[0].runtime.creative.actionIds.includes('source-action-1'));
 now+=5000;Object.assign(row,{status:'pending_supervisor',currentReviewerId:'V',version:2,updatedAt:new Date(now).toISOString()});refresh();await bridge.sync();assert.equal(store.read().tasks[0].runtime.nodes[2].owner.number,'FD-2');
 now+=5000;Object.assign(row,{supervisorReviewerId:'U',currentReviewerId:'U',version:3,updatedAt:new Date(now).toISOString()});refresh();await bridge.sync();assert.equal(store.read().tasks[0].runtime.nodes[2].owner.number,'FD-1');
 now+=5000;data.creative.records=[];refresh();await bridge.sync();assert.equal(store.read().tasks[0].runtime.creative.issue,'原任务已删除或暂不可读，保留最后核验状态');
 const missingWrites=writes;await bridge.sync();assert.equal(writes,missingWrites);
 now+=5000;data.creative.records=[row];refresh();await bridge.sync();assert.equal(store.read().tasks[0].runtime.creative.issue,undefined);assert.equal(now-Date.parse(store.read().tasks[0].runtime.creative.checkedAt),0);
 now+=5000;row.status='unknown_source_state';row.updatedAt=new Date(now).toISOString();refresh();await bridge.sync();assert.match(store.read().creativeWatches[0].issue,/尚未支持/);
 const invalidWrites=writes;await bridge.sync();assert.equal(writes,invalidWrites);
 now+=5000;row.status='pending_supervisor';row.updatedAt=new Date(now).toISOString();refresh();await bridge.sync();assert.equal(store.read().creativeWatches[0].issue,undefined);
});
