import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolvedCatalog} from '../flow-model.mjs';
import {modules} from '../flow-catalog.mjs';

const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
const canvasSource=read('flow-canvas.js'),swimlaneSource=read('swimlane-view.js'),boardSource=read('board-view.js');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const access={enabled:true,canManage:true,department:true,modules:Object.values(modules).filter(Boolean),user:{number:'ISOLATED-M',center:'隔离测试'}};
function fixture(overrides={}){
 const state={catalog:resolvedCatalog(access,null),overview:{access:{canManage:true},tasks:[]},flow:'all',stage:null,search:'',...overrides};
 const context=vm.createContext({state,esc,hasSearch:value=>!state.search||String(value).includes(state.search),empty:(a,b)=>a+b,moduleLink:()=>'',document:{addEventListener(){}},Map,Set});
 vm.runInContext(canvasSource.slice(0,canvasSource.indexOf('function flowCanvasMarkup'))+'\n'+swimlaneSource+'\n'+boardSource,context);
 return {state,context};
}
function edgesIn(html){const attr=html.match(/data-canvas-edges="([^"]+)"/)[1];return JSON.parse(attr.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));}

test('暂停流程即使保留ready节点，也不计入泳道在办或环节待办',()=>{
 const {state,context}=fixture({flow:'01'}),stage=state.catalog.stages.find(s=>s.flow==='01');
 state.overview.tasks=[{workflow:'01',state:'paused',nodes:[{id:stage.steps[0].id,state:'ready'}]}];
 const html=context.board();
 assert.match(html,/0 项在办/);
 assert.doesNotMatch(html,/class="swimlane-ready"/);
 assert.equal(state.overview.tasks[0].state,'paused');
 assert.equal(state.overview.tasks[0].nodes[0].state,'ready');
});

test('泳道计数仅包含本流程运行中任务，暂停和已结束任务不影响待办',()=>{
 const {state,context}=fixture({flow:'01'}),stage=state.catalog.stages.find(s=>s.flow==='01');
 state.overview.tasks=['running','paused','completed','cancelled'].map(status=>({workflow:'01',state:status,nodes:[{id:stage.steps[0].id,state:'ready'}]}));
 state.overview.tasks.push({workflow:'01',state:'running',nodes:[{id:stage.steps[0].id,state:'completed'}]},{workflow:'02',state:'running',nodes:[{id:stage.steps[0].id,state:'ready'}]});
 const html=context.board();
 assert.match(html,/2 项在办/);
 assert.match(html,/class="swimlane-ready">1 项待办/);
 assert.equal((html.match(/class="swimlane-ready"/g)||[]).length,1);
});

test('全景使用真实已解析目录：每个流程一条泳道，全部环节一次展示',()=>{
 const {state,context}=fixture(),html=context.board();
 assert.equal((html.match(/data-swimlane=/g)||[]).length,state.catalog.flows.length);
 assert.equal((html.match(/data-stage="/g)||[]).length,state.catalog.stages.length);
 for(const stage of state.catalog.stages){assert.ok(html.includes(`data-stage="${stage.id}"`));assert.ok(html.includes(esc(stage.title)));}
 assert.doesNotMatch(html,/class="graph-card|data-canvas-kind="board"/);
 assert.match(html,/data-canvas-kind="swimlanes"/);assert.match(html,/data-stage="W02\.S1"[^>]*aria-controls="drawer"/);
 // The default first-creation catalog is AI-only, so the panorama must not add
 // the optional live-action branch merely to make a fuller looking lane.
 assert.ok(!state.catalog.stages.some(s=>s.id==='W01.S4'));assert.doesNotMatch(html,/data-stage="W01\.S4"/);
});
test('泳道顺序随已发布蓝图，二创反补一创保留真实交接和未启用参考线',()=>{
 const active={id:'department',version:8,name:'隔离发布顺序',moduleOrder:['00','02','01','03','04','05'],modules:{},defaultRoute:true,branches:[{after:'02',next:'01',when:'source_shortage',enabled:true}]};
 const {context}=fixture({catalog:resolvedCatalog(access,active),swimlaneReferences:true}),html=context.board(),edges=edgesIn(html);
 assert.ok(html.indexOf('data-swimlane="02"')<html.indexOf('data-swimlane="01"'));
 assert.ok(edges.some(e=>e.scope==='module'&&e.from==='02'&&e.to==='01'&&e.type==='sequence'&&e.enabled));
 assert.ok(edges.some(e=>e.scope==='module'&&e.type==='condition'&&e.enabled));
 assert.ok(edges.some(e=>e.type==='reference'&&!e.enabled));
 assert.match(html,/已发布 v8/);assert.match(html,/自动批次缺少合格来源素材/);assert.match(html,/业务关联 · 仅供参考/);
});
test('默认仍画真实配置顺序与条件线，额外参考线按需展开且始终可查',()=>{
 const {state,context}=fixture(),html=context.board();
 assert.ok(edgesIn(html).some(e=>e.scope==='module'&&e.type==='sequence'&&!e.enabled));
 assert.ok(!edgesIn(html).some(e=>e.type==='reference'));assert.match(html,/显示参考连线/);assert.match(html,/业务关联 · 仅供参考/);
 const before=state.catalog.moduleEdges.length;state.swimlaneReferences=true;const expanded=context.board();
 assert.ok(edgesIn(expanded).some(e=>e.type==='reference'&&!e.enabled));assert.equal(state.catalog.moduleEdges.length,before);assert.match(expanded,/收起参考连线/);
});
test('列内连线严格来自执行节点依赖，保留并行汇合且不连独立人事事项',()=>{
 const active={moduleOrder:['00','01','02','03','04','05'],modules:{'01':{options:{production:'both'}}},branches:[]};
 const {state,context}=fixture({catalog:resolvedCatalog(access,active)}),edges=edgesIn(context.board()).filter(e=>e.scope==='stage');
 for(const edge of edges){const flow=state.catalog.flows.find(f=>f.id===edge.lane),nodeMap=new Map(flow.resolvedNodes.map(n=>[n.id,n.displayStageId]));assert.ok(flow.resolvedEdges.some(e=>nodeMap.get(e.from)===edge.from&&nodeMap.get(e.to)===edge.to));}
 assert.ok(edges.some(e=>e.from==='W01.S2'&&e.to==='W01.S3'));
 assert.ok(edges.some(e=>e.from==='W01.S2'&&e.to==='W01.S4'));
 assert.ok(edges.some(e=>e.from==='W01.S3'&&e.to==='W01.S5'));
 assert.ok(edges.some(e=>e.from==='W01.S4'&&e.to==='W01.S5'));
 assert.ok(!edges.some(e=>e.from==='W01.S3'&&e.to==='W01.S4'));
 assert.ok(!edges.some(e=>e.lane==='06'));
});
test('重新编排产生的重复环节片段不合并，显式空依赖不补造顺序箭头',()=>{
 const nodes=[{id:'N1',stageId:'S1',displayStageId:'S1',dependencies:[]},{id:'N2',stageId:'S2',displayStageId:'S2',dependencies:['N1']},{id:'N3',stageId:'S1',displayStageId:'S1__part2',dependencies:['N2']}];
 const flow={id:'02',name:'二创',resolvedNodes:nodes,resolvedEdges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}]},stages=nodes.map(n=>({id:n.displayStageId,flow:'02',title:n.displayStageId,steps:[n]}));
 const {context}=fixture({catalog:{flows:[flow],stages,moduleEdges:[]}}),html=context.board();
 assert.ok(html.includes('data-stage="S1__part2"'));assert.equal((html.match(/data-stage="/g)||[]).length,3);
 assert.deepEqual(edgesIn(html).map(e=>[e.from,e.to]),[['S1','S2'],['S2','S1__part2']]);
 flow.resolvedEdges=[];assert.equal(edgesIn(context.board()).length,0);
});
test('搜索保留命中泳道的完整环节，不把过滤后的邻居伪造成上下游',()=>{
 const {context,state}=fixture({search:'母版与来源准备'}),html=context.board();
 assert.equal((html.match(/data-swimlane=/g)||[]).length,1);
 assert.equal((html.match(/data-stage="/g)||[]).length,state.catalog.stages.filter(s=>s.flow==='02').length);
 assert.ok(edgesIn(html).every(e=>e.scope==='stage'&&e.lane==='02'));
});
test('员工不能直接渲染全景；节点标题、输出与关系说明均转义',()=>{
 const {context,state}=fixture();state.overview.access.canManage=false;assert.equal(context.board(),'');
 state.overview.access.canManage=true;state.catalog.stages[0].title='<img src=x onerror=alert(1)>';state.catalog.stages[0].output='<script>unsafe()</script>';state.catalog.moduleEdges[0].label='<svg onload=alert(1)>';
 const html=context.board();assert.doesNotMatch(html,/<img|<script>|<svg onload/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;svg/);
});
test('1920、1440、抽屉缩窄和手机宽度均保持六列与可读字号，不折行或过度缩小',()=>{
 const {context}=fixture();
 for(const width of [1920,1440,1100,800,390,280]){
  const layout=context.swimlaneGeometry(width,6,{fit:true,scale:.1});
  assert.equal(layout.columns,6);assert.equal(layout.scale,1);assert.ok(layout.laneWidth>=260);assert.ok(layout.laneWidth<=340);
  if(width<1700)assert.ok(layout.width>width,'窄窗口应横向滚动而非缩成不可读内容');
 }
 for(const scale of [.01,.9,1,1.8,9]){const layout=context.swimlaneGeometry(900,6,{fit:false,scale});assert.equal(layout.columns,6);assert.ok(layout.scale>=.9&&layout.scale<=1.8);assert.ok(14*layout.scale>=12.6);}
 assert.equal(context.swimlaneGeometry(900,1,{fit:true}).laneWidth,340);
});
test('跨泳道连线全部位于顶部关系带，参考与条件线不穿过正文',()=>{
 const {context}=fixture();const flows=['00','02','01'].map(id=>({id}));
 const edges=context.swimlaneModuleRoutes(flows,[{from:'00',to:'02',type:'sequence',enabled:false},{from:'02',to:'01',type:'sequence',enabled:true},{from:'01',to:'00',type:'reference',enabled:false},{from:'02',to:'01',type:'condition',enabled:true}]);
 const height=context.swimlaneRailHeight(edges),positions=new Map(flows.map((flow,i)=>[flow.id,{x:18+i*288,y:height+18,w:260,h:42}]));
 const paths=context.swimlaneEdgePaths(edges,positions,new Map());assert.equal(paths.length,4);
 assert.equal(paths[0].type,'inactive');assert.equal(paths[1].type,'active');assert.equal(paths[2].type,'inactive');assert.equal(paths[3].type,'condition');
 for(const path of paths){assert.doesNotMatch(path.d,/NaN|undefined/);const numbers=path.d.match(/-?\d+(?:\.\d+)?/g).map(Number);for(let i=1;i<numbers.length;i+=2)assert.ok(numbers[i]<=height+18+21,'连线不得落到标题与卡片正文区');}
});
test('跳过并行环节和逆向依赖的箭头走侧边，不穿过中间环节卡片',()=>{
 const {context}=fixture(),positions=new Map(['A','B','C'].map((id,i)=>[id,{x:42,y:200+i*170,w:212,h:140,order:i}])),lanes=new Map([['02',{x:18,w:260}]]);
 const paths=context.swimlaneEdgePaths([{from:'A',to:'C',scope:'stage',lane:'02'},{from:'C',to:'A',scope:'stage',lane:'02'},{from:'B',to:'C',scope:'stage',lane:'02'}],positions,lanes);
 assert.match(paths[0].d,/M254,270 L271,270 L271,610 L257,610/);
 assert.match(paths[1].d,/M254,610 L267,610 L267,270 L257,270/);
 assert.match(paths[2].d,/M148,510 L148,537/);
});
test('缩放后 SVG 坐标还原到布局坐标，箭头仍接在实际卡片边缘',()=>{
 const {context}=fixture();const base={x:120,y:65},scale=1.5;
 const el=(dataset,x,y,w,h)=>({dataset,getBoundingClientRect:()=>({left:base.x+x*scale,top:base.y+y*scale,width:w*scale,height:h*scale})});
 const a=el({canvasNode:'A',stageOrder:'0'},40,200,210,140),b=el({canvasNode:'B',stageOrder:'1'},40,370,210,140),lane=el({swimlane:'02'},18,0,260,600),svg={setAttribute(){},innerHTML:''};
 context.drawSwimlaneCanvas({id:'geometry',scale,baseWidth:296,baseHeight:600,host:{dataset:{canvasEdges:JSON.stringify([{from:'A',to:'B',scope:'stage',lane:'02'}])}},world:{getBoundingClientRect:()=>({left:base.x,top:base.y})},grid:{querySelectorAll:selector=>selector==='[data-swimlane]'?[lane]:[a,b]},svg});
 assert.match(svg.innerHTML,/d="M145,340 L145,367"/);assert.match(svg.innerHTML,/data-edge-scope="stage"/);
});
test('打开抽屉后销毁已移出文档的旧画布，不用归零的滚动位置覆盖已保存视角',()=>{
 const context=vm.createContext({window:{addEventListener(){},visualViewport:null},cancelAnimationFrame(){}});
 const Controller=vm.runInContext(canvasSource+'\nFlowCanvasController;',context);
 let saved=0,disconnected=0;
 Controller.prototype.dispose.call({frame:1,host:{isConnected:false},save(){saved++;},observer:{disconnect(){disconnected++;}}});
 assert.equal(saved,0);assert.equal(disconnected,1);
 Controller.prototype.dispose.call({frame:1,host:{isConnected:true},save(){saved++;},observer:{disconnect(){disconnected++;}}});
 assert.equal(saved,1);assert.equal(disconnected,2);
});
