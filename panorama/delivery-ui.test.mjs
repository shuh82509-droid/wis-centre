// Narrow DOM and API fixtures only. No browser, real OA, cloud or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('delivery.js',import.meta.url),'utf8');
const options={attachments:[],fileUpload:{maxBytes:20971520,extensions:['txt','png']},cloud:{available:false,state:'not_requested',base:'/isolated/cloud',multipartPartSize:33554432,categories:[]}};
const node={id:'W02.SIMPLE.WORK',title:'办理交付',attempt:1,dependencies:[]};
const task={id:'task_isolated',workflow:'02',title:'隔离交付',version:1,runtime:{product:'晶润紧致眼膜',nodes:[node]}};
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const settled=()=>new Promise(resolve=>setImmediate(resolve));

class Element{
 constructor(){this.isConnected=true;this.hidden=false;this.disabled=false;this.innerHTML='';this.textContent='';this.dataset={};this.handlers=new Map();this.value='';}
 addEventListener(type,handler){this.handlers.set(type,handler);}
 querySelectorAll(){return [];}
 setAttribute(name,value){this[name]=value;}
 fire(type,target={}){return this.handlers.get(type)?.({target,preventDefault(){}});}
}
function fixture(handler,{onToast}={}){
 const elements=new Map(),modal={open:false,close(){this.open=false;}},titles=[],calls=[];let form,requestCounter=0;
 function showModal(title,_sub,body){
  if(form)form.isConnected=false;for(const el of elements.values())el.isConnected=false;
  elements.clear();form=new Element();elements.set('#edit-form',form);elements.set('[type="submit"]',new Element());
  for(const match of body.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const el=new Element();el.hidden=/\bhidden\b/.test(match[0]);el.disabled=/\bdisabled\b/.test(match[0]);elements.set('#'+match[1],el);}
  elements.set('#form-error',new Element());elements.set('[name=note]',new Element());
  form.querySelector=selector=>elements.get(selector)||null;
  modal.open=true;titles.push(title);
 }
 const context=vm.createContext({Map,Set,Promise,Error,URL,encodeURIComponent,setTimeout,clearTimeout,
  api:(path,params)=>{calls.push(path);return handler(path,params);},
  $:selector=>selector==='#modal'?modal:elements.get(selector)||null,showModal,esc:String,
  flowEvidenceUrl:()=>'/isolated/evidence',crypto:{randomUUID:()=>'isolated-ui-operation-'+(++requestCounter)},state:{},renderTask(){},refresh:async()=>{},toast(message){if(onToast)onToast(message);else throw Error('opening error must remain retryable in the form');}});
 vm.runInContext(source,context);
 return {context,modal,titles,calls,showModal,get form(){return form;},el:selector=>elements.get(selector),clickTab:tab=>form.fire('click',{closest:selector=>selector==='[data-delivery-tab]'?{dataset:{deliveryTab:tab}}:null})};
}

test('点击立即显示交付加载反馈，同一节点重复点击只读取一次且本地表单不请求云分类',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);
 const first=f.context.openDeliveryAction(task,node);assert.equal(f.titles[0],'正在加载交付');assert.equal(f.el('[type="submit"]').disabled,true);assert.equal(f.calls.length,1);
 await f.context.openDeliveryAction(task,node);assert.equal(f.calls.length,1);
 pending.resolve(structuredClone(options));await first;
 assert.deepEqual(f.titles,['正在加载交付','提交交付']);assert.equal(typeof f.form.onsubmit,'function');assert.equal(f.calls.length,1);assert.equal(f.el('#delivery-video-controls').disabled,true);
});

test('关闭或替换加载界面后迟到响应不重新打开交付弹窗',async()=>{
 for(const replace of [false,true]){
  const pending=deferred(),f=fixture(()=>pending.promise),opening=f.context.openDeliveryAction(task,node);
  if(replace)f.showModal('另一个事项','','');else f.modal.open=false;
  pending.resolve(structuredClone(options));await opening;
  assert.deepEqual(f.titles,replace?['正在加载交付','另一个事项']:['正在加载交付']);assert.equal(f.modal.open,replace);
 }
});

test('本地选项读取失败保留说明和可重试入口，重新点击仍只操作原任务',async()=>{
 let count=0;const f=fixture(()=>++count===1?Promise.reject(Error('isolated timeout')):Promise.resolve(structuredClone(options)));
 await f.context.openDeliveryAction(task,node);
 assert.equal(f.el('#form-error').textContent,'isolated timeout');assert.equal(f.el('#delivery-open-retry').hidden,false);
 f.el('#delivery-open-retry').onclick();await settled();
 assert.equal(f.titles.at(-1),'提交交付');assert.equal(f.calls.length,2);assert.equal(f.calls[0],f.calls[1]);
});

test('视频页才读取分类，同步点击去重，授权失败可重试且不禁用文件交付提交',async()=>{
 const first=deferred();let productReads=0;
 const f=fixture(path=>path==='products'?(++productReads===1?first.promise:Promise.resolve({state:'connected',items:[{value:'真实眼膜分类'}]})):Promise.resolve(structuredClone(options)));
 await f.context.openDeliveryAction(task,node);assert.equal(productReads,0);assert.equal(typeof f.form.onsubmit,'function');
 f.clickTab('video');f.clickTab('video');assert.equal(productReads,1);assert.match(f.el('#delivery-cloud-status').innerHTML,/正在读取/);
 first.resolve({state:'authorization_required',items:[{value:'不可冒充可用'}],detail:'isolated denied'});await settled();
 assert.equal(f.el('#delivery-video-controls').disabled,true);assert.equal(f.el('#delivery-cloud-retry').hidden,false);assert.equal(f.el('#delivery-categories').innerHTML,'');assert.equal(f.el('[type="submit"]').disabled,false);assert.match(f.el('#delivery-cloud-status').innerHTML,/isolated denied/);
 f.el('#delivery-cloud-retry').fire('click');await settled();
 assert.equal(productReads,2);assert.equal(f.el('#delivery-video-controls').disabled,false);assert.equal(f.el('#delivery-cloud-retry').hidden,true);assert.match(f.el('#delivery-categories').innerHTML,/真实眼膜分类/);
 f.clickTab('video');assert.equal(productReads,2);
});

test('关闭视频交付后迟到的云分类不会写入新的表单',async()=>{
 const pending=deferred(),f=fixture(path=>path==='products'?pending.promise:Promise.resolve(structuredClone(options)));
 await f.context.openDeliveryAction(task,node);f.clickTab('video');
 f.showModal('新的交付','','<div id="delivery-cloud-status"></div>');
 pending.resolve({state:'connected',items:[{value:'旧请求分类'}]});await settled();
 assert.equal(f.el('#delivery-cloud-status').innerHTML,'');assert.equal(f.titles.at(-1),'新的交付');
});

test('云素材查询与分类独立，重复点击合并，查询失败明确保留重试入口',async()=>{
 const pending=deferred();let searches=0;
 const f=fixture(path=>path.includes('/cloud-assets?')?(++searches===1?pending.promise:Promise.resolve({items:[]})):Promise.resolve(structuredClone(options)));
 await f.context.openDeliveryAction(task,node);f.clickTab('cloud');f.clickTab('cloud');assert.equal(searches,1);assert.equal(f.calls.includes('products'),false);
 pending.reject(Error('isolated asset directory unavailable'));await settled();
 assert.match(f.el('#delivery-cloud-results').innerHTML,/isolated asset directory unavailable/);assert.match(f.el('#delivery-cloud-results').innerHTML,/data-retry-cloud-search/);
 f.form.fire('click',{closest:selector=>selector==='[data-retry-cloud-search]'?{}:null});await settled();
 assert.equal(searches,2);assert.match(f.el('#delivery-cloud-results').innerHTML,/没有匹配的素材/);assert.equal(f.calls.includes('products'),false);
});

test('退回后历史附件默认不选，下载与明确重选分开；实际提交带原轮次而不请求上传',async()=>{
 const returnedNode={...node,attempt:2},returnedTask={...task,version:4,runtime:{...task.runtime,nodes:[returnedNode]}};
 const previous={attachmentId:'attachment_original',nodeId:node.id,filename:'原交付说明.txt',attempt:1,state:'ready',size:379,uploadedBy:{name:'原上传同事'}};
 const bodies=[],f=fixture((path,params)=>{
  if(path.endsWith('/complete')){bodies.push(params.body);return Promise.resolve({...returnedTask,version:5});}
  return Promise.resolve({...structuredClone(options),previousAttachments:[previous]});
 },{onToast(){}});
 await f.context.openDeliveryAction(returnedTask,returnedNode);
 assert.match(f.el('#delivery-existing').innerHTML,/以前轮次已保存的附件/);assert.match(f.el('#delivery-existing').innerHTML,/下载核对/);assert.match(f.el('#delivery-existing').innerHTML,/仍须重新审核/);
 assert.match(f.el('#delivery-selected-list').innerHTML,/尚未选择/);
 f.el('[name=note]').value='核对后补充说明，重新提交审核';await f.form.onsubmit({preventDefault(){}});
 assert.equal(bodies.length,0);assert.equal(f.calls.length,1);
 // Clicking a download anchor must not silently select the historic file.
 f.el('#delivery-existing').onclick({target:{closest:()=>null}});assert.match(f.el('#delivery-selected-list').innerHTML,/尚未选择/);
 f.el('#delivery-existing').onclick({target:{closest:selector=>selector==='[data-previous-attachment]'?{dataset:{previousAttachment:'0'}}:null}});
 assert.match(f.el('#delivery-selected-list').innerHTML,/沿用第 1 轮附件 · 本次第 2 轮/);
 await f.form.onsubmit({preventDefault(){}});
 assert.equal(bodies.length,1);assert.deepEqual(JSON.parse(JSON.stringify(bodies[0].evidence)),[{attachmentId:previous.attachmentId,reuseFromAttempt:1}]);
 assert.deepEqual(f.calls,['runs/'+task.id+'/delivery-options?nodeId='+node.id,'runs/'+task.id+'/complete']);assert.equal(f.modal.open,false);
});

test('本轮附件和历史附件清楚分组，本轮选择不带历史复用标记',async()=>{
 const current={attachmentId:'attachment_current',nodeId:node.id,attempt:1,state:'ready',filename:'本轮文件.txt'},bodies=[];
 const f=fixture((path,params)=>path.endsWith('/complete')?(bodies.push(params.body),Promise.resolve(task)):Promise.resolve({...structuredClone(options),attachments:[current]}),{onToast(){}});
 await f.context.openDeliveryAction(task,node);assert.match(f.el('#delivery-existing').innerHTML,/本轮已保存的附件/);assert.doesNotMatch(f.el('#delivery-existing').innerHTML,/以前轮次/);
 f.el('#delivery-existing').onclick({target:{closest:selector=>selector==='[data-existing-attachment]'?{dataset:{existingAttachment:'0'}}:null}});
 f.el('[name=note]').value='本轮文件提交';await f.form.onsubmit({preventDefault(){}});
 assert.deepEqual(JSON.parse(JSON.stringify(bodies[0].evidence)),[{attachmentId:current.attachmentId}]);
});

test('下一轮交付不会自动勾选前一轮已选历史文件，异节点和pending不显示为可沿用',async()=>{
 const old={attachmentId:'attachment_history',nodeId:node.id,attempt:1,state:'ready',filename:'原文件.txt'},f=fixture(()=>Promise.resolve({...structuredClone(options),previousAttachments:[old,{...old,attachmentId:'other',nodeId:'OTHER'},{...old,attachmentId:'pending',state:'pending'}]}));
 const second={...node,attempt:2};await f.context.openDeliveryAction({...task,runtime:{...task.runtime,nodes:[second]}},second);
 assert.equal((f.el('#delivery-existing').innerHTML.match(/data-previous-attachment=/g)||[]).length,1);
 f.el('#delivery-existing').onclick({target:{closest:selector=>selector==='[data-previous-attachment]'?{dataset:{previousAttachment:'0'}}:null}});
 assert.match(f.el('#delivery-selected-list').innerHTML,/沿用第 1 轮/);
 f.modal.close();const third={...node,attempt:3};await f.context.openDeliveryAction({...task,version:5,runtime:{...task.runtime,nodes:[third]}},third);
 assert.match(f.el('#delivery-selected-list').innerHTML,/尚未选择/);
});

test('历史来源和本轮轮次随证据展示，正常证据标签保持兼容',()=>{
 const label=vm.runInNewContext(readFileSync(new URL('evidence-view.js',import.meta.url),'utf8')+'\nevidenceProofLabel;');
 assert.equal(label({source:'task_file_verified'}),'文件完整性已校验');
 assert.equal(label({source:'task_file_verified',attachmentReuse:{sourceAttempt:1,submittedAttempt:3}}),'文件完整性已校验 · 沿用第 1 轮原文件，在第 3 轮重新交付');
});
