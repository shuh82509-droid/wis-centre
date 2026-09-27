import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {linkedLiveTaskRoute} from '../src/moduleLocation.ts';

const ts=createRequire(import.meta.url)('typescript');
const source=readFileSync(new URL('../src/LiveDailyWork.tsx',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const manager={user:{number:'M'},workspace:{role:'manager',center:'直播中心'},access:{allowed_modules:['workflow-engine','live-room-management'],policy_state:'live'}};
const nodes=[
 {id:'W04.S1.E1',title:'排班确认',liveStage:'备播与排班',owner:{number:'L',name:'教练'},state:'completed',attempt:1,dependencies:[],completedAt:'2026-09-27T01:00:00.000Z'},
 {id:'W04.S2.E1',title:'素材准备',liveStage:'话术与素材准备',owner:{number:'A',name:'主播'},state:'ready',attempt:1,dependencies:['W04.S1.E1']}
];
const run=(state='running',sourceIssue='')=>({id:'task_live001',workflow:'04',version:7,title:'官旗正式场次',runtime:{state,liveSession:{date:'2026-09-27',roomName:'官旗',sourceIssue},nodes},flowEvents:[],notifications:[]});
function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const result=find(child,predicate);if(result)return result;}return null;}
async function record({task=run(),canManage=true,postResponses=[]}={}){
 const states=[],effects=[],requests=[],exports={};let index=0,confirmed=0,postIndex=0;
 const ctx=vm.createContext({exports,URL,URLSearchParams,AbortSignal,crypto:{randomUUID:()=> 'correction-uuid-001'},window:{location:{hash:'#module=live-room-management&liveTask=task_live001&liveView=record',href:'https://example.com/hub/'},confirm:()=>{confirmed++;return true;}},
  FormData:class{constructor(form){this.fields=form.fields;}get(key){return this.fields[key]??null;}},
  fetch:async(path,options={})=>{requests.push([path,options.method||'GET',options]);const value=options.method==='POST'?postResponses[postIndex++]:undefined,status=value?.status||200;return {ok:status<400,status,json:async()=>{if(options.method==='POST'){if(value?.jsonError)throw Error('bad json');return value===undefined?task:value;}return path.endsWith('live/today')?{canManage}:task;}};},
  require:name=>name==='react'?{useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),useState:value=>{const at=index++;states[at]??=value;return [states[at],next=>{states[at]=typeof next==='function'?next(states[at]):next;}];},useEffect:effect=>effects.push(effect)}:name==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}:name==='./LiveCalendarAuthorization'?{LiveCalendarAuthorization:()=>null}:name==='./moduleLocation'?{linkedLiveTaskRoute}:name.endsWith('.css')?{}:(()=>{throw Error(name);})()});
 vm.runInContext(output,ctx);const component=exports.LiveDailyWork({session:manager});const render=()=>{index=0;return component.type(component.props);};render();for(const effect of effects)effect();await new Promise(setImmediate);await new Promise(setImmediate);
 return {states,requests,render,correction:()=>find(render(),node=>node.type?.name==='SupervisorCorrection'),renderCorrection:(action='pause')=>{const node=find(render(),n=>n.type?.name==='SupervisorCorrection');if(!node)return null;states[0]=action;states[1]='';index=0;return node.type({...node.props,submit:correction=>{ctx.lastCorrection=correction;return Promise.resolve();}});},last:()=>ctx.lastCorrection,confirmed:()=>confirmed};
}

test('主管纠错须正式 liveSession 且服务端 canManage 为真；无源与非主管只读',async()=>{
 const denied=await record({canManage:false});assert.equal(denied.correction(),null);assert.deepEqual(denied.requests.map(([url])=>url),['api/flows/runs/task_live001','api/flows/live/today']);
 const legacy=await record({task:{...run(),runtime:{...run().runtime,liveSession:undefined}}});assert.equal(legacy.correction(),null);assert.deepEqual(legacy.requests.map(([url])=>url),['api/flows/runs/task_live001']);
 const otherWorkflow=await record({task:{...run(),workflow:'03'}});assert.equal(otherWorkflow.correction(),null);assert.deepEqual(otherWorkflow.requests.map(([url])=>url),['api/flows/runs/task_live001']);
 const allowed=await record();assert.ok(allowed.correction());assert.equal(allowed.requests.filter(([,method])=>method==='POST').length,0);
});

test('来源待核验时，仅开放暂停与终止；暂停后不能直接恢复',async()=>{
 const running=await record({task:run('running','正式班表人员变化')});const form=running.renderCorrection();const choices=find(form,n=>n.type==='select'&&n.props.value==='pause');assert.deepEqual(Array.from(choices.props.children,n=>n.props.value),['pause','cancel']);
 const paused=await record({task:run('paused','正式班表人员变化')});const pausedForm=paused.renderCorrection('cancel');const pausedChoices=find(pausedForm,n=>n.type==='select'&&n.props.value==='cancel');assert.deepEqual(Array.from(pausedChoices.props.children,n=>n.props.value),['cancel']);
});

test('直播执行节点不能在原任务改派，主管须按正式班表终止后重派',async()=>{
 const execution={id:'W04.S4.E1',title:'主播直播执行',liveStage:'直播执行',owner:{number:'A',name:'主播'},state:'ready',attempt:1,dependencies:['W04.S2.E1']};
 const assistant={...execution,id:'W04.S4.A1',title:'助理直播执行',owner:{number:'B',name:'助理'}};
 const mixed=await record({task:{...run(),runtime:{...run().runtime,nodes:[...nodes,execution,assistant]}}});
 const tree=mixed.renderCorrection('assign');
 const nodeChoices=find(tree,n=>n.type==='select'&&n.props.value==='W04.S2.E1');
 assert.deepEqual(Array.from(nodeChoices.props.children,n=>n.props.value),['W04.S2.E1']);
 assert.match(JSON.stringify(tree),/先更正正式班表.*终止旧场次任务.*保留原记录并重新派工/);
 const onlyExecution=await record({task:{...run(),runtime:{...run().runtime,nodes:[execution,assistant]}}});
 const actions=find(onlyExecution.renderCorrection(),n=>n.type==='select'&&n.props.value==='pause');
 assert.deepEqual(Array.from(actions.props.children,n=>n.props.value),['pause','cancel']);
});

test('主管五类纠错均带原版本与幂等键，改派和退回只选未完成节点及真实上游',async()=>{
 for(const [state,action,fields,expected] of [
  ['running','pause',{note:'等待资料核验'},{}],
  ['paused','resume',{note:'资料核验通过'},{}],
  ['running','assign',{note:'本人请假明确改派',owner:'B'}, {nodeId:'W04.S2.E1',owner:'B'}],
  ['running','return',{note:'原排班凭证需补充',targetNodeId:'W04.S1.E1'},{nodeId:'W04.S2.E1',targetNodeId:'W04.S1.E1'}],
  ['running','cancel',{note:'正式班次已取消'},{}]
 ]){
  const fixture=await record({task:run(state)}),tree=fixture.renderCorrection(action),form=find(tree,n=>n.type==='form');assert.ok(form,action);
  form.props.onSubmit({preventDefault(){},currentTarget:{fields}});
  const result=fixture.last();assert.equal(result.action,action);assert.equal(result.key,'correction-uuid-001');assert.equal(result.fromVersion,7);
  assert.equal(result.body.expectedVersion,7);assert.equal(result.body.note,fields.note);for(const [key,value] of Object.entries(expected))assert.equal(result.body[key],value);
  assert.equal(fixture.confirmed(),1);
 }
});

test('纠错的 2xx 非法 JSON、非 Run 和错任务响应都不得当作成功，须保留原编号并只读回查',async()=>{
 for(const badResponse of [{jsonError:true},{ok:true},{...run(),id:'other_task'},{...run(),runtime:{...run().runtime,nodes:[{}]}}]){
  const fixture=await record({postResponses:[badResponse,run()]}),correction={action:'pause',body:{expectedVersion:7,note:'核验原班表'},key:'same-correction-key',fromVersion:7};
  await fixture.correction().props.submit(correction);
  assert.equal(fixture.correction().props.task.id,'task_live001');
  assert.equal(fixture.correction().props.task.version,7);
  assert.deepEqual(fixture.requests.map(([url,method])=>[url,method]),[
   ['api/flows/runs/task_live001','GET'],['api/flows/live/today','GET'],
   ['api/flows/runs/task_live001/pause','POST'],['api/flows/runs/task_live001','GET']
  ]);
  assert.ok(find(fixture.render(),node=>node.type==='button'&&node.props.children==='沿用原编号继续同一次提交'));
  await fixture.correction().props.submit(correction);
  assert.equal(fixture.requests.filter(([,method])=>method==='POST').length,2);
  assert.deepEqual(fixture.requests.filter(([,method])=>method==='POST').map(([, ,options])=>options.headers['idempotency-key']),['same-correction-key','same-correction-key']);
  assert.equal(fixture.correction().props.task.id,'task_live001');
 }
});
test('结果不明后的无关版本变化仍冻结新操作，只能用原幂等键核验',async()=>{
 const task=run(),fixture=await record({task,postResponses:[{jsonError:true},{...run(),version:8}]}),correction={action:'pause',body:{expectedVersion:7,note:'核验原班表'},key:'same-correction-key',fromVersion:7};
 task.version=8;
 await fixture.correction().props.submit(correction);
 assert.equal(fixture.correction().props.task.version,8);
 assert.ok(find(fixture.render(),node=>node.type==='button'&&node.props.children==='沿用原编号继续同一次提交'));
 assert.match(JSON.stringify(fixture.render()),/继续冻结新操作/);
 await fixture.correction().props.submit({...correction,key:'different-key'});
 assert.equal(fixture.requests.filter(([,method])=>method==='POST').length,1);
 await fixture.correction().props.submit(correction);
 assert.deepEqual(fixture.requests.filter(([,method])=>method==='POST').map(([, ,options])=>options.headers['idempotency-key']),['same-correction-key','same-correction-key']);
});
test('纠错 2xx 仍为原版本时不能显示成功，须保留原键只读回查',async()=>{
 const task=run(),fixture=await record({task,postResponses:[task]}),correction={action:'pause',body:{expectedVersion:7,note:'核验原班表'},key:'same-correction-key',fromVersion:7};
 await fixture.correction().props.submit(correction);
 assert.equal(fixture.requests.filter(([,method])=>method==='POST').length,1);
 assert.ok(find(fixture.render(),node=>node.type==='button'&&node.props.children==='沿用原编号继续同一次提交'));
});
test('结果不明后原键重试遇到 409 仍冻结，不开放新的主管纠错',async()=>{
 const fixture=await record({postResponses:[{jsonError:true},{status:409,detail:'任务已更新'}]}),correction={action:'pause',body:{expectedVersion:7,note:'核验原班表'},key:'same-correction-key',fromVersion:7};
 await fixture.correction().props.submit(correction);
 await fixture.correction().props.submit(correction);
 assert.ok(find(fixture.render(),node=>node.type==='button'&&node.props.children==='沿用原编号继续同一次提交'));
 await fixture.correction().props.submit({...correction,key:'new-key'});
 assert.deepEqual(fixture.requests.filter(([,method])=>method==='POST').map(([, ,options])=>options.headers['idempotency-key']),['same-correction-key','same-correction-key']);
});
