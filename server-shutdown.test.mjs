// Private subprocesses, temporary fixture stores and loopback HTTP only.
// Windows cannot deliver catchable POSIX signals to Node: those subprocesses
// exercise the installed handlers via IPC; Linux delivers actual OS signals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {request} from 'node:http';
import {connect} from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowFeishu} from './flow-feishu.mjs';

const helperUrl=new URL('./server-shutdown.mjs',import.meta.url).href;
const storeUrl=new URL('./workflow-store.mjs',import.meta.url).href;
const notifyUrl=new URL('./flow-feishu.mjs',import.meta.url).href;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const signalMode=process.platform==='win32'?'Windows IPC signal-handler exercise':'POSIX signal';
const childProgram=`
import {createServer} from 'node:http';
import {Worker} from 'node:worker_threads';
import {createGracefulShutdown,waitForWorkerExit} from ${JSON.stringify(helperUrl)};
import {WorkflowStore} from ${JSON.stringify(storeUrl)};
import {FlowFeishu} from ${JSON.stringify(notifyUrl)};
const dir=process.env.FIXTURE_DIR,mode=process.env.FIXTURE_MODE;
const store=new WorkflowStore(dir+'/task.json');
store.transaction(s=>{s.tasks=[{id:'task_fixture',version:1,title:'isolated task',workflow:'02',status:'in_progress',runtime:{state:'running',manager:{number:'M'},participants:['A','M'],nodes:[{id:'node_fixture',owner:{number:'A'},state:'ready',attempt:1}]}}];s.fixture={writes:0,late:0,ticks:0,noticeCalls:0,uuids:[]};s.flowNotifications=mode.startsWith('notification')?[{id:'notice_fixture',taskId:'task_fixture',nodeId:'node_fixture',kind:'ready',recipient:'A',attempt:1,state:'ready',attempts:0,nextAt:0,createdAt:new Date().toISOString(),messageId:null}]:[];return true;});
const control=createGracefulShutdown({timeoutMs:Number(process.env.FIXTURE_DEADLINE||4000)});
let releaseWork,releaseNotice,worker;
const heldWork=new Promise(resolve=>releaseWork=resolve),heldNotice=new Promise(resolve=>releaseNotice=resolve);
const mark=kind=>process.send?.({kind});
const server=createServer(control.wrapHandler(async(req,res)=>{
 if(req.url==='/late'){store.transaction(s=>{s.fixture.late++;return true;});res.end('must-not-enter-after-signal');return;}
 if(req.url==='/early'){res.end('accepted');mark('work-started');await heldWork;store.transaction(s=>{s.fixture.writes++;s.tasks[0].version++;return true;});return;}
 if(req.url==='/detached-stream'){res.write('head-');mark('work-started');void heldWork.then(()=>res.end('tail'));return;}
 if(req.url==='/pipeline')res.write('head-');
 mark('work-started');await heldWork;
 store.transaction(s=>{s.fixture.writes++;s.tasks[0].version++;return true;});res.end('saved');
}));
control.attachServer(server);control.installSignals();control.installSignals();
if(mode==='timer'){
 const timer=setInterval(()=>void control.trackBackground('periodic-fixture',()=>{store.transaction(s=>{s.fixture.ticks++;return true;});}),8);
 control.onStop(()=>{clearInterval(timer);store.transaction(s=>{s.fixture.ticksAtShutdown=s.fixture.ticks;return true;});mark('timer-stopped');});
}
process.on('message',message=>{
 if(message.kind==='signal')process.emit(message.signal);
 if(message.kind==='release-work')releaseWork();
 if(message.kind==='release-notice')releaseNotice();
 if(message.kind==='release-worker')worker?.postMessage('finish');
 if(message.kind==='start-notice'){
  const notifier=new FlowFeishu(store,{people:()=>[{number:'A',name:'isolated owner',active:true}],env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',FEISHU_RECIPIENT_MAP_JSON:'{"A":"ou_fixture"}'},fetchImpl:async(url,init)=>{
   if(url.includes('/auth/'))return {ok:true,status:200,json:async()=>({code:0,tenant_access_token:'fixture'})};
   store.transaction(s=>{s.fixture.noticeCalls++;s.fixture.uuids.push(JSON.parse(init.body).uuid);return true;});mark('notice-started');await heldNotice;
   return {ok:true,status:200,json:async()=>({code:0,data:{message_id:'om_fixture_receipt'}})};
  }});
  void control.trackBackground('notification-receipt',()=>notifier.flush());
 }
 if(message.kind==='start-worker'){
  worker=new Worker(\"const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>process.exit(0));parentPort.postMessage('ready');\",{eval:true,execArgv:[]});
  void control.trackBackground('source-worker',()=>waitForWorkerExit(worker));worker.once('message',()=>mark('worker-started'));
 }
});
server.listen(0,'127.0.0.1',()=>process.send?.({kind:'ready',port:server.address().port}));
`;

async function fixture(t,{mode='write',deadline=4000}={}){
 const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'hub-shutdown-test-'));
 const child=spawn(process.execPath,['--input-type=module','-e',childProgram],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{FIXTURE_DIR:dir,FIXTURE_MODE:mode,FIXTURE_DEADLINE:String(deadline),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot}: {})}});
 let stderr='',stdout='';const messages=[];child.stderr.on('data',x=>stderr+=x);child.stdout.on('data',x=>stdout+=x);child.on('message',m=>messages.push(m));
 const exited=new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolveExit({code,signal}));});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}assert.ok(resolve(dir).startsWith(base+sep));assert.equal(resolve(dir).split(sep).at(-1).startsWith('hub-shutdown-test-'),true);rmSync(dir,{recursive:true,force:true});});
 async function message(kind){const until=Date.now()+5000;while(Date.now()<until){const value=messages.find(m=>m.kind===kind);if(value)return value;if(child.exitCode!==null||child.signalCode)throw Error('Child ended before '+kind+': '+stderr+stdout);await sleep(5);}throw Error('Child message timeout '+kind+': '+stderr);}
 const ready=await message('ready');
 async function signal(name='SIGTERM'){if(process.platform==='win32')child.send({kind:'signal',signal:name});else child.kill(name);const until=Date.now()+3000;while(!stderr.includes('"phase":"draining"')&&Date.now()<until)await sleep(5);assert.ok(stderr.includes('"phase":"draining"'),stderr);}
 async function finish(){let timer;try{const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Child failed to exit: '+stderr)),6000);})]);return {...result,stderr,stdout};}finally{clearTimeout(timer);}}
 const read=()=>JSON.parse(readFileSync(join(dir,'task.json'),'utf8'));
 return {child,dir,port:ready.port,message,signal,finish,read,get stderr(){return stderr;},send:kind=>child.send({kind})};
}
function http(port,path){let req;const completed=new Promise((resolveResponse,reject)=>{req=request({host:'127.0.0.1',port,path,method:'POST',agent:false},res=>{let body='';res.on('data',chunk=>body+=chunk);res.once('end',()=>resolveResponse({status:res.statusCode,body}));res.once('error',reject);});req.once('error',reject);req.end();});return {req,completed};}

for(const name of ['SIGTERM','SIGINT'])test('空闲服务显式退出 0 · '+name+' · '+signalMode,{timeout:10000},async t=>{const f=await fixture(t);await f.signal(name);const exit=await f.finish();assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.ok(exit.stderr.includes('"phase":"drained"'));assert.equal(f.read().tasks[0].version,1);});

test('信号等待在途交付写入和完整响应，重复信号不提前退出或重复保存',{timeout:10000},async t=>{const f=await fixture(t),r=http(f.port,'/write');await f.message('work-started');await f.signal();await f.signal('SIGINT');await sleep(30);assert.equal(f.child.exitCode,null);assert.equal(f.read().fixture.writes,0);f.send('release-work');assert.deepEqual(await r.completed,{status:200,body:'saved'});const exit=await f.finish();assert.equal(exit.code,0);assert.equal(f.read().fixture.writes,1);assert.equal(f.read().tasks[0].version,2);assert.equal(exit.stderr.match(/"phase":"draining"/g).length,1);});

test('客户端断开不等于业务处理结束，仍等待原 handler 保存结果',{timeout:10000},async t=>{const f=await fixture(t),r=http(f.port,'/write');const disconnected=r.completed.catch(e=>e);await f.message('work-started');r.req.destroy();await disconnected;await f.signal();await sleep(30);assert.equal(f.child.exitCode,null);f.send('release-work');const exit=await f.finish();assert.equal(exit.code,0);assert.equal(f.read().fixture.writes,1);});

test('已发送 HTTP 回复仍等待 handler 后续保存，不以 socket 关闭冒称工作完成',{timeout:10000},async t=>{const f=await fixture(t),r=http(f.port,'/early');await f.message('work-started');assert.equal((await r.completed).body,'accepted');await f.signal();await sleep(25);assert.equal(f.child.exitCode,null);assert.equal(f.read().fixture.writes,0);f.send('release-work');assert.equal((await f.finish()).code,0);assert.equal(f.read().fixture.writes,1);});

test('handler 已返回但附件响应仍在传输时，等待完整响应流结束',{timeout:10000},async t=>{const f=await fixture(t),r=http(f.port,'/detached-stream');await f.message('work-started');await f.signal();await sleep(25);assert.equal(f.child.exitCode,null);f.send('release-work');assert.equal((await r.completed).body,'head-tail');assert.equal((await f.finish()).code,0);});

test('既有连接的后续请求返回 503，不能进入新业务办理',{timeout:10000},async t=>{const f=await fixture(t),socket=connect(f.port,'127.0.0.1');let wire='';socket.setEncoding('utf8');socket.on('data',chunk=>wire+=chunk);socket.on('error',()=>{});await once(socket,'connect');socket.write('POST /pipeline HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n');await f.message('work-started');await f.signal();socket.write('POST /late HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n');await sleep(25);f.send('release-work');const exit=await f.finish();socket.destroy();assert.equal(exit.code,0);assert.equal(f.read().fixture.late,0);assert.ok(wire.includes('503 Service Unavailable'),wire);assert.equal(f.read().fixture.writes,1);});

test('停止新增后台轮询，退出期间原工作仍可完成',{timeout:10000},async t=>{const f=await fixture(t,{mode:'timer'}),r=http(f.port,'/write');await f.message('work-started');await sleep(25);await f.signal();await f.message('timer-stopped');const ticks=f.read().fixture.ticksAtShutdown;await sleep(50);assert.equal(f.read().fixture.ticks,ticks);f.send('release-work');await r.completed;assert.equal((await f.finish()).code,0);assert.equal(f.read().fixture.ticks,ticks);});

test('只读来源 worker 的真实 exit 被等待，refresh 返回不是完成依据',{timeout:10000},async t=>{const f=await fixture(t);f.send('start-worker');await f.message('worker-started');await f.signal();await sleep(25);assert.equal(f.child.exitCode,null);f.send('release-worker');const exit=await f.finish();assert.equal(exit.code,0);assert.ok(exit.stderr.includes('source-worker'));});

test('在途通知先保存同一消息回执，再正常退出，不额外启动一次 flush',{timeout:10000},async t=>{const f=await fixture(t,{mode:'notification'});f.send('start-notice');await f.message('notice-started');const before=f.read().flowNotifications[0];assert.equal(before.state,'sending');await f.signal();await sleep(25);assert.equal(f.child.exitCode,null);f.send('release-notice');assert.equal((await f.finish()).code,0);const saved=f.read();assert.equal(saved.flowNotifications[0].id,before.id);assert.equal(saved.flowNotifications[0].messageId,'om_fixture_receipt');assert.equal(saved.flowNotifications[0].state,'sent');assert.equal(saved.flowNotifications[0].leaseId,undefined);assert.equal(saved.fixture.noticeCalls,1);});

test('超时退出 1，原任务和发送中 lease 保留，恢复仍使用原平台幂等编号',{timeout:10000},async t=>{const f=await fixture(t,{mode:'notification-timeout',deadline:120});f.send('start-notice');await f.message('notice-started');const before=f.read();await f.signal();const exit=await f.finish();assert.equal(exit.code,1);assert.equal(exit.signal,null);assert.ok(exit.stderr.includes('"phase":"incomplete"'));assert.ok(exit.stderr.includes('deadline_exceeded'));const saved=f.read();assert.deepEqual(saved,before);assert.equal(saved.flowNotifications[0].state,'sending');const store=new WorkflowStore(join(f.dir,'task.json'));let sent=0;const clock=()=>saved.flowNotifications[0].leaseUntil+1;const notifier=new FlowFeishu(store,{clock,people:()=>[{number:'A',active:true,name:'isolated owner'}],env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',FEISHU_RECIPIENT_MAP_JSON:'{"A":"ou_fixture"}'},fetchImpl:async(url,init)=>{if(url.includes('/auth/'))return {ok:true,json:async()=>({code:0,tenant_access_token:'fixture'})};sent++;assert.equal(JSON.parse(init.body).uuid,saved.fixture.uuids[0]);return {ok:true,status:200,json:async()=>({code:0,data:{message_id:'om_recovered'}})};}});await notifier.flush();await notifier.flush();assert.equal(sent,1);assert.equal(store.read().flowNotifications[0].id,saved.flowNotifications[0].id);assert.equal(store.read().flowNotifications[0].state,'sent');});

test('实际 server.mjs 无业务挂载与外部授权也能显式 SIGTERM 退出 0',{skip:process.platform==='win32'?'Windows does not deliver catchable POSIX signals; subprocess handler cases run above':false,timeout:10000},async t=>{
 const root=resolve(tmpdir()),dir=mkdtempSync(join(root,'hub-server-exit-test-'));let text='';
 const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PORT:'0',BIND_ADDRESS:'127.0.0.1',DATA_DIR:dir,FLOW_SOURCE_SNAPSHOT:join(dir,'unconnected.json'),WORKFLOW_WRITES_ENABLED:'false',FLOW_NOTIFICATIONS_ENABLED:'false',WORKFLOW_AI_ENABLED:'false',CENTRAL_AUTHORITY_BASE:'http://127.0.0.1:1',ROOT_DASHBOARD_API_BASE:'http://127.0.0.1:1',LIBTV_API_BASE:'http://127.0.0.1:1'}});
 child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>text+=x);const exited=once(child,'exit');t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}assert.ok(resolve(dir).startsWith(root+sep));assert.ok(resolve(dir).split(sep).at(-1).startsWith('hub-server-exit-test-'));rmSync(dir,{recursive:true,force:true});});
 const deadline=Date.now()+5000;while(!text.includes('wis-marketing-hub listening on 0')&&Date.now()<deadline&&child.exitCode===null)await sleep(10);assert.ok(text.includes('wis-marketing-hub listening on 0'),text);child.kill('SIGTERM');const [code,signal]=await exited;assert.equal(code,0,text);assert.equal(signal,null);assert.ok(text.includes('"phase":"drained"'),text);
});
