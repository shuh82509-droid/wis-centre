import {readFileSync} from 'node:fs';
import {requireFact} from './workflow-store.mjs';
import {FlowCreative} from './flow-creative.mjs';
import {ProductionCreativeBridge} from './flow-source-creative.mjs';
import {SourceBusinessBridge} from './flow-source-business.mjs';
const creativeUrl='https://hub.fandow.com/yxb/wis-marketing-hub/modules/creative-hub/';
export class ProductionSources{
 constructor(runtime,sources,{file,externalNumbers=[]}){
  this.runtime=runtime;this.file=file;this.externalNumbers=externalNumbers;this.snapshot=null;this.issue='等待来源快照';
  const originalPeople=sources.people.bind(sources);
  sources.people=()=>{const people=originalPeople();if(!this.fresh())return people;return [...people,...this.snapshot.people.filter(p=>p.active&&p.source==='verified_oa_grant'&&this.externalNumbers.includes(p.number)&&p.flowEligible!==false&&!people.some(q=>q.number===p.number))];};
  this.creative=new FlowCreative(runtime,{sourceUrl:()=>creativeUrl,readSource:(req,source,ids,options)=>this.readCreative(req,source,ids,options)});
  this.creativeBridge=new ProductionCreativeBridge(this.creative,{sourceUrl:()=>creativeUrl,read:(req,source,ids,options)=>this.readCreative(req,source,ids,options,true)});
  this.business=new SourceBusinessBridge(runtime);
 }
 fresh(){return this.snapshot&&Math.abs(this.runtime.clock()-Date.parse(this.snapshot.checkedAt))<45000;}
 async readCreative(req,source,ids=[],options={},internal=false){
  requireFact(source==='idea','此来源尚未配置',409);requireFact(this.fresh(),'来源快照暂不可用',503);
  const data=this.snapshot.creative;let records=data.records;
  if(!internal){const matches=data.users.filter(u=>u.active&&u.employeeNo===req.flowActorNumber);requireFact(matches.length===1,'当前账号尚未在创意来源登记有效身份',403);const u=matches[0];if(!['team_lead','supervisor','director','admin'].includes(u.role))records=records.filter(d=>['creatorId','uploaderId','authorUserId','teamLeadReviewerId','supervisorReviewerId'].some(k=>d[k]===u.id));}
  if(ids.length)records=records.filter(d=>ids.includes(d.id));
  // The private source snapshot is small and complete; public candidates remain
  // filtered again by FlowCreative's verified employee and center ACL.
  return {...data,records,baselineIds:this.snapshot.baselines.creative||[],nextCursor:null,limit:records.length,historyAvailable:true,historyIncluded:true};
 }
 status(){return {idea:{configured:true,automatic:true,url:creativeUrl,...this.creativeBridge.connection,...(!this.fresh()?{state:'unavailable',issue:this.issue}: {})},ppyxzx:{configured:false,state:'not_configured'}};}
 async sync(){
  try{const data=JSON.parse(readFileSync(this.file,'utf8'));requireFact(data.schemaVersion===1&&Array.isArray(data.people)&&data.baselines&&data.creative&&data.cloud&&data.remix&&Math.abs(this.runtime.clock()-Date.parse(data.checkedAt))<45000,'来源快照未通过时效与结构校验',503);this.snapshot=data;this.issue='';
   // Only the daemon that durably imported all three outboxes may own their
   // routine notifications. SLA/escalation notifications stay in this engine.
   this.runtime.serviceNotificationOwners=new Set(data.notificationsEnabled?['idea','cloud','remix']:[]);
   await this.creativeBridge.sync();this.business.sync(data);
  }catch(e){this.issue=e.status?e.message:'来源快照读取失败';this.snapshot=null;}
 }
}
