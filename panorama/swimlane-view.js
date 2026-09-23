// The panorama is a single row of business lanes. Execution and orchestration
// still use the resolved, published catalog; layout never changes its graph.
function swimlaneGeometry(viewportWidth, count, {fit=true, scale=1}={}) {
 const gap=28,padding=18,columns=Math.max(1,count),safeScale=Math.max(.9,Math.min(1.8,scale));
 const laneWidth=fit?Math.max(260,Math.min(340,Math.floor((viewportWidth-padding*2-gap*(columns-1))/columns))):300;
 return {columns,laneWidth,gap,padding,scale:fit?1:safeScale,width:columns*laneWidth+(columns-1)*gap+padding*2};
}
function swimlaneModuleRoutes(flows,edges) {
 const index=new Map(flows.map((f,i)=>[f.id,i])),tracks=[];
 return edges.map(edge=>{
  const from=index.get(edge.from),to=index.get(edge.to);
  if(from===undefined||to===undefined)return null;
  if(to===from+1&&edge.type==='sequence')return {...edge,scope:'module',track:-1};
  const left=Math.min(from,to),right=Math.max(from,to);let track=0;
  while(tracks[track]?.some(range=>!(right<range.left||left>range.right)))track++;
  (tracks[track]??=[]).push({left,right});return {...edge,scope:'module',track};
 }).filter(Boolean);
}
function swimlaneRailHeight(edges) {return Math.max(0,...edges.filter(e=>e.scope==='module').map(e=>e.track+1))*18;}
function swimlaneEdgeStyle(edge) {return edge.enabled===false||edge.type==='reference'?'inactive':['condition','branch','conditional'].includes(edge.type)?'condition':'active';}
function swimlaneEdgeLabel(edge) {
 const conditions={black_mask:'产品为黑晶面膜',water_mask:'产品为隐形水润面膜',asset_ready:'已取得核验通过的云管家资产',source_shortage:'自动批次缺少合格来源素材',quality_issue:'自动批次出现成片质量或审核异常',node_overdue:'当前办理节点超时'};
 return conditions[edge.condition||edge.label]||edge.label||'实际前置关系';
}
function swimlaneStageEdges(flow,stages) {
 const nodes=resolvedNodesFor(flow.id),groups=new Map(nodes.map(n=>[n.id,n.displayStageId||n.stageId]));
 // An explicitly empty resolved graph is meaningful: do not invent a chain.
 const edges=Array.isArray(flow.resolvedEdges)?flow.resolvedEdges:edgesFromNodes(nodes);
 return normalizedGraphEdges(stages,edges.map(e=>({...e,from:groups.get(e.from),to:groups.get(e.to)})))
  .map(e=>({...e,scope:'stage',lane:flow.id}));
}
function swimlaneEdgePaths(edges,positions,lanes) {
 return edges.flatMap((edge,index)=>{
  const from=positions.get(edge.from),to=positions.get(edge.to);if(!from||!to)return [];
  let d;
  if(edge.scope==='module'){
   if(edge.track===-1)d=`M${from.x+from.w},${from.y+from.h/2} L${to.x-3},${to.y+to.h/2}`;
   else {const sx=from.x+from.w/2,tx=to.x+to.w/2,y=12+edge.track*18;
    d=`M${sx},${from.y} L${sx},${y+5} Q${sx},${y} ${sx+(tx>sx?5:-5)},${y} L${tx+(tx>sx?-5:5)},${y} Q${tx},${y} ${tx},${y+5} L${tx},${to.y-3}`;}
  }else{
   const lane=lanes.get(edge.lane);if(!lane)return [];
   if(to.order===from.order+1&&to.y>=from.y+from.h){
    const x=from.x+from.w/2;d=`M${x},${from.y+from.h} L${x},${to.y-3}`;
   }else{
    // Branches, joins and returns use the lane gutter, never the card text.
    const x=lane.x+lane.w-7-(index%3)*4,sy=from.y+from.h/2,ty=to.y+to.h/2;
    d=`M${from.x+from.w},${sy} L${x},${sy} L${x},${ty} L${to.x+to.w+3},${ty}`;
   }
  }
  return [{edge,d,type:swimlaneEdgeStyle(edge)}];
 });
}
function swimlaneMarkup(flows) {
 const allModuleEdges=moduleGraphEdges(flows),referenceCount=allModuleEdges.filter(e=>e.type==='reference').length;
 const moduleEdges=swimlaneModuleRoutes(flows,allModuleEdges.filter(e=>e.type!=='reference'||state.swimlaneReferences)),stageEdges=[],blueprint=state.catalog.blueprint;
 const html=flows.map(flow=>{
  const stages=state.catalog.stages.filter(s=>s.flow===flow.id),nodes=resolvedNodesFor(flow.id),tasks=state.overview.tasks.filter(t=>t.workflow===flow.id&&t.state==='running');
  stageEdges.push(...swimlaneStageEdges(flow,stages));
  return `<section class="swimlane ${flow.id==='06'?'swimlane-independent':''}" data-swimlane="${esc(flow.id)}" aria-label="${esc(flow.name)}泳道"><button type="button" class="swimlane-route" data-canvas-flow="${esc(flow.id)}" data-module-anchor="${esc(flow.id)}"><span>W${esc(flow.id)}</span><b>${esc(flow.short||flow.name)}</b></button><div class="swimlane-panel"><header class="swimlane-head"><div class="swimlane-name"><span class="lane-code">W${esc(flow.id)}</span><h2>${esc(flow.name)}</h2></div><p>${stages.length} 个环节 · ${nodes.length} 个执行节点${flow.id==='06'?' · 独立事项':''}</p><div class="swimlane-meta"><span>${esc(flow.owner||'按任务确定主责')}</span><span>${tasks.length} 项在办</span></div></header><ol class="swimlane-stages">${stages.map((stage,i)=>{
   const ready=tasks.filter(t=>t.nodes?.some(n=>n.state==='ready'&&stage.steps.some(s=>s.id===n.id))).length;
   return `<li><button type="button" class="swimlane-stage ${state.stage===stage.id?'selected':''} ${state.search&&hasSearch(stage.title+' '+stage.output+' '+stage.steps.map(n=>n.title).join(' '))?'search-match':''}" data-stage="${esc(stage.id)}" data-canvas-node="${esc(stage.id)}" data-stage-order="${i}" aria-expanded="${state.stage===stage.id}" aria-controls="drawer"><span class="swimlane-stage-title"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(stage.title)}</strong></span>${stage.output?`<span class="swimlane-stage-output">${esc(stage.output)}</span>`:''}<span class="swimlane-stage-meta"><span>${stage.steps.length} 个执行节点${stage.executionMode==='parallel'?' · 并行':''}</span>${ready?`<span class="swimlane-ready">${ready} 项待办</span>`:''}</span><span class="swimlane-stage-open">查看执行节点 <span aria-hidden="true">→</span></span></button></li>`;
  }).join('')}</ol>${flow.output||flow.finish?`<footer class="swimlane-output"><b>${flow.output?'流程输出':'完成标准'}</b><p>${esc(flow.output||flow.finish)}</p></footer>`:''}</div></section>`;
 }).join('');
 const edges=[...moduleEdges,...stageEdges],label=flows.length===1?flows[0].name+' · 泳道图':'业务流程全景 · 泳道图';
 const relations=allModuleEdges.map(e=>`<li><span>${esc(flows.find(f=>f.id===e.from)?.short||e.from)} <span aria-hidden="true">→</span> ${esc(flows.find(f=>f.id===e.to)?.short||e.to)}</span><span class="relation-state ${swimlaneEdgeStyle(e)}">${e.type==='reference'?'业务关联 · 仅供参考':e.enabled===false?'未启用自动交接':e.type==='condition'?'条件触发 · 已启用':'完成后自动交接'}</span><small>${esc(swimlaneEdgeLabel(e))}</small></li>`).join('');
 return `<section class="flow-canvas-shell swimlane-shell" data-flow-canvas="board-swimlanes-${esc(state.flow)}" data-canvas-kind="swimlanes" data-canvas-columns="${flows.length}" data-canvas-edges="${esc(JSON.stringify(edges))}"><div class="canvas-tools"><div><span class="canvas-caption">${esc(label)}</span><p class="swimlane-version">${blueprint?'已发布 v'+esc(blueprint.version)+' · '+esc(blueprint.name):'默认业务顺序'} · ${blueprint?.defaultRoute?'已启用顺序交接':'顺序交接未开启'}</p></div><div class="canvas-zoom">${referenceCount?`<button class="button quiet" type="button" data-swimlane-references aria-pressed="${!!state.swimlaneReferences}">${state.swimlaneReferences?'收起':'显示'}参考连线 · ${referenceCount}</button>`:''}<button class="button quiet" type="button" data-canvas-fit>适应窗口</button><button class="button quiet" type="button" data-canvas-zoom="-1" aria-label="缩小泳道">−</button><output aria-live="polite">100%</output><button class="button quiet" type="button" data-canvas-zoom="1" aria-label="放大泳道">＋</button><button class="button quiet" type="button" data-canvas-reset>原始大小</button></div></div><div class="canvas-viewport" tabindex="0" aria-label="${esc(label)}，每列为一个业务流程，可横向滚动查看其他泳道"><div class="canvas-sizer"><div class="canvas-world"><svg class="canvas-connectors" aria-hidden="true"></svg><div class="canvas-grid swimlane-grid">${html}</div></div></div></div><div class="canvas-legend"><span><i></i>实际前置 / 已启用交接</span><span><i class="conditional"></i>条件触发</span><span><i class="inactive"></i>关系参考 / 未启用</span><span class="canvas-hint">上方看业务交接，列内看办理顺序；点击环节查看右侧执行节点。泳道保持纵向排列，超出窗口可横向滚动。</span>${state.search?'<span class="canvas-hint">保留命中流程的完整环节，避免截断上下游。</span>':''}</div>${relations?`<details class="swimlane-relations" data-disclosure="swimlane-relations"><summary>核对 ${allModuleEdges.length} 条跨流程关系与触发条件</summary><ul>${relations}</ul></details>`:''}</section>`;
}
function layoutSwimlaneCanvas(canvas) {
 const width=canvas.viewport.clientWidth;if(width<1)return;
 let edges=[];try{edges=JSON.parse(canvas.host.dataset.canvasEdges||'[]');}catch{}
 const geometry=swimlaneGeometry(width,Number(canvas.host.dataset.canvasColumns)||1,{fit:canvas.fitMode,scale:canvas.scale});
 canvas.grid.style.gridTemplateColumns=`repeat(${geometry.columns},${geometry.laneWidth}px)`;
 canvas.grid.style.gap=geometry.gap+'px';canvas.grid.style.paddingTop=geometry.padding+swimlaneRailHeight(edges)+'px';
 canvas.world.style.width=geometry.width+'px';
 const headers=[...canvas.grid.querySelectorAll('.swimlane-head')];headers.forEach(el=>el.style.minHeight='');
 const headerHeight=Math.max(130,...headers.map(el=>el.offsetHeight));headers.forEach(el=>el.style.minHeight=headerHeight+'px');
 canvas.baseWidth=geometry.width;canvas.baseHeight=canvas.grid.scrollHeight;canvas.world.style.height=canvas.baseHeight+'px';canvas.scale=geometry.scale;
 canvas.applyScale();canvas.host.querySelector('[data-canvas-zoom="-1"]').disabled=canvas.scale<=.9;canvas.host.querySelector('[data-canvas-zoom="1"]').disabled=canvas.scale>=1.8;canvas.draw();
 if(!canvas.restored){canvas.viewport.scrollLeft=canvas.preference.left;canvas.viewport.scrollTop=canvas.preference.top;canvas.restored=true;}
}
function drawSwimlaneCanvas(canvas) {
 let edges=[];try{edges=JSON.parse(canvas.host.dataset.canvasEdges||'[]');}catch{}
 const root=canvas.world.getBoundingClientRect(),rect=el=>{const r=el.getBoundingClientRect();return{x:(r.left-root.left)/canvas.scale,y:(r.top-root.top)/canvas.scale,w:r.width/canvas.scale,h:r.height/canvas.scale,order:Number(el.dataset.stageOrder)};};
 const positions=new Map([...canvas.grid.querySelectorAll('[data-module-anchor],[data-canvas-node]')].map(el=>[el.dataset.moduleAnchor||el.dataset.canvasNode,rect(el)]));
 const lanes=new Map([...canvas.grid.querySelectorAll('[data-swimlane]')].map(el=>[el.dataset.swimlane,rect(el)])),marker='swimlane-arrow-'+canvas.id.replace(/[^a-z0-9_-]/gi,'');
 canvas.svg.setAttribute('viewBox',`0 0 ${canvas.baseWidth} ${canvas.baseHeight}`);canvas.svg.setAttribute('width',canvas.baseWidth);canvas.svg.setAttribute('height',canvas.baseHeight);
 canvas.svg.innerHTML=`<defs>${['active','condition','inactive'].map(type=>`<marker id="${marker}-${type}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path class="arrow-${type}" d="M0,0 L7,3.5 L0,7 Z"/></marker>`).join('')}</defs>`+swimlaneEdgePaths(edges,positions,lanes).map(({edge,d,type})=>`<path class="canvas-edge ${type}" data-edge-scope="${edge.scope}" data-edge-from="${esc(edge.from)}" data-edge-to="${esc(edge.to)}" d="${d}" marker-end="url(#${marker}-${type})"><title>${esc(swimlaneEdgeLabel(edge))}${type==='inactive'?'（未启用自动交接）':''}</title></path>`).join('');
}
