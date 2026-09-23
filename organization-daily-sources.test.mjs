import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OrganizationSourceStore,ORGANIZATION_SOURCE_KEYS,MEETING_RECORD_FIELD_IDS,
 validateSourceData,validateManifest,validateStatus,projectOrganizationSnapshot,meetingEvidenceFromCli} from './organization-daily-sources.mjs';

const readAt='2026-09-09T05:30:00Z',successAt='2026-09-09T05:31:00Z',publishedAt='2026-09-09T05:32:00Z';
const now='2026-09-09T06:00:00Z',businessDate='2026-09-08',sourceUrl='https://fixture.invalid/source';
const hash=data=>createHash('sha256').update(data).digest('hex');
const metadata=()=>({identity:'user',readAt,sourceUrl,rawSha256:hash('isolated source read')});
function records(){
 const field_id_list=Object.values(MEETING_RECORD_FIELD_IDS);
 return {ok:true,identity:'user',data:{has_more:false,rev:5019,field_id_list,record_id_list:['fixture-record-1'],
  data:[['2026-09-08T00:00:00.000+08:00','示例中心早会',['中心A'],['品牌营销部'],
   '[文字记录](https://fixture.invalid/transcript)','[纪要](https://fixture.invalid/minutes)',
   '[录音](https://fixture.invalid/recording)','核对原交付记录']]}};
}
function meeting(){
 return meetingEvidenceFromCli(records(),{factsDate:businessDate,readAt,sourceUrl,rawSha256:hash('fixture CLI response')});
}
function organization(){
 return {factsDate:null,sourceMetadata:metadata(),centers:['中心A','中心B'],
  leaders:[{center:'中心A',name:'示例A'},{center:'中心B',name:'示例B'}],
  directors:[{name:'示例总监'}],snapshots:[{headcount:12,snapshotMonth:'2026-04'}]};
}
function directory(){
 return {factsDate:null,sourceMetadata:metadata(),entries:[
  {center:'中心A',owner:'示例A',reports:[{title:'示例日报',url:'https://fixture.invalid/report-a'}],dashboards:[]},
  {center:'中心B',owner:'示例B',reports:[],dashboards:[]}]};
}
function intelligence(){
 return {factsDate:businessDate,sourceMetadata:metadata(),profiles:[
  {center:'中心A',evidence:[],vitalityScore:null,heatScore:null,saturationScore:null},
  {center:'中心B',evidence:[],vitalityScore:null,heatScore:null,saturationScore:null}]};
}
function status(overrides={}){
 return {schemaVersion:1,lastAttemptAt:readAt,updatedAt:publishedAt,nextDueAt:'2026-09-09T10:30:00Z',
  requiredBusinessDate:businessDate,sources:Object.fromEntries(ORGANIZATION_SOURCE_KEYS.map(key=>[key,{
   state:'ready',lastAttemptAt:readAt,lastSuccessAt:successAt,
   factsDate:key.startsWith('meeting')?businessDate:null,error:null,...overrides[key]}]))};
}
const item=data=>({data,lastSuccessAt:successAt,sourceRevision:5019});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'organization-sources-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new OrganizationSourceStore(root);
 return {root,store,publish:async(sources={organization:item(organization()),reportingDirectory:item(directory()),
  meetingEvidence:item(meeting()),meetingIntelligence:item(intelligence())})=>{
  const result=await store.publish({generationId:'generation-1',publishedAt,sources});
  await store.writeStatus(status());return result;
 }};
}

test('CLI field IDs and aligned data/record arrays normalize the verified sample shape',()=>{
 const result=meeting();
 assert.equal(result.items[0].id,'fixture-record-1');
 assert.equal(result.items[0].transcriptUrl,'https://fixture.invalid/transcript');
 assert.equal(result.items[0].todo,'核对原交付记录');
 assert.equal(result.items[0].readState,'unverified');
 assert.equal(result.readableRecords,0);assert.equal(result.unverifiedRecords,1);
 assert.equal(result.sourceMetadata.tableId,'tblLfhIgmidjXyve');
});
test('reordered field columns use their IDs rather than names or positions',()=>{
 const input=records();input.data.field_id_list.reverse();input.data.data[0].reverse();
 assert.equal(meetingEvidenceFromCli(input,{factsDate:businessDate,readAt,sourceUrl,rawSha256:hash('sample')}).items[0].title,'示例中心早会');
});
for(const [name,mutate] of [
 ['unfinished pagination',v=>{v.data.has_more=true;}],
 ['missing completeness',v=>{delete v.data.has_more;}],
 ['mismatched record IDs',v=>{v.data.record_id_list=[];}],
 ['missing cells',v=>{v.data.data[0].pop();}],
 ['missing field ID',v=>{v.data.field_id_list[0]='unknown';}],
 ['duplicate field ID',v=>{v.data.field_id_list[0]=v.data.field_id_list[1];}],
 ['different day',v=>{v.data.data[0][0]='2026-09-09T00:00:00+08:00';}],
 ['different department',v=>{v.data.data[0][3]=['其他部门'];}],
 ['bot identity',v=>{v.identity='bot';}],
 ['failed response',v=>{v.ok=false;}],
])test('reject '+name+' rather than publish empty/current facts',()=>{
 const input=records();mutate(input);
 assert.throws(()=>meetingEvidenceFromCli(input,{factsDate:businessDate,readAt,sourceUrl,rawSha256:hash('fixture')}));
});
test('Shanghai business date accepts prior UTC day at local midnight',()=>{
 const input=records();input.data.data[0][0]='2026-09-07T16:00:00Z';
 assert.equal(meetingEvidenceFromCli(input,{factsDate:businessDate,readAt,sourceUrl,rawSha256:hash('fixture')}).items[0].date,businessDate);
});
test('readability requires a hash, timestamp and this actual transcript URL',()=>{
 const data=meeting();data.items[0].readState='readable';data.readableRecords=1;data.unverifiedRecords=0;
 assert.throws(()=>validateSourceData('meetingEvidence',data));
 data.items[0].readEvidence={sha256:hash('transcript'),readAt,sourceUrl:'https://fixture.invalid/unrelated'};
 assert.throws(()=>validateSourceData('meetingEvidence',data));
 data.items[0].readEvidence.sourceUrl=data.items[0].transcriptUrl;
 assert.equal(validateSourceData('meetingEvidence',data),data);
 data.readableRecords=20;assert.throws(()=>validateSourceData('meetingEvidence',data));
});
test('provenance is required and source collection never invents performance scores',()=>{
 const data=organization();delete data.sourceMetadata.rawSha256;
 assert.throws(()=>validateSourceData('organization',data));
 data.sourceMetadata=metadata();data.sourceMetadata.access_token='not-a-real-credential';
 assert.throws(()=>validateSourceData('organization',data));
 const analysis=intelligence();analysis.profiles[0].saturationScore=100;
 assert.throws(()=>validateSourceData('meetingIntelligence',analysis));
});
test('first atomic publication/readback has four keys and independent reference/business dates',async t=>{
 const f=await fixture(t);await f.publish();
 const result=await f.store.read({requiredBusinessDate:businessDate,now});
 assert.equal(result.generationId,'generation-1');
 assert.equal(result.status.meetingEvidence.state,'ready');
 assert.equal(result.status.organization.factsDate,null);
 assert.match(result.status.organization.note,/参考资料/);
 assert.equal(result.sources.meetingEvidence.readableRecords,0);
 assert.equal((await stat(join(f.root,'manifest.json'))).isFile(),true);
 assert.equal((await readdir(f.root)).some(v=>v.startsWith('.tmp')),false);
});
test('missing publication remains pending without fake zero facts',async t=>{
 const f=await fixture(t),result=await f.store.read({requiredBusinessDate:businessDate,now});
 for(const key of ORGANIZATION_SOURCE_KEYS){assert.equal(result.sources[key],null);assert.equal(result.status[key].state,'pending');}
});
test('failed daily attempt retains immutable successful facts and original success timestamp',async t=>{
 const f=await fixture(t);await f.publish();const before=await readFile(join(f.root,'manifest.json'));
 await f.store.writeStatus(status({meetingEvidence:{state:'failed',lastAttemptAt:'2026-09-09T05:40:00Z',error:'原文访问待恢复'}}));
 const after=await f.store.read({requiredBusinessDate:businessDate,now});
 assert.equal(after.status.meetingEvidence.state,'stale');
 assert.equal(after.status.meetingEvidence.lastSuccessAt,successAt);
 assert.equal(after.sources.meetingEvidence.items.length,1);
 assert.deepEqual(await readFile(join(f.root,'manifest.json')),before);
});
test('partial result from the same successful attempt is not mislabelled ready',async t=>{
 const f=await fixture(t);await f.publish();
 await f.store.writeStatus(status({meetingEvidence:{state:'partial'}}));
 const result=await f.store.read({requiredBusinessDate:businessDate,now});
 assert.equal(result.status.meetingEvidence.state,'partial');
});
test('an older attempt cannot overwrite a later scheduler result',async t=>{
 const f=await fixture(t);await f.publish();const before=await readFile(join(f.root,'status.json'));
 const old=status();old.lastAttemptAt='2026-09-08T05:30:00Z';
 await assert.rejects(f.store.writeStatus(old),/Older attempt/);
 assert.deepEqual(await readFile(join(f.root,'status.json')),before);
});
test('new requested business day is stale even if status claims ready',async t=>{
 const f=await fixture(t);await f.publish();
 const result=await f.store.read({requiredBusinessDate:'2026-09-09',now});
 assert.equal(result.status.meetingEvidence.state,'stale');
 assert.equal(result.status.meetingEvidence.matchesBusinessDate,false);
 assert.match(result.status.meetingEvidence.note,/2026-09-09.*2026-09-08/);
 assert.equal(result.sources.meetingEvidence.factsDate,'2026-09-08');
});
test('overdue schedule is surfaced independently of matching content date',async t=>{
 const f=await fixture(t);await f.publish();
 const result=await f.store.read({requiredBusinessDate:businessDate,now:'2026-09-09T11:00:00Z'});
 assert.equal(result.status.organization.scheduleOverdue,true);
 assert.equal(result.status.organization.state,'stale');
 assert.equal(result.status.meetingEvidence.matchesBusinessDate,true);
});
test('unverified source object is rejected and previous process-verified value remains',async t=>{
 const f=await fixture(t),manifest=await f.publish();
 await f.store.read({requiredBusinessDate:businessDate,now});
 await writeFile(join(f.root,manifest.sources.meetingEvidence.file),'{"tampered":true}');
 const result=await f.store.read({requiredBusinessDate:businessDate,now});
 assert.equal(result.sources.meetingEvidence.items[0].id,'fixture-record-1');
 assert.equal(result.status.meetingEvidence.state,'stale');
 const cold=await new OrganizationSourceStore(f.root).read({requiredBusinessDate:businessDate,now});
 assert.equal(cold.sources.meetingEvidence,null);assert.equal(cold.status.meetingEvidence.state,'pending');
});
test('partial source publication preserves other last-success objects',async t=>{
 const f=await fixture(t),first=await f.publish(),data=organization();data.centers.push('中心C');
 const next=await f.store.publish({generationId:'generation-2',publishedAt,sources:{organization:item(data)},expectedGeneration:'generation-1'});
 assert.deepEqual(next.sources.meetingEvidence,first.sources.meetingEvidence);
 assert.notEqual(next.sources.organization.sha256,first.sources.organization.sha256);
 assert.equal(next.sources.organization.file,'objects/'+next.sources.organization.sha256+'.json');
});
test('old generation cannot overwrite a newer publication and unknown locks stay intact',async t=>{
 const f=await fixture(t);await f.publish();const before=await readFile(join(f.root,'manifest.json'));
 await assert.rejects(f.store.publish({generationId:'stale',publishedAt,sources:{organization:item(organization())},expectedGeneration:null}),/generation changed/);
 assert.deepEqual(await readFile(join(f.root,'manifest.json')),before);
 await writeFile(join(f.root,'.publication.lock'),'foreign publication lock');
 await assert.rejects(f.store.publish({generationId:'next',publishedAt,sources:{organization:item(organization())},expectedGeneration:'generation-1'}),/EEXIST/);
 assert.equal(await readFile(join(f.root,'.publication.lock'),'utf8'),'foreign publication lock');
});
test('invalid new source cannot remove an existing source or commit a new generation',async t=>{
 const f=await fixture(t);await f.publish();const before=await readFile(join(f.root,'manifest.json'));
 await assert.rejects(f.store.publish({generationId:'next',publishedAt,sources:{meetingEvidence:null},expectedGeneration:'generation-1'}));
 assert.deepEqual(await readFile(join(f.root,'manifest.json')),before);
});
test('partial views derive no permissions from collected names and hide unrelated records/totals',async t=>{
 const f=await fixture(t);await f.publish();const snapshot=await f.store.read({requiredBusinessDate:businessDate,now});
 snapshot.sources.organization.rawUnrelatedText='must not leak';
 snapshot.sources.meetingEvidence.totalRecords=966;
 const center=projectOrganizationSnapshot(snapshot,{scope:'center',centers:['中心A']});
 assert.deepEqual(center.sources.organization.centers,['中心A']);
 assert.equal(center.sources.organization.rawUnrelatedText,undefined);
 assert.deepEqual(center.sources.organization.snapshots,[]);
 assert.equal(center.sources.reportingDirectory.entries.length,1);
 assert.equal(center.sources.meetingEvidence.totalRecords,undefined);
 const personal=projectOrganizationSnapshot(snapshot,{scope:'personal',personName:'示例总监'});
 assert.deepEqual(personal.sources.meetingEvidence.items,[]);
 assert.deepEqual(personal.sources.reportingDirectory.entries,[]);
 const denied=projectOrganizationSnapshot(snapshot,{scope:'unknown'});
 assert.equal(denied.sources.organization,null);
 assert.equal(snapshot.sources.organization.centers.length,2);
});
test('manifest paths and malformed status do not bypass content verification',()=>{
 assert.throws(()=>validateManifest({schemaVersion:1,generationId:'../outside',publishedAt,sources:{}}));
 const s=status();s.sources.meetingEvidence.lastAttemptAt='not a date';
 assert.throws(()=>validateStatus(s));
});
