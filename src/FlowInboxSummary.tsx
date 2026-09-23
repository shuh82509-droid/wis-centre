import {useEffect, useState} from 'react';
import type {HubSession} from './types';
import './flow-inbox.css';

type Node = {id:string; title?:string; state:string; owner:{number:string;name:string}; dueAt:string|null;dependencies?:string[]};
type Relation={taskId?:string;title:string;owner:{number:string;name:string};canOpen:boolean};
type Overview = {access:{number:string;canManage:boolean};executionRoutes?:Array<{flow:string;name:string;module:string}>;blueprint?:{name:string;version:number;defaultRoute:boolean}|null; tasks:Array<{id:string;title:string;workflow:string;state:string;nodes:Node[];relations?:{upstream:Relation[];downstream:Relation[]}}>;metrics:{active:number;completed:number;overdue:number;notificationAttention:number}};
const base=new URL('workflow-panorama/',window.location.href).pathname;
export function FlowInboxSummary({session,onRouteOrder}:{session:HubSession;onRouteOrder?:(modules:string[])=>void}) {
  const scope=JSON.stringify([session.user.number||session.user.userId||session.user.id,session.workspace.role,session.workspace.center,session.workspace.is_brand_department,session.workspace.dashboard_scope,session.access.policy_state,session.access.allowed_modules]);
  const [snapshot,setSnapshot]=useState<{scope:string;data:Overview}|null>(null),[error,setError]=useState('');
  const data=snapshot?.scope===scope?snapshot.data:null;
  const setData=(value:Overview|null)=>setSnapshot(value?{scope,data:value}:null);
  const enabled=(session.workspace.is_brand_department || session.permissions.manage_permissions) && session.access.allowed_modules.includes('workflow-engine') && !session.access.policy_state?.startsWith('development-preview');
  useEffect(()=>{
    setData(null);setError('');onRouteOrder?.([]);if(!enabled)return;
    let alive=true,busy=false;const controller=new AbortController();
    async function refresh(){if(busy||document.hidden)return;busy=true;try{
      const response=await fetch('api/flows/overview',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),cache:'no-store'});
      if(!response.ok){if(alive&&[401,403].includes(response.status)){setData(null);onRouteOrder?.([]);}throw Error(response.status===403?'请退出权限预览后查看真实待办。':'工作流暂未连接，稍后可从原任务继续。');}
      const result=await response.json() as Overview;if(alive){setData(result);setError('');onRouteOrder?.(result.access.canManage?(result.executionRoutes||[]).map(route=>route.module):[]);}
    }catch(e){if(alive)setError(e instanceof Error?e.message:'工作流暂未连接。');}finally{busy=false;}}
    void refresh();const timer=window.setInterval(()=>void refresh(),30000);
    return()=>{alive=false;controller.abort();window.clearInterval(timer);};
  },[enabled,scope,onRouteOrder]);
  if(!enabled)return null;
  if(!['director','manager'].includes(session.workspace.role)||data?.access.canManage===false)return <PersonalInbox data={data} error={error}/>;
  const items=(data?.tasks||[]).filter(t=>t.state==='running').flatMap(t=>t.nodes.filter(n=>n.state==='ready'&&n.owner.number===data?.access.number).map(n=>({task:t,node:n}))).sort((a,b)=>Date.parse(a.node.dueAt||'')-Date.parse(b.node.dueAt||''));
  return <section className="flow-inbox" aria-label="工作流待办">
    <header><div><h2>工作流待办</h2><p>查看当前轮到你的工作，提交交付后自动通知下一主责。</p></div><a className="flow-inbox-open" href={base}>进入流程引擎 →</a></header>
    {error&&<p role="status" className="flow-inbox-error">{error}{data?' 已保留上次成功读取的记录。':''}</p>}
    {data?<>{data.blueprint&&<div className="flow-inbox-route"><p>{data.blueprint.name} · v{data.blueprint.version} · {data.blueprint.defaultRoute?'按此顺序自动交接':'已发布模块顺序'}</p><nav aria-label="当前流程顺序">{data.executionRoutes?.map((route,i)=><a key={route.flow} href={'api/launch/'+encodeURIComponent(route.module)}><small>{i+1}</small> {route.name} {i<(data.executionRoutes?.length||0)-1?'→':''}</a>)}</nav></div>}<div className="flow-inbox-counts"><span><b>{items.length}</b> 我待办</span><span><b>{data.metrics.active}</b> 范围内进行中</span><span><b>{data.metrics.overdue}</b> 超时节点</span><span><b>{data.metrics.notificationAttention}</b> 通知待处理</span></div>
      {items.length?<ul>{items.slice(0,4).map(({task,node})=><li key={task.id+node.id}><a href={`${base}?task=${encodeURIComponent(task.id)}`}><span><b>{task.title}</b><small>{node.title?.trim()||'节点名称待核对'} · {node.owner.name}</small></span><span className={node.dueAt&&Date.parse(node.dueAt)<Date.now()?'flow-inbox-late':''}>{node.dueAt?new Date(node.dueAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'待核对时限'} →</span></a></li>)}</ul>:<p className="flow-inbox-empty">目前没有轮到你办理的节点。新工作到达时，飞书会同步提醒。</p>}
    </>:!error&&<p role="status">正在读取真实工作流…</p>}
  </section>;
}

function PersonalInbox({data,error}:{data:Overview|null;error:string}){
 const [filter,setFilter]=useState('active'),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 const number=data?.access.number||'',matches=(data?.tasks||[]).filter(t=>(filter==='ended'?['completed','cancelled'].includes(t.state):filter==='todo'?t.state==='running'&&t.nodes.some(n=>n.state==='ready'&&n.owner.number===number):!['completed','cancelled'].includes(t.state))&&(!search||(t.title+' '+t.nodes.map(n=>n.owner.name).join(' ')).includes(search)));
 const pages=Math.max(1,Math.ceil(matches.length/6)),currentPage=Math.min(page,pages),names=(nodes:Node[],empty:string)=>nodes.length?nodes.map(n=>(n.title?.trim()||'任务环节')+' · '+n.owner.name).join('、'):empty;
 return <section className="flow-inbox" aria-label="我的任务"><header><div><h2>我的任务</h2><p>查看自己的工作、上游交付与下一位接收人。</p></div><a className="flow-inbox-open" href={base+'?view=tasks'}>查看全部任务 →</a></header>{error&&<p role="status" className="flow-inbox-error">{error}</p>}{!data&&!error?<p role="status">正在读取我的任务…</p>:data&&<><div className="flow-personal-toolbar"><nav aria-label="我的任务状态">{[['active','进行中'],['todo','待我办理'],['ended','已结束']].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>{setFilter(key);setPage(1);}}>{label}</button>)}</nav><input type="search" aria-label="搜索我的任务或负责人" placeholder="搜索我的任务或负责人" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></div>{matches.slice((currentPage-1)*6,currentPage*6).map(task=>{const own=task.nodes.filter(n=>n.owner.number===number),ready=own.filter(n=>n.state==='ready'),pending=own.filter(n=>n.state==='pending'),focus=ready.length?ready:pending.length?pending:own.slice(-1),ids=new Set(focus.map(n=>n.id)),before=new Set(focus.flatMap(n=>n.dependencies||[])),upstream=task.nodes.filter(n=>before.has(n.id)&&!ids.has(n.id)),downstream=task.nodes.filter(n=>(n.dependencies||[]).some(id=>ids.has(id))&&!ids.has(n.id));return <article className="flow-personal-card" key={task.id}><header><div><h3>{task.title}</h3><p>{task.state==='completed'?'已完成':task.state==='cancelled'?'已终止':task.state==='paused'?'已暂停':ready.length?'待我办理':'等待上下游'}</p></div><a href={`${base}?task=${encodeURIComponent(task.id)}`}>{task.state==='running'&&ready.length?'办理任务':'查看任务'} →</a></header><div className="flow-personal-journey"><div><small>上游交给我</small>{names(upstream,'由任务发起人交办')}</div><span aria-hidden="true">→</span><div><small>我负责</small>{names(focus,'我参与的任务')}</div><span aria-hidden="true">→</span><div><small>我交给下游</small>{names(downstream,'本环节结束后完成任务')}</div></div>{(['upstream','downstream'] as const).map(direction=>(task.relations?.[direction]||[]).map((relation,i)=><p className="flow-personal-relation" key={direction+i}><b>{direction==='upstream'?'上游交接':'下游接收'}：</b>{relation.owner.name} · {relation.canOpen&&relation.taskId?<a href={`${base}?task=${encodeURIComponent(relation.taskId)}`}>{relation.title} →</a>:relation.title}</p>))}</article>;})}{!matches.length&&<p className="flow-inbox-empty">暂无符合条件的任务。新工作到达后会在这里显示。</p>}{pages>1&&<nav className="flow-personal-pages" aria-label="个人任务分页"><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage} / {pages}</span><button disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}</>}</section>;
}
