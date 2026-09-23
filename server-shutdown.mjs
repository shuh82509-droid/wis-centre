import {writeSync} from 'node:fs';

// Tracks accepted work only. Shutdown never starts another notification flush,
// changes persisted leases, removes a task lock, or retries a business request.
export function createGracefulShutdown({timeoutMs=240000,processLike=process,log=value=>writeSync(2,JSON.stringify(value)+'\n')}={}) {
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TypeError('A finite positive shutdown deadline is required');
  const requests=new Set(),background=new Map(),sockets=new Map(),stoppers=new Set();
  let server=null,draining=false,serverClosed=false,finished=false,deadline=null,signalsInstalled=false,closeFailed=false;
  const report=value=>{try{log(value);}catch{/* A broken log pipe must not skip draining saved work. */}};
  const summary=()=>({requests:requests.size,background:[...background.values()]});
  function end(code,reason){if(finished)return;finished=true;clearTimeout(deadline);report({event:'hub_shutdown',phase:code===0?'drained':'incomplete',reason,...summary()});processLike.exit(code);}
  function check(){if(draining&&serverClosed&&!requests.size&&!background.size)end(closeFailed?1:0,closeFailed?'listener_close_failed':'all_accepted_work_finished');}
  function closeIdle(){for(const [socket,count]of sockets)if(count===0)socket.end();}
  function requestDone(entry){if(!entry.handlerDone||!entry.responseDone||!requests.delete(entry))return;entry.response.off('finish',entry.onResponseDone);entry.response.off('close',entry.onResponseDone);entry.response.off('error',entry.onResponseDone);if(sockets.has(entry.socket))sockets.set(entry.socket,Math.max(0,sockets.get(entry.socket)-1));if(draining)closeIdle();check();}
  function wrapHandler(handler){return function(request,response){
    const entry={response,socket:request.socket,handlerDone:false,responseDone:false};
    entry.onResponseDone=()=>{entry.responseDone=true;requestDone(entry);};requests.add(entry);sockets.set(entry.socket,(sockets.get(entry.socket)||0)+1);
    response.once('finish',entry.onResponseDone);response.once('close',entry.onResponseDone);response.once('error',entry.onResponseDone);
    if(draining){response.statusCode=503;response.setHeader('Connection','close');response.setHeader('Retry-After','5');response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify({detail:'服务正在更新，请稍后核对原任务；不要重新上传或重复发起。'}));entry.handlerDone=true;if(response.writableFinished||response.destroyed)entry.responseDone=true;requestDone(entry);return;}
    let work;try{work=handler(request,response);}catch(error){work=Promise.reject(error);}
    return Promise.resolve(work).catch(error=>{
      report({event:'hub_request_failure',error:error?.name||'Error'});
      if(!response.headersSent&&!response.destroyed){response.statusCode=503;response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify({detail:'请求暂未完成，请刷新核对原任务与交付。'}));}
      else if(!response.destroyed)response.end();
    }).finally(()=>{entry.handlerDone=true;if(response.writableFinished||response.destroyed)entry.responseDone=true;requestDone(entry);});
  };}
  function trackBackground(label,operation){
    if(draining)return Promise.resolve(undefined);
    const key={};background.set(key,label);
    const work=Promise.resolve().then(()=>draining?undefined:operation());
    const settled=()=>{background.delete(key);check();};work.then(settled,settled);
    return work;
  }
  function attachServer(value){
    if(server)throw new Error('The shutdown controller already has an HTTP server');server=value;
    server.on('connection',socket=>{sockets.set(socket,0);socket.once('close',()=>{sockets.delete(socket);check();});if(draining)socket.destroy();});
  }
  function stop(signal='shutdown'){
    if(draining)return;draining=true;report({event:'hub_shutdown',phase:'draining',signal,...summary()});
    // Keep the deadline referenced: an incomplete asynchronous operation alone
    // may have no active event-loop handle, but must not produce a false exit 0.
    deadline=setTimeout(()=>end(1,'deadline_exceeded'),timeoutMs);
    for(const stopper of stoppers){try{stopper();}catch{closeFailed=true;report({event:'hub_shutdown',phase:'stopper_failed'});}}
    // Preserve accepted response flags: changing keep-alive after headers were
    // sent would discard an already queued 503 response on a pipelined socket.
    // closeIdle() closes it after the tracked responses have completed.
    if(server){try{server.close(error=>{if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')closeFailed=true;serverClosed=true;check();});}catch(error){closeFailed=true;report({event:'hub_shutdown',phase:'listener_close_failed',error:error?.name||'Error'});}}
    else serverClosed=true;
    closeIdle();check();
  }
  function installSignals(){if(signalsInstalled)return;signalsInstalled=true;processLike.on('SIGTERM',()=>stop('SIGTERM'));processLike.on('SIGINT',()=>stop('SIGINT'));}
  return {get draining(){return draining;},wrapHandler,trackBackground,attachServer,installSignals,stop,onStop:callback=>stoppers.add(callback)};
}

// FlowSources.refresh() starts a read-only worker and returns immediately. Its
// real completion is the worker exit, not the promise returned by refresh().
export function waitForWorkerExit(worker){
  if(!worker||worker.threadId===-1)return Promise.resolve();
  return new Promise(resolve=>{worker.once('exit',resolve);if(worker.threadId===-1){worker.off('exit',resolve);resolve();}});
}
