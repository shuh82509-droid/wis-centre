import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Only a persisted report item can select a source download; never accept a URL
// from the browser. Keep credentials scoped to the configured source origin.
export function materialDownload(store,params,baseUrl) {
  const report=store.get(params.get('report'));
  const item=report?.materials?.items?.find(v=>v.id===params.get('id')&&v.platform===params.get('platform'));
  if(!item?.downloadUrl)throw Error('素材下载地址未提供');
  const url=new URL(item.downloadUrl),base=new URL(baseUrl);
  if(url.origin!==base.origin||url.username||url.password||url.search||url.hash||!/^\/api\/video\/download\/[a-zA-Z0-9_-]+$/.test(url.pathname))throw Error('素材下载来源无效');
  return {url,filename:(item.title||item.id).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,150)+'.mp4'};
}

export async function streamDownload(req,res,url,{headers={},filename,fetchImpl=fetch}={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10*60*1000);
  const closed=()=>{if(!res.writableFinished)controller.abort();};
  res.once('close',closed);
  try {
    const range=req.headers.range;
    if(range&&!/^bytes=\d+-\d*$/.test(range))throw Error('下载范围无效');
    const upstream=await fetchImpl(url,{headers:{...headers,...(range?{range}:{}),'accept-encoding':'identity'},redirect:'error',signal:controller.signal});
    const type=upstream.headers.get('content-type')||'';
    if(![200,206].includes(upstream.status)||!(/^(video\/|application\/octet-stream)/i.test(type))||!upstream.body){await upstream.body?.cancel();throw Error('来源视频暂不可下载');}
    const result={'content-type':type,'cache-control':'private, no-store','x-content-type-options':'nosniff',
      'content-disposition':filename?`attachment; filename="material.mp4"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g,'%27')}`:upstream.headers.get('content-disposition')||'attachment; filename="material.mp4"'};
    for(const key of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(key);if(value)result[key]=value;}
    res.writeHead(upstream.status,result);
    await pipeline(Readable.fromWeb(upstream.body),res,{signal:controller.signal});
  } finally {clearTimeout(timeout);res.off('close',closed);}
}
