import {DatabaseSync} from 'node:sqlite';
import {inactiveWorkflowMembers} from './flow-personnel.mjs';
import {readFileSync,statSync,existsSync} from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {join,dirname,basename} from 'node:path';
import {previewMemberDirectory} from './preview-directory.mjs';
import {deliveryVerified,platformAuditState} from './flow-evidence.mjs';
const json=(s,f={})=>{try{return JSON.parse(s);}catch{return f;}};
const key=v=>String(v||'').trim().toUpperCase();
const product=v=>/黑晶/.test(v||'')?'黑晶面膜':/水润/.test(v||'')?'隐形水润面膜':String(v||'');
const iso=()=>new Date().toISOString();
export function readPeople(db){
 // Current central MODULE_KEYS (verified 2026-09-14): explicit all is the
 // complete catalog; absent settings retain the hub's mapped business scope.
 const moduleKeys=['data-dashboard','material-incentive','creative-hub','creative-radar','ai-first-creation','material-workbench','cloud-manager','live-room-management','workflow-engine'];
 const grants=db.prepare('SELECT identifier,real_name,user_number,department,center,active FROM oa_access_grants').all();
 const profiles=db.prepare('SELECT identifier,role,center,department FROM workspace_role_grants').all();
 const modules=db.prepare('SELECT identifier,access_mode,modules FROM module_access_grants').all();
 const result=[];for(const g of grants){if(!g.user_number||!String(g.department).includes('品牌营销部'))continue;const base=previewMemberDirectory.find(p=>key(p.userNumber)===key(g.user_number));const p=profiles.find(p=>p.identifier===g.identifier);const m=modules.find(p=>p.identifier===g.identifier);const role=p?.role||(base?.mappedRole?.includes('总监')?'director':base?.mappedRole?.includes('主管')?'manager':'specialist');
  const selectedValue=m?.access_mode==='selected'?json(m.modules,[]):[];
  const selected=Array.isArray(selectedValue)?selectedValue:[];
  const effectiveModules=m?(m.access_mode==='selected'?moduleKeys.filter(k=>selected.includes(k)):[...moduleKeys]):base?.allowedModules||[];
  result.push({number:key(g.user_number),name:g.real_name,center:p?.center||base?.center||g.center,active:!!g.active,role,workflowEnabled:m?.access_mode!=='selected'||selected.includes('workflow-engine'),modules:effectiveModules,manager:base?.manager||'',source:'OA有效授权与岗位映射'});
 }
 const blocked=new Set(result.filter(p=>!p.active).map(p=>p.number));return [...new Map(result.filter(p=>p.active&&!blocked.has(p.number)&&!inactiveWorkflowMembers.has(p.number)).map(p=>[p.number,p])).values()];
}
function projectCloud(db){const people=readPeople(db);
 const requests=db.prepare('SELECT id,product,requester_number,requester_name,assignee_number,assignee_name,status,latest_asset_id,delivery_version,reference_url,created_at,updated_at,accepted_at FROM video_requests ORDER BY updated_at DESC LIMIT 100').all();
 const returns=db.prepare('SELECT r.idempotency_key,r.asset_id,r.sha256,r.status,r.completed_at,CASE WHEN a.id IS NOT NULL AND a.deleted_at IS NULL AND a.purged_at IS NULL AND a.object_key=r.object_key AND a.size=r.file_size THEN 1 ELSE 0 END AS asset_current FROM workstation_returns r LEFT JOIN assets a ON a.id=r.asset_id ORDER BY r.created_at DESC LIMIT 300').all();
 const reviews=db.prepare('SELECT id,asset_id,version,status,completed_at FROM asset_review_submissions ORDER BY submitted_at DESC LIMIT 500').all();
 const deliveries=db.prepare("SELECT id,asset_id,advertiser_id,advertiser_name,plan_id,status,platform_asset_id,binding_verified_at,binding_evidence,created_by_number,updated_at FROM qianchuan_deliveries WHERE deleted_at IS NULL AND advertiser_name NOT LIKE '电商部达播%' ORDER BY updated_at DESC LIMIT 500").all().map(r=>({...r,binding_evidence:json(r.binding_evidence)}));
 return {people,requests,returns,reviews,deliveries};}

// Keep the connection, never a transaction, between exports. In WAL mode a
// short-lived last connection lets SQLite remove -wal/-shm; a read-only mount
// cannot create those files on the next refresh. No source writes are enabled.
export function createCloudReader(file){
 let db=null,identity=null;
 function close(){const previous=db;db=null;identity=null;if(previous)previous.close();}
 function read(){
  try{
   const stat=statSync(file),current=`${stat.dev}:${stat.ino}`;
   if(db&&identity!==current)close();
   if(!db){db=new DatabaseSync(file,{readOnly:true});identity=current;db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');}
   db.exec('BEGIN;');
   const data=projectCloud(db);
   db.exec('COMMIT;');
   return {state:'connected',checkedAt:iso(),...data};
  }catch(error){
   try{db?.exec('ROLLBACK;');}catch{}
   try{close();}catch{}
   throw error;
  }
 }
 return {read,close};
}
// Preserve the existing one-shot API for workers, scripts and tests.
export function readCloud(file){const reader=createCloudReader(file);try{return reader.read();}finally{reader.close();}}
export function readRemix(file){const d=json(readFileSync(file,'utf8'),null);if(!d||!Array.isArray(d.renders)||!Array.isArray(d.clips))throw Error('invalid library');
 const outputExists=v=>{try{return !!v.storedName&&basename(v.storedName)===v.storedName&&statSync(join(dirname(file),'outputs',v.storedName)).isFile()&&statSync(join(dirname(file),'outputs',v.storedName)).size>0;}catch{return false;}};
 const clips=new Map(d.clips.map(c=>[c.id,c]));const sources=new Map((d.sources||[]).map(s=>[s.id,s]));
 const renders=d.renders.filter(r=>r.visibility!=='private').slice(0,250).map(r=>({id:r.id,name:r.name,owner:key(r.createdById),product:product(r.productCategory),createdAt:r.createdAt,automation:r.automation?{jobId:r.automation.jobId,runId:r.automation.runId,dateKey:r.automation.dateKey}:null,
  variants:(r.variants||[]).map(v=>({id:v.id,name:v.outputName,sha256:v.contentSha256,filePresent:outputExists(v),review:v.reviewStatus,reviewedAt:v.reviewedAt,assessment:v.automaticAssessment?.status||null,autoApproved:v.automaticAssessment?.autoApproved===true,visualReview:v.automaticAssessment?.visualReview?{status:v.automaticAssessment.visualReview.status,sha256:v.automaticAssessment.visualReview.sha256,version:v.automaticAssessment.visualReview.version,confidence:v.automaticAssessment.visualReview.confidence,issues:v.automaticAssessment.visualReview.issues||[],summary:String(v.automaticAssessment.visualReview.summary||'').slice(0,500)}:null,return:v.materialCenterReturn?{idempotencyKey:v.materialCenterReturn.idempotencyKey,assetId:v.materialCenterReturn.assetId,status:v.materialCenterReturn.status}:null,
   duration:v.actualDurationSeconds,sourceClipCount:(v.clipSequence||[]).length,sourceClipsApproved:(v.clipSequence||[]).length>0&&(v.clipSequence||[]).every(k=>clips.get(k)?.reviewStatus==='approved'&&clips.get(k)?.reviewedAt),sourceRefs:[...new Set((v.clipSequence||[]).map(k=>sources.get(clips.get(k)?.sourceId)?.materialCenterAssetId).filter(Boolean))],quarantined:v.platformReview?.status==='needs_localization'}))}));
 const jobs=(d.autoJobs||[]).filter(j=>['黑晶面膜','隐形水润面膜'].includes(product(j.productCategory))).map(j=>({id:j.id,name:j.name,product:product(j.productCategory),owner:key(j.createdById),state:j.status,dailyTarget:j.dailyTarget,scheduleEnabled:!!j.scheduleEnabled,nextRunAt:j.nextRunAt,autoApproveOutputs:!!j.autoApproveOutputs,autoReturnAfterApproval:!!j.autoReturnAfterApproval,pushEnabled:!!j.qianchuanDelivery?.enabled,targets:(j.qianchuanDelivery?.targets||[]).map(t=>({account:t.advertiserId,plan:t.planId})),
 runs:(j.runs||[]).slice(0,5).map(r=>({id:r.id,date:r.dateKey,state:r.status,target:r.targetCount,generated:r.generatedCount,error:String(r.errorMessage||'').slice(0,500),startedAt:r.startedAt,completedAt:r.completedAt,renderIds:r.renderIds||[],stages:(r.stageReports||[]).map(s=>({key:s.key,title:s.label,state:s.status,total:s.totalCount,passed:s.passedCount,summary:s.summary}))}))}));
 const inventory=['黑晶面膜','隐形水润面膜'].map(p=>{const cs=d.clips.filter(c=>product(c.productCategory)===p&&c.visibility!=='private');return {product:p,clips:cs.length,approved:cs.filter(c=>c.reviewStatus==='approved').length};});
 return {state:'connected',checkedAt:iso(),modifiedAt:new Date(statSync(file).mtimeMs).toISOString(),jobs,renders,inventory};
}
export class FlowSources{
 constructor({cloudPath=process.env.FLOW_CLOUD_DB,remixPath=process.env.FLOW_REMIX_LIBRARY,snapshotPath=process.env.FLOW_SOURCE_SNAPSHOT}={}){this.paths={cloudPath,remixPath};this.snapshotPath=snapshotPath;this.data={cloud:{state:'pending',people:[]},remix:{state:'pending',jobs:[],renders:[]}};this.worker=null;}
 async refresh(){
  if(this.snapshotPath){try{const v=JSON.parse(readFileSync(this.snapshotPath,'utf8'));if(v.schemaVersion!==1||!Number.isFinite(Date.parse(v.exportedAt))||Date.now()-Date.parse(v.exportedAt)>90000||Date.parse(v.exportedAt)>Date.now()+10000)throw Error('stale');for(const k of ['cloud','remix'])this.data[k]=v[k]?.state==='connected'?v[k]:{...this.data[k],state:v[k]?.state||'unavailable'};}catch{this.data.cloud.state='unavailable';this.data.remix.state='unavailable';}return;}
  if(this.worker)return;this.worker=new Worker(new URL(import.meta.url),{workerData:this.paths,resourceLimits:{maxOldGenerationSizeMb:384}});const w=this.worker;const timeout=setTimeout(()=>w.terminate(),20000);w.on('message',v=>{for(const k of ['cloud','remix'])this.data[k]=v[k]?.state==='connected'?v[k]:{...this.data[k],state:v[k]?.state||'unavailable',error:v[k]?.error||'数据源暂不可用'};});const done=()=>{clearTimeout(timeout);if(this.worker===w)this.worker=null;};w.once('exit',done);w.once('error',()=>{this.data.cloud.state='unavailable';this.data.remix.state='unavailable';done();});
 }
 people(){return this.data.cloud.state==='connected'&&Date.now()-Date.parse(this.data.cloud.checkedAt)<120000?this.data.cloud.people:[];}
 // The HTTP handler first verifies this task and its current delivery owner.
 // Reuse source permissions, then restrict candidates to the task's product
 // and any immutable render version already selected by its earlier nodes.
 viewTask(a,t){const view=this.view(a),context=t.runtime.sourceContext||{};return {checkedAt:view.checkedAt,sources:view.sources,renders:view.renders.filter(r=>(!t.runtime.product||r.product===t.runtime.product)&&(!context.renderId||r.id===context.renderId)).map(r=>({...r,variants:r.variants.filter(v=>(!context.variantId||v.id===context.variantId)&&(!context.sha256||v.sha256===context.sha256))})).filter(r=>r.variants.length)};}
 view(a){const people=this.people(),allowed=(number)=>{const p=people.find(p=>p.number===key(number));return p&&(a.department||a.canManage&&p.center===a.user.center||p.number===a.user.number);};const c=this.data.cloud,r=this.data.remix;const canCloud=a.modules.includes('cloud-manager'),canRemix=a.modules.includes('material-workbench');
 const requests=canCloud?(c.requests||[]).filter(x=>allowed(x.requester_number)||allowed(x.assignee_number)):[];
 const renders=canRemix?(r.renders||[]).filter(x=>allowed(x.owner)):[];const assetIds=new Set(renders.flatMap(x=>x.variants.map(v=>Number(v.return?.assetId))).filter(Boolean));
 const deliveries=canCloud?(c.deliveries||[]).filter(d=>allowed(d.created_by_number)):[];
 const enriched=renders.map(render=>({...render,variants:render.variants.map(v=>{const ret=(c.returns||[]).find(x=>x.idempotency_key===v.return?.idempotencyKey);const match=c.state==='connected'&&r.state==='connected'&&ret&&ret.asset_id===Number(v.return?.assetId)&&ret.sha256===v.sha256&&ret.asset_current===1&&ret.status==='completed';const review=match?(c.reviews||[]).find(x=>x.asset_id===ret.asset_id):null;const receipt=canCloud?deliveries.filter(x=>x.asset_id===Number(v.return?.assetId)).map(x=>({id:x.id,platform:'qianchuan',account:x.advertiser_id,plan:x.plan_id,video:x.platform_asset_id,status:x.status,verifiedAt:x.binding_verified_at,verified:c.state==='connected'&&deliveryVerified(x),platformAudit:platformAuditState(x)})):[];
  return {...v,returnVerified:!!match,cloudReview:review?{id:review.id,version:review.version,status:review.status}:null,conflict:!!(review?.status==='approved'&&(v.review!=='approved'||v.assessment==='failed'||v.quarantined)),receipts:receipt};})}));
 return {checkedAt:iso(),sources:[{id:'cloud',name:'云管家根记录',state:canCloud?c.state:'not_authorized',checkedAt:c.checkedAt||null},{id:'remix',name:'二创生产根记录',state:canRemix?r.state:'not_authorized',checkedAt:r.checkedAt||null}],engine:{mode:'wis_internal',companyRegistration:'deferred_by_owner',decisionDate:'2026-09-08'},requests,jobs:canRemix?(r.jobs||[]).filter(j=>allowed(j.owner)):[],renders:enriched,inventory:canRemix?r.inventory||[]:[],metricsDefinition:'记录按源主键与版本关联；支付GMV、净GSV、千川归因分开，缺失为待核验。'};
 }
}
if(!isMainThread){const out={};for(const [kind,path,reader] of [['cloud',workerData.cloudPath,readCloud],['remix',workerData.remixPath,readRemix]]){try{out[kind]=path&&existsSync(path)?reader(path):{state:'not_connected',error:'尚未接入根记录'};}catch{out[kind]={state:'unavailable',error:'根记录读取失败，保留上次成功时间'};}}parentPort.postMessage(out);}
