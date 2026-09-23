import {requireFact} from './workflow-store.mjs';
const plain = content => ({tag: 'plain_text', content: String(content).slice(0,150)});
const escape = value => String(value || '').slice(0,1200).replace(/[&<>*~\[\]()#_:]/g, c => `&#${c.charCodeAt(0)};`);
const markdown = content => ({tag: 'markdown', content});
const at = value => new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false});
const input = (name, label) => ({tag:'input', name, label:plain(label), required:true, max_length:1000});
const button = (name, title, primary = false) => ({tag:'button', name, text:plain(title), type:primary?'primary_filled':'default', form_action_type:'submit'});
// All targets are resolved from the persisted message receipt on the server.
// The card never carries a bearer credential, editable owner ID or task ID.
export function liveFeishuCard(notice, task, {receipt = null} = {}) {
  const slot = task.runtime?.liveSession, node = task.runtime?.nodes.find(n => n.id === notice.nodeId);
  requireFact(slot && node?.owner.number === notice.recipient, '卡片不是本人直播节点', 403);
  const ready = task.runtime.state === 'running' && !slot.sourceIssue && node.state === 'ready' && node.attempt === notice.attempt;
  const active = task.runtime.state === 'running' && !slot.sourceIssue && ['pending','ready'].includes(node.state) && node.attempt === notice.attempt;
  const elements = [{tag:'column_set',flex_mode:'none',columns:[{tag:'column',width:'weighted',weight:1,background_style:'blue-50',padding:'12px',vertical_spacing:'4px',elements:[
    markdown(`**${escape(slot.roomName)} · ${escape(node.owner.name)}**`),
    markdown(`计划班次：${escape(at(slot.startAt))} — ${escape(at(slot.endAt))}\n本人工作：${escape(node.title)}`),
  ]}]}];
  elements.push(markdown(receipt ? escape(receipt) : ready ? '**当前可办理。** 请在实际工作完成后提交；计划时间不能作为实际时间。' : active ? '请确认收到排班。前置环节完成后会另行通知；确认收到不等于完成工作。' : '本通知已不可办理，请以最新通知和负责人说明为准。'));
  // An acknowledgement is not completion. Preserve the ability to report a
  // problem or finish a ready node after the first card update.
  if (active) {
    elements.push({tag:'form', name:'live_feedback', elements:[input('feedbackNote','确认说明或异常情况'),button('live_ack','确认收到排班',!ready),button('live_issue','反馈异常')]});
    if (ready) elements.push({tag:'form',name:'live_completion',elements:[
      input('actualStart','实际开始时间（例：2026-09-23 09:00，北京时间）'),
      input('actualEnd','实际结束时间（北京时间）'),input('platformSessionId','真实平台场次编号'),
      input('evidenceUrl','可核验的场次记录链接（https）'),input('completionNote','本场交付结论'),
      button('live_complete','确认实际完成并提交',true),
    ]});
  }
  return {schema:'2.0',config:{update_multi:true,width_mode:'default',enable_forward:false},
    header:{title:plain(receipt?'直播工作办理回执':'WIS 直播工作通知'),subtitle:plain(slot.date+' · 品牌营销部中枢'),template:'blue',icon:{tag:'standard_icon',token:'todo_colorful'}},
    body:{direction:'vertical',padding:'12px',vertical_spacing:'12px',elements}};
}
