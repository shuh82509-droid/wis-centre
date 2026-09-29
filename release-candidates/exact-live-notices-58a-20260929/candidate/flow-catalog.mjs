import {flows,stages,stageEdges,edges} from './flow-definitions.mjs';
import {requireFact} from './workflow-store.mjs';
import {evidenceKinds} from './flow-evidence.mjs';
export const catalogVersion='20260908-l2.1';
export const modules={'00':'creative-hub','07':'creative-hub','01':'ai-first-creation','02':'material-workbench','03':'cloud-manager','04':'live-room-management','05':'data-dashboard','06':null};
export const managementNodes=new Set(['W00.S1.E2','W00.S2.E2','W00.S4.E1','W04.S2.E2','W04.S5.E1','W04.S5.E2','W05.S4.E2','W05.S5.E1','W06.S1.E1','W06.S1.E2','W06.S2.E4','W06.S3.E2','W06.S3.E4','W06.S5.E2','W06.S6.E1','W06.S6.E3','W06.S6.E4','W06.S7.E1']);
export const catalog={version:catalogVersion,standardUrl:'https://jqx28l0j4lx.feishu.cn/docx/H5IUdwVApohZMexqxz5cRHADnYf',
 flows:flows.map(({id,name,short,trigger,goal,finish,metric,relation,owner,sourceManaged})=>({id,name,short,trigger,goal,finish,metric,relation,owner,sourceManaged:!!sourceManaged,module:modules[id],target:'L2 流程驱动'})),
 stages:stages.map(s=>({id:s.id,flow:s.flow,title:s.title,owner:s.owner,output:s.output,executionMode:s.executionMode||'sequential',trigger:s.trigger||'',
 steps:s.steps.map(x=>({id:x.id,title:x.title,type:x.type,owner:x.owner,entry:x.entry,inputs:x.inputs,outputs:x.outputs,done:x.done,fields:x.fields,route:x.route,recovery:x.recovery,optional:!!x.optional,evidenceKind:evidenceKinds[x.id]||'human_attested'})),nodeRoutes:s.nodeRoutes||null})),stageEdges,edges};
export function flowAllowed(access,id){
 if(access.configurationOnly)return access.enabled&&access.canConfigure===true&&id!=='06'&&Object.hasOwn(modules,id);
 return access.enabled && (id==='06'||access.modules?.includes(modules[id]) || id==='00'&&access.modules?.includes('creative-radar'));
}
export function graphFor(flow,options={}){
 requireFact(catalog.flows.some(f=>f.id===flow),'请选择有效工作流');
 let selected=catalog.stages.filter(s=>s.flow===flow),omit=new Set();
 if(flow==='06'){
  requireFact(selected.some(s=>s.id===options.stage),'请选择一类独立部门管理事项');selected=selected.filter(s=>s.id===options.stage);
  if(options.stage==='W06.S3'){
   requireFact(['onboarding','probation','access'].includes(options.branch),'请选择入职、转正或已批准岗位权限分支');
   omit=new Set(options.branch==='probation'?['W06.S3.E1','W06.S3.E2','W06.S3.E3']:options.branch==='access'?['W06.S3.E1','W06.S3.E4']:['W06.S3.E4']);
  }
  if(options.stage==='W06.S5'){requireFact(['status','conversation'].includes(options.branch),'请选择状态登记或沟通事项');omit.add(options.branch==='status'?'W06.S5.E2':'W06.S5.E1');}
  if(options.stage==='W06.S6'){requireFact(['target','review'].includes(options.branch),'请选择目标确认或周期评议');omit=new Set(options.branch==='target'?['W06.S6.E2','W06.S6.E3','W06.S6.E4']:['W06.S6.E1',...(options.includeDispute?[]:['W06.S6.E4'])]);}
 }
 if(flow==='01'){
  requireFact(['ai','shoot','both'].includes(options.production),'请选择AI制作、实拍或两路并行');
  selected=selected.filter(s=>!(options.production==='ai'&&s.id==='W01.S4')&&!(options.production==='shoot'&&s.id==='W01.S3'));
 }
 if(flow==='04'&&options.anchorMode==='existing')selected=selected.filter(s=>s.id!=='W04.S1');
 requireFact(flow!=='04'||!options.anchorMode||['new','existing'].includes(options.anchorMode),'请选择新主播准入或已准入主播场次');
 const nodes=selected.flatMap(s=>s.steps.filter(n=>!omit.has(n.id)&&(!n.optional||options.includeCoach===true)).map(n=>({...n,stageId:s.id,managerRequired:managementNodes.has(n.id),dependencies:[],slaHours:n.type==='人工'?24:4})));
 const by=new Map(nodes.map(n=>[n.id,n]));
 for(const s of selected){const ns=s.steps.filter(n=>by.has(n.id));if(s.executionMode!=='parallel')for(let i=1;i<ns.length;i++)by.get(ns[i].id).dependencies.push(ns[i-1].id);}
 if(flow!=='06')for(const e of stageEdges){
  const a=selected.find(s=>s.id===e.from),b=selected.find(s=>s.id===e.to);if(!a||!b)continue;
  const outs=a.executionMode==='parallel'?a.steps.filter(n=>by.has(n.id)&&!n.optional):[a.steps.filter(n=>by.has(n.id)).at(-1)];
  const ins=b.executionMode==='parallel'?b.steps.filter(n=>by.has(n.id)):[b.steps.find(n=>by.has(n.id))];
  for(const target of ins)by.get(target.id).dependencies.push(...outs.filter(Boolean).map(n=>n.id));
 }
 if(Array.isArray(options.nodeOrder)&&options.nodeOrder.length){
  const order=options.nodeOrder;requireFact(order.length===nodes.length&&new Set(order).size===nodes.length&&order.every(id=>by.has(id)),'自定义节点顺序必须包含本次分支的全部必选节点，不能遗漏或重复');
  const required=[];for(const s of selected){const ns=s.steps.filter(n=>by.has(n.id));if(s.executionMode!=='parallel')for(let i=1;i<ns.length;i++)required.push([ns[i-1].id,ns[i].id]);}
  const requiredStages=flow==='02'?[['W02.S1','W02.S2'],['W02.S2','W02.S4'],['W02.S3','W02.S4'],['W02.S4','W02.S5']]:flow==='03'?[['W03.S1','W03.S2'],['W03.S2','W03.S4'],['W03.S3','W03.S4'],['W03.S4','W03.S5']]:['01','04','05'].includes(flow)?stageEdges.filter(e=>selected.some(s=>s.id===e.from)&&selected.some(s=>s.id===e.to)).map(e=>[e.from,e.to]):[];
  for(const [from,to]of requiredStages){const a=nodes.filter(n=>n.stageId===from),b=nodes.filter(n=>n.stageId===to);for(const source of a)for(const target of b)required.push([source.id,target.id]);}
  for(const [from,to]of required)requireFact(order.indexOf(from)<order.indexOf(to),by.get(to).title+' 需要先完成 '+by.get(from).title+'，请调整节点顺序');
  return order.map((id,i)=>({...by.get(id),dependencies:i?[order[i-1]]:[]}));
 }
 return nodes;
}
