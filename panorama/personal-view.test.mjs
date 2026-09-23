import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('app.js',import.meta.url),'utf8');
const personal=readFileSync(new URL('personal-view.js',import.meta.url),'utf8');
const node=(id,who,state='pending',dependencies=[])=>({id,title:id,owner:{number:who,name:who},state,dependencies});
test('我的上下游来自真实依赖，重排数组不会伪造相邻关系',()=>{
 const fn=vm.runInNewContext(personal+'\ntaskPerspective;');
 const t={nodes:[node('无关','X'),node('接收','C','pending',['交付']),node('上游','A','completed'),node('交付','B','ready',['上游'])]};
 const p=fn(t,'B');assert.deepEqual(Array.from(p.upstream,n=>n.id),['上游']);assert.deepEqual(Array.from(p.downstream,n=>n.id),['接收']);assert.equal(p.ready[0].id,'交付');
});
test('并行主责保留分支与汇合，不把无关岗位拼入本人路径',()=>{
 const fn=vm.runInNewContext(personal+'\ntaskPerspective;');
 const p=fn({nodes:[node('启动','A','completed'),node('文案','B','ready',['启动']),node('剪辑','B','ready',['启动']),node('审核','C','pending',['文案','剪辑']),node('其他','D')]},'B');
 assert.deepEqual(Array.from(p.current,n=>n.id),['文案','剪辑']);assert.equal(p.upstream.length,1);assert.equal(p.downstream.length,1);
});
function refreshFixture(overview,{wasManager=false,failure=null}={}){
 const elements=new Map(),requests=[],state={loading:false,view:'studio',catalog:{secret:'old'},overview:wasManager?{access:{canManage:true}}:null,task:wasManager?{id:'old'}:null};
 function $(id){if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,open:id==='#modal',scrollTop:0,classList:{remove(){}},close(){this.open=false;}});return elements.get(id);}
 const ctx=vm.createContext({state,$,api:async path=>{requests.push(path);if(failure)throw failure;if(path==='overview')return overview;if(path==='sources')return {renders:[]};if(path==='catalog')return {flows:[],stages:[]};throw Error('Unexpected '+path);},render(){},error(){},empty:(a,b)=>a+b,closeModal:()=>$('#modal').close(),location:{search:''},URLSearchParams,Promise,BASE:'/hub/'});
 vm.runInContext('let taskRequest=0;\n'+source.split('\n').find(line=>line.startsWith('async function refresh(')),ctx);
 return {ctx,state,requests,$};
}
test('普通人启动只请求个人 overview，不取全景和生产源',async()=>{
 const f=refreshFixture({access:{canManage:false},taskCatalog:{flows:[{id:'02',name:'二创'}],stages:[]}});await f.ctx.refresh({initial:true});
 assert.deepEqual(f.requests,['overview']);assert.equal(f.state.view,'tasks');assert.equal(f.state.sources,null);assert.equal(f.state.catalog.secret,undefined);
});
test('主管降级后清除全局数据和已打开的管理任务',async()=>{
 const f=refreshFixture({access:{canManage:false},taskCatalog:{flows:[],stages:[]}},{wasManager:true});await f.ctx.refresh();
 assert.deepEqual(f.requests,['overview']);assert.equal(f.state.task,null);assert.equal(f.$('#drawer').hidden,true);assert.equal(f.$('#modal').open,false);
});
test('鉴权拒绝后不保留全局流程与管理入口',async()=>{
 const f=refreshFixture(null,{wasManager:true,failure:Object.assign(Error('权限已变更'),{status:403})});await f.ctx.refresh();
 assert.equal(f.state.catalog,null);assert.equal(f.state.overview,null);for(const id of ['#board-tab','#studio-tab','#activity-tab','#drawer'])assert.equal(f.$(id).hidden,true);
});
test('主管仍然通过权限确认后读取全景和源状态',async()=>{
 const f=refreshFixture({access:{canManage:true}});await f.ctx.refresh({initial:true});assert.deepEqual(f.requests,['overview','sources','catalog']);assert.equal(f.state.view,'board');
});
test('已是主管时点击刷新仍重新读取当前catalog，不沿用旧蓝图目录',async()=>{
 const f=refreshFixture({access:{canManage:true}},{wasManager:true});f.state.task=null;
 await f.ctx.refresh();assert.deepEqual(f.requests,['overview','sources','catalog']);assert.equal(f.state.catalog.secret,undefined);assert.deepEqual(Object.keys(f.state.catalog),['flows','stages']);
});
test('员工任务卡不渲染编排入口，仅显示可读关联并转义业务文字',()=>{
 const t={id:'task_1',title:'<script>x</script>',workflow:'02',state:'running',owner:{name:'B'},nodes:[node('交付','B','ready')]};
 const ctx=vm.createContext({state:{overview:{access:{number:'B'},tasks:[t]},personalFilter:'active'},esc:v=>String(v??'').replaceAll('<','&lt;'),hasSearch:()=>true,pill:(a)=>a,status:v=>v,labels:{ready:'待办理'},flowName:()=> '二创',fmt:String,empty:()=>'',Date});
 const html=vm.runInContext(personal+'\npersonalTasks();',ctx);assert.match(html,/我的任务/);assert.match(html,/办理任务/);assert.match(html,/上游交给我/);assert.doesNotMatch(html,/<script>|流程全景|流程编排|发起工作流/);
});
test('普通主责办理成片节点只取当前任务源，主管保留原管理源读取',async()=>{
 const functionSource=source.slice(source.indexOf('async function openAction('),source.indexOf('function showProduct('));
 for(const canManage of [false,true]){
  const requests=[],modals=[],n={id:'W02.S4.E1',evidenceKind:'remix_output',title:'交付成片',dependencies:[]},task={id:'task_own',runtime:{nodes:[n],product:'隐形水润面膜'}};
  const ctx=vm.createContext({state:{task,overview:{access:{canManage}}},api:async path=>{requests.push(path);return {renders:[]};},field:()=>'',options:()=>'',esc:String,showModal:(...args)=>modals.push(args),setupSubmit(){},toast:m=>{throw Error(m);},encodeURIComponent});
  vm.runInContext(functionSource,ctx);await ctx.openAction('complete',n.id);
  assert.deepEqual(requests,[canManage?'sources':'runs/task_own/sources?nodeId=W02.S4.E1']);assert.equal(modals.length,1);
 }
});
