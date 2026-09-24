// A single approved commissioning card, isolated from business tasks and
// flowNotifications. Its callback is handled by the already-running live WS.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {requireFact} from './workflow-store.mjs';

export const LIVE_TEST_APP_ID='cli_aa9c744d6ffa1cc4';
export const LIVE_TEST_RUN_ID='live-card-test-20260924-liu-approved-one';
export const LIVE_TEST_RECIPIENT={name:'刘慧迅',openId:'ou_2f90737d743168531c00f6a066982e15',department:'od-3044f2fd1042f68162820d6e770680d0'};
const DEFAULT_LEDGER='/app/data/live-card-commissioning-r56-liu/ledger.json';
const plain=content=>({tag:'plain_text',content});

export function liveTestCard(entry){
  const done=Boolean(entry.confirmedAt);
  return {schema:'2.0',config:{update_multi:true,width_mode:'compact',enable_forward:false,
    summary:{content:'【联调测试｜WIS直播工作流】仅验证通知与本人按钮回执'}},
    header:{template:'blue',title:plain('【联调测试｜WIS直播工作流】'),
      subtitle:plain('品牌营销部中枢 · 非正式工作指令'),icon:{tag:'standard_icon',token:'todo_colorful'}},
    body:{direction:'vertical',padding:'12px',vertical_spacing:'12px',elements:[
      {tag:'column_set',flex_mode:'none',columns:[{tag:'column',width:'weighted',weight:1,
        background_style:'blue-50',padding:'12px',vertical_spacing:'4px',elements:[
          {tag:'markdown',content:'仅验证消息送达与按钮回执，**不是正式排班，不创建或完成业务任务。**'},
          {tag:'markdown',content:'<font color="grey">点击仅保存本人测试回执，无需办理正式业务。</font>',text_size:'notation'},
        ]}]},
      done?{tag:'markdown',content:'**已收到本人测试回执**\n<font color="grey">未创建、完成或推进任何业务任务。</font>'}:
        {tag:'button',type:'primary_filled',width:'fill',text:plain('确认测试回执'),
          behaviors:[{type:'callback',value:{action:'confirm_live_test',testId:LIVE_TEST_RUN_ID,nonce:entry.nonce}}]},
    ]}};
}

function atomicJson(path,value){
  const dir=dirname(path),tmp=path+'.'+randomUUID()+'.tmp',fd=openSync(tmp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(tmp,path);
  // Linux production fsyncs the containing directory; Windows test runners
  // do not allow opening directories in the same way.
  try{const directory=openSync(dir,'r');try{fsyncSync(directory);}finally{closeSync(directory);}}catch{}
}
const iso=clock=>new Date(clock()).toISOString();
const entryShape=()=>({name:LIVE_TEST_RECIPIENT.name,openId:LIVE_TEST_RECIPIENT.openId,
  department:LIVE_TEST_RECIPIENT.department,
  uuid:createHash('sha256').update(LIVE_TEST_RUN_ID+':'+LIVE_TEST_RECIPIENT.openId).digest('hex').slice(0,32),
  nonce:randomBytes(16).toString('hex'),state:'prepared'});

export class LiveTestCard {
  constructor({appId,notifier,ledgerPath=DEFAULT_LEDGER,clock=Date.now}){
    requireFact(appId===LIVE_TEST_APP_ID,'联调卡应用身份不匹配',403);
    Object.assign(this,{appId,notifier,ledgerPath,clock,running:false});
  }
  read(){
    if(!existsSync(this.ledgerPath))return null;
    const state=JSON.parse(readFileSync(this.ledgerPath,'utf8'));
    requireFact(state.runId===LIVE_TEST_RUN_ID&&state.entry?.openId===LIVE_TEST_RECIPIENT.openId&&
      state.entry?.name===LIVE_TEST_RECIPIENT.name&&state.entry?.department===LIVE_TEST_RECIPIENT.department,
      '联调卡账本身份不匹配',409);
    return state;
  }
  mutate(fn,{create=false}={}){
    const dir=dirname(this.ledgerPath);mkdirSync(dir,{recursive:true,mode:0o700});
    const lock=this.ledgerPath+'.lock',fd=openSync(lock,'wx',0o600);
    try{
      let state=this.read();
      if(!state){requireFact(create,'联调卡未准备',409);state={runId:LIVE_TEST_RUN_ID,createdAt:iso(this.clock),entry:entryShape()};}
      const result=fn(state);
      atomicJson(this.ledgerPath,state);
      return result;
    }finally{closeSync(fd);unlinkSync(lock);}
  }
  status(){const e=this.read()?.entry;return {runId:LIVE_TEST_RUN_ID,prepared:Boolean(e),state:e?.state||'not_prepared',messageId:e?.messageId||null,
    sentAt:e?.sentAt||null,readBackAt:e?.readBackAt||null,confirmedAt:e?.confirmedAt||null,updatedAt:e?.updatedAt||null,updateState:e?.updateState||null};}
  accept(raw){
    requireFact(raw?.app_id===this.appId&&raw.action?.tag==='button'&&
      raw.action.value?.action==='confirm_live_test'&&raw.action.value?.testId===LIVE_TEST_RUN_ID,
      '不是本轮联调卡',403);
    requireFact(typeof raw.event_id==='string'&&raw.event_id.length>=8&&raw.event_id.length<=200,'飞书事件编号无效',403);
    const e=this.read()?.entry;
    requireFact(e?.state==='sent'&&e.messageId===raw.context?.open_message_id&&
      e.openId===raw.operator?.open_id&&e.nonce===raw.action.value?.nonce,
      '联调卡与本人发送回执不匹配',403);
    if(e.confirmedAt)return {status:'done'};
    return this.mutate(state=>{
      const row=state.entry;
      requireFact(row.state==='sent'&&row.messageId===raw.context?.open_message_id&&
        row.openId===raw.operator?.open_id&&row.nonce===raw.action.value?.nonce,
        '联调卡回执已变化',409);
      if(!row.confirmedAt){row.confirmedAt=iso(this.clock);row.eventId=raw.event_id;row.updateState='ready';}
      return {status:'done'};
    });
  }
  async api(route,{method='GET',body}={}){
    requireFact(this.notifier?.tenantToken&&this.notifier?.fetch,'未配置联调卡飞书应用身份',503);
    const response=await this.notifier.fetch('https://open.feishu.cn/open-apis/'+route,{
      method,headers:{authorization:'Bearer '+await this.notifier.tenantToken(),'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(12000),
    });
    const payload=await response.json();
    requireFact(response.ok&&payload.code===0,'联调卡飞书接口未确认成功',503);
    return payload.data;
  }
  async sendApproved(){
    const existing=this.read()?.entry;
    if(existing?.messageId)return this.status();
    requireFact(!existing||existing.state==='prepared','联调卡发送结果不明，必须先人工读回，不得重发',409);
    if(!existing)this.mutate(()=>{}, {create:true});
    const user=(await this.api('contact/v3/users/'+LIVE_TEST_RECIPIENT.openId+'?user_id_type=open_id&department_id_type=open_department_id')).user;
    const personStatus=user?.status||{};
    requireFact(user?.name===LIVE_TEST_RECIPIENT.name&&user?.open_id===LIVE_TEST_RECIPIENT.openId&&
      user?.department_ids?.includes(LIVE_TEST_RECIPIENT.department)&&personStatus.is_activated===true&&
      personStatus.is_resigned===false&&personStatus.is_frozen===false&&personStatus.is_exited===false,
      '联调卡收件人姓名、部门或在职状态不符',403);
    const e=this.mutate(state=>{const row=state.entry;requireFact(row.state==='prepared'&&!row.messageId,'联调卡不可重复发送',409);
      row.verifiedAt=iso(this.clock);row.sentCard=liveTestCard(row);row.state='sending';return structuredClone(row);});
    try{
      const result=await this.api('im/v1/messages?receive_id_type=open_id',{method:'POST',body:{
        receive_id:e.openId,msg_type:'interactive',uuid:e.uuid,content:JSON.stringify(e.sentCard),
      }});
      requireFact(typeof result?.message_id==='string'&&result.message_id.startsWith('om_'),'飞书未返回消息编号',503);
      this.mutate(state=>{state.entry.messageId=result.message_id;state.entry.state='sent';state.entry.sentAt=iso(this.clock);});
    }catch(error){
      this.mutate(state=>{if(!state.entry.messageId){state.entry.state='uncertain';state.entry.error='发送结果不明；禁止自动重试';}});
      throw error;
    }
    try{
      const messageId=this.read().entry.messageId;
      const read=await this.api('im/v1/messages/'+encodeURIComponent(messageId));
      requireFact(read?.items?.some(item=>item.message_id===messageId&&item.msg_type==='interactive'),
        '联调卡消息未能读回',503);
      this.mutate(state=>{state.entry.readBackAt=iso(this.clock);});
    }catch{this.mutate(state=>{state.entry.readBackState='attention';});}
    return this.status();
  }
  async flush(){
    if(this.running)return;this.running=true;
    try{
      const e=this.read()?.entry;
      if(!e?.confirmedAt||e.updateState!=='ready'||!e.messageId)return;
      this.mutate(state=>{requireFact(state.entry.updateState==='ready','联调卡更新状态已变化',409);state.entry.updateState='updating';});
      try{
        const read=await this.api('im/v1/messages/'+encodeURIComponent(e.messageId));
        requireFact(read?.items?.some(item=>item.message_id===e.messageId&&item.msg_type==='interactive'),
          '联调卡原消息不可读',503);
        const updated=structuredClone(e.sentCard);
        requireFact(updated?.schema==='2.0'&&updated.body?.elements?.[1]?.tag==='button','联调卡原文与账本不符',409);
        updated.body.elements[1]=liveTestCard({...e,confirmedAt:e.confirmedAt}).body.elements[1];
        await this.api('im/v1/messages/'+encodeURIComponent(e.messageId),{method:'PATCH',body:{content:JSON.stringify(updated)}});
        this.mutate(state=>{state.entry.updateState='done';state.entry.updatedAt=iso(this.clock);});
      }catch{
        // A PATCH timeout can mean it succeeded. Do not issue another PATCH
        // without independent readback and reconciliation.
        this.mutate(state=>{state.entry.updateState='attention';state.entry.updateError='卡片展示更新待人工核验；本人测试回执已保存';});
      }
    }finally{this.running=false;}
  }
}
