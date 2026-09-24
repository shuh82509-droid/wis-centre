// Verify the current round and recipient immediately before acquiring a send
// lease. An old return/overdue event must not notify the previous assignee.
export function currentNodeNotice(notice,task,node,now){
  if(notice.kind==='live_tomorrow'){
    const slot=task?.runtime?.liveSession;
    const local=new Date(now+8*3600000),tomorrow=new Date(now+8*3600000+86400000).toISOString().slice(0,10);
    return local.getUTCHours()>=16&&notice.businessDate===tomorrow&&slot?.date===tomorrow&&slot.signature===notice.signature&&
      !slot.sourceIssue&&task.runtime.state==='running'&&['pending','ready'].includes(node?.state)&&
      node.attempt===notice.attempt&&node.owner.number===notice.recipient;
  }
  if(['live_assignment','live_today'].includes(notice.kind)){
    const slot=task?.runtime?.liveSession;
    if(!slot||slot.sourceIssue||task.runtime.state!=='running'||!['pending','ready'].includes(node?.state)||node.attempt!==notice.attempt||node.owner.number!==notice.recipient)return false;
    if(notice.kind==='live_assignment')return Date.parse(slot.endAt)>now;
    return notice.businessDate===new Date(now+8*3600000).toISOString().slice(0,10)&&Date.parse(slot.startAt)<Date.parse(notice.businessDate+'T00:00:00+08:00')+86400000&&Date.parse(slot.endAt)>now;
  }
  if(notice.kind==='live_source_changed')return !!(task?.runtime?.liveSession?.sourceIssue&&['running','paused'].includes(task.runtime.state)&&notice.recipient===task.runtime.manager.number);
  if(task?.runtime?.liveSession?.sourceIssue&&['ready','returned','overdue','escalated','live_source_restored'].includes(notice.kind))return false;
  if(!['ready','returned','overdue','escalated','live_source_restored'].includes(notice.kind))return true;
  if(task?.runtime?.state!=='running'||node?.state!=='ready'||node.attempt!==notice.attempt)return false;
  const expected=notice.kind==='escalated'?task.runtime.manager.number:node.owner.number;
  if(expected!==notice.recipient)return false;
  if(['overdue','escalated'].includes(notice.kind)){
    if(!Number.isFinite(Date.parse(node.dueAt))||Date.parse(node.dueAt)>now||!node.warnedAt)return false;
    if(Date.parse(notice.createdAt)<Date.parse(node.warnedAt))return false;
    if(notice.kind==='escalated'&&(!node.escalatedAt||now-Date.parse(node.dueAt)<86400000))return false;
    if(notice.kind==='escalated'&&Date.parse(notice.createdAt)<Date.parse(node.escalatedAt))return false;
  }
  return true;
}
