import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('app.js',import.meta.url),'utf8');
const helpers=app.slice(app.indexOf('function evidenceLinkHtml('),app.indexOf('\nasync function openTask('));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=vm.createContext({esc,API:'/isolated/api/',location:{origin:'https://fixture.invalid'},URL,encodeURIComponent,state:{openNodes:new Set(['node']),overview:{access:{canManage:true}}},status:()=>'',fmt:()=>'',pill:()=>''});
vm.runInContext(readFileSync(new URL('evidence-view.js',import.meta.url),'utf8')+'\n'+helpers,context);
const link=(summary,id='one')=>({summary,source:'human_attested',url:'https://fixture.invalid/'+id,reference:'link-'+id,version:'link-reference-v1'});
const note='本地显示验收。'+('原字幕与来源待核验，未批准SKU。'.repeat(40))+'本版公共说明结束。';
const node=(evidence,noteValue=note)=>({id:'node',state:'completed',owner:{name:'本地人员'},done:'来源可定位',entry:'本地测试',evidence,note:noteValue,attempt:1,dependencies:[]});
const render=(evidence,noteValue=note)=>context.nodeHtml(node(evidence,noteValue),0,{id:'task_fixture',runtime:{state:'paused'}});
const count=(html,value)=>html.split(esc(value)).length-1;

test('九链接重复的500字公共摘要仅在本版完整说明中出现一次，原链接和版本全部保留',()=>{
 const evidence=Array.from({length:9},(_,i)=>link(note.slice(0,500),String(i))),before=structuredClone(evidence),html=render(evidence);
 assert.equal(count(html,note),1);assert.equal(count(html,note.slice(0,500)),1);
 assert.equal((html.match(/target="_blank"/g)||[]).length,9);
 for(const e of evidence){assert.ok(html.includes(e.url));assert.ok(html.includes(e.reference));}
 assert.equal(count(html,'link-reference-v1'),9);assert.deepEqual(evidence,before);
});
test('相等的短公共说明显示一次，不同单项说明均保留在自己的链接项',()=>{
 const html=render([link('公共说明','a'),link('第二条独立口播边界','b'),link('第三条独立资料用途','c')],'公共说明');
 for(const value of ['公共说明','第二条独立口播边界','第三条独立资料用途'])assert.equal(count(html,value),1);
 assert.match(html,/link-b[^]*第二条独立口播边界/);assert.match(html,/link-c[^]*第三条独立资料用途/);
});
test('不能按任意前缀、空白折叠、近似字符或不同源摘要去重',()=>{
 for(const summary of [note.slice(0,499),note.slice(0,501),note.slice(0,499)+'异',note.slice(0,500)+' ', '原说明\n有独立换行'])assert.equal(context.evidenceItemSummary(link(summary),note),summary);
 const e={...link(note.slice(0,500)),source:'root_record_verified'};assert.equal(context.evidenceItemSummary(e,note),e.summary);
});
test('没有公共说明时保留单项摘要；文件名、下载与历史重选轮次保留',()=>{
 const e={attachmentId:'attachment_one',filename:'原截图.png',reference:'attachment_one',version:'sha256:original',summary:'第1张需重点核对',source:'task_file_verified',attachmentReuse:{sourceAttempt:1,submittedAttempt:2}};
 const html=render([e],'');assert.match(html,/download="原截图.png"/);assert.match(html,/第1张需重点核对/);assert.match(html,/沿用第 1 轮原文件，在第 2 轮重新交付/);assert.match(html,/sha256:original/);
 assert.equal(context.evidenceItemSummary({...e,summary:e.filename},''),'');
});
test('说明转义保持安全，且跨版本没有共享去重状态',()=>{
 const shared='<script>公共</script>',different='<img src=x onerror=alert(1)>独立';
 const html=render([link(shared),link(different,'two')],shared);
 assert.doesNotMatch(html,/<script>|<img /);assert.equal(count(html,shared),1);assert.equal(count(html,different),1);
 assert.equal(count(render([link(shared)],shared),shared),1);
 const historyNode={...node([link('当版公共')],'当版公共'),attempt:2,history:[{attempt:1,state:'completed',note:'旧版说明保留',evidence:[link('旧单项','old')]}]};
 const history=context.nodeHtml(historyNode,0,{id:'task_fixture',runtime:{state:'paused'}});
 assert.equal(count(history,'当版公共'),1);assert.equal(count(history,'旧版说明保留'),1);assert.match(history,/link-old/);
});
test('500边界按存储规则使用UTF-16并保留完整公共结尾',()=>{
 const shared='😀'.repeat(300)+'完整结尾',html=render([link(shared.slice(0,500))],shared);
 assert.equal(count(html,shared),1);assert.equal(count(html,shared.slice(0,500)),1);assert.match(html,/完整结尾/);
});
