import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('app.js',import.meta.url),'utf8');
const start=app.indexOf('function tasks(){'),end=app.indexOf('\nfunction ',start+1);
const code=app.slice(start,end);
test('管理任务列表暂停任务显示暂停，运行逾期任务显示超时',()=>{
 const item={id:'task',title:'任务',workflow:'02',owner:{name:'本人'},updatedAt:'2026-09-01',nodes:[{id:'node',title:'交付',state:'ready',owner:{name:'本人'},dueAt:'2026-09-01'}]};
 const ctx=vm.createContext({state:{overview:{access:{canManage:true}}},filteredTasks:()=>[item],esc:String,flowName:String,pill:(text)=>text,status:(s)=>({paused:'已暂停',running:'进行中'})[s],fmt:String,Date,empty:()=>''});vm.runInContext(code,ctx);
 item.state='paused';assert.match(ctx.tasks(),/已暂停/);assert.doesNotMatch(ctx.tasks(),/节点超时/);
 item.state='running';assert.match(ctx.tasks(),/节点超时/);
});
