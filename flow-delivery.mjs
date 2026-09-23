import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,statSync,openSync,fsyncSync,closeSync,linkSync,unlinkSync} from 'node:fs';
import {join,extname} from 'node:path';
import {requireFact} from './workflow-store.mjs';
import {safeUrl,text,fingerprint} from './task-workflow.mjs';
import {assetSnapshot} from './workflow-cloud.mjs';
import {evidenceKinds} from './flow-evidence.mjs';

const base='https://app.fandow.top/fd-026222/wis-marketing-hub/api/flows/';
const cloudBase='/fd-026222/wis-video-center/api';
export function deliveryLocations(env=process.env) {
  if(env.HUB_INTEGRATED_MODE!=='1')return {base,cloudBase,cloudPage:'https://app.fandow.top/fd-026222/wis-video-center/'};
  const flow=new URL(env.FLOW_PUBLIC_URL);
  if(!['https:','http:'].includes(flow.protocol)||flow.username||flow.password||!flow.pathname.endsWith('/workflow-panorama/'))throw Error('Invalid workflow public URL');
  const hub=new URL('../',flow);
  return {base:new URL('api/flows/',hub).href,cloudBase:new URL('modules/cloud-manager/api',hub).pathname,cloudPage:hub.href+'#module=cloud-manager'};
}
const maxBytes=20*1024*1024;
const mimeByExtension={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',doc:'application/msword',xls:'application/vnd.ms-excel',ppt:'application/vnd.ms-powerpoint'};
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const storageId=()=> 'attachment_'+randomUUID().replaceAll('-','');
const keyValid=key=>typeof key==='string'&&key.length>=8&&key.length<=128;

function strongEtag(value) {
  const tag=String(value||'').trim().replace(/^"|"$/gu,'');
  return /^(?:[a-f0-9]{32}(?:-[1-9]\d*)?|[a-f0-9]{64})$/iu.test(tag)?tag.toLowerCase():null;
}
function cloudDeliverySnapshot(asset) {
  const snapshot=assetSnapshot(asset),etag=strongEtag(asset.etag);
  return {...snapshot,version:etag?fingerprint({scheme:'cloud-content-etag-v1',id:asset.id,objectKey:asset.object_key,size:asset.size,etag}).slice(0,24):snapshot.version,
    versionScheme:etag?'cloud-content-etag-v1':'cloud-metadata-v1'};
}
function cloudDeliveryMatches(asset,evidence) {
  const current=cloudDeliverySnapshot(asset);
  if(String(asset.id)!==evidence.assetId||asset.size!==evidence.size)return false;
  if(evidence.versionScheme==='cloud-content-etag-v1')return current.versionScheme===evidence.versionScheme&&current.version===evidence.version;
  // Legacy proof already contains its original ETag and modifiedAt. Rebuild its
  // old hash with the current object key to verify that key was not changed.
  // This permits metadata precision changes only when content identity survives.
  if(!evidence.modifiedAt)return false;
  const original=assetSnapshot({...asset,modified_at:evidence.modifiedAt});
  if(original.version!==evidence.version)return false;
  const before=strongEtag(evidence.etag),after=strongEtag(asset.etag);
  if(before)return Boolean(after&&before===after);
  // Evidence without a strong ETag retains the exact original metadata gate.
  return assetSnapshot(asset).version===evidence.version;
}

export function validAttachmentBytes(buffer,extension) {
  if(extension==='png')return buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if(['jpg','jpeg'].includes(extension))return buffer.length>3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
  if(extension==='webp')return buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
  if(extension==='pdf')return buffer.subarray(0,5).toString()==='%PDF-';
  if(['docx','xlsx','pptx'].includes(extension))return buffer.subarray(0,4).equals(Buffer.from('504b0304','hex'));
  if(['doc','xls','ppt'].includes(extension))return buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));
  if(['txt','csv'].includes(extension))return !buffer.includes(0) && !buffer.toString('utf8').includes('\ufffd');
  return false;
}

export class FlowDelivery {
  constructor({runtime,readCloud,root,env=process.env}) {this.runtime=runtime;this.readCloud=readCloud;this.root=root;this.locations=deliveryLocations(env);}
  task(access,taskId,nodeId,{act=false}={}) {
    const task=this.runtime.get(access,taskId),node=task.runtime.nodes.find(n=>n.id===nodeId);
    requireFact(node,'办理节点不存在',404);
    if(act){requireFact(!task.runtime.creative,'请在原创意工作台提交和审核',409);requireFact(!task.runtime.automation,'请在二创工作台处理原自动任务',409);requireFact(task.runtime.state==='running'&&node.state==='ready','节点尚未到达、已完成或已暂停，请刷新原任务',409);requireFact(access.canManage||node.owner.number===access.user.number,'只有当前主责或流程管理人可以交付',403);this.runtime.validateOwner(node,access.user.number,task.runtime.nodes);}
    return {task,node};
  }
  async cloud(request,path) {
    const result=await this.readCloud(request,path,'GET',undefined,15000);
    requireFact(result.status===200,result.payload?.detail||'云管家暂未返回数据，请稍后核对原文件', [401,403,404].includes(result.status)?result.status:503);
    return result.payload;
  }
  async products(request) {
    try {const facets=await this.cloud(request,'/facets?asset_scope=marketing_video&categories_only=true');return {state:'connected',items:(facets.categories||[]).filter(x=>typeof x.name==='string'&&x.name.trim()).map(x=>({value:x.name,label:x.name,source:'云管家真实素材分类'}))};}
    catch(e){return {state:e.status===401||e.status===403?'authorization_required':'unavailable',items:[],detail:e.message};}
  }
  publicAttachment(taskId,row) {
    return {attachmentId:row.id,reference:row.id,filename:row.filename,size:row.size,mimeType:row.mimeType,
      sha256:row.sha256,version:'sha256:'+row.sha256,state:row.state,nodeId:row.nodeId,attempt:row.attempt,
      uploadedBy:row.uploadedBy,createdAt:row.createdAt,uploadedAt:row.uploadedAt||null,
      url:this.locations.base+'runs/'+taskId+'/attachments/'+row.id+'/content',
      uploadUrl:this.locations.base+'runs/'+taskId+'/attachments/'+row.id+'/content',source:'task_file_verified',proofType:'human_delivery'};
  }
  async options(request,access,taskId,nodeId) {
    const {task,node}=this.task(access,taskId,nodeId);
    let previousAttachments=[];
    if(node.attempt>1){
      try{
        // History stays readable under the existing task permission. Offering
        // it for a new delivery additionally requires the current action right.
        this.task(access,taskId,nodeId,{act:true});
        previousAttachments=(task.runtime.attachments||[])
          .filter(r=>r.nodeId===node.id&&r.state==='ready'&&Number.isSafeInteger(r.attempt)&&r.attempt>=1&&r.attempt<node.attempt)
          .map(r=>({...this.publicAttachment(task.id,r),reuseFromAttempt:r.attempt}));
      }catch(error){if(![403,409].includes(error.status))throw error;}
    }
    // Local delivery remains usable when the optional cloud directory is slow.
    // The existing products endpoint checks cloud access only when requested.
    return {attachments:(task.runtime.attachments||[]).filter(r=>r.nodeId===node.id&&r.attempt===node.attempt).map(r=>this.publicAttachment(task.id,r)),previousAttachments,
      fileUpload:{maxBytes,extensions:Object.keys(mimeByExtension)},
      cloud:{available:false,state:'not_requested',base:this.locations.cloudBase,multipartPartSize:32*1024*1024,categories:[]},
      canReuseUpstreamEvidence:!!node.canReuseUpstreamEvidence,evidenceKind:evidenceKinds[node.id]||'human_attested'};
  }
  init(access,taskId,body,key) {
    requireFact(keyValid(key),'缺少防重复上传编号');
    const {task,node}=this.task(access,taskId,body.nodeId,{act:true});
    const filename=text(body.filename,180).replace(/[\\/]/g,'_'),extension=extname(filename).slice(1).toLowerCase();
    requireFact(mimeByExtension[extension],'请选择支持的图片或文档；视频请上传至云管家');
    requireFact(Number.isSafeInteger(body.size)&&body.size>0&&body.size<=maxBytes,'单个任务附件最大20MiB；大视频请上传至云管家',413);
    requireFact(/^[a-f0-9]{64}$/.test(body.sha256||''),'请等待文件完整校验后上传');
    const hash=fingerprint({nodeId:node.id,attempt:node.attempt,filename,size:body.size,sha256:body.sha256}),dedupeKey=access.user.number+':file:'+taskId+':'+key;
    const result=this.runtime.store.transaction(s=>{
      this.runtime.ensure(s);const current=s.tasks.find(t=>t.id===task.id);
      const previous=s.flowDedupe[dedupeKey];if(previous){requireFact(previous.hash===hash,'重复上传编号对应的文件不同',409);const existing=current.runtime.attachments.find(r=>r.id===previous.attachmentId);requireFact(existing,'上传登记待核对',409);return existing;}
      requireFact(current.version===body.expectedVersion,'任务已更新，请刷新后继续上传',409);
      const ready=current.runtime.nodes.find(n=>n.id===node.id);requireFact(current.runtime.state==='running'&&ready.state==='ready'&&ready.attempt===node.attempt,'办理状态已变化，请刷新原任务',409);
      current.runtime.attachments??=[];
      const duplicate=current.runtime.attachments.find(r=>r.nodeId===node.id&&r.attempt===node.attempt&&r.uploadedBy.number===access.user.number&&r.sha256===body.sha256&&r.size===body.size);
      if(duplicate){s.flowDedupe[dedupeKey]={hash,attachmentId:duplicate.id};return duplicate;}
      requireFact(current.runtime.attachments.length<60&&current.runtime.attachments.reduce((sum,r)=>sum+r.size,0)+body.size<=200*1024*1024,'本任务附件已达容量上限，请关联云管家素材或使用文档链接',409);
      const row={id:storageId(),filename,extension,size:body.size,mimeType:mimeByExtension[extension],sha256:body.sha256,nodeId:node.id,attempt:node.attempt,state:'pending',uploadedBy:{number:access.user.number,name:access.user.name},createdAt:this.runtime.iso()};
      current.runtime.attachments.push(row);s.flowDedupe[dedupeKey]={hash,attachmentId:row.id};return row;
    });return this.publicAttachment(taskId,result);
  }
  attachment(access,taskId,attachmentId) {
    const task=this.runtime.get(access,taskId),row=task.runtime.attachments?.find(r=>r.id===attachmentId);
    requireFact(row&&/^attachment_[a-f0-9]{32}$/.test(row.id),'任务附件不存在或没有权限',404);
    return {task,row,file:join(this.root,row.id)};
  }
  async upload(request,access,taskId,attachmentId) {
    const {task,row,file}=this.attachment(access,taskId,attachmentId);
    this.task(access,taskId,row.nodeId,{act:true});
    requireFact(row.uploadedBy.number===access.user.number,'只能继续本人发起的上传',403);
    requireFact(task.runtime.nodes.find(n=>n.id===row.nodeId).attempt===row.attempt,'此附件属于上一轮办理，请为本轮重新关联',409);
    const stated=Number(request.headers['content-length']);
    requireFact(!request.headers['content-length']||stated===row.size,'文件大小与原登记不一致',400);
    let size=0;const chunks=[];
    for await(const chunk of request){size+=chunk.length;requireFact(size<=row.size&&size<=maxBytes,'上传文件超出登记大小',413);chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);
    requireFact(bytes.length===row.size&&sha(bytes)===row.sha256,'文件不完整或与校验值不一致，请继续原文件上传',409);
    requireFact(validAttachmentBytes(bytes,row.extension),'文件内容与扩展名不符，请选择原始图片或文档',400);
    mkdirSync(this.root,{recursive:true,mode:0o700});
    if(existsSync(file))requireFact(statSync(file).size===row.size&&sha(readFileSync(file))===row.sha256,'已有附件校验异常，已保护原文件，请联系维护人',409);
    else {
      const temporary=file+'.'+randomUUID()+'.tmp';let fd;
      try {
        fd=openSync(temporary,'wx',0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;
        // Publish only complete bytes, never leave a partially written final file.
        // A simultaneous retry may already have published this exact same file.
        try{linkSync(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;requireFact(statSync(file).size===row.size&&sha(readFileSync(file))===row.sha256,'已有附件校验异常，已保护原文件',409);}
        if(process.platform!=='win32'){const directory=openSync(this.root,'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
      }finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
    }
    const result=this.runtime.store.transaction(s=>{
      const current=s.tasks.find(t=>t.id===taskId),node=current.runtime.nodes.find(n=>n.id===row.nodeId),record=current.runtime.attachments.find(r=>r.id===row.id);
      requireFact(current.runtime.state==='running'&&node.state==='ready'&&node.attempt===row.attempt,'任务已变化，文件已保存，请刷新核对后再关联',409);
      if(record.state!=='ready'){record.state='ready';record.uploadedAt=this.runtime.iso();}
      return record;
    });return this.publicAttachment(taskId,result);
  }
  content(access,taskId,attachmentId) {
    const {row,file}=this.attachment(access,taskId,attachmentId);
    requireFact(row.state==='ready'&&existsSync(file)&&statSync(file).size===row.size,'附件尚未上传完整，请继续原文件上传',409);
    requireFact(sha(readFileSync(file))===row.sha256,'附件校验异常，已保留原记录，请联系维护人',409);
    return {file,row};
  }
  projectAsset(asset) {
    const snapshot=cloudDeliverySnapshot(asset);
    return {assetId:snapshot.id,version:snapshot.version,versionScheme:snapshot.versionScheme,filename:asset.filename,category:asset.category,
      size:asset.size,mimeType:asset.mime_type||'',etag:asset.etag||null,
      uploadedBy:{number:asset.uploaded_by_number||null,name:asset.uploaded_by_name||null},
      reviewStatus:asset.review_status||null,reviewVersion:asset.review_version||null,
      createdAt:asset.created_at||null,modifiedAt:asset.modified_at,
      url:this.locations.cloudPage,source:'cloud_asset_verified',proofType:'human_delivery'};
  }
  async assets(request,access,taskId,query) {
    this.task(access,taskId,query.get('nodeId'),{act:true});
    const params=new URLSearchParams({asset_scope:'marketing_video',sort:'newest',page:String(Math.min(1000,Math.max(1,Number(query.get('page'))||1))),page_size:'30',mine_only:query.get('mineOnly')==='false'?'false':'true',include_performance:'false'});
    if(query.get('q'))params.set('q',text(query.get('q'),100));
    if(query.get('category'))params.set('category',text(query.get('category'),100));
    const result=await this.cloud(request,'/assets?'+params);
    return {items:(result.items||[]).filter(x=>!x.deleted_at&&!x.purged_at).map(asset=>this.projectAsset(asset)),total:result.total,page:result.page,pageSize:result.page_size};
  }
  async resolveAsset(request,access,taskId,body) {
    return this.projectAsset(await this.readAsset(request,access,taskId,body));
  }
  async readAsset(request,access,taskId,body) {
    this.task(access,taskId,body.nodeId,{act:true});requireFact(/^\d+$/.test(String(body.assetId)),'请选择有效的云管家素材');
    return this.cloud(request,'/assets/'+encodeURIComponent(body.assetId)+'?include_performance=false');
  }
  async prepare(request,access,taskId,nodeId,body) {
    const {task,node}=this.task(access,taskId,nodeId,{act:true});
    if(evidenceKinds[nodeId])return null;
    const refs=Array.isArray(body.evidence)?body.evidence:[];
    if(!refs.length){
      if(!node.canReuseUpstreamEvidence)return null;
      const inherited=task.runtime.nodes.filter(n=>node.dependencies.includes(n.id)&&n.state==='completed')
        .flatMap(n=>(n.evidence||[]).map(e=>({...e,reusedFrom:{nodeId:n.id,attempt:n.attempt}}))).slice(0,12);
      for(const evidence of inherited){
        if(evidence.source==='task_file_verified'){
          const {row,file}=this.attachment(access,task.id,evidence.attachmentId);
          requireFact(row.state==='ready'&&evidence.version==='sha256:'+row.sha256&&existsSync(file)&&statSync(file).size===row.size&&sha(readFileSync(file))===row.sha256,'上游交付文件已变化或不完整，请退回核对原文件后再审核',409);
        }else if(evidence.source==='cloud_asset_verified'){
          const current=await this.readAsset(request,access,task.id,{nodeId,assetId:evidence.assetId});
          requireFact(cloudDeliveryMatches(current,evidence),'上游云素材版本已变化，请退回重新交付后再审核',409);
        }
      }
      requireFact(this.runtime.get(access,taskId).version===body.expectedVersion,'核验期间任务已更新，请刷新后继续',409);
      return inherited.length?inherited:null;
    }
    requireFact(refs.length<=12,'单次交付最多关联12项文件或链接');
    const results=[];
    for(const ref of refs){
      if(ref.attachmentId){
        const {row,file}=this.attachment(access,task.id,ref.attachmentId);
        const previous=ref.reuseFromAttempt!==undefined;
        if(previous)requireFact(Number.isSafeInteger(ref.reuseFromAttempt)&&ref.reuseFromAttempt>=1&&ref.reuseFromAttempt===row.attempt&&row.attempt<node.attempt,'请从本节点以前轮次的已保存附件中重新选择，不能沿用其他轮次标记',409);
        requireFact(row.nodeId===node.id&&row.state==='ready'&&(previous||row.attempt===node.attempt),'附件未完成上传、属于其他节点或需要明确选择沿用原轮次',409);
        requireFact(existsSync(file)&&statSync(file).size===row.size&&sha(readFileSync(file))===row.sha256,'附件完整性待核对，不能提交成功',409);
        results.push({...this.publicAttachment(task.id,row),summary:text(ref.summary,500)||row.filename,
          ...(previous?{attachmentReuse:{sourceNodeId:row.nodeId,sourceAttempt:row.attempt,submittedAttempt:node.attempt}}:{})});
      }else if(ref.assetId){
        const asset=await this.resolveAsset(request,access,task.id,{nodeId,assetId:ref.assetId});
        requireFact(ref.version&&ref.version===asset.version,'云管家文件版本已变化或尚未确认，请重新选择原素材',409);
        results.push({...asset,reference:'cloud:'+asset.assetId,summary:text(ref.summary,500)||asset.filename});
      }else{
        const url=safeUrl(ref.url);requireFact(url,'请填写交付链接或选择文件');
        results.push({url,reference:text(ref.reference,200)||'link-'+fingerprint(url).slice(0,20),version:text(ref.version,100)||'link-reference-v1',summary:text(ref.summary,500),source:'human_attested',proofType:'human_delivery'});
      }
    }
    const cloudEvidence=results.filter(r=>r.source==='cloud_asset_verified');
    if(cloudEvidence.length===1)cloudEvidence[0].context={assetId:cloudEvidence[0].assetId,assetVersion:cloudEvidence[0].version};
    // Async cloud checks must never commit against a newer task revision.
    requireFact(this.runtime.get(access,taskId).version===body.expectedVersion,'核验期间任务已更新，请刷新后继续；已上传文件保留',409);
    return results;
  }
}
