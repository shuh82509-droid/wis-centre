import {createHash} from 'node:crypto';
import {OpeningNotifications,createOpeningSender} from '/app/opening-notifications.mjs';
export const clone=structuredClone;
export function message(overrides={}){
 const result={kind:'direct',date:'2026-09-29',room:'Fixture room A',roomCode:'fixture_a',recipient:{id:'ou_fixture_a',type:'open_id',name:'Fixture only'},text:'Synthetic notification; not a business task',...overrides};
 result.key=overrides.key||createHash('sha256').update(JSON.stringify([result.date,result.roomCode,result.kind,result.recipient.id,result.text])).digest('hex');
 return result;
}
export function plan(messages){return {date:messages[0]?.date||'2026-09-29',messages:clone(messages),rooms:[],issues:[],disabledRooms:[]};}
export class MemoryStore{
 constructor(rows=[],options={}){this.state={schemaVersion:3,tasks:[],openingReceipts:clone(rows),fixturePreserved:{unknownCount:7,personAck:'synthetic-only'}};this.options=options;this.events=[];}
 read(){
  const result=clone(this.state);
  this.options.onRead?.(this,result);
  if(this.options.readFail?.(result)){this.options.readFail=null;throw Error('fixture read failure');}
  return result;
 }
 transaction(mutate){
  const next=clone(this.state),result=mutate(next),old=this.state.openingReceipts||[],rows=next.openingReceipts||[];
  const change=rows.find(r=>{const previous=old.find(o=>o.key===r.key);return !previous||JSON.stringify(previous)!==JSON.stringify(r);});
  const previous=change&&old.find(r=>r.key===change.key);
  const phase=!change?'status':!previous?'prepared':change.postIntentAt&&!previous.postIntentAt?'intent':'result';
  this.events.push({phase,rows:clone(rows)});
  const fault=this.options.fault;
  if(fault?.phase===phase&&fault.mode==='before'){this.options.fault=null;throw Error('fixture persistence failure before commit');}
  this.state=next;
  this.options.onCommit?.(this,phase);
  if(fault?.phase===phase&&fault.mode==='after'){this.options.fault=null;throw Error('fixture persistence failure after commit');}
  return clone(result);
 }
}
export function laneFixture({store=new MemoryStore(),messages=[message()],now=Date.parse('2026-09-28T16:00:00+08:00'),token,fetch,enabled=true,customSend,readPlan}={}){
 const counts={sendCalls:0,posts:0,tokens:0,plans:0};
 const clock={now};
 const notifier={enabled:true,appId:'cli_aa9c744d6ffa1cc4',tenantToken:async()=>{counts.tokens++;return token?token(clock):'synthetic-token-never-real';},fetch:async(url,options)=>{counts.posts++;return fetch?fetch({url,options,clock,store,counts}):{ok:true,status:200,json:async()=>({code:0,data:{message_id:'opaque-synthetic-message-id'}})};}};
 const actualSend=createOpeningSender(notifier);
 const lane=new OpeningNotifications({store,readSchedule:()=>{throw Error('fixture plan reader is explicitly substituted');},participants:()=>{throw Error('fixture plan reader is explicitly substituted');},send:async(...args)=>{counts.sendCalls++;return customSend?customSend(...args):actualSend(...args);},clock:()=>clock.now,enabled});
 lane.plan=async()=>{counts.plans++;return readPlan?readPlan(counts.plans,clock):plan(messages);};
 return {lane,store,clock,counts,messages,notifier};
}
export function legacyRow(msg,overrides={}){return {key:msg.key,date:msg.date,room:msg.room,kind:msg.kind,recipientId:msg.recipient.id,firstAttemptAt:'2026-09-28T08:00:00Z',uuid:msg.key.slice(0,32),attempts:1,state:'uncertain',unknown:true,fixtureExtra:{preserve:'unchanged'},...overrides};}
