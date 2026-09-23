// Dedicated process: no network, read-only source mounts, no application credentials.
// Only this explicit field projection is shared with the OA-scoped hub API.
import {mkdirSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCloudReader,readRemix} from './flow-sources.mjs';

export function createSourceExporter({
 output=process.env.FLOW_EXPORT_FILE||'/exports/flow-snapshot.json',
 cloudPath=process.env.FLOW_CLOUD_DB,
 remixPath=process.env.FLOW_REMIX_LIBRARY,
 retryDelaysMs=[250,500,1000,2000],
 wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}={}){
 mkdirSync(dirname(output),{recursive:true,mode:0o755});
 const cloudReader=cloudPath?createCloudReader(cloudPath):null;
 let running=null,stopped=false;
 async function readCloudWithRetry(){
  if(!cloudReader||!existsSync(cloudPath))return {state:'not_connected',error:'根数据源未接入'};
  for(let attempt=0;;attempt++){
   if(stopped)return {state:'unavailable',error:'读取已停止'};
   try{return cloudReader.read();}
   catch(error){
    // Retry only transient file/busy/readonly errors. Failed reads already
    // rollback and close before this wait; no transaction spans the delay.
    const code=Number(error.errcode)&255;
    const transient=[5,6,8,10,14].includes(code)||['ENOENT','EACCES','EBUSY'].includes(error.code);
    if(!transient||attempt>=retryDelaysMs.length)return {state:'unavailable',error:'根记录暂不可用，等待下一周期核验'};
    await wait(retryDelaysMs[attempt]);
   }
  }
 }
 async function perform(){
  const cloud=await readCloudWithRetry();
  if(stopped)return null;
  let remix;
  try{remix=remixPath&&existsSync(remixPath)?readRemix(remixPath):{state:'not_connected',error:'根数据源未接入'};}
  catch{remix={state:'unavailable',error:'读取尚未完成，将在下一周期重试'};}
  const data={schemaVersion:1,exportedAt:new Date().toISOString(),cloud,remix};
  const temp=output+'.tmp';
  writeFileSync(temp,JSON.stringify(data),{mode:0o644});
  renameSync(temp,output);
  return data;
 }
 function refresh(){
  if(stopped)return Promise.resolve(null);
  if(running)return running;
  running=perform().finally(()=>{running=null;});
  return running;
 }
 async function close(){stopped=true;try{await running;}finally{cloudReader?.close();}}
 return {refresh,close};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const exporter=createSourceExporter();
 const refresh=()=>exporter.refresh().catch(()=>{console.error('流程根记录快照写入失败，将在下一周期重试');});
 void refresh();
 const timer=setInterval(refresh,30000);
 let closing=false;
 const shutdown=async()=>{if(closing)return;closing=true;clearInterval(timer);await exporter.close();};
 process.once('SIGTERM',()=>void shutdown());
 process.once('SIGINT',()=>void shutdown());
}
