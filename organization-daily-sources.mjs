// Governed display-only snapshots. No CLI, credentials, network, role assignment or timers.
import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat,mkdir,open,rename,unlink,link} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export const ORGANIZATION_SOURCE_KEYS=Object.freeze(['organization','reportingDirectory','meetingEvidence','meetingIntelligence']);
const STATES=new Set(['ready','partial','failed','pending']);
const READ_STATES=new Set(['readable','blocked','blank','unverified','error']);
const DATE=/^\d{4}-\d{2}-\d{2}$/,HASH=/^[a-f0-9]{64}$/;
const MAX_BYTES=8*1024*1024;
const emptySources=()=>Object.fromEntries(ORGANIZATION_SOURCE_KEYS.map(k=>[k,null]));
const clone=v=>structuredClone(v);
const sha=data=>createHash('sha256').update(data).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function check(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'ORGANIZATION_SOURCE_INVALID'});}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function string(v){return typeof v==='string'&&v.trim().length>0;}
function timestamp(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));}
function date(v){return typeof v==='string'&&DATE.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function https(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
function fieldsExactly(value,allowed){check(Object.keys(value).every(key=>allowed.includes(key)),'Unexpected source key');}
function noCredentials(value){
 if(!value||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  check(!/^(password|cookie|authorization|access_token|refresh_token|tenant_access_token|app_secret|client_secret|private_key)$/i.test(key),'Credentials must not be published with display sources');
  noCredentials(item);
 }
}
function evidence(v){
 return object(v)&&HASH.test(v.sha256)&&timestamp(v.readAt)&&https(v.sourceUrl);
}
function counters(items){
 const result={dailyRecords:items.length,readableRecords:0,blockedRecords:0,blankRecords:0,unverifiedRecords:0,errorRecords:0};
 for(const item of items)result[({readable:'readableRecords',blocked:'blockedRecords',blank:'blankRecords',unverified:'unverifiedRecords',error:'errorRecords'})[item.readState]]++;
 return result;
}

export function validateSourceData(key,data){
 check(ORGANIZATION_SOURCE_KEYS.includes(key)&&object(data),'Invalid source payload');
 noCredentials(data);
 check(data.factsDate===null||date(data.factsDate),'Payload factsDate must be an explicit date or null');
 check(object(data.sourceMetadata)&&['user','application'].includes(data.sourceMetadata.identity)
   &&timestamp(data.sourceMetadata.readAt)&&https(data.sourceMetadata.sourceUrl),'Source requires verified read provenance');
 check(HASH.test(data.sourceMetadata.rawSha256),'Missing/invalid original-source hash');
 fieldsExactly(data.sourceMetadata,['identity','readAt','sourceUrl','rawSha256','documentId','appToken','tableId','fieldIds','revision']);
 if(key==='organization'){
  check(Array.isArray(data.centers)&&data.centers.every(string)&&Array.isArray(data.leaders)
    &&data.leaders.every(v=>object(v)&&string(v.center)&&string(v.name))&&Array.isArray(data.snapshots),'Invalid organization display data');
 }else if(key==='reportingDirectory'){
  check(Array.isArray(data.entries),'Directory entries missing');
  for(const entry of data.entries){
   check(object(entry)&&string(entry.center)&&Array.isArray(entry.reports)&&Array.isArray(entry.dashboards),'Invalid report directory row');
   check([...entry.reports,...entry.dashboards].every(v=>object(v)&&string(v.title)&&https(v.url)),'Invalid report directory link');
  }
 }else if(key==='meetingEvidence'){
  check(date(data.factsDate)&&Array.isArray(data.items),'Meeting facts require a business date and items');
  const ids=new Set();
  for(const item of data.items){
   check(object(item)&&string(item.id)&&!ids.has(item.id)&&item.date===data.factsDate
     &&string(item.center)&&string(item.title)&&READ_STATES.has(item.readState),'Invalid/duplicate/date-mismatched meeting');
   ids.add(item.id);
   for(const name of ['minutesUrl','transcriptUrl'])check(item[name]==null||https(item[name]),'Invalid meeting source link');
   if(item.readState==='readable')check(evidence(item.readEvidence)
     &&[item.transcriptUrl,item.minutesUrl].includes(item.readEvidence.sourceUrl),
     'A source link alone does not prove meeting document readability');
  }
  const count=counters(data.items);
  for(const [key,value] of Object.entries(count))if(data[key]!==undefined)check(data[key]===value,'Meeting coverage differs from per-record read evidence');
 }else{
  check(date(data.factsDate)&&Array.isArray(data.profiles),'Meeting analysis requires a business date and profiles');
  for(const item of data.profiles){
   check(object(item)&&string(item.center)&&Array.isArray(item.evidence),'Invalid meeting profile');
   // This collector only republishes verified facts. Scoring needs a separately validated analysis.
   for(const score of ['vitalityScore','heatScore','saturationScore'])check(item[score]==null,'Daily source collection must not invent a score');
  }
 }
 return data;
}

function descriptor(key,value){
 check(object(value)&&value.file==='objects/'+value.sha256+'.json'&&HASH.test(value.sha256)
   &&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=MAX_BYTES,'Invalid immutable source descriptor');
 check(timestamp(value.lastSuccessAt)&&(value.factsDate===null||date(value.factsDate))
   &&https(value.sourceUrl)&&(value.sourceRevision===null||string(value.sourceRevision)||Number.isFinite(value.sourceRevision)),'Invalid source metadata');
}
export function validateManifest(value){
 check(object(value)&&value.schemaVersion===1&&/^[a-zA-Z0-9_-]{1,100}$/.test(value.generationId)
   &&timestamp(value.publishedAt)&&object(value.sources),'Invalid publication manifest');
 fieldsExactly(value.sources,ORGANIZATION_SOURCE_KEYS);
 for(const key of ORGANIZATION_SOURCE_KEYS){check(Object.hasOwn(value.sources,key),'Manifest source slot missing');if(value.sources[key]!==null)descriptor(key,value.sources[key]);}
 noCredentials(value);return value;
}
export function validateStatus(value){
 check(object(value)&&value.schemaVersion===1&&timestamp(value.updatedAt)&&timestamp(value.lastAttemptAt)
   &&timestamp(value.nextDueAt)&&date(value.requiredBusinessDate)&&object(value.sources),'Invalid attempt status');
 fieldsExactly(value.sources,ORGANIZATION_SOURCE_KEYS);
 for(const key of ORGANIZATION_SOURCE_KEYS){
  const item=value.sources[key];
  check(object(item)&&STATES.has(item.state)&&timestamp(item.lastAttemptAt)
    &&(item.lastSuccessAt===null||timestamp(item.lastSuccessAt))
    &&(item.factsDate===null||date(item.factsDate))
    &&(item.error===null||typeof item.error==='string'&&item.error.length<=500),'Invalid per-source attempt status');
 }
 noCredentials(value);return value;
}

async function regular(path){
 const info=await lstat(path);check(info.isFile()&&!info.isSymbolicLink(),'Unexpected snapshot file/link');
 check(info.size<=MAX_BYTES,'Snapshot file exceeds maximum size');return info;
}
async function actualDirectory(path){
 const info=await lstat(path);check(info.isDirectory()&&!info.isSymbolicLink(),'Unexpected snapshot directory/link');
}
async function jsonFile(path){
 await regular(path);
 const content=await readFile(path);
 check(content.length<=MAX_BYTES,'Snapshot content exceeds maximum size');
 return JSON.parse(content.toString('utf8'));
}
async function fsyncDirectory(root){
 if(process.platform==='win32')return;
 const handle=await open(root,'r');try{await handle.sync();}finally{await handle.close();}
}
async function writeAtomic(root,name,content,{exclusive=false}={}){
 const target=join(root,name),temp=join(root,'.tmp-'+randomUUID());
 let file;
 try{
  file=await open(temp,'wx',0o600);await file.writeFile(content);await file.sync();await file.close();file=null;
  if(exclusive){
   // Atomic no-replace publication of a fully synced immutable object.
   await link(temp,target);
  }else{await rename(temp,target);}
  await fsyncDirectory(root);
 }finally{if(file)await file.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

export class OrganizationSourceStore{
 constructor(root){this.root=resolve(root);this.lastGood=null;}
 async verifiedManifest(){
  await actualDirectory(this.root);
  const manifest=validateManifest(await jsonFile(join(this.root,'manifest.json'))),sources=emptySources();
  await actualDirectory(join(this.root,'objects'));
  for(const key of ORGANIZATION_SOURCE_KEYS){
   const entry=manifest.sources[key];if(!entry)continue;
   const path=join(this.root,entry.file),info=await regular(path),data=await readFile(path);
   check(info.size===entry.bytes&&data.length===entry.bytes&&sha(data)===entry.sha256,'Source object hash/size mismatch');
   sources[key]=validateSourceData(key,JSON.parse(data.toString('utf8')));
   check(sources[key].factsDate===entry.factsDate
     &&sources[key].sourceMetadata.sourceUrl===entry.sourceUrl
     &&Date.parse(sources[key].sourceMetadata.readAt)<=Date.parse(entry.lastSuccessAt),'Source object provenance differs from manifest');
  }
  return {manifest,sources};
 }
 async read({requiredBusinessDate,now=new Date()}={}){
  check(date(requiredBusinessDate),'Current business date is required for freshness checks');
  const at=new Date(now).toISOString();let loaded,readError=null,status=null,statusError=null;
  try{loaded=await this.verifiedManifest();this.lastGood=clone(loaded);}
  catch(error){readError=error.code==='ENOENT'?'尚未发布可核验的组织来源':'来源文件未通过校验，保留本进程最近成功读取';loaded=this.lastGood?clone(this.lastGood):{manifest:null,sources:emptySources()};}
  try{status=validateStatus(await jsonFile(join(this.root,'status.json')));}
  catch(error){statusError=error.code==='ENOENT'?'每日读取状态尚未登记':'每日读取状态未通过校验';}
  const states={};
  for(const key of ORGANIZATION_SOURCE_KEYS){
   const entry=loaded.manifest?.sources[key],attempt=status?.sources[key],businessSource=key==='meetingEvidence'||key==='meetingIntelligence';
   const matchesBusinessDate=Boolean(entry&&(!businessSource||entry.factsDate===requiredBusinessDate));
   const attemptAfterSuccess=attempt&&(!entry||attempt.lastSuccessAt===entry.lastSuccessAt
     ||Date.parse(attempt.lastAttemptAt)>=Date.parse(entry.lastSuccessAt));
   const failed=attemptAfterSuccess&&attempt.state==='failed';
   const pending=attemptAfterSuccess&&attempt.state==='pending';
   const overdue=Boolean(status&&Date.parse(status.nextDueAt)<Date.parse(at));
   let state=!entry?'pending':readError||failed||businessSource&&!matchesBusinessDate?'stale'
     :pending?'pending':overdue?'stale':attemptAfterSuccess&&attempt.state==='partial'?'partial':'ready';
   if(statusError&&state==='ready')state='partial';
   const note=readError||(!entry?'尚无可核验来源'
     :businessSource&&!matchesBusinessDate?'当前需要 '+requiredBusinessDate+'，资料仍为 '+entry.factsDate
     :failed?'本次读取失败，保留最近成功业务事实':pending?'正在读取新资料，保留最近成功事实'
     :overdue?'计划读取时间已过，尚无新的执行回执'
     :!businessSource?'参考资料；读取时间不代表今天的业务已完成'
     :statusError||'来源与所需业务日期匹配');
   states[key]={state,lastAttemptAt:attempt?.lastAttemptAt||null,lastSuccessAt:entry?.lastSuccessAt||null,
    factsDate:entry?.factsDate??null,requiredBusinessDate:businessSource?requiredBusinessDate:null,matchesBusinessDate,
    nextDueAt:status?.nextDueAt||null,scheduleOverdue:overdue,error:failed?attempt.error:readError||statusError,note};
  }
  return {schemaVersion:1,generationId:loaded.manifest?.generationId||null,readAt:at,
   requiredBusinessDate,sources:loaded.sources,status:states,scheduler:status?{lastAttemptAt:status.lastAttemptAt,nextDueAt:status.nextDueAt,updatedAt:status.updatedAt}:null};
 }
 async publish({generationId,publishedAt,sources,expectedGeneration=null}){
  check(object(sources)&&Object.keys(sources).length,'No successful source objects supplied');
  fieldsExactly(sources,ORGANIZATION_SOURCE_KEYS);
  await mkdir(this.root,{recursive:true,mode:0o700});await actualDirectory(this.root);
  const lockPath=join(this.root,'.publication.lock'),lock=await open(lockPath,'wx',0o600),ownedLock=await lock.stat();
  try{
   let prior=null;
   try{prior=await this.verifiedManifest();}
   catch(error){if(error.code!=='ENOENT')throw error;const marker=await lstat(join(this.root,'manifest.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});check(!marker,'Existing publication cannot be read; no overwrite');}
   check((prior?.manifest.generationId||null)===expectedGeneration,'Publication generation changed; refresh before publishing');
   await mkdir(join(this.root,'objects'),{recursive:true,mode:0o700});await actualDirectory(join(this.root,'objects'));
   const entries=prior?clone(prior.manifest.sources):emptySources();
   for(const [key,item] of Object.entries(sources)){
    check(object(item),'Successful source object cannot be deleted or replaced with null');
    const payload=validateSourceData(key,item.data),content=bytes(payload),hash=sha(content);
   const entry={file:'objects/'+hash+'.json',sha256:hash,bytes:content.length,lastSuccessAt:item.lastSuccessAt,
     factsDate:payload.factsDate,sourceRevision:item.sourceRevision??null,sourceUrl:payload.sourceMetadata.sourceUrl};
    descriptor(key,entry);
    check(Date.parse(payload.sourceMetadata.readAt)<=Date.parse(entry.lastSuccessAt),'Success predates source read evidence');
    const target=join(this.root,entry.file);
    try{await regular(target);check(sha(await readFile(target))===hash,'Existing immutable source hash mismatch');}
    catch(error){if(error.code!=='ENOENT')throw error;await writeAtomic(join(this.root,'objects'),hash+'.json',content,{exclusive:true});}
    entries[key]=entry;
   }
   const manifest=validateManifest({schemaVersion:1,generationId,publishedAt,sources:entries});
   check(Object.values(entries).every(entry=>!entry||Date.parse(entry.lastSuccessAt)<=Date.parse(publishedAt)),'Publication predates verified success');
   await writeAtomic(this.root,'manifest.json',bytes(manifest));
   const readback=await this.verifiedManifest();check(readback.manifest.generationId===generationId,'Publication readback mismatch');
   this.lastGood=clone(readback);return clone(manifest);
  }finally{
   await lock.close();const current=await lstat(lockPath);
   check(current.dev===ownedLock.dev&&current.ino===ownedLock.ino&&!current.isSymbolicLink(),'Publication lock changed; foreign lock retained');
   await unlink(lockPath);
  }
 }
 async writeStatus(status){
  validateStatus(status);await mkdir(this.root,{recursive:true,mode:0o700});await actualDirectory(this.root);
  const lockPath=join(this.root,'.status.lock'),lock=await open(lockPath,'wx',0o600),ownedLock=await lock.stat();
  try{
   let previous;
   try{previous=validateStatus(await jsonFile(join(this.root,'status.json')));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(previous)check(Date.parse(status.lastAttemptAt)>=Date.parse(previous.lastAttemptAt),'Older attempt must not overwrite a newer scheduler result');
   await writeAtomic(this.root,'status.json',bytes(status));
  }finally{
   await lock.close();const current=await lstat(lockPath);
   check(current.dev===ownedLock.dev&&current.ino===ownedLock.ino&&!current.isSymbolicLink(),'Status lock changed; foreign lock retained');
   await unlink(lockPath);
  }
 }
}

export function projectOrganizationSnapshot(snapshot,access){
 const result=clone(snapshot),scope=access?.scope;
 if(!['department','center','personal'].includes(scope))return {...result,sources:emptySources()};
 if(scope==='department')return result;
 const centers=new Set(scope==='center'?(Array.isArray(access.centers)?access.centers:[access.center]).filter(string):[]);
 // A partial access view receives only this schema's documented display fields.
 const allowed={
  organization:['centers','leaders','snapshots','directors'],
  reportingDirectory:['entries','guidance'],
  meetingEvidence:['items','snapshotDate','dailyRecords','readableRecords','blockedRecords','blankRecords','unverifiedRecords','errorRecords'],
  meetingIntelligence:['profiles','method','date','generatedAt'],
 };
 for(const key of ORGANIZATION_SOURCE_KEYS)if(result.sources[key]){
  const keep=new Set(['factsDate','sourceTitle','sourceUrl','revision','sourceMode','updatedAt','verifiedAt','sourceMetadata',...allowed[key]]);
  result.sources[key]=Object.fromEntries(Object.entries(result.sources[key]).filter(([field])=>keep.has(field)));
 }
 const organization=result.sources.organization;
 if(organization){organization.centers=organization.centers.filter(v=>centers.has(v));organization.leaders=organization.leaders.filter(v=>centers.has(v.center));organization.snapshots=[];organization.directors=[];}
 const directory=result.sources.reportingDirectory;
 if(directory)directory.entries=directory.entries.filter(v=>centers.has(v.center));
 const meetings=result.sources.meetingEvidence;
 if(meetings){
  meetings.items=meetings.items.filter(v=>centers.has(v.center));Object.assign(meetings,counters(meetings.items));
  for(const key of ['totalRecords','archiveRecords','verification','coverage'])delete meetings[key];
 }
 const intelligence=result.sources.meetingIntelligence;
 if(intelligence){
  intelligence.profiles=intelligence.profiles.filter(v=>centers.has(v.center));
  delete intelligence.coverage;delete intelligence.summary;
 }
 // These are display filters only. Never pass returned names/centers into an authorization policy.
 return result;
}

export const MEETING_RECORD_FIELD_IDS=Object.freeze({
 date:'fldCDALUlW',title:'fldfzveN2A',center:'fldxwsGf9P',department:'fldD7wGKNW',
 transcript:'fldDSokJfW',minutes:'fldKrGROSy',recording:'fldTiNvbqO',todo:'fldRIhhpVW',
});
function cellUrl(value){
 if(value===null||value==='')return null;
 check(typeof value==='string','Unrecognized source-link cell');
 const match=value.trim().match(/^\[[^\]]*\]\((https:\/\/[^)\s]+)\)$/);
 const url=match?match[1]:value.trim();
 check(https(url),'Source-link cell is not a valid explicit URL');return url;
}
export function meetingEvidenceFromCli(response,{factsDate,readAt,sourceUrl,rawSha256}){
 check(object(response)&&response.ok===true&&response.identity==='user'&&date(factsDate),'A successful user read is required');
 const data=response.data;
 check(object(data)&&data.has_more===false&&Array.isArray(data.data)&&Array.isArray(data.field_id_list)
  &&Array.isArray(data.record_id_list)&&data.record_id_list.length===data.data.length,'Incomplete/malformed meeting record page');
 check(new Set(data.field_id_list).size===data.field_id_list.length,'Duplicate field IDs');
 const indices=Object.fromEntries(Object.entries(MEETING_RECORD_FIELD_IDS).map(([key,id])=>[key,data.field_id_list.indexOf(id)]));
 check(Object.values(indices).every(v=>v>=0),'Meeting fields missing; names/positions cannot substitute for field IDs');
 const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
 const items=data.data.map((row,index)=>{
  check(Array.isArray(row)&&row.length===data.field_id_list.length,'Meeting cells are incomplete');
  const get=name=>row[indices[name]],department=get('department'),center=get('center');
  const day=get('date');check(timestamp(day)&&dayFormat.format(new Date(day))===factsDate,'Record is outside requested Shanghai business date');
  check(Array.isArray(department)&&department.length===1&&department[0]==='品牌营销部','Record is outside authorized department query');
  check(Array.isArray(center)&&center.length===1&&string(center[0])&&string(get('title')),'Record center/title unverified');
  check(get('todo')===null||typeof get('todo')==='string','TODO cell needs verified normalization');
  const transcriptUrl=cellUrl(get('transcript'));
  return {id:data.record_id_list[index],date:factsDate,title:get('title'),center:center[0],
   transcriptUrl,minutesUrl:cellUrl(get('minutes')),recordingUrl:cellUrl(get('recording')),
   todo:get('todo'),readState:transcriptUrl?'unverified':'blank'};
 });
 const result={factsDate,snapshotDate:factsDate,revision:data.rev??null,sourceMode:'verified-source-table',
  sourceMetadata:{identity:'user',readAt,sourceUrl,rawSha256,appToken:'HD6cbG8Tiae30Ts266bcoGMUnMd',
   tableId:'tblLfhIgmidjXyve',fieldIds:[...data.field_id_list],revision:data.rev??null},
  items,...counters(items)};
 return validateSourceData('meetingEvidence',result);
}
