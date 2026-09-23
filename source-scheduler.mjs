import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {latestSourceDue,nextSourceDue} from './source-schedule.mjs';
export function startSourceScheduler({dataRoot,script,enabled=false}){
 if(!enabled)return {stop(){}};
 const statePath=join(dataRoot,'source-refresh','scheduler.json');let stopped=false,busy=false,child=null;
 const tick=async()=>{
  if(stopped||busy)return;busy=true;
  try{
   let state={};try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   for(const mode of ['organization','spark']){
    if(stopped)break;
    const now=new Date(),due=latestSourceDue(mode,now).toISOString(),prior=state[mode];
    if(prior?.completedSlot===due||prior?.retryAfter&&Date.parse(prior.retryAfter)>now.getTime())continue;
    // A child has a bounded lifetime, so a stalled source cannot freeze the hub.
    await mkdir(join(dataRoot,'source-refresh'),{recursive:true});
    const code=await new Promise(resolve=>{
     child=spawn('flock',['--no-fork','--nonblock',join(dataRoot,'source-refresh',mode+'.kernel-lock'),process.execPath,script,mode],{stdio:['ignore','ignore','ignore'],env:{...process.env,SOURCE_REFRESH_LOCK_HELD:'1'}});
     const deadline=setTimeout(()=>child?.kill('SIGTERM'),20*60*1000);
     child.once('error',()=>{clearTimeout(deadline);resolve(-1)});
     child.once('exit',c=>{clearTimeout(deadline);resolve(c??-1)});
    });child=null;
    state[mode]={lastAttemptAt:now.toISOString(),finishedAt:new Date().toISOString(),exitCode:code,
     completedSlot:code===0?due:prior?.completedSlot||null,retryAfter:code===0?null:new Date(Date.now()+10*60000).toISOString(),nextDueAt:nextSourceDue(mode).toISOString()};
    await mkdir(join(dataRoot,'source-refresh'),{recursive:true});await writeFile(statePath+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(statePath+'.tmp',statePath);
   }
  }catch{console.error('Source scheduler pending; previous data retained');}finally{busy=false;}
 };
 const timer=setInterval(()=>void tick(),30000);timer.unref();void tick();
 return {stop(){stopped=true;clearInterval(timer);child?.kill('SIGTERM');}};
}
