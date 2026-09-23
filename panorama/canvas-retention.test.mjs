import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./flow-canvas.js',import.meta.url),'utf8');
function fixture(){
 const frames=new Map();let frameId=0;
 const ctx=vm.createContext({window:{addEventListener(){},visualViewport:{addEventListener(){}}},document:{querySelectorAll:()=>[]},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 vm.runInContext(source+'\nthis.Controller=FlowCanvasController;this.preferences=flowCanvasPreferences;this.instances=flowCanvasInstances;',ctx);ctx.Controller.prototype.draw=()=>{};
 function host(id='studio-modules'){
  const handlers={},output={textContent:'100%'},fit={attrs:{},setAttribute(k,v){this.attrs[k]=v;}},viewport={clientWidth:1000,clientHeight:500,scrollLeft:0,scrollTop:0,addEventListener:(k,v)=>handlers[k]=v},grid={style:{},scrollHeight:600},world={style:{}},sizer={style:{}};
  const h={isConnected:true,dataset:{flowCanvas:id,canvasKind:'studio-modules',canvasColumns:'3'},addEventListener(){},querySelector:s=>({'.canvas-viewport':viewport,'.canvas-sizer':sizer,'.canvas-world':world,'.canvas-grid':grid,svg:{},output,'[data-canvas-fit]':fit}[s])};
  return {h,viewport,output,fit,handlers};
 }
 return {ctx,host,frames};
}
test('编排首帧及换DOM首帧同步恢复适应窗口80%，无需等下一帧',()=>{
 const {ctx,host}=fixture(),first=host(),c=new ctx.Controller(first.h);assert.equal(first.output.textContent,'80%');assert.equal(first.fit.attrs['aria-pressed'],'true');
 ctx.instances.set(c.id,c);first.h.isConnected=false;c.dispose();const second=host(),next=new ctx.Controller(second.h);assert.equal(next.scale,.8);assert.equal(next.fitMode,true);assert.equal(second.output.textContent,'80%');assert.equal(second.fit.attrs['aria-pressed'],'true');
});
test('手动缩放与尚未派发scroll事件的滚动位置在重绘前保存，不被旧DOM事件归零',()=>{
 const {ctx,host}=fixture(),first=host(),c=new ctx.Controller(first.h);ctx.instances.set(c.id,c);c.zoom(1.2);first.viewport.scrollLeft=121;first.viewport.scrollTop=209;
 ctx.snapshotFlowCanvases({contains:el=>el===first.h});first.h.isConnected=false;first.viewport.scrollLeft=0;first.viewport.scrollTop=0;first.handlers.scroll();c.dispose();
 const second=host(),next=new ctx.Controller(second.h);assert.equal(next.scale,1.2);assert.equal(next.fitMode,false);assert.equal(second.output.textContent,'120%');assert.equal(second.fit.attrs['aria-pressed'],'false');assert.equal(second.viewport.scrollLeft,121);assert.equal(second.viewport.scrollTop,209);
});
test('模块画布和执行节点画布偏好独立，窗口变化只在fit模式重新计算',()=>{
 const {ctx,host}=fixture(),a=host(),c=new ctx.Controller(a.h);c.zoom(1.5);const b=host('studio-nodes-01'),d=new ctx.Controller(b.h);assert.equal(d.fitMode,true);assert.equal(d.scale,.8);a.viewport.clientWidth=400;c.layout();assert.equal(c.scale,1.5);b.viewport.clientWidth=400;d.layout();assert.equal(d.fitMode,true);assert.equal(d.scale,.8);
});
