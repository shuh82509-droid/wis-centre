import test from 'node:test';import assert from 'node:assert/strict';import {currentNodeNotice} from './flow-notice-validity.mjs';
const now=Date.parse('2026-09-23T12:00:00Z'),time=v=>new Date(now+v).toISOString();
const task={runtime:{state:'running',manager:{number:'M'}}};
const node=()=>({state:'ready',owner:{number:'B'},attempt:2,dueAt:time(-2*86400000),warnedAt:time(-86400000),escalatedAt:time(-3600000)});
for(const kind of ['ready','returned','overdue'])test(kind+' 改派后旧负责人不收通知',()=>{assert.equal(currentNodeNotice({kind,recipient:'A',attempt:2,createdAt:time(0)},task,node(),now),false);assert.equal(currentNodeNotice({kind,recipient:'B',attempt:2,createdAt:time(0)},task,node(),now),true);});
test('延期、旧轮次、旧预警和失效主管的提醒不发送',()=>{const notice={kind:'overdue',recipient:'B',attempt:2,createdAt:time(0)};assert.equal(currentNodeNotice(notice,task,{...node(),dueAt:time(5000)},now),false);assert.equal(currentNodeNotice({...notice,attempt:1},task,node(),now),false);assert.equal(currentNodeNotice({...notice,createdAt:time(-2*86400000)},task,node(),now),false);assert.equal(currentNodeNotice({...notice,kind:'escalated',recipient:'old-manager'},task,node(),now),false);});
