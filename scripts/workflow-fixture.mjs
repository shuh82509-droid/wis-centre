import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { signEvent } from '../workflow-http.mjs';

export const adapter={id:'fixture-video',secret:'local-test-only-not-production-secret-20260907',types:['delivery_receipt','business_feedback','asset_probe'],centers:['AI营销中心']};
const allModules=['data-dashboard','creative-hub','creative-radar','ai-first-creation','material-workbench','cloud-manager','live-room-management'];
export const sessions=Object.fromEntries([
  ['director','FD-026222','舒豪','见习总监','AI营销中心','品牌营销部'],
  ['manager','FD-022896','吴为','营销高级经理','AI营销中心','品牌营销部'],
  ['specialist','FD-QA-001','演练专员甲','营销专员','AI营销中心','品牌营销部'],
  ['specialist2','FD-QA-002','演练专员乙','营销专员','AI营销中心','品牌营销部'],
  ['outsider','FD-QA-003','其他中心演练账号','营销专员','视频中心','品牌营销部'],
  ['external','FD-QA-004','外部门演练账号','总监','AI营销中心','其他部门'],
].map(([role,number,realName,jobTitle,center,department])=>[role,{user:{number,realName,jobTitle,center,department},permissions:{super_admin:role==='director',operation_admin:role==='director',manage_permissions:role==='director'},access:{master_access:true,access_mode:'all',allowed_modules:allModules,modules:[]}}]));

export async function startFixture({defaultRole='manager',port=0,writesEnabled=true}={}) {
  const authority=createServer((req,res)=>{
    if(new URL(req.url,'http://localhost').pathname==='/assets/12') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:12,filename:'[演练] 云管家成片.mp4',object_key:'fixture/video.mp4',size:1234,modified_at:'2026-09-05T01:00:00',review_version:1,download_url:'https://example.test/fixture.mp4'}));return;}
    if(req.url==='/workflow/receipts/qianchuan/cloud-job-1') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'cloud-job-1',asset_id:12,advertiser_id:'account1',plan_id:'plan1',status:'success',platform_asset_id:'video1',binding_verified_at:'2026-09-05T02:00:00Z',binding_evidence:{matched_count:1,video_id:'video1',advertiser_id:'account1',plan_id:'plan1'}}));return;}
    if(req.url!=='/central-auth/me'){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"detail":"local fixture route not provided"}');return;}
    const role=String(req.headers.cookie || '').match(/dashboard_role=([^;]+)/u)?.[1] || defaultRole;
    res.writeHead(role==='expired'?401:200,{'Content-Type':'application/json'});res.end(JSON.stringify(sessions[role] || {detail:'登录已过期'}));
  });
  await new Promise(done=>authority.listen(0,'127.0.0.1',done));
  if(!port){const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));port=probe.address().port;await new Promise(done=>probe.close(done));}
  const dataDir=await mkdtemp(join(tmpdir(),'wis-workflow-http-'));
  const hub=spawn(process.execPath,[resolve('server.mjs')],{cwd:resolve('.'),env:{...process.env,BIND_ADDRESS:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir,CENTRAL_AUTHORITY_BASE:`http://127.0.0.1:${authority.address().port}`,CENTRAL_AUTH_SESSION_BASE:`http://127.0.0.1:${authority.address().port}`,WORKFLOW_AI_ENABLED:'false',WORKFLOW_WRITES_ENABLED:String(writesEnabled),WORKFLOW_ADAPTERS_JSON:JSON.stringify([adapter])},stdio:['ignore','pipe','pipe']});
  let logs='';hub.stdout.on('data',chunk=>logs+=chunk);hub.stderr.on('data',chunk=>logs+=chunk);
  const base=`http://127.0.0.1:${port}`;
  const close=async()=>{if(hub.exitCode===null){const exited=once(hub,'exit');hub.kill();await exited;}await new Promise(done=>authority.close(done));await rm(dataDir,{recursive:true,force:true});};
  try{
    let ready=false;for(let i=0;i<70;i++){try{if((await fetch(`${base}/health`)).ok){ready=true;break;}}catch{/* starting */}await new Promise(done=>setTimeout(done,100));}
    if(!ready)throw Error(`Local fixture did not start: ${logs}`);
  }catch(error){await close();throw error;}
  const request=async(path,role='manager',{body,method=body?'POST':'GET',headers={}}={})=>{
    const response=await fetch(`${base}${path}`,{method,headers:{Cookie:`dashboard_role=${role}`,...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
    return {status:response.status,payload:await response.json()};
  };
  const create=(body,role='manager',headers={})=>request('/api/task-center/tasks',role,{body:{sourceKind:'text',title:'[演练] 素材制作',...body},headers});
  const command=(task,action,body={},role='manager',headers={})=>request(`/api/task-center/tasks/${task.id}/${action}`,role,{method:action==='status'?'PATCH':'POST',body:{...body,expectedVersion:task.version},headers});
  const service=async(body,headers={})=>{const raw=JSON.stringify(body),timestamp=String(Date.now());const response=await fetch(`${base}/api/task-center/events`,{method:'POST',headers:{'Content-Type':'application/json','x-workflow-adapter':adapter.id,'x-workflow-timestamp':timestamp,'x-workflow-signature':signEvent(adapter.secret,timestamp,raw),...headers},body:raw});return {status:response.status,payload:await response.json()};};
  return {base,port,dataDir,request,create,command,service,close};
}

export async function seedFixture(f) {
  const ensure=result=>{if(result.status>=300)throw Error(JSON.stringify(result));return result.payload;};
  let task=ensure(await f.create({title:'[演练] 黑晶面膜开头二创',description:'基于已审核母版，准备两个不同开头。仅为候选界面演练，不使用真实素材或推送。',workflow:'02'}));
  task=ensure(await f.command(task,'claim',{},'specialist'));
  task=ensure(await f.command(task,'output',{url:'https://example.test/demo-video',assetId:'演练资产-01',assetVersion:'v1',summary:'示例交付记录，不是真实成片'},'specialist'));
  task=ensure(await f.command(task,'status',{status:'pending_review'},'specialist'));
  ensure(await f.create({title:'[演练] 每日经营异常核对',sourceKind:'business_anomaly',sourceUrl:'https://example.test/daily',workflow:'05',acceptance:'核对业务日期与数据口径，提出有来源的改进建议。'}));
  ensure(await f.create({title:'[演练] 直播场次素材准备',workflow:'04',description:'整理场次素材需求，执行后提交复盘记录。'}));
  ensure(await f.create({title:'[演练] 待评估的视频方向',sourceKind:'creative_radar',sourceUrl:'https://example.test/radar',workflow:'00'}));
  return task;
}
