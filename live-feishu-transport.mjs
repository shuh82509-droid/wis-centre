import {EventDispatcher,WSClient,LoggerLevel,Domain} from '@larksuiteoapi/node-sdk';
import {requireFact} from './workflow-store.mjs';

const APP_ID='cli_aa9c744d6ffa1cc4';
// This receiver is registered only on the official app-authenticated outbound
// WebSocket. It is deliberately not exposed as an HTTP/JSON route.
export class LiveFeishuTransport {
  constructor({appId,appSecret,inbox,enabled=false,Client=WSClient,Dispatcher=EventDispatcher}) {
    requireFact(appId===APP_ID,'直播卡片只能使用已授权中枢应用',403);
    Object.assign(this,{appId,appSecret,inbox,enabled,Client,Dispatcher});
    this.client=null;this.lastError='';
  }
  status(){return {enabled:this.enabled,state:this.client?.getConnectionStatus().state||'stopped',error:this.lastError};}
  ready(){return this.enabled&&this.status().state==='connected';}
  start(){
    if(!this.enabled||this.client)return;
    requireFact(this.appSecret,'缺少应用服务端配置',503);
    // Do not pass SDK raw payload/error logs to application logs: card forms
    // and application secrets are not operational telemetry.
    const logger={trace(){},debug(){},info(){},warn(){},error:()=>{this.lastError='飞书卡片通道暂不可用';}};
    const dispatcher=new this.Dispatcher({logger,loggerLevel:LoggerLevel.error}).register({
      'card.action.trigger':raw=>{
        try{
          requireFact(raw?.app_id===this.appId&&raw.action?.tag==='button','卡片应用或操作类型不匹配',403);
          const form=raw.action.form_value||{},note=form[raw.action.name==='live_complete'?'completionNote':'feedbackNote'];
          const result=this.inbox.accept({verified:true,appId:raw.app_id,eventId:raw.event_id,
            messageId:raw.context?.open_message_id,openId:raw.operator?.open_id,
            action:raw.action.name,form:{note,actualStart:form.actualStart,actualEnd:form.actualEnd,platformSessionId:form.platformSessionId,evidenceUrl:form.evidenceUrl}});
          return {toast:{type:result.status==='attention'?'error':'info',content:result.status==='attention'?'此操作待负责人核验，请勿重复提交。':result.status==='done'?'此操作已处理，请查看卡片回执。':'已接收，正在核验班表和办理条件；尚未标记完成。'}};
        }catch{return {toast:{type:'error',content:'此卡片暂不可办理，请使用发给本人的最新通知或联系负责人。'}};}
      },
    });
    this.client=new this.Client({appId:this.appId,appSecret:this.appSecret,domain:Domain.Feishu,logger,loggerLevel:LoggerLevel.error,
      autoReconnect:true,handshakeTimeoutMs:10000,wsConfig:{pingTimeout:30},
      onReady:()=>{this.lastError='';},onReconnected:()=>{this.lastError='';},onError:()=>{this.lastError='飞书卡片通道连接失败';}});
    return this.client.start({eventDispatcher:dispatcher});
  }
  stop(){this.client?.close({force:true});this.client=null;}
}
