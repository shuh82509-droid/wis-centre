import { createHmac, timingSafeEqual } from 'node:crypto';
import { WorkflowError, requireFact } from './workflow-store.mjs';

export function signEvent(secret,timestamp,body) { return createHmac('sha256',secret).update(`${timestamp}\n${body}`).digest('hex'); }
export function verifyEvent(headers,raw,principals,clock=Date.now()) {
  const principal=principals.find(p=>p.id===headers['x-workflow-adapter']);
  const timestamp=String(headers['x-workflow-timestamp'] || ''),signature=String(headers['x-workflow-signature'] || '');
  requireFact(principal?.secret?.length>=32 && /^\d{13}$/u.test(timestamp) && Math.abs(clock-Number(timestamp))<=300000 && /^[a-f0-9]{64}$/u.test(signature),'回执认证失败',401);
  requireFact(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(signEvent(principal.secret,timestamp,raw),'hex')),'回执认证失败',401);
  return principal;
}
export function createWorkflowHandler({engine,assistant,cloudReader,currentSession,accessFor,previewFor,readBody,readJson,sendJson,assignees,principals=[],writesEnabled=true}) {
  return async (request,response,url)=>{
    if(!url.pathname.startsWith('/api/task-center/')) return false;
    // Existing authenticated attachment route remains the sole file serving implementation.
    if(/^\/api\/task-center\/attachments\/[a-z0-9_]+\/content$/u.test(url.pathname)) return false;
    try {
      if(url.pathname==='/api/task-center/events' && request.method==='POST') {
        const raw=(await readBody(request,64*1024)).toString('utf8');
        const principal=verifyEvent(request.headers,raw,principals);
        requireFact(writesEnabled,'任务服务正在维护，回执暂存后再发送',503);
        let body;try {body=JSON.parse(raw);}catch {throw new WorkflowError(400,'回执不是有效 JSON');}
        sendJson(response,200,engine.serviceEvent(body,principal));return true;
      }
      const session=await currentSession(request);
      if(session.status!==200) {sendJson(response,session.status,session.payload);return true;}
      const access={...accessFor(session.payload),canMaintain:session.payload.permissions?.manage_permissions===true};requireFact(access.enabled,'任务中心尚未对当前中心开放',403);
      const preview=previewFor(request,session.payload);
      const outputContent=url.pathname.match(/^\/api\/task-center\/tasks\/(task_[a-z0-9]+)\/outputs\/(output_[a-z0-9]+)\/content$/u);
      if(outputContent && request.method==='GET') {
        requireFact(!preview?.active,'预览模式不能读取真实交付文件',403);
        requireFact(cloudReader && session.payload.access?.allowed_modules?.includes('cloud-manager'),'当前账号未开通云管家',403);
        const location=await cloudReader.contentUrl(request,access,outputContent[1],outputContent[2]);
        response.writeHead(303,{'Location':location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});response.end();return true;
      }
      const mutation=request.method!=='GET';
      if(mutation) {
        requireFact(!preview?.active,'预览模式不能修改真实任务，请先退出预览',403);
        requireFact(writesEnabled,'任务服务正在维护，可查看已有记录，暂不接受新操作',503);
        const origin=request.headers.origin;
        if(origin) requireFact(new URL(origin).host===request.headers.host,'不接受跨站任务操作',403);
        requireFact(String(request.headers['content-type'] || '').startsWith('application/json'),'请使用 JSON 请求',415);
      }
      if(url.pathname==='/api/task-center/overview' && request.method==='GET') {
        // A preview is intentionally empty unless it is resolved by the real permissions system.
        // Never send the administrator's full team data into a specialist preview.
        if(preview?.active) {sendJson(response,200,{...engine.overview({...access,enabled:false}),assignees:[],preview:true});return true;}
        sendJson(response,200,{...engine.overview(access),capabilities:{writesEnabled,aiConfigured:Boolean(assistant.provider),canMaintain:access.canMaintain,deliveryAdapterConfigured:principals.some(p=>p.types?.includes('delivery_receipt') && p.centers?.includes(access.user.center))},assignees:access.canManage?assignees():[]});return true;
      }
      if(url.pathname==='/api/task-center/tasks' && request.method==='POST') {
        const body=await readJson(request);sendJson(response,201,engine.create(access,body,request.headers['idempotency-key']));return true;
      }
      const match=url.pathname.match(/^\/api\/task-center\/tasks\/(task_[a-z0-9]+)\/(convert|claim|status|assign|output|cloud_output|reconcile|incident|resolve_incident|accept|delivery|prepare|preflight)$/u);
      if(match) {
        requireFact(request.method===(match[2]==='status'?'PATCH':'POST'),'请求方式不支持',405);
        const body=await readJson(request,64*1024),key=request.headers['idempotency-key'];
        if(['cloud_output','reconcile'].includes(match[2])) {
          requireFact(cloudReader && session.payload.access?.allowed_modules?.includes('cloud-manager'),'当前账号未开通云管家',403);
          const result=match[2]==='cloud_output'?await cloudReader.register(request,access,match[1],body,key):await cloudReader.reconcile(request,access,match[1],body);
          sendJson(response,200,result);return true;
        }
        const result=['prepare','preflight'].includes(match[2])?await assistant.run(access,match[1],match[2],body,key):engine.command(access,match[1],match[2],body,key);
        sendJson(response,200,result);return true;
      }
      throw new WorkflowError(404,'任务接口不存在');
    } catch(error) {
      const status=error instanceof WorkflowError?error.status:503;
      if(status===503) response.setHeader('Retry-After','3');
      sendJson(response,status,{detail:error instanceof WorkflowError?error.message:'任务处理未完成，内容已保留，请刷新核对；不要重复提交'});return true;
    }
  };
}
