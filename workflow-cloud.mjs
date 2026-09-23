import { requireFact, WorkflowError } from './workflow-store.mjs';
import { fingerprint, safeUrl, visible } from './task-workflow.mjs';

export function assetSnapshot(asset) {
  requireFact(Number.isInteger(asset?.id) && asset.id>0 && asset.object_key && Number.isFinite(asset.size) && asset.modified_at && !asset.deleted_at && !asset.purged_at,'云管家资产信息不完整或已删除',409);
  // Approval metadata can advance without changing the file. Content identity must not.
  return {id:String(asset.id),version:fingerprint({id:asset.id,objectKey:asset.object_key,size:asset.size,modifiedAt:asset.modified_at}).slice(0,24),size:asset.size,modifiedAt:asset.modified_at};
}
// Read-only reconciliation through the current user's existing module authority.
// No service-account elevation, automatic push, plan update or retry endpoint exists here.
export class WorkflowCloudReader {
  constructor(engine,read){this.engine=engine;this.read=read;}
  async get(request,path) {
    const response=await this.read(request,path,'GET',undefined,15000);
    requireFact(response.status===200,'云管家暂未返回可核验数据，请稍后核对；不会重新推送',response.status===401||response.status===403?response.status:503);
    return response.payload;
  }
  task(access,taskId) {const task=this.engine.store.read().tasks.find(t=>t.id===taskId && visible(t,access));requireFact(task,'任务不存在或不可见',404);return task;}
  async register(request,access,taskId,body,key) {
    this.task(access,taskId);requireFact(/^\d+$/u.test(String(body.assetId)),'请填写云管家资产编号');
    const asset=await this.get(request,`/assets/${encodeURIComponent(body.assetId)}?include_performance=false`),snapshot=assetSnapshot(asset);
    // Persist the stable library reference, never an expiring signed download URL.
    return this.engine.command(access,taskId,'output',{expectedVersion:body.expectedVersion,assetId:snapshot.id,assetVersion:snapshot.version,url:'https://app.fandow.top/fd-026222/wis-video-center/',summary:body.summary || asset.filename,productionJobId:body.productionJobId},key,{cloudSnapshot:snapshot});
  }
  async contentUrl(request,access,taskId,outputId) {
    const task=this.task(access,taskId),output=task.outputs.find(o=>o.id===outputId);
    requireFact(output?.cloudSnapshot,'云管家交付记录不存在',404);
    const asset=await this.get(request,`/assets/${encodeURIComponent(output.cloudSnapshot.id)}?include_performance=false`);
    requireFact(assetSnapshot(asset).version===output.cloudSnapshot.version,'资产版本已变化，不能把新内容当作原审核版本',409);
    return safeUrl(asset.download_url || asset.preview_url);
  }
  async reconcile(request,access,taskId,body) {
    const task=this.task(access,taskId);requireFact(task.version===body.expectedVersion,'任务已更新，请刷新再核对',409);
    requireFact(access.canManage || task.assignees.some(p=>p.number===access.user.number),'请先领取任务',403);
    const delivery=task.deliveries.find(d=>d.id===body.deliveryId);requireFact(delivery,'推送关联不存在',404);
    const output=task.outputs.find(o=>o.id===delivery.outputId);requireFact(output?.cloudSnapshot,'请先从云管家登记资产，手填版本不能自动核验',409);
    const asset=await this.get(request,`/assets/${encodeURIComponent(output.cloudSnapshot.id)}?include_performance=false`);
    requireFact(assetSnapshot(asset).version===output.cloudSnapshot.version,'云管家资产版本已变化，请重新交付审核',409);
    let cloudTaskId=String(body.cloudTaskId || '').trim();
    if(!cloudTaskId) {
      const query=new URLSearchParams({platform:delivery.platform,asset_id:output.assetId,account_id:delivery.accountId,plan_id:delivery.planId || ''});
      const candidates=await this.get(request,`/workflow/receipt-candidates?${query}`);
      requireFact(Array.isArray(candidates?.items) && typeof candidates.ambiguous==='boolean','平台匹配结果不完整，暂不更新任务',503);
      requireFact(candidates.items.length>0,'暂未找到该素材与目标对应的推送记录，不会重新推送',409);
      requireFact(!candidates.ambiguous && candidates.items.length===1,'找到多条对应记录，请填写要核验的推送任务编号；不会自动选择或重复推送',409);
      cloudTaskId=String(candidates.items[0]?.id || '');
    }
    requireFact(/^[a-zA-Z0-9_-]{1,120}$/u.test(cloudTaskId),'推送任务编号无效，请核对');
    const matched=await this.get(request,`/workflow/receipts/${delivery.platform}/${encodeURIComponent(cloudTaskId)}`);
    requireFact(matched.id===cloudTaskId && String(matched.asset_id)===output.assetId && String(matched.advertiser_id || matched.account_id)===delivery.accountId && String(matched.plan_id || '')===delivery.planId,'平台记录与任务资产或目标不一致，不能标记成功',409);
    let state='unknown',receiptId='',receiptUrl='';
    if(delivery.platform==='qianchuan') {
      const evidence=matched.binding_evidence || {};
      const verified=matched.status==='success' && matched.binding_verified_at && matched.platform_asset_id && Number(evidence.matched_count)>0 && String(evidence.video_id)===String(matched.platform_asset_id) && (!evidence.advertiser_id || String(evidence.advertiser_id)===delivery.accountId) && (!evidence.plan_id || String(evidence.plan_id)===delivery.planId);
      if(verified){state='succeeded';receiptId=String(matched.platform_asset_id);receiptUrl=`https://app.fandow.top/fd-026222/wis-video-center/api/qianchuan/tasks?asset_id=${encodeURIComponent(output.assetId)}`;}
    } else if(matched.status==='success' && matched.platform_export_id && matched.platform_export_verified_at && matched.platform_content_url) {
      state='succeeded';receiptId=String(matched.platform_export_id);receiptUrl=safeUrl(matched.platform_content_url);
    }
    if(state!=='succeeded' && matched.status==='failed')state='failed';
    const event={type:'delivery_receipt',taskId,deliveryId:delivery.id,assetId:delivery.assetId,assetVersion:delivery.assetVersion,platform:delivery.platform,accountId:delivery.accountId,planId:delivery.planId,state,verified:state==='succeeded',receiptId,receiptUrl};
    requireFact(this.task(access,taskId).version===body.expectedVersion,'核验期间任务已更新，请刷新后重试；不会重新推送',409);
    event.eventId=`cloud_${fingerprint({...event,cloudTaskId:matched.id})}`;
    this.engine.serviceEvent(event,{id:'cloud-readback',types:['delivery_receipt'],centers:[access.user.center]});
    return {id:delivery.id,state,detail:state==='succeeded'?'已核对云管家保存的平台回执':'结果仍待核验，不会自动重新推送'};
  }
}
