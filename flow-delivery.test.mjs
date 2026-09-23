// Isolated filesystem and cloud stubs. No real OA identity, cloud upload,
// colleague notification or business acceptance is asserted by this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {WorkflowStore,WorkflowError} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {FlowDelivery} from './flow-delivery.mjs';
import {FlowEvidence} from './flow-evidence.mjs';
import {createFlowHandler} from './flow-http.mjs';
import {modules} from './flow-catalog.mjs';
import {assetSnapshot} from './workflow-cloud.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZFcAAAAASUVORK5CYII=','base64');
const textFile=Buffer.from('隔离交付文件：版本一\n来源和事实等待业务本人核验。\n','utf8');
const link={url:'https://example.invalid/isolated-proof',reference:'isolated-proof',version:'v1'};
const body=(extra={})=>({workflow:'02',mode:'simple',title:'隔离文件交付',acceptance:'文件完整并由指定人确认',sourceUrl:'',product:'晶润紧致眼膜',owner:'FILE-A',manager:'FILE-M',reviewer:'FILE-R',...extra});

function bytesRequest(bytes,{length=bytes.length,chunks,headers={}}={}) {
  const request=Readable.from(chunks||[bytes]);
  request.headers={...(length===null?{}:{'content-length':String(length)}),...headers};return request;
}
function fixture(t) {
  const tempRoot=resolve(tmpdir()),dir=mkdtempSync(join(tempRoot,'flow-delivery-isolated-'));
  t.after(()=>{assert.ok(resolve(dir).startsWith(tempRoot+sep));rmSync(dir,{recursive:true,force:true});});
  const people=[
    {number:'FILE-M',name:'隔离管理人',role:'manager',center:'文件测试'},
    {number:'FILE-A',name:'隔离交付人',role:'specialist',center:'文件测试'},
    {number:'FILE-R',name:'隔离审核人',role:'specialist',center:'文件测试'},
    {number:'FILE-N',name:'隔离无关人',role:'specialist',center:'文件测试'},
    {number:'FILE-X',name:'隔离异中心',role:'manager',center:'另一文件测试'},
  ].map(p=>({active:true,modules:Object.values(modules).filter(Boolean),...p}));
  const access=(number='FILE-M')=>{const user=people.find(p=>p.number===number);return {enabled:true,canManage:user.role==='manager',department:false,user,modules:user.modules};};
  const store=new WorkflowStore(join(dir,'tasks.json'));
  const runtime=new FlowRuntime(store,{people:()=>people,clock:()=>Date.parse('2026-09-09T01:00:00Z')});
  const cloud={calls:[],asset:{id:31,object_key:'private/isolated/sample.mp4',filename:'隔离样片.mp4',size:824,modified_at:'2026-09-09T00:00:00Z',category:'晶润紧致眼膜',mime_type:'video/mp4',uploaded_by_number:'FILE-A',uploaded_by_name:'隔离交付人',review_status:'pending',review_version:1},status:200};
  cloud.handler=async(_request,path)=>({status:cloud.status,payload:cloud.status!==200?{detail:'isolated cloud denied'}:path.startsWith('/facets')?{categories:[{name:'晶润紧致眼膜'},{name:''}]}:path.startsWith('/assets?')?{items:[structuredClone(cloud.asset)],total:1,page:1,page_size:30}:structuredClone(cloud.asset)});
  const readCloud=async(request,path,...args)=>{cloud.calls.push({request,path,args});return cloud.handler(request,path,...args);};
  const root=join(dir,'files'),delivery=new FlowDelivery({runtime,root,readCloud}),evidenceReader=new FlowEvidence({sources:{view:()=>({items:[]})},readCloud});
  let count=0;const key=()=> 'isolated-file-operation-'+(++count);
  const create=extra=>runtime.create(access(),body(extra),key());
  const node=task=>task.runtime.nodes.find(n=>n.state==='ready');
  const init=(task,bytes=textFile,filename='交付.txt',extra={})=>delivery.init(access(node(task).owner.number),task.id,{expectedVersion:task.version,nodeId:node(task).id,filename,size:bytes.length,sha256:hash(bytes),...extra},key());
  const upload=(task,row,bytes=textFile,who='FILE-A',options)=>delivery.upload(bytesRequest(bytes,options),access(who),task.id,row.attachmentId);
  const prepare=(task,evidence,who=node(task).owner.number)=>delivery.prepare({isolated:true},access(who),task.id,node(task).id,{expectedVersion:task.version,evidence});
  const complete=(task,evidence,verifiedEvidence=null,who=node(task).owner.number)=>runtime.command(access(who),task.id,'complete',{expectedVersion:task.version,nodeId:node(task).id,note:'隔离文件核验',...(evidence===undefined?{}:{evidence})},key(),{verifiedEvidence});
  return {dir,root,people,store,runtime,access,cloud,delivery,evidenceReader,key,create,node,init,upload,prepare,complete};
}
async function returnedAttachment(f){
  let task=f.create();const row=f.init(task);await f.upload(task,row);
  task=f.complete(task,[{attachmentId:row.attachmentId}],await f.prepare(task,[{attachmentId:row.attachmentId}]));
  task=f.runtime.command(f.access('FILE-R'),task.id,'return',{expectedVersion:task.version,nodeId:f.node(task).id,targetNodeId:task.runtime.nodes[0].id,note:'隔离退回：补充说明后重新审核'},f.key());
  return {task,row};
}

test('打开附件交付只读本地任务，不等待云目录且不把未读取标成连通',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task);await f.upload(task,row);
  f.cloud.handler=async()=>{throw Error('optional cloud must not be requested');};
  const result=await http(f)('GET','runs/'+task.id+'/delivery-options?nodeId='+f.node(task).id);
  assert.equal(result.status,200);assert.equal(f.cloud.calls.length,0);
  assert.deepEqual(result.body.attachments.map(a=>a.attachmentId),[row.attachmentId]);
  assert.equal(result.body.fileUpload.maxBytes,20*1024*1024);
  assert.equal(result.body.cloud.state,'not_requested');assert.equal(result.body.cloud.available,false);assert.deepEqual(result.body.cloud.categories,[]);
});

test('解耦目录不放宽任务权限，无关账号和不存在节点均不能读取附件选项',async t=>{
  const f=fixture(t),task=f.create(),call=http(f);
  for(const who of ['FILE-N','FILE-X'])assert.equal((await call('GET','runs/'+task.id+'/delivery-options?nodeId='+f.node(task).id,{who})).status,404);
  assert.equal((await call('GET','runs/'+task.id+'/delivery-options?nodeId=missing')).status,404);
  assert.equal(f.cloud.calls.length,0);
});

test('云分类按需读取，授权失败可重试且不阻塞本地交付或记为空成功',async t=>{
  const f=fixture(t),task=f.create(),call=http(f),before=structuredClone(f.store.read());
  f.cloud.status=403;let products=await call('GET','products');
  assert.equal(products.status,200);assert.equal(products.body.state,'authorization_required');assert.deepEqual(products.body.items,[]);assert.ok(products.body.detail);
  let options=await call('GET','runs/'+task.id+'/delivery-options?nodeId='+f.node(task).id);
  assert.equal(options.status,200);assert.equal(options.body.cloud.state,'not_requested');assert.equal(f.cloud.calls.length,1);
  f.cloud.status=200;products=await call('GET','products');
  assert.equal(products.body.state,'connected');assert.deepEqual(products.body.items.map(x=>x.value),['晶润紧致眼膜']);assert.equal(f.cloud.calls.length,2);
  for(const call of f.cloud.calls){const params=new URL('https://isolated.invalid'+call.path).searchParams;assert.equal(params.get('categories_only'),'true');assert.equal(params.get('asset_scope'),'marketing_video');assert.equal(call.args[0],'GET');}
  assert.deepEqual(f.store.read(),before);
});

test('审核沿用文件时再次核验字节，损坏后不允许完成或推进版本',async t=>{
  const f=fixture(t);let task=f.create();const row=f.init(task);await f.upload(task,row);
  task=f.complete(task,[{attachmentId:row.attachmentId}],await f.prepare(task,[{attachmentId:row.attachmentId}]));
  const good=await f.prepare(task,[]);assert.equal(good[0].attachmentId,row.attachmentId);
  const changed=Buffer.from(textFile);changed[0]^=1;writeFileSync(join(f.root,row.attachmentId),changed);
  const before=structuredClone(f.store.read());await assert.rejects(f.prepare(task,[]),e=>e.status===409);
  assert.deepEqual(f.store.read(),before);assert.equal(f.node(task).ownerRule,'reviewer');
});

test('接收沿用审核云素材时重新验证当前账号可读和同一版本',async t=>{
  const f=fixture(t);let task=f.create({receiver:'FILE-M'});
  const asset=await f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  task=f.complete(task,[{assetId:31,version:asset.version}],await f.prepare(task,[{assetId:31,version:asset.version}]));
  task=f.complete(task,[],await f.prepare(task,[]));assert.equal(f.node(task).ownerRule,'receiver');
  const before=structuredClone(f.store.read());f.cloud.asset.modified_at='2026-09-09T02:00:00Z';
  await assert.rejects(f.prepare(task,[]),e=>e.status===409);assert.deepEqual(f.store.read(),before);
  f.cloud.status=403;await assert.rejects(f.prepare(task,[]),e=>e.status===403);assert.deepEqual(f.store.read(),before);
});

test('真实 PNG 二进制 init→上传→完整性证据→完成；文件元数据不推进业务版本',async t=>{
  const f=fixture(t),task=f.create(),before=structuredClone(f.store.read());
  const row=f.init(task,png,'参考图.png');assert.equal(row.state,'pending');
  assert.equal(f.runtime.get(f.access(),task.id).version,task.version);
  assert.equal(f.store.read().flowEvents.length,before.flowEvents.length);assert.equal(f.store.read().flowNotifications.length,before.flowNotifications.length);
  const ready=await f.upload(task,row,png);assert.equal(ready.state,'ready');assert.equal(ready.sha256,hash(png));
  assert.equal(f.runtime.get(f.access(),task.id).version,task.version);
  assert.deepEqual(readFileSync(join(f.root,row.attachmentId)),png);
  const proof=await f.prepare(task,[{attachmentId:row.attachmentId}]);
  assert.equal(proof[0].source,'task_file_verified');assert.equal(proof[0].proofType,'human_delivery');assert.equal(proof[0].uploadedBy.number,'FILE-A');
  const done=f.complete(task,[{attachmentId:row.attachmentId}],proof);
  assert.equal(done.runtime.nodes[0].state,'completed');assert.equal(done.version,task.version+1);
  assert.equal(done.runtime.nodes[0].evidence[0].version,'sha256:'+hash(png));
});

test('文件名路径分隔被消除，实际存储使用随机附件 ID，下载不暴露服务端路径',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task,textFile,'../目录\\交付.txt');
  assert.ok(!/[\\/]/.test(row.filename));assert.match(row.attachmentId,/^attachment_[a-f0-9]{32}$/);
  await f.upload(task,row);assert.equal(f.delivery.content(f.access('FILE-R'),task.id,row.attachmentId).file,join(f.root,row.attachmentId));
  assert.ok(!JSON.stringify(row).includes(f.dir));assert.match(row.url,/\/api\/flows\/runs\/task_[a-f0-9]+\/attachments\/attachment_[a-f0-9]+\/content$/);
});

test('重复 init 与同文件新幂等键复用登记，完整上传重试不新增文件或变更业务版本',async t=>{
  const f=fixture(t),task=f.create(),request={expectedVersion:task.version,nodeId:f.node(task).id,filename:'交付.txt',size:textFile.length,sha256:hash(textFile)},key=f.key();
  const a=f.delivery.init(f.access('FILE-A'),task.id,request,key),b=f.delivery.init(f.access('FILE-A'),task.id,request,key),c=f.delivery.init(f.access('FILE-A'),task.id,request,f.key());
  assert.equal(a.attachmentId,b.attachmentId);assert.equal(a.attachmentId,c.attachmentId);
  assert.throws(()=>f.delivery.init(f.access('FILE-A'),task.id,{...request,filename:'另一个名字.txt'},key),e=>e.status===409);
  const first=await f.upload(task,a),second=await f.upload(task,a);assert.deepEqual(second,first);
  assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments.length,1);assert.equal(f.runtime.get(f.access(),task.id).version,task.version);
  assert.equal(readdirSync(f.root).length,1);
});

test('登记拒绝不支持扩展名、非法大小、非 SHA256 和陈旧任务版本且无附件残留',t=>{
  const f=fixture(t),task=f.create(),before=structuredClone(f.store.read());
  for(const changes of [{filename:'危险.html'},{filename:'视频.mp4'},{size:0},{size:20*1024*1024+1},{size:1.5},{sha256:'not-a-hash'},{expectedVersion:999}]){
    assert.throws(()=>f.init(task,textFile,'交付.txt',changes));assert.deepEqual(f.store.read(),before);
  }
});

test('错误长度、短传、超传或同大小错误 SHA 均保留 pending，可用原登记正确重试',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task,png,'参考.png');
  await assert.rejects(f.upload(task,row,png,'FILE-A',{length:png.length+1}),e=>e.status===400);
  await assert.rejects(f.upload(task,row,png.subarray(0,-1),'FILE-A',{length:null}),e=>e.status===409);
  await assert.rejects(f.upload(task,row,Buffer.concat([png,Buffer.from([1])]),'FILE-A',{length:null}),e=>e.status===413);
  const damaged=Buffer.from(png);damaged[damaged.length-1]^=1;
  await assert.rejects(f.upload(task,row,damaged),e=>e.status===409);
  assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments[0].state,'pending');assert.equal(existsSync(join(f.root,row.attachmentId)),false);
  assert.equal((await f.upload(task,row,png)).state,'ready');
});

test('扩展名与实际字节不符不保存；非法 UTF8 或含 NUL 文本拒绝',async t=>{
  const f=fixture(t),task=f.create();
  for(const [bytes,name] of [[textFile,'伪装.png'],[Buffer.from([0,65]),'坏文本.txt'],[Buffer.from([255,254]),'非UTF8.csv']]){
    const row=f.init(task,bytes,name);await assert.rejects(f.upload(task,row,bytes),e=>e.status===400);
    assert.equal(existsSync(join(f.root,row.attachmentId)),false);
  }
});

test('流读取中断无半个目标文件，使用原附件 ID 可以重新上传',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task),request=Readable.from((async function*(){yield textFile.subarray(0,6);throw Error('isolated network interrupted');})());
  request.headers={'content-length':String(textFile.length)};
  await assert.rejects(f.delivery.upload(request,f.access('FILE-A'),task.id,row.attachmentId),/isolated network interrupted/);
  assert.equal(existsSync(join(f.root,row.attachmentId)),false);
  assert.equal((await f.upload(task,row)).state,'ready');
});

test('文件落盘后元数据提交失败可原 ID 恢复，不删除文件也不复制新登记',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task),transaction=f.store.transaction.bind(f.store);
  f.store.transaction=()=>{throw new WorkflowError(503,'isolated metadata unavailable');};
  try{await assert.rejects(f.upload(task,row),e=>e.status===503);}finally{f.store.transaction=transaction;}
  assert.deepEqual(readFileSync(join(f.root,row.attachmentId)),textFile);
  assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments[0].state,'pending');
  assert.equal((await f.upload(task,row)).attachmentId,row.attachmentId);
  assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments.length,1);
});

test('写盘中途失败后必须能用同一附件 ID 恢复，不能被半个最终文件永久阻断',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task),original=fs.writeFileSync;let injected=false;
  fs.writeFileSync=(file,data,...args)=>{
    if(!injected&&typeof file==='number'&&Buffer.isBuffer(data)&&data.equals(textFile)){
      injected=true;original(file,data.subarray(0,6),...args);const error=Error('isolated partial disk write');error.code='EIO';throw error;
    }
    return original(file,data,...args);
  };
  syncBuiltinESMExports();
  try{await assert.rejects(f.upload(task,row),/isolated partial disk write/);}finally{fs.writeFileSync=original;syncBuiltinESMExports();}
  assert.equal(injected,true);assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments[0].state,'pending');
  const recovered=await f.upload(task,row);assert.equal(recovered.attachmentId,row.attachmentId);assert.equal(recovered.state,'ready');
  assert.deepEqual(readFileSync(join(f.root,row.attachmentId)),textFile);
});

test('读取上传字节期间节点完成时文件保留但不误记本节点已关联成功',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task),request=Readable.from((async function*(){yield textFile;f.complete(task,[link]);})());
  request.headers={'content-length':String(textFile.length)};
  await assert.rejects(f.delivery.upload(request,f.access('FILE-A'),task.id,row.attachmentId),e=>e.status===409);
  assert.deepEqual(readFileSync(join(f.root,row.attachmentId)),textFile);
  const latest=f.runtime.get(f.access(),task.id);assert.equal(latest.runtime.attachments[0].state,'pending');assert.equal(latest.runtime.nodes[0].evidence[0].reference,'isolated-proof');
});

test('管理人也不能替另一人继续上传，无关和异中心身份不能读私有任务附件',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task);
  for(const who of ['FILE-M','FILE-R','FILE-N','FILE-X'])await assert.rejects(f.upload(task,row,textFile,who),e=>[403,404].includes(e.status));
  await f.upload(task,row);
  assert.deepEqual(readFileSync(f.delivery.content(f.access('FILE-R'),task.id,row.attachmentId).file),textFile);
  for(const who of ['FILE-N','FILE-X'])assert.throws(()=>f.delivery.content(f.access(who),task.id,row.attachmentId),e=>e.status===404);
});

test('附件不能借其他任务 ID 上传、读取或完成节点',async t=>{
  const f=fixture(t),one=f.create(),two=f.create({title:'隔离第二任务'}),row=f.init(one);await f.upload(one,row);
  assert.throws(()=>f.delivery.content(f.access('FILE-A'),two.id,row.attachmentId),e=>e.status===404);
  await assert.rejects(f.delivery.upload(bytesRequest(textFile),f.access('FILE-A'),two.id,row.attachmentId),e=>e.status===404);
  await assert.rejects(f.prepare(two,[{attachmentId:row.attachmentId}]),e=>e.status===404);
  assert.equal(f.runtime.get(f.access(),two.id).version,two.version);
});

test('退回后的旧附件可下载作历史，未明确选择来源轮次时不能直接交付或继续旧上传',async t=>{
  const f=fixture(t);let task=f.create();const row=f.init(task);await f.upload(task,row);
  task=f.complete(task,[{attachmentId:row.attachmentId}],await f.prepare(task,[{attachmentId:row.attachmentId}]));
  task=f.runtime.command(f.access('FILE-R'),task.id,'return',{expectedVersion:task.version,nodeId:f.node(task).id,targetNodeId:task.runtime.nodes[0].id,note:'隔离退回补版本'},f.key());
  assert.deepEqual(readFileSync(f.delivery.content(f.access('FILE-R'),task.id,row.attachmentId).file),textFile);
  await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId}]),e=>e.status===409);
  await assert.rejects(f.upload(task,row),e=>e.status===409);
  const current=f.init(task);assert.notEqual(current.attachmentId,row.attachmentId);await f.upload(task,current);
  assert.equal((await f.prepare(task,[{attachmentId:current.attachmentId}]))[0].attempt,2);
  const options=await f.delivery.options({},f.access('FILE-A'),task.id,f.node(task).id);assert.deepEqual(options.attachments.map(r=>r.attachmentId),[current.attachmentId]);
  assert.deepEqual(options.previousAttachments.map(r=>r.attachmentId),[row.attachmentId]);
});

test('明确沿用旧附件完成第2轮：同一个文件ID、SHA和上传轮次，历史不改且审核重新办理',async t=>{
  const f=fixture(t),{task:returned,row}=await returnedAttachment(f),before=structuredClone(f.store.read()),call=http(f);
  const task=returned,node=f.node(task),option=await call('GET','runs/'+task.id+'/delivery-options?nodeId='+node.id);
  assert.equal(option.status,200);assert.deepEqual(option.body.attachments,[]);assert.equal(option.body.previousAttachments[0].reuseFromAttempt,1);
  const command={expectedVersion:task.version,nodeId:node.id,note:'隔离验收：核对后沿用第1轮文件，补充说明并重新审核',evidence:[{attachmentId:row.attachmentId,reuseFromAttempt:1}]},key=f.key();
  const response=await call('POST','runs/'+task.id+'/complete',{body:command,key});assert.equal(response.status,200);
  const done=response.body,evidence=done.runtime.nodes[0].evidence[0];
  assert.equal(evidence.attachmentId,row.attachmentId);assert.equal(evidence.attempt,1);assert.equal(evidence.sha256,hash(textFile));
  assert.deepEqual(evidence.attachmentReuse,{sourceNodeId:node.id,sourceAttempt:1,submittedAttempt:2});
  assert.deepEqual(done.runtime.nodes[0].history,task.runtime.nodes[0].history);assert.deepEqual(done.runtime.attachments,task.runtime.attachments);
  assert.equal(readdirSync(f.root).length,1);assert.deepEqual(readFileSync(join(f.root,row.attachmentId)),textFile);
  assert.equal(done.runtime.nodes[1].state,'ready');assert.equal(done.runtime.nodes[1].attempt,2);assert.equal(done.runtime.nodes[1].evidence.length,0);
  assert.equal(f.store.read().flowEvents.length,before.flowEvents.length+2);
  const retry=await call('POST','runs/'+task.id+'/complete',{body:command,key});assert.equal(retry.status,200);assert.equal(retry.body.version,done.version);
  const changed=await call('POST','runs/'+task.id+'/complete',{body:{...command,evidence:[{attachmentId:row.attachmentId,reuseFromAttempt:2}]},key});assert.equal(changed.status,409);
  const inherited=await f.prepare(done,[],'FILE-R');assert.deepEqual(inherited[0].attachmentReuse,evidence.attachmentReuse);
  assert.deepEqual(inherited[0].reusedFrom,{nodeId:node.id,attempt:2});
});

test('第3轮仍可明确选用第1轮原文件，来源轮次与本轮区分，第二轮历史保持不变',async t=>{
  const f=fixture(t);let {task,row}=await returnedAttachment(f);const refs=[{attachmentId:row.attachmentId,reuseFromAttempt:1}];
  task=f.complete(task,refs,await f.prepare(task,refs));
  task=f.runtime.command(f.access('FILE-R'),task.id,'return',{expectedVersion:task.version,nodeId:f.node(task).id,targetNodeId:task.runtime.nodes[0].id,note:'隔离第三轮补充'},f.key());
  const history=structuredClone(task.runtime.nodes[0].history),proof=await f.prepare(task,refs);
  assert.deepEqual(proof[0].attachmentReuse,{sourceNodeId:task.runtime.nodes[0].id,sourceAttempt:1,submittedAttempt:3});
  const done=f.complete(task,refs,proof);assert.deepEqual(done.runtime.nodes[0].history,history);assert.equal(done.runtime.attachments.length,1);assert.equal(done.runtime.attachments[0].attempt,1);
});

test('历史复用轮次必须明确且严格匹配，缺失、字符串、布尔、小数、当前或未来轮次均拒绝',async t=>{
  const f=fixture(t),{task,row}=await returnedAttachment(f),before=structuredClone(f.store.read());
  for(const marker of [undefined,null,false,true,'1',0,-1,1.5,2,3])await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId,...(marker===undefined?{}:{reuseFromAttempt:marker})}]),e=>e.status===409);
  assert.deepEqual(f.store.read(),before);
  const current=f.init(task);await f.upload(task,current);
  await assert.rejects(f.prepare(task,[{attachmentId:current.attachmentId,reuseFromAttempt:2}]),e=>e.status===409);
});

test('历史附件不能重绑其他节点或其他任务，即使来源轮次和文件哈希有效',async t=>{
  const f=fixture(t);let {task,row}=await returnedAttachment(f);const refs=[{attachmentId:row.attachmentId,reuseFromAttempt:1}];
  task=f.complete(task,refs,await f.prepare(task,refs));
  const before=structuredClone(f.store.read());await assert.rejects(f.prepare(task,refs,'FILE-R'),e=>e.status===409);assert.deepEqual(f.store.read(),before);
  const options=await f.delivery.options({},f.access('FILE-R'),task.id,f.node(task).id);assert.deepEqual(options.previousAttachments,[]);
  const other=f.create();await assert.rejects(f.prepare(other,refs),e=>e.status===404);
});

test('改派后新主责可沿用同节点原文件，旧上传人无办理权且不能借历史上传票写文件',async t=>{
  const f=fixture(t);let {task,row}=await returnedAttachment(f);
  task=f.runtime.command(f.access(),task.id,'assign',{expectedVersion:task.version,nodeId:f.node(task).id,owner:'FILE-N',note:'隔离改派给新的本节点主责'},f.key());
  const refs=[{attachmentId:row.attachmentId,reuseFromAttempt:1}];
  assert.equal((await f.prepare(task,refs,'FILE-N'))[0].uploadedBy.number,'FILE-A');
  assert.equal((await f.delivery.options({},f.access('FILE-N'),task.id,f.node(task).id)).previousAttachments.length,1);
  assert.deepEqual((await f.delivery.options({},f.access('FILE-A'),task.id,f.node(task).id)).previousAttachments,[]);
  assert.deepEqual(readFileSync(f.delivery.content(f.access('FILE-A'),task.id,row.attachmentId).file),textFile);
  await assert.rejects(f.prepare(task,refs,'FILE-A'),e=>e.status===403);
  await assert.rejects(f.upload(task,row,textFile,'FILE-M'),e=>e.status===403);
  await assert.rejects(f.upload(task,row,textFile,'FILE-N'),e=>e.status===403);
  await assert.rejects(f.prepare(task,refs,'FILE-X'),e=>e.status===404);
});

for(const damage of ['same-size','missing','truncated','pending'])test('历史附件 '+damage+' 时拒绝沿用，保留原记录且不推进流程',async t=>{
  const f=fixture(t),{task,row}=await returnedAttachment(f),file=join(f.root,row.attachmentId);
  if(damage==='same-size'){const changed=Buffer.from(textFile);changed[0]^=1;writeFileSync(file,changed);}
  if(damage==='missing')rmSync(file);
  if(damage==='truncated')writeFileSync(file,textFile.subarray(0,5));
  if(damage==='pending')f.store.transaction(s=>{s.tasks.find(t=>t.id===task.id).runtime.attachments[0].state='pending';return true;});
  const before=structuredClone(f.store.read());await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId,reuseFromAttempt:1}]),e=>e.status===409);assert.deepEqual(f.store.read(),before);
  if(damage==='pending')assert.deepEqual((await f.delivery.options({},f.access('FILE-A'),task.id,f.node(task).id)).previousAttachments,[]);
});

test('历史重选不允许继续旧ticket，即使附带复用标记也不修改原文件',async t=>{
  const f=fixture(t),{task,row}=await returnedAttachment(f),before=structuredClone(f.store.read()),call=http(f);
  const response=await call('PUT','runs/'+task.id+'/attachments/'+row.attachmentId+'/content',{bytes:textFile,headers:{'x-reuse-from-attempt':'1'}});
  assert.equal(response.status,409);assert.deepEqual(f.store.read(),before);assert.deepEqual(readFileSync(join(f.root,row.attachmentId)),textFile);
});
test('暂停任务不提供历史重选也不能交付，原历史文件仍可按原权限下载',async t=>{
  const f=fixture(t);let {task,row}=await returnedAttachment(f);
  task=f.runtime.command(f.access(),task.id,'pause',{expectedVersion:task.version,note:'隔离暂停保留原文件'},f.key());
  assert.deepEqual((await f.delivery.options({},f.access('FILE-A'),task.id,task.runtime.nodes[0].id)).previousAttachments,[]);
  await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId,reuseFromAttempt:1}]),e=>e.status===409);
  assert.deepEqual(readFileSync(f.delivery.content(f.access('FILE-A'),task.id,row.attachmentId).file),textFile);
});

test('历史文件混合云素材核验遇到并发改派时拒绝陈旧提交，原历史和附件不变',async t=>{
  const f=fixture(t),{task,row}=await returnedAttachment(f),asset=await f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  const original=f.cloud.handler;f.cloud.handler=async(...args)=>{f.runtime.command(f.access(),task.id,'assign',{expectedVersion:task.version,nodeId:f.node(task).id,owner:'FILE-A',note:'隔离并发修改版本'},f.key());return original(...args);};
  await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId,reuseFromAttempt:1},{assetId:31,version:asset.version}]),e=>e.status===409);
  const current=f.runtime.get(f.access(),task.id);assert.equal(current.version,task.version+1);assert.equal(current.runtime.nodes[0].state,'ready');assert.deepEqual(current.runtime.nodes[0].history,task.runtime.nodes[0].history);assert.deepEqual(current.runtime.attachments,task.runtime.attachments);
});

test('已落盘文件同大小被篡改或丢失，prepare 拒绝将原 SHA 当成功证据',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task);await f.upload(task,row);
  const file=join(f.root,row.attachmentId),changed=Buffer.from(textFile);changed[0]^=1;writeFileSync(file,changed);
  await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId}]),e=>e.status===409);
  await assert.rejects(f.upload(task,row),e=>e.status===409);assert.deepEqual(readFileSync(file),changed);
  rmSync(file);await assert.rejects(f.prepare(task,[{attachmentId:row.attachmentId}]),e=>e.status===409);
});

test('附件下载也核验 SHA，不能把同大小错误文件返回成历史批准附件',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task);await f.upload(task,row);
  const changed=Buffer.from(textFile);changed[0]^=1;writeFileSync(join(f.root,row.attachmentId),changed);
  assert.throws(()=>f.delivery.content(f.access('FILE-R'),task.id,row.attachmentId),e=>e.status===409);
});

test('任务 60 个登记上限包含 pending；相同已登记文件在上限仍可重试',t=>{
  const f=fixture(t),task=f.create();let first;
  for(let i=0;i<60;i++){const bytes=Buffer.from('isolated-file-'+i),row=f.init(task,bytes,'文件'+i+'.txt');if(!i)first=row;}
  assert.throws(()=>f.init(task,Buffer.from('overflow'),'超额.txt'),e=>e.status===409);
  assert.equal(f.init(task,Buffer.from('isolated-file-0'),'文件0.txt').attachmentId,first.attachmentId);
  assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments.length,60);
});

test('单文件 20MiB 与每任务 200MiB 边界精确执行，pending 也占保留容量',t=>{
  const f=fixture(t),task=f.create(),bytes=Buffer.alloc(20*1024*1024,65);
  for(let i=0;i<10;i++){bytes[0]=65+i;f.init(task,bytes,'容量'+i+'.txt');}
  assert.equal(f.runtime.get(f.access(),task.id).runtime.attachments.reduce((n,r)=>n+r.size,0),200*1024*1024);
  assert.throws(()=>f.init(task,Buffer.from('x'),'超额.txt'),e=>e.status===409);
  assert.equal(existsSync(f.root),false);
});

test('交付素材选择请求明确省略历史经营指标，原筛选分页与真实用户请求保持不变',async t=>{
  const f=fixture(t),task=f.create(),request={isolatedActor:'FILE-A'};
  for(const mineOnly of ['true','false']){
    const query=new URLSearchParams({nodeId:f.node(task).id,mineOnly,page:'2',q:'原始眼膜',category:'晶润紧致眼膜'});
    const result=await f.delivery.assets(request,f.access('FILE-A'),task.id,query),call=f.cloud.calls.at(-1),params=new URL('https://isolated.invalid'+call.path).searchParams;
    assert.equal(call.request,request);assert.equal(call.args[0],'GET');assert.equal(params.get('include_performance'),'false');assert.equal(params.get('mine_only'),mineOnly);
    assert.equal(params.get('page'),'2');assert.equal(params.get('page_size'),'30');assert.equal(params.get('sort'),'newest');assert.equal(params.get('q'),'原始眼膜');assert.equal(params.get('category'),'晶润紧致眼膜');
    assert.equal(result.items[0].assetId,'31');assert.equal(result.items[0].uploadedBy.number,'FILE-A');assert.equal(result.items[0].reviewStatus,'pending');assert.ok(result.items[0].version);
  }
});

test('轻量素材请求不扩大任务权限，非参与人不能触发任何云查询',async t=>{
  const f=fixture(t),task=f.create(),query=new URLSearchParams({nodeId:f.node(task).id,mineOnly:'false'});
  await assert.rejects(f.delivery.assets({},f.access('FILE-N'),task.id,query),e=>e.status===404);
  assert.equal(f.cloud.calls.length,0);
});

test('云素材按当前请求只读核验，保留真实文件版本和上传者，不伪装为自动批准',async t=>{
  const f=fixture(t),task=f.create(),request={isolatedActor:'FILE-A'};
  const asset=await f.delivery.resolveAsset(request,f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  assert.equal(f.cloud.calls[0].request,request);assert.equal(f.cloud.calls[0].path,'/assets/31?include_performance=false');assert.equal(f.cloud.calls[0].args[0],'GET');
  const proof=await f.prepare(task,[{assetId:31,version:asset.version}]);
  assert.equal(proof[0].source,'cloud_asset_verified');assert.equal(proof[0].proofType,'human_delivery');assert.equal(proof[0].reviewStatus,'pending');
  assert.equal(proof[0].uploadedBy.number,'FILE-A');assert.ok(!JSON.stringify(proof).includes('private/isolated/'));
  const done=f.complete(task,[{assetId:31,version:asset.version}],proof);assert.equal(done.runtime.nodes[0].evidence[0].reference,'cloud:31');
});

test('云素材文件变化、已删除或缺版本必须重新核验，不能沿用旧选择提交',async t=>{
  const f=fixture(t),task=f.create(),asset=await f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  f.cloud.asset.modified_at='2026-09-09T01:00:00Z';
  await assert.rejects(f.prepare(task,[{assetId:31,version:asset.version}]),e=>e.status===409);
  await assert.rejects(f.prepare(task,[{assetId:31}]),e=>e.status===409);
  f.cloud.asset.deleted_at='2026-09-09T02:00:00Z';
  await assert.rejects(f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31}),e=>e.status===409);
  assert.equal(f.runtime.get(f.access(),task.id).version,task.version);
});

async function legacyCloudDelivery(f,{etag='a'.repeat(32)+'-1'}={}) {
  if(etag)f.cloud.asset.etag=etag;
  const task=f.create({receiver:'FILE-M'}),asset=await f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  const legacy={...asset,version:assetSnapshot(f.cloud.asset).version,reference:'cloud:31'};
  delete legacy.versionScheme;
  return {task:f.complete(task,[{assetId:31,version:legacy.version}],[legacy]),legacy};
}

test('旧云交付的秒与微秒元数据漂移可通过原ETag确认，审核再接收不改历史凭证',async t=>{
  const f=fixture(t);let {task,legacy}=await legacyCloudDelivery(f);
  task=f.complete(task,[],await f.prepare(task,[]));
  f.cloud.asset.modified_at='2026-09-09T00:00:00.763000Z';
  f.cloud.asset.review_version=3;
  const before=structuredClone(f.store.read()),proof=await f.prepare(task,[]);
  assert.equal(proof[0].version,legacy.version);
  assert.equal(proof[0].modifiedAt,legacy.modifiedAt);
  assert.deepEqual(f.store.read(),before);
  const done=f.complete(task,[],proof);
  assert.equal(done.runtime.nodes.at(-1).state,'completed');
  assert.equal(done.runtime.nodes[0].evidence[0].version,legacy.version);
});

test('旧云凭证兼容仍拒绝ETag、尺寸、对象键或资产编号的真实变化',async t=>{
  for(const change of [{etag:'b'.repeat(32)+'-1'},{size:825},{object_key:'private/isolated/other.mp4'},{id:32},{etag:''}]){
    const f=fixture(t),{task}=await legacyCloudDelivery(f);
    Object.assign(f.cloud.asset,{modified_at:'2026-09-09T00:00:00.763000Z'},change);
    await assert.rejects(f.prepare(task,[]),error=>error.status===409);
    assert.equal(f.runtime.get(f.access(),task.id).version,task.version);
  }
});

test('无强ETag的旧云凭证仍要求原元数据精确相同',async t=>{
  for(const etag of [null,'W/"'+'a'.repeat(32)+'"']){
    const f=fixture(t),{task}=await legacyCloudDelivery(f,{etag});
    f.cloud.asset.modified_at='2026-09-09T00:00:00.763000Z';
    await assert.rejects(f.prepare(task,[]),error=>error.status===409);
  }
});

test('新云内容版本只在文件身份变化时改变，时间精度和审核状态不误阻断',async t=>{
  const f=fixture(t);f.cloud.asset.etag='a'.repeat(32)+'-1';
  let task=f.create();const selected=await f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  assert.equal(selected.versionScheme,'cloud-content-etag-v1');
  f.cloud.asset.modified_at='2026-09-09T00:00:00.763000Z';
  f.cloud.asset.review_status='approved';f.cloud.asset.review_version=10;
  const proof=await f.prepare(task,[{assetId:31,version:selected.version}]);
  assert.equal(proof[0].version,selected.version);
  assert.ok(!JSON.stringify(proof).includes('private/isolated/'));
  task=f.complete(task,[{assetId:31,version:selected.version}],proof);
  f.cloud.asset.etag='b'.repeat(32)+'-1';
  await assert.rejects(f.prepare(task,[]),error=>error.status===409);
});

test('云权限失败不被记为空数据或提交成功，401/403/404 保持具体错误',async t=>{
  const f=fixture(t),task=f.create();
  for(const status of [401,403,404,500]){
    f.cloud.status=status;
    await assert.rejects(f.prepare(task,[{assetId:31,version:'isolated-old'}]),e=>e.status===(status===500?503:status));
    assert.equal(f.runtime.get(f.access(),task.id).version,task.version);
  }
  f.cloud.status=403;const products=await f.delivery.products({});assert.equal(products.state,'authorization_required');assert.deepEqual(products.items,[]);assert.ok(products.detail);
});

test('异步云核验期间任务变版时拒绝提交，保留原文件及新的任务状态',async t=>{
  const f=fixture(t),task=f.create(),asset=await f.delivery.resolveAsset({},f.access('FILE-A'),task.id,{nodeId:f.node(task).id,assetId:31});
  const original=f.cloud.handler;f.cloud.handler=async(...args)=>{f.runtime.command(f.access(),task.id,'assign',{expectedVersion:task.version,nodeId:f.node(task).id,owner:'FILE-A',note:'隔离并发更新'},f.key());return original(...args);};
  await assert.rejects(f.prepare(task,[{assetId:31,version:asset.version}]),e=>e.status===409);
  assert.equal(f.runtime.get(f.access(),task.id).version,task.version+1);assert.equal(f.runtime.get(f.access(),task.id).runtime.nodes[0].state,'ready');
});

function http(f) {
  return async(method,path,{who='FILE-A',body={},bytes,headers={},key=f.key()}={})=>{
    let result,responseHeaders;const chunks=[];
    const res=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});res.writeHead=(status,values)=>{result={status};responseHeaders=values;};
    const req=bytesRequest(bytes||Buffer.alloc(0));req.method=method;
    req.headers={...req.headers,'x-flow-request':'1','content-type':method==='PUT'?'application/octet-stream':'application/json',host:'isolated.invalid',origin:'https://isolated.invalid','idempotency-key':key,...headers};
    const handler=createFlowHandler({runtime:f.runtime,delivery:f.delivery,evidenceReader:f.evidenceReader,sources:{},notifier:{status:()=>({enabled:false})},currentSession:async()=>({status:200,payload:{isolatedFixture:true}}),accessFor:()=>f.access(who),previewFor:()=>({active:false}),readJson:async()=>body,sendJson:(_res,status,body)=>{result={status,body};}});
    await handler(req,res,new URL('https://isolated.invalid/api/flows/'+path));
    if(responseHeaders){await finished(res);result.headers=responseHeaders;result.bytes=Buffer.concat(chunks);}
    return result;
  };
}

test('完整 HTTP 二进制上传、下载、交付、审核沿用，不需要第二次上传',async t=>{
  const f=fixture(t),call=http(f);let task=f.create();
  let response=await call('POST','runs/'+task.id+'/attachments',{body:{expectedVersion:task.version,nodeId:f.node(task).id,filename:'验收参考.png',size:png.length,sha256:hash(png)}});
  assert.equal(response.status,201);const row=response.body;
  response=await call('PUT','runs/'+task.id+'/attachments/'+row.attachmentId+'/content',{bytes:png});assert.equal(response.status,200);assert.equal(response.body.state,'ready');
  response=await call('GET','runs/'+task.id+'/attachments/'+row.attachmentId+'/content',{who:'FILE-R'});
  assert.equal(response.status,200);assert.deepEqual(response.bytes,png);assert.equal(response.headers['X-Content-Type-Options'],'nosniff');assert.equal(response.headers['Cache-Control'],'private, no-store');
  assert.equal(response.headers['Content-Type'],'image/png');assert.equal(response.headers['Content-Length'],png.length);
  assert.equal(response.headers['Content-Disposition'],"attachment; filename*=UTF-8''"+encodeURIComponent('验收参考.png'));
  response=await call('POST','runs/'+task.id+'/complete',{body:{expectedVersion:task.version,nodeId:f.node(task).id,note:'隔离图片交付',evidence:[{attachmentId:row.attachmentId}]}});
  assert.equal(response.status,200);task=response.body;
  response=await call('POST','runs/'+task.id+'/complete',{who:'FILE-R',body:{expectedVersion:task.version,nodeId:f.node(task).id,note:'隔离审核确认'}});
  assert.equal(response.status,200);task=response.body;assert.equal(task.runtime.state,'completed');
  assert.equal(task.runtime.attachments.length,1);assert.equal(readdirSync(f.root).length,1);
  assert.equal(task.runtime.nodes[1].evidence[0].attachmentId,row.attachmentId);assert.equal(task.runtime.nodes[1].evidence[0].reusedFrom.nodeId,task.runtime.nodes[0].id);
  assert.equal(f.cloud.calls.length,0);
});

test('HTTP PUT 必须同源二进制标识，错误内容类型/跨站不能消费附件成功',async t=>{
  const f=fixture(t),task=f.create(),row=f.init(task),call=http(f),path='runs/'+task.id+'/attachments/'+row.attachmentId+'/content';
  for(const headers of [{'content-type':'application/json'},{origin:'https://another.invalid'},{'sec-fetch-site':'cross-site'},{'x-flow-request':'0'}]){
    assert.equal((await call('PUT',path,{bytes:textFile,headers})).status,403);assert.equal(existsSync(join(f.root,row.attachmentId)),false);
  }
});

for(const [workflow,rootNode] of [['02','W02.S4.E1'],['03','W03.S2.E1']])test('普通附件或云素材关联不能绕过 '+rootNode+' 业务根审核门槛',async t=>{
  const f=fixture(t),call=http(f);let task=f.create({workflow,mode:'standard'});
  while(f.node(task).id!==rootNode)task=f.complete(task,[link]);
  const row=f.init(task);await f.upload(task,row,textFile,f.node(task).owner.number);
  assert.equal(await f.prepare(task,[{attachmentId:row.attachmentId}]),null);
  for(const evidence of [[{attachmentId:row.attachmentId}],[{attachmentId:row.attachmentId,reuseFromAttempt:1}],[{assetId:31,version:'isolated-version'}]]){
    const response=await call('POST','runs/'+task.id+'/complete',{who:f.node(task).owner.number,body:{expectedVersion:task.version,nodeId:rootNode,note:'不能绕过根门槛',evidence}});
    assert.equal(response.status,400);assert.equal(f.runtime.get(f.access(),task.id).version,task.version);assert.equal(f.node(f.runtime.get(f.access(),task.id)).id,rootNode);
  }
});
