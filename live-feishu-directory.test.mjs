import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveDirectoryReader} from './live-feishu-directory.mjs';
test('directory whitelist rejects outsiders before any token or API request',async()=>{
  const read=createLiveDirectoryReader({bindings:[{openId:'ou_allowed'}],notifier:{tenantToken(){throw Error('must not call');}}});
  await assert.rejects(read('ou_other'),/名单/);
});
test('employment scope is reduced to status and permitted identity fields',async()=>{
  const read=createLiveDirectoryReader({bindings:[{openId:'ou_allowed'}],notifier:{appId:'cli_aa9c744d6ffa1cc4',tenantToken:async()=>'private'},fetchImpl:async()=>({ok:true,json:async()=>({code:0,data:{user:{open_id:'ou_allowed',name:'已核验同事',department_ids:['od_department'],status:{is_activated:true,is_resigned:false,is_frozen:false,is_exited:false},employee_no:'extra',email:'extra',enterprise_email:'extra',mobile:'extra',join_time:123,custom_attrs:['extra']}}})})});
  const u=await read('ou_allowed');assert.deepEqual(Object.keys(u).sort(),['department_ids','name','open_id','status']);assert.ok(!JSON.stringify(u).includes('extra'));assert.equal(u.status.is_activated,true);
});
