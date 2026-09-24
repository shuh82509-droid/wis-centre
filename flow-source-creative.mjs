import {setImmediate as yieldToEventLoop} from 'node:timers/promises';
import {creativeProjection} from './flow-creative.mjs';
import {requireFact} from './workflow-store.mjs';
import {fingerprint} from './task-workflow.mjs';
export class ProductionCreativeBridge{
 constructor(creative,reader){this.creative=creative;this.reader=reader;this.members=new Map();this.busy=false;this.connection={configured:true,automatic:true,state:'connecting',checkedAt:null,issue:''};}
 people(){return [...this.members.values()];}
 async sync({forceVerify=false}={}){
  if(this.busy)return;this.busy=true;const r=this.creative.runtime;
  try{
   let cursor=null;const ids=[],seen=new Set();
   do{
    const page=await this.reader.read({},'idea',[],{cursor});ids.push(...page.records.filter(d=>!page.baselineIds?.includes(d.id)).map(d=>d.id));cursor=page.nextCursor;
    requireFact(!cursor||!seen.has(cursor),'创意来源分页循环，原任务状态保留',502);if(cursor)seen.add(cursor);
   }while(cursor);
   const watchIds=(r.store.read().creativeWatches||[]).filter(w=>w.source==='idea'&&w.enabled).map(w=>w.recordId);
   const targetIds=[...new Set([...ids,...watchIds])];
   const data=targetIds.length?await this.reader.read({},'idea',targetIds):{records:[],users:[],actionsByRecord:{}};
   const members=new Map();
   for(const person of data.users){requireFact(person.employeeNo&&person.name,'创意来源成员缺少姓名或工号',502);members.set(person.employeeNo,{number:person.employeeNo,name:person.name,center:person.center||'业务来源',role:'specialist',active:person.active===true,modules:['creative-hub'],source:'local_creative_participant'});}
   this.members=members;
   const actor={enabled:true,canManage:true,department:true,modules:['creative-hub'],user:{number:'SYSTEM-CREATIVE',name:'创意来源自动同步',center:'业务来源'}};
   let imported=0;const issues=[];
   for(const row of data.records){
    await yieldToEventLoop();
     try{
      const projection=creativeProjection('idea',row,data.users),managerNumber=projection.steps.at(-1).owner;
      this.creative.validatePeople(actor,projection);const manager=r.person(managerNumber,actor);
      const mirrored=r.store.read(),watch=mirrored.creativeWatches?.find(w=>w.source==='idea'&&w.recordId===row.id);
      const task=mirrored.tasks.find(t=>t.runtime?.sourceKey==='creative:idea:'+row.id);
      const local=task?.runtime?.creative,actions=data.actionsByRecord?.[row.id]||[];
      const sourceAge=r.clock()-Date.parse(local?.checkedAt),watchAge=r.clock()-Date.parse(watch?.checkedAt);
      if(!forceVerify&&watch?.automatic&&watch.taskId===task?.id&&!watch.issue&&JSON.stringify(watch.manager)===JSON.stringify(manager)&&
        local?.automatic===true&&local.local===false&&!local.issue&&local.signature===fingerprint(projection)&&
        task.runtime.manager.number===manager.number&&actions.every(a=>!a.id||local.actionIds?.includes(a.id))&&
        sourceAge>=0&&sourceAge<20000&&watchAge>=0&&watchAge<20000){imported++;continue;}
      r.store.transaction(s=>{
      r.ensure(s);s.creativeWatches??=[];let w=s.creativeWatches.find(w=>w.source==='idea'&&w.recordId===row.id);
      if(!w){w={source:'idea',recordId:row.id,center:manager.center,manager,bindings:{},configuredBy:actor.user,configuredAt:r.iso(),enabled:true,automatic:true};s.creativeWatches.push(w);}
      w.automatic=true;w.manager=manager;
      const task=this.creative.apply(s,w,projection,data.actionsByRecord[row.id]||[],actor);
      task.runtime.creative.local=false;task.runtime.creative.automatic=true;task.runtime.manager=manager;
      return true;
     });imported++;
    }catch(error){const message=error.status?error.message:'创意任务同步失败，原记录保留';issues.push({recordId:row.id,message});const w=r.store.read().creativeWatches?.find(w=>w.source==='idea'&&w.recordId===row.id);if(w)this.creative.fail(w,error);}
   }
   for(const id of watchIds.filter(id=>!data.records.some(d=>d.id===id))){await yieldToEventLoop();const error=Object.assign(Error('原任务已删除或暂不可读，保留最后核验状态'),{status:409});const watch=r.store.read().creativeWatches?.find(w=>w.source==='idea'&&w.recordId===id);if(watch?.issue!==error.message)this.creative.fail({source:'idea',recordId:id},error);issues.push({recordId:id,message:error.message});}
   this.connection={configured:true,automatic:true,state:issues.length?'attention':'connected',checkedAt:r.iso(),imported,issue:issues.length?issues.length+' 项任务待补齐审核人或核对来源':'',issues};
  }catch(error){
   this.connection={...this.connection,state:'unavailable',checkedAt:r.iso(),issue:error.status?error.message:'创意工作台暂不可达，恢复后自动重试'};
   for(const w of r.store.read().creativeWatches||[])if(w.source==='idea'&&w.automatic){await yieldToEventLoop();this.creative.fail(w,Object.assign(Error(this.connection.issue),{status:503}));}
  }finally{this.busy=false;}
 }
}
