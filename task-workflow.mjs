import { createHash, randomUUID } from 'node:crypto';
import { requireFact, WorkflowError } from './workflow-store.mjs';

export const workflowTemplates = [
  { id: '00', title: '情报研判与 WIS 适配', acceptance: '来源链接、适配判断、可执行方向；主管确认后下发', lane: 'action' },
  { id: '01', title: '一创素材生产', acceptance: '产品资料来源、脚本、成片版本及审核记录', lane: 'content' },
  { id: '02', title: '二创混剪裂变', acceptance: '母版来源、混剪任务编号、成片版本及审核记录', lane: 'content' },
  { id: '03', title: '审核与分发', acceptance: '审核通过的素材版本、目标账号及平台回执', lane: 'content' },
  { id: '04', title: '直播转化', acceptance: '场次、执行记录、问题处理与主管验收', lane: 'action' },
  { id: '05', title: '数据回流与决策', acceptance: '业务日期、来源、指标口径、覆盖情况及改进决定', lane: 'action' },
];
export const sourceKinds = ['creative_radar', 'video_link', 'video_file', 'text', 'meeting_action', 'business_anomaly', 'live_session'];
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export const text = (value, max = 2000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max);
export function safeUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); requireFact(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, '链接须为 HTTP/HTTPS，且不能包含密码'); return url.href; }
  catch { throw new WorkflowError(400, '请填写有效链接'); }
}
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const fingerprint = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function visible(task, access) {
  return !task.runtime && access.enabled && task.center === access.user.center && (access.canManage || task.kind === 'opportunity' || !task.assignees.length || task.assignees.some(p => p.number === access.user.number));
}
export function publicTask(task) {
  const attachment = task.attachment ? { id: task.attachment.id, filename: task.attachment.filename, mimeType: task.attachment.mimeType, sizeBytes: task.attachment.sizeBytes,
    contentUrl: `api/task-center/attachments/${task.attachment.id}/content` } : null;
  // Explicit allowlist: never expose bridge signatures, tokens or internal queue data.
  const keys = ['id','center','kind','status','sourceKind','sourceUrl','title','description','dueAt','assignees','assignee','createdBy','createdAt','updatedAt','version','workflow','lane','acceptance','outputs','reviews','deliveries','feedback','legacyUnverified','sourceReference'];
  return { ...Object.fromEntries(keys.map(key => [key, task[key]])), primaryOwner: task.assignees[0] || null,
    collaborators: task.assignees.slice(1), attachment, events: (task.events || []).slice(-30), externalNotificationState: 'pending_integration' };
}
function event(state, task, actor, action, note = '') {
  const record = { id: id('evt'), action, by: actor.name, byNumber: actor.number, at: now(), note: text(note, 500) };
  task.events = [...(task.events || []), record]; task.updatedAt = record.at;
  state.outbox.push({ id: record.id, taskId: task.id, type: action, center: task.center, recipients: task.assignees.map(p => p.number), state: 'in_hub', createdAt: record.at });
}
function owned(task, access) { requireFact(access.canManage || task.assignees.some(p => p.number === access.user.number), '请先领取任务', 403); }
function manager(access) { requireFact(access.enabled && access.canManage, '此操作需要主管或总监确认', 403); }
function version(task, body) {
  requireFact(Number.isInteger(body.expectedVersion), '请刷新任务后再操作', 428);
  requireFact(task.version === body.expectedVersion, '任务已被更新，请刷新后再操作', 409);
}
function dueDate(value) {
  if (!value) return null;
  requireFact(/(Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)), '截止时间须包含时区');
  return new Date(value).toISOString();
}
export class TaskWorkflow {
  constructor(store, { resolveAssignees, saveVideo } = {}) { this.store = store; this.resolveAssignees = resolveAssignees; this.saveVideo = saveVideo; }
  assignments(value) {
    const people = this.resolveAssignees(value);
    requireFact(people !== null, '请从当前中心的在职成员中选择主责和协作人（最多 20 人）');
    return people;
  }
  overview(access) {
    const state = this.store.read();
    const items = state.tasks.filter(task => visible(task, access)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    return { schemaVersion: 3, generatedAt: now(), templates: workflowTemplates,
      pilot: { center: access.user.center, state: 'pilot', notificationChannel: 'in_hub', externalNotificationState: 'pending_integration', note: '中枢内提醒已启用；飞书主动提醒未启用。' },
      access: { role: access.user.role, canManage: access.canManage, personNumber: access.user.number, personName: access.user.name },
      tasks: items.filter(t => t.kind === 'formal').map(publicTask), opportunities: items.filter(t => t.kind === 'opportunity' && t.status !== 'cancelled').map(publicTask),
      alerts: items.filter(t => t.kind === 'formal' && !['cancelled','completed'].includes(t.status) && t.dueAt && Date.parse(t.dueAt) < Date.now()).map(t => ({taskId:t.id,title:t.title,kind:'overdue'})),
      assistance: state.incidents.filter(i => items.some(t => t.id === i.taskId)).map(({id,taskId,status,stage,createdAt}) => ({id,taskId,status,stage,createdAt})),
    };
  }
  create(access, body, key) {
    manager(access);
    requireFact(typeof key === 'string' && key.length >= 8 && key.length <= 128, '缺少防重复提交编号，请刷新后重试');
    const hash = fingerprint(body), dedupeKey = `${access.user.number}:create:${key}`;
    return this.store.transaction(state => {
      const previous = state.dedupe[dedupeKey];
      if (previous) { requireFact(previous.hash === hash, '相同提交编号对应不同内容，请刷新后重新提交', 409); return publicTask(state.tasks.find(t => t.id === previous.taskId)); }
      requireFact(sourceKinds.includes(body.sourceKind), '请选择有效来源');
      const template = workflowTemplates.find(t => t.id === (body.workflow || '02'));
      requireFact(template, '请选择有效工作流');
      const title = text(body.title,100); requireFact(title.length >= 2, '请填写任务标题');
      const sourceUrl = safeUrl(body.sourceUrl);
      requireFact(!['creative_radar','video_link','meeting_action','business_anomaly'].includes(body.sourceKind) || sourceUrl, '请保留原始来源链接');
      const sourceReference = text(body.sourceReference,200);
      if (sourceReference && ['creative_radar','meeting_action','business_anomaly','live_session'].includes(body.sourceKind)) {
        const existing = state.tasks.find(t=>t.center===access.user.center && t.sourceKind===body.sourceKind && t.sourceReference===sourceReference && t.workflow===template.id && t.status!=='cancelled');
        if(existing) { state.dedupe[dedupeKey]={hash,taskId:existing.id}; return publicTask(existing); }
      }
      const assignees = this.assignments(body.assignees ?? body.assignee);
      const opportunity = body.sourceKind === 'creative_radar';
      const task = { id:id('task'), version:1, workflow:template.id, lane:body.lane === 'action' ? 'action' : template.lane, center:access.user.center,
        kind:opportunity?'opportunity':'formal', status:opportunity?'opportunity':assignees.length?'in_progress':'pending_claim',
        title, description:text(body.description), acceptance:text(body.acceptance || template.acceptance), sourceKind:body.sourceKind, sourceUrl,
        sourceReference, dueAt:dueDate(body.dueAt), assignees, assignee:assignees[0] || null,
        createdBy:access.user, createdAt:now(), updatedAt:now(), outputs:[], reviews:[], deliveries:[], feedback:[], legacyUnverified:false };
      if (body.sourceKind === 'video_file') task.attachment = this.saveVideo(body.video,task.id);
      state.tasks.push(task); event(state,task,access.user,opportunity?'opportunity_created':'task_dispatched');
      state.dedupe[dedupeKey] = { hash,taskId:task.id }; return publicTask(task);
    });
  }
  command(access, taskId, action, body, key, trusted = {}) {
    requireFact(typeof key === 'string' && key.length >= 8 && key.length <= 128, '缺少防重复操作编号');
    return this.store.transaction(state => {
      const task = state.tasks.find(t => t.id === taskId && visible(t,access)); requireFact(task,'任务不存在或当前账号不可见',404);
      const dedupeKey = `${access.user.number}:${taskId}:${action}:${key}`, hash = fingerprint(body);
      const previous = state.dedupe[dedupeKey];
      if (previous) { requireFact(previous.hash === hash,'重复操作的内容不一致',409); return publicTask(task); }
      version(task,body);
      const terminal = ['completed','cancelled'].includes(task.status);
      if (action === 'incident') {
        const stage = text(body.stage || task.status,80);
        const open = state.incidents.find(i => i.taskId === task.id && i.stage === stage && i.status === 'open');
        if (!open) state.incidents.push({id:id('incident'),taskId:task.id,center:task.center,stage,status:'open',createdAt:now(),reporter:access.user.number,note:text(body.note,500)});
      } else if(action === 'resolve_incident') {
        requireFact(access.canMaintain,'只有维护人员可以关闭故障',403);
        const incident=state.incidents.find(i=>i.id===body.incidentId && i.taskId===task.id);
        requireFact(incident && incident.status==='open','故障已处理或不存在',409);
        requireFact(text(body.note),'请记录恢复办法和核验结果');
        incident.status='resolved'; incident.resolution=text(body.note,500); incident.resolvedAt=now();
      } else {
        requireFact(!terminal,'该任务已结束',409);
        if (action === 'convert') {
          manager(access); requireFact(task.kind === 'opportunity','只能转换机会提醒',409);
          task.assignees = this.assignments(body.assignees); task.assignee = task.assignees[0] || null;
          task.kind='formal'; task.status=task.assignees.length?'in_progress':'pending_claim'; task.dueAt=dueDate(body.dueAt) || task.dueAt;
        } else if (action === 'claim') {
          requireFact(!access.canManage && task.kind === 'formal' && task.status === 'pending_claim' && !task.assignees.length,'任务已被领取或不能领取',409);
          task.assignees=[{number:access.user.number,name:access.user.name}]; task.assignee=task.assignees[0]; task.status='in_progress';
        } else if (action === 'assign') {
          manager(access); task.assignees=this.assignments(body.assignees); task.assignee=task.assignees[0] || null;
          requireFact(task.assignees.length || task.status === 'pending_claim','进行中的任务需要一位主责人');
          if(task.status === 'pending_claim' && task.assignees.length) task.status='in_progress';
        } else if (action === 'output') {
          owned(task,access); requireFact(['in_progress','rework'].includes(task.status),'当前状态不能修改交付版本',409);
          const url=safeUrl(body.url), assetId=text(body.assetId,150), assetVersion=text(body.assetVersion,100);
          requireFact(url && assetId && assetVersion,'请填写交付链接、资产或文档编号以及版本');
          requireFact(!task.outputs.some(o=>o.assetId===assetId && o.assetVersion===assetVersion),'相同资产版本已登记，修改内容请提交新版本',409);
          task.outputs.push({id:id('output'),url,assetId,assetVersion,productionJobId:text(body.productionJobId,150),summary:text(body.summary,1000),createdAt:now(),by:access.user.number,...(trusted.cloudSnapshot?{cloudSnapshot:trusted.cloudSnapshot}:{})});
        } else if (action === 'status') {
          owned(task,access); const next=body.status;
          if (next === 'pending_review') {
            requireFact(['in_progress','rework'].includes(task.status) && task.outputs.length,'请先登记交付内容，再提交审核',409);
            const previousReview=task.reviews.at(-1);
            requireFact(previousReview?.decision!=='rework' || previousReview.outputId!==task.outputs.at(-1).id,'请提交修改后的新版本再送审',409);
          } else if (['approved','rework'].includes(next)) {
            manager(access); requireFact(task.status === 'pending_review' || (next === 'rework' && task.status === 'approved'),'请按审核顺序处理',409);
            requireFact(next !== 'rework' || text(body.note),'退回时请说明修改要求');
            task.reviews.push({id:id('review'),outputId:task.outputs.at(-1).id,decision:next,by:access.user.number,note:text(body.note,500),at:now()});
          } else if (next === 'cancelled') { manager(access); requireFact(!task.deliveries.some(d=>d.state!=='failed'),'已有推送意图或回执，请先核验，不能直接取消',409);
          } else { throw new WorkflowError(409,'推送和回流状态由可核验回执更新，不能手动标记'); }
          task.status=next;
        } else if (action === 'accept') {
          manager(access); requireFact(task.lane === 'action' && task.status === 'approved','该任务尚未完成交付审核',409);
          requireFact(text(body.note),'请记录验收结论'); task.status='completed';
        } else if (action === 'delivery') {
          manager(access); requireFact(task.lane === 'content' && task.status === 'approved','请先审核当前交付版本',409);
          const output=task.outputs.at(-1), review=task.reviews.at(-1);
          requireFact(review?.decision==='approved' && review.outputId===output?.id,'当前版本尚未审核通过',409);
          const platform=text(body.platform,50), accountId=text(body.accountId,120), planId=text(body.planId,120);
          requireFact(['qianchuan','wechat_channels'].includes(platform) && accountId,'请选择平台并填写目标账号');
          requireFact(platform !== 'qianchuan' || planId,'千川推送需要目标计划编号');
          const operationKey=fingerprint({taskId,outputId:output.id,platform,accountId,planId});
          requireFact(!task.deliveries.some(d=>d.operationKey===operationKey),'该版本对该目标已有操作，请查看原记录，不要重复推送',409);
          task.deliveries.push({id:id('delivery'),operationKey,outputId:output.id,assetId:output.assetId,assetVersion:output.assetVersion,platform,accountId,planId,state:'awaiting_adapter',createdAt:now()});
        } else { throw new WorkflowError(404,'任务操作不存在'); }
      }
      task.version++; event(state,task,access.user,action,text(body.note,500)); state.dedupe[dedupeKey]={hash,taskId}; return publicTask(task);
    });
  }
  // Only a configured, authenticated module adapter may call this method.
  serviceEvent(input, principal) {
    requireFact(principal?.types?.includes(input.type),'该适配器没有此回执权限',403);
    requireFact(text(input.eventId,150) && text(input.taskId,150),'回执编号或任务编号缺失');
    return this.store.transaction(state => {
      const key=`${principal.id}:${input.eventId}`, hash=fingerprint(input), old=state.serviceEvents[key];
      if(old) { requireFact(old.hash===hash,'回执编号内容冲突',409); return {accepted:true,duplicate:true}; }
      const task=state.tasks.find(t=>t.id===input.taskId && principal.centers.includes(t.center)); requireFact(task,'任务不存在或超出适配器范围',404);
      requireFact(task.status!=='cancelled','已取消的任务不接受回执',409);
      if(input.type==='delivery_receipt') {
        const delivery=task.deliveries.find(d=>d.id===input.deliveryId); requireFact(delivery,'推送意图不存在',409);
        for(const field of ['assetId','assetVersion','platform','accountId','planId']) requireFact((input[field] || '')===delivery[field],`回执 ${field} 与目标不符`,409);
        requireFact(['queued','unknown','failed','succeeded'].includes(input.state),'无效推送结果');
        requireFact(delivery.state !== 'succeeded' || input.state==='succeeded','成功回执不能被降级',409);
        const latestReview=task.reviews.at(-1);
        requireFact(latestReview?.decision==='approved' && latestReview.outputId===delivery.outputId,'回执对应版本的审核已变化，请人工核对',409);
        if(input.state==='succeeded') {
          requireFact(input.verified === true && text(input.receiptId,150) && safeUrl(input.receiptUrl),'成功结果必须有平台核验回执');
          requireFact(!delivery.receiptId || delivery.receiptId===input.receiptId,'成功回执不可替换',409);
          delivery.receiptId=text(input.receiptId,150); delivery.receiptUrl=safeUrl(input.receiptUrl); delivery.verifiedAt=now(); if(task.status!=='completed') task.status='pushed';
        }
        delivery.state=input.state; delivery.updatedAt=now();
      } else if(input.type==='business_feedback') {
        requireFact(task.status==='pushed' || task.status==='completed','请先取得成功推送回执',409);
        const delivery=task.deliveries.find(d=>d.id===input.deliveryId && d.state==='succeeded'); requireFact(delivery,'缺少对应推送成功回执',409);
        requireFact(/^\d{4}-\d{2}-\d{2}$/u.test(input.businessDate) && Number.isFinite(Date.parse(input.businessDate)) && new Date(input.businessDate).toISOString().slice(0,10)===input.businessDate && safeUrl(input.sourceUrl),'请提供真实业务日期与数据来源');
        requireFact(['complete','partial','pending'].includes(input.coverage),'请明确数据覆盖情况');
        const allowed=['paidGmv','netGsv','spend','orders'];
        requireFact(input.metrics && Object.keys(input.metrics).every(k=>allowed.includes(k)) && Object.values(input.metrics).every(v=>v===null || (typeof v==='number' && Number.isFinite(v) && v>=0)),'指标必须是非负数或 null，且不能混用口径');
        requireFact(input.coverage !== 'complete' || (Object.keys(input.metrics).length>0 && Object.values(input.metrics).every(v=>v!==null)),'完整数据不能缺项');
        task.feedback.push({id:id('feedback'),deliveryId:delivery.id,businessDate:input.businessDate,sourceUrl:safeUrl(input.sourceUrl),coverage:input.coverage,metrics:input.metrics,at:now()});
        // Daily feedback is append-only; a task closes only when every declared delivery is successful and covered.
        if(task.deliveries.every(d=>d.state==='succeeded' && task.feedback.some(f=>f.deliveryId===d.id && f.coverage==='complete'))) task.status='completed';
      } else if(input.type==='asset_probe') {
        const output=task.outputs.find(o=>o.id===input.outputId && o.assetId===input.assetId && o.assetVersion===input.assetVersion);
        requireFact(output,'未找到匹配资产版本',409);
        requireFact(typeof input.readable==='boolean' && ['durationSeconds','width','height'].every(k=>input[k]===null || (typeof input[k]==='number' && Number.isFinite(input[k]) && input[k]>=0)),'资产实测字段无效');
        output.probe={verified:true,readable:input.readable,durationSeconds:input.durationSeconds,width:input.width,height:input.height,verifiedAt:now(),sourceAdapter:principal.id};
      } else throw new WorkflowError(400,'回执类型不支持');
      task.version++; event(state,task,{number:principal.id,name:'平台核验'},input.type); state.serviceEvents[key]={hash,at:now()}; return {accepted:true,duplicate:false};
    });
  }
}
