// Verify the current round and recipient immediately before acquiring a send
// lease. An old return/overdue event must not notify the previous assignee.
export function currentNodeNotice(notice,task,node,now){
  if(!['ready','returned','overdue','escalated'].includes(notice.kind))return true;
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
