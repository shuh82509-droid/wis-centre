import {catalog,flowAllowed,graphFor} from './flow-catalog.mjs';
import {WorkflowError,requireFact} from './workflow-store.mjs';
import {executionGraph,graphDetails,resolvedCatalog} from './flow-model.mjs';
import {createReadStream} from 'node:fs';
import {canConfigure,configurationDepartment,configurationEndpoint} from './flow-configuration-access.mjs';
export function createFlowHandler({runtime,sources,notifier,automation,creative,creativeStatus,localBusinessStatus,blueprints,evidenceReader,delivery,liveSessions,currentSession,accessFor,previewFor,readJson,sendJson,writesEnabled=true,writeAccounts=null}){
 return async(req,res,url)=>{if(!url.pathname.startsWith('/api/flows/'))return false;try{
  const session=await currentSession(req);if(session.status!==200){sendJson(res,session.status,session.payload);return true;}const a=accessFor(session.payload);requireFact(a.enabled,'当前身份未开放品牌营销部工作流',403);requireFact(!previewFor(req,session.payload)?.active,'请退出权限预览后使用真实工作流',403);
  const path=url.pathname.slice('/api/flows/'.length);
  if(a.configurationOnly)requireFact(configurationEndpoint(req.method,path),'此授权仅用于查看和编排流程，不包含任务或素材操作',403);
  if(path==='catalog'||path==='blueprints'||path.startsWith('blueprints/'))requireFact(canConfigure(a),'当前身份没有流程查看和编排授权',403);
  if(['preview','sources','data-catalog','automation/watches'].includes(path))requireFact(a.canManage,'只有主管或总监可以管理业务任务',403);
  if(req.method!=='GET'&&writeAccounts&&!['preview','blueprints/nodes','blueprints/preview'].includes(path))requireFact(writeAccounts.includes(a.user.number),'当前候选仅开放给指定验收账号，生产任务不受影响',403);
  const fileMatch=path.match(/^runs\/(task_[a-z0-9]+)\/attachments\/(attachment_[a-f0-9]{32})\/content$/);
  if(req.method!=='GET'){requireFact(writesEnabled||['preview','blueprints/nodes','blueprints/preview'].includes(path),'流程维护中，已有资料已保留',503);requireFact(req.headers['x-flow-request']==='1'&&String(req.headers['content-type']||'').startsWith(fileMatch&&req.method==='PUT'?'application/octet-stream':'application/json'),'请从中枢页面提交操作',403);requireFact(req.headers['sec-fetch-site']!=='cross-site','不接受跨站请求',403);if(req.headers.origin)requireFact(new URL(req.headers.origin).host===req.headers.host,'不接受跨站请求',403);}
  if(path.startsWith('live/')){
    requireFact(liveSessions,'直播工作流尚未配置',503);
    if(req.method==='GET'&&path==='live/today')sendJson(res,200,liveSessions.today(a));
    else if(req.method==='GET'&&path==='live/schedule')sendJson(res,200,await liveSessions.preview(a,req,url.searchParams.get('date')));
    else if(req.method==='POST'&&path==='live/sessions')sendJson(res,201,await liveSessions.create(a,req,await readJson(req,65536),req.headers['idempotency-key']));
    else if(req.method==='POST'&&path==='live/restore-source')sendJson(res,200,await liveSessions.restoreSource(a,req,await readJson(req,65536),req.headers['idempotency-key']));
    else throw new WorkflowError(404,'直播工作流接口不存在');return true;
  }
  if(req.method==='GET'&&path==='products'){requireFact(delivery,'交付服务待接入',503);sendJson(res,200,await delivery.products(req));return true;}
  if(path.startsWith('creative/')){
   requireFact(creative,'创意来源同步服务尚未连接',503);creative.assertAccess(a);
   if(req.method==='GET'&&path==='creative/status')sendJson(res,200,{sources:creativeStatus?.()||{},watches:creative.watches(a)});
   else if(req.method==='GET'&&path==='creative/records'){
    const data=await creative.candidates(a,req,url.searchParams.get('source'),[],{cursor:url.searchParams.get('cursor')});
    sendJson(res,200,{items:data.records.map(d=>({id:d.id,title:d.title,status:d.status,product:d.product})),limit:data.limit,nextCursor:data.nextCursor||null,historyAvailable:data.historyAvailable});
   }
   else if(req.method==='POST'&&path==='creative/watches')sendJson(res,201,await creative.configure(a,req,await readJson(req,65536),req.headers['idempotency-key']));
   else if(req.method==='POST'&&path==='creative/sync')sendJson(res,200,{items:await creative.sync(a,req)});
   else throw new WorkflowError(404,'创意来源接口不存在');
   return true;
  }
  const taskSources=path.match(/^runs\/(task_[a-z0-9]+)\/sources$/);
  if(req.method==='GET'&&taskSources){const t=runtime.get(a,taskSources[1]),node=t.runtime.nodes.find(n=>n.id===url.searchParams.get('nodeId'));requireFact(node,'请选择本任务的办理节点',404);requireFact(t.runtime.state==='running'&&!t.runtime.automation&&node.state==='ready','节点尚未到达、已完成或已暂停，请刷新原任务',409);requireFact(a.canManage||node.owner.number===a.user.number,'只有当前主责或流程管理人可以读取交付候选',403);requireFact(['remix_output','cloud_return','cloud_review'].includes(node.evidenceKind)&&node.id.startsWith('W02.'),'此节点不使用二创成片候选',403);runtime.validateOwner(node,a.user.number,t.runtime.nodes);sendJson(res,200,await sources.viewTask(a,t,req));return true;}
  const deliveryMatch=path.match(/^runs\/(task_[a-z0-9]+)\/(delivery-options|attachments|cloud-assets(?:\/resolve)?)$/);
  if(deliveryMatch){requireFact(delivery,'交付服务待接入',503);const taskId=deliveryMatch[1],operation=deliveryMatch[2];
    if(req.method==='GET'&&operation==='delivery-options')sendJson(res,200,await delivery.options(req,a,taskId,url.searchParams.get('nodeId')));
    else if(req.method==='GET'&&operation==='cloud-assets')sendJson(res,200,await delivery.assets(req,a,taskId,url.searchParams));
    else if(req.method==='POST'&&operation==='attachments')sendJson(res,201,delivery.init(a,taskId,await readJson(req,65536),req.headers['idempotency-key']));
    else if(req.method==='POST'&&operation==='cloud-assets/resolve')sendJson(res,200,await delivery.resolveAsset(req,a,taskId,await readJson(req,65536)));
    else throw new WorkflowError(405,'请求方式不支持');return true;
  }
  if(fileMatch){requireFact(delivery,'交付服务待接入',503);
    if(req.method==='PUT')sendJson(res,200,await delivery.upload(req,a,fileMatch[1],fileMatch[2]));
    else if(req.method==='GET'){const {file,row}=delivery.content(a,fileMatch[1],fileMatch[2]);res.writeHead(200,{'Content-Type':row.mimeType,'Content-Length':row.size,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.filename),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});createReadStream(file).on('error',()=>res.destroy()).pipe(res);}
    else throw new WorkflowError(405,'请求方式不支持');return true;
  }
  if(req.method==='POST'&&path==='blueprints/nodes'){const b=await readJson(req,65536);requireFact(canConfigure(a)&&b.workflow!=='06'&&flowAllowed(a,b.workflow),'没有编排权限',403);sendJson(res,200,{nodes:graphFor(b.workflow,b.options||{})});return true;}
  const revision=path.match(/^blueprints\/revision\/(\d+)$/);if(req.method==='GET'&&revision){const v=(runtime.store.read().flowBlueprintRevisions||[]).find(d=>d.version===Number(revision[1])&&blueprints.canEdit(a,d)&&d.scope===(configurationDepartment(a)?'department':'center'));requireFact(v,'配置版本不存在或不在本范围',404);sendJson(res,200,v);return true;}
  if(req.method==='GET'&&path==='blueprints'){sendJson(res,200,blueprints.view(a));return true;}
  if(req.method==='POST'&&['blueprints/preview','blueprints/save','blueprints/publish'].includes(path)){const b=await readJson(req,262144);sendJson(res,200,path.endsWith('/preview')?blueprints.preview(a,b):blueprints.save(a,b,req.headers['idempotency-key'],{publish:path.endsWith('/publish')}));return true;}
  if(req.method==='GET'&&path==='automation/watches'){sendJson(res,200,{items:automation?.view(a)||[]});return true;}
  if(req.method==='POST'&&path==='automation/watches'){requireFact(automation,'自动跟进服务尚未连接',503);sendJson(res,200,automation.configure(a,await readJson(req,65536),req.headers['idempotency-key']));return true;}
  if(req.method==='GET'&&path==='catalog'){const data=resolvedCatalog(a,blueprints?.active(a));for(const [source,c] of Object.entries(localBusinessStatus?.()||{})){const f=data.flows.find(f=>f.id===(source==='remix'?'02':'03'));if(f){f.sourceUrl=c.url;f.localConnection=c;}}const creativeFlow=data.flows.find(f=>f.id==='07');if(creativeFlow&&creativeStatus?.().idea?.url)creativeFlow.sourceUrl=creativeStatus().idea.url;if(a.configurationOnly){data.flows=data.flows.filter(f=>f.id!=='06');data.stages=data.stages.filter(s=>s.flow!=='06');}sendJson(res,200,data);return true;}
  if(req.method==='GET'&&path==='overview'){
   if(a.configurationOnly){const active=blueprints?.active(a);sendJson(res,200,{
    generatedAt:new Date().toISOString(),capabilities:{writesEnabled:!!writesEnabled},access:{...a.user,canManage:false,canConfigure:true,
     configurationOnly:true,department:false,configurationScope:a.configurationScope},
    tasks:[],events:[],metrics:{runs:null,active:null,completed:null,overdue:null,
     notificationSent:null,notificationAttention:null},
    blueprint:active?{name:active.name,version:active.version,defaultRoute:active.defaultRoute}:null});return true;}
   const overview=runtime.overview(a);overview.capabilities={writesEnabled:!!writesEnabled};if(a.canManage){const active=blueprints?.active(a);Object.assign(overview,{blueprint:active?{name:active.name,version:active.version,defaultRoute:active.defaultRoute}:null,executionRoutes:(active?.moduleOrder||[]).filter(f=>flowAllowed(a,f)).map(flow=>{const f=catalog.flows.find(x=>x.id===flow);return {flow,name:f.name,module:f.module};}),notifications:notifier.status()});}sendJson(res,200,overview);return true;}
  if(req.method==='GET'&&path==='sources'){sendJson(res,200,sources.view(a));return true;}
  if(req.method==='GET'&&path==='people'){const p=sources.people().filter(p=>!a.configurationOnly||p.active).filter(p=>configurationDepartment(a)||p.center===a.user.center);sendJson(res,200,{items:canConfigure(a)?p.map(({number,name,center,role})=>({number,name,center,role,notificationReady:!!notifier.recipient(number)})):p.filter(p=>p.number===a.user.number).map(({number,name,center,role})=>({number,name,center,role})),state:sources.data.cloud.state});return true;}
  if(req.method==='POST'&&path==='preview'){const b=await readJson(req,65536);requireFact(a.canManage&&flowAllowed(a,b.workflow),'没有发起权限',403);const resolved=blueprints?.resolveForCreate(a,b)||b;sendJson(res,200,{...graphDetails(executionGraph(resolved),resolved.workflow),mode:resolved.mode||'standard',blueprintVersion:resolved._blueprint?.version||null,defaults:resolved._blueprint?{...resolved._blueprint.modules[b.workflow],owner:resolved.owner,manager:resolved.manager,reviewer:resolved.reviewer||resolved.manager||a.user.number,receiver:resolved.receiver||null,fixedOwner:resolved._blueprint.modules[b.workflow].owner!=='task_owner',fixedManager:resolved._blueprint.modules[b.workflow].manager!=='task_manager',bindings:resolved.bindings}:{owner:resolved.owner,manager:resolved.manager||a.user.number,reviewer:resolved.reviewer||resolved.manager||a.user.number,receiver:resolved.receiver||null}});return true;}
  if(req.method==='POST'&&path==='runs'){sendJson(res,201,runtime.create(a,await readJson(req,65536),req.headers['idempotency-key']));return true;}
  const handoff=path.match(/^runs\/(task_[a-z0-9]+)\/handoff$/);if(req.method==='POST'&&handoff){sendJson(res,200,runtime.configureHandoff(a,handoff[1],await readJson(req,65536),req.headers['idempotency-key']));return true;}
  const match=path.match(/^runs\/(task_[a-z0-9]+)(?:\/(complete|return|assign|extend|pause|resume|cancel))?$/);
  if(match){if(req.method==='GET'&&!match[2])sendJson(res,200,runtime.get(a,match[1]));else{requireFact(req.method==='POST'&&match[2],'请求方式不支持',405);const b=await readJson(req,65536),t=runtime.get(a,match[1]),n=t.runtime.nodes.find(n=>n.id===b.nodeId);let verifiedEvidence=null;if(match[2]==='complete'&&n?.state==='ready'&&b.expectedVersion===t.version){requireFact(a.canManage||n.owner.number===a.user.number,'只有当前主责或流程管理人可以办理',403);if(t.runtime.liveSession){requireFact(n.owner.number===a.user.number,'直播节点须由当前主责本人完成；主管可先明确改派或处理异常',403);requireFact(liveSessions,'直播来源核验尚未配置',503);await liveSessions.verifyCurrent(a,req,t.id);}verifiedEvidence=await evidenceReader?.prepare(req,a,t,b.nodeId,b);if(!verifiedEvidence)verifiedEvidence=await delivery?.prepare(req,a,t.id,b.nodeId,b);}sendJson(res,200,runtime.command(a,match[1],match[2],b,req.headers['idempotency-key'],{verifiedEvidence}));}return true;}
  const notification=path.match(/^notifications\/(notice_[a-z0-9]+)\/retry$/);if(req.method==='POST'&&notification){sendJson(res,200,notifier.retry(a,notification[1]));return true;}
  if(req.method==='GET'&&path==='data-catalog'){sendJson(res,200,{schema:'wis.workflow.v1',generatedAt:new Date().toISOString(),registrationState:'deferred_by_owner',entities:[{name:'workflow_templates',primaryKey:'version + flow + node',query:'catalog'},{name:'workflow_runs',primaryKey:'task_id',query:'overview'},{name:'workflow_nodes',primaryKey:'task_id + node_id + attempt',fields:['owner','state','startedAt','dueAt','completedAt','durationSeconds','evidence']},{name:'workflow_events',primaryKey:'event_id',query:'runs/{task_id}'},{name:'notification_receipts',primaryKey:'notification_id',fields:['recipient','state','messageId','sentAt']}],policy:'OA会话和原角色范围；查询仅返回当前可见任务，缺失值为null。'});return true;}
  throw new WorkflowError(404,'工作流接口不存在');
 }catch(e){if(!(e instanceof WorkflowError))console.error('Workflow API failure',e.name,e.code||'',String(e.stack||'').split('\n').slice(1,3).join(' '));sendJson(res,e.status||503,{detail:e instanceof WorkflowError?e.message:'工作流请求未完成，请刷新核对原任务后继续'});return true;}};
}
