import test from 'node:test';import assert from 'node:assert/strict';import {currentNodeNotice} from './flow-notice-validity.mjs';
const now=Date.parse('2026-09-23T12:00:00Z'),time=v=>new Date(now+v).toISOString();
const task={runtime:{state:'running',manager:{number:'M'}}};
const node=()=>({state:'ready',owner:{number:'B'},attempt:2,dueAt:time(-2*86400000),warnedAt:time(-86400000),escalatedAt:time(-3600000)});
for(const kind of ['ready','returned','overdue'])test(kind+' 改派后旧负责人不收通知',()=>{assert.equal(currentNodeNotice({kind,recipient:'A',attempt:2,createdAt:time(0)},task,node(),now),false);assert.equal(currentNodeNotice({kind,recipient:'B',attempt:2,createdAt:time(0)},task,node(),now),true);});
test('延期、旧轮次、旧预警和失效主管的提醒不发送',()=>{const notice={kind:'overdue',recipient:'B',attempt:2,createdAt:time(0)};assert.equal(currentNodeNotice(notice,task,{...node(),dueAt:time(5000)},now),false);assert.equal(currentNodeNotice({...notice,attempt:1},task,node(),now),false);assert.equal(currentNodeNotice({...notice,createdAt:time(-2*86400000)},task,node(),now),false);assert.equal(currentNodeNotice({...notice,kind:'escalated',recipient:'old-manager'},task,node(),now),false);});
test('昨日跨午夜直播已结束后不再发送今日晨卡，尚未结束的真实场次可发送',()=>{
 const morning=Date.parse('2026-09-24T08:00:00+08:00');
 const notice={kind:'live_today',recipient:'A',attempt:1,businessDate:'2026-09-24'};
 const execution={id:'W04.S4.E1',state:'pending',attempt:1,owner:{number:'A'}};
 const session={date:'2026-09-23',startAt:'2026-09-23T18:00:00.000Z',endAt:'2026-09-23T21:30:00.000Z'};
 const liveTask={runtime:{state:'running',liveSession:session}};
 assert.equal(currentNodeNotice(notice,liveTask,execution,morning),false);
 assert.equal(currentNodeNotice(notice,{runtime:{state:'running',liveSession:{...session,endAt:'2026-09-24T01:00:00.000Z'}}},execution,morning),true);
 assert.equal(currentNodeNotice(notice,{runtime:{state:'running',liveSession:{...session,endAt:new Date(morning).toISOString()}}},execution,morning),false);
});
