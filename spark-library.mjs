import {existsSync,readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,copyFileSync,statSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {enforceConfirmedAdmission} from './admission-policy.mjs';

export class SparkError extends Error {
  constructor(status,message,code='SPARK_INVALID',extra={}){super(message);this.status=status;this.code=code;this.extra=extra;}
}
const need=(ok,message,status=400,code='SPARK_INVALID',extra={})=>{if(!ok)throw new SparkError(status,message,code,extra);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const iso=()=>new Date().toISOString();
const fields=['business','execution','evidence','reuse'];
const statuses=new Set(['draft','published','implemented','failed']);
const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const text=(v,max,field,required=false)=>{
  need(v===undefined||typeof v==='string',field+'必须为文字');
  const s=String(v??'').trim();need(s.length<=max,field+'过长');need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s),field+'包含不可用字符');
  if(required)need(s.length>0,field+'不能为空');return s;
};
const id=v=>{const s=text(v,180,'标识',true);need(/^[A-Za-z0-9_.:#/-]+$/u.test(s),'标识格式无效');return s;};
const url=v=>{const s=text(v,4000,'来源链接');if(!s)return '';let u;try{u=new URL(s);}catch{throw new SparkError(400,'来源链接无效');}
  need(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'来源链接必须使用 http(s)，且不能包含凭据');return s;};
const timestamp=(v,field,fallback='')=>{if(v===undefined||v===null||v==='')return fallback;const s=text(v,80,field,true);need(Number.isFinite(Date.parse(s)),field+'格式无效');return s;};
const safeJson=(v,field,maxBytes=250000)=>{
  let raw;try{raw=JSON.stringify(v??{});}catch{throw new SparkError(400,field+'必须是可保存的 JSON');}
  need(Buffer.byteLength(raw)<=maxBytes,field+'内容过大');const result=JSON.parse(raw);
  const walk=(x,depth=0)=>{need(depth<12,field+'结构过深');if(object(x)){for(const [k,a]of Object.entries(x)){need(!['__proto__','prototype','constructor'].includes(k),'不支持的字段');need(!/^(access_token|refresh_token|app_secret|client_secret|cookie|authorization|password)$/i.test(k),'不能保存凭据');walk(a,depth+1);}}else if(Array.isArray(x))x.forEach(a=>walk(a,depth+1));};
  walk(result);return result;
};

export function sparkAccessFor(payload={}){
  const w=payload.workspace||{},u=payload.user||{};
  const number=String(u.number||u.user_number||u.userNumber||u.employeeId||u.id||'').trim().toUpperCase();
  const role=String(w.spark_role??w.role??'external');
  const admitted=enforceConfirmedAdmission({status:200,payload}).status===200;
  const enabled=w.is_brand_department===true&&!!number&&payload.access?.master_access!==false&&admitted;
  return {enabled,canEdit:enabled&&['director','manager'].includes(role),user:{number,name:String(u.realName||u.real_name||u.name||''),role,center:String(w.center||u.center||'')}};
}
function previewAccess(preview,payload){
  if(!preview?.active)return sparkAccessFor(payload);
  const s=preview.subject;
  if(!s)return {enabled:false,canEdit:false,user:{number:'',name:'',role:'external',center:''}};
  const roleMap={'总监':'director','见习总监':'director','主管':'manager','主管/负责人':'manager','专员':'specialist',director:'director',manager:'manager',specialist:'specialist',maintainer:'maintainer',external:'external'};
  const role=roleMap[s.sparkRole??s.mappedRole??s.role]||'external';
  const active=(s.loginActive===true||s.login_active===true)&&s.loginActive!==false&&s.login_active!==false&&s.active!==false;
  const target={number:s.userNumber||s.user_number||s.number,realName:s.realName||s.real_name||s.name};
  if(!active||enforceConfirmedAdmission({status:200,payload:{user:target}}).status!==200)return {enabled:false,canEdit:false,user:{number:'',name:'',role:'external',center:''}};
  const a=sparkAccessFor({user:target,
    workspace:{role,center:s.center,is_brand_department:String(s.department||'').includes('品牌营销部')}});
  return {...a,canEdit:false};
}

export function validateSparkSource(value){
  need(object(value),'来源格式无效');
  const s={id:id(value.id),channel:text(value.channel,300,'来源名称',true),type:text(value.type,160,'来源类型'),
    author:text(value.author,160,'来源作者'),date:text(value.date,100,'来源日期'),
    url:url(value.url),quote:text(value.quote,50000,'原文',true),limitation:text(value.limitation,10000,'证据边界'),
    locator:text(value.locator,3000,'原文定位')};
  for(const k of ['chatId','senderId','rawFile','docToken','blockId','collectedAt','sourceCreatedAt','center','title','documentUrl','revision']){
    if(value[k]!==undefined)s[k]=text(String(value[k]),k==='rawFile'?1500:4000,'来源 '+k);
  }
  if(value.updated!==undefined){need(typeof value.updated==='boolean','来源更新标记无效');s.updated=value.updated;}
  if(value.updateTime!==undefined)s.updateTime=value.updateTime===null?null:text(String(value.updateTime),100,'来源更新日期');
  return s;
}
function sourceFact(s){return Object.fromEntries(Object.entries(s).filter(([k])=>!['version','history','createdAt','updatedAt','contentHash','batchId'].includes(k)));}
function sourceDigest(s){return digest(Object.fromEntries(Object.entries(sourceFact(s)).filter(([k])=>!['rawFile','collectedAt'].includes(k))));}
function sourceLocated(s){return !!(s?.quote&&s?.url&&s?.locator);}
export function validateSparkItem(value,sources,{now=iso(),allowMissingCreatedAt=true}={}){
  need(object(value),'条目格式无效');need(value.library!=='personal','本期仅导入部门库，不能导入个人库');
  need(value.library===undefined||['department','management'].includes(value.library),'星火库范围无效');
  const out={id:id(value.id),library:'department'};
  for(const [k,max,required]of [['title',200,true],['summary',6000,false],['category',160,false],['evidence',20000,false],['insight',12000,false],['action',12000,false],['validation',12000,false],['statusEvidence',12000,false],['center',160,false]]){
    out[k]=text(value[k],max,k,required);
  }
  out.date=text(value.date,40,'条目日期');if(out.date){need(/^\d{4}-\d{2}-\d{2}$/u.test(out.date)&&Number.isFinite(Date.parse(out.date)),'条目日期格式无效');need(new Date(out.date+'T00:00:00.000Z').toISOString().slice(0,10)===out.date,'条目日期不存在');}
  out.createdAt=timestamp(value.createdAt,'创建时间',allowMissingCreatedAt?now:'');
  out.status=value.status||'draft';need(statuses.has(out.status),'状态无效');
  need(Array.isArray(value.sourceIds),'条目必须提供来源关联数组');need(value.sourceIds.length<=100,'关联来源过多');
  out.sourceIds=[...new Set(value.sourceIds.map(id))];need(out.sourceIds.length===value.sourceIds.length,'关联来源不能重复');
  for(const sid of out.sourceIds)need(sources.has(sid),'条目关联了不存在的来源：'+sid);
  if(out.status!=='draft'){
    need(out.sourceIds.length>0&&out.sourceIds.every(sid=>sourceLocated(sources.get(sid))),'非草稿必须关联可定位的原文、来源链接和定位信息');
    need(out.statusEvidence.trim().length>0,'非草稿必须填写状态佐证');
    if(['implemented','failed'].includes(out.status))need(Array.from(out.statusEvidence.replace(/\s/gu,'')).length>=12,'已实施或已失败需要至少 12 字的结果佐证');
  }
  need(object(value.scoreDimensions),'必须填写四项评分');
  out.scoreDimensions={};out.scoreReasons={};
  need(value.scoreReasons===undefined||object(value.scoreReasons),'评分理由格式无效');
  for(const k of fields){const n=value.scoreDimensions[k];need(Number.isInteger(n)&&n>=0&&n<=5,'评分必须是 0 到 5 的整数');out.scoreDimensions[k]=n;out.scoreReasons[k]=text(value.scoreReasons?.[k],5000,'评分理由');}
  out.score=out.scoreDimensions.business*7+out.scoreDimensions.execution*5+out.scoreDimensions.evidence*5+out.scoreDimensions.reuse*3;
  return out;
}

function procStart(pid){try{const s=readFileSync('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19];}catch{return null;}}
function bootId(){try{return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();}catch{return null;}}
function owner(){return {pid:process.pid,host:hostname(),boot:bootId(),start:procStart(process.pid)};}
function recoverDeadLock(file){
  let guard;try{guard=openSync(file+'.recovery-guard','wx',0o600);}catch{return false;}
  try{
    let raw,o;try{raw=readFileSync(file,'utf8');o=JSON.parse(raw);}catch{return false;}
    if(!Number.isInteger(o.pid)||o.pid<=0||o.host!==hostname())return false;
    let dead=false;
    if(o.boot&&bootId()&&o.boot!==bootId())dead=true;
    else if(o.start){const current=procStart(o.pid);if(current)dead=current!==o.start;else{try{process.kill(o.pid,0);}catch(e){dead=e.code==='ESRCH';}}}
    else{try{process.kill(o.pid,0);}catch(e){dead=e.code==='ESRCH';}}
    if(!dead)return false;
    if(readFileSync(file,'utf8')!==raw)return false;
    renameSync(file,file+'.recovered.'+Date.now()+'.'+randomUUID());return true;
  }catch{return false;}finally{closeSync(guard);unlinkSync(file+'.recovery-guard');}
}
const emptyStore=()=>({schemaVersion:1,revision:0,items:[],sources:[],coverage:{state:'pending',message:'尚未导入真实来源'},runs:[],events:[],batches:{},updatedAt:null,lastSuccessfulAt:null});
function normalizeStore(value){
  need(object(value)&&value.schemaVersion===1&&Number.isSafeInteger(value.revision)&&value.revision>=0&&Array.isArray(value.items)&&Array.isArray(value.sources)&&Array.isArray(value.runs)&&Array.isArray(value.events)&&object(value.batches),
    '星火库记录格式异常，已保护原文件，请联系维护人',503,'SPARK_STORE_CORRUPT');
  return value;
}
export class SparkLibraryStore{
  constructor(root){need(typeof root==='string'&&root.length>0,'必须指定星火库存储目录',500);this.root=resolve(root);this.file=join(this.root,'spark-library.json');}
  read(){
    if(!existsSync(this.file))return emptyStore();
    try{need(statSync(this.file).size<=64*1024*1024,'星火库文件过大，请联系维护人',503,'SPARK_STORE_CORRUPT');return normalizeStore(JSON.parse(readFileSync(this.file,'utf8')));}
    catch(e){throw e instanceof SparkError?e:new SparkError(503,'星火库记录暂不可读，已保护原文件，请联系维护人','SPARK_STORE_CORRUPT');}
  }
  transaction(fn){
    mkdirSync(this.root,{recursive:true,mode:0o700});const lockPath=this.file+'.lock';let lock,tmp;
    try{lock=openSync(lockPath,'wx',0o600);}catch{if(recoverDeadLock(lockPath)){try{lock=openSync(lockPath,'wx',0o600);}catch{}}}
    need(lock!==undefined,'星火库正在保存，请刷新读回后再试',503,'SPARK_STORE_BUSY');
    try{
      writeFileSync(lock,JSON.stringify(owner()));fsyncSync(lock);
      const state=this.read(),result=fn(state);need(!result?.then,'存储事务不能包含异步操作',500);
      if(result?.noWrite)return structuredClone(result.value);
      state.revision++;state.updatedAt=iso();
      need(state.items.length<=10000&&state.sources.length<=30000,'星火库已达到当前容量，请联系维护人',413);
      if(existsSync(this.file))copyFileSync(this.file,this.file+'.previous.json');
      tmp=this.file+'.'+process.pid+'.'+randomUUID()+'.tmp';const fd=openSync(tmp,'wx',0o600);
      try{const raw=JSON.stringify(state);need(Buffer.byteLength(raw)<=64*1024*1024,'星火库已达到当前容量',413);writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(tmp,this.file);tmp=null;
      if(process.platform!=='win32'){const fd=openSync(dirname(this.file),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
      return structuredClone({...result,revision:state.revision,updatedAt:state.updatedAt});
    }finally{if(tmp&&existsSync(tmp))unlinkSync(tmp);closeSync(lock);unlinkSync(lockPath);}
  }
}
function event(state,action,actor,details={}){
  state.events.push({id:'spark_event_'+randomUUID().replaceAll('-',''),action,by:actor,at:iso(),...details});
  if(state.events.length>10000)state.events=state.events.slice(-10000);
}
const sourceMap=state=>new Map(state.sources.map(s=>[s.id,s]));
const sourceRevisions=(item,sources)=>Object.fromEntries(item.sourceIds.map(sid=>[sid,sources.get(sid)?.version||1]));
const actorFor=a=>({number:a.user.number,name:a.user.name,role:a.user.role});
function decoratedItem(item,sources){
  const changes=item.sourceIds.filter(sid=>(item.sourceRevisions?.[sid]||1)<(sources.get(sid)?.version||1)).map(sid=>({sourceId:sid,recordedVersion:item.sourceRevisions?.[sid]||1,currentVersion:sources.get(sid)?.version||1}));
  return {...item,sourceReviewRequired:changes.length>0,sourceCorrections:changes};
}
export function readSparkOverview(store,access){
  const state=store.read(),sources=sourceMap(state);
  return {ok:true,revision:state.revision,items:state.items.map(i=>decoratedItem(i,sources)),sources:state.sources,coverage:state.coverage,runs:state.runs.slice(-100),access:{canEdit:access.canEdit,role:access.user.role,userNumber:access.user.number,center:access.user.center},updatedAt:state.updatedAt,lastSuccessfulAt:state.lastSuccessfulAt};
}
export function createSparkItem(store,input,access,requestId=''){
  const key=requestId?text(requestId,200,'幂等标识'):null;
  return store.transaction(state=>{
    const d=digest(input),dedupe=key?'manual:'+access.user.number+':'+key:null;
    if(dedupe&&state.batches[dedupe]){
      const old=state.batches[dedupe];need(old.digest===d,'同一请求标识不能用于不同内容',409,'SPARK_IDEMPOTENCY_CONFLICT');
      return {noWrite:true,value:{...old.result,idempotent:true,revision:state.revision}};
    }
    const values={...input,id:input?.id||'spark_'+randomUUID().replaceAll('-','')};
    const item=validateSparkItem(values,sourceMap(state));need(!state.items.some(i=>i.id===item.id),'条目标识已存在，请读取已有条目',409,'SPARK_ITEM_EXISTS');
    const now=iso(),actor=actorFor(access);
    Object.assign(item,{version:1,createdAt:now,updatedAt:now,updatedBy:actor,createdBy:actor,manuallyEdited:true,sourceRevisions:sourceRevisions(item,sourceMap(state)),statusHistory:[{from:null,to:item.status,at:now,note:item.statusEvidence||'人工新增草稿',by:actor}]});
    state.items.push(item);event(state,'item_created',actor,{itemId:item.id});
    const result={ok:true,item};
    if(dedupe)state.batches[dedupe]={digest:d,result,at:now};
    return result;
  });
}
export function patchSparkItem(store,itemId,input,expectedVersion,access){
  return store.transaction(state=>{
    const index=state.items.findIndex(i=>i.id===itemId);need(index>=0,'条目不存在',404);
    const old=state.items[index];
    need(Number.isSafeInteger(expectedVersion)&&expectedVersion===old.version,'条目已被更新，请保留当前输入并重新读取',409,'SPARK_VERSION_CONFLICT',{currentVersion:old.version});
    need(!input?.id||input.id===itemId,'不能改变条目标识');
    const merged={...old,...input,id:itemId,createdAt:old.createdAt};
    const item=validateSparkItem(merged,sourceMap(state)),now=iso(),actor=actorFor(access);
    Object.assign(item,{createdBy:old.createdBy,version:old.version+1,updatedAt:now,updatedBy:actor,manuallyEdited:true,sourceRevisions:sourceRevisions(item,sourceMap(state)),statusHistory:old.statusHistory||[]});
    if(old.status!==item.status||old.statusEvidence!==item.statusEvidence)item.statusHistory=[...item.statusHistory,{from:old.status,to:item.status,at:now,note:item.statusEvidence||'退回草稿',by:actor}];
    if(old.importedAt)item.importedAt=old.importedAt;if(old.batchId)item.batchId=old.batchId;
    state.items[index]=item;event(state,'item_updated',actor,{itemId,fromVersion:old.version,toVersion:item.version,fromStatus:old.status,toStatus:item.status});
    return {ok:true,item};
  });
}

function validateBatch(batch,state){
  need(object(batch),'导入批次格式无效');const batchId=text(batch.batchId,200,'批次标识',true);
  need(!batchId.startsWith('manual:'),'批次标识使用了保留前缀');
  need(batch.conflictPolicy===undefined||batch.conflictPolicy==='keep-existing','导入只支持保留已有条目');
  need(batch.expectedRevision===undefined||(Number.isSafeInteger(batch.expectedRevision)&&batch.expectedRevision>=0),'导入版本无效');
  need(batch.run===undefined||object(batch.run),'采集记录必须为对象');
  need(batch.coverage===undefined||object(batch.coverage),'采集覆盖范围必须为对象');
  const raw=safeJson(batch,'导入批次',8*1024*1024),run=safeJson(batch.run||{},'采集记录',100000);
  const status=run.status||(run.success===false?'failed':'success');need(['success','partial','failed'].includes(status),'采集状态无效');
  need(batch.items===undefined||Array.isArray(batch.items),'导入条目必须为数组');need(batch.sources===undefined||Array.isArray(batch.sources),'导入来源必须为数组');
  if(status==='failed')need(!(batch.items?.length||batch.sources?.length),'失败批次只能记录失败，不可同时更改来源');
  const sources=(batch.sources||[]).map(validateSparkSource);need(sources.length<=5000,'单批来源过多');
  need(new Set(sources.map(s=>s.id)).size===sources.length,'同批来源 ID 重复');
  const all=new Map([...state.sources.map(s=>[s.id,s]),...sources.map(s=>[s.id,s])]);
  const items=(batch.items||[]).map(v=>validateSparkItem(v,all));need(items.length<=5000,'单批条目过多');
  need(new Set(items.map(i=>i.id)).size===items.length,'同批条目 ID 重复');
  const coverage=batch.coverage===undefined?undefined:safeJson(batch.coverage,'采集覆盖范围');
  return {batchId,digest:digest(raw),sources,items,run:{...run,status},coverage};
}
export function validateSparkBatch(batch,store){const v=validateBatch(batch,store.read());return {ok:true,batchId:v.batchId,digest:v.digest,items:v.items.length,sources:v.sources.length,status:v.run.status};}
export function importSparkBatch(store,batch,actor={number:'system:collector',name:'部门星火库每日采集',role:'system'}){
  return store.transaction(state=>{
    const b=validateBatch(batch,state),old=state.batches[b.batchId];
    if(old){need(old.digest===b.digest,'该批次已导入，但内容不同；请核对来源和批次标识',409,'SPARK_BATCH_CONFLICT');return {noWrite:true,value:{...old.result,revision:state.revision,idempotent:true}};}
    need(batch.expectedRevision===undefined||batch.expectedRevision===state.revision,'星火库已更新，请保留导入文件并重新核对',409,'SPARK_REVISION_CONFLICT',{currentRevision:state.revision});
    const at=iso(),result={ok:true,batchId:b.batchId,digest:b.digest,addedItems:0,protectedItems:[],addedSources:0,correctedSources:[],status:b.run.status};
    if(b.run.status!=='failed'){
      for(const source of b.sources){
        const index=state.sources.findIndex(s=>s.id===source.id),hash=sourceDigest(source);
        if(index<0){state.sources.push({...source,contentHash:hash,version:1,createdAt:at,updatedAt:at,batchId:b.batchId,history:[]});result.addedSources++;}
        else{
          const existing=state.sources[index];
          if((existing.contentHash||sourceDigest(existing))!==hash){
            const history=[...(existing.history||[]),{version:existing.version||1,contentHash:existing.contentHash||sourceDigest(existing),source:sourceFact(existing),at:existing.updatedAt||at,batchId:existing.batchId||null}];
            state.sources[index]={...source,contentHash:hash,version:(existing.version||1)+1,createdAt:existing.createdAt||at,updatedAt:at,batchId:b.batchId,history};
            result.correctedSources.push({id:source.id,fromVersion:existing.version||1,toVersion:(existing.version||1)+1});event(state,'source_corrected',actor,{sourceId:source.id,batchId:b.batchId});
          }
        }
      }
      const sources=sourceMap(state);
      for(const incoming of b.items){
        const old=state.items.find(i=>i.id===incoming.id);
        if(old){
          // Existing cards are never overwritten by collection, including a new batch with the same card ID.
          result.protectedItems.push({id:incoming.id,version:old.version,manuallyEdited:!!old.manuallyEdited,reason:'已有条目保留，请在页面审阅后修改'});continue;
        }
        const item={...incoming,version:1,updatedAt:at,updatedBy:actor,createdBy:actor,manuallyEdited:false,importedAt:at,batchId:b.batchId,sourceRevisions:sourceRevisions(incoming,sources),
          statusHistory:[{from:null,to:incoming.status,at,note:incoming.statusEvidence||'依据真实来源导入草稿，待管理人审阅',by:actor}]};
        state.items.push(item);result.addedItems++;
      }
      if(b.coverage!==undefined)state.coverage=b.coverage;
      if(b.run.status==='success')state.lastSuccessfulAt=at;
    }
    state.runs.push({...b.run,batchId:b.batchId,digest:b.digest,recordedAt:at,addedItems:result.addedItems,addedSources:result.addedSources,correctedSources:result.correctedSources.length,protectedItems:result.protectedItems.length});
    if(state.runs.length>1000)state.runs=state.runs.slice(-1000);
    event(state,b.run.status==='failed'?'ingest_failed':'batch_imported',actor,{batchId:b.batchId,addedItems:result.addedItems,correctedSources:result.correctedSources.length});
    state.batches[b.batchId]={digest:b.digest,at,result};
    return result;
  });
}
function writeGate(req){
  need(req.headers['x-spark-request']==='1','请从星火库页面提交操作',403,'SPARK_WRITE_ORIGIN');
  need(String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'),'请求必须使用 JSON',415);
  need(req.headers['sec-fetch-site']!=='cross-site','不接受跨站请求',403,'SPARK_WRITE_ORIGIN');
  if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{throw new SparkError(403,'请求来源无效');}need(['http:','https:'].includes(origin.protocol)&&origin.host===req.headers.host,'不接受跨站请求',403,'SPARK_WRITE_ORIGIN');}
}
export function createSparkLibraryHandler({root,currentSession,previewFor=()=>null,sendJson,readJson}){
  const store=new SparkLibraryStore(root);
  const readInput=async(req,maxBytes)=>{try{return await readJson(req,maxBytes);}catch(e){if(e instanceof SparkError)throw e;throw new SparkError(/过大|too large|limit/i.test(String(e.message))?413:400,'提交内容无效或超过大小限制，已有数据已保留');}};
  return async(req,res,url)=>{
    if(url.pathname!=='/api/spark-library'&&!url.pathname.startsWith('/api/spark-library/'))return false;
    try{
      const session=await currentSession(req);if(session.status!==200){sendJson(res,session.status,session.payload);return true;}
      const real=sparkAccessFor(session.payload);need(real.enabled,'部门星火库向已获准登录的品牌营销部成员开放',403,'SPARK_ACCESS_DENIED');
      const preview=previewFor(req,session.payload),access=previewAccess(preview,session.payload);
      need(access.enabled,'当前预览身份不能访问部门星火库',403,'SPARK_PREVIEW_DENIED');
      const method=req.method||'GET',path=url.pathname.slice('/api/spark-library'.length);
      if(method==='GET'&&['','/','/export'].includes(path)){
        const output=readSparkOverview(store,access);
        if(path==='/export')Object.assign(output,{schemaVersion:1,exportedAt:iso(),scope:'department'});
        sendJson(res,200,output);return true;
      }
      const match=path.match(/^\/items\/([^/]+)$/u);
      if(method==='GET'&&match){let itemId;try{itemId=decodeURIComponent(match[1]);}catch{throw new SparkError(400,'条目标识无效');}
        const all=readSparkOverview(store,access),item=all.items.find(i=>i.id===itemId);need(item,'条目不存在',404);sendJson(res,200,{ok:true,item,sources:all.sources.filter(s=>item.sourceIds.includes(s.id)),revision:all.revision,access:all.access});return true;}
      if(method==='GET')throw new SparkError(404,'星火库接口不存在');
      need(!preview?.active,'请退出权限预览后修改星火库',403,'SPARK_PREVIEW_READONLY');
      need(real.canEdit,'当前身份可查看部门星火库，编辑和导入需负责人或主管权限',403,'SPARK_WRITE_DENIED');writeGate(req);
      if(path==='/items'&&method==='POST'){
        const body=await readInput(req,1024*1024);need(object(body)&&object(body.item),'条目内容无效');
        const result=createSparkItem(store,body.item,real,req.headers['idempotency-key']||'');sendJson(res,201,result);return true;
      }
      if(match&&method==='PATCH'){
        let itemId;try{itemId=id(decodeURIComponent(match[1]));}catch(e){throw e instanceof SparkError?e:new SparkError(400,'条目标识无效');}
        const body=await readInput(req,1024*1024);need(object(body)&&object(body.item),'条目内容无效');
        sendJson(res,200,patchSparkItem(store,itemId,body.item,body.expectedVersion,real));return true;
      }
      if(path==='/import'&&method==='POST'){
        sendJson(res,200,importSparkBatch(store,await readInput(req,8*1024*1024),actorFor(real)));return true;
      }
      throw new SparkError(['/items','/import','','/','/export'].includes(path)||match?405:404,'请求方式或接口不支持');
    }catch(e){
      sendJson(res,e instanceof SparkError?e.status:503,{ok:false,code:e instanceof SparkError?e.code:'SPARK_UNAVAILABLE',detail:e instanceof SparkError?e.message:'星火库请求暂未完成，请刷新核对；已有数据已保留',...(e instanceof SparkError?e.extra:{})});return true;
    }
  };
}
