// Isolated permission, HTTP and persisted-runtime contracts. No real account is
// impersonated; no production data, external requests or notifications are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {configurationAccess,readConfigurationGrants,configurationEndpoint} from './flow-configuration-access.mjs';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime,runVisible} from './flow-runtime.mjs';
import {FlowBlueprints} from './flow-blueprints.mjs';
import {FlowAutomation} from './flow-automation.mjs';
import {readPeople} from './flow-sources.mjs';
import {createFlowHandler} from './flow-http.mjs';
import {modules} from './flow-catalog.mjs';

const allModules=[...new Set([...Object.values(modules).filter(Boolean),'workflow-engine'])];
const grant={id:'isolated-configuration-grant',number:'CONFIG',active:true,scope:'department',capabilities:['view','edit','publish']};
const actorRows=[
 {number:'CONFIG',name:'配置协作者',center:'外部协作中心',role:'maintainer'},
 {number:'M',name:'任务发起主管',center:'A',role:'manager'},
 {number:'A',name:'本中心制作',center:'A',role:'specialist'},
 {number:'B',name:'本中心审核',center:'A',role:'specialist'},
 {number:'X',name:'其他中心主管',center:'B',role:'manager'},
 {number:'Y',name:'其他中心制作',center:'B',role:'specialist'},
 {number:'D',name:'部门总监',center:'管理',role:'director'},
 {number:'OLD',name:'已停用人员',center:'A',role:'specialist',active:false},
];
const clone=x=>structuredClone(x);
const status=n=>e=>e.status===n;
function fixture(t){
 const root=resolve(tmpdir()),dir=mkdtempSync(join(root,'flow-configuration-contract-'));
 t.after(()=>{assert.ok(resolve(dir).startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const people=actorRows.map(p=>({active:true,workflowEnabled:true,modules:[...allModules],...clone(p)}));
 const grants=[clone(grant)],unbound=new Set(),store=new WorkflowStore(join(dir,'tasks.json'));
 const runtime=new FlowRuntime(store,{people:()=>people,canNotify:n=>!unbound.has(n)}),blueprints=new FlowBlueprints(runtime);
 runtime.blueprints=blueprints;
 const base=(number='CONFIG')=>{const p=people.find(p=>p.number===number),enabled=p.active&&['manager','director','specialist'].includes(p.role)&&p.modules.includes('workflow-engine');return {user:clone(p),enabled,canManage:enabled&&['manager','director'].includes(p.role),department:enabled&&p.role==='director',modules:[...p.modules]};};
 const access=(number='CONFIG')=>configurationAccess(base(number),grants,{inactive:!people.find(p=>p.number===number).active});
 const spies={overview:0,sources:0,notifications:0,body:0},overview=runtime.overview.bind(runtime);
 runtime.overview=(...args)=>{spies.overview++;return overview(...args);};
 const sources={data:{cloud:{state:'connected'}},people:()=>people,view:()=>{spies.sources++;throw Error('Operational sources must not be read');}};
 const notifier={status:()=>{spies.notifications++;throw Error('Global notices must not be read');},recipient:n=>unbound.has(n)?null:{id:'private-recipient-'+n}};
 const http=async(method,path,body={},options={})=>{
  let response;const handler=createFlowHandler({runtime,blueprints,sources,notifier,
   automation:{view:()=>{throw Error('Watch read forbidden');},configure:()=>{throw Error('Watch mutation forbidden');}},
   currentSession:async()=>({status:options.sessionStatus||200,payload:{}}),accessFor:()=>access(options.actor||'CONFIG'),
   previewFor:()=>({active:options.preview===true}),readJson:async()=>{spies.body++;return body;},
   sendJson:(_,code,payload)=>response={status:code,body:payload},writesEnabled:options.writesEnabled??true,
   writeAccounts:options.writeAccounts??null});
  await handler({method,headers:{host:'fixture.invalid',origin:'https://fixture.invalid','x-flow-request':'1','content-type':'application/json','idempotency-key':options.key||'fixture-http-001',...options.headers}}, {},new URL('https://fixture.invalid/api/flows/'+path));
  return response;
 };
 const config=(order=['02','01'])=>{const d=blueprints.default(access());d.moduleOrder=order;d.defaultRoute=true;return d;};
 const publish=(d=config())=>blueprints.save(access(),{config:d,expectedVersion:0},'publish-configuration-001',{publish:true}).published;
 const create=(extra={},actor='M')=>runtime.create(access(actor),{workflow:'02',mode:'simple',owner:'A',manager:'M',reviewer:'B',title:'隔离授权链任务',acceptance:'核对原交付',product:'晶润紧致眼膜',sourceUrl:'https://fixture.invalid/brief',...extra},'create-configuration-001');
 return {dir,people,grants,unbound,store,runtime,blueprints,base,access,spies,http,config,publish,create};
}
function persistPrepared(f,id){return f.store.transaction(s=>{const t=s.tasks.find(x=>x.id===id);f.blueprints.ensureHandoff(s,t);assert.equal(t.runtime.handoff.state,'waiting');return t;});}
function dispatch(f,id,{strict=true}={}){return f.store.transaction(s=>{const t=s.tasks.find(x=>x.id===id);t.runtime.state='completed';t.status='completed';f.runtime.dispatchHandoff(s,t,{strict});return t;});}
function finish(f,id){let t=f.runtime.get(f.access('M'),id);while(t.runtime.state==='running'){const n=t.runtime.nodes.find(n=>n.state==='ready');t=f.runtime.command(f.access(n.owner.number),id,'complete',{expectedVersion:t.version,nodeId:n.id,note:'隔离真实办理接口',evidence:[{url:'https://fixture.invalid/evidence',reference:n.id,version:'1'}]},'finish-configuration-'+n.id);}return f.runtime.get(f.access('M'),id);}

test('授权文件缺失、无效 JSON、错误 schema 或非数组均不开放；正确 schema 原样读取',t=>{
 const f=fixture(t),file=join(f.dir,'grants.json');assert.deepEqual(readConfigurationGrants(file),[]);
 for(const data of ['{',JSON.stringify({schema:'other',grants:[grant]}),JSON.stringify({schema:'wis.flow-configuration-grants.v1',grants:{}})]){writeFileSync(file,data);assert.deepEqual(readConfigurationGrants(file),[]);}
 writeFileSync(file,JSON.stringify({schema:'wis.flow-configuration-grants.v1',grants:[grant]}));assert.deepEqual(readConfigurationGrants(file),[grant]);
});
test('误写的 null 或错误能力行不会中断任何用户的会话，也不会新开权限',t=>{
 const f=fixture(t),invalid=[null,false,3,'row',{}, {...grant,capabilities:'view,edit,publish'}];
 const denied=configurationAccess(f.base(),invalid);assert.equal(denied.canConfigure,false);
 assert.equal(configurationAccess(f.base('M'),invalid).canManage,true);
 assert.equal(configurationAccess(f.base(),[...invalid,grant]).canConfigure,true);
 assert.equal(configurationAccess(f.base('M'),invalid,{inactive:true}).enabled,false);
});
test('精确工号授权仅增加部门编排能力，不改变业务角色、中心、全局管理权限或原模块',t=>{
 const f=fixture(t),before=f.base(),a=f.access();assert.equal(a.enabled,true);assert.equal(a.canConfigure,true);assert.equal(a.configurationOnly,true);
 assert.equal(a.canManage,false);assert.equal(a.department,false);assert.equal(a.configurationScope,'department');assert.deepEqual(a.user,before.user);assert.deepEqual(a.modules,before.modules);assert.deepEqual(f.base(),before);
 assert.deepEqual(a.configurationGrant,{id:grant.id,number:grant.number,scope:'department'});
});
test('姓名相同、工号前后缀、停用、撤界面、错误 scope/能力/状态均不能取得窄授权',t=>{
 const f=fixture(t),b=f.base();for(const patch of [{number:'OTHER'},{number:' CONFIG'},{number:'CONFIG-extra'},{active:false},{scope:'center'},{capabilities:['view','edit']},{id:''}])assert.equal(configurationAccess(b,[{...grant,...patch}]).enabled,false,JSON.stringify(patch));
 assert.equal(configurationAccess({...b,user:{...b.user,number:'OTHER',name:b.user.name}},[grant]).enabled,false);
 assert.equal(configurationAccess(b,[grant],{inactive:true}).enabled,false);
 assert.equal(configurationAccess({...b,modules:b.modules.filter(m=>m!=='workflow-engine')},[grant]).enabled,false);
});
test('既有主管权限不被窄授权替换，普通同事和技术维护不会自动取得配置权限',t=>{
 const f=fixture(t),a=f.access('M');assert.equal(a.canManage,true);assert.equal(a.configurationOnly,false);assert.equal(a.department,false);
 assert.equal(f.access('A').canConfigure,false);f.grants.length=0;assert.equal(f.access().enabled,false);assert.equal(f.access().canConfigure,false);
});
test('server 会话授权每次读取当前 grant 文件；撤销和模块收回不复用旧配置权限',t=>{
 const f=fixture(t),file=join(f.dir,'flow-configuration-grants.json'),source=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 const match=source.match(/const flowAccessFor = payload => \{([\s\S]*?)\n\};/);assert.ok(match);
 const evaluate=new Function('taskCenterUser','inactiveWorkflowMembers','configurationAccess','readConfigurationGrants','join','dataRoot','return payload => {'+match[1]+'}')(p=>p.user,new Set(),configurationAccess,readConfigurationGrants,join,f.dir);
 const payload={user:f.base().user,workspace:{is_brand_department:false,dashboard_scope:'personal'},permissions:{manage_permissions:false},access:{allowed_modules:[...allModules]}};
 writeFileSync(file,JSON.stringify({schema:'wis.flow-configuration-grants.v1',grants:[grant]}));const allowed=evaluate(payload);assert.equal(allowed.configurationOnly,true);assert.equal(allowed.canManage,false);assert.equal(allowed.user.role,'maintainer');
 assert.equal(evaluate({...payload,access:{allowed_modules:allModules.filter(m=>m!=='workflow-engine')}}).enabled,false);
 writeFileSync(file,JSON.stringify({schema:'wis.flow-configuration-grants.v1',grants:[]}));assert.equal(evaluate(payload).enabled,false);assert.equal(evaluate(payload).canConfigure,false);
});
test('配置概览仅有空任务及 null 指标，不调用运行概览、源数据或全局通知',async t=>{
 const f=fixture(t);f.publish();f.create();const before=JSON.stringify(f.store.read()),r=await f.http('GET','overview');assert.equal(r.status,200);
 assert.deepEqual(r.body.tasks,[]);assert.deepEqual(r.body.events,[]);assert.ok(Object.values(r.body.metrics).every(v=>v===null));assert.equal(r.body.access.role,'maintainer');assert.equal(r.body.access.department,false);assert.equal(r.body.access.canManage,false);
 assert.deepEqual(f.spies,{overview:0,sources:0,notifications:0,body:0});assert.equal(JSON.stringify(f.store.read()),before);assert.ok(!JSON.stringify(r.body).includes('隔离授权链任务'));
});
test('配置 catalog 排除人事，人员仅返回绑定所需字段且排除停用人员',async t=>{
 const f=fixture(t),c=await f.http('GET','catalog');assert.equal(c.status,200);assert.ok(!c.body.flows.some(x=>x.id==='06'));assert.ok(!c.body.stages.some(x=>x.flow==='06'));
 const p=await f.http('GET','people');assert.equal(p.status,200);assert.ok(p.body.items.some(x=>x.number==='Y'));assert.ok(!p.body.items.some(x=>x.number==='OLD'));
 for(const item of p.body.items)assert.deepEqual(Object.keys(item).sort(),['center','name','notificationReady','number','role']);assert.ok(!JSON.stringify(p).includes('private-recipient'));
});
test('仅完整方法与路径白名单放行；任务、附件、素材、通知、自动跟进及未知路径全部 403 且零副作用',async t=>{
 const f=fixture(t);f.publish();const task=f.create(),before=JSON.stringify(f.store.read());f.spies.body=0;
 const denied=[['GET','runs/'+task.id],['POST','runs'],...['complete','return','assign','extend','pause','resume','cancel','handoff'].map(x=>['POST','runs/'+task.id+'/'+x]),...['sources','delivery-options','cloud-assets'].map(x=>['GET','runs/'+task.id+'/'+x]),['POST','runs/'+task.id+'/attachments'],['GET','runs/'+task.id+'/attachments/attachment_'+'a'.repeat(32)+'/content'],['PUT','runs/'+task.id+'/attachments/attachment_'+'a'.repeat(32)+'/content'],['POST','runs/'+task.id+'/cloud-assets/resolve'],...['sources','products','data-catalog','preview','automation/watches'].flatMap(x=>[['GET',x],['POST',x]]),['POST','notifications/notice_test/retry'],['DELETE','blueprints'],['GET','blueprints/nodes'],['POST','blueprints/revision/1'],['GET','blueprints/revision/nope'],['GET','blueprints/revision/1/extra'],['POST','overview'],['GET','unknown-future-api']];
 for(const [method,path]of denied){assert.equal(configurationEndpoint(method,path),false,method+' '+path);assert.equal((await f.http(method,path,{owner:'A',workflow:'02'})).status,403,method+' '+path);}
 assert.equal(JSON.stringify(f.store.read()),before);assert.deepEqual(f.spies,{overview:0,sources:0,notifications:0,body:0});
});
test('实际配置接口可预览/保存/发布/读版本，预览不读取运行任务',async t=>{
 const f=fixture(t),d=f.config();assert.equal((await f.http('GET','blueprints')).status,200);
 const nodes=await f.http('POST','blueprints/nodes',{workflow:'02'});assert.equal(nodes.status,200);assert.ok(nodes.body.nodes.length);
 const preview=await f.http('POST','blueprints/preview',{config:d});assert.equal(preview.status,200);assert.equal(preview.body.runningInstancesKept,null);assert.equal(f.spies.overview,0);
 assert.equal((await f.http('POST','blueprints/save',{config:d,expectedVersion:0})).status,200);
 const published=await f.http('POST','blueprints/publish',{config:d,expectedVersion:1});assert.equal(published.status,200);assert.equal(published.body.published.publishedBy.number,'CONFIG');
 const revision=await f.http('GET','blueprints/revision/2');assert.equal(revision.status,200);assert.equal(revision.body.scope,'department');
 assert.equal((await f.http('POST','blueprints/nodes',{workflow:'06'})).status,403);
});
test('配置请求仍服从真实会话、退出预览、CSRF、维护和验收账号门禁',async t=>{
 const f=fixture(t),body={config:f.config(),expectedVersion:0},before=JSON.stringify(f.store.read());
 for(const [options,expected]of [[{sessionStatus:401},401],[{preview:true},403],[{headers:{origin:'https://other.invalid'}},403],[{headers:{'sec-fetch-site':'cross-site'}},403],[{headers:{'x-flow-request':'0'}},403],[{headers:{'content-type':'text/plain'}},403],[{writesEnabled:false},503],[{writeAccounts:['M']},403]])assert.equal((await f.http('POST','blueprints/publish',body,options)).status,expected,JSON.stringify(options));
 assert.equal(JSON.stringify(f.store.read()),before);
});
test('只允许部门配置；旧中心配置不可读版本或编辑，预览不会移入既有任务',async t=>{
 const f=fixture(t),center=f.blueprints.default(f.access('M'));f.blueprints.save(f.access('M'),{config:center,expectedVersion:0},'publish-center-001',{publish:true});
 const d=f.config();d.scope='center';d.center='B';d.id='center:B';const published=f.publish(d);assert.equal(published.scope,'department');assert.equal(published.id,'department');assert.equal(published.center,'');
 const v=f.blueprints.view(f.access());assert.ok(v.revisions.every(x=>x.scope==='department'));assert.equal(f.blueprints.canEdit(f.access(),center),false);assert.equal(f.blueprints.canRead(f.access(),center),false);assert.equal(f.blueprints.active(f.access()).scope,'department');
 assert.equal((await f.http('GET','blueprints/revision/999')).status,404);
});
test('部门绑定允许其他中心在职人员，但发布不得伪造管理角色、未知人员或通知绑定',t=>{
 const f=fixture(t),d=f.config();d.modules['01'].owner='Y';d.modules['01'].manager='X';assert.equal(f.blueprints.validate(f.access(),d).modules['01'].owner,'Y');
 for(const number of ['OLD','MISSING']){const broken=clone(d);broken.modules['01'].owner=number;assert.throws(()=>f.blueprints.validate(f.access(),broken),status(403));}
 const wrong=clone(d);wrong.modules['01'].manager='Y';assert.throws(()=>f.blueprints.validate(f.access(),wrong),status(400));
 f.unbound.add('Y');assert.throws(()=>f.blueprints.validate(f.access(),d),status(409));assert.equal(f.store.read().tasks.length,0);
});
test('发布保存真实编辑人，忽略客户端伪造 publisher、grant、执行授权；同 key 不重复且 CAS 阻旧版本',t=>{
 const f=fixture(t),d=f.config();Object.assign(d,{publishedBy:{number:'D'},configurationGrant:{id:'forged'},executionAuthorizedBy:{number:'D'}});const body={config:d,expectedVersion:0};
 const a=f.blueprints.save(f.access(),body,'publish-cas-001',{publish:true}),b=f.blueprints.save(f.access(),body,'publish-cas-001',{publish:true});assert.deepEqual(a,b);assert.equal(a.published.publishedBy.number,'CONFIG');assert.equal(a.published.publishedBy.role,'maintainer');assert.equal(a.published.configurationGrant.id,grant.id);assert.equal(a.published.executionAuthorizedBy,undefined);assert.equal(f.store.read().flowBlueprintRevisions.length,1);
 const before=JSON.stringify(f.store.read());assert.throws(()=>f.blueprints.save(f.access(),{...body,config:{...d,name:'不同内容'}},'publish-cas-001',{publish:true}),status(409));assert.throws(()=>f.blueprints.save(f.access(),body,'publish-cas-002',{publish:true}),status(409));assert.equal(JSON.stringify(f.store.read()),before);
});
test('并发相同版本仅一个发布成功；撤 grant 后连原幂等 key 也无编辑权限，历史保留',async t=>{
 const f=fixture(t),body={config:f.config(),expectedVersion:0};const results=await Promise.all([f.http('POST','blueprints/publish',body,{key:'publish-race-001'}),f.http('POST','blueprints/publish',body,{key:'publish-race-002'})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(f.store.read().flowBlueprintRevisions.length,1);
 const before=JSON.stringify(f.store.read());f.grants.length=0;assert.equal((await f.http('POST','blueprints/publish',body,{key:'publish-race-001'})).status,403);assert.equal((await f.http('GET','blueprints')).status,403);assert.equal(JSON.stringify(f.store.read()),before);
});
test('配置协作者不能创建、查看或办理任务；内部 runVisible 也不因 department 标记泄露',t=>{
 const f=fixture(t);f.publish();const task=f.create(),before=JSON.stringify(f.store.read());assert.equal(runVisible(task,f.access()),false);assert.equal(runVisible(task,{...f.access(),department:true}),false);
 assert.throws(()=>f.runtime.get(f.access(),task.id),status(404));assert.throws(()=>f.create({},'CONFIG'),status(403));assert.throws(()=>f.runtime.command(f.access(),task.id,'cancel',{expectedVersion:task.version,note:'禁止越权'},'config-cancel-001'),status(404));assert.equal(JSON.stringify(f.store.read()),before);
});
test('主管发起时单独固定真实执行授权，客户端 _blueprint 或 actor 不能替换；父子保留真实编辑者',t=>{
 const f=fixture(t),published=f.publish(),task=f.create({_blueprint:{...published,executionAuthorizedBy:{number:'D'}},executionAuthorizedBy:{number:'D'},publishedBy:{number:'D'}}),d=task.runtime.blueprint;
 assert.equal(d.publishedBy.number,'CONFIG');assert.equal(d.executionAuthorizedBy.number,'M');assert.equal(d.executionAuthorizedBy.blueprintRevisionId,published.revisionId);assert.equal(d.executionAuthorizedBy.department,false);assert.equal(task.createdBy.number,'M');
 const s=f.store.read(),prepared=f.blueprints.prepareNext(s,s.tasks[0]);assert.equal(prepared.authorizedBy.number,'M');assert.equal(prepared.child.createdBy.number,'M');assert.deepEqual(prepared.child.runtime.blueprint.executionAuthorizedBy,d.executionAuthorizedBy);assert.equal(prepared.child.runtime.blueprint.publishedBy.number,'CONFIG');assert.equal(f.store.read().tasks.length,1);
});
test('真实完成接口自动交接一次，重读/再次派发不重复子任务或通知',t=>{
 const f=fixture(t);f.publish();const parent=f.create(),done=finish(f,parent.id);assert.equal(done.runtime.state,'completed');assert.equal(done.runtime.handoff.state,'dispatched');const child=f.store.read().tasks.find(x=>x.id===done.runtime.handoff.taskId);assert.equal(child.createdBy.number,'M');assert.equal(child.runtime.blueprint.publishedBy.number,'CONFIG');assert.equal(child.runtime.blueprint.executionAuthorizedBy.number,'M');
 const before=f.store.read();f.store.transaction(s=>{f.runtime.dispatchHandoff(s,s.tasks.find(x=>x.id===parent.id));return true;});const after=f.store.read();assert.equal(after.tasks.length,2);assert.deepEqual(after.flowEvents,before.flowEvents);assert.deepEqual(after.flowNotifications,before.flowNotifications);
});
const revocations=[
 ['管理角色降级',f=>{f.people.find(p=>p.number==='M').role='specialist';},409],
 ['人员停用',f=>{f.people.find(p=>p.number==='M').active=false;},409],
 ['流程界面撤销',f=>{f.people.find(p=>p.number==='M').workflowEnabled=false;},409],
 ['旧 exporter 缺流程权限字段',f=>{delete f.people.find(p=>p.number==='M').workflowEnabled;},409],
 ['人员来源缺失',f=>{f.people.splice(f.people.findIndex(p=>p.number==='M'),1);},409],
 ['发起人跨中心移动',f=>{f.people.find(p=>p.number==='M').center='B';},403],
 ['当前上游模块撤销',f=>{const p=f.people.find(p=>p.number==='M');p.modules=p.modules.filter(m=>m!==modules['02']);},403],
 ['当前下游模块撤销',f=>{const p=f.people.find(p=>p.number==='M');p.modules=p.modules.filter(m=>m!==modules['01']);},403],
];
for(const [name,revoke,code]of revocations){
 test('prepareNext 重新验证 '+name+'，禁止改用其他在职主管或配置发布人',t=>{const f=fixture(t);f.publish();const parent=f.create(),before=JSON.stringify(f.store.read());revoke(f);const s=f.store.read();assert.throws(()=>f.blueprints.prepareNext(s,s.tasks.find(x=>x.id===parent.id)),status(code));assert.equal(JSON.stringify(f.store.read()),before);});
 test('已准备等待交接后 '+name+'，dispatch 再检查且拒绝时事务无任务/通知副作用',t=>{const f=fixture(t);f.publish();const parent=f.create();persistPrepared(f,parent.id);const before=JSON.stringify(f.store.read());revoke(f);assert.throws(()=>dispatch(f,parent.id),status(code));assert.equal(JSON.stringify(f.store.read()),before);});
}
test('初始未授权模块不能因后来扩权自动启用；固定 revision 缺失或篡改不能派发',t=>{
 const f=fixture(t);f.publish();const p=f.people.find(x=>x.number==='M');p.modules=p.modules.filter(m=>m!==modules['01']);const parent=f.create();p.modules.push(modules['01']);assert.throws(()=>f.blueprints.prepareNext(f.store.read(),f.store.read().tasks[0]),status(403));
 for(const change of [d=>delete d.executionAuthorizedBy,d=>{d.executionAuthorizedBy.blueprintRevisionId='other';}]){const task=clone(parent);change(task.runtime.blueprint);assert.throws(()=>f.blueprints.executionAccess(task,'01'),status(409));}
});
test('配置可指定跨中心绑定，但普通主管执行不能扩中心；部门总监本人接受后可在原部门范围执行',t=>{
 const f=fixture(t),d=f.config();d.modules['01'].owner='Y';d.modules['01'].manager='X';f.publish(d);const managerTask=f.create();assert.throws(()=>f.blueprints.prepareNext(f.store.read(),f.store.read().tasks[0]),status(403));
 const directorTask=f.create({owner:'A',manager:'D',reviewer:'D'},'D'),prepared=f.blueprints.prepareNext(f.store.read(),directorTask);assert.equal(prepared.child.assignee.number,'Y');assert.equal(prepared.authorizedBy.number,'D');assert.equal(prepared.child.runtime.blueprint.executionAuthorizedBy.department,true);assert.equal(managerTask.runtime.blueprint.publishedBy.number,'CONFIG');
});
test('总监降为其他中心主管不再保留旧 department 执行范围',t=>{
 const f=fixture(t);f.publish();const parent=f.create({owner:'A',manager:'D',reviewer:'D'},'D');f.people.find(p=>p.number==='D').role='manager';assert.throws(()=>f.blueprints.prepareNext(f.store.read(),parent),status(403));
});
test('等待交接的节点主责跨中心或通知失效必须在 dispatch 阻止',t=>{
 for(const scenario of ['center','notification']){const f=fixture(t);f.publish();const parent=f.create();persistPrepared(f,parent.id);const before=JSON.stringify(f.store.read());if(scenario==='center')f.people.find(p=>p.number==='A').center='B';else f.unbound.add('A');assert.throws(()=>dispatch(f,parent.id),status(scenario==='center'?403:409));assert.equal(JSON.stringify(f.store.read()),before);}
});
test('后台拒绝交接只产生一次管理 attention，不发子任务 ready，原任务证据完整保留',t=>{
 const f=fixture(t);f.publish();const parent=f.create();persistPrepared(f,parent.id);f.people.find(p=>p.number==='M').workflowEnabled=false;
 const original=f.store.read().tasks[0],first=dispatch(f,parent.id,{strict:false});assert.equal(first.runtime.handoff.state,'attention');dispatch(f,parent.id,{strict:false});const s=f.store.read();assert.equal(s.tasks.length,1);assert.equal(s.flowNotifications.filter(x=>x.kind==='handoff_blocked').length,1);assert.deepEqual(s.tasks[0].runtime.nodes,original.runtime.nodes);assert.deepEqual(s.tasks[0].runtime.blueprint,original.runtime.blueprint);
});
test('配置授权撤销不篡改已被主管接受的版本；以后执行仍以该主管当前业务权限为准',t=>{
 const f=fixture(t);const published=f.publish(),parent=f.create();f.grants.length=0;const prepared=f.blueprints.prepareNext(f.store.read(),parent);assert.equal(prepared.authorizedBy.number,'M');assert.equal(prepared.child.runtime.blueprint.revisionId,published.revisionId);assert.equal(f.access().enabled,false);assert.equal(f.store.read().flowBlueprintRevisions[0].publishedBy.number,'CONFIG');
});
test('根条件分支沿真实执行人链派发且事件去重，撤模块后不会新增子任务',t=>{
 const f=fixture(t),d=f.config();d.defaultRoute=false;d.branches=[{after:'02',next:'01',when:'source_shortage'}];f.publish(d);const parent=f.create();
 const trigger=()=>f.store.transaction(s=>{f.blueprints.triggerSource(s,s.tasks.find(x=>x.id===parent.id),'source_shortage');return true;});trigger();trigger();const child=f.store.read().tasks.find(x=>x.id!==parent.id);assert.equal(child.createdBy.number,'M');assert.equal(child.runtime.blueprint.executionAuthorizedBy.number,'M');assert.equal(f.store.read().tasks.length,2);
 const g=fixture(t),other=g.config();other.defaultRoute=false;other.branches=d.branches;g.publish(other);const second=g.create();g.people.find(p=>p.number==='M').workflowEnabled=false;g.store.transaction(s=>{g.blueprints.triggerSource(s,s.tasks.find(x=>x.id===second.id),'source_shortage');return true;});assert.equal(g.store.read().tasks.length,1);assert.ok(g.store.read().tasks[0].runtime.routingIssues.source_shortage);
});
test('自动跟进固定真实配置主管的执行授权，忽略客户端伪造 pin；运行任务继承原 pin 而非协作者',t=>{
 const f=fixture(t);f.publish();const view={sources:[{id:'cloud',state:'connected'},{id:'remix',state:'connected'}],jobs:[{id:'job1',owner:'A',name:'隔离已有批次',product:'晶润紧致眼膜',pushEnabled:false,runs:[{id:'run1',date:'2026-09-14',state:'generating',target:1,generated:0,startedAt:'2026-09-14T00:00:00Z',stages:[]}]}],renders:[]};
 const auto=new FlowAutomation(f.runtime,{view:()=>view});assert.throws(()=>auto.configure(f.access(),{jobId:'job1',manager:'M'},'watch-denied-001'),status(403));
 const watch=auto.configure(f.access('M'),{jobId:'job1',manager:'M',blueprint:{executionAuthorizedBy:{number:'D'}}},'watch-real-001');assert.equal(watch.configuredBy.number,'M');assert.equal(watch.blueprint.publishedBy.number,'CONFIG');assert.equal(watch.blueprint.executionAuthorizedBy.number,'M');
 auto.reconcile();const task=f.store.read().tasks[0];assert.equal(task.createdBy.number,'M');assert.deepEqual(task.runtime.blueprint.executionAuthorizedBy,watch.blueprint.executionAuthorizedBy);assert.equal(f.store.read().tasks.length,1);
 f.people.find(p=>p.number==='M').workflowEnabled=false;assert.throws(()=>f.blueprints.prepareNext(f.store.read(),task),status(409));
});
test('真实 SQLite 授权投影以 module_access_grants 控制 workflowEnabled，并排除停用/外部人员',t=>{
 const f=fixture(t),db=new DatabaseSync(join(f.dir,'authority.db'));try{
 db.exec('CREATE TABLE oa_access_grants(identifier TEXT,real_name TEXT,user_number TEXT,department TEXT,center TEXT,active INTEGER);CREATE TABLE workspace_role_grants(identifier TEXT,role TEXT,center TEXT,department TEXT);CREATE TABLE module_access_grants(identifier TEXT,access_mode TEXT,modules TEXT)');
 const rows=[['all','ALL',1,'all','[]','品牌营销部'],['selected','SELECTED',1,'selected','["workflow-engine","material-workbench"]','品牌营销部'],['no-flow','NOFLOW',1,'selected','["material-workbench"]','品牌营销部'],['missing','MISSING',1,null,null,'品牌营销部'],['inactive','INACTIVE',0,'all','[]','品牌营销部'],['external','EXTERNAL',1,'all','[]','其他部门']];
 for(const [id,number,active,mode,list,department]of rows){db.prepare('INSERT INTO oa_access_grants VALUES(?,?,?,?,?,?)').run(id,number,number,department,'A',active);db.prepare('INSERT INTO workspace_role_grants VALUES(?,?,?,?)').run(id,'manager','A',department);if(mode)db.prepare('INSERT INTO module_access_grants VALUES(?,?,?)').run(id,mode,list);}
 const people=readPeople(db);assert.deepEqual(people.map(x=>[x.number,x.workflowEnabled]),[['ALL',true],['SELECTED',true],['NOFLOW',false],['MISSING',true]]);assert.deepEqual(people.find(x=>x.number==='SELECTED').modules,['material-workbench','workflow-engine']);assert.equal(people.find(x=>x.number==='ALL').modules.length,9);assert.ok(people.find(x=>x.number==='ALL').modules.includes('workflow-engine'));assert.deepEqual(people.find(x=>x.number==='MISSING').modules,[]);
 }finally{db.close();}
});
