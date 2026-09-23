// Server-owned Feishu source intake. This is deliberately independent of a
// desktop, Codex session, or user browser cookie. It collects only the fixed
// allowlist and never promotes raw text into a reviewed finding or KPI.
import {open,readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SparkLibraryStore,importSparkBatch} from './spark-library.mjs';
import {OrganizationSourceStore,ORGANIZATION_SOURCE_KEYS} from './organization-daily-sources.mjs';
import {directoryFromBlocks,meetingsFromRecords} from './organization-normalize.mjs';
import {ORGANIZATION_BOARDS,organizationFromBoards} from './organization-board-source.mjs';
import {nextSourceDue} from './source-schedule.mjs';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const dataRoot=resolve(process.env.DATA_DIR||join(here,'data'));
const root=join(dataRoot,'source-refresh');
const base='https://open.feishu.cn/open-apis';
const configPath=resolve(process.env.SOURCE_REFRESH_CONFIG||join(here,'source-scheduler-config.json'));
const reviewedConfigSha256='6da9304f27a7646fe4f9abea58614081fc3c48fab38ef87abe4b343cb89a4fdc';
const sha=s=>createHash('sha256').update(s).digest('hex');
const chinaDate=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const iso=()=>new Date().toISOString();
const cleanError=error=>String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,180);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));

export function blockText(block){
  const pieces=[];
  const walk=(value,key='')=>{
    if(!value||typeof value!=='object')return;
    if(key==='text_run'&&typeof value.content==='string')pieces.push(value.content);
    for(const [childKey,child] of Object.entries(value)){
      if(['children','block_id','parent_id'].includes(childKey))continue;
      if(Array.isArray(child))child.forEach(item=>walk(item,childKey));
      else if(child&&typeof child==='object')walk(child,childKey);
    }
  };
  walk(block);
  return pieces.join('').trim();
}
export function messageText(message){
  if(message?.msg_type!=='text')return '';
  try{const body=JSON.parse(message.body?.content||'{}');return typeof body.text==='string'?body.text.trim():'';}
  catch{return '';}
}
export function safeSourceId(...parts){return 'server:'+sha(parts.join('|')).slice(0,32);}

async function atomicJson(path,value){
  const temp=path+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temp,path);
}
async function jsonOr(path,fallback){
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}
async function api(url,headers,options={}){
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(url,{headers,...options,signal:AbortSignal.timeout(25000)});
    if([429,500,502,503,504].includes(response.status)&&attempt<2){await sleep(500*(attempt+1));continue;}
    const body=await response.json().catch(()=>null);
    if(!body||response.status>=400||body.code!==0){
      const error=new Error('Feishu read failed: '+String(body?.code??response.status));
      error.code=body?.code??response.status;throw error;
    }
    return body.data||{};
  }
  throw new Error('Feishu read retry exhausted');
}
async function token(){
  if(!process.env.FEISHU_APP_ID||!process.env.FEISHU_APP_SECRET)throw new Error('Feishu app credentials missing from server environment');
  const response=await fetch(base+'/auth/v3/tenant_access_token/internal',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET}),
    signal:AbortSignal.timeout(15000),
  });
  const body=await response.json();
  if(response.status!==200||body.code!==0||!body.tenant_access_token)throw new Error('Feishu tenant token unavailable');
  return {authorization:'Bearer '+body.tenant_access_token};
}
async function pages(route,headers,{maxPages=12,pageSize=200}={}){
  const items=[];let cursor='';
  for(let page=0;page<maxPages;page++){
    const url=new URL(base+route);
    url.searchParams.set('page_size',String(pageSize));
    if(cursor)url.searchParams.set('page_token',cursor);
    const data=await api(url,headers);
    if(!Array.isArray(data.items))throw new Error('Feishu page missing items');
    items.push(...data.items);
    if(!data.has_more)return {items,truncated:false};
    if(!data.page_token||data.page_token===cursor)throw new Error('Feishu pagination stalled');
    cursor=data.page_token;
  }
  return {items,truncated:true};
}
async function documentSource(entry,headers){
  const token=entry.token;
  let documentId=token,editedAt=null,url='https://jqx28l0j4lx.feishu.cn/docx/'+token;
  if(entry.type==='wiki'){
    const node=(await api(base+'/wiki/v2/spaces/get_node?token='+encodeURIComponent(token),headers)).node;
    if(node?.obj_type!=='docx'||!node.obj_token)throw new Error('Reviewed wiki node is not a docx');
    documentId=node.obj_token;editedAt=node.obj_edit_time||null;
    url='https://jqx28l0j4lx.feishu.cn/wiki/'+token;
  }else if(entry.type!=='docx')throw new Error('Source type is outside reviewed allowlist');
  const {items,truncated}=await pages('/docx/v1/documents/'+encodeURIComponent(documentId)+'/blocks',headers,{pageSize:500,maxPages:12});
  const blocks=items.map(block=>({id:block.block_id,text:blockText(block)})).filter(block=>block.id&&block.text);
  return {token,documentId,editedAt,url,blocks,truncated};
}
export function meetingDocumentReference(raw){
  if(typeof raw!=='string')return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||
      !['www.feishu.cn','jqx28l0j4lx.feishu.cn'].includes(url.hostname))return null;
    const match=url.pathname.match(/^\/(docx|wiki)\/([A-Za-z0-9]+)\/?$/u);
    return match?{type:match[1],token:match[2]}:null;
  }catch{return null;}
}
async function verifyMeetingDocuments(meeting,headers,directory){
  const cache=new Map();
  const read=async(url,reference)=>{
    if(!cache.has(url))cache.set(url,(async()=>{
      const source=await documentSource(reference,headers);
      if(source.truncated||!source.blocks.length||source.blocks.map(b=>b.text).join('').length<20)
        throw new Error('会议文档未返回完整可读正文');
      const receipt={sourceUrl:url,documentId:source.documentId,readAt:iso(),sha256:sha(JSON.stringify(source.blocks)),blockCount:source.blocks.length};
      await atomicJson(join(directory,'meeting-doc-'+sha(url).slice(0,16)+'.json'),{...receipt,blocks:source.blocks});
      return receipt;
    })());
    return cache.get(url);
  };
  for(const item of meeting.items){
    let failed=null;
    for(const url of [item.transcriptUrl,item.minutesUrl]){
      const reference=meetingDocumentReference(url);
      if(!reference)continue;
      try{
        item.readEvidence=await read(url,reference);
        item.readState='readable';
        failed=null;break;
      }catch(error){failed=error;}
    }
    if(item.readState!=='readable'&&failed){
      item.readState=[131006,99991672].includes(Number(failed.code))?'blocked':'error';
      item.readError=cleanError(failed);
    }
  }
  const counts={readable:0,blocked:0,blank:0,unverified:0,error:0};
  for(const item of meeting.items)counts[item.readState]++;
  for(const [key,value] of Object.entries(counts))meeting[key+'Records']=value;
  meeting.verification={note:`已按当日会议表链接读取纪要或逐字稿：${counts.readable}/${meeting.items.length} 条有正文凭证；受限 ${counts.blocked}、空链接 ${counts.blank}、其他读取失败 ${counts.error}。未读不按 0 评分。`};
  return meeting;
}
async function chatSource(id,headers,since){
  const route='/im/v1/messages?container_id_type=chat&container_id='+encodeURIComponent(id)+
    '&sort_type=ByCreateTimeDesc&start_time='+Math.floor(new Date(since).getTime()/1000);
  const {items,truncated}=await pages(route,headers,{pageSize:50,maxPages:40});
  const messages=items.map(message=>({id:message.message_id,createdAt:message.create_time,
    senderId:message.sender?.id||'',text:messageText(message)})).filter(message=>message.id&&message.text);
  return {id,messages,truncated};
}
function sourceFromChat(chat,message){
  const date=chinaDate(new Date(Number(message.createdAt)||Date.now()));
  return {id:safeSourceId('chat',chat.id,message.id),channel:'部门业务群',type:'group-message',author:'',date,
    url:'https://applink.feishu.cn/client/chat/'+chat.id,quote:message.text.slice(0,50000),
    limitation:'飞书群原文；未读取附件，未核验业务效果或行动完成情况。',locator:'message_id: '+message.id,
    chatId:chat.id,senderId:message.senderId,sourceCreatedAt:new Date(Number(message.createdAt)||Date.now()).toISOString()};
}
function sourceFromBlock(doc,block){
  const date=/^\d{10,13}$/.test(String(doc.editedAt||''))?
    chinaDate(new Date(Number(doc.editedAt)*(String(doc.editedAt).length===10?1000:1))):chinaDate();
  return {id:safeSourceId('doc',doc.token,block.id,sha(block.text)),channel:'中心日报',type:'docx-block',author:'',date,
    url:doc.url+'#'+block.id,quote:block.text.slice(0,50000),
    limitation:'飞书文档原文；单段摘录，未核验附件、经营后台或执行结果。',locator:'block_id: '+block.id,
    docToken:doc.token,blockId:block.id,revision:String(doc.editedAt||'')};
}
function nextSparkRun(){
  const due=new Date(chinaDate()+'T00:30:00Z');
  if(due.getTime()<=Date.now())due.setUTCDate(due.getUTCDate()+1);
  return due.toISOString();
}
async function spark(headers,run,config){
  const statePath=join(root,'spark-cursor.json');
  const state=await jsonOr(statePath,{schemaVersion:1,chats:{},documents:{}});
  const next=structuredClone(state),sources=[],results=[];
  next.chatReadAt={...(state.chatReadAt||{})};
  for(const id of config.chats){
    try{
      const lastRead=state.chatReadAt?.[id];
      const since=lastRead&&Number.isFinite(Date.parse(lastRead))?
        new Date(Date.parse(lastRead)-60*60*1000).toISOString():
        new Date(Date.now()-48*60*60*1000).toISOString();
      const chat=await chatSource(id,headers,since);
      await atomicJson(join(run.directory,'chat-'+sha(id).slice(0,16)+'.json'),chat);
      const prior=new Set(state.chats[id]||[]),first=!Object.hasOwn(state.chats,id);
      for(const message of chat.messages)if(!first&&!prior.has(message.id)&&message.text.length>=20)sources.push(sourceFromChat(chat,message));
      next.chats[id]=[...new Set([...chat.messages.map(m=>m.id),...prior])].slice(0,4000);
      if(!chat.truncated)next.chatReadAt[id]=iso();
      results.push({kind:'chat',id,state:chat.truncated?'partial':'ready',count:chat.messages.length,windowStart:since,rawSha256:sha(JSON.stringify(chat)),firstBaseline:first});
    }catch(error){results.push({kind:'chat',id,state:'failed',error:cleanError(error)});}
  }
  for(const entry of config.documents){
    try{
      const doc=await documentSource(entry,headers);
      await atomicJson(join(run.directory,'document-'+sha(doc.token).slice(0,16)+'.json'),doc);
      const prior=state.documents[doc.token]||{},first=!Object.hasOwn(state.documents,doc.token),hashes={};
      for(const block of doc.blocks){
        const hash=sha(block.text);hashes[block.id]=hash;
        if(!first&&prior[block.id]!==hash&&block.text.length>=20)sources.push(sourceFromBlock(doc,block));
      }
      next.documents[doc.token]=hashes;
      results.push({kind:'document',id:doc.token,state:doc.truncated?'partial':'ready',count:doc.blocks.length,rawSha256:sha(JSON.stringify(doc)),firstBaseline:first});
    }catch(error){results.push({kind:'document',id:entry.token,state:'failed',error:cleanError(error)});}
  }
  const incomplete=results.some(item=>item.state!=='ready');
  if(sources.length>1000)throw new Error('Source delta exceeds review limit; cursor not advanced');
  const failures=results.filter(x=>x.state==='failed').map(x=>({
    name:x.id==='oc_be5804697349acfbb77557e8406cceca'?'品牌营销部':
      x.id==='oc_5d501f0cdd3938d42263b0c028412187'?'《如何挖掘营销机会点》培训群':x.id,
    reason:x.error,sourceId:x.id,
  }));
  const truncated=results.filter(x=>x.state==='partial').length;
  const batchId='server-spark-'+chinaDate().replaceAll('-','')+'-'+randomUUID().slice(0,8);
  const batch={batchId,items:[],sources,conflictPolicy:'keep-existing',
    run:{status:incomplete?'partial':'success',at:iso(),collector:'server-feishu-bot',
      note:'仅采集原文来源；未经 AI 筛选或主管审阅，不新增星火发现卡片。'},
    coverage:{
      summary:`新服务器按白名单读取 ${config.chats.length} 个业务群、${config.documents.length} 份中心日报；原文来源增量入库，未经审核的价值判断不自动成为星火卡片。`,
      sourceCount:results.length,readCount:results.filter(x=>x.state==='ready').length,
      rangeStart:results.find(x=>x.kind==='chat'&&x.windowStart)?.windowStart||'',rangeEnd:iso(),
      schedule:{enabled:true,time:'08:30',timezone:'Asia/Shanghai',nextRunAt:nextSparkRun(),runner:'WIS中枢服务器'},
      totalChats:config.chats.length,totalDocuments:config.documents.length,
      readyChats:results.filter(x=>x.kind==='chat'&&x.state==='ready').length,
      readyDocuments:results.filter(x=>x.kind==='document'&&x.state==='ready').length,
      failures,truncated,
      limitations:[
        '只读取白名单群文本消息和中心日报正文，不读取私聊与附件。',
        ...(truncated?['部分群在限定时间窗口达到分页上限，保持部分覆盖并在下次重试。']:[]),
        ...(failures.length?['未授权或已停用群保持待处理，不按零数据计算。']:[]),
        '原文来源入库不代表 AI 已完成价值筛选或业务验证。',
      ],
    }};
  const store=new SparkLibraryStore(join(dataRoot,'spark-library'));
  batch.expectedRevision=store.read().revision;
  const receipt=importSparkBatch(store,batch);
  await atomicJson(statePath,next);
  run.spark={results,foundSources:sources.length,receipt,coverage:batch.coverage};
}
async function organization(headers,run,config){
  const docs={reportingDirectory:'FWrQdnvzxooaN5xqzOmchTKDnqc',organization:'IE67d4MdKo2xpqxvClLcYeACn15'};
  const results={},normalized={},factsDate=chinaDate(new Date(Date.now()-86400000));
  for(const [key,id] of Object.entries(docs)){
    try{
      const page=await pages('/docx/v1/documents/'+id+'/blocks',headers,{pageSize:500,maxPages:12});
      results[key]={state:page.truncated?'partial':'ready',blockCount:page.items.length,rawSha256:sha(JSON.stringify(page.items))};
      await atomicJson(join(run.directory,key+'.json'),page.items);
      if(key==='reportingDirectory'&&!page.truncated)normalized[key]=directoryFromBlocks(page.items,iso());
      if(key==='organization'&&!page.truncated){
        const linked=page.items.filter(b=>b.board?.token).map(b=>b.board.token);
        if(linked.length!==ORGANIZATION_BOARDS.length||!ORGANIZATION_BOARDS.every(id=>linked.includes(id)))throw new Error('组织资料画板来源已变化，保留上次成功版本');
        const boards={};
        for(const id of ORGANIZATION_BOARDS){
          boards[id]=await api(base+'/board/v1/whiteboards/'+encodeURIComponent(id)+'/nodes',headers);
          await atomicJson(join(run.directory,'board-'+id+'.json'),boards[id]);
        }
        normalized[key]=organizationFromBoards(page.items,boards,iso());
        results[key].boardCount=ORGANIZATION_BOARDS.length;
      }
    }catch(error){results[key]={state:'failed',error:cleanError(error)};}
  }
  try{
    const page=await pages('/bitable/v1/apps/HD6cbG8Tiae30Ts266bcoGMUnMd/tables/tblLfhIgmidjXyve/records',headers,{pageSize:200,maxPages:12});
    results.meetingEvidence={state:page.truncated?'partial':'ready',recordCount:page.items.length,rawSha256:sha(JSON.stringify(page.items))};
    await atomicJson(join(run.directory,'meeting-records.json'),page.items);
    if(!page.truncated){
      let fields;
      try{fields=await pages('/bitable/v1/apps/HD6cbG8Tiae30Ts266bcoGMUnMd/tables/tblLfhIgmidjXyve/fields',headers,{pageSize:100,maxPages:10});}
      catch(error){
        // Field metadata needs a separate Feishu scope. Use the exact schema
        // independently read by the owner on 2026-09-23, never guessed labels.
        if(Number(error.code)!==99991672)throw error;
        const reviewed=await readFile(join(here,'meeting-fields-reviewed.json'));
        if(sha(reviewed)!=='de64a57fd2e3b9afa51d4b31d422698a3670308639437c3fde0c7ddd625d1136')throw new Error('会议字段核验文件发生变化');
        const schema=JSON.parse(reviewed);
        fields={items:schema.fields,truncated:false};
        results.meetingEvidence.schemaVerifiedAt=schema.verifiedAt;
        results.meetingEvidence.schemaMode='owner-verified-schema';
      }
      if(fields.truncated)throw new Error('会议字段未完整读取');
      normalized.meetingEvidence=await verifyMeetingDocuments(
        meetingsFromRecords(page.items,fields.items,{factsDate,readAt:iso()}),headers,run.directory);
      results.meetingEvidence.readable=normalized.meetingEvidence.readableRecords;
      await atomicJson(join(run.directory,'meeting-fields.json'),fields.items);
    }
  }catch(error){results.meetingEvidence={state:'failed',error:cleanError(error)};}
  if(normalized.reportingDirectory){
    const reportResults=[];
    for(const entry of config.documents){
      let report;
      try{
        const page=await documentSource(entry,headers),readAt=iso();
        await atomicJson(join(run.directory,'daily-'+entry.token+'.json'),page);
        let factsDate=null,at=0;
        for(let i=0;i<Math.min(page.blocks.length,200);i++){
          const match=page.blocks[i].text.match(/(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})(?:日|\b)/);
          if(match){factsDate=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');at=i;break;}
        }
        report={token:entry.token,state:page.truncated?'partial':'ready',readAt,factsDate,url:page.url,
          excerpt:page.blocks.slice(at,at+12).map(b=>b.text).join('\n').slice(0,1600),rawSha256:sha(JSON.stringify(page.blocks))};
      }catch(error){report={token:entry.token,state:'failed',readAt:iso(),factsDate:null,error:cleanError(error)};}
      reportResults.push(report);
      for(const center of normalized.reportingDirectory.entries)for(const link of center.reports){
        if(link.url.includes('/'+entry.token))Object.assign(link,{collection:report});
      }
    }
    results.dailyReports={state:reportResults.every(r=>r.state==='ready')?'ready':'partial',total:reportResults.length,readable:reportResults.filter(r=>r.state==='ready').length};
    normalized.reportingDirectory.reportCoverage=results.dailyReports;
  }
  const store=new OrganizationSourceStore(join(dataRoot,'organization-sources'));
  const before=await store.read({requiredBusinessDate:factsDate});
  if(Object.keys(normalized).length){
    const publishedAt=iso();
    await store.publish({generationId:'server-'+Date.now(),publishedAt,expectedGeneration:before.generationId,
      sources:Object.fromEntries(Object.entries(normalized).map(([key,data])=>[key,{data,lastSuccessAt:publishedAt}]))});
  }
  const after=await store.read({requiredBusinessDate:factsDate});
  await store.writeStatus({schemaVersion:1,updatedAt:iso(),lastAttemptAt:run.startedAt,nextDueAt:nextSourceDue('organization').toISOString(),requiredBusinessDate:factsDate,
    sources:Object.fromEntries(ORGANIZATION_SOURCE_KEYS.map(key=>[key,{state:normalized[key]?'ready':results[key]?.state||'pending',lastAttemptAt:run.startedAt,
      lastSuccessAt:after.status[key]?.lastSuccessAt||null,factsDate:after.sources[key]?.factsDate??null,error:normalized[key]?null:results[key]?.error||'本轮未产生新的已核验来源'}]))});
  run.organization={results,publishedKeys:Object.keys(normalized),generationId:after.generationId,factsDate,note:'完整来源已整理并发布；受阻来源保留原日期和失败状态。'};
}
export async function refresh(mode){
  if(!['spark','organization'].includes(mode))throw new Error('Unsupported server refresh mode');
  await mkdir(root,{recursive:true,mode:0o700});
  // The native scheduler uses a kernel lock, released even after a crash or
  // container restart. Keep the legacy exclusive lock for direct invocations.
  const lockPath=join(root,mode+'.lock'),lock=process.env.SOURCE_REFRESH_LOCK_HELD==='1'?null:await open(lockPath,'wx',0o600);
  try{
    const configBytes=await readFile(configPath);
    if(sha(configBytes)!==reviewedConfigSha256)throw new Error('Reviewed source allowlist checksum changed; stop before collecting');
    const config=JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/,''));
    if(!Array.isArray(config.chats)||config.chats.length!==69||!Array.isArray(config.documents)||config.documents.length!==11)
      throw new Error('Reviewed source allowlist changed; stop before collecting');
    const directory=join(root,'runs',mode+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
    await mkdir(directory,{recursive:true,mode:0o700});
    const run={schemaVersion:1,mode,startedAt:iso(),businessDate:chinaDate(),directory};
    try{
      const headers=await token();
      if(mode==='spark')await spark(headers,run,config);else await organization(headers,run,config);
      run.state=mode==='spark'&&run.spark.coverage.failures.length===0&&run.spark.coverage.truncated===0?'success':
        mode==='organization'&&Object.values(run.organization.results).every(x=>x.state==='ready')?'sources_collected':'partial';
    }catch(error){run.state='failed';run.error=cleanError(error);}
    run.finishedAt=iso();
    await atomicJson(join(directory,'receipt.json'),run);
    await atomicJson(join(root,mode+'-latest.json'),{mode,state:run.state,at:run.finishedAt,businessDate:run.businessDate,receipt:join(directory,'receipt.json'),
      ...(mode==='spark'?{coverage:run.spark?.coverage,addedSources:run.spark?.receipt?.addedSources||0}:{results:run.organization?.results})});
    return run;
  }finally{if(lock){await lock.close();await unlink(lockPath);}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];
  try{
    const result=await refresh(mode);
    process.stdout.write(JSON.stringify({mode,state:result.state,receipt:join(result.directory,'receipt.json'),
      addedSources:result.spark?.receipt?.addedSources||0})+'\n');
    if(result.state==='failed')process.exitCode=1;
  }catch(error){process.stderr.write(cleanError(error)+'\n');process.exitCode=1;}
}
