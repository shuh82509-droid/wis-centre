const videoUploadSessions=new Map();
const checkUploadSignal=signal=>{if(signal?.aborted)throw new DOMException('上传已暂停，原会话和文件保留','AbortError');};
async function hashVideoFile(file,partSize,onProgress,signal){
 checkUploadSignal(signal);const sha=await globalThis.hashwasm.createSHA256(),md5=await globalThis.hashwasm.createMD5();sha.init();md5.init();let offset=0,inPart=0;const md5s=[];
 while(offset<file.size){checkUploadSignal(signal);const bytes=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+8*1024*1024)).arrayBuffer());let cursor=0;while(cursor<bytes.length){const take=Math.min(bytes.length-cursor,partSize-inPart),piece=bytes.subarray(cursor,cursor+take);sha.update(piece);md5.update(piece);cursor+=take;inPart+=take;if(inPart===partSize){md5s.push(md5.digest('hex'));md5.init();inPart=0;}}offset+=bytes.length;onProgress?.(Math.round(100*offset/file.size));await new Promise(r=>setTimeout(r,0));}
 if(inPart)md5s.push(md5.digest('hex'));return {sha256:sha.digest('hex'),partMd5s:md5s};
}
async function hashVideoInWorker(file,partSize,onProgress,signal){
 checkUploadSignal(signal);
 if(typeof Worker!=='function'||typeof FLOW_HASH_WORKER_SOURCE!=='string')return hashVideoFile(file,partSize,onProgress,signal);
 const url=URL.createObjectURL(new Blob([FLOW_HASH_WORKER_SOURCE],{type:'text/javascript'}));let worker;
 try{return await new Promise((resolve,reject)=>{worker=new Worker(url);let settled=false;const done=(fn,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);worker.terminate();fn(value);};const abort=()=>done(reject,new DOMException('上传已暂停，原文件保留','AbortError'));signal?.addEventListener('abort',abort,{once:true});worker.onmessage=e=>{if(e.data.type==='progress')onProgress?.(e.data.percent);else if(e.data.type==='complete')done(resolve,e.data.result);else done(reject,Error(e.data.message||'文件校验失败'));};worker.onerror=()=>done(reject,Error('文件校验线程未能运行'));worker.postMessage({file,partSize});});}catch(e){checkUploadSignal(signal);return hashVideoFile(file,partSize,onProgress,signal);}finally{worker?.terminate();URL.revokeObjectURL(url);}
}
async function cloudUploadJson(base,path,{body,signal,timeout=90000}={}){
 const url=new URL(base+path,location.origin);if(url.origin!==location.origin)throw Error('云管家入口不属于当前业务站点');checkUploadSignal(signal);
 const r=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});let d;try{d=await r.json();}catch{throw Error('云管家登录或返回格式暂不可用，请从原入口确认登录');}if(!r.ok){const error=Error(typeof d.detail==='string'?d.detail:'云管家请求未完成（'+r.status+'）');error.status=r.status;throw error;}return d;
}
function xhrUploadPart(url,blob,headers,{sameOrigin=false,signal,onProgress,timeout=120000}={}){
 return new Promise((resolve,reject)=>{checkUploadSignal(signal);const xhr=new XMLHttpRequest();let settled=false,lastProgress=Date.now();const finish=(fn,value)=>{if(settled)return;settled=true;clearInterval(stall);signal?.removeEventListener('abort',abort);fn(value);};const abort=()=>xhr.abort();const stall=setInterval(()=>{if(Date.now()-lastProgress>timeout)xhr.abort();},3000);xhr.open('PUT',url);xhr.withCredentials=sameOrigin;Object.entries(headers||{}).forEach(([k,v])=>xhr.setRequestHeader(k,v));xhr.upload.onprogress=e=>{lastProgress=Date.now();onProgress?.(e.loaded);};xhr.onload=()=>{if(xhr.status<200||xhr.status>=300)return finish(reject,Error('分片上传未完成（'+xhr.status+'）'));let etag=xhr.getResponseHeader('ETag')||'';if(sameOrigin){try{etag=JSON.parse(xhr.responseText).etag||'';}catch{}}finish(resolve,etag.trim());};xhr.onerror=()=>finish(reject,Error('分片连接中断'));xhr.onabort=()=>finish(reject,Error(signal?.aborted?'上传已暂停，原会话保留':'分片长时间无进度，请核对原会话后续传'));signal?.addEventListener('abort',abort,{once:true});xhr.send(blob);});
}
async function withCloudUploadLease(base,sessionId,operation,{signal,onProgress}={}){
 const requestId=crypto.randomUUID(),deadline=Date.now()+120000;let lease;
 while(Date.now()<deadline){checkUploadSignal(signal);const r=await cloudUploadJson(base,'/uploads/part-leases/acquire',{body:{session_id:sessionId,request_id:requestId},signal});if(r.acquired&&r.lease_id){lease=r.lease_id;break;}onProgress?.('等待上传通道，排队第 '+Math.max(1,Number(r.queue_position)||1)+' 位');await new Promise(r=>setTimeout(r,Math.max(250,Math.min(3000,Number(r.retry_after_ms)||500))));}
 if(!lease)throw Error('上传通道繁忙，原会话已保留，请稍后继续');const leaseAbort=new AbortController();const timer=setInterval(()=>void cloudUploadJson(base,'/uploads/part-leases/renew',{body:{lease_id:lease}}).catch(()=>leaseAbort.abort()),30000);
 try{return await operation(signal?AbortSignal.any([signal,leaseAbort.signal]):leaseAbort.signal);}finally{clearInterval(timer);await cloudUploadJson(base,'/uploads/part-leases/release',{body:{lease_id:lease},timeout:10000}).catch(()=>{});}
}
function validUploadedParts(session,file){return (session.uploaded_parts||[]).filter(p=>Number.isInteger(p.part_number)&&p.part_number>=1&&p.part_number<=session.total_parts&&p.size===Math.min(session.part_size,file.size-(p.part_number-1)*session.part_size)&&typeof p.etag==='string'&&p.etag.trim());}
async function performFlowCloudVideoUpload(file,{cloud,category,libraryType,contentType,taskId,nodeId,onProgress,signal}){
 if(!file.size||!file.type.startsWith('video/'))throw Error('请选择原始视频文件');const base=cloud.base,requestedPartSize=cloud.multipartPartSize||33554432;onProgress('正在分段核验原视频',0);
 let hashes=await hashVideoInWorker(file,requestedPartSize,p=>onProgress('正在核验完整文件 '+p+'%',p*.08),signal);
 if(!/^[a-f0-9]{64}$/.test(hashes.sha256))throw Error('完整文件校验未完成，尚未发起上传');
 const cacheKey=['wis-flow-video-v1',state.overview.access.number,taskId,nodeId,hashes.sha256,category,libraryType,contentType].join(':');let record=videoUploadSessions.get(cacheKey);
 if(!record){try{record=JSON.parse(localStorage.getItem(cacheKey)||'null');}catch{}}
 const save=()=>{videoUploadSessions.set(cacheKey,record);try{localStorage.setItem(cacheKey,JSON.stringify(record));}catch{}};
 if(record?.assetId)return {id:record.assetId};let session;
 if(record?.sessionId){onProgress('正在核对原上传进度',8);session=await cloudUploadJson(base,'/uploads/multipart/sessions/'+encodeURIComponent(record.sessionId),{signal});}
 else{session=await cloudUploadJson(base,'/uploads/multipart/sessions',{body:{filename:file.name,content_type:file.type,size:file.size,sha256:hashes.sha256,asset_scope:'marketing_video',category,part_size:requestedPartSize},signal});record={sessionId:session.session_id,phase:'uploading',sha256:hashes.sha256,filename:file.name,size:file.size};save();}
 if(session.file_size!==file.size||!session.session_id||!Number.isInteger(session.part_size)||session.part_size<1||session.total_parts!==Math.ceil(file.size/session.part_size))throw Error('原上传会话与文件大小或分片规格不一致，请核对原文件');
 if(session.part_size!==requestedPartSize){onProgress('按原会话分片规格重新核验',8);hashes=await hashVideoInWorker(file,session.part_size,p=>onProgress('核验原会话分片 '+p+'%',8),signal);}
 if(hashes.partMd5s.length!==session.total_parts||hashes.partMd5s.some(h=>!/^[a-f0-9]{32}$/.test(h)))throw Error('分片校验值不完整，尚未上传');
 const sessionPath='/uploads/multipart/sessions/'+encodeURIComponent(session.session_id),receipts=new Map(validUploadedParts(session,file).map(p=>[p.part_number,p]));
 if(!['active','completed'].includes(session.status))throw Error('原上传会话已结束，文件未重新上传，请在云管家核对');
 if(session.status==='active')for(let n=1;n<=session.total_parts;n++){
  checkUploadSignal(signal);if(receipts.has(n))continue;const start=(n-1)*session.part_size,blob=file.slice(start,Math.min(file.size,start+session.part_size));const total=()=>[...receipts.values()].reduce((sum,p)=>sum+p.size,0);const progress=loaded=>onProgress(`正在上传第 ${n}/${session.total_parts} 片`,Math.min(96,8+88*(total()+loaded)/file.size));
  let receipt;
  try{const result=await cloudUploadJson(base,sessionPath+'/parts',{body:{part_numbers:[n]},signal}),ticket=result.items?.find(p=>p.part_number===n);if(!ticket)throw Error('原会话未返回当前分片地址');const signed=new URL(ticket.upload_url);if(signed.protocol!=='https:')throw Error('分片地址不是有效的安全上传入口');const etag=await withCloudUploadLease(base,session.session_id,s=>xhrUploadPart(signed.href,blob,ticket.headers,{signal:s,onProgress:progress}),{signal,onProgress:label=>onProgress(label,8+88*total()/file.size)});if(etag)receipt={part_number:n,etag,size:blob.size};}
  catch(error){checkUploadSignal(signal);onProgress('正在核对第 '+n+' 片的原上传结果',8+88*total()/file.size);}
  if(!receipt){const latest=await cloudUploadJson(base,sessionPath,{signal});for(const p of validUploadedParts(latest,file))receipts.set(p.part_number,p);receipt=receipts.get(n);}
  if(!receipt){onProgress('通过云管家继续原会话第 '+n+' 片',8+88*total()/file.size);try{const etag=await withCloudUploadLease(base,session.session_id,s=>xhrUploadPart(new URL(base+sessionPath+'/relay-parts/'+n,location.origin).href,blob,{'Content-Type':'application/octet-stream','X-Upload-Part-MD5':hashes.partMd5s[n-1]},{sameOrigin:true,signal:s,onProgress:progress,timeout:180000}),{signal,onProgress:label=>onProgress(label,8+88*total()/file.size)});if(!etag)throw Error('云管家尚未返回分片回执');receipt={part_number:n,etag,size:blob.size};}catch(error){checkUploadSignal(signal);const latest=await cloudUploadJson(base,sessionPath,{signal});receipt=validUploadedParts(latest,file).find(p=>p.part_number===n);if(!receipt)throw Error(error.message+'；原上传会话已保留。');}}
  receipts.set(n,receipt);onProgress('已核验 '+receipts.size+'/'+session.total_parts+' 个分片',8+88*total()/file.size);
 }
 if(session.status!=='completed'){onProgress('正在核验合并后的视频',97);try{session=await cloudUploadJson(base,sessionPath+'/complete',{body:{parts:[...receipts.values()].sort((a,b)=>a.part_number-b.part_number),sha256:hashes.sha256},signal});}catch(error){checkUploadSignal(signal);session=await cloudUploadJson(base,sessionPath,{signal});if(session.status!=='completed')throw Error('视频合并结果待核验，原会话已保留，请稍后继续。');}}
 if(session.status!=='completed')throw Error('云端文件尚未完成，原任务已保留');
 // Recover uncertain material registration by the exact server object key,
 // never by filename alone and never by sending another blind completion.
 const known=await cloudUploadJson(base,'/assets?asset_scope=marketing_video&mine_only=true&sort=newest&page_size=100&q='+encodeURIComponent(file.name),{signal});const prior=(known.items||[]).find(a=>a.object_key===session.object_key);
 if(prior){record.assetId=prior.id;record.phase='ready';save();onProgress('原视频已保存，正在关联任务',100);return prior;}
 if(record.phase==='materializing')throw Error('原视频已上传，素材建档回执仍待核验。请在云管家查到原素材后关联，避免重复建档。');
 record.phase='materializing';save();onProgress('正在保存云管家素材记录',98);
 try{const asset=await cloudUploadJson(base,'/uploads/complete',{body:{session_id:session.session_id,object_key:session.object_key,filename:file.name,category,content_type:contentType,asset_scope:'marketing_video',library_type:libraryType,tags:[]},signal});record.assetId=asset.id;record.phase='ready';save();onProgress('视频已保存，正在关联原任务',100);return asset;}
 catch(error){checkUploadSignal(signal);const result=await cloudUploadJson(base,'/assets?asset_scope=marketing_video&mine_only=true&sort=newest&page_size=100&q='+encodeURIComponent(file.name),{signal});const found=(result.items||[]).find(a=>a.object_key===session.object_key);if(found){record.assetId=found.id;record.phase='ready';save();return found;}throw Error('视频已上传，素材建档回执待核验。原会话保留，请到云管家确认后关联原素材。');}
}
