// Drop into the Idea OS source tree alongside the existing current-user module.
// One SELECT captures each draft, its participants and its audit ledger from
// the same SQLite statement. No writes, migrations or business actions here.
const fields={id:'id',title:'title',product:'product',status:'status',version:'version',feedback:'feedback',
 creatorId:'creator_id',uploaderId:'uploader_id',authorUserId:'author_user_id',
 teamLeadReviewerId:'team_lead_reviewer_id',supervisorReviewerId:'supervisor_reviewer_id',
 currentReviewerId:'current_reviewer_id',resumeStage:'resume_stage',dueDate:'due_date',updatedAt:'updated_at'};
const participantColumns=['creator_id','uploader_id','author_user_id','team_lead_reviewer_id','supervisor_reviewer_id'];
const deny=(detail,status=400)=>Response.json({detail},{status});

export async function workflowSource({request,db,user,canManage=false}){
 if(!user?.id||!user.employeeNo||user.active!==true)return deny('需要有效的来源登录身份',403);
 const url=new URL(request.url),ids=[...new Set(url.searchParams.getAll('id'))],rawCursor=url.searchParams.get('cursor');
 if(ids.length>90||ids.some(id=>!id||id.length>200)||ids.length&&rawCursor)return deny('编号最多 90 个，按编号读取不能同时分页');
 let cursor=null;
 if(rawCursor){try{if(rawCursor.length>1000)throw Error();cursor=JSON.parse(rawCursor);if(typeof cursor.id!=='string'||!cursor.id||cursor.id.length>200||typeof cursor.at!=='string'||!Number.isFinite(Date.parse(cursor.at)))throw Error();}catch{return deny('分页位置无效');}}
 const where=[],args=[];
 // Use the same related-person or source-manager rule as the existing history
 // endpoint; no client header or query parameter can grant manager authority.
 if(!canManage){where.push('('+participantColumns.map(c=>'d.'+c+' = ?').join(' OR ')+')');args.push(...participantColumns.map(()=>user.id));}
 if(ids.length){where.push('d.id IN ('+ids.map(()=>'?').join(',')+')');args.push(...ids);}
 if(cursor){where.push('(d.updated_at < ? OR (d.updated_at = ? AND d.id < ?))');args.push(cursor.at,cursor.at,cursor.id);}
 const actionSql=ids.length?`(SELECT COALESCE(json_group_array(json_object(
  'id',a.id,'draftId',a.draft_id,'action',a.action,'stage',a.stage,
  'actorId',a.actor_id,'actorName',a.actor_name,'comment',a.comment,'version',a.version,'createdAt',a.created_at)), '[]')
  FROM (SELECT * FROM review_actions WHERE draft_id = d.id ORDER BY created_at, id) a)`:`'[]'`;
 const sql=`SELECT ${Object.values(fields).map(c=>'d.'+c).join(',')},
  ${actionSql} AS workflow_actions,
  (SELECT COALESCE(json_group_array(json_object('id',u.id,'employeeNo',u.employee_no,'name',u.name,'center',u.center,'active',u.active)), '[]')
   FROM workspace_users u WHERE u.id IN (${[...participantColumns,'current_reviewer_id'].map(c=>'d.'+c).join(',')})) AS workflow_users
  FROM creative_drafts d ${where.length?'WHERE '+where.join(' AND '):''}
  ORDER BY d.updated_at DESC, d.id DESC LIMIT ${ids.length?100:101}`;
 try{
  const result=await db.prepare(sql).bind(...args).all();
  if(!Array.isArray(result.results))return deny('来源快照读取未完成',503);
  const hasMore=!ids.length&&result.results.length>100,rows=result.results.slice(0,100),users=new Map(),actionsByRecord=Object.create(null);
  const records=rows.map(row=>{
   for(const person of JSON.parse(row.workflow_users))users.set(person.id,{...person,active:person.active===1});
   actionsByRecord[row.id]=JSON.parse(row.workflow_actions);
   return Object.fromEntries(Object.entries(fields).map(([key,column])=>[key,row[column]]));
  });
  const last=records.at(-1);
  return Response.json({schema:'wis.creative-source.v1',source:'idea',currentUser:{employeeNo:user.employeeNo},
   records,users:[...users.values()],actionsByRecord,unavailableIds:ids.filter(id=>!records.some(r=>r.id===id)),
   nextCursor:hasMore?JSON.stringify({id:last.id,at:last.updatedAt}):null,limit:100,historyAvailable:true,historyIncluded:!!ids.length});
 }catch{return deny('来源快照读取失败，请核对源端表结构；原任务未改动',503);}
}
