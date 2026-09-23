function taskPerspective(task,number){
 const nodes=task.nodes||task.runtime?.nodes||[],own=nodes.filter(n=>n.owner?.number===number);
 const ready=own.filter(n=>n.state==='ready');
 const focus=ready.length?ready:own.filter(n=>n.state==='pending');
 const current=focus.length?focus:own.slice(-1),ids=new Set(current.map(n=>n.id));
 const before=new Set(current.flatMap(n=>n.dependencies||[]));
 return {own,current,ready,upstream:nodes.filter(n=>before.has(n.id)&&!ids.has(n.id)),downstream:nodes.filter(n=>(n.dependencies||[]).some(id=>ids.has(id))&&!ids.has(n.id))};
}
function personalNodeSummary(nodes,emptyText){return nodes.length?nodes.map(n=>`<span><b>${esc(n.owner?.name||'待指派')}</b> · ${esc(n.title||'任务环节')}<small>${esc(labels[n.state]||n.state)}</small></span>`).join(''): `<span class="muted">${emptyText}</span>`;}
function personalRelationsHtml(task){
 const relations=task.relations||task.runtime?.relations;if(!relations)return '';
 return ['upstream','downstream'].map(direction=>{
  const value=relations[direction];if(!value)return '';
  const rows=Array.isArray(value)?value:[value];
  return rows.map(row=>`<p class="personal-related"><b>${direction==='upstream'?'上游任务':'下游任务'}</b> ${row.taskId&&row.canOpen!==false?`<button class="button quiet" data-task="${esc(row.taskId)}">${esc(row.title||'查看任务')}</button>`:esc(row.title||'关联任务')} ${esc(row.owner?.name||'')}</p>`).join('');
 }).join('');
}
function personalTaskJourney(task){
 const p=taskPerspective(task,state.overview.access.number);
 return `<div class="personal-journey" aria-label="我的上下游"><div><small>上游交给我</small>${personalNodeSummary(p.upstream,'由任务发起人交办')}</div><span class="journey-arrow" aria-hidden="true">→</span><div class="personal-current"><small>我负责</small>${personalNodeSummary(p.current,'我参与的任务')}</div><span class="journey-arrow" aria-hidden="true">→</span><div><small>我交给下游</small>${personalNodeSummary(p.downstream,'本环节结束后完成任务')}</div></div>${personalRelationsHtml(task)}`;
}
function personalTasks(){
 const number=state.overview.access.number,filter=state.personalFilter||'active';
 const visible=(state.overview.tasks||[]).filter(t=>hasSearch(t.title+' '+(t.product||'')+' '+t.nodes.map(n=>n.owner?.name||'').join(' ')));
 const items=visible.filter(t=>filter==='ended'?['completed','cancelled'].includes(t.state):filter==='todo'?t.state==='running'&&taskPerspective(t,number).ready.length:!['completed','cancelled'].includes(t.state)).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
 const pages=Math.max(1,Math.ceil(items.length/12)),page=Math.min(state.personalPage||1,pages);state.personalPage=page;
 return `<section class="panel personal-tasks"><div class="panel-heading"><div><h2>我的任务</h2><p class="muted">办理自己的事项，查看上游交付与下一位接收人。</p></div><span class="muted">${items.length} 项</span></div><nav class="personal-filters" aria-label="个人任务状态">${[['active','进行中'],['todo','待我办理'],['ended','已结束']].map(([id,label])=>`<button class="chip ${filter===id?'active':''}" data-personal-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('')}</nav>${items.length?items.slice((page-1)*12,page*12).map(t=>{const p=taskPerspective(t,number),ready=t.state==='running'&&p.ready.length,late=ready&&p.ready.some(n=>n.dueAt&&Date.parse(n.dueAt)<Date.now());return `<article class="personal-task"><header><div><div class="personal-task-meta">${pill(flowName(t.workflow),'blue')}${status(t.state)}${late?pill('已超时','amber'):''}</div><h3><button data-task="${esc(t.id)}">${esc(t.title)}</button></h3><p class="muted">${t.product?esc(t.product)+' · ':''}主责 ${esc(t.owner?.name||'待指派')}${p.ready[0]?.dueAt?' · '+fmt(p.ready[0].dueAt)+' 前完成':''}</p></div><button class="button ${ready?'primary':''}" data-task="${esc(t.id)}">${ready?'办理任务':'查看任务'}</button></header>${personalTaskJourney(t)}</article>`;}).join(''):empty(filter==='todo'?'目前没有轮到我办理的任务':'暂无符合条件的任务','收到新任务后会在这里显示，可随时查看交付和流转情况。')}${pages>1?`<nav class="personal-pagination" aria-label="任务分页"><button class="button" data-personal-page="${page-1}" ${page===1?'disabled':''}>上一页</button><span>${page} / ${pages}</span><button class="button" data-personal-page="${page+1}" ${page===pages?'disabled':''}>下一页</button></nav>`:''}</section>`;
}
