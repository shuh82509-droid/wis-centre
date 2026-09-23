import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrganizationEntryStore, entryRows} from './organization-entry.mjs';
const actor = {number:'FD-admin', realName:'测试管理员'};
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'wis-entry-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return new OrganizationEntryStore(join(dir,'permissions.json'));
}
test('new gate preserves defaults, deny survives restart, allow does not grant a role', t=>{
  const store=fixture(t); const user={number:'FD-test'};
  assert.equal(store.allowed(user),true);
  assert.throws(()=>readFileSync(store.file),{code:'ENOENT'});
  store.update([{key:'FD-TEST',enabled:false}],0,actor);
  assert.equal(new OrganizationEntryStore(store.file).allowed(user),false);
  store.update([{key:'FD-TEST',enabled:true}],1,actor);
  const listing=entryRows([{identifier:'name:test',user_number:'FD-TEST',login_active:true}],[],()=>({can_view_organization_dashboard:false}),store);
  assert.equal(listing.items[0].enabled,false);
  assert.equal(store.read().audits.length,2);
});
test('revision conflicts never overwrite; batch changes and audit persist together',t=>{
  const store=fixture(t);
  store.update([{key:'A',enabled:false},{key:'B',enabled:false}],0,actor);
  const before=readFileSync(store.file,'utf8');
  assert.throws(()=>store.update([{key:'A',enabled:true}],0,actor),{status:409});
  assert.equal(readFileSync(store.file,'utf8'),before);
  assert.equal(store.read().audits.length,2);
  assert.equal(store.allowed({number:'B'}),false);
});
test('corrupt configuration denies and rejects writes without replacing file',t=>{
  const store=fixture(t);writeFileSync(store.file,'broken');
  assert.equal(store.allowed({number:'A'}),false);
  assert.throws(()=>store.update([{key:'A',enabled:true}],0,actor),{status:503});
  assert.equal(readFileSync(store.file,'utf8'),'broken');
});
test('invalid batch input makes no partial change',t=>{
  const store=fixture(t);
  assert.throws(()=>store.update([{key:'A',enabled:false},{key:'',enabled:true}],0,actor),{status:400});
  assert.equal(store.read().version,0);assert.equal(store.allowed({number:'A'}),true);
});
test('unwritable target fails closed without replacing data',t=>{
  const store=fixture(t);mkdirSync(store.file);
  assert.throws(()=>store.update([{key:'A',enabled:false}],0,actor),{status:503});
  assert.equal(store.allowed({number:'A'}),false);
});
test('unverified identity disabled; aliases share employee gate; inactive users stay closed',t=>{
  const store=fixture(t);store.update([{key:'FD-A',enabled:false}],0,actor);
  const rows=entryRows([{identifier:'name:A',user_number:'FD-A',login_active:true},
    {identifier:'number:FD-A',user_number:'FD-A',login_active:true},
    {identifier:'name:unknown',login_active:true}, {identifier:'B',user_number:'FD-B',login_active:false}],[],()=>({can_view_organization_dashboard:true}),store).items;
  assert.deepEqual(rows.map(row=>row.enabled),[false,false,false,false]);
  assert.equal(rows[2].editable,false);
});

test('highest business view is explicit and cannot be silently changed by the ordinary entry switch',t=>{
  const store=fixture(t);store.update([{key:'FD-HIGH',enabled:false}],0,actor);
  const before=readFileSync(store.file,'utf8');
  const row=entryRows([{identifier:'number:FD-HIGH',user_number:'FD-HIGH',login_active:true,highest_business_access:true}],[],
    payload=>({can_view_organization_dashboard:payload.permissions.manage_permissions,role:'director',dashboard_scope:'department'}),store).items[0];
  assert.equal(row.enabled,true);assert.equal(row.editable,false);assert.equal(row.highest_business_access,true);
  assert.equal(readFileSync(store.file,'utf8'),before);
});
