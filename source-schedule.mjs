// Scheduling is owned by the hub service, never a desktop session.
const hours={organization:[8,13,18],spark:[8]};
function slots(mode,now){
 if(!hours[mode])throw new Error('Unknown source mode');
 const day=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
 return hours[mode].map(h=>new Date(day+'T'+String(h).padStart(2,'0')+':30:00+08:00'));
}
export function nextSourceDue(mode,now=new Date()){
 return slots(mode,now).find(d=>d>now)||slots(mode,new Date(now.getTime()+86400000))[0];
}
export function latestSourceDue(mode,now=new Date()){
 return slots(mode,now).filter(d=>d<=now).at(-1)||slots(mode,new Date(now.getTime()-86400000)).at(-1);
}
