import {catalog, graphFor, flowAllowed} from './flow-catalog.mjs';
import {requireFact} from './workflow-store.mjs';

export const simpleVersion = 'approval-handoff-v1';
export function executionGraph(body) {
  const mode = body.mode || 'standard';
  requireFact(['simple', 'standard'].includes(mode), '请选择简洁办理或标准流程');
  if (mode === 'standard') return graphFor(body.workflow, body.options || {});
  requireFact(catalog.flows.some(f => f.id === body.workflow), '请选择有效工作流');
  requireFact(body.workflow !== '06', '部门人事事项须使用原有独立授权流程');
  const prefix = 'W' + body.workflow + '.SIMPLE';
  const steps = [
    {suffix:'WORK', title:'办理与交付', ownerRule:'owner', output:'与交付标准对应的文件、截图、链接或云管家素材'},
    {suffix:'REVIEW', title:'审核确认', ownerRule:'reviewer', output:'审核结论；不符合要求时退回修改', canReuseUpstreamEvidence:true},
    ...(body.receiver ? [{suffix:'RECEIVE', title:'下游接收', ownerRule:'receiver', output:'确认收到交付物并承接后续工作', canReuseUpstreamEvidence:true}] : []),
  ];
  return steps.map((step, i) => ({id:prefix+'.'+step.suffix, stageId:prefix, title:step.title,
    type:'人工', ownerRule:step.ownerRule, managerRequired:false, evidenceKind:'human_attested',
    canReuseUpstreamEvidence:!!step.canReuseUpstreamEvidence, outputs:step.output,
    entry:i?'上一步已完成':'任务已发起', done:step.output, slaHours:24,
    dependencies:i?[prefix+'.'+steps[i-1].suffix]:[], templateVersion:simpleVersion}));
}

export function graphDetails(nodes, workflow) {
  const stages=[],visits=new Map();
  nodes=nodes.map(node=>{
    let group=stages.at(-1);
    if(!group||group.canonicalStageId!==node.stageId){
      const partIndex=(visits.get(node.stageId)||0)+1;visits.set(node.stageId,partIndex);
      group={id:node.stageId+(partIndex>1?'__part'+partIndex:''),flow:workflow,canonicalStageId:node.stageId,partIndex,
        title:(catalog.stages.find(s=>s.id===node.stageId)?.title||'审批与交接')+(partIndex>1?'（第'+partIndex+'段）':''),nodes:[]};
      stages.push(group);
    }
    group.nodes.push(node.id);return {...node,displayStageId:group.id};
  });
  return {
    nodes,
    stages,
    edges:nodes.flatMap(n=>n.dependencies.map(from=>({from,to:n.id,type:'dependency',enabled:true}))),
  };
}

// Both the panorama and actual execution resolve the same published graph.
// Static business relationships remain labelled as reference links, never automatic routes.
export function resolvedCatalog(access, active) {
  const order = active?.moduleOrder || catalog.flows.filter(f=>f.id!=='06').map(f=>f.id);
  const flows = catalog.flows.filter(f=>flowAllowed(access,f.id))
    .sort((a,b)=>(order.includes(a.id)?order.indexOf(a.id):99)-(order.includes(b.id)?order.indexOf(b.id):99))
    .map(flow => {
      if(flow.id==='06') return {...flow,resolvedNodes:[],resolvedEdges:[]};
      const config=active?.modules?.[flow.id];
      const options={...(flow.id==='01'?{production:'ai'}:flow.id==='04'?{anchorMode:'existing'}:{}),...config?.options,nodeOrder:config?.nodeOrder||[]};
      const graph=graphDetails(executionGraph({workflow:flow.id,mode:'standard',options}),flow.id);
      return {...flow,target:'L2 流程驱动',resolvedNodes:graph.nodes,resolvedEdges:graph.edges,resolvedStages:graph.stages};
    });
  const visible = new Set(flows.map(f=>f.id));
  const moduleEdges = [];
  for(let i=1;i<order.length;i++) if(visible.has(order[i-1])&&visible.has(order[i]))
    moduleEdges.push({from:order[i-1],to:order[i],type:'sequence',enabled:active?.defaultRoute===true,label:active?.defaultRoute?'完成后自动交接':'业务顺序 · 自动交接未开启'});
  for(const rule of active?.branches||[]) if(visible.has(rule.after)&&visible.has(rule.next))
    moduleEdges.push({from:rule.after,to:rule.next,type:'condition',enabled:rule.enabled===true,label:rule.when,condition:rule.when});
  for(const [from,to] of catalog.edges) if(visible.has(from)&&visible.has(to)&&!moduleEdges.some(e=>e.from===from&&e.to===to))
    moduleEdges.push({from,to,type:'reference',enabled:false,label:'业务关联'});
  const stages = flows.flatMap(flow=>flow.id==='06'?catalog.stages.filter(s=>s.flow==='06').map(s=>({...s})):flow.resolvedStages.map(group=>{
    const stage=catalog.stages.find(s=>s.id===group.canonicalStageId),nodes=flow.resolvedNodes.filter(n=>n.displayStageId===group.id);
    return {...stage,...group,steps:nodes,executionMode:nodes.length>1&&nodes.slice(1).every(n=>!n.dependencies.some(d=>nodes.some(x=>x.id===d)))?'parallel':'sequential'};
  }));
  const stageEdges = flows.flatMap(f=>f.resolvedEdges.flatMap(e=>{
    const from=f.resolvedNodes.find(n=>n.id===e.from)?.displayStageId,to=f.resolvedNodes.find(n=>n.id===e.to)?.displayStageId;
    return from&&to&&from!==to?[{from,to}]:[];
  })).filter((e,i,all)=>all.findIndex(x=>x.from===e.from&&x.to===e.to)===i);
  return {...catalog,flows,stages,stageEdges,moduleEdges,blueprint:active?{
    id:active.id,version:active.version,name:active.name,moduleOrder:order,defaultRoute:active.defaultRoute}:null};
}
