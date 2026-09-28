import {appendFileSync} from 'node:fs';
import {WorkflowStore} from '/app/workflow-store.mjs';
import {laneFixture,message} from './fixture-support.mjs';
const [journal,postLog,instant,text,mode]=process.argv.slice(2);
const store=new WorkflowStore(journal);
const fixture=laneFixture({store,now:Number(instant),messages:[message({text})],fetch:async({options})=>{
 appendFileSync(postLog,JSON.stringify({pid:process.pid,body:options.body})+'\n');
 if(mode==='exit-after-post')process.exit(23);
 await new Promise(resolve=>setTimeout(resolve,20));
 return {ok:true,status:200,json:async()=>({code:0,data:{message_id:'opaque-synthetic-child-id'}})};
}});
process.send?.({ready:true});
process.once('message',async()=>{await fixture.lane.tick();process.send?.({done:true,posts:fixture.counts.posts});process.disconnect?.();});
