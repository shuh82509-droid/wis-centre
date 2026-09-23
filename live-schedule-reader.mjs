import {requireFact} from './workflow-store.mjs';
// Only the configured same-origin hub module is called; client-provided URLs
// and response redirects are never followed with the user's session cookie.
export function createLiveScheduleReader({publicUrl,fetchImpl=fetch}){
  const root=new URL('../',publicUrl);
  requireFact(root.protocol==='https:'&&!root.username&&!root.password,'直播来源须为已配置的 HTTPS 中枢');
  return async(req,date)=>{
    const url=new URL('modules/dispatch-center/api/schedule',root);
    url.searchParams.set('date',date);url.searchParams.set('refresh','1');
    const headers={Accept:'application/json'};if(req.headers.cookie)headers.Cookie=req.headers.cookie;
    const response=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
    requireFact(response.ok,'正式班表暂不可读，请保留原任务并核验登录和来源权限',response.status===401||response.status===403?response.status:503);
    const data=await response.json();requireFact(data?.date===date,'排班服务未返回指定业务日期',409);return data;
  };
}
