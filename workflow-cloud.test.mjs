import test from 'node:test';
import assert from 'node:assert/strict';
import { assetSnapshot, WorkflowCloudReader } from './workflow-cloud.mjs';
const access={enabled:true,canManage:false,user:{number:'owner',center:'AI营销中心'}};
const asset={id:12,object_key:'video.mp4',size:12,modified_at:'2026-09-05T01:00:00',review_version:1,download_url:'https://example.test/video'};
function fixture({assetChange={},receiptChange={},manual=false}={}) {
  const snapshot=assetSnapshot(asset),events=[],reads=[];
  const task={id:'task_test',version:1,center:'AI营销中心',kind:'formal',assignees:[{number:'owner'}],outputs:[{id:'out',assetId:'12',...(!manual?{cloudSnapshot:snapshot}:{})}],deliveries:[{id:'delivery',outputId:'out',assetId:'12',assetVersion:snapshot.version,platform:'qianchuan',accountId:'account',planId:'plan'}]};
  const receipt={id:'job',asset_id:12,advertiser_id:'account',plan_id:'plan',status:'success',platform_asset_id:'v',binding_verified_at:'2026-09-05T02:00:00Z',binding_evidence:{matched_count:1,video_id:'v'},...receiptChange};
  const engine={store:{read:()=>({tasks:[task]})},serviceEvent:event=>events.push(event)};
  const reader=new WorkflowCloudReader(engine,async(req,path,method)=>{reads.push({req,path,method});return {status:200,payload:path.startsWith('/assets/')?{...asset,...assetChange}:receipt};});
  const request={fixture:true};
  return {events,reads,run:()=>reader.reconcile(request,access,task.id,{expectedVersion:1,deliveryId:'delivery',cloudTaskId:'job'}),reader,task,request};
}
test('精确读取资产及任务，保留调用者身份，不发起推送',async()=>{const f=fixture();assert.equal((await f.run()).state,'succeeded');assert.deepEqual(f.reads.map(r=>r.path),['/assets/12?include_performance=false','/workflow/receipts/qianchuan/job']);assert.ok(f.reads.every(r=>r.method==='GET' && r.req===f.request));assert.equal(f.events[0].verified,true);});
for(const [label,changes] of [['任务编号',{id:'other'}],['资产',{asset_id:99}],['账号',{advertiser_id:'other'}],['计划',{plan_id:'other'}]]) test(`拒绝错配${label}`,async()=>{const f=fixture({receiptChange:changes});await assert.rejects(f.run,e=>e.status===409);assert.equal(f.events.length,0);});
test('内容变化拒绝旧审核，仅审核元数据更新不改变素材版本',async()=>{const f=fixture({assetChange:{modified_at:'2026-09-06T00:00:00'}});await assert.rejects(f.run,e=>e.status===409);assert.equal(f.reads.length,1);assert.equal(assetSnapshot({...asset,review_version:2}).version,assetSnapshot(asset).version);});
test('手填版本不能伪装成云端快照',async()=>{const f=fixture({manual:true});await assert.rejects(f.run,e=>e.status===409);assert.equal(f.reads.length,0);});
for(const changes of [{binding_verified_at:null},{platform_asset_id:undefined,binding_evidence:{matched_count:1}},{binding_evidence:{matched_count:0,video_id:'v'}},{binding_evidence:{matched_count:1,video_id:'other'}},{status:'submitted'}]) test(`证据不完整保留待核验 ${JSON.stringify(changes)}`,async()=>{const f=fixture({receiptChange:changes});assert.equal((await f.run()).state,'unknown');assert.equal(f.events[0].verified,false);});
test('无权查看任务时不查询资产服务',async()=>{const f=fixture();await assert.rejects(()=>f.reader.reconcile(f.request,{...access,user:{number:'other',center:'其他中心'}},f.task.id,{}),e=>e.status===404);assert.equal(f.reads.length,0);});
test('云端鉴权过期不变更任务也不自动重试',async()=>{const f=fixture();let calls=0;f.reader.read=async()=>{calls++;return {status:401};};await assert.rejects(f.run,e=>e.status===401);assert.equal(f.events.length,0);assert.equal(calls,1);});
test('每次查看重新取签名链接，素材版本变化拒绝展示',async()=>{const f=fixture();assert.equal(await f.reader.contentUrl(f.request,access,f.task.id,'out'),asset.download_url);await f.reader.contentUrl(f.request,access,f.task.id,'out');assert.equal(f.reads.length,2);const changed=fixture({assetChange:{size:99}});await assert.rejects(()=>changed.reader.contentUrl(changed.request,access,changed.task.id,'out'),e=>e.status===409);});

function automaticFixture(payload={items:[{id:'job'}],ambiguous:false}) {
  const f=fixture(),original=f.reader.read;
  f.reader.read=async(req,path,method,...rest)=>{
    if(path.startsWith('/workflow/receipt-candidates?')){f.reads.push({req,path,method});return {status:200,payload};}
    return original(req,path,method,...rest);
  };
  f.run=()=>f.reader.reconcile(f.request,access,f.task.id,{expectedVersion:1,deliveryId:'delivery'});
  return f;
}
test('唯一对应记录自动查找后再次读取精确回执，不写外部平台',async()=>{
  const f=automaticFixture();assert.equal((await f.run()).state,'succeeded');
  assert.equal(f.reads.length,3);assert.ok(f.reads.every(r=>r.method==='GET' && r.req===f.request));
  const q=new URL(f.reads[1].path,'https://test').searchParams;
  assert.deepEqual(Object.fromEntries(q),{platform:'qianchuan',asset_id:'12',account_id:'account',plan_id:'plan'});
  assert.equal(f.reads[2].path,'/workflow/receipts/qianchuan/job');
});
for(const [label,payload,status] of [
 ['无记录',{items:[],ambiguous:false},409],
 ['多条',{items:[{id:'one'},{id:'two'}],ambiguous:true},409],
 ['不完整分页',{items:[{id:'job'}],ambiguous:true},409],
 ['无明确完整性',{items:[{id:'job'}]},503],
 ['非法编号',{items:[{id:'../../push'}],ambiguous:false},400],
]) test(`自动核验 ${label} 不修改事实也不重推`,async()=>{const f=automaticFixture(payload);await assert.rejects(f.run,e=>e.status===status);assert.equal(f.events.length,0);assert.equal(f.reads.length,2);});
test('核验过程中任务版本变化时拒绝写回',async()=>{const f=fixture(),read=f.reader.read;f.reader.read=async(...args)=>{const r=await read(...args);if(args[1].includes('/workflow/'))f.task.version++;return r;};await assert.rejects(f.run,e=>e.status===409);assert.equal(f.events.length,0);});
