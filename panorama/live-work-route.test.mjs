import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FlowFeishu} from '../flow-feishu.mjs';
import {workflowReturnTarget} from '../src/moduleLocation.ts';

const app=readFileSync(new URL('app.js',import.meta.url),'utf8');
const part=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)+start.length));
const code=[part('function liveWorkHref(', '\nfunction moduleLink'),part('async function openTask(', '\nfunction renderTask'),part('async function openAction(', '\nfunction showProduct')].join('\n');
const base='/yxb/wis-marketing-hub/';
test('the served inline Panorama HTML contains the guarded app source',()=>{
  const html=readFileSync(new URL('index.html',import.meta.url),'utf8');
  assert.ok(html.includes(app),'run panorama/build.mjs so the served HTML matches app.js');
  assert.match(html,/function renderTask\(\)\{const t=state\.task;if\(!t\)return;if\(t\.workflow==='04'\)return renderLiveTaskReadOnly\(t\)/);
});
function fixture({search='?task=task_live1',live=true,authorized=true,candidate=false,owner='LEAD'}={}){
  const calls={read:[],assign:[],render:0,history:[],drawers:[],delivery:0,toasts:[]};
  const task={id:'task_live1',workflow:'04',runtime:{state:'running',nodes:[{id:'W04.S2.E1',state:'ready',owner:{number:owner},evidenceKind:'human_attested'}],...(live?{liveSession:{date:'2026-09-26'}}:{})}};
  const location={pathname:base+(candidate?'l2-candidate/':'')+'workflow-panorama/',search,origin:'https://hub.fandow.com',assign:url=>calls.assign.push(url)};
  const state={task:null,overview:{access:{number:'LEAD',canManage:true}}};
  const ctx=vm.createContext({URL,URLSearchParams,encodeURIComponent,location,BASE:base,API:base+(candidate?'l2-candidate/':'')+'api/flows/',state,taskRequest:0,lastFocus:null,
    document:{activeElement:{}},history:{replaceState:(...args)=>calls.history.push(args.at(-1))},canUseTaskWorkspace:()=>true,
    api:async path=>{calls.read.push(path);if(!authorized)throw Error('需要本人登录');return task;},
    openDrawer:html=>calls.drawers.push(html),drawerHeader:(...parts)=>parts.join(' '),renderTask:()=>calls.render++,esc:String,
    $:()=>({}),toast:message=>calls.toasts.push(message),openDeliveryAction:()=>calls.delivery++});
  vm.runInContext(code,ctx);
  return {ctx,calls,task,location,state};
}

test('already-sent Panorama task URL routes a verified live run to the OA live form without posting completion',async()=>{
  const f=fixture();await f.ctx.openTask('task_live1');
  assert.deepEqual(f.calls.read,['runs/task_live1']);
  assert.deepEqual(f.calls.assign,['https://hub.fandow.com/yxb/wis-marketing-hub/#module=live-room-management&liveTask=task_live1']);
  assert.equal(f.calls.render,0);assert.equal(f.calls.delivery,0);
  const sender=new FlowFeishu(null,{people:()=>[],env:{FLOW_PUBLIC_URL:'https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/'}});
  const message=sender.message({kind:'ready',nodeId:'W04.S2.E1'},f.task);
  assert.match(message,/https:\/\/hub\.fandow\.com\/yxb\/wis-marketing-hub\/workflow-panorama\/\?task=task_live1/);
});
test('non-live workflow and explicit read-only record keep Panorama; candidate never jumps to formal OA app',async()=>{
  for(const input of [{live:false},{search:'?task=task_live1&view=record'},{candidate:true}]){
    const f=fixture(input);await f.ctx.openTask('task_live1');
    assert.equal(f.calls.assign.length,0);assert.equal(f.calls.render,1);
    if(input.search)assert.equal(f.calls.history[0],base+'workflow-panorama/?task=task_live1&view=record');
  }
});
test('unauthorized or failed protected run read never redirects or exposes live task',async()=>{
  const f=fixture({authorized:false});await f.ctx.openTask('task_live1');
  assert.equal(f.calls.assign.length,0);assert.equal(f.calls.render,0);assert.match(f.calls.drawers.at(-1),/需要本人登录/);
  const blocked=fixture();blocked.ctx.canUseTaskWorkspace=()=>false;await blocked.ctx.openTask('task_live1');assert.equal(blocked.calls.read.length,0);
});
test('Panorama only routes verified live completion by its current owner; unverified W04 cannot use generic delivery',async()=>{
  const own=fixture();own.state.task=own.task;await own.ctx.openAction('complete','W04.S2.E1');assert.equal(own.calls.assign.length,1);assert.equal(own.calls.delivery,0);
  const other=fixture({owner:'OTHER'});other.state.task=other.task;await other.ctx.openAction('complete','W04.S2.E1');assert.equal(other.calls.assign.length,0);assert.match(other.calls.toasts[0],/主责本人/);
  const unverified=fixture({live:false});unverified.state.task=unverified.task;await unverified.ctx.openAction('complete','W04.S2.E1');assert.equal(unverified.calls.delivery,0);assert.equal(unverified.calls.assign.length,0);assert.match(unverified.calls.toasts[0],/只读/);
  const ordinary=fixture({live:false});ordinary.task.workflow='00';ordinary.state.task=ordinary.task;await ordinary.ctx.openAction('complete','W04.S2.E1');assert.equal(ordinary.calls.delivery,1);assert.equal(ordinary.calls.assign.length,0);
  const candidate=fixture({candidate:true});candidate.state.task=candidate.task;await candidate.ctx.openAction('complete','W04.S2.E1');assert.equal(candidate.calls.assign.length,0);assert.match(candidate.calls.toasts[0],/候选环境/);
});
test('all other W04 generic actions fail closed, even for a manager or a stale button',async()=>{
  for(const live of [true,false])for(const action of ['assign','return','extend','pause','resume','cancel']){
    const f=fixture({live});f.state.task=f.task;
    await f.ctx.openAction(action,'W04.S2.E1');
    assert.equal(f.calls.assign.length,0,`${action} redirected`);
    assert.equal(f.calls.delivery,0,`${action} opened delivery`);
    assert.match(f.calls.toasts.at(-1),/只读/,`${action} was not blocked`);
  }
});
test('every W04 task detail renders only status and the verified formal live entry',()=>{
  const renderCode=[part('function renderLiveTaskReadOnly(', '\nfunction filteredTasks'),part('function renderTask(){', '\nfunction canStartDownstreamNow')].join('\n');
  for(const live of [true,false])for(const candidate of [true,false])for(const canManage of [true,false]){
    const f=fixture({live,candidate});f.task.title='真实直播任务';f.task.version=3;f.task.runtime.nodes[0].title='话术准备';f.task.runtime.nodes[0].owner.name='当前主播';
    f.state.task=f.task;f.state.overview.access.canManage=canManage;
    const drawers=[];const ctx=vm.createContext({state:f.state,API:candidate?'/l2-candidate/api/flows/':'/api/flows/',labels:{running:'进行中'},
      drawerHeader:(...parts)=>parts.join(' '),openDrawer:html=>drawers.push(html),esc:String,status:value=>value,fmt:String,
      liveWorkHref:id=>'https://hub.fandow.com/yxb/wis-marketing-hub/#module=live-room-management&liveTask='+id});
    vm.runInContext(renderCode,ctx);ctx.renderTask();
    const html=drawers.at(-1);assert.match(html,/直播任务 · 只读/);assert.match(html,/话术准备/);
    assert.doesNotMatch(html,/data-action=|data-notice=|data-handoff=|data-node-id=/);
    assert.equal(html.includes('liveTask=task_live1'),live&&!candidate);
    if(!live)assert.match(html,/缺少已核验的直播场次来源/);
  }
});
test('a stale notification retry button cannot send a W04 notification from Panorama',async()=>{
  const noticeLine=app.split('\n').find(line=>line.trimStart().startsWith('if(b.dataset.notice){'));
  const calls=[];const state={task:{workflow:'04',id:'task_live1'}};
  const ctx=vm.createContext({state,api:async()=>calls.push('api'),toast:message=>calls.push(message),openTask:async()=>calls.push('openTask')});
  vm.runInContext(`async function clickNotice(b){${noticeLine}}`,ctx);
  await ctx.clickNotice({dataset:{notice:'notice_1'},disabled:false});
  assert.equal(calls.length,1);assert.match(calls[0],/只读/);
  state.task.workflow='00';await ctx.clickNotice({dataset:{notice:'notice_1'},disabled:false});
  assert.deepEqual(calls.slice(1),['api','原通知已进入重试队列。','openTask']);
});
test('old deep link can resume through OA login without leaking or changing the task ID',async()=>{
  for(const live of [true,false]){
    const f=fixture({live});
    const loginHtml=f.ctx.loginResumeHtml(401);
    const loginHref=loginHtml.match(/href="([^"]+)"/)?.[1];
    assert.equal(loginHref,'https://hub.fandow.com/yxb/wis-marketing-hub/#module=workflow-engine&workflowTask=task_live1');
    const returnTarget=workflowReturnTarget(new URL(loginHref).hash,loginHref);
    assert.equal(returnTarget,'https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/?task=task_live1');
    await f.ctx.openTask('task_live1');
    assert.deepEqual(f.calls.read,['runs/task_live1']);
    assert.equal(f.calls.assign.length,live?1:0);
    assert.equal(f.calls.render,live?0:1);
  }
  const blocked=fixture({candidate:true});assert.equal(blocked.ctx.loginResumeHtml(401),'');
  const denied=fixture();assert.equal(denied.ctx.loginResumeHtml(403),'');
  const forged=fixture({search:'?task=https://evil.invalid'});assert.equal(forged.ctx.loginResumeHtml(401),'');
  const duplicate=fixture({search:'?task=task_live1&task=task_other'});assert.equal(duplicate.ctx.loginResumeHtml(401),'');
  const record=fixture({search:'?task=task_live1&view=record'});
  const recordHref=record.ctx.loginResumeHtml(401).match(/href="([^"]+)"/)?.[1];
  assert.equal(workflowReturnTarget(new URL(recordHref).hash,recordHref),'https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/?task=task_live1&view=record');
  const unexpectedView=fixture({search:'?task=task_live1&view=https://evil.invalid'});assert.equal(unexpectedView.ctx.loginResumeHtml(401),'');
});
test('Panorama 401 renders the task-preserving OA login action instead of dropping the old link',async()=>{
  const elements=new Map(),element=key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);};
  const location={pathname:base+'workflow-panorama/',search:'?task=task_live1',origin:'https://hub.fandow.com'};
  const ctx=vm.createContext({URL,URLSearchParams,encodeURIComponent,location,BASE:base,API:base+'api/flows/',esc:String,
    state:{loading:false},taskRequest:0,$:element,empty:(_title,_copy,action)=>action,
    api:async()=>{throw Object.assign(Error('需要 OA 登录'),{status:401});}});
  const refreshLine=app.split('\n').find(line=>line.startsWith('async function refresh('));
  vm.runInContext(part('function loginResumeHtml(', '\nfunction moduleLink')+'\n'+refreshLine,ctx);
  await ctx.refresh({initial:true});
  assert.match(element('#content').innerHTML,/workflowTask=task_live1/);
  assert.doesNotMatch(element('#content').innerHTML,/直播场次|W04\.S2/);
});
