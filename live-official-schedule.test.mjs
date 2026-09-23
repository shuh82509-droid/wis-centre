import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialRoom,officialRooms,createOfficialLiveScheduleReader} from './live-official-schedule.mjs';
import {scheduleSessions} from './live-session-flow.mjs';
const room=officialRooms[0];
const rows=[['9月23日\n星期三','','','21:00-24:00'],['','','','主播甲'],['','','','21:00-24:00'],['','','','助理乙']];
test('末尾正式块、中文数字星期、24点及原表行号',()=>{
 const p=parseOfficialRoom(room,[['9月23日\n星期二'],[],...rows],'2026-09-23');
 assert.equal(p.source.firstRow,3);assert.deepEqual(p.room.anchors,[['21:00','00:00','主播甲']]);
 const numeric=structuredClone(rows);numeric[0][0]='9月23日\n星期3';assert.equal(parseOfficialRoom(room,numeric,'2026-09-23').source.firstRow,1);
});
test('缺少助理、空白人员和无效时间不回退旧块',()=>{
 for(const v of [[...rows,...rows.slice(0,2)],rows.map((r,i)=>i===1?['','','','']:r),rows.map((r,i)=>i===0?['9月23日','','','21:00-24:01']:r)])assert.throws(()=>parseOfficialRoom(room,v,'2026-09-23'));
});
test('不同年份和错误星期不串用',()=>{
 assert.throws(()=>parseOfficialRoom(room,rows.map((r,i)=>i===0?['2025年9月23日','','','21:00-24:00']:r),'2026-09-23'));
 assert.throws(()=>parseOfficialRoom(room,rows,'2026-09-24'));
});
test('官方只读班表可派工，但同名非直播中心人员不可串用',()=>{
 const p=parseOfficialRoom(room,rows,'2026-09-23'),now=Date.parse('2026-09-23T10:00:00+08:00');
 const r={date:'2026-09-23',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},writebackCapability:{enabled:false},rooms:[p.room],sourceStatus:{guanqi:{...p.source,revision:42}}};
 const people=['主播甲','助理乙'].map((name,i)=>({number:String(i),name,center:'直播中心',active:true,modules:['live-room-management','workflow-engine']}));
 assert.equal(scheduleSessions(r,r.date,people,now).length,1);
 assert.throws(()=>scheduleSessions(r,r.date,people.map(p=>({...p,center:'品牌营销中心'})),now));
});
test('源读取只访问指定工作簿，拒绝不同版本，失败不回退缓存',async()=>{
 let revision=7,calls=[];
 const read=createOfficialLiveScheduleReader({appId:'test',appSecret:'test',cacheMs:0,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'test',expire:7200}:{code:0,data:{revision:revision++,valueRange:{values:rows}}}};}});
 await assert.rejects(read(null,'2026-09-23'),/版本发生变化/);assert.equal(calls.length,5);
 assert.ok(calls.slice(1).every(u=>u.includes('/EuYqssm4WhNwAvtyybKcDdk1ned/values/')));
});

test('仅使用用户明确确认的简称，仍校验唯一身份和最小权限',()=>{
 const now=Date.parse('2026-09-23T10:00:00+08:00');
 const p=parseOfficialRoom(room,rows.map((r,i)=>i===1?['','','','梦怡']:i===3?['','','','佩娜']:r),'2026-09-23');
 const raw={date:'2026-09-23',updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},rooms:[p.room],sourceStatus:{guanqi:{...p.source,revision:42}}};
 const people=['曾梦怡','黄佩娜'].map((name,i)=>({number:String(i),name,center:'直播中心',active:true,modules:['live-room-management','workflow-engine']}));
 assert.equal(scheduleSessions(raw,raw.date,people,now)[0].anchor,'0');
 assert.throws(()=>scheduleSessions(raw,raw.date,[...people,{...people[0],number:'duplicate'}],now));
 assert.throws(()=>scheduleSessions(raw,raw.date,people.map(p=>({...p,modules:['live-room-management']})),now));
 const legacy={...raw,source:{},writebackCapability:{enabled:true}};
 assert.throws(()=>scheduleSessions(legacy,legacy.date,people,now));
});
