import {requireFact} from './workflow-store.mjs';

// The upstream field-level scope is broader than the business requirement.
// Never persist, log or return the raw user record, email, hire date or ID no.
export function createLiveDirectoryReader({bindings,notifier,fetchImpl=fetch}) {
  const allowed=new Set(bindings.map(b=>b.openId));
  return async openId=>{
    requireFact(allowed.has(openId),'不在已核验直播人员名单内',403);
    requireFact(notifier.appId==='cli_aa9c744d6ffa1cc4','通讯录应用不匹配',403);
    const token=await notifier.tenantToken();
    const response=await fetchImpl('https://open.feishu.cn/open-apis/contact/v3/users/'+encodeURIComponent(openId)+'?user_id_type=open_id&department_id_type=open_department_id',{
      headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000),
    });
    const payload=await response.json();
    requireFact(response.ok&&payload.code===0&&payload.data?.user,'直播人员身份读取失败',503);
    const u=payload.data.user;
    return {open_id:u.open_id,name:u.name,department_ids:Array.isArray(u.department_ids)?u.department_ids.filter(x=>typeof x==='string'):[],
      status:u.status?{is_activated:u.status.is_activated,is_resigned:u.status.is_resigned,is_frozen:u.status.is_frozen,is_exited:u.status.is_exited}:null};
  };
}
