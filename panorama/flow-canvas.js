const flowCanvasInstances=new Map(),flowCanvasPreferences=new Map();
function normalizedGraphEdges(nodes,edges=[]){
 const ids=new Set(nodes.map(n=>n.id));const seen=new Set();
 return edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&e.from!==e.to).map(e=>({...e,type:e.type||'dependency',enabled:e.enabled!==false})).filter(e=>{const k=[e.from,e.to,e.type,e.label||''].join('|');if(seen.has(k))return false;seen.add(k);return true;});
}
function edgesFromNodes(nodes){return normalizedGraphEdges(nodes,nodes.flatMap(n=>(n.dependencies||[]).map(from=>({from,to:n.id,type:'dependency',enabled:true}))));}
function graphOrder(nodes,edges=[]){
 const original=new Map(nodes.map((n,i)=>[n.id,i])),byId=new Map(nodes.map(n=>[n.id,n])),incoming=new Map(nodes.map(n=>[n.id,0])),outgoing=new Map(nodes.map(n=>[n.id,[]]));
 for(const e of normalizedGraphEdges(nodes,edges).filter(e=>e.enabled&&e.type!=='condition'&&e.type!=='reference')){incoming.set(e.to,incoming.get(e.to)+1);outgoing.get(e.from).push(e.to);}
 const queue=nodes.filter(n=>incoming.get(n.id)===0).map(n=>n.id),result=[];
 while(queue.length){queue.sort((a,b)=>original.get(a)-original.get(b));const id=queue.shift();result.push(byId.get(id));for(const next of outgoing.get(id)){incoming.set(next,incoming.get(next)-1);if(!incoming.get(next))queue.push(next);}}
 return result.length===nodes.length?result:nodes;
}
function flowCanvasMarkup(id,html,edges,{label='流程关系图',columns=3,kind='board'}={}){
 return `<section class="flow-canvas-shell" data-flow-canvas="${esc(id)}" data-canvas-kind="${esc(kind)}" data-canvas-columns="${columns}" data-canvas-edges="${esc(JSON.stringify(edges))}"><div class="canvas-tools"><span class="canvas-caption">${esc(label)}</span><div class="canvas-zoom"><button class="button quiet" type="button" data-canvas-fit>适应窗口</button><button class="button quiet" type="button" data-canvas-zoom="-1" aria-label="缩小画布">−</button><output aria-live="polite">100%</output><button class="button quiet" type="button" data-canvas-zoom="1" aria-label="放大画布">＋</button><button class="button quiet" type="button" data-canvas-reset>原始大小</button></div></div><div class="canvas-viewport" tabindex="0" aria-label="${esc(label)}，可使用适应窗口或加减按钮缩放"><div class="canvas-sizer"><div class="canvas-world"><svg class="canvas-connectors" aria-hidden="true"></svg><div class="canvas-grid">${html}</div></div></div></div><div class="canvas-legend"><span><i></i>实际前置 / 已启用交接</span><span><i class="conditional"></i>条件触发</span><span><i class="inactive"></i>关系参考 / 未启用</span><span class="canvas-hint">布局随窗口调整，保持文字可读；超出部分可滚动查看。</span></div></section>`;
}
class FlowCanvasController{
 constructor(host){this.host=host;this.id=host.dataset.flowCanvas;this.viewport=host.querySelector('.canvas-viewport');this.sizer=host.querySelector('.canvas-sizer');this.world=host.querySelector('.canvas-world');this.grid=host.querySelector('.canvas-grid');this.svg=host.querySelector('svg');this.preference=flowCanvasPreferences.get(this.id)||{scale:1,fit:true,left:0,top:0};this.scale=this.preference.scale;this.fitMode=this.preference.fit;this.frame=0;this.drag=null;
  host.addEventListener('click',e=>{if(e.target.closest('[data-canvas-fit]')){this.fitMode=true;this.layout();}else if(e.target.closest('[data-canvas-reset]'))this.zoom(1);else{const b=e.target.closest('[data-canvas-zoom]');if(b)this.zoom(this.scale*(Number(b.dataset.canvasZoom)>0?1.2:1/1.2));}});
  this.viewport.addEventListener('scroll',()=>this.save(),{passive:true});this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(this.viewport);this.observer.observe(this.grid);this.layout();this.schedule();
 }
 save(){if(!this.host.isConnected)return;flowCanvasPreferences.set(this.id,{scale:this.scale,fit:this.fitMode,left:this.viewport.scrollLeft,top:this.viewport.scrollTop});}
 schedule(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{if(this.host.isConnected)this.layout();});}
 layout(){if(this.host.dataset.canvasKind==='swimlanes'){layoutSwimlaneCanvas(this);return;}const width=this.viewport.clientWidth;if(width<1)return;const max=Math.max(1,Number(this.host.dataset.canvasColumns)||3),columns=Math.max(1,Math.min(max,Math.floor((width-40)/276)||1));this.grid.style.gridTemplateColumns=`repeat(${columns},240px)`;this.world.style.width=(columns*240+(columns-1)*54+64)+'px';
  const height=this.grid.scrollHeight+64;this.world.style.height=height+'px';this.baseWidth=Number.parseFloat(this.world.style.width);this.baseHeight=height;
  if(this.fitMode)this.scale=Math.max(.15,Math.min(1,(width-20)/this.baseWidth,Math.max(.8,(this.viewport.clientHeight-20)/this.baseHeight)));this.applyScale();this.draw();
  if(!this.restored){this.viewport.scrollLeft=this.preference.left;this.viewport.scrollTop=this.preference.top;this.restored=true;}
 }
 applyScale(){this.world.style.transform=`scale(${this.scale})`;this.sizer.style.width=Math.ceil(this.baseWidth*this.scale)+'px';this.sizer.style.height=Math.ceil(this.baseHeight*this.scale)+'px';this.host.querySelector('output').value=Math.round(this.scale*100)+'%';this.host.querySelector('output').textContent=Math.round(this.scale*100)+'%';this.host.querySelector('[data-canvas-fit]').setAttribute('aria-pressed',String(this.fitMode));this.save();}
 zoom(scale){const old=this.scale,cx=(this.viewport.scrollLeft+this.viewport.clientWidth/2)/old,cy=(this.viewport.scrollTop+this.viewport.clientHeight/2)/old;this.fitMode=false;const lanes=this.host.dataset.canvasKind==='swimlanes';this.scale=Math.max(lanes ? .9 : .15,Math.min(lanes?1.8:2,scale));if(lanes)this.layout();else this.applyScale();this.viewport.scrollLeft=cx*this.scale-this.viewport.clientWidth/2;this.viewport.scrollTop=cy*this.scale-this.viewport.clientHeight/2;this.save();}
 draw(){if(this.host.dataset.canvasKind==='swimlanes'){drawSwimlaneCanvas(this);return;}let edges=[];try{edges=JSON.parse(this.host.dataset.canvasEdges||'[]');}catch{}const root=this.world.getBoundingClientRect(),positions=new Map([...this.grid.querySelectorAll('[data-canvas-node]')].map(el=>{const r=el.getBoundingClientRect();return[el.dataset.canvasNode,{x:(r.left-root.left)/this.scale,y:(r.top-root.top)/this.scale,w:r.width/this.scale,h:r.height/this.scale}];}));const marker='arrow-'+this.id.replace(/[^a-z0-9_-]/gi,'');this.svg.setAttribute('viewBox',`0 0 ${this.baseWidth} ${this.baseHeight}`);this.svg.setAttribute('width',this.baseWidth);this.svg.setAttribute('height',this.baseHeight);
  const paths=edges.filter(e=>positions.has(e.from)&&positions.has(e.to)&&e.from!==e.to).map((e,i)=>{const a=positions.get(e.from),b=positions.get(e.to);let sx,sy,tx,ty,d;
   if(Math.abs(a.y-b.y)<12&&b.x>a.x){sx=a.x+a.w;sy=a.y+a.h/2;tx=b.x;ty=b.y+b.h/2;d=`M${sx},${sy} C${sx+26},${sy} ${tx-26},${ty} ${tx},${ty}`;}
   else if(b.y>a.y+12){sx=a.x+a.w/2;sy=a.y+a.h;tx=b.x+b.w/2;ty=b.y;const mid=sy+(ty-sy)/2;d=`M${sx},${sy} C${sx},${mid} ${tx},${mid} ${tx},${ty}`;}
   else{sx=a.x+a.w/2;sy=a.y;tx=b.x+b.w/2;ty=b.y;const arc=Math.max(5,Math.min(sy,ty)-18-(i%3)*5);d=`M${sx},${sy} C${sx},${arc} ${tx},${arc} ${tx},${ty}`;}
   const type=e.enabled===false?'inactive':['condition','branch','conditional'].includes(e.type)?'condition':'active';return `<path class="canvas-edge ${type}" d="${d}" marker-end="url(#${marker}-${type})"><title>${esc(e.label||e.condition||e.from+' → '+e.to)}${e.enabled===false?'（当前未启用自动交接）':''}</title></path>`;}).join('');
  this.svg.innerHTML=`<defs>${['active','condition','inactive'].map(type=>`<marker id="${marker}-${type}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="arrow-${type}" d="M0,0 L8,4 L0,8 Z"/></marker>`).join('')}</defs>${paths}`;
 }
 dispose(){cancelAnimationFrame(this.frame);if(this.host.isConnected)this.save();this.observer.disconnect();}
}
function mountFlowCanvases(){
 for(const [id,controller]of flowCanvasInstances){if(!controller.host.isConnected){controller.dispose();flowCanvasInstances.delete(id);}}
 document.querySelectorAll('[data-flow-canvas]').forEach(host=>{const id=host.dataset.flowCanvas;if(flowCanvasInstances.get(id)?.host===host){flowCanvasInstances.get(id).schedule();return;}flowCanvasInstances.get(id)?.dispose();flowCanvasInstances.set(id,new FlowCanvasController(host));});
}
function scheduleCanvasDraw(){for(const c of flowCanvasInstances.values()){cancelAnimationFrame(c.frame);c.frame=requestAnimationFrame(()=>c.draw());}}
window.addEventListener('resize',()=>{for(const c of flowCanvasInstances.values())c.schedule();});
window.visualViewport?.addEventListener('resize',()=>{for(const c of flowCanvasInstances.values())c.schedule();});
function beginCanvasDrag(element,e){const host=element?.closest('[data-flow-canvas]'),controller=host&&flowCanvasInstances.get(host.dataset.flowCanvas);if(!controller)return null;return {element,controller,x:e.clientX,y:e.clientY};}
function moveCanvasDrag(d,e){if(!d)return;d.element.style.transform=`translate(${(e.clientX-d.x)/d.controller.scale}px,${(e.clientY-d.y)/d.controller.scale}px)`;d.element.style.pointerEvents='none';d.element.classList.add('canvas-dragging');scheduleCanvasDraw();}
function finishCanvasDrag(d){if(!d)return;d.element.style.transform='';d.element.style.pointerEvents='';d.element.classList.remove('canvas-dragging');scheduleCanvasDraw();}

function snapshotFlowCanvases(element){for(const c of flowCanvasInstances.values())if(c.host.isConnected&&element.contains(c.host))c.save();}
