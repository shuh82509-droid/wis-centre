import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowEvidence,deliveryVerified} from './flow-evidence.mjs';
const asset={id:31,object_key:'test/output.mp4',size:1024,modified_at:'2026-09-08T06:00:00Z',review_status:'approved',review_version:2};
const delivery={id:'push-1',asset_id:31,advertiser_id:'account-a',plan_id:'plan-a',status:'success',platform_asset_id:'video-a',binding_verified_at:'2026-09-08T06:02:00Z',binding_evidence:{video_id:'video-a',matched_count:1,advertiser_id:'account-a',plan_id:'plan-a'}};
const task={runtime:{product:'黑晶面膜'}},input={evidence:[{kind:'platform_receipt',reference:'push-1',assetId:31,accountId:'account-a',planId:'plan-a'}]};
const reader=(d=delivery,a=asset)=>new FlowEvidence({sources:{view:()=>({})},readCloud:async(req,path)=>({status:200,payload:path.startsWith('/assets/')?a:d})});
test('平台已受理和素材上传成功都不能当成目标关联成功',()=>{assert.equal(deliveryVerified({...delivery,status:'submitted'}),false);assert.equal(deliveryVerified({...delivery,binding_verified_at:null}),false);assert.equal(deliveryVerified({...delivery,binding_evidence:{video_id:'video-a',matched_count:0}}),false);});
test('目标、素材、文件版本和当前审核均通过才锁定交付证据',async()=>{const result=await reader().prepare({}, {},task,'W03.S4.E2',input);assert.equal(result[0].source,'cloud_api_verified');assert.equal(result[0].context.assetId,'31');assert.equal(result[0].context.planId,'plan-a');assert.ok(!JSON.stringify(result).includes('test/output.mp4'));});
for(const [label,change] of [['错账户',{accountId:'other'}],['错计划',{planId:'other'}],['错素材',{assetId:32}]])test(label+'不能冒用成功回执',async()=>{await assert.rejects(reader().prepare({}, {},task,'W03.S4.E2',{evidence:[{...input.evidence[0],...change}]}),e=>e.status===409);});
for(const [label,evidence] of [['平台回执错素材',{video_id:'other',matched_count:1}],['平台回执错账户',{video_id:'video-a',matched_count:1,advertiser_id:'other'}],['平台回执错计划',{video_id:'video-a',matched_count:1,plan_id:'other'}]])test(label,async()=>{await assert.rejects(reader({...delivery,binding_evidence:evidence}).prepare({}, {},task,'W03.S4.E2',input),e=>e.status===409);});
test('当前审核失效，历史推送成功也不能继续交付',async()=>{await assert.rejects(reader(delivery,{...asset,review_status:'rejected'}).prepare({}, {},task,'W03.S4.E2',input),e=>e.status===409);});
test('文件被替换后不能引用旧资产审核链',async()=>{const prior=await reader().prepare({}, {},task,'W03.S4.E2',input);await assert.rejects(reader(delivery,{...asset,size:2048}).prepare({}, {},{runtime:{sourceContext:prior[0].context}},'W03.S5.E1',input),e=>e.status===409);});
test('拒绝手填成功链接和当前身份无权限的源记录',async()=>{await assert.rejects(reader().prepare({}, {},task,'W03.S4.E2',{evidence:[{reference:'success',url:'https://example.com'}]}));const forbidden=new FlowEvidence({sources:{},readCloud:async()=>({status:403,payload:{}})});await assert.rejects(forbidden.prepare({}, {},task,'W03.S4.E2',input),e=>e.status===403);});
test('一创和其他合法成片可直接核验云管家审核，无需伪造二创编号',async()=>{const e=await reader().prepare({}, {},task,'W03.S2.E1',{evidence:[{kind:'cloud_review',assetId:31,version:2}]});assert.equal(e[0].reference,'asset:31:review:2');await assert.rejects(reader().prepare({}, {},task,'W03.S2.E1',{evidence:[{kind:'cloud_review',assetId:31,version:1}]}),e=>e.status===409);});

test('integrated review and platform receipts preserve evidence while targeting current hub',async()=>{
 const env={HUB_INTEGRATED_MODE:'1',FLOW_PUBLIC_URL:'https://example.invalid/deployed/hub/workflow-panorama/'};
 const integrated=new FlowEvidence({env,sources:{view:()=>({})},readCloud:async(req,path)=>({status:200,payload:path.startsWith('/assets/')?asset:delivery})});
 for(const [node,body] of [['W03.S2.E1',{evidence:[{kind:'cloud_review',assetId:31,version:2}]}],['W03.S4.E2',input]]){
  const old=await reader().prepare({}, {},task,node,body),current=await integrated.prepare({}, {},task,node,body);
  assert.equal(current[0].url,'https://example.invalid/deployed/hub/#module=cloud-manager');
  assert.equal(current[0].version,old[0].version);assert.equal(current[0].reference,old[0].reference);assert.deepEqual(current[0].context,old[0].context);
 }
});
test('integrated remix proof stays on embedded workbench and verifies original file',async()=>{
 const env={HUB_INTEGRATED_MODE:'1',FLOW_PUBLIC_URL:'https://example.invalid/deployed/hub/workflow-panorama/'};
 const variant={id:'v1',sha256:'original-sha',filePresent:true,duration:3,assessment:'passed'};
 const instance=new FlowEvidence({env,sources:{view:()=>({sources:[{id:'cloud',state:'connected'},{id:'remix',state:'connected'}],renders:[{id:'r1',product:'黑晶面膜',variants:[variant]}]})},readCloud:()=>{throw Error('No cloud call for render proof');}});
 const body={evidence:[{kind:'remix_output',renderId:'r1',variantId:'v1'}]};
 const [proof]=await instance.prepare({}, {},task,'W02.S4.E1',body);
 assert.equal(proof.url,'https://example.invalid/deployed/hub/#module=material-workbench');assert.equal(proof.version,'original-sha');
 variant.filePresent=false;await assert.rejects(instance.prepare({}, {},task,'W02.S4.E1',body),e=>e.status===409);
});
test('integrated evidence cannot silently fall back to old deployment when location is missing or unsafe',()=>{
 for(const url of [undefined,'javascript:alert(1)','https://user:secret@example.invalid/workflow-panorama/','https://example.invalid/wrong/']){
  assert.throws(()=>new FlowEvidence({env:{HUB_INTEGRATED_MODE:'1',FLOW_PUBLIC_URL:url},sources:{},readCloud:()=>{}}));
 }
});
