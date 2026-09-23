// Real HTTP middleware and session composition against an isolated authority.
// No production login, grant, task, or external message is created here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const all=['data-dashboard','material-incentive','creative-hub','creative-radar','ai-first-creation','material-workbench','cloud-manager','live-room-management','workflow-engine'];
const session=(number, highest=false, selected=['material-workbench'], extra={})=>({
 user:{number,realName:'隔离核验'+number,department:highest?'AI效率流程部':'品牌营销部',center:'AI营销中心'},
 permissions:{super_admin:false,manage_permissions:highest,operation_admin:highest},
 access:{master_access:true,access_mode:'selected',configured:true,allowed_modules:selected,modules:all.map(key=>({key,label:key})),...extra},
});

test('最高权限、指定模块、流程引擎与真实权限预览使用同一门禁',async t=>{
 const root=resolve(tmpdir()),dir=mkdtempSync(join(root,'hub-module-permission-'));
 const sessions={highest:session('FD-QA-HIGH',true,[]), staff:session('FD-QA-STAFF'),
  empty:session('FD-QA-EMPTY',false,[]), engine:session('FD-QA-ENGINE',false,['workflow-engine','material-workbench']),
  manager:session('FD-QA-MANAGER',false,['workflow-engine','cloud-manager'],{workspace_profile:{configured:true,role:'manager',center:'视频中心',version:1}}),
  all:session('FD-QA-ALL',false,all,{access_mode:'all'}),
  defaultAll:session('FD-QA-DEFAULT',false,all,{access_mode:'all',configured:false}),
  defaultEmpty:session('FD-QA-DEFAULT-EMPTY',false,[],{access_mode:'all',configured:false}),
  revoked:session('FD-QA-REVOKED',true,[])};
 const row={identifier:'number:FD-QA-STAFF',user_number:'FD-QA-STAFF',real_name:'隔离核验FD-QA-STAFF',department:'品牌营销部',center:'AI营销中心',
   login_active:true,configured:false,module_configured:true,module_access_mode:'selected',modules:['material-workbench']};
 const authority=createServer(async(req,res)=>{
  const actor=String(req.headers.cookie||'').replace('qa=','');
  const url=new URL(req.url,'http://127.0.0.1');
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/central-auth/me')return sessions[actor]?send(200,sessions[actor]):send(401,{detail:'isolated unauthorized'});
  if(url.pathname==='/admin/workspace-profiles')return send(sessions[actor]?.permissions.manage_permissions?200:403,{items:[row]});
  if(url.pathname==='/admin/module-access/revoke-highest'&&req.method==='PUT'){
   sessions.revoked=session('FD-QA-REVOKED',false,['material-workbench']);return send(200,{ok:true});
  }
  return send(404,{});
 });
 await new Promise(done=>authority.listen(0,'127.0.0.1',done));
 const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
 const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{
  env:{...process.env,PORT:String(port),BIND_ADDRESS:'127.0.0.1',DATA_DIR:dir,WORKFLOW_WRITES_ENABLED:'false',
   CENTRAL_AUTHORITY_BASE:`http://127.0.0.1:${authority.address().port}`,ROOT_DASHBOARD_API_BASE:`http://127.0.0.1:${authority.address().port}`},stdio:'ignore'});
 t.after(async()=>{child.kill();await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));await new Promise(done=>authority.close(done));assert.ok(resolve(dir).startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=async(path,actor='staff',method='GET')=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Cookie:'qa='+actor,'Content-Type':'application/json'},redirect:'manual',...(method==='PUT'?{body:'{}'}:{})});return{status:r.status,body:await r.json().catch(()=>null)};};
 for(let i=0;i<80;i++){try{if((await call('/health')).status===200)break;}catch{}await new Promise(done=>setTimeout(done,50));}
 await t.test('最高权限账号保持自身身份和非超级管理员标记，但拥有完整导航和部门视角',async()=>{
  const value=(await call('/api/session','highest')).body;
  assert.equal(value.user.number,'FD-QA-HIGH');assert.equal(value.user.department,'AI效率流程部');assert.equal(value.permissions.super_admin,false);
  assert.equal(value.workspace.role,'director');assert.equal(value.workspace.dashboard_scope,'department');assert.equal(value.workspace.can_view_organization_dashboard,true);
  assert.deepEqual(new Set(value.access.allowed_modules),new Set(all));
  assert.equal((await call('/api/flows/catalog','highest')).status,200);
  assert.equal((await call('/api/flows/blueprints','highest')).status,200);
  assert.equal((await call('/api/permission-preview','highest')).status,200);
 });
 await t.test('指定单模块与空选择不被中心默认或公共雷达覆盖',async()=>{
  assert.deepEqual((await call('/api/session')).body.access.allowed_modules,['material-workbench']);
  assert.deepEqual((await call('/api/session','empty')).body.access.allowed_modules,[]);
  for(const path of ['/api/launch/creative-radar','/api/launch/cloud-manager','/api/launch/workflow-engine','/api/flows/overview','/api/flows/runs/task_abc/attachments/attachment_00000000000000000000000000000000/content'])assert.equal((await call(path)).status,403,path);
  assert.equal((await call('/api/launch/material-workbench')).status,302);
 });
 await t.test('全部界面配置不被专员中心默认裁剪，也不提升其角色',async()=>{
  const value=(await call('/api/session','all')).body;
  assert.deepEqual(new Set(value.access.allowed_modules),new Set(all));assert.equal(value.workspace.role,'specialist');
  assert.equal((await call('/api/flows/catalog','all')).status,403);
 });
 await t.test('流程引擎单独开放后专员只可读取个人任务，不可读编排全景',async()=>{
  const response=await call('/api/flows/overview','engine');assert.equal(response.status,200);assert.equal(response.body.access.canManage,false);
  assert.equal((await call('/api/flows/catalog','engine')).status,403);assert.equal((await call('/api/flows/blueprints','engine')).status,403);
  assert.equal((await call('/api/organization-dashboard/overview','engine')).status,403);
 });
 await t.test('未单独配置的成员使用中央默认权限，中心映射不再二次裁剪或补权',async()=>{
  const value=(await call('/api/session','defaultAll')).body;
  assert.deepEqual(new Set(value.access.allowed_modules),new Set(all));
  assert.equal(value.workspace.role,'specialist');
  assert.equal((await call('/api/flows/catalog','defaultAll')).status,403);
  assert.deepEqual((await call('/api/session','defaultEmpty')).body.access.allowed_modules,[]);
  assert.equal((await call('/api/launch/creative-radar','defaultEmpty')).status,403);
 });
 await t.test('主管仍只拥有指定模块和本中心范围',async()=>{
  const value=(await call('/api/session','manager')).body;
  assert.equal(value.workspace.dashboard_scope,'center');assert.equal(value.workspace.center,'视频中心');
  assert.deepEqual(value.access.allowed_modules,['workflow-engine','cloud-manager']);assert.equal((await call('/api/flows/catalog','manager')).status,200);
 });
 await t.test('同事预览使用当前已保存模块，不复活旧映射或公共雷达',async()=>{
  const result=await call('/api/permission-preview/candidates?q=FD-QA-STAFF','highest');
  const person=result.body.items.find(item=>item.userNumber==='FD-QA-STAFF');assert.deepEqual(person.allowedModules,['material-workbench']);
 });
 await t.test('取消最高权限后同一会话在保存返回后立即恢复原指定模块门禁',async()=>{
  assert.equal((await call('/api/flows/catalog','revoked')).status,200);
  assert.equal((await call('/api/permissions/modules/revoke-highest','highest','PUT')).status,200);
  const value=(await call('/api/session','revoked')).body;assert.equal(value.permissions.manage_permissions,false);assert.deepEqual(value.access.allowed_modules,['material-workbench']);
  assert.equal((await call('/api/flows/catalog','revoked')).status,403);assert.equal((await call('/api/permission-preview','revoked')).status,403);
 });
});
