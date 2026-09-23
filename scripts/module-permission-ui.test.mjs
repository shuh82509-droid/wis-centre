import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const response=body=>({ok:true,status:200,json:async()=>body});
function apiFixture(fetch){const exports={},ctx=vm.createContext({exports,fetch,window:{setTimeout},Date,Map,Set,Promise});vm.runInContext(compile(readFileSync(new URL('../src/api.ts',import.meta.url),'utf8')),ctx);return exports.api;}

test('权限保存后迟到的旧读取不能覆盖新配置或抢占新的读取',async()=>{
 const pending=[];let writes=0;const api=apiFixture((path,options)=>options?.method?(writes++,Promise.resolve(response({ok:true}))):new Promise(resolve=>pending.push(resolve)));
 const old=api.moduleAccess();await api.moduleAccessUpdate('fixture','selected',['workflow-engine']);
 const current=api.moduleAccess();assert.equal(pending.length,2);
 pending[0](response({items:[{version:'old'}]}));await old;
 pending[1](response({items:[{version:'current'}]}));await current;
 assert.equal((await api.moduleAccess()).items[0].version,'current');assert.equal(pending.length,2);assert.equal(writes,1);
});

test('保存响应不确定只读回当前配置，缓存失效且不重放写操作',async()=>{
 let reads=0,writes=0;const api=apiFixture(async(path,options)=>{
  if(options?.method){writes++;return {ok:false,status:503,json:async()=>({detail:'uncertain fixture response'})};}
  return response({items:[{version:++reads}]});
 });
 assert.equal((await api.moduleAccess()).items[0].version,1);
 await assert.rejects(()=>api.moduleAccessUpdate('fixture','selected',[]));
 assert.equal((await api.moduleAccess()).items[0].version,2);assert.equal(writes,1);
});

test('最高权限变化后界面与同事预览都重新读取',async()=>{
 const reads=new Map();const api=apiFixture(async(path,options)=>{if(options?.method)return response({});reads.set(path,(reads.get(path)||0)+1);return response({items:[]});});
 await api.moduleAccess();await api.permissionPreviewCandidates();
 await api.permissionManagerRevoke('fixture');await api.moduleAccess();await api.permissionPreviewCandidates();
 assert.equal(reads.get('api/permissions/modules?q='),2);assert.equal(reads.get('api/permission-preview/candidates?q='),2);
});

test('同事预览不继承最高权限者的素材激励、流程或其他未选中模块',()=>{
 const source=ts.createSourceFile('App.tsx',readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='sessionForPreview');assert.ok(fn);
 const exports={},ctx=vm.createContext({exports,Set});vm.runInContext(compile(fn.getText(source)+'\nexports.preview=sessionForPreview;'),ctx);
 const session={user:{number:'OWNER'},permissions:{super_admin:true,operation_admin:true,manage_permissions:true},access:{allowed_modules:['material-incentive','workflow-engine','material-workbench']},workspace:{can_view_organization_dashboard:true,department:'品牌营销部',is_brand_department:true}};
 const result=exports.preview(session,{active:true,scope:'personal',person:'STAFF',subject:{realName:'STAFF',userNumber:'STAFF',department:'品牌营销部',center:'视频中心',allowedModules:['material-workbench'],note:'',sourceSheet:'当前配置'}});
 assert.deepEqual(Array.from(result.access.allowed_modules),['material-workbench']);assert.equal(result.permissions.manage_permissions,false);assert.equal(result.workspace.can_view_organization_dashboard,false);
});
