import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {projectOrganizationSnapshot,ORGANIZATION_SOURCE_KEYS} from './organization-daily-sources.mjs';
import {rootMaterialRequest,normalizeRootMaterialUploads,rootMaterialSnapshotForDate,rootSourceRefreshState} from './organization-root-adapter.mjs';
import {officialBusinessRefreshState} from './dashboard-business-refresh.mjs';

// Execute the actual organization functions without starting the server or using any real identity, files, or upstream.
const source=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
function actualFunction(name){
 const start=source.indexOf('\nfunction '+name+'(')+1;
 assert.ok(start>0,'actual server function must exist: '+name);
 const end=source.indexOf('\n}',start)+2;
 assert.ok(end>start,'actual function must have a top-level closing brace');
 return source.slice(start,end);
}
const date='2026-09-08',time='2026-09-09T05:31:00Z',url='https://fixture.invalid/source';
const structure={sourceUrl:url,centers:['中心A','中心B'],leaders:[],snapshots:[],directors:[]};
const directory={sourceUrl:url,entries:[],guidance:{fields:[]}};
const records={sourceUrl:url,factsDate:date,items:[
 {id:'a',date,center:'中心A',title:'A可见会议',readState:'readable',transcriptUrl:url,todo:'核对交付'},
 {id:'b',date,center:'中心B',title:'B不可见会议',readState:'unverified',transcriptUrl:url,todo:null},
],sourceMode:'verified-source-table'};
const blankJob=()=>({businessDate:date,createdAt:Date.now(),updatedAt:Date.now(),pending:new Set(),results:{},attempts:{}});
function snapshot(){
 return {generationId:'fixture-daily',sources:{organization:structuredClone(structure),reportingDirectory:structuredClone(directory),
  meetingEvidence:structuredClone(records),meetingIntelligence:{profiles:[]}},
  status:Object.fromEntries(ORGANIZATION_SOURCE_KEYS.map(key=>[key,{state:'ready',lastAttemptAt:time,lastSuccessAt:time,
    factsDate:key.startsWith('meeting')?date:null,note:'已按来源读回'}])),scheduler:{lastAttemptAt:time,nextDueAt:'2026-09-09T10:30:00Z',updatedAt:time}};
}
function runtime(overrides={}){
 const context=vm.createContext({URL,URLSearchParams,Intl,Date,Set,Map,structuredClone,
  rootMaterialRequest,normalizeRootMaterialUploads,rootMaterialSnapshotForDate,rootSourceRefreshState,projectOrganizationSnapshot,officialBusinessRefreshState,
  organizationStructureSource:structure,dailyReportDirectorySource:directory,meetingArchiveSource:records,
  meetingIntelligenceSnapshot:{profiles:[]},workspacePolicySource:{url,verifiedAt:time,coverage:{oaActive:2,departmentMapped:2,blankModulePolicies:0}},
  memberDashboardForAccess:value=>value,longTermWorkFor:()=>({items:[],scheduler:{},generatedAt:null,sourceChat:{}}),
  ...overrides});
 const names=['organizationStructureFor','dailyReportDirectoryFor','meetingEvidenceFor','meetingIntelligenceFor',
  'normalizeRootDashboardRealtime','organizationDashboardPayload','stripPersonalRoutineData',
  'dashboardSelectedDate','dashboardSourceRequests','dashboardJobKey','startDashboardJob'];
 vm.runInContext(names.map(actualFunction).join('\n'),context);
 return context;
}
const department={scope:'department',label:'部门'};
const plain=value=>JSON.parse(JSON.stringify(value));
function material(day=date){
 return normalizeRootMaterialUploads({granularity:'day',startDate:day,endDate:day,items:[{period:day,onlineTotal:23,sourceUpdatedAt:time}]},{date:day,receivedAt:time});
}

test('requested day uses actual root aggregate; material and member windows honor 14/30 selected days',()=>{
 const r=runtime(),requests=r.dashboardSourceRequests(new URL('http://fixture.invalid?date='+date+'&days=30'));
 assert.equal(requests.materials.path,'/dashboard/material-online-trend?startDate='+date+'&endDate='+date);
 assert.match(requests.business.path,/days=30$/);
 assert.match(requests.members.path,/days=30$/);
 const fourteen=r.dashboardSourceRequests(new URL('http://fixture.invalid?date='+date+'&days=14'));
 assert.match(fourteen.business.path,/days=14$/);assert.match(fourteen.members.path,/days=14$/);
 assert.throws(()=>r.dashboardSourceRequests(new URL('http://fixture.invalid?date=2026-02-30')));
});
test('dynamic daily sources replace old date and derive actual coverage without scores',()=>{
 const r=runtime(),result=r.organizationDashboardPayload(blankJob(),department,null,snapshot());
 assert.equal(result.meetingEvidence.snapshotDate,date);
 assert.equal(result.meetingEvidence.readableRecords,1);
 assert.equal(result.meetingEvidence.unverifiedRecords,1);
 assert.equal(result.meetingIntelligence.summary.heatScore,null);
 assert.match(result.meetingIntelligence.profiles[0].summary,/1 条记录包含明确 TODO/);
 assert.match(result.sources.find(s=>s.key==='transcripts').note,/缺足够评分依据/);
 assert.equal(result.sourceCoverage.verifiedAt,time);
});
test('center and personal views cannot leak other center meetings through counts, profiles, or source ledger',()=>{
 const r=runtime();
 for(const access of [{scope:'center',centers:['中心A'],label:'中心A'},{scope:'personal',personName:'测试本人'}]){
  const result=r.organizationDashboardPayload(blankJob(),access,null,snapshot());
  assert.ok(!JSON.stringify(result).includes('B不可见会议'));
  assert.equal(result.meetingEvidence.totalRecords,null);
  assert.equal(result.meetingEvidence.dailyRecords,access.scope==='center'?1:0);
  assert.equal(result.meetingIntelligence.profiles.length,access.scope==='center'?1:0);
  assert.equal(result.reportingDirectory.entries.length,0);
  assert.ok(!('items' in result.sourceRefresh));
 }
});
test('fresh organization drawing with no readable roster never fabricates center directory or leaders',()=>{
 const s=snapshot();s.sources.organization={...structure,centers:[],leaders:[],snapshots:[{headcount:91,snapshotMonth:'2026-04'}]};
 const result=runtime().organizationDashboardPayload(blankJob(),department,null,s);
 assert.deepEqual(plain(result.organization.centers),[]);
 assert.match(result.sources.find(s=>s.key==='organization').coverage,/画板中的中心名单待核验/);
 assert.equal(result.organization.snapshots[0].snapshotMonth,'2026-04');
});
test('same-day failed refresh preserves facts and separate failure status; observations remain unconfirmed',()=>{
 const job=blankJob();job.results.materials={status:200,payload:material()};job.attempts.materials={status:503,payload:{detail:'fixture failure'}};
 const result=runtime().organizationDashboardPayload(job,department,null,snapshot());
 assert.equal(result.materialUploads.channels[0].observedAssets,23);
 assert.equal(result.materialUploads.channels[0].confirmedAssets,null);
 assert.equal(result.materialUploads.status,'stale');
 assert.equal(result.rootRefresh.materials.failureStatus,503);
 assert.match(result.sources.find(s=>s.key==='materials').note,/HTTP 503/);
});
test('successful HTTP does not turn partial material evidence into ready or fill missing source time',()=>{
 const job=blankJob(),value=material();value.generatedAt=null;
 job.results.materials=job.attempts.materials={status:200,payload:value};
 const result=runtime().organizationDashboardPayload(job,department,null,snapshot());
 assert.equal(result.materialUploads.status,'partial');
 assert.equal(result.sources.find(s=>s.key==='materials').state,'partial');
 assert.equal(result.sources.find(s=>s.key==='materials').updatedAt,null);
 assert.notEqual(result.status,'ready');
});
test('different-date caches are excluded and business actual date is never relabeled',()=>{
 const job=blankJob();job.results.materials={status:200,payload:material('2026-09-01')};
 job.results.business={status:200,payload:{status:'ready',query:{productDate:'2026-09-01'},coverage:{warnings:[]}}};
 const result=runtime().organizationDashboardPayload(job,department,null,snapshot());
  assert.equal(result.materialUploads,null);
  assert.equal(result.rootRefresh.materials.state,'pending');
  assert.equal(result.rootRefresh.materials.failureStatus,502);
 assert.equal(result.business.query.productDate,'2026-09-01');
 assert.equal(result.business.status,'stale');
 assert.equal(result.rootRefresh.dateMismatch,true);
 assert.match(result.sources.find(s=>s.key==='root-data').note,/2026-09-08.*2026-09-01/);
 assert.equal(job.results.business.payload.status,'ready','presentation must not mutate source results');
});
test('missing daily publication stays visibly unverified and has no fabricated current success time',()=>{
 const result=runtime().organizationDashboardPayload(blankJob(),department,null,null);
 assert.equal(result.sourceCoverage.verifiedAt,null);
 assert.equal(result.sourceRefresh.scheduler,null);
 assert.equal(result.sources.find(s=>s.key==='meetings').state,'stale');
});
test('realtime partial channels and absent source timestamps are not treated as ready',()=>{
 const result=runtime().normalizeRootDashboardRealtime({status:'ready',channels:[
  {key:'douyin',todayTotalYuan:1,state:'partial'},{key:'wechat',todayTotalYuan:2,state:'partial'}]});
 assert.equal(result.status,'partial');assert.equal(result.generatedAt,null);
});
test('job failure retains same-day cached material and retry evidence without writing unsuccessful replacement',async()=>{
 const writes=[],r=runtime({
  dashboardJobs:new Map(),dashboardJobTtlMs:60000,dashboardJobLimit:10,sessionCacheKey:()=> 'fixture-session',
  transientAuthorityFailure:()=>false,readRootDashboardRealtimeSnapshot:()=>null,readRootMaterialUploadsSnapshot:()=>material(),
  writeRootMaterialUploadsSnapshot:v=>writes.push(v),writeRootDashboardRealtimeSnapshot:()=>{},
  callRootDashboard:async()=>({status:503,payload:{detail:'fixture unavailable'}}),
  callAuthority:async()=>({status:503,payload:{detail:'fixture unavailable'}}),
 });
 const job=r.startDashboardJob({},new URL('http://fixture.invalid?date='+date));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(job.pending.size,0);assert.equal(job.results.materials.payload.date,date);
 assert.equal(job.attempts.materials.status,503);assert.equal(writes.length,0);
 const next=r.startDashboardJob({},new URL('http://fixture.invalid?date=2026-09-07'));
 assert.notEqual(job,next,'different business dates must not share aggregation jobs');
});
