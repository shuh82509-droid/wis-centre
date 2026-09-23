import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {workflowSource} from './integrations/creative-workbench/lib/flow-workflow-source.mjs';
import {createCreativeReader} from './flow-creative-reader.mjs';
import {FlowCreative} from './flow-creative.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {WorkflowStore} from './workflow-store.mjs';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE creative_drafts(id TEXT PRIMARY KEY,title TEXT,product TEXT,status TEXT,version INTEGER,feedback TEXT,
 creator_id TEXT,uploader_id TEXT,author_user_id TEXT,team_lead_reviewer_id TEXT,supervisor_reviewer_id TEXT,current_reviewer_id TEXT,
 resume_stage TEXT,due_date TEXT,updated_at TEXT);
 CREATE TABLE workspace_users(id TEXT PRIMARY KEY,employee_no TEXT,name TEXT,center TEXT,active INTEGER);
 CREATE TABLE review_actions(id TEXT PRIMARY KEY,draft_id TEXT,action TEXT,stage TEXT,actor_id TEXT,actor_name TEXT,comment TEXT,version INTEGER,created_at TEXT);`);
 for(const n of ['A','L','M'])db.prepare('INSERT INTO workspace_users VALUES(?,?,?,?,1)').run('U'+n,n,n,'测试中心');
 const insert=db.prepare('INSERT INTO creative_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<125;i++)insert.run('draft-'+String(i).padStart(3,'0'),'测试脚本'+i,'测试产品','pending_team_lead',1,'','UA','UA','UA','UL','UM','UL','pending_team_lead','','2026-09-23T00:00:00.000Z');
 db.prepare('INSERT INTO review_actions VALUES(?,?,?,?,?,?,?,?,?)').run('a1','draft-000','submit','pending_team_lead','UA','作者','提交审核',1,'2026-09-23T00:00:00.000Z');
 // D1-shaped adapter backed by actual SQLite: execute real SQL, not query mocks.
 const d1={prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)})})})};
 const source=(path,user={id:'UM',employeeNo:'M',active:true},canManage=true)=>workflowSource({request:new Request('https://source.invalid'+path),db:d1,user,canManage});
 const reader=createCreativeReader({paths:{idea:'/idea/api/'},origin:'https://source.invalid',remoteGet:async(req,path)=>{const result=await source(path);return {status:result.status,payload:await result.json()};}});
 return {db,source,reader};
}
test('discovery paginates past 100 and exact-ID reads preserve older tasks with their source audit ledger',async t=>{
 const f=fixture(t),one=await(await f.source('/idea/api/workflow-source')).json();
 assert.equal(one.records.length,100);assert.equal(one.records.some(d=>d.id==='draft-000'),false);assert.ok(one.nextCursor);
 const two=await(await f.source('/idea/api/workflow-source?cursor='+encodeURIComponent(one.nextCursor))).json();assert.equal(two.records.length,25);assert.equal(two.nextCursor,null);
 assert.equal(new Set([...one.records,...two.records].map(r=>r.id)).size,125);
 const exact=await f.reader.read({headers:{},flowActorNumber:'M'},'idea',['draft-000']);assert.equal(exact.records[0].id,'draft-000');assert.equal(exact.actionsByRecord['draft-000'][0].action,'submit');assert.equal(exact.users.length,3);
 assert.equal(exact.records[0].content,undefined,'export excludes script content and unrelated profile data');
});
test('real source SQL connects and advances a task outside the latest page',async t=>{
 const f=fixture(t),dir=mkdtempSync(join(tmpdir(),'creative-source-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const people=['A','L','M'].map(number=>({number,name:number,center:'测试中心',role:number==='A'?'specialist':'manager',active:true,modules:['creative-hub']}));
 const a={enabled:true,canManage:true,user:people[2],modules:['creative-hub']};
 const runtime=new FlowRuntime(new WorkflowStore(join(dir,'tasks.json')),{people:()=>people});
 const creative=new FlowCreative(runtime,{readSource:f.reader.read,sourceUrl:f.reader.sourceUrl});
 const task=await creative.configure(a,{headers:{}},{source:'idea',recordId:'draft-000',manager:'M'},'source-sql-attach');assert.equal(task.runtime.nodes[1].state,'ready');
 f.db.exec("UPDATE creative_drafts SET status='approved',current_reviewer_id='',updated_at='2026-09-24T00:00:00.000Z' WHERE id='draft-000'");
 f.db.prepare('INSERT INTO review_actions VALUES(?,?,?,?,?,?,?,?,?)').run('a2','draft-000','approve','supervisor','UM','主管','通过',1,'2026-09-24T00:00:00.000Z');
 await creative.sync(a,{headers:{}});const actual=runtime.get(a,task.id);assert.equal(actual.runtime.state,'completed');assert.equal(actual.flowEvents.filter(e=>e.sourceEventId).length,2);
 await creative.sync(a,{headers:{}});assert.equal(runtime.store.read().tasks.length,1);assert.equal(runtime.get(a,task.id).flowEvents.filter(e=>e.sourceEventId).length,2);
});
test('source ACL applies equally to discovery and exact IDs; missing and forbidden records are indistinguishable',async t=>{
 const {source}=fixture(t),outsider={id:'UX',employeeNo:'X',active:true};
 for(const query of ['', '?id=draft-000','?id=nonexistent','?id=draft-000&canManage=true']){
  const data=await(await source('/idea/api/workflow-source'+query,outsider,false)).json();assert.deepEqual(data.records,[]);assert.deepEqual(data.users,[]);
 }
 const related=await(await source('/idea/api/workflow-source?id=draft-000',{id:'UA',employeeNo:'A',active:true},false)).json();assert.equal(related.records.length,1);
 assert.equal((await source('/idea/api/workflow-source',{id:'UM',employeeNo:'M',active:false},true)).status,403);
});
test('SQL parameters cannot change scope; malformed cursors and oversized batches fail; source query failures do not look empty',async t=>{
 const {source,db}=fixture(t);
 assert.deepEqual((await(await source('/idea/api/workflow-source?id='+encodeURIComponent("' OR 1=1 --"))).json()).records,[]);
 assert.equal((await source('/idea/api/workflow-source?cursor=invalid')).status,400);
 assert.equal((await source('/idea/api/workflow-source?'+Array.from({length:101},(_,i)=>'id='+i).join('&'))).status,400);
 assert.equal((await source('/idea/api/workflow-source?id=draft-000&cursor={}')).status,400);
 db.exec('DROP TABLE review_actions');assert.equal((await source('/idea/api/workflow-source?id=draft-000')).status,503);
});
test('reader batches more than 100 watched records without truncation and carries discovery cursors',async t=>{
 const f=fixture(t),req={headers:{},flowActorNumber:'M'};
 const all=await f.reader.read(req,'idea',Array.from({length:125},(_,i)=>'draft-'+String(i).padStart(3,'0')));assert.equal(all.records.length,125);
 const first=await f.reader.read(req,'idea');const second=await f.reader.read(req,'idea',[],{cursor:first.nextCursor});assert.equal(first.records.length+second.records.length,125);
});
