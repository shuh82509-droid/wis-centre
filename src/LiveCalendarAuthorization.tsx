import {useEffect,useState} from 'react';
type CalendarState={configured:boolean;authorized:boolean;reason?:string;refreshExpiresAt?:number};
const endpoint='modules/live-room-management/api/lifecycle/calendar-auth/';
export function LiveCalendarAuthorization(){
  const [status,setStatus]=useState<CalendarState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function check(){setBusy(true);setError('');try{const res=await fetch(endpoint+'status',{cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await res.json();if(!res.ok)throw new Error(data.error||'日历授权状态无法读取');setStatus(data.calendar);}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setBusy(false);}}
  useEffect(()=>{void check();},[]);
  async function authorize(){setBusy(true);setError('');try{
    const res=await fetch(endpoint+'start',{method:'POST',headers:{'x-requested-with':'XMLHttpRequest'},signal:AbortSignal.timeout(15000)}),data=await res.json();
    if(!res.ok)throw new Error(data.error||'暂时无法发起授权');
    const url=new URL(data.authorizeUrl);
    if(url.origin!=='https://accounts.feishu.cn'||url.pathname!=='/open-apis/authen/v1/authorize')throw new Error('授权地址未通过安全校验');
    window.location.assign(url.href);
  }catch(e){setError(e instanceof Error?e.message:'授权失败');setBusy(false);}}
  return <details className="live-calendar-auth"><summary>正式面试日历授权（管理员）</summary>
    <p>指定日历：倪梦萍。由舒豪本人完成飞书只读授权，生产服务加密保存并自动续期；不需要把日历共享给机器人。</p>
    {error&&<p role="alert">{error}</p>}
    <p role="status">{status?(status.authorized?'用户授权已保存；实际日程读取以招聘页来源状态为准。':status.reason||'等待授权'):'正在核验授权状态…'}</p>
    <button disabled={busy||!status?.configured} onClick={()=>void authorize()}>{status?.authorized?'重新授权':'开始飞书只读授权'}</button>{' '}
    <button disabled={busy} onClick={()=>void check()}>检查授权结果</button>
  </details>;
}
