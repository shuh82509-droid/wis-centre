import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
let profile = {role:'specialist',center:'视频中心',configured:true,version:1};
const modules = ['ai-first-creation','cloud-manager','creative-radar'];
const user = {number:'FD-QA',realName:'角色配置测试',department:'品牌营销部',center:'AI营销中心'};
const row = () => ({identifier:'name:角色配置测试',real_name:user.realName,user_number:user.number,department:user.department,
  ...profile,modules,editable:true,login_active:true});
let saved = 0;
const authority=createServer(async(req,res)=>{
  const admin=req.headers.cookie==='qa=admin';
  const path=decodeURIComponent(req.url.split('?')[0]);
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(path==='/central-auth/me')return send(200,{user:admin?{number:'FD-026222',realName:'舒豪',department:'品牌营销部',center:'AI营销中心'}:user,
    permissions:{manage_permissions:admin},access:{master_access:true,allowed_modules:modules,workspace_profile:admin?null:profile}});
  if(path==='/admin/workspace-profiles'&&req.method==='GET')return send(admin?200:403,{items:[row()],centers:['AI营销中心','视频中心'],catalog:[]});
  if(path==='/admin/workspace-profiles/name:角色配置测试'&&req.method==='PUT'){
    if(!admin)return send(403,{});
    let data='';for await(const chunk of req)data+=chunk;
    const value=JSON.parse(data);assert.equal(value.version,profile.version);
    profile={...profile,...value,version:profile.version+1};saved++;
    return send(200,row());
  }
  return send(404,{});
});
await new Promise(done=>authority.listen(0,'127.0.0.1',done));
const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));
const port=probe.address().port;await new Promise(done=>probe.close(done));
const dir=await mkdtemp(join(tmpdir(),'wis-role-config-'));
const hub=spawn(process.execPath,[resolve('server.mjs')],{env:{...process.env,PORT:String(port),DATA_DIR:dir,CENTRAL_AUTHORITY_BASE:`http://127.0.0.1:${authority.address().port}`},stdio:'ignore'});
const request=async(path,admin=false,body)=>{
  const result=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'PUT':'GET',headers:{Cookie:admin?'qa=admin':'qa=member','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:result.status,body:await result.json()};
};
try {
  for(let i=0;i<60;i++){try{await fetch(`http://127.0.0.1:${port}/health`);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  let session=(await request('/api/session')).body;
  assert.equal(session.workspace.role,'specialist');assert.equal(session.workspace.center,'视频中心');
  assert.equal(session.workspace.home,'personal');assert.equal(session.workspace.can_view_organization_dashboard,false);
  assert.deepEqual(session.access.allowed_modules,modules);
  assert.equal((await request('/api/permissions/workspace-profiles')).status,403);
  assert.equal((await request('/api/organization-dashboard/overview')).status,403);
  const listing=await request('/api/permissions/workspace-profiles',true);
  assert.equal(listing.body.items[0].role,'specialist');
  let put=await request('/api/permissions/workspace-profiles/name:角色配置测试',true,{role:'manager',center:'视频中心',modules,version:1});
  assert.equal(put.status,200);assert.equal(saved,1);
  session=(await request('/api/session')).body;
  assert.equal(session.workspace.role,'manager');assert.equal(session.workspace.dashboard_scope,'center');
  assert.equal(session.workspace.center,'视频中心');assert.equal(session.permissions.manage_permissions,false);
  const candidates=await request('/api/permission-preview/candidates?q=角色配置测试',true);
  assert.equal(candidates.body.items[0].center,'视频中心');
  const preview=await request('/api/permission-preview',true,{scope:'personal',person:'角色配置测试'});
  assert.equal(preview.status,200);assert.equal(preview.body.subject.userNumber,'FD-QA');
  assert.equal((await request('/api/permissions/dashboard-scopes/name:角色配置测试',true,{scope:'department'})).status,410);
  assert.equal((await request('/api/permissions/workspace-profiles/name:角色配置测试',false,{role:'director'})).status,403);
  console.log(JSON.stringify({ok:true,checks:['real role homepage','configured center','module allowlist','specialist privacy','admin-only writes','cache invalidation','new member preview','legacy false-success removed']}));
}finally{hub.kill();await new Promise(done=>hub.once('exit',done));await new Promise(done=>authority.close(done));await rm(dir,{recursive:true,force:true});}
