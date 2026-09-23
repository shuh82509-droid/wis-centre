import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/FlowInboxSummary.tsx',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const user={number:'SELF'},workspace={role:'manager',center:'A',is_brand_department:true,dashboard_scope:'center'},access={policy_state:'live',allowed_modules:['material-workbench','workflow-engine']};
const session={user,workspace,access,permissions:{manage_permissions:false}};
const key=s=>JSON.stringify([s.user.number||s.user.userId||s.user.id,s.workspace.role,s.workspace.center,s.workspace.is_brand_department,s.workspace.dashboard_scope,s.access.policy_state,s.access.allowed_modules]);
const team={access:{number:'SELF',canManage:true},blueprint:{name:'TEAM_BLUEPRINT'},executionRoutes:[{flow:'02',name:'TEAM_ROUTE',module:'material-workbench'}],tasks:[{id:'task_other',title:'OTHER_COLLEAGUE_TASK',state:'running',nodes:[]}],metrics:{active:1,completed:0,overdue:0,notificationAttention:0}};
function render(s,data,savedScope=key(session)){
 const states=[data?{scope:savedScope,data}:null,''];
 const exports={},ctx=vm.createContext({exports,require:name=>name==='react'?{useState:init=>[states.length?states.shift():init,()=>{}],useEffect:()=>{}}:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name.endsWith('.css')?{}:(()=>{throw Error(name);})()});
 vm.runInContext(output,ctx);let tree=exports.FlowInboxSummary({session:s});if(typeof tree?.type==='function')tree=tree.type(tree.props);return tree;
}
const text=tree=>JSON.stringify(tree,(k,v)=>typeof v==='function'?undefined:v);
test('同账号降级首帧不渲染旧主管任务或编排',()=>{const s={...session,workspace:{...workspace,role:'specialist',dashboard_scope:'personal'}};const tree=render(s,team);assert.match(text(tree),/我的任务/);assert.doesNotMatch(text(tree),/OTHER_COLLEAGUE_TASK|TEAM_BLUEPRINT|TEAM_ROUTE/);});
test('换中心或模块撤权时旧范围快照不可显示',()=>{for(const s of [{...session,workspace:{...workspace,center:'B'}},{...session,access:{...access,allowed_modules:[]}}])assert.doesNotMatch(text(render(s,team)),/OTHER_COLLEAGUE_TASK|TEAM_BLUEPRINT|TEAM_ROUTE/);});
test('受限跨任务摘要显示交接人，不产生任务链接',()=>{const s={...session,workspace:{...workspace,role:'specialist',dashboard_scope:'personal'}},data={...team,access:{number:'SELF',canManage:false},blueprint:undefined,executionRoutes:undefined,tasks:[{id:'task_self',title:'MY_TASK',state:'running',nodes:[],relations:{upstream:[{title:'上游交接',owner:{number:'A',name:'真实上游联系人'},canOpen:false}],downstream:[{title:'下游接收',owner:{number:'B',name:'真实下游联系人'},canOpen:false}]}}]};const value=text(render(s,data,key(s)));assert.match(value,/真实上游联系人/);assert.match(value,/真实下游联系人/);assert.doesNotMatch(value,/task_other|task=undefined|TEAM_BLUEPRINT/);});
test('仍有管理权限且范围一致时保留有效编排入口',()=>{assert.match(text(render(session,team)),/TEAM_BLUEPRINT/);assert.match(text(render(session,team)),/TEAM_ROUTE/);});

test('关闭流程引擎界面后不显示任务区域或读取旧快照',()=>{assert.equal(render({...session,access:{...access,allowed_modules:['material-workbench']}},team),null);});

test('部门外最高权限仍显示相同流程管理入口',()=>{const s={...session,permissions:{manage_permissions:true},workspace:{...workspace,role:'director',is_brand_department:false,dashboard_scope:'department'}};assert.match(text(render(s,team,key(s))),/TEAM_BLUEPRINT/);});
