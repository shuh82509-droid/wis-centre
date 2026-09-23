import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,renameSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCloudReader,readCloud} from './flow-sources.mjs';
import {createSourceExporter} from './flow-source-export.mjs';

export const fixtureSchema=`
 CREATE TABLE oa_access_grants(identifier TEXT,real_name TEXT,user_number TEXT,department TEXT,center TEXT,active INTEGER);
 CREATE TABLE workspace_role_grants(identifier TEXT,role TEXT,center TEXT,department TEXT);
 CREATE TABLE module_access_grants(identifier TEXT,access_mode TEXT,modules TEXT);
 CREATE TABLE video_requests(id INTEGER,product TEXT,requester_number TEXT,requester_name TEXT,assignee_number TEXT,assignee_name TEXT,status TEXT,latest_asset_id INTEGER,delivery_version INTEGER,reference_url TEXT,created_at TEXT,updated_at TEXT,accepted_at TEXT);
 CREATE TABLE workstation_returns(idempotency_key TEXT,asset_id INTEGER,sha256 TEXT,status TEXT,completed_at TEXT,object_key TEXT,file_size INTEGER,created_at TEXT);
 CREATE TABLE assets(id INTEGER,deleted_at TEXT,purged_at TEXT,object_key TEXT,size INTEGER);
 CREATE TABLE asset_review_submissions(id INTEGER,asset_id INTEGER,version INTEGER,status TEXT,completed_at TEXT,submitted_at TEXT);
 CREATE TABLE qianchuan_deliveries(id INTEGER,asset_id INTEGER,advertiser_id TEXT,advertiser_name TEXT,plan_id TEXT,status TEXT,platform_asset_id TEXT,binding_verified_at TEXT,binding_evidence TEXT,created_by_number TEXT,updated_at TEXT,deleted_at TEXT);
 INSERT INTO oa_access_grants VALUES('fixture','测试一','FD-TEST-1','品牌营销部','测试中心',1);
`;
function fixture(t,wal=false){
 const dir=mkdtempSync(join(tmpdir(),'flow-cloud-reader-')),file=join(dir,'cloud.db');
 const writer=new DatabaseSync(file);
 if(wal)writer.exec('PRAGMA journal_mode=WAL;');
 writer.exec(fixtureSchema);
 const reader=createCloudReader(file);
 t.after(()=>{reader.close();writer.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,file,writer,reader};
}
const checksum=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

test('复用只读连接每次看见新提交，刷新间无事务阻断 WAL checkpoint',t=>{
 const {writer,reader}=fixture(t,true);
 assert.equal(reader.read().people[0].name,'测试一');
 writer.exec("UPDATE oa_access_grants SET real_name='测试二';");
 assert.equal(reader.read().people[0].name,'测试二');
 const result=writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
 assert.equal(result.busy,0,'reader must commit before returning or waiting 30 seconds');
 assert.equal(result.log,0);
 writer.exec("UPDATE oa_access_grants SET real_name='测试三';");
 assert.equal(reader.read().people[0].name,'测试三');
});

test('一次性 readCloud 保持原返回约定且不修改数据库内容',t=>{
 const {file,writer}=fixture(t);
 const before=checksum(file);
 const value=readCloud(file);
 assert.equal(value.state,'connected');
 assert.equal(value.people.length,1);
 assert.ok(Number.isFinite(Date.parse(value.checkedAt)));
 assert.deepEqual(Object.keys(value).sort(),['checkedAt','deliveries','people','requests','returns','reviews','state']);
 assert.equal(checksum(file),before);
 writer.exec("UPDATE oa_access_grants SET real_name='再次读取';");
 assert.equal(readCloud(file).people[0].name,'再次读取');
});

test('投影错误释放事务并关闭连接，修复后的同一 reader 可重新读取',t=>{
 const {writer,reader}=fixture(t,true);
 writer.exec('ALTER TABLE assets RENAME TO assets_temporarily_missing;');
 assert.throws(()=>reader.read(),/no such table/);
 assert.equal(writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);
 writer.exec('ALTER TABLE assets_temporarily_missing RENAME TO assets;');
 assert.equal(reader.read().people.length,1);
});

test('数据库文件 inode 替换后读取新文件，不能继续暴露旧文件', {skip:process.platform==='win32'},t=>{
 const {dir,file,reader}=fixture(t);
 assert.equal(reader.read().people[0].name,'测试一');
 const replacement=join(dir,'replacement.db'),next=new DatabaseSync(replacement);
 next.exec(fixtureSchema+"UPDATE oa_access_grants SET real_name='新数据库';");next.close();
 renameSync(replacement,file);
 assert.equal(reader.read().people[0].name,'新数据库');
});

test('exporter 冷启动临时锁有限重试，重试等待前已释放事务，重叠刷新合并',async t=>{
 const {dir,file,writer}=fixture(t);
 writer.exec('BEGIN EXCLUSIVE;');
 let waits=0;
 const exporter=createSourceExporter({output:join(dir,'snapshot.json'),cloudPath:file,retryDelaysMs:[0,0],wait:async()=>{waits++;writer.exec('COMMIT;');}});
 t.after(()=>exporter.close());
 const first=exporter.refresh(),same=exporter.refresh();
 assert.equal(first,same);
 const value=await first;
 assert.equal(waits,1);
 assert.equal(value.cloud.state,'connected');
 assert.equal(value.cloud.people.length,1);
 writer.exec("UPDATE oa_access_grants SET real_name='下个周期';");
 assert.equal((await exporter.refresh()).cloud.people[0].name,'下个周期');
 await exporter.close();
});

test('根记录失败不伪造连接或更新时间，二创仍可独立导出；架构错误不盲目重试',async t=>{
 const {dir,file,writer}=fixture(t);
 writer.exec('DROP TABLE assets;');
 const remix=join(dir,'library.json');writeFileSync(remix,JSON.stringify({clips:[],renders:[],autoJobs:[]}));
 let waits=0;
 const exporter=createSourceExporter({output:join(dir,'snapshot.json'),cloudPath:file,remixPath:remix,wait:async()=>{waits++;}});
 t.after(()=>exporter.close());
 const value=await exporter.refresh();
 assert.equal(waits,0);
 assert.equal(value.cloud.state,'unavailable');
 assert.equal(value.cloud.checkedAt,undefined);
 assert.equal(value.cloud.people,undefined);
 assert.equal(value.remix.state,'connected');
 await exporter.close();
});

test('临时错误重试次数有界，停止会关闭连接且不覆盖已发布快照',async t=>{
 const {dir,file,writer}=fixture(t);
 writer.exec('BEGIN EXCLUSIVE;');
 let waits=0;
 const output=join(dir,'snapshot.json');
 const exporter=createSourceExporter({output,cloudPath:file,retryDelaysMs:[0],wait:async()=>{waits++;}});
 t.after(()=>exporter.close());
 const value=await exporter.refresh();
 assert.equal(waits,1);
 assert.equal(value.cloud.state,'unavailable');
 writer.exec('COMMIT;');
 await exporter.close();
 const before=readFileSync(output,'utf8');
 assert.equal(await exporter.refresh(),null);
 assert.equal(readFileSync(output,'utf8'),before);
});

test('停止发生在冷启动等待期间时不发布半成品',async t=>{
 const {dir,file,writer}=fixture(t);
 writer.exec('BEGIN EXCLUSIVE;');
 let finishWait;
 const output=join(dir,'cancelled.json');
 const exporter=createSourceExporter({output,cloudPath:file,retryDelaysMs:[0],wait:()=>new Promise(resolve=>{finishWait=resolve;})});
 const refresh=exporter.refresh();
 assert.equal(typeof finishWait,'function');
 const closed=exporter.close();
 writer.exec('COMMIT;');finishWait();
 assert.equal(await refresh,null);await closed;
 assert.equal(existsSync(output),false);
});
