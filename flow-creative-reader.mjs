import {requireFact} from './workflow-store.mjs';

// Explicit same-origin routes through the authenticated company gateway. Never
// forward the user's OA cookies to an arbitrary URL supplied by a browser.
export function createCreativeReader({paths={},remoteGet,origin}){
 for(const path of Object.values(paths))if(path)requireFact(/^\/(?!\/)[a-zA-Z0-9_/-]+\/$/.test(path),'创意接口须配置为同源网关下以 / 结尾的路径');
 const status=()=>Object.fromEntries(['idea','ppyxzx'].map(source=>[source,{configured:!!paths[source]}]));
 const sourceUrl=source=>new URL(paths[source].replace(/api\/$/,''),origin).href;
 async function read(req,source,recordIds=[],{cursor=null}={}){
  requireFact(paths[source],'尚未配置此创意系统的同源业务接口，请配置并核验来源连接',503);
  const get=async suffix=>{const result=await remoteGet(req,paths[source]+suffix);requireFact(result.status===200,'创意来源读取未通过，请核对来源登录和权限',[401,403].includes(result.status)?result.status:502);return result.payload;};
  if(source==='idea'){
   const ids=[...new Set(recordIds)];
   const chunks=ids.length?Array.from({length:Math.ceil(ids.length/90)},(_,i)=>ids.slice(i*90,i*90+90)):[[]];
   const records=[],users=new Map(),actionsByRecord=Object.create(null);let nextCursor=null;
   for(const chunk of chunks){
    const query=new URLSearchParams();for(const id of chunk)query.append('id',id);if(!ids.length&&cursor)query.set('cursor',cursor);
    const data=await get('workflow-source'+(query.size?'?'+query:''));
    requireFact(data.schema==='wis.creative-source.v1'&&data.source==='idea'&&Array.isArray(data.records)&&Array.isArray(data.users)&&data.currentUser?.employeeNo,'创意源端接口需升级为 workflow-source v1，不能用截断列表替代',502);
    requireFact(data.currentUser.employeeNo===req.flowActorNumber,'创意来源身份与流程登录身份不一致',403);
    requireFact(!ids.length||data.historyIncluded===true,'来源审核历史未读回，不推进流程',502);
    for(const row of data.records){
     requireFact(!chunk.length||chunk.includes(row.id),'来源返回了非请求任务，不能跨记录同步',502);
     const actions=data.actionsByRecord?.[row.id];requireFact(Array.isArray(actions)&&actions.every(e=>e.id&&e.draftId===row.id),'来源审核历史编号不一致',502);
     records.push(row);actionsByRecord[row.id]=actions;
    }
    for(const person of data.users){const prior=users.get(person.id);requireFact(!prior||prior.employeeNo===person.employeeNo&&prior.active===person.active,'同步期间来源成员身份变化，请重新核验',409);users.set(person.id,person);}
    requireFact(data.nextCursor===null||typeof data.nextCursor==='string'&&data.nextCursor.length<=1000&&data.nextCursor!==cursor,'来源分页位置无效或未推进',502);nextCursor=data.nextCursor;
   }
   return {records,users:[...users.values()],actionsByRecord,nextCursor,limit:100,historyAvailable:true};
  }
  const data=await get('topics');requireFact(Array.isArray(data.topics),'选题接口格式不完整',502);
  return {records:data.topics,users:[],actionsByRecord:{},limit:1000,historyAvailable:false};
 }
 return {read,sourceUrl,status};
}
