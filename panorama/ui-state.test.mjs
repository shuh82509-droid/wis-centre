import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {permissionHelpers} from './permission-test-helpers.mjs';

const source=readFileSync(new URL('app.js',import.meta.url),'utf8');
const detailsHelper=source.slice(source.indexOf('const disclosureState='),source.indexOf('function toast('));
// Narrow DOM fixture: these tests exercise disclosure state across replacement,
// while actual HTML layout and authenticated browser verification remain separate.
class Surface{
 constructor(){this.items=[];}
 querySelectorAll(selector){assert.equal(selector,'details');return this.items;}
 set innerHTML(items){this.items=items.map(item=>({...item,dataset:{...item.dataset},querySelector(){return {textContent:item.summary};}}));}
}
const detail=(key,summary,open=false)=>({dataset:{disclosure:key},summary,open});
function fixture(){const replace=vm.runInNewContext(detailsHelper+'\nreplaceViewHtml;');return {replace,surface:new Surface()};}

test('同一任务刷新后回执与历史保持展开，计数变化不改变归属',()=>{
 const {replace,surface}=fixture();
 replace(surface,[detail('task-notifications','飞书通知与送达回执（1）'),detail('node-history:A','查看 1 次历史交付'),detail('node-fields:A','留档字段')],'task:A');
 surface.items[0].open=true;surface.items[1].open=true;
 replace(surface,[detail('task-notifications','飞书通知与送达回执（2）'),detail('node-history:A','查看 3 次历史交付'),detail('node-fields:A','留档字段',true)],'task:A');
 assert.deepEqual(surface.items.map(item=>item.open),[true,true,false]);
});

test('双品同名任务分组按产品分别保留展开状态，数量改变不收起',()=>{
 const {replace,surface}=fixture();
 replace(surface,[detail('automation:黑晶面膜','自动任务与最近运行（5）'),detail('automation:隐形水润面膜','自动任务与最近运行（5）')],'view:automation');
 surface.items[0].open=true;
 replace(surface,[detail('automation:黑晶面膜','自动任务与最近运行（6）'),detail('automation:隐形水润面膜','自动任务与最近运行（6）')],'view:automation');
 assert.deepEqual(surface.items.map(item=>item.open),[true,false]);
});

test('切换任务或关闭抽屉后不沿用其他任务的回执展开状态',()=>{
 const {replace,surface}=fixture(),rows=[detail('task-notifications','飞书通知')];
 replace(surface,rows,'task:A');surface.items[0].open=true;
 replace(surface,rows,'task:B');assert.equal(surface.items[0].open,false);
 surface.items[0].open=true;replace(surface,[],null);
 replace(surface,rows,'task:B');assert.equal(surface.items[0].open,false);
});

test('同一任务暂时收起节点后，重新展开仍记住该节点历史状态',()=>{
 const {replace,surface}=fixture(),row=detail('node-history:A','历史交付');
 replace(surface,[row],'task:A');surface.items[0].open=true;
 replace(surface,[],'task:A');replace(surface,[row],'task:A');
 assert.equal(surface.items[0].open,true);
});

test('先前任务的延迟响应不会覆盖后来打开的任务',async()=>{
 const openTask=source.split('\n').find(line=>line.startsWith('async function openTask('));
 let resolveA;const slowA=new Promise(resolve=>{resolveA=resolve;});
 const context=vm.createContext({state:{task:null,stage:null,openNodes:new Set(),overview:{access:{canManage:false}}},document:{activeElement:{}},
  api:path=>path==='runs/A'?slowA:Promise.resolve({id:'B',runtime:{nodes:[]}}),
  openDrawer(){},drawerHeader(){return '';},renderTask(){},
  history:{replaceState(){}},location:{pathname:'/workflow/',search:''},URLSearchParams,API:'/workflow/api/',encodeURIComponent,esc:String});
 vm.runInContext('let taskRequest=0,lastFocus;\n'+permissionHelpers+'\n'+openTask,context);
 const first=context.openTask('A');await context.openTask('B');
 resolveA({id:'A',runtime:{nodes:[]}});await first;
 assert.equal(context.state.task.id,'B');
});

test('窄屏首次打开详情在布局完成后滚入视野，刷新已打开详情不抢走滚动位置',()=>{
 for(const reduced of [false,true]){
  const frames=[],scrolls=[],drawer={hidden:true,isConnected:true,scrollIntoView:options=>scrolls.push(options)},workspace={classList:{add(){}}};
  const context=vm.createContext({requestAnimationFrame:fn=>frames.push(fn),matchMedia:query=>({matches:query.includes('max-width')||reduced}),$:selector=>selector==='#drawer'?drawer:workspace,replaceViewHtml(){}});
  vm.runInContext(source.split('\n').filter(line=>line.startsWith('function revealStackedDrawer(')||line.startsWith('function openDrawer(')).join('\n'),context);
  context.openDrawer('节点详情');assert.equal(scrolls.length,0);assert.equal(frames.length,1);frames.shift()();
  assert.equal(scrolls.length,1);assert.equal(scrolls[0].block,'start');assert.equal(scrolls[0].behavior,reduced?'auto':'smooth');
  context.openDrawer('刷新原详情');assert.equal(frames.length,0);assert.equal(scrolls.length,1);
 }
});
test('桌面侧栏不滚动页面，详情在下一帧前关闭或移除时取消滚入',()=>{
 for(const state of ['desktop','closed','removed']){
  const frames=[],scrolls=[],drawer={hidden:false,isConnected:true,scrollIntoView:options=>scrolls.push(options)};
  const context=vm.createContext({requestAnimationFrame:fn=>frames.push(fn),matchMedia:()=>({matches:state!=='desktop'})});
  vm.runInContext(source.split('\n').find(line=>line.startsWith('function revealStackedDrawer(')),context);context.revealStackedDrawer(drawer);
  if(state==='closed')drawer.hidden=true;if(state==='removed')drawer.isConnected=false;frames.shift()();assert.equal(scrolls.length,0);
 }
});
