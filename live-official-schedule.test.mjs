import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialRoom,officialRooms,createOfficialLiveScheduleReader} from './live-official-schedule.mjs';
import {scheduleSessions} from './live-session-flow.mjs';
const room=officialRooms[0];
const participants={verified:()=>true,canOwn:()=>true};
const rows=[['9月23日\n星期三','','','21:00-24:00'],['','','','主播甲'],['','','','21:00-24:00'],['','','','助理乙']];
test('末尾正式块、中文数字星期、24点及原表行号',()=>{
 const p=parseOfficialRoom(room,[['9月23日\n星期二'],[],...rows],'2026-09-23');
 assert.equal(p.source.firstRow,3);assert.deepEqual(p.room.anchors,[['21:00','00:00','主播甲']]);
 const numeric=structuredClone(rows);numeric[0][0]='9月23日\n星期3';assert.equal(parseOfficialRoom(room,numeric,'2026-09-23').source.firstRow,1);
});
test('缺少助理、空白人员和无效时间不回退旧块',()=>{
 for(const v of [[...rows,...rows.slice(0,2)],rows.map((r,i)=>i===1?['','','','']:r),rows.map((r,i)=>i===0?['9月23日','','','21:00-24:01']:r)])assert.throws(()=>parseOfficialRoom(room,v,'2026-09-23'));
});
test('官旗正式特殊日保留单主播班次，逐段标记共播并合并两套助理',()=>{
 const actual=[
  ['9月25日\n星期五','wis官旗','时间','05:30-07:00','07:00-08:00','08:00-10:00','10:00-11:00','11:00-13:00','13:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00','20:00-23:00','23:00-24:00','24:00-02:00','02:00-05:30'],
  ['','','主播','丁阳虹','丁阳虹&曹总（老板场）','潘小慧&曹总（老板场）','丁阳虹&曹总（老板场）','丁阳虹','潘小慧','潘小慧&曹总（老板场）','林惠敏','李晓茏','林惠敏&曹总（老板场）','李晓茏&曹总（老板场）','李晓茏','林羽浠'],
  ['','','','5:30-10：10','10：10-15：00','15：00-19：50','19：50-0：30','00：30-5：30'],
  ['','','','韦彩云','林梓烁','曾睿琳','杨冰','尹珩瑞'],
  ['','','','7:00-11：00','14：00-15：00','15：00-16：00','20：00-00：00'],
  ['','','','蒙万叶','蒙万叶','陈嘉欣','陈嘉欣'],
 ];
 const p=parseOfficialRoom(room,actual,'2026-09-25');
 assert.equal(p.room.anchors.length,13);assert.equal(p.issues.length,0);
 assert.deepEqual(p.room.anchors.filter(x=>x[3]).map(x=>x[3]),Array(6).fill('曹总（老板场）'));
 assert.deepEqual(p.room.anchors.at(-2),['00:00','02:00','李晓茏']);
 assert.equal(p.room.assistants.length,9);
 assert.deepEqual(p.room.assistants.map(x=>x[0]),['05:30','07:00','10:10','14:00','15:00','15:00','19:50','20:00','00:30']);
 const now=Date.parse('2026-09-24T08:00:00+08:00'),people=[...new Set([...p.room.anchors,...p.room.assistants].map(x=>x[2]))].map((name,i)=>({name,number:String(i),active:true,center:'直播中心',modules:['live-room-management','workflow-engine']}));
 const raw={date:'2026-09-25',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},rooms:[p.room],sourceStatus:{guanqi:{...p.source,revision:189095}}};
 const sessions=scheduleSessions(raw,raw.date,people,now,participants);
 assert.equal(sessions.length,13);
 assert.equal(sessions.filter(s=>s.cohostDisplay).length,6);
 assert.ok(sessions.every(s=>s.anchor!==undefined&&s.assistants.length>0));
 assert.equal(sessions.find(s=>s.startAt==='2026-09-25T16:00:00.000Z').assistants.length,2);
});
test('未经确认的共播名字保持待核验，不给第二人派工',()=>{
 const changed=rows.map((r,i)=>i===1?['','','','主播甲&其他人']:r);
 const p=parseOfficialRoom(room,changed,'2026-09-23');
 assert.equal(p.room.anchors.length,0);
 assert.equal(p.issues[0].code,'cohost_requires_manual_identity');
});
test('常见连接号可解析；形似班次的错误时间不能被静默漏派',()=>{
 const withEnDash=rows.map((r,i)=>i===0?['9月23日\n星期三','','','21:00–24:00']:r);
 assert.deepEqual(parseOfficialRoom(room,withEnDash,'2026-09-23').room.anchors,[['21:00','00:00','主播甲']]);
 const malformed=[['9月23日\n星期三','','','09:00-10:00','10:00–11.00'],['','','','主播甲','主播乙'],['','','','09:00-11:00'],['','','','助理丙']];
 assert.throws(()=>parseOfficialRoom(room,malformed,'2026-09-23'),/班表时间格式无法核验/);
});
test('不同年份和错误星期不串用',()=>{
 assert.throws(()=>parseOfficialRoom(room,rows.map((r,i)=>i===0?['2025年9月23日','','','21:00-24:00']:r),'2026-09-23'));
 assert.throws(()=>parseOfficialRoom(room,rows,'2026-09-24'));
});
test('官方只读班表可派工，但同名非直播中心人员不可串用',()=>{
 const p=parseOfficialRoom(room,rows,'2026-09-23'),now=Date.parse('2026-09-23T10:00:00+08:00');
 const r={date:'2026-09-23',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},writebackCapability:{enabled:false},rooms:[p.room],sourceStatus:{guanqi:{...p.source,revision:42}}};
 const people=['主播甲','助理乙'].map((name,i)=>({number:String(i),name,center:'直播中心',active:true,modules:['live-room-management','workflow-engine']}));
 assert.equal(scheduleSessions(r,r.date,people,now,participants).length,1);
 assert.throws(()=>scheduleSessions(r,r.date,people.map(p=>({...p,center:'品牌营销中心'})),now,participants));
});
test('源读取只访问指定工作簿，拒绝不同版本，失败不回退缓存',async()=>{
 let revision=7,calls=[];
 const read=createOfficialLiveScheduleReader({appId:'test',appSecret:'test',cacheMs:0,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'test',expire:7200}:{code:0,data:{revision:revision++,valueRange:{values:rows}}}};}});
 await assert.rejects(read(null,'2026-09-23'),/版本发生变化/);assert.equal(calls.length,5);
 assert.ok(calls.slice(1).every(u=>u.includes('/EuYqssm4WhNwAvtyybKcDdk1ned/values/')));
});

test('次日通知显式 fresh 读取绕过仍未过期的班表缓存',async()=>{
 let revision=9,roomReads=0;
 const read=createOfficialLiveScheduleReader({appId:'test',appSecret:'test',cacheMs:60000,fetchImpl:async url=>{
   if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'token',expire:7200});
   roomReads++;return Response.json({code:0,data:{revision,valueRange:{values:rows}}});
 }});
 const first=await read(null,'2026-09-23');assert.equal(first.sourceStatus.guanqi.revision,9);
 await read(null,'2026-09-23');assert.equal(roomReads,4,'normal preview uses cache');
 revision=10;
 const fresh=await read(null,'2026-09-23',{fresh:true});
 assert.equal(roomReads,8,'notification re-reads every official room');
 assert.equal(fresh.sourceStatus.guanqi.revision,10);
});

test('fresh 读取不复用旧请求，较慢的旧请求也不能反向覆盖新缓存',async()=>{
 let releaseOld,enteredOld,roomReads=0;
 const oldGate=new Promise(resolve=>{releaseOld=resolve;});
 const oldEntered=new Promise(resolve=>{enteredOld=resolve;});
 const read=createOfficialLiveScheduleReader({appId:'test',appSecret:'test',cacheMs:60000,fetchImpl:async url=>{
   if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'token',expire:7200});
   const call=++roomReads;
   if(call===1){enteredOld();await oldGate;}
   return Response.json({code:0,data:{revision:call===1||call>=6?9:10,valueRange:{values:rows}}});
 }});
 const old=read(null,'2026-09-23');await oldEntered;
 const fresh=await read(null,'2026-09-23',{fresh:true});
 assert.equal(fresh.sourceStatus.guanqi.revision,10);
 releaseOld();assert.equal((await old).sourceStatus.guanqi.revision,9);
 assert.equal((await read(null,'2026-09-23')).sourceStatus.guanqi.revision,10);
 assert.equal(roomReads,8);
});

test('仅使用用户明确确认的简称，仍校验唯一身份和最小权限',()=>{
 const now=Date.parse('2026-09-23T10:00:00+08:00');
 const p=parseOfficialRoom(room,rows.map((r,i)=>i===1?['','','','梦怡']:i===3?['','','','佩娜']:r),'2026-09-23');
 const raw={date:'2026-09-23',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},rooms:[p.room],sourceStatus:{guanqi:{...p.source,revision:42}}};
 const people=['曾梦怡','黄佩娜'].map((name,i)=>({number:String(i),name,center:'直播中心',active:true,modules:['live-room-management','workflow-engine']}));
 assert.equal(scheduleSessions(raw,raw.date,people,now,participants)[0].anchor,'0');
 assert.throws(()=>scheduleSessions(raw,raw.date,[...people,{...people[0],number:'duplicate'}],now,participants));
 assert.equal(scheduleSessions(raw,raw.date,people.map(p=>({...p,modules:['live-room-management']})),now,participants).length,1);
 assert.throws(()=>scheduleSessions(raw,raw.date,people,now,{verified:()=>true,canOwn:()=>false}),/飞书卡片身份绑定/);
 const legacy={...raw,source:{},writebackCapability:{enabled:true}};
 assert.throws(()=>scheduleSessions(legacy,legacy.date,people,now,participants));
});
