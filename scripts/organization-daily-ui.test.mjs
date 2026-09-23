import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url),filename=new URL('../src/OrganizationDashboard.tsx',import.meta.url);
const source=readFileSync(filename,'utf8');
const compiled=ts.transpileModule(source+'\nexport { DailySourceStatus };',{
 compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const timeContext=vm.createContext({exports:{},Intl,Date});
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/sourceTime.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,timeContext);
const context=vm.createContext({exports:{},Intl,Date,require:(id)=>{
 if(['react','react/jsx-runtime'].includes(id))return require(id);
 if(id==='./sourceTime')return timeContext.exports;
 if(id==='@fluentui/react-icons')return new Proxy({}, {get:()=>()=>React.createElement('svg')});
 return {};
}});
vm.runInContext(compiled,context);
const render=data=>renderToStaticMarkup(React.createElement(context.exports.DailySourceStatus,{data}));
const state={state:'partial',lastAttemptAt:'2026-09-09T05:30:00Z',lastSuccessAt:'2026-09-09T05:31:00Z',
 factsDate:'2026-09-08',requiredBusinessDate:'2026-09-08',error:null,note:'19 条原文已读，分值证据不足'};
test('no collection receipt does not claim an enabled daily scheduler or current-day success',()=>{
 const html=render(null);
 assert.match(html,/尚无每日调度执行记录/);
 assert.match(html,/尚无已核验业务日期/);
 assert.doesNotMatch(html,/每天.*08:30|已启用|今日完成/);
});
test('source dates, last success, next actual due, and reference boundary render separately',()=>{
 const html=render({sourceRefresh:{scheduler:{nextDueAt:'2026-09-09T10:30:00Z'},sources:{
  meetingEvidence:state,organization:{...state,factsDate:null,requiredBusinessDate:null},
 }}});
 assert.match(html,/2026-09-09 13:31:00（北京时间）/);
 assert.match(html,/2026-09-09 18:30:00（北京时间）/);
 assert.match(html,/事实日期：2026-09-08/);
 assert.match(html,/参考资料，无业务完成日期/);
 assert.match(html,/目录不代表日报已完成/);
});
test('failed read is visible while original factual business date stays on screen',()=>{
 const html=render({sourceRefresh:{scheduler:null,sources:{meetingEvidence:{
  ...state,state:'stale',factsDate:'2026-09-01',error:'本次读取失败，原成功资料保留',
 }}}});
 assert.match(html,/本次读取失败/);assert.match(html,/事实日期：2026-09-01/);assert.match(html,/所选 2026-09-08/);
 assert.match(html,/快照数据/);
});
test('visible business wording distinguishes observed assets and historical meeting facts',()=>{
 assert.match(source,/<span>观测素材<\/span>/);
 assert.match(source,/已核验上线：/);
 assert.match(source,/无已核验资料，当前展示最近已读日期/);
 assert.match(source,/素材与人员观察周期/);
});
