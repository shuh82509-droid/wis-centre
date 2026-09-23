import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
export async function startFixture() {
  const modules=['creative-radar','ai-first-creation','material-workbench','cloud-manager','data-dashboard'];
  const members=[['director','测试总监','director','品牌营销部'],['manager','测试主管','manager','品牌营销部'],
    ['specialist','测试专员','specialist','品牌营销部'],['external','测试外部成员','specialist','其他部门']]
    .map(([id,name,role,department])=>({identifier:'number:FD-QA-'+id.toUpperCase(),user_number:'FD-QA-'+id.toUpperCase(),
      real_name:name,department,center:'视频中心',login_active:true,access_mode:'all',modules,
      configured:true,role,version:1,editable:true}));
  const authority=createServer(async(req,res)=>{
    const who=/^qa=(admin|director|manager|specialist|external|anonymous)$/.exec(req.headers.cookie||'')?.[1] || 'admin';
    const admin=who==='admin';
    const member=members.find(row=>row.user_number.endsWith(who.toUpperCase())) || members[0];
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const path=decodeURIComponent(req.url.split('?')[0]);
    if(path==='/central-auth/me')return send(who==='anonymous'?401:200,{user:admin?{number:'FD-026222',realName:'舒豪',department:'品牌营销部',center:'AI营销中心'}:
      {number:member.user_number,realName:member.real_name,department:member.department,center:member.center},
      permissions:{manage_permissions:admin,operation_admin:admin,super_admin:admin},access:{master_access:true,allowed_modules:modules,modules:modules.map(key=>({key,label:key,purpose:key})),workspace_profile:admin?null:member}});
    if(path==='/admin/workspace-profiles')return send(admin?200:403,{items:members,centers:['视频中心'],catalog:[]});
    if(path==='/admin/module-access')return send(admin?200:403,{items:members,total:members.length,modules:modules.map(key=>({key,label:key,purpose:key==='data-dashboard'?'经营情况总览':key})),default_mode:'all'});
    if(path.startsWith('/admin/module-access/') && req.method==='PUT') {
      if(!admin)return send(403,{});
      const row=members.find(item=>item.identifier===path.slice('/admin/module-access/'.length));
      let raw='';for await(const chunk of req)raw+=chunk;
      const data=JSON.parse(raw);if(row)Object.assign(row,{access_mode:data.access_mode,modules:data.modules});
      return send(row?200:404,row||{});
    }
    if(path==='/admin/operation-logs')return send(admin?200:403,{items:[],total:0,modules:[]});
    if(path==='/assistant/status')return send(200,{configured:false});
    return send(200,{items:[],total:0});
  });
  await new Promise(done=>authority.listen(0,'127.0.0.1',done));
  const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));
  const port=probe.address().port;await new Promise(done=>probe.close(done));
  const dir=await mkdtemp(join(tmpdir(),'wis-entry-http-'));
  const hub=spawn(process.execPath,[resolve('server.mjs')],{env:{...process.env,PORT:String(port),DATA_DIR:dir,
    CENTRAL_AUTH_SESSION_BASE:'',CENTRAL_AUTHORITY_BASE:`http://127.0.0.1:${authority.address().port}`,RELEASE_ID:'isolated-entry-test'},stdio:'ignore'});
  for(let i=0;i<80;i++) {try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const url=`http://127.0.0.1:${port}`;
  return {url,dir,members,async request(path,who='admin',body,method) {
    const result=await fetch(url+path,{method:method||(body?'PUT':'GET'),headers:{Cookie:'qa='+who,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:result.status,body:await result.json()};
  },async close(){hub.kill();if(hub.exitCode===null)await new Promise(done=>hub.once('exit',done));await new Promise(done=>authority.close(done));await rm(dir,{recursive:true,force:true});}};
}
if(process.argv.includes('--serve')) {
  const fixture=await startFixture();
  console.log(JSON.stringify({url:fixture.url,identity:'isolated synthetic test only',data:fixture.dir}));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await fixture.close();process.exit(0);});
}
