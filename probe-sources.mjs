import {readCloud,readRemix} from './flow-sources.mjs';
for(const [type,fn,path] of [['cloud',readCloud,'/sources/cloud/wis_video_center.db'],['remix',readRemix,'/sources/remix/library.json']]){
 try{const d=fn(path);console.log(JSON.stringify({type,state:d.state,counts:Object.fromEntries(Object.entries(d).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),people:d.people?.filter(p=>p.number==='FD-026222'),inventory:d.inventory,jobs:d.jobs?.map(j=>({id:j.id,product:j.product,owner:j.owner,state:j.state,target:j.dailyTarget,last:j.runs[0]}))}));}catch(e){console.error(type,e.message);process.exitCode=1;}
}
