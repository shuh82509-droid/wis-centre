import {requireFact} from './workflow-store.mjs';

export const liveWorkbook='EuYqssm4WhNwAvtyybKcDdk1ned';
export const officialRooms=Object.freeze([
  {code:'guanqi',name:'官旗',sheetId:'NYB2iu',startColumn:3,endColumn:13},
  {code:'brand_selection',name:'品牌精选',sheetId:'MVpDv0',startColumn:3,endColumn:12},
  {code:'youxuan',name:'优选',sheetId:'LRAvIU',startColumn:4,endColumn:13},
  {code:'wangou',name:'王鸥美肤',sheetId:'PhlV42',startColumn:3,endColumn:11},
]);
const cell=v=>Array.isArray(v)?v.map(cell).join(''):v&&typeof v==='object'?String(v.text??v.value??'').trim():String(v??'').trim();
const timeRange=v=>{
  const m=cell(v).replace(/：/gu,':').replace(/[～~—至]/gu,'-').replace(/次日/gu,'').match(/^(\d{1,2}):(\d{1,2})\s*-\s*(\d{1,2}):(\d{1,2})$/u);
  if(!m)return null;
  const [h1,m1,h2,m2]=m.slice(1).map(Number);
  requireFact(h1<24&&(h2<24||h2===24&&m2===0)&&m1<60&&m2<60,'班表时间超出范围',409);
  return [h1,m1,h2===24?0:h2,m2].reduce((a,n,i)=>i%2?[...a.slice(0,-1),a.at(-1)+':'+String(n).padStart(2,'0')]:[...a,String(n).padStart(2,'0')],[]);
};
function marker(v){const m=cell(v).match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日(?:\s*星期([一二三四五六日天0-6]))?/u);return m?{year:m[1],month:+m[2],day:+m[3],weekday:/^[0-6]$/.test(m[4]||'')?'日一二三四五六'[Number(m[4])]:m[4]}:null;}
export function parseOfficialRoom(room,values,date){
  const [year,month,day]=date.split('-').map(Number),weekday='日一二三四五六'[new Date(date+'T12:00:00+08:00').getUTCDay()];
  const rows=values.map(r=>Array.isArray(r)?r.map(cell):[]);
  const matches=rows.flatMap((r,i)=>{const m=marker(r[0]);return m&&(!m.year||+m.year===year)&&m.month===month&&m.day===day&&(!m.weekday||m.weekday===weekday||weekday==='日'&&m.weekday==='天')?[i]:[];});
  requireFact(matches.length>0,room.name+'尚无指定日期正式班表',409);
  // The workbook appends daily blocks across years. The final matching dated
  // block is authoritative, as in the existing dispatch parser; never fill
  // missing cells from an earlier block or attendance-code column.
  const start=matches.at(-1),next=rows.findIndex((r,i)=>i>start&&marker(r[0])),end=next<0?rows.length:next;
  const block=rows.slice(start,end),pairs=[];
  for(let i=0;i<block.length;i++){
    const slots=[];
    for(let c=room.startColumn;c<room.endColumn;c++)if(timeRange(block[i][c]))slots.push(c);
    if(!slots.length)continue;
    requireFact(block[i+1]&&slots.every(c=>cell(block[i+1][c])&&!timeRange(block[i+1][c])&&!/^(主播|助理|时间|待定|无|休息)$/u.test(cell(block[i+1][c]))),room.name+'班次存在空白或待定人员',409);
    const names=slots.map(c=>[...timeRange(block[i][c]),cell(block[i+1][c])]);
    pairs.push(names);i++;
  }
  requireFact(pairs.length===2,room.name+'主播/助理行结构不明确，停止派工',409);
  return {room:{code:room.code,name:room.name,anchors:pairs[0],assistants:pairs[1]},source:{found:true,sheetId:room.sheetId,firstRow:start+1,lastRow:end,marker:rows[start][0]}};
}

// Server-only reader: uses the existing selected app, reads exactly the user-
// approved workbook, and cannot write cells or forward an OA/browser cookie.
export function createOfficialLiveScheduleReader({appId,appSecret,fetchImpl=fetch,clock=Date.now,cacheMs=60000}){
  let token=null,loaded=null,inFlight=null;
  async function api(path){
    requireFact(appId&&appSecret,'正式班表应用读取尚未配置',503);
    if(!token||token.expiresAt<clock()+60000){
      const res=await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret}),signal:AbortSignal.timeout(15000)});
      const d=await res.json();requireFact(res.ok&&d.code===0&&d.tenant_access_token,'正式班表应用认证失败，已停止新增派工',503);
      token={value:d.tenant_access_token,expiresAt:clock()+Number(d.expire||0)*1000};
    }
    const res=await fetchImpl('https://open.feishu.cn/open-apis'+path,{redirect:'error',headers:{Authorization:'Bearer '+token.value},signal:AbortSignal.timeout(30000)});
    const d=await res.json();if(!res.ok||d.code!==0){loaded=null;if([99991663,99991668].includes(d.code))token=null;throw Object.assign(new Error('正式班表读取失败，原任务已保留（飞书代码 '+(d.code??res.status)+'）'),{status:503});}
    return d.data;
  }
  async function workbook(){
    if(loaded&&clock()-loaded.at<cacheMs)return loaded;
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      const result=[];
      for(const room of officialRooms){
        // A:Q is the existing published four-room layout, including date and
        // role rows; raw values remain in memory only.
        const d=await api(`/sheets/v2/spreadsheets/${liveWorkbook}/values/${encodeURIComponent(room.sheetId+'!A:Q')}?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`);
        requireFact(Array.isArray(d?.valueRange?.values)&&Number(d.revision||d.valueRange?.revision)>0,'班表值或版本缺失',503);
        result.push({room,values:d.valueRange.values,revision:Number(d.revision||d.valueRange.revision)});
      }
      requireFact(new Set(result.map(x=>x.revision)).size===1,'读取期间班表版本发生变化，等待下一轮重新读取',409);
      loaded={at:clock(),result};return loaded;
    })().catch(e=>{loaded=null;throw e;}).finally(()=>{inFlight=null;});
    return inFlight;
  }
  return async(_req,date)=>{
    requireFact(/^20\d{2}-\d{2}-\d{2}$/.test(date),'日期格式无效');
    const w=await workbook(),rooms=[],sourceStatus={},issues=[];
    for(const item of w.result){try{const p=parseOfficialRoom(item.room,item.values,date);rooms.push(p.room);sourceStatus[item.room.code]={...p.source,revision:item.revision};}catch(e){issues.push({roomCode:item.room.code,roomName:item.room.name,message:e.message});}}
    return {date,updatedAt:new Date(w.at).toISOString(),rooms,sourceStatus,issues,source:{mode:'official_live',spreadsheetToken:liveWorkbook,readOnly:true,verified:true},writebackCapability:{enabled:false,code:'read_only_dispatch_source'}};
  };
}
