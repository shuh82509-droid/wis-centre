import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIntelligenceHandler} from './daily-intelligence-http.mjs';
import {materialDownload} from './daily-intelligence-download.mjs';

const readSession={status:200,payload:{user:{number:'test-user'},workspace:{home:'department'},permissions:{}}};
const writeSession={status:200,payload:{user:{number:'test-maintainer'},workspace:{home:'department'},permissions:{manage_permissions:true}}};

function harness({session=readSession,env={},fetchImpl=()=>{throw Error('unexpected fetch');}}={}) {
  const calls=[];
  const handler=createIntelligenceHandler({sessionFor:async()=>session,sendJson:(_res,status,body)=>calls.push({status,body}),env,fetchImpl});
  const request=(pathname,{method='GET',headers={}}={})=>handler({method,headers},{},new URL(pathname,'https://hub.example'));
  return {calls,request};
}

test('only daily-intelligence routes are intercepted',async()=>{
  const {calls,request}=harness();
  assert.equal(await request('/api/other'),false);
  assert.deepEqual(calls,[]);
});

test('session and department permission fail closed before proxying',async()=>{
  const unauthenticated=harness({session:{status:401,payload:{detail:'login required'}}});
  assert.equal(await unauthenticated.request('/api/daily-intelligence'),true);
  assert.equal(unauthenticated.calls[0].status,401);

  const outsider=harness({session:{status:200,payload:{user:{number:'outsider'},workspace:{home:'personal'},permissions:{}}}});
  assert.equal(await outsider.request('/api/daily-intelligence'),true);
  assert.equal(outsider.calls[0].status,403);
});

test('missing worker configuration reports unavailable rather than a synthetic empty report',async()=>{
  const {calls,request}=harness();
  assert.equal(await request('/api/daily-intelligence'),true);
  assert.equal(calls[0].status,503);
});

test('configured read proxies only the report and marks manual testing disabled',async(t)=>{
  const root=mkdtempSync(join(tmpdir(),'wis-intelligence-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tokenFile=join(root,'token');
  writeFileSync(tokenFile,'fixture-only-token');
  const urls=[];
  const {calls,request}=harness({
    env:{DAILY_INTELLIGENCE_URL:'http://worker.internal/',INTELLIGENCE_INTERNAL_TOKEN_FILE:tokenFile},
    fetchImpl:async(url,options)=>{urls.push({url:String(url),method:options.method,redirect:options.redirect});return new Response(JSON.stringify({report:{state:'ready'}}),{status:200,headers:{'content-type':'application/json'}});}
  });
  assert.equal(await request('/api/daily-intelligence'),true);
  assert.deepEqual(urls,[{url:'http://worker.internal/report',method:'GET',redirect:'error'}]);
  assert.equal(calls[0].status,200);
  assert.equal(calls[0].body.manualTestEnabled,false);
  assert.equal(calls[0].body.report.state,'ready');
});

test('manual run requires maintainer, request marker and explicit switch',async()=>{
  const reader=harness();
  await reader.request('/api/daily-intelligence/run',{method:'POST',headers:{'x-intelligence-request':'1'}});
  assert.equal(reader.calls[0].status,403);

  const maintainer=harness({session:writeSession,env:{INTELLIGENCE_MANUAL_TEST_ENABLED:'false'}});
  await maintainer.request('/api/daily-intelligence/run',{method:'POST'});
  assert.equal(maintainer.calls[0].status,403);
  await maintainer.request('/api/daily-intelligence/run',{method:'POST',headers:{'x-intelligence-request':'1'}});
  assert.equal(maintainer.calls[1].status,403);
  await maintainer.request('/api/daily-intelligence/run',{method:'POST',headers:{'x-intelligence-request':'1','sec-fetch-site':'cross-site'}});
  assert.equal(maintainer.calls[2].status,403);
});

test('explicitly enabled maintainer run uses the worker once and never follows redirects',async(t)=>{
  const root=mkdtempSync(join(tmpdir(),'wis-intelligence-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tokenFile=join(root,'token');
  writeFileSync(tokenFile,'fixture-only-token');
  const callsToWorker=[];
  const {calls,request}=harness({
    session:writeSession,
    env:{DAILY_INTELLIGENCE_URL:'http://worker.internal/',INTELLIGENCE_INTERNAL_TOKEN_FILE:tokenFile,INTELLIGENCE_MANUAL_TEST_ENABLED:'true'},
    fetchImpl:async(url,options)=>{callsToWorker.push({url:String(url),method:options.method,redirect:options.redirect});return new Response(JSON.stringify({state:'queued'}),{status:200,headers:{'content-type':'application/json'}});}
  });
  assert.equal(await request('/api/daily-intelligence/run',{method:'POST',headers:{'x-intelligence-request':'1','sec-fetch-site':'same-origin'}}),true);
  assert.deepEqual(callsToWorker,[{url:'http://worker.internal/run',method:'POST',redirect:'error'}]);
  assert.deepEqual(calls,[{status:200,body:{state:'queued'}}]);
});

test('material download only uses a persisted same-origin video path',()=>{
  const store={get:()=>({materials:{items:[{id:'one',platform:'douyin',title:'fixture',downloadUrl:'https://video.example/api/video/download/one'}]}})};
  const params=new URLSearchParams('report=r&id=one&platform=douyin&url=https://evil.example/video');
  assert.equal(materialDownload(store,params,'https://video.example').url.href,'https://video.example/api/video/download/one');
  assert.throws(()=>materialDownload(store,params,'https://other.example'),/素材下载来源无效/);
});
