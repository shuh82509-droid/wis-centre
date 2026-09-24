import {createHash} from 'node:crypto';

export function sourceSignature(data,people){
 return createHash('sha256').update(JSON.stringify({people:data.people,runtimePeople:people,baselines:data.baselines,
  creative:data.creative,cloud:data.cloud,remix:data.remix,notificationsEnabled:data.notificationsEnabled})).digest('hex');
}
export function verifiedSources(state,since){
 return new Map(state.tasks.flatMap(t=>{
  const source=t.runtime?.creative||t.runtime?.localBusiness;
  return source&&!source.issue&&Date.parse(source.checkedAt)>=since?[[t.id,{signature:source.signature,key:t.runtime.sourceKey,version:t.version}]]:[];
 }));
}
// Reusing an identical source snapshot never validates a task changed after
// its last full source read. Those tasks wait for the next full sync.
export function heartbeatSources(state,verified,at){
 const renewed=new Set();
 for(const task of state.tasks){
  const known=verified.get(task.id),source=task.runtime?.creative||task.runtime?.localBusiness;
  if(!known||!source||source.issue||source.signature!==known.signature||task.runtime.sourceKey!==known.key||task.version!==known.version)continue;
  source.checkedAt=at;renewed.add(task.id);
 }
 for(const watch of state.creativeWatches||[])if(renewed.has(watch.taskId)&&!watch.issue)watch.checkedAt=at;
 return renewed.size;
}
