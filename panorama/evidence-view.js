function flowAttachmentPath(taskId,attachmentId){return API+'runs/'+encodeURIComponent(taskId)+'/attachments/'+encodeURIComponent(attachmentId)+'/content';}
function taskSourceUrl(task){if(task.runtime?.parentTaskId)return BASE+'workflow-panorama/?task='+encodeURIComponent(task.runtime.parentTaskId);if(task.runtime?.automation?.jobId&&task.runtime?.sourceKey?.startsWith('auto:'))return BASE+'#module=material-workbench';return task.sourceUrl||'';}
function handoffEvidenceHtml(task){
 const parent=task.runtime?.parentTaskId;
 // The server only supplies parentTaskId and handoffEvidence when the viewer
 // can read the reciprocal upstream relation. Attachment requests still use
 // the parent's original task ACL and immutable file identity.
 if(!parent||!task.relations?.upstream?.some(r=>r.canOpen&&r.taskId===parent))return '';
 const seen=new Set(),items=(task.runtime.handoffEvidence||[]).filter(e=>{
  const key=JSON.stringify([e.source,e.attachmentId||e.assetId||e.reference||e.url,e.version||e.sha256]);
  if(seen.has(key))return false;seen.add(key);return true;
 });
 if(!items.length)return '';
 return '<section class="drawer-summary"><h3>上游交付</h3><p class="help">保留交接时的凭证版本，供本次办理核对；下游仍需记录自己的交付。</p>'+items.map(e=>'<p><a href="'+esc(flowEvidenceUrl(e,parent))+'" target="_blank" rel="noopener noreferrer">'+esc(e.filename||e.title||e.reference||'查看交付凭证')+' ↗</a><br><span class="help">'+esc(evidenceProofLabel(e))+'</span></p>').join('')+'</section>';
}
function flowEvidenceUrl(e,taskId){if(e.attachmentId&&taskId)return flowAttachmentPath(taskId,e.attachmentId);if(e.source==='cloud_asset_verified'&&e.assetId||e.source==='cloud_api_verified'){const id=String(e.assetId||e.context?.assetId||''),etag=String(e.etag||'');return BASE+'#module=cloud-manager'+(/^[1-9]\d{0,14}$/.test(id)?'&asset_id='+id+(/^[a-fA-F0-9]+(?:-\d+)?$/.test(etag)&&etag.length<=128?'&asset_etag='+encodeURIComponent(etag):''):'');}if(['root_record_verified','automation_root_verified'].includes(e.source))return BASE+'#module=material-workbench';try{const url=new URL(e.url,location.origin),match=url.pathname.match(/\/api\/flows\/runs\/([^/]+)\/attachments\/([^/]+)\/content$/);if(match&&url.origin===location.origin)return flowAttachmentPath(decodeURIComponent(match[1]),decodeURIComponent(match[2]));return ['http:','https:'].includes(url.protocol)?url.href:'#';}catch{return '#';}}
function evidenceProofLabel(e){const label={task_file_verified:'文件完整性已校验',cloud_asset_verified:'云素材版本已核验',human_attested:'人工交付凭证',root_record_verified:'系统根记录核验',cloud_api_verified:'系统根记录核验',automation_root_verified:'系统根记录核验'}[e.source]||'交付凭证待核对';const reuse=e.attachmentReuse;return label+(reuse&&Number.isSafeInteger(reuse.sourceAttempt)&&Number.isSafeInteger(reuse.submittedAttempt)?' · 沿用第 '+reuse.sourceAttempt+' 轮原文件，在第 '+reuse.submittedAttempt+' 轮重新交付':'');}
