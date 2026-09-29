import {sameFlowProduct} from './flow-product.mjs';
import {requireFact} from './workflow-store.mjs';
import {assetSnapshot} from './workflow-cloud.mjs';
import {flowModuleLocations} from './flow-locations.mjs';
export const evidenceKinds={
 'W02.S4.E1':'remix_output','W02.S5.E1':'cloud_return','W02.S5.E2':'cloud_review',
 'W03.S2.E1':'cloud_review','W03.S2.E2':'cloud_review',
 'W03.S4.E1':'platform_receipt','W03.S4.E2':'platform_receipt','W03.S5.E1':'platform_receipt','W03.S5.E2':'platform_receipt'
};
export function deliveryVerified(d){const e=d.binding_evidence||{};return d.status==='success'&&!!d.binding_verified_at&&!!d.platform_asset_id&&Number(e.matched_count)>0&&String(e.video_id)===String(d.platform_asset_id)&&(!e.advertiser_id||String(e.advertiser_id)===String(d.advertiser_id))&&(!e.plan_id||String(e.plan_id)===String(d.plan_id));}
// Association and platform content audit are separate saved platform facts.
// PASS is evidence of that readback's audit result, not proof of active spend.
export function platformAuditState(d){
 const a=d.binding_evidence?.platform_audit;
 if(!a||a.video_id!==String(d.platform_asset_id)||a.source!=='qianchuan/uni_promotion/ad/material/get'||typeof a.read_at!=='string'||!Number.isFinite(Date.parse(a.read_at))||Date.parse(a.read_at)>Date.now()+300000)return {state:'unknown',label:'平台审核待核验',readAt:null};
 const raw=Array.isArray(a.raw_statuses)?a.raw_statuses:[];
 if(a.status==='REJECT'||raw.includes('REJECT'))return {state:'rejected',label:'平台审核已拒绝',readAt:a.read_at};
 if(a.status==='PASS'&&raw.length>0&&raw.every(x=>x==='PASS'))return {state:'approved',label:'平台审核通过（按读回时间）',readAt:a.read_at};
 return {state:'unknown',label:a.status==='IN_PROGRESS'?'平台审核处理中':'平台审核待核验',readAt:a.read_at};
}
export class FlowEvidence{
 constructor({sources,readCloud,env=process.env}){this.sources=sources;this.readCloud=readCloud;this.locations=flowModuleLocations(env);}
 async read(req,path){const r=await this.readCloud(req,path,'GET',undefined,15000);requireFact(r.status===200,'原业务系统未返回有效记录，保留当前节点，请稍后核对',r.status===403?403:503);return r.payload;}
 async prepare(req,a,t,nodeId,b){
  const kind=evidenceKinds[nodeId];if(!kind)return null;
  requireFact(b.evidence?.length===1&&b.evidence[0].kind===kind,'此节点必须选择对应的业务根记录，手填链接不能标记系统完成');
  const input=b.evidence[0],context=t.runtime.sourceContext||{};
  if(kind==='cloud_review'&&nodeId.startsWith('W03.')){
   requireFact(/^\d+$/.test(String(input.assetId)),'请填写准确的云管家资产编号');
   const asset=await this.read(req,'/assets/'+encodeURIComponent(input.assetId)+'?include_performance=false'),snapshot=assetSnapshot(asset);
   requireFact(asset.review_status==='approved'&&Number(asset.review_version)>0&&String(asset.review_version)===String(input.version),'该资产当前审核版本尚未通过，或填写版本与原记录不一致',409);
   requireFact(!context.assetId||context.assetId===String(asset.id),'审核资产与本任务已锁定版本不一致',409);
   requireFact(!context.assetVersion||context.assetVersion===snapshot.version,'交付文件已经变化，请退回重新交付',409);
   return [{url:this.locations.cloud,reference:'asset:'+asset.id+':review:'+asset.review_version,version:snapshot.version,summary:'云管家当前有权审核结论通过 · 审核版本 '+asset.review_version,source:'cloud_api_verified',verifiedAt:new Date().toISOString(),context:{assetId:String(asset.id),assetVersion:snapshot.version}}];
  }
  if(kind==='platform_receipt'){
   requireFact(/^[a-zA-Z0-9_-]{1,120}$/.test(String(input.reference)),'请填写准确的千川推送任务编号');
   const d=await this.read(req,'/workflow/receipts/qianchuan/'+encodeURIComponent(input.reference));
   requireFact(String(d.id)===String(input.reference)&&deliveryVerified(d),'该平台记录尚未取得准确目标的关联回执，不能标记已完成',409);
   requireFact(String(input.accountId)===String(d.advertiser_id)&&String(input.planId)===String(d.plan_id)&&String(input.assetId)===String(d.asset_id),'请确认本次任务对应的资产、账户和计划，不能使用不相关的成功回执',409);
   requireFact(!String(d.advertiser_name||'').startsWith('电商部达播'),'此记录不在品牌营销部当前经营口径范围',403);
   const asset=await this.read(req,'/assets/'+encodeURIComponent(d.asset_id)+'?include_performance=false'),snapshot=assetSnapshot(asset);
   requireFact(asset.review_status==='approved','该资产当前审核已失效或未通过，不能用历史成功推送冒充当前可用',409);
   requireFact(!context.assetId||String(context.assetId)===String(d.asset_id),'平台回执与本任务已锁定的交付版本不一致',409);
   requireFact(!context.assetVersion||context.assetVersion===snapshot.version,'交付文件已变化，请退回重新交付审核',409);
   requireFact(!context.accountId||String(context.accountId)===String(d.advertiser_id)&&String(context.planId)===String(d.plan_id),'平台回执与本任务原目标不一致',409);
   const audit=platformAuditState(d);
   if(nodeId.startsWith('W03.S5.'))requireFact(audit.state==='approved',audit.state==='rejected'?'关联成功，但平台审核已拒绝；请在原系统处理，不能以成功上传结项':'关联成功，但对应素材的平台审核尚未核验通过；请保留待核验，不代表已可投',409);
   return [{url:this.locations.cloud,reference:String(d.id),version:snapshot.version,summary:`资产 ${d.asset_id} · 账户 ${d.advertiser_id} · 计划 ${d.plan_id} · 平台素材 ${d.platform_asset_id} · 目标关联已核验 · ${audit.label}${audit.readAt?' · 审核读回 '+audit.readAt:''}`,source:'cloud_api_verified',verifiedAt:new Date().toISOString(),platformAudit:audit,context:{assetId:String(d.asset_id),assetVersion:snapshot.version,accountId:String(d.advertiser_id),planId:String(d.plan_id)}}];
  }
  const view=this.sources.view(a);
  requireFact(view.sources.find(s=>s.id==='cloud')?.state==='connected'&&view.sources.find(s=>s.id==='remix')?.state==='connected','根记录尚未就绪，保留待核验',503);
  const render=view.renders.find(r=>r.id===input.renderId),v=render?.variants.find(v=>v.id===input.variantId);
  requireFact(v&&(!t.runtime.product||sameFlowProduct(render.product,t.runtime.product)),'请选择本任务产品且在本人权限内的成片版本',403);
  requireFact(v.sha256&&v.filePresent===true&&v.duration>0&&!v.conflict&&!v.quarantined&&v.assessment!=='failed','产物文件缺失、未通过检查或存在审核冲突，请先处理原版本',409);
  requireFact(!context.renderId||context.renderId===render.id&&context.variantId===v.id&&context.sha256===v.sha256,'不同成片不能冒用同一任务交付链，请退回后重新办理',409);
  if(kind!=='remix_output')requireFact(v.review==='approved'&&v.returnVerified,'回传尚未完成或版本校验不一致，请先在原工作台核对',409);
  if(kind==='cloud_review')requireFact(v.cloudReview&&['approved','pending','in_progress'].includes(v.cloudReview.status),'对应版本尚未进入审核队列',409);
  if(nodeId.startsWith('W03.S2'))requireFact(v.cloudReview?.status==='approved','云管家有权审核人尚未通过此版本，不能手工替代审核',409);
  const asset=kind==='remix_output'?null:await this.read(req,'/assets/'+encodeURIComponent(v.return.assetId)+'?include_performance=false');
  const snapshot=asset?assetSnapshot(asset):null;
  requireFact(!context.assetVersion||context.assetVersion===snapshot?.version,'回传文件已变化，请退回重交',409);
  return [{url:this.locations.remix,reference:kind==='remix_output'?render.id+':'+v.id:kind==='cloud_return'?v.return.idempotencyKey:String(v.cloudReview.id),version:snapshot?.version||v.sha256,summary:`${render.product} · ${v.name||v.id} · ${kind==='remix_output'?'服务端成片':kind==='cloud_return'?'回传版本核验':'云端审核版本'}`,source:'root_record_verified',verifiedAt:new Date().toISOString(),context:{renderId:render.id,variantId:v.id,sha256:v.sha256,...(snapshot?{assetId:String(snapshot.id),assetVersion:snapshot.version}:{})}}];
 }
}
