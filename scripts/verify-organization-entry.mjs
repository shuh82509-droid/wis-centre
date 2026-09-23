import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startFixture} from './organization-entry-fixture.mjs';
const f=await startFixture();let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const id=role=>'number:FD-QA-'+role.toUpperCase();
try {
  const original={};
  for(const role of ['director','manager','specialist','external']) {
    const s=await f.request('/api/session',role);original[role]=s.body;
    equal(s.body.workspace.can_view_organization_dashboard,['director','manager'].includes(role));
  }
  equal((await f.request('/api/permissions/organization-entry','specialist')).status,403);
  equal((await f.request('/api/permissions/organization-entry','anonymous')).status,401);
  let state=(await f.request('/api/permissions/organization-entry')).body;
  equal(state.version,0);
  const save=(roles,enabled,version=state.version)=>f.request('/api/permissions/organization-entry','admin',{identifiers:roles.map(id),enabled,version});
  let result=await save(['manager'],false);equal(result.status,200);state=result.body;
  let s=(await f.request('/api/session','manager')).body;
  equal(s.workspace.can_view_organization_dashboard,false);
  equal(s.workspace.dashboard_scope,'center');equal(s.workspace.center,'视频中心');
  equal(s.access,original.manager.access);equal(s.permissions,original.manager.permissions);
  for(const route of ['overview','libtv-credits','libtv-auth','long-term-work/scheduler','long-term-work/scheduler/run','future-api']) {
    equal((await f.request('/api/organization-dashboard/'+route,'manager',undefined,route.endsWith('/run')?'POST':'GET')).status,403);
  }
  equal((await f.request('/api/permissions/modules/'+encodeURIComponent(id('manager')),'admin',{access_mode:'all',modules:original.manager.access.allowed_modules})).status,200);
  equal((await f.request('/api/session','manager')).body.workspace.can_view_organization_dashboard,false);
  equal((await save(['manager'],true,0)).status,409);
  equal((await save(['manager','specialist'],true)).status,409);
  equal((await f.request('/api/session','manager')).body.workspace.can_view_organization_dashboard,false);
  equal((await save(['external'],true)).status,409);
  equal((await save(['missing'],false)).status,404);
  result=await save(['director','manager'],false);equal(result.status,200);state=result.body;
  equal((await f.request('/api/session','director')).body.workspace.can_view_organization_dashboard,false);
  result=await save(['director','manager'],true);equal(result.status,200);state=result.body;
  for(const role of ['director','manager'])equal((await f.request('/api/session',role)).body,original[role]);
  const audits=await f.request('/api/operation-logs?module='+encodeURIComponent('看板权限'));
  equal(audits.status,200);equal(audits.body.items.length,5);
  const file=join(f.dir,'organization-entry-access.json');const before=readFileSync(file,'utf8');
  writeFileSync(file,'broken');
  equal((await f.request('/api/organization-dashboard/overview','director')).status,403);
  equal((await f.request('/api/session','director')).body.workspace.can_view_organization_dashboard,false);
  equal((await save(['director'],true)).status,503);equal(readFileSync(file,'utf8'),'broken');
  writeFileSync(file,before);
  console.log(JSON.stringify({passed:true,checks,productionGrantsTouched:false,coverage:['preserve role and scope','single and atomic batch','all modules cannot bypass','every dashboard route','corrupt state fail closed','revision conflicts','operation audit']}));
} finally {await f.close();}
