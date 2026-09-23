// Isolated browser + local runtime. This is not an OA login or colleague acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {WorkflowStore} from '../workflow-store.mjs';
import {FlowRuntime} from '../flow-runtime.mjs';
import {FlowBlueprints} from '../flow-blueprints.mjs';
import {FlowDelivery} from '../flow-delivery.mjs';
import {FlowEvidence} from '../flow-evidence.mjs';
import {createFlowHandler} from '../flow-http.mjs';
import {modules} from '../flow-catalog.mjs';
const require=createRequire('C:/Users/202606/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const root=resolve(tmpdir()),temp=mkdtempSync(join(root,'wis-flow-browser-isolated-'));
const out=new URL('../qa-browser/',import.meta.url);mkdirSync(out,{recursive:true});
const people=[{number:'ISOLATED-M',name:'隔离验收主管',center:'本地测试中心',role:'director'},{number:'ISOLATED-A',name:'隔离搜索同事',center:'本地测试中心',role:'specialist'}].map(p=>({...p,active:true,modules:Object.values(modules).filter(Boolean)}));
const access={enabled:true,canManage:true,department:true,user:people[0],modules:people[0].modules};
const store=new WorkflowStore(join(temp,'store.json')),runtime=new FlowRuntime(store,{people:()=>people,canNotify:()=>true});
const blueprints=new FlowBlueprints(runtime);runtime.blueprints=blueprints;
const sources={data:{cloud:{state:'connected'}},people:()=>people,view:()=>({sources:[{id:'cloud',name:'本地隔离素材桩',state:'connected'}],inventory:[],jobs:[],renders:[]})};
const readCloud=async()=>({status:200,payload:{categories:[{name:'晶润紧致眼膜'}]}});
const delivery=new FlowDelivery({runtime,root:join(temp,'attachments'),readCloud});
const notifier={status:()=>({enabled:false,configured:false,mapped:2,total:2}),recipient:()=>true};
const handler=createFlowHandler({runtime,blueprints,delivery,sources,notifier,evidenceReader:new FlowEvidence({sources,readCloud}),currentSession:async()=>({status:200,payload:{isolated:true}}),accessFor:()=>access,previewFor:()=>({active:false}),readJson:async req=>{const chunks=[];for await(const b of req)chunks.push(b);return JSON.parse(Buffer.concat(chunks));},sendJson:(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}});
const base='/fd-026222/wis-marketing-hub/',candidate=base+'l2-candidate/';
const requests=[],errors=[],checks=[];let browser;
const server=createServer(async(req,res)=>{try{requests.push({method:req.method,path:req.url});const url=new URL(req.url,'http://127.0.0.1');if(url.pathname.startsWith(candidate+'api/flows/')){url.pathname=url.pathname.slice((base+'l2-candidate').length);await handler(req,res,url);return;}if(url.pathname==='/fd-026222/wis-video-center/api/facets'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({categories:[{name:'晶润紧致眼膜'}]}));return;}if(url.pathname===candidate){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(readFileSync(new URL('index.html',import.meta.url)));return;}res.writeHead(404);res.end('isolated fixture has no external routes');}catch(e){errors.push('local server: '+e.stack);res.writeHead(500);res.end('isolated failure');}});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(origin+candidate);await page.locator('.swimlane-stage').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'双品自动化',exact:true}).count(),0);
 await page.locator('path.canvas-edge').first().waitFor({state:'attached'});assert.ok(await page.locator('path.canvas-edge').count()>0);
 for(const width of [1440,1000,720,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);const layout=await page.locator('[data-flow-canvas]').first().evaluate(el=>({width:el.getBoundingClientRect().width,viewport:innerWidth,percent:Number(el.querySelector('output').textContent.replace('%','')),paths:[...el.querySelectorAll('path.canvas-edge')].every(p=>!p.getAttribute('d').includes('NaN')),overflow:document.documentElement.scrollWidth>innerWidth+1}));assert.ok(layout.width<=width);assert.equal(layout.overflow,false);assert.ok(layout.percent>=75);assert.ok(layout.paths);checks.push({name:'responsive canvas',width,...layout});await page.screenshot({path:fileURLToPath(new URL('layout-'+width+'.png',out)),fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'放大泳道',exact:true}).click();await page.getByRole('button',{name:'适应窗口',exact:true}).click();
 await page.locator('[data-canvas-flow="00"]').click();await page.locator('.swimlane-stage').first().click();await page.locator('#drawer .node-head').first().click();assert.ok(await page.locator('#drawer .node-detail').count());await page.getByRole('button',{name:'关闭详情',exact:true}).click();checks.push({name:'swimlane stage opens actual execution nodes in drawer',passed:true});
 await page.getByRole('button',{name:'＋ 发起工作流',exact:true}).click();
 assert.equal(await page.locator('#create-back').isVisible(),false);
 await page.locator('select[name=workflow]').selectOption('02');await page.locator('[name=product]').fill('晶润紧致眼膜');await page.locator('[name=title]').fill('隔离浏览器验收：视频中心交付');await page.locator('[name=acceptance]').fill('上传本地测试文件，退回后再次交付，审核和下游确认。');
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 const picker=page.locator('[name=owner]').locator('..').locator('.person-search');await picker.fill('ISOLATED-A');await page.getByRole('option',{name:/隔离搜索同事/}).click();assert.equal(await page.locator('[name=owner]').inputValue(),'ISOLATED-A');await picker.fill('主管');await page.getByRole('option',{name:/隔离验收主管/}).click();
 const receiver=page.locator('[name=receiver]').locator('..').locator('.person-search');await receiver.fill('主管');await page.getByRole('option',{name:/隔离验收主管/}).click();
 await page.getByRole('button',{name:'下一步',exact:true}).click();await page.locator('.create-route li').first().waitFor();assert.equal(await page.locator('.create-route li').count(),3);
 await page.getByRole('button',{name:'发起工作',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});if(await page.locator('#drawer .node-head').first().getAttribute('aria-expanded')!=='true')await page.locator('#drawer .node-head').first().click();
 let task=store.read().tasks[0];assert.equal(task.sourceUrl,'');assert.equal(task.runtime.product,'晶润紧致眼膜');assert.equal(task.runtime.mode,'simple');checks.push({name:'all product optional source searchable people simple three steps',taskId:task.id,passed:true});
 const bytes=Buffer.from('本地隔离浏览器交付文件，不作为真实业务回执。\n','utf8');
 async function deliver(note){await page.locator('#drawer [data-action=complete]').click();await page.locator('#modal').waitFor({state:'visible'});await page.locator('#delivery-files').setInputFiles({name:'本地验收交付.txt',mimeType:'text/plain',buffer:bytes});await page.locator('#delivery-selected-list .delivery-item').waitFor();await page.locator('[name=note]').fill(note);await page.getByRole('button',{name:'保存交付并流转',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});}
 await deliver('本地隔离交付版本一');task=store.read().tasks[0];assert.equal(task.runtime.nodes[1].state,'ready');
 await page.locator('#drawer .node-head').nth(1).click();await page.locator('#drawer [data-action=return]').click();await page.locator('[name=note]').fill('隔离验收退回，补充交付说明。');await page.getByRole('button',{name:'保存操作',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
 task=store.read().tasks[0];assert.equal(task.runtime.nodes[0].attempt,2);await deliver('本地隔离交付版本二，已补充说明');
 async function confirmNode(index){const head=page.locator('#drawer .node-head').nth(index);if(await head.getAttribute('aria-expanded')!=='true')await head.click();await page.locator('#drawer [data-action=complete]').click();await page.locator('#modal').waitFor({state:'visible'});assert.equal(await page.locator('#delivery-files').count(),0);await page.locator('[name=note]').fill('本地隔离确认，字节与版本一致。');await page.getByRole('button',{name:'确认并继续流转',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});}
 await confirmNode(1);await confirmNode(2);task=store.read().tasks[0];assert.equal(task.runtime.state,'completed');assert.equal(task.runtime.attachments.length,2);assert.equal(task.runtime.nodes[0].history.length,1);checks.push({name:'file upload return resubmit review receive same task',taskId:task.id,sha256:createHash('sha256').update(bytes).digest('hex'),passed:true});
 await page.getByRole('button',{name:'关闭详情',exact:true}).click();await page.getByRole('button',{name:'流转记录',exact:true}).click();assert.ok(await page.locator('#content .event-record').count()<=8);assert.ok((await page.locator('#content .record-pagination').innerText()).includes('下一页'));checks.push({name:'history pagination',passed:true});
 await page.getByRole('button',{name:'流程编排',exact:true}).click();await page.locator('[data-drag-module="02"]').waitFor();assert.ok(await page.locator('[data-flow-canvas="studio-modules"] path.canvas-edge').count()>0);
 await page.locator('[data-module-move="02"][data-offset="-1"]').click();await page.getByRole('button',{name:'预览影响',exact:true}).click();await page.locator('.studio-impact').waitFor();
 await page.getByRole('button',{name:'发布并应用于新任务',exact:true}).click();await page.getByText('运行版本 v1',{exact:true}).waitFor();const active=blueprints.active(access);assert.ok(active.moduleOrder.indexOf('02')<active.moduleOrder.indexOf('01'));assert.equal(store.read().tasks[0].runtime.nodes.length,3);checks.push({name:'canvas reorder published into runtime configuration without changing old task',order:active.moduleOrder,passed:true});
 assert.equal(requests.filter(r=>r.path.startsWith(base+'api/flows/')).length,0,'candidate must never write production API');
 assert.deepEqual(errors,[]);writeFileSync(new URL('acceptance.json',out),JSON.stringify({boundary:'isolated browser fixture, no real OA/notifications/cloud',checks,errors,requests},null,2));
 console.log(JSON.stringify({checks:checks.length,errors,output:out.href}));
}catch(e){writeFileSync(new URL('failure.json',out),JSON.stringify({error:e.stack,errors,checks,requests},null,2));throw e;}
finally{await browser?.close();await new Promise(r=>server.close(r));assert.ok(resolve(temp).startsWith(root+sep));rmSync(temp,{recursive:true,force:true});}
