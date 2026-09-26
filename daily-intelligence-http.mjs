import {readFileSync} from 'node:fs';
import {canReadIntelligence} from './daily-intelligence.mjs';
import {streamDownload} from './daily-intelligence-download.mjs';

export function createIntelligenceHandler({sessionFor,sendJson,env=process.env,fetchImpl=fetch}) {
  return async(req,res,url)=>{
    if(!['/api/daily-intelligence','/api/daily-intelligence/run','/api/daily-intelligence/send','/api/daily-intelligence/download'].includes(url.pathname))return false;
    const download=url.pathname.endsWith('/download');
    const write=!download&&url.pathname!=='/api/daily-intelligence';
    if(req.method!==(write?'POST':'GET')){sendJson(res,405,{detail:'请求方式不支持'});return true;}
    const session=await sessionFor(req);
    if(session.status!==200){sendJson(res,session.status,session.payload);return true;}
    if(!canReadIntelligence(session.payload)){sendJson(res,403,{detail:'每日创意情报仅向部门管理及维护人员开放'});return true;}
    if(write){
      if(!session.payload.permissions?.manage_permissions && !session.payload.workspace?.is_system_maintainer){sendJson(res,403,{detail:'手动采集与推送需要维护权限'});return true;}
      if(req.headers['x-intelligence-request']!=='1'||req.headers['sec-fetch-site']==='cross-site'){sendJson(res,403,{detail:'请求来源无效'});return true;}
      if(env.INTELLIGENCE_MANUAL_TEST_ENABLED!=='true'){sendJson(res,403,{detail:'当前环境未启用手动测试'});return true;}
    }
    if(!env.DAILY_INTELLIGENCE_URL||!env.INTELLIGENCE_INTERNAL_TOKEN_FILE){sendJson(res,503,{detail:'每日创意情报后台尚未配置'});return true;}
    try{
      if(download){
        const target=new URL('/download',env.DAILY_INTELLIGENCE_URL);
        for(const key of ['report','id','platform'])target.searchParams.set(key,url.searchParams.get(key)||'');
        await streamDownload(req,res,target,{headers:{'x-intelligence-token':readFileSync(env.INTELLIGENCE_INTERNAL_TOKEN_FILE,'utf8').trim()},fetchImpl});
        return true;
      }
      const path=write?(url.pathname.endsWith('/send')?'/send':'/run'):'/report';
      const r=await fetchImpl(new URL(path,env.DAILY_INTELLIGENCE_URL),{
        method:write?'POST':'GET',headers:{'x-intelligence-token':readFileSync(env.INTELLIGENCE_INTERNAL_TOKEN_FILE,'utf8').trim(),'content-type':'application/json'},
        body:write?'{}':undefined,redirect:'error',signal:AbortSignal.timeout(write?120000:12000)});
      const data=await r.json();
      sendJson(res,r.status,write?data:{...data,manualTestEnabled:env.INTELLIGENCE_MANUAL_TEST_ENABLED==='true'});
    }catch{if(res.headersSent||res.destroyed){res.destroy();}else sendJson(res,503,{detail:download?'视频暂不可下载，请稍后重试':'采集后台暂不可达；请刷新状态核对，避免重复推送'});}
    return true;
  };
}
