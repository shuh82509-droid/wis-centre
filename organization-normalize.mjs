import {createHash} from 'node:crypto';
import {MEETING_RECORD_FIELD_IDS,validateSourceData} from './organization-daily-sources.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(value));
const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(x=>x?.text||x?.text_run?.content||'').join(''):'';
const link=v=>{const s=typeof v==='string'?v:v?.link||v?.url||'';try{const u=new URL(s.trim());return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const metadata=(raw,readAt,url)=>({identity:'application',readAt,sourceUrl:url,rawSha256:hash(raw)});
export function directoryFromBlocks(blocks,readAt){
 const entries=[];let row=null;
 for(const b of blocks){
  const node=b.heading3||b.bullet||b.text||b.ordered;
  const elements=node?.elements||[];
  if(b.heading3){const center=elements.map(e=>e.text_run?.content||'').join('').trim();if(!center){row=null;continue;}row=entries.find(e=>e.center===center);if(!row){row={center,reports:[],dashboards:[]};entries.push(row);}continue;}
  if(!row)continue;
  const plain=elements.map(e=>e.text_run?.content||'').join('');
  const found=[];
  for(const e of elements){
   if(e.mention_doc?.url)found.push({title:e.mention_doc.title||'来源文档',url:link(e.mention_doc.url)});
   if(e.text_run?.text_element_style?.link?.url)found.push({title:e.text_run.content||'来源链接',url:link(e.text_run.text_element_style.link.url)});
   for(const m of (e.text_run?.content||'').matchAll(/https:\/\/[^\s<>]+/g))found.push({title:plain.includes('看板')?'中心经营看板':'中心日报',url:link(m[0])});
  }
  const list=plain.includes('看板')?row.dashboards:row.reports;
  for(const item of found)if(item.url&&!list.some(x=>x.url===item.url))list.push(item);
 }
 const url='https://jqx28l0j4lx.feishu.cn/docx/FWrQdnvzxooaN5xqzOmchTKDnqc';
 if(!entries.some(e=>e.reports.length||e.dashboards.length))throw new Error('日报目录未解析出来源链接，保留原版本');
 return validateSourceData('reportingDirectory',{factsDate:null,sourceMetadata:metadata(blocks,readAt,url),sourceUrl:url,entries});
}
export function meetingsFromRecords(records,fields,{factsDate,readAt}){
 const names=Object.fromEntries(Object.entries(MEETING_RECORD_FIELD_IDS).map(([key,id])=>[key,fields.find(f=>f.field_id===id)?.field_name]));
 if(Object.values(names).some(n=>!n))throw new Error('会议表字段已变化，保留原版本');
 const items=[];let unknownDates=0;
 for(const r of records){const f=r.fields||{},date=f[names.date];if(!date){unknownDates++;continue;}if(!Number.isFinite(Number(date)))throw new Error('会议日期格式未核验');if(day(Number(date))!==factsDate)continue;
  const dep=f[names.department];if(!(Array.isArray(dep)?dep:[dep]).includes('品牌营销部'))continue;
  const rawCenter=Array.isArray(f[names.center])?f[names.center][0]:f[names.center];const rawTitle=text(f[names.title]);
  const center=rawCenter||'未归属中心（待核验）',title=rawTitle||'未填写会议主题（待核验）';
  const transcriptUrl=link(f[names.transcript]);items.push({id:r.record_id||r.id,date:factsDate,center,title,transcriptUrl,minutesUrl:link(f[names.minutes]),recordingUrl:link(f[names.recording]),todo:text(f[names.todo])||null,readState:transcriptUrl?'unverified':'blank'});
 }
 const url='https://jqx28l0j4lx.feishu.cn/base/HD6cbG8Tiae30Ts266bcoGMUnMd?table=tblLfhIgmidjXyve';
 return validateSourceData('meetingEvidence',{factsDate,snapshotDate:factsDate,sourceUrl:url,sourceMetadata:{...metadata(records,readAt,url),fieldIds:Object.values(MEETING_RECORD_FIELD_IDS)},items,dailyRecords:items.length,readableRecords:0,blockedRecords:0,blankRecords:items.filter(x=>x.readState==='blank').length,unverifiedRecords:items.filter(x=>x.readState==='unverified').length,errorRecords:0,verification:{note:'来自完整会议表；链接尚未逐篇读取，未据此计算活力、热力或饱和评分。'+(unknownDates?'有 '+unknownDates+' 条无日期记录未归入任何业务日期。':'')}});
}
