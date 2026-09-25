import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';import {linkedLiveTask} from '../src/moduleLocation.ts';
const ts=createRequire(import.meta.url)('typescript'),source=readFileSync(new URL('../src/LiveDailyWork.tsx',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function wrapper(session,hash=''){const exports={},ctx=vm.createContext({exports,window:{location:{hash}},require:n=>n==='react'?{}:n==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}:n==='./LiveCalendarAuthorization'?{LiveCalendarAuthorization:()=>null}:n==='./moduleLocation'?{linkedLiveTask}:n.endsWith('.css')?{}:(()=>{throw Error(n);})()});vm.runInContext(output,ctx);return exports.LiveDailyWork({session});}
const session={user:{number:'SELF'},workspace:{role:'specialist',center:'直播中心'},access:{allowed_modules:['workflow-engine','live-room-management'],policy_state:'live'}};
test('直播或流程模块撤权及预览身份不显示入口',()=>{for(const modules of [[],['workflow-engine'],['live-room-management']])assert.equal(wrapper({...session,access:{...session.access,allowed_modules:modules}}),null);assert.equal(wrapper({...session,access:{...session.access,policy_state:'development-preview-staff'}}),null);});
test('换用户、角色或中心后表单和快照必须重新挂载，不复用旧权限状态',()=>{const first=wrapper(session);for(const s of [{...session,user:{number:'OTHER'}},{...session,workspace:{...session.workspace,role:'manager'}},{...session,workspace:{...session.workspace,center:'OTHER'}}])assert.notEqual(wrapper(s).key,first.key);});
test('日历授权入口仅对真实权限管理员开放',()=>{assert.equal(wrapper(session).props.calendarAdmin,false);assert.equal(wrapper({...session,permissions:{manage_permissions:true}}).props.calendarAdmin,true);});
test('受保护直播任务深链保持任务编号，换任务不复用旧表单状态',()=>{const one=wrapper(session,'#module=live-room-management&liveTask=task_one'),two=wrapper(session,'#module=live-room-management&liveTask=task_two');assert.equal(one.props.linkedTask,'task_one');assert.notEqual(one.key,two.key);assert.equal(wrapper(session,'#module=live-room-management&liveTask=javascript:bad').props.linkedTask,null);});
async function linkedRun({owner='SELF',state='running',sourceIssue='',live=true,nodeState='ready',conflict=false}={}){
 const states=[],effects=[],reads=[],posts=[],exports={};let index=0;
 const run={id:'task_future',version:5,title:'明日官旗正式场次',runtime:{state,nodes:[{id:'W04.S2.E1',title:'备播与排班',state:nodeState,liveStage:'备播与排班',owner:{number:owner},dependencies:[],attempt:1,plannedDueAt:'2026-09-26T01:00:00.000Z'}],...(live?{liveSession:{date:'2026-09-26',roomName:'官旗',sourceIssue,startAt:'2026-09-26T01:00:00.000Z'}}:{})}};
 const today={date:'2026-09-25',generatedAt:'2026-09-25T04:00:00.000Z',enabled:true,canManage:false,items:[]};
 const ctx=vm.createContext({exports,URL,AbortSignal,crypto:{randomUUID:()=> 'same-attempt'},document:{hidden:false},window:{location:{hash:'#module=live-room-management&liveTask=task_future',href:'https://hub.fandow.com/yxb/wis-marketing-hub/'},setInterval:()=>1,clearInterval:()=>{}},
   fetch:async(path,options={})=>{if(options.method==='POST'){posts.push(path);return {ok:!conflict,status:conflict?409:200,json:async()=>conflict?{detail:'原任务版本已变化'}:{ok:true}};}reads.push(path);return {ok:true,json:async()=>path.endsWith('live/today')?today:run};},
   require:n=>n==='react'?{useState:value=>{const at=index++;states[at]??=value;return [states[at],next=>{states[at]=typeof next==='function'?next(states[at]):next;}];},useRef:value=>({current:value}),useEffect:effect=>effects.push(effect)}:n==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}:n==='./LiveCalendarAuthorization'?{LiveCalendarAuthorization:()=>null}:n==='./moduleLocation'?{linkedLiveTask}:n.endsWith('.css')?{}:(()=>{throw Error(n);})()});
 vm.runInContext(output,ctx);const component=exports.LiveDailyWork({session,compact:true});const render=()=>{index=0;return component.type(component.props);};render();for(const effect of effects)effect();await new Promise(setImmediate);await new Promise(setImmediate);
 return {states,reads,posts,run,render};
}
test('明日场次虽不在今日列表，OA 登录后的 taskId 只读核验仍打开本人 ready 表单',async()=>{
 const f=await linkedRun();assert.ok(f.reads.some(path=>path.endsWith('runs/task_future')));assert.equal(f.states[4]?.taskId,'task_future');assert.equal(f.states[4]?.node.id,'W04.S2.E1');assert.equal(f.states[4]?.version,5);assert.equal(f.states[9],true);
});
test('非本人、未到达、暂停、来源待核验及非直播任务均不展示完成表单',async()=>{
 for(const input of [{owner:'OTHER'},{nodeState:'completed'},{state:'paused'},{sourceIssue:'班表变化'},{live:false}]){
   const f=await linkedRun(input);assert.equal(f.states[4],null,JSON.stringify(input));
 }
});
test('明日任务发生确定的版本冲突后清旧表单、只读重取原任务，不自动重提',async()=>{
 const f=await linkedRun({conflict:true});assert.equal(f.states[4]?.version,5);
 f.run.version=6;f.run.runtime.nodes[0].owner.number='OTHER';
 const find=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const match=find(child,predicate);if(match)return match;}return null;};
 const form=find(f.render(),node=>node.type?.name==='CompletionForm');assert.ok(form);
 form.props.submit({expectedVersion:5,nodeId:'W04.S2.E1',liveFacts:{confirmed:true}});
 await new Promise(setImmediate);await new Promise(setImmediate);
 assert.equal(f.posts.length,1);assert.equal(f.reads.filter(path=>path.endsWith('runs/task_future')).length,2);
 assert.equal(f.states[4],null);
});
test('明日任务可手动重新读取真实版本，刷新今日列表不会吞掉深链场次',async()=>{
 const f=await linkedRun();f.run.version=6;
 const find=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const match=find(child,predicate);if(match)return match;}return null;};
 const button=find(f.render(),node=>node.type==='button'&&node.props?.children==='重新读取原任务');assert.ok(button);
 button.props.onClick();await new Promise(setImmediate);await new Promise(setImmediate);
 assert.equal(f.states[4]?.version,6);
 assert.equal(f.reads.filter(path=>path.endsWith('runs/task_future')).length,2);
 assert.equal(f.posts.length,0);
});
test('正式 Hub 带查询与 hash 时，原任务记录链接仍回到同一 Hub 的受保护 Panorama',()=>{
 const code=ts.transpileModule(source.slice(source.indexOf('const recordUrl='),source.indexOf('\nasync function request')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const ctx=vm.createContext({URL,window:{location:{href:'https://hub.fandow.com/yxb/wis-marketing-hub/?source=feishu#module=live-room-management&liveTask=task_future'}}});
 assert.equal(vm.runInContext(code+';recordUrl("task_future")',ctx),'/yxb/wis-marketing-hub/workflow-panorama/?task=task_future&view=record');
});
