// Server-owned Feishu source intake. This is deliberately independent of a
// desktop, Codex session, or user browser cookie. It collects only the fixed
// allowlist and never promotes raw text into a reviewed finding or KPI.
import {open,readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SparkLibraryStore,importSparkBatch} from './spark-library.mjs';

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
async function organization(headers,run){
  const docs={reportingDirectory:'FWrQdnvzxooaN5xqzOmchTKDnqc',organization:'IE67d4MdKo2xpqxvClLcYeACn15'};
  const results={};
  for(const [key,id] of Object.entries(docs)){
    try{
      const page=await pages('/docx/v1/documents/'+id+'/blocks',headers,{pageSize:500,maxPages:12});
      results[key]={state:page.truncated?'partial':'ready',blockCount:page.items.length,rawSha256:sha(JSON.stringify(page.items))};
      await atomicJson(join(run.directory,key+'.json'),page.items);
    }catch(error){results[key]={state:'failed',error:cleanError(error)};}
  }
  try{
    const page=await pages('/bitable/v1/apps/HD6cbG8Tiae30Ts266bcoGMUnMd/tables/tblLfhIgmidjXyve/records',headers,{pageSize:200,maxPages:12});
    results.meetingEvidence={state:page.truncated?'partial':'ready',recordCount:page.items.length,rawSha256:sha(JSON.stringify(page.items))};
    await atomicJson(join(run.directory,'meeting-records.json'),page.items);
  }catch(error){results.meetingEvidence={state:'failed',error:cleanError(error)};}
  run.organization={results,note:'原始来源已在服务器留证；尚未转换为组织看板发布对象，原看板业务日期保持不变。'};
}
export async function refresh(mode){
  if(!['spark','organization'].includes(mode))throw new Error('Unsupported server refresh mode');
  await mkdir(root,{recursive:true,mode:0o700});
  const lockPath=join(root,mode+'.lock'),lock=await open(lockPath,'wx',0o600);
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
      if(mode==='spark')await spark(headers,run,config);else await organization(headers,run);
      run.state=mode==='spark'&&run.spark.coverage.failures.length===0&&run.spark.coverage.truncated===0?'success':
        mode==='organization'&&Object.values(run.organization.results).every(x=>x.state==='ready')?'sources_collected':'partial';
    }catch(error){run.state='failed';run.error=cleanError(error);}
    run.finishedAt=iso();
    await atomicJson(join(directory,'receipt.json'),run);
    await atomicJson(join(root,mode+'-latest.json'),{mode,state:run.state,at:run.finishedAt,businessDate:run.businessDate,receipt:join(directory,'receipt.json'),
      ...(mode==='spark'?{coverage:run.spark?.coverage,addedSources:run.spark?.receipt?.addedSources||0}:{results:run.organization?.results})});
    return run;
  }finally{await lock.close();await unlink(lockPath);}
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
