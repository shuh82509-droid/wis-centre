import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {permissionHelpers} from './permission-test-helpers.mjs';
const app=readFileSync(new URL('app.js',import.meta.url),'utf8');
const logic=app.slice(app.indexOf('function canStartDownstreamNow('),app.indexOf('\nasync function openWatch('));
const existing=app.slice(app.indexOf('async function openExistingHandoff('),app.indexOf('\nfunction showModal('));
const entry=app.slice(app.indexOf('function currentEntryHtml('),app.indexOf('function nodeHtml('));
const task=(flow='00')=>({id:'task_parent',workflow:flow,title:'隔离任务',version:7,assignee:{number:'M'},runtime:{state:'running',manager:{number:'M'},nodes:[{id:'before',state:'completed',dependencies:[]},{id:flow==='00'?'W00.S4.E1':'W05.S5.E1',state:'ready',dependencies:['before']}],blueprint:{moduleOrder:['02','01','03'],version:2}}});
function fixture(t=task()){
 const calls={};const state={task:t,overview:{access:{canManage:true}},catalog:{edges:[['00','01','创意制作'],['05','01','新制作行动'],['02','03','审核']],flows:[{id:'00'},{id:'01'},{id:'02'},{id:'03'},{id:'05'}]}};
 const tasks=[{id:'task_existing',title:'既有制作 <版本>',workflow:'01',state:'paused',version:12,owner:{name:'本人'},relations:{upstream:[]}},{id:'task_other',title:'已有上游',workflow:'01',state:'running',version:3,owner:{name:'本人'},relations:{upstream:[{canOpen:false}]}}];
 const context=vm.createContext({state,console,document:{querySelector:()=>null},esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),flowName:x=>'流程'+x,personalRelationsHtml:()=>'<p>本人上下游</p>',api:async(path)=>{calls.path=path;return {tasks};},showModal:(...args)=>calls.modal=args,setupSubmit:(...args)=>calls.submit=args,toast:x=>calls.toast=x,renderTask:()=>{},refresh:async()=>{},options:rows=>rows.map(([id,title])=>'<option value="'+id+'">'+title.replaceAll('<','&lt;')+'</option>').join('')});vm.runInContext(logic+'\n'+existing+'\n'+entry,context);return {context,state,calls,tasks};
}
test('W00第7与W05第9都显示创建和关联；未达、暂停、非管理均不显示',()=>{for(const flow of ['00','05']){const f=fixture(task(flow));assert.match(f.context.handoffHtml(f.state.task),/关联已有任务/);f.state.task.runtime.nodes[0].state='pending';assert.doesNotMatch(f.context.handoffHtml(f.state.task),/data-handoff="existing"/);f.state.task.runtime.state='paused';assert.equal(f.context.canStartDownstreamNow(f.state.task),false);f.state.overview.access.canManage=false;assert.equal(f.context.handoffHtml(f.state.task),'<p>本人上下游</p>');}});
test('手动反向目标由任务固定蓝图提供，不以当前全景新版本替换',()=>{const f=fixture(task('02'));assert.ok(f.context.handoffTargets(f.state.task).some(([,to])=>to==='01'));f.state.task.runtime.blueprint.moduleOrder=['02','03'];assert.equal(f.context.handoffTargets(f.state.task).some(([,to])=>to==='01'),false);});
test('已关联任务显示保留原状态，只显示原编号，不重复提供创建',()=>{const f=fixture();f.state.task.runtime.handoff={state:'dispatched',dispatchMode:'now',linkedExisting:true,taskId:'task_existing'};const html=f.context.handoffHtml(f.state.task);assert.match(html,/保留原任务内容、分工与办理状态/);assert.doesNotMatch(html,/data-handoff=/);});
test('关联提交携带parent与target各自版本和原ID，不创建新正文/任务',async()=>{const f=fixture();await f.context.openExistingHandoff();assert.equal(f.calls.path,'overview');assert.equal(f.calls.modal[0],'关联已有任务');assert.match(f.calls.modal[2],/task_existing/);assert.doesNotMatch(f.calls.modal[2],/task_other/);const b=f.calls.submit[0]({get:()=> 'task_existing'});assert.deepEqual(JSON.parse(JSON.stringify(b)),{expectedVersion:7,dispatchMode:'now',workflow:'01',existingTaskId:'task_existing',existingTaskVersion:12});});
test('关联读取时切换任务，迟到响应不弹旧任务操作',async()=>{const f=fixture();let resolve;f.context.api=()=>new Promise(r=>resolve=r);const pending=f.context.openExistingHandoff();f.state.task={...f.state.task,id:'task_other'};resolve({tasks:f.tasks});await pending;assert.equal(f.calls.modal,undefined);assert.match(f.calls.toast,/当前任务已变化/);});
test('关联读取重复点击只请求一次，失败后仍可重试',async()=>{const f=fixture();let resolve,count=0;f.context.api=()=>{count++;return new Promise(r=>resolve=r);};const first=f.context.openExistingHandoff(),second=f.context.openExistingHandoff();resolve({tasks:f.tasks});await Promise.all([first,second]);assert.equal(count,1);f.context.api=async()=>{throw Error('fixture failure');};await assert.rejects(f.context.openExistingHandoff(),/fixture failure/);f.context.api=async()=>({tasks:f.tasks});await f.context.openExistingHandoff();assert.equal(f.calls.modal[0],'关联已有任务');});
test('旧入口原文和任务字段不改，只增加现行入口说明；新定义相同时不重复提示',()=>{const f=fixture(),n={id:'W00.S1.E1',entry:'中枢 → 工作任务 → 多来源需求'},before=JSON.stringify(n);assert.match(f.context.currentEntryHtml(n),/原记录保留/);assert.equal(JSON.stringify(n),before);assert.equal(f.context.currentEntryHtml({id:n.id,entry:'流程引擎 → 正在办理 → 原任务 → 登记原始线索 → 提交交付'}),'');});
test('发布提示准确区分顺序未开启、顺序开启、独立条件分支',async()=>{
 const text=readFileSync(new URL('studio.js',import.meta.url),'utf8'),save=text.slice(text.indexOf('async function studioSave('),text.indexOf("document.addEventListener('input'"));
 for(const [defaultRoute,branches,expected]of [[false,[],/自动顺序交接未开启/],[true,[],/按此顺序自动交接/],[false,[{enabled:true}],/条件分支继续生效/]]){
  let message;const studio={saving:false,draft:{version:1},requestKey:'fixture-key'};const c=vm.createContext({studio,state:{view:'studio',overview:{access:{canManage:true}}},api:async route=>route==='blueprints/publish'?{draft:{version:2},published:{defaultRoute,branches}}:route==='blueprints'?{revisions:[]}: {},toast:x=>message=x,render:()=>{},persistStudio:()=>{}});vm.runInContext(permissionHelpers+'\n'+save,c);await c.studioSave('publish');assert.match(message,expected);
 }
});

test('编排预览迟到时若授权已撤回，不重新显示旧配置结果',async()=>{
 const text=readFileSync(new URL('studio.js',import.meta.url),'utf8'),save=text.slice(text.indexOf('async function studioSave('),text.indexOf("document.addEventListener('input'"));
 let resolve,rendered=0;
 const studio={saving:false,draft:{version:1},preview:null},state={view:'studio',overview:{access:{number:'ISOLATED-E',canManage:false,canConfigure:true,configurationOnly:true}}};
 const c=vm.createContext({state,studio,api:()=>new Promise(r=>resolve=r),render:()=>rendered++,toast(){}});
 vm.runInContext(permissionHelpers+'\n'+save,c);const pending=c.studioSave('preview');
 state.overview.access={number:'ISOLATED-E',canManage:false,canConfigure:false};resolve({privatePreview:'old'});await pending;
 assert.equal(studio.preview,null);assert.equal(rendered,0);
});

function searchFixture(){
 const f=fixture(),input={value:'',addEventListener:(event,fn)=>input[event]=fn},submit={disabled:false},form={dataset:{},querySelector:()=>submit};
 const select={value:'',rows:[],addEventListener:(event,fn)=>select[event]=fn,set innerHTML(html){this.rows=[...html.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(m=>({value:m[1],selected:/\bselected\b/.test(m[2]),text:m[3]}));this.value=(this.rows.find(r=>r.selected)||this.rows[0])?.value||'';},get innerHTML(){return '';}};
 f.context.document={querySelector:q=>q==='#existing-task-search'?input:q==='[name="existingTaskId"]'?select:q==='#edit-form'?form:null};
 f.context.showModal=(...args)=>{f.calls.modal=args;select.innerHTML=args[2].match(/<select[^>]*>([^]*?)<\/select>/)[1];};
 f.context.setupSubmit=(...args)=>{f.calls.submit=args;form.onsubmit=async()=>{};};
 return {...f,input,select,submit,form};
}
test('关联初次无默认目标且禁确认，搜索只保留匹配项，不隐含保留旧选中任务',async()=>{
 const f=searchFixture();await f.context.openExistingHandoff();assert.equal(f.select.value,'');assert.equal(f.submit.disabled,true);
 f.select.value='task_existing';f.select.change();assert.equal(f.submit.disabled,false);
 f.input.value='不存在';f.input.input();assert.equal(f.select.value,'');assert.equal(f.select.rows.length,1);assert.match(f.select.rows[0].text,/没有匹配/);assert.equal(f.submit.disabled,true);
 f.input.value='既有';f.input.input();assert.equal(f.select.rows.length,2);assert.equal(f.select.value,'');assert.equal(f.submit.disabled,true);
 f.select.value='task_existing';f.select.change();assert.equal(f.submit.disabled,false);
});
test('搜索排除原选项时即使表单被伪改为原ID，提交仍拒绝；回到匹配范围后带原双版本',async()=>{
 const f=searchFixture();await f.context.openExistingHandoff();f.input.value='未匹配';f.input.input();assert.throws(()=>f.calls.submit[0]({get:()=> 'task_existing'}),/当前匹配/);
 f.input.value='本人';f.input.input();const body=f.calls.submit[0]({get:()=> 'task_existing'});assert.equal(body.expectedVersion,7);assert.equal(body.existingTaskVersion,12);
});
test('请求期间不启用确认，提交结束后重新核对当前匹配，失败不恢复无效选择',async()=>{
 const f=searchFixture();await f.context.openExistingHandoff();f.select.value='task_existing';f.form.dataset.busy='true';f.select.change();assert.equal(f.submit.disabled,true);
 f.form.dataset.busy='false';f.input.value='无匹配';f.input.input();f.submit.disabled=false;await f.form.onsubmit({});assert.equal(f.submit.disabled,true);
});
