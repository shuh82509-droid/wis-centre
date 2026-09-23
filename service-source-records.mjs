import {readFileSync,statSync,createReadStream} from 'node:fs';
import {basename,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const parse=(v,fallback)=>{try{return JSON.parse(v);}catch{return fallback;}};
export function sourcePeople(db,external=[]){
 const grants=db.prepare('SELECT identifier,real_name,user_number,department,center,active FROM oa_access_grants').all();
 const roles=db.prepare('SELECT identifier,role,center FROM workspace_role_grants').all();
 const modules=db.prepare('SELECT identifier,access_mode,modules FROM module_access_grants').all();
 const all=['data-dashboard','material-incentive','creative-hub','creative-radar','ai-first-creation','material-workbench','cloud-manager','live-room-management','workflow-engine'];
 const blocked=new Set(grants.filter(g=>!g.active).map(g=>g.user_number));const result=[];
 for(const g of grants){if(!g.active||blocked.has(g.user_number)||!/^[A-Z]{2}-\d+$/.test(g.user_number||''))continue;
  const ids=[...new Set(['number:'+g.user_number,g.identifier,'name:'+g.real_name])];const role=ids.map(id=>roles.find(r=>r.identifier===id)).find(Boolean),m=ids.map(id=>modules.find(r=>r.identifier===id)).find(Boolean);
  // Same default and number-before-name precedence as module_access_for_user.
  const selected=m?.access_mode==='selected'?parse(m.modules,[]):all;
  result.push({number:g.user_number,name:g.real_name,center:role?.center||g.center,active:true,role:role?.role||'specialist',modules:selected,
   flowEligible:String(g.department).includes('品牌营销部')||external.includes(g.user_number)&&(!m||selected.includes('workflow-engine')),source:'verified_oa_grant'});
 }
 return result.filter(p=>result.filter(q=>q.number===p.number&&q.name!==p.name).length===0).filter((p,i,a)=>a.findIndex(q=>q.number===p.number)===i);
}
export function creativeRecords(db){
 const fields={id:'id',title:'title',product:'product',status:'status',version:'version',feedback:'feedback',creatorId:'creator_id',uploaderId:'uploader_id',authorUserId:'author_user_id',teamLeadReviewerId:'team_lead_reviewer_id',supervisorReviewerId:'supervisor_reviewer_id',currentReviewerId:'current_reviewer_id',resumeStage:'resume_stage',dueDate:'due_date',updatedAt:'updated_at'};
 const records=db.prepare('SELECT '+Object.values(fields).join(',')+' FROM creative_drafts ORDER BY updated_at,id').all().map(row=>Object.fromEntries(Object.entries(fields).map(([key,column])=>[key,row[column]])));
 const users=db.prepare('SELECT id,employee_no,name,center,active,role FROM workspace_users').all().map(u=>({id:u.id,employeeNo:u.employee_no,name:u.name,center:u.center,active:u.active===1,role:u.role}));
 const actionsByRecord={};for(const a of db.prepare('SELECT id,draft_id,action,stage,actor_id,actor_name,comment,version,created_at FROM review_actions ORDER BY created_at,id').all())(actionsByRecord[a.draft_id]??=[]).push({id:a.id,draftId:a.draft_id,action:a.action,stage:a.stage,actorId:a.actor_id,actorName:a.actor_name,comment:a.comment,version:a.version,createdAt:a.created_at});
 return {records,users,actionsByRecord};
}
export function cloudRecords(db){
 const rows=db.prepare('SELECT s.*,a.filename,a.category,a.deleted_at,a.purged_at FROM asset_review_submissions s JOIN assets a ON a.id=s.asset_id ORDER BY s.submitted_at').all();
 return rows.filter(s=>!s.deleted_at&&!s.purged_at).map(s=>{
  const decisions=db.prepare('SELECT * FROM asset_review_decisions WHERE submission_id=? ORDER BY id').all(s.id);
  const steps=[{id:'W03.S1.E1',title:'待审素材与版本登记',state:'completed',owner:s.submitted_by_number}];let ready=true;
  for(const [i,d] of decisions.entries()){
   const candidates=parse(d.candidate_reviewers,[]),owner=d.reviewer_number||(candidates.length===1?candidates[0].user_number:'');
   const done=ready&&d.status==='approved';
   // A group with multiple candidates is unresolved, never assigned to the first person.
   steps.push({id:'W03.S2.E'+(i+1),title:({team_lead:'组长审核',supervisor:'主管审核',designated:'指定人员审核'})[d.role_code]||d.role_code,state:done?'completed':ready?'ready':'pending',owner});ready=done;
  }
  const deliveries=db.prepare('SELECT * FROM qianchuan_deliveries WHERE asset_id=? AND deleted_at IS NULL AND created_at>=?').all(s.asset_id,s.submitted_at);
  const targets=deliveries.length>0&&deliveries.every(d=>d.created_by_number===s.submitted_by_number&&d.advertiser_id&&d.plan_id);
  const delivered=targets&&deliveries.every(d=>{const e=parse(d.binding_evidence,{});return d.status==='success'&&d.binding_verified_at&&d.platform_asset_id&&e.matched_count>0&&String(e.video_id)===String(d.platform_asset_id)&&String(e.advertiser_id)===String(d.advertiser_id)&&String(e.plan_id)===String(d.plan_id);});
  const approved=s.status==='approved';steps.push({id:'W03.S3.E1',title:'渠道与分发目标配置',state:approved&&targets?'completed':approved?'ready':'pending',owner:s.submitted_by_number},{id:'W03.S5.E1',title:'平台分发回执核验',state:approved&&delivered?'completed':approved&&targets?'ready':'pending',owner:s.submitted_by_number});
  const origin=db.prepare('SELECT provenance FROM workstation_returns WHERE asset_id=? LIMIT 1').get(s.asset_id);
  return {id:s.id,title:s.filename,owner:s.submitted_by_number,product:s.category,status:s.status,version:JSON.stringify([s.version,s.status,decisions.map(d=>[d.id,d.status,d.reviewer_number]),deliveries.map(d=>[d.id,d.status,d.binding_verified_at])]),steps,assetId:s.asset_id,upstreamRenderId:parse(origin?.provenance,{})?.render_id||null,note:'审核通过后仍需配置真实渠道目标并核验分发回执。'};
 });
}
const fileCache=new Map();
async function validFile(file,digest){
 if(!/^[a-f0-9]{64}$/i.test(digest||''))return false;
 try{const stat=statSync(file),key=[stat.size,stat.mtimeMs,digest].join(':');if(!stat.isFile()||!stat.size)return false;if(fileCache.get(file)?.key===key)return fileCache.get(file).ok;
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);const after=statSync(file);const ok=stat.size===after.size&&stat.mtimeMs===after.mtimeMs&&hash.digest('hex')===digest;fileCache.set(file,{key,ok});return ok;
 }catch{return false;}
}
export async function remixRecords(file,skipIds=[]){
 const lib=JSON.parse(readFileSync(file,'utf8'));const skipped=new Set(skipIds),records=[];
 for(const r of lib.renders||[]){if(skipped.has(r.id)||r.visibility==='private')continue;
  const variants=[];for(const v of r.variants||[]){const present=!!v.storedName&&basename(v.storedName)===v.storedName&&await validFile(join(dirname(file),'outputs',v.storedName),v.contentSha256);variants.push({id:v.id,sha256:v.contentSha256,present,review:v.reviewStatus,reviewedAt:v.reviewedAt,returned:v.materialCenterReturn?.status==='completed'});}
  const generated=variants.length>0&&variants.every(v=>v.present),approved=generated&&variants.every(v=>v.review==='approved'&&v.reviewedAt),returned=approved&&variants.every(v=>v.returned);
  records.push({id:r.id,title:r.name||'二创混剪',owner:r.createdById,product:r.productCategory||'',status:returned?'已回传':approved?'待回传':generated?'待审核':'待渲染核验',version:JSON.stringify(variants),steps:[{id:'W02.S1.E1',title:'素材与切片准备',state:'completed'},{id:'W02.S4.E1',title:'混剪渲染与文件核验',state:generated?'completed':'ready'},{id:'W02.S4.E2',title:'混剪成片审核',state:approved?'completed':generated?'ready':'pending'},{id:'W02.S5.E1',title:'回传云管家交接',state:returned?'completed':approved?'ready':'pending'}],variants});
 }
 return {records,allIds:(lib.renders||[]).map(r=>r.id),events:lib.serviceNotifications||[]};
}
