import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const ctx=vm.createContext({URL,Set,JSON,encodeURIComponent,BASE:'/new/hub/',API:'/new/hub/api/flows/',location:{origin:'https://example.invalid'},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
vm.runInContext(readFileSync(new URL('evidence-view.js',import.meta.url),'utf8'),ctx);
function task(){return {sourceUrl:'https://old.invalid/workflow-panorama/?task=task_parent',runtime:{parentTaskId:'task_parent',handoffEvidence:[{attachmentId:'attachment_file',filename:'brief.txt',source:'task_file_verified',version:'v1'}]},relations:{upstream:[{taskId:'task_parent',canOpen:true}]}};}
test('upstream evidence links use original parent task and deduplicate repeated review evidence',()=>{
 const t=task();t.runtime.handoffEvidence.push({...t.runtime.handoffEvidence[0]});
 const html=ctx.handoffEvidenceHtml(t);
 assert.ok(html.includes('/new/hub/api/flows/runs/task_parent/attachments/attachment_file/content'));
 assert.equal((html.match(/brief.txt/g)||[]).length,1);assert.ok(!html.includes('old.invalid'));
 assert.equal(ctx.taskSourceUrl(t),'/new/hub/workflow-panorama/?task=task_parent');
});
test('inaccessible or unrelated upstream never renders file details',()=>{
 const t=task();t.relations.upstream[0].canOpen=false;assert.equal(ctx.handoffEvidenceHtml(t),'');
 t.relations.upstream=[{taskId:'other',canOpen:true}];assert.equal(ctx.handoffEvidenceHtml(t),'');
});
test('preserve distinct versions and escape filenames while leaving human source URLs alone',()=>{
 const t=task();t.runtime.handoffEvidence.push({...t.runtime.handoffEvidence[0],version:'v2',filename:'<img onerror="x">'});
 const html=ctx.handoffEvidenceHtml(t);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.equal((html.match(/attachment_file\/content/g)||[]).length,2);
 assert.equal(ctx.taskSourceUrl({sourceUrl:'https://feishu.example/brief'}),'https://feishu.example/brief');
});

test('system proof navigation follows current hub without rewriting saved evidence or human links',()=>{
 const old='https://app.fandow.top/fd-026222/wis-video-center/';
 for(const source of ['cloud_api_verified','cloud_asset_verified','root_record_verified','automation_root_verified']){
  const e={source,url:old,assetId:'31',version:'original-version',reference:'original-receipt'},before=JSON.stringify(e);
  assert.equal(ctx.flowEvidenceUrl(e,'task-a'),'/new/hub/#module='+(['cloud_api_verified','cloud_asset_verified'].includes(source)?'cloud-manager&asset_id=31':'material-workbench'));
  assert.equal(JSON.stringify(e),before);
 }
 assert.equal(ctx.flowEvidenceUrl({source:'human_attested',url:old}),old);
 assert.equal(ctx.taskSourceUrl({sourceUrl:old,runtime:{sourceKey:'auto:job:run',automation:{jobId:'job'}}}),'/new/hub/#module=material-workbench');
 assert.equal(ctx.taskSourceUrl({sourceUrl:old,runtime:{automation:{jobId:'job'}}}),old);
});
