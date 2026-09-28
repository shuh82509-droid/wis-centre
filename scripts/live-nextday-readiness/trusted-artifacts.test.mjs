import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,unlinkSync,rmSync,symlinkSync,linkSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,deflateSync} from 'node:zlib';
import {createArtifactReaders} from './trusted-artifacts.mjs';

// These physical temporary files are synthetic test exports, not production
// operator approval, browser acceptance or evidence to sign a live permit.
const ROLES=['hub','calendar','dispatch'],KINDS=['module','old-action','old-record','personal'];
const NOW=Date.parse('2026-09-28T07:45:00.000Z'),iso=ms=>new Date(ms).toISOString();
const hash=x=>createHash('sha256').update(x).digest('hex'),jhash=x=>hash(JSON.stringify(x));
const frozen=value=>{const copy=structuredClone(value),visit=x=>{if(x&&typeof x==='object'){for(const child of Object.values(x))visit(child);Object.freeze(x);}return x;};return visit(copy);};
const crc32=buffer=>{let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
const png=()=>{const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,8+data.length)),8+data.length);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3]))),chunk('IEND',Buffer.alloc(0))]);};
const tar=entries=>Buffer.concat([...entries.flatMap(({path,type='0',bytes=Buffer.alloc(0)})=>{
  const header=Buffer.alloc(512);header.write(path,0,100,'utf8');header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
  header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header[156]=type.charCodeAt(0);
  header.write('ustar\0',257);header.write('00',263);let sum=0;for(const byte of header)sum+=byte;
  header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return [header,bytes,Buffer.alloc((512-bytes.length%512)%512)];
}),Buffer.alloc(1024)]);

function fixture(){
  const temp=mkdtempSync(join(tmpdir(),'wis-trusted-artifacts-')),root=join(temp,'artifacts');mkdirSync(root);
  const mounts=Object.fromEntries(ROLES.map(k=>{const path=join(temp,'production',k);mkdirSync(path,{recursive:true});return [k,path];}));
  const policy={containers:{gateway:{id:'e'.repeat(64),image:'sha256:'+'e'.repeat(64)}},dataMounts:mounts,backupSources:{},gatewayConfigHash:'f'.repeat(64),oaAcceptance:{actorNumber:'N0',cases:[]}};
  let now=NOW;
  const artifacts={version:1,root,productionRoots:Object.values(mounts),backups:{},oa:{cases:[]}};
  const emit=(path,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));writeFileSync(path,bytes);return {path,sha256:hash(bytes)};};
  const identity=(k,old=false)=>({...policy[old?'backupSources':'containers'][k],...(old?{}:{dataMount:mounts[k]})});
  for(const [i,k] of ROLES.entries()){
    const id=(i+1).toString().repeat(64),image='sha256:'+id;
    policy.containers[k]={id,image,startedAt:iso(NOW-20000),...(k==='hub'?{release:'hub-artifact-test',liveNextDayInstance:'boot-artifact-test'}:{})};
    policy.backupSources[k]={id,image,startedAt:iso(NOW-3600000),dataMount:mounts[k]};
    const dir=join(root,k);mkdirSync(dir);const tree=join(dir,'restored');mkdirSync(join(tree,'db'),{recursive:true});
    const content=Buffer.from(JSON.stringify({role:k,value:7})),raw=Buffer.from([1,3,5]);
    writeFileSync(join(tree,'db','state.json'),content);writeFileSync(join(tree,'raw.bin'),raw);
    const manifest={version:1,directories:['db'],files:[{path:'db/state.json',size:content.length,sha256:hash(content)},{path:'raw.bin',size:raw.length,sha256:hash(raw)}]};
    let archive=tar([{path:'db/',type:'5'},{path:'db/state.json',bytes:content},{path:'raw.bin',bytes:raw}]);
    const format=k==='calendar'?'tar.gz':'tar';if(format==='tar.gz')archive=gzipSync(archive);
    const archivePin={...emit(join(dir,'archive.'+format),archive),format};
    const source=identity(k,true),current=identity(k);delete current.release;delete current.liveNextDayInstance;
    artifacts.backups[k]={archive:archivePin,manifest:emit(join(dir,'manifest.json'),manifest),restoredTree:tree,
      stoppedReport:emit(join(dir,'stopped.json'),{version:1,kind:'wis-stopped-full-backup',role:k,source,current,stoppedAt:iso(NOW-40000),capturedAt:iso(NOW-30000),
        archiveSha256:archivePin.sha256,manifestSha256:jhash(manifest),observations:{sourceWriterStopped:true,runningRwWritersAtCapture:[],fullInventory:true}}),
      restoreReport:emit(join(dir,'restore.json'),{version:1,kind:'wis-isolated-restore',role:k,source,current,treePath:tree,capturedAt:iso(NOW-30000),
        restoredAt:iso(NOW-15000),probedAt:iso(NOW-14000),archiveSha256:archivePin.sha256,manifestSha256:jhash(manifest),
        observations:{isolated:true,probeKind:'inventory-byte-compare',filesChecked:2,exitCode:0}})};
  }
  const hub={...policy.containers.hub};
  const oa={version:1,kind:'wis-authenticated-browser-export',origin:'browser',actorNumber:'N0',hub,capturedAt:iso(NOW-10000),cases:[]};
  for(const kind of KINDS){const old=kind.startsWith('old-'),view=kind==='old-record'?'record':kind==='old-action'?'action':kind;
    const url='https://hub.example/accepted#'+kind;
    const row={kind,url,capturedAt:iso(NOW-10000),noticeId:old?'notice-0':null,messageId:old?'om_message0':null,taskId:old?'task-0':null,recipient:old?'N0':null,
      observations:{authenticated:true,actorNumber:'N0',httpStatus:200,loginRedirect:false,rendered:true,businessActionInvoked:false,
        module:kind==='personal'?'workflow-engine':'live-room-management',view,taskId:old?'task-0':null,readOnly:kind==='old-record',scope:kind==='personal'?'self':null,observedActorNumber:'N0'}};
    oa.cases.push(row);policy.oaAcceptance.cases.push({kind,expectedModule:row.observations.module,view,noticeId:row.noticeId,messageId:row.messageId,
      taskId:row.taskId,recipient:row.recipient,linkSha256:hash(url)});
    artifacts.oa.cases.push({kind,dom:emit(join(root,kind+'-dom.json'),{version:1,kind:'wis-browser-dom-export',origin:'browser',actorNumber:'N0',hub,url,
      capturedAt:row.capturedAt,readyState:'complete',html:'<html><body>Rendered accepted page for N0</body></html>',observations:row.observations}),
      screenshot:emit(join(root,kind+'.png'),png())});
  }
  artifacts.oa.export=emit(join(root,'oa-export.json'),oa);
  const repin=()=>{
    for(const row of artifacts.oa.cases)policy.oaAcceptance.cases.find(x=>x.kind===row.kind).expectedProofSha256=jhash({version:1,
      exportSha256:artifacts.oa.export.sha256,domSha256:row.dom.sha256,screenshotSha256:row.screenshot.sha256});
    policy.artifactConfigSha256=jhash(artifacts);
  };repin();
  const topology={gateway:{...policy.containers.gateway,status:'running',health:'healthy',checkedAt:iso(now),configHash:policy.gatewayConfigHash,
    routes:Object.fromEntries(ROLES.map(k=>[k,policy.containers[k].id]))},services:Object.fromEntries(ROLES.map(k=>[k,{...policy.containers[k],status:'running',health:'healthy',checkedAt:iso(now),
      runningRwWriters:[policy.containers[k].id],dormantRwContainers:[],dormantAutoRestartRw:[],dataMount:{source:mounts[k],rw:true}}]))};
  const reader=()=>createArtifactReaders({policy:frozen(policy),artifacts:frozen(artifacts),clock:()=>now});
  const rewrite=(pin,fn)=>{const data=JSON.parse(readFileSync(pin.path,'utf8'));fn(data);Object.assign(pin,emit(pin.path,data));repin();};
  const cleanup=()=>{const exact=resolve(temp),base=resolve(tmpdir());assert.ok(relative(base,exact).startsWith('wis-trusted-artifacts-'));assert.ok(!relative(base,exact).includes('..'+sep));rmSync(exact,{recursive:true});};
  return {temp,root,policy,artifacts,topology,reader,repin,rewrite,emit,cleanup,setNow:n=>{now=n;topology.gateway.checkedAt=iso(n);for(const s of Object.values(topology.services))s.checkedAt=iso(n);}};
}
const withFixture=fn=>{const f=fixture();try{fn(f);}finally{f.cleanup();}};
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code&&e.message.startsWith('NO-GO:'),code);

test('all three real temp archives/manifests/restored trees are read; capture time is never freshened',()=>withFixture(f=>{
  const rows=f.reader().readBackup(f.topology);assert.deepEqual(Object.keys(rows),ROLES);
  for(const k of ROLES){assert.equal(rows[k].capturedAt,iso(NOW-30000));assert.equal(rows[k].checkedAt,iso(NOW));assert.equal(rows[k].sourceManifestSha256,rows[k].restoredManifestSha256);assert.equal(rows[k].verified,true);}
  f.setNow(NOW+1000);assert.equal(f.reader().readBackup(f.topology).hub.capturedAt,iso(NOW-30000));
}));
test('OA reads pinned browser export, four actual DOM files and PNGs with composite proof hashes',()=>withFixture(f=>{
  const row=f.reader().readOaPage(f.topology);assert.equal(row.cases.length,4);assert.equal(row.capturedAt,iso(NOW-10000));
  for(const c of row.cases)assert.equal(c.proofSha256,f.policy.oaAcceptance.cases.find(x=>x.kind===c.kind).expectedProofSha256);
}));
test('missing independently pinned config, each backup role, and old report schema fail explicitly',()=>{
  rejects(()=>createArtifactReaders(), 'artifacts_missing');
  withFixture(f=>{f.policy.artifactConfigSha256='not-externally-pinned';rejects(f.reader,'artifact_config_unpinned');});
  for(const role of ROLES)withFixture(f=>{delete f.artifacts.backups[role];f.repin();rejects(f.reader,'backup_artifacts_missing');});
  withFixture(f=>{f.rewrite(f.artifacts.backups.hub.stoppedReport,x=>{delete x.kind;x.verified=true;});rejects(()=>f.reader().readBackup(f.topology),'backup_stop_report_binding');});
});
test('each archive corruption, missing artifact, excess/mutated restored file and hard limits reject',()=>{
  for(const role of ROLES){
    withFixture(f=>{writeFileSync(f.artifacts.backups[role].archive.path,'corrupt');rejects(()=>f.reader().readBackup(f.topology),'artifact_digest_mismatch');});
    withFixture(f=>{unlinkSync(f.artifacts.backups[role].manifest.path);rejects(()=>f.reader().readBackup(f.topology),'artifact_missing');});
    withFixture(f=>{writeFileSync(join(f.artifacts.backups[role].restoredTree,'extra.json'),'x');rejects(()=>f.reader().readBackup(f.topology),'restored_inventory_mismatch');});
    withFixture(f=>{writeFileSync(join(f.artifacts.backups[role].restoredTree,'db','state.json'),'changed');rejects(()=>f.reader().readBackup(f.topology),'restored_inventory_mismatch');});
  }
  withFixture(f=>{truncateSync(f.artifacts.backups.hub.archive.path,64*1024*1024+1);rejects(()=>f.reader().readBackup(f.topology),'artifact_size_or_type');});
});
test('path traversal, production overlap and restore/artifact overlap cannot be configured',()=>{
  withFixture(f=>{f.artifacts.backups.hub.manifest.path=f.root+'/../outside.json';f.repin();rejects(f.reader,'artifact_path_unsafe');});
  withFixture(f=>{f.artifacts.root='\\\\server\\share\\folder';f.repin();rejects(f.reader,'artifact_path_unsafe');});
  withFixture(f=>{f.artifacts.root=f.policy.dataMounts.hub;f.repin();rejects(f.reader,'artifact_production_overlap');});
  withFixture(f=>{f.artifacts.backups.hub.manifest.path=join(f.artifacts.backups.hub.restoredTree,'manifest.json');f.repin();rejects(f.reader,'artifact_restore_overlap');});
});
test('symlink or Windows junction in the artifact ancestor is rejected',()=>withFixture(f=>{
  const alias=join(f.root,'junction');symlinkSync(f.artifacts.backups.hub.restoredTree,alias,process.platform==='win32'?'junction':'dir');
  f.artifacts.backups.hub.manifest.path=join(alias,'db','state.json');f.repin();rejects(()=>f.reader().readBackup(f.topology),'artifact_symlink');
}));
test('bounded tar reader rejects traversal, links/specials and duplicate file names even with pinned corrupted archive',()=>{
  for(const [entries,code] of [[[{path:'../escape',bytes:Buffer.from('x')}],'inventory_path_unsafe'],
    [[{path:'hardlink',type:'1'}],'tar_entry_unsupported'],[[{path:'link',type:'2'}],'tar_entry_unsupported'],[[{path:'device',type:'3'}],'tar_entry_unsupported'],
    [[{path:'duplicate',bytes:Buffer.from('a')},{path:'duplicate',bytes:Buffer.from('b')}],'inventory_duplicate']])withFixture(f=>{
    Object.assign(f.artifacts.backups.hub.archive,f.emit(f.artifacts.backups.hub.archive.path,tar(entries)));f.repin();rejects(()=>f.reader().readBackup(f.topology),code);
  });
});
test('physical hardlinks or symlink/junction restored descendants cannot supply a restore proof',()=>{
  withFixture(f=>{const tree=f.artifacts.backups.hub.restoredTree;linkSync(join(tree,'raw.bin'),join(tree,'linked.bin'));rejects(()=>f.reader().readBackup(f.topology),'restore_tree_type');});
  withFixture(f=>{symlinkSync(f.policy.dataMounts.hub,join(f.artifacts.backups.hub.restoredTree,'link'),process.platform==='win32'?'junction':'dir');rejects(()=>f.reader().readBackup(f.topology),'artifact_symlink');});
});
test('canonical manifest bytes, tar inventory, gzip decode and complete restored inventory are actually verified',()=>{
  withFixture(f=>{const spec=f.artifacts.backups.hub.manifest,data=JSON.parse(readFileSync(spec.path,'utf8'));Object.assign(spec,f.emit(spec.path,JSON.stringify(data,null,2)));f.repin();rejects(()=>f.reader().readBackup(f.topology),'manifest_not_canonical');});
  withFixture(f=>{const spec=f.artifacts.backups.hub.archive;Object.assign(spec,f.emit(spec.path,tar([{path:'different.bin',bytes:Buffer.from('x')}])),{format:'tar'});f.repin();rejects(()=>f.reader().readBackup(f.topology),'archive_inventory_mismatch');});
  withFixture(f=>{const spec=f.artifacts.backups.calendar.archive;Object.assign(spec,f.emit(spec.path,Buffer.from('not gzip')));f.repin();rejects(()=>f.reader().readBackup(f.topology),'archive_decode_failed');});
});
test('stale capture, source incarnation, current CAS, false stop and restore report cannot be replaced by verified true',()=>{
  for(const role of ROLES){
    withFixture(f=>{f.setNow(NOW+120001);rejects(()=>f.reader().readBackup(f.topology),'backup_capture_stale_or_chronology');});
    withFixture(f=>{f.rewrite(f.artifacts.backups[role].stoppedReport,x=>{x.source.startedAt=iso(NOW-100000);x.verified=true;});rejects(()=>f.reader().readBackup(f.topology),'backup_stop_report_binding');});
    withFixture(f=>{f.topology.services[role].startedAt=iso(NOW-1);rejects(()=>f.reader().readBackup(f.topology),'artifact_current_cas');});
    withFixture(f=>{f.rewrite(f.artifacts.backups[role].stoppedReport,x=>{x.observations.sourceWriterStopped=false;x.verified=true;});rejects(()=>f.reader().readBackup(f.topology),'backup_stop_report_binding');});
    withFixture(f=>{f.rewrite(f.artifacts.backups[role].restoreReport,x=>{x.observations.exitCode=1;x.verified=true;});rejects(()=>f.reader().readBackup(f.topology),'backup_restore_report_binding');});
  }
  withFixture(f=>{f.rewrite(f.artifacts.backups.hub.stoppedReport,x=>{x.capturedAt=iso(NOW-10000);});rejects(()=>f.reader().readBackup(f.topology),'backup_capture_stale_or_chronology');});
});
test('OA proof mismatch, raw DOM/image corruption and wrong actor/incarnation fail closed',()=>{
  withFixture(f=>{f.policy.oaAcceptance.cases[0].expectedProofSha256='f'.repeat(64);rejects(()=>f.reader().readOaPage(f.topology),'oa_proof_digest_mismatch');});
  withFixture(f=>{writeFileSync(f.artifacts.oa.cases[0].dom.path,'changed');rejects(()=>f.reader().readOaPage(f.topology),'artifact_digest_mismatch');});
  withFixture(f=>{Object.assign(f.artifacts.oa.cases[0].screenshot,f.emit(f.artifacts.oa.cases[0].screenshot.path,Buffer.from('not png')));f.repin();rejects(()=>f.reader().readOaPage(f.topology),'oa_screenshot_invalid');});
  withFixture(f=>{f.rewrite(f.artifacts.oa.export,x=>{x.actorNumber='other';});rejects(()=>f.reader().readOaPage(f.topology),'oa_export_binding');});
  withFixture(f=>{f.rewrite(f.artifacts.oa.export,x=>{x.hub.liveNextDayInstance='other-boot';});rejects(()=>f.reader().readOaPage(f.topology),'oa_export_binding');});
});
test('four cases each reject false observations even if all wrong artifact bytes are independently repinned',()=>{
  for(const kind of KINDS)for(const field of ['authenticated','rendered','loginRedirect','businessActionInvoked'])withFixture(f=>{
    const value=['loginRedirect','businessActionInvoked'].includes(field);
    f.rewrite(f.artifacts.oa.export,x=>{x.cases.find(c=>c.kind===kind).observations[field]=value;});
    f.rewrite(f.artifacts.oa.cases.find(x=>x.kind===kind).dom,x=>{x.observations[field]=value;});
    rejects(()=>f.reader().readOaPage(f.topology),'oa_false_observation');
  });
});
test('OA old capture cannot be freshened, anonymous/mock exports and personal broad scope reject',()=>{
  withFixture(f=>{f.setNow(NOW+120001);rejects(()=>f.reader().readOaPage(f.topology),'oa_capture_stale_or_incarnation');});
  for(const field of ['mock','synthetic'])withFixture(f=>{f.rewrite(f.artifacts.oa.export,x=>{x[field]=true;});rejects(()=>f.reader().readOaPage(f.topology),'oa_export_binding');});
  withFixture(f=>{f.rewrite(f.artifacts.oa.export,x=>{x.cases[3].observations.scope='all';});f.rewrite(f.artifacts.oa.cases[3].dom,x=>{x.observations.scope='all';});rejects(()=>f.reader().readOaPage(f.topology),'oa_false_observation');});
});
test('factory freezes approved inputs instead of following later caller path/hash changes',()=>withFixture(f=>{
  const reader=f.reader();f.artifacts.backups.hub.manifest.path=join(f.temp,'unapproved');f.policy.backupSources.hub.id='f'.repeat(64);
  assert.equal(reader.readBackup(f.topology).hub.sourceContainerId,'1'.repeat(64));
}));
test('expiry during physical reads is checked at completion rather than refreshing capture timestamps',()=>{
  withFixture(f=>{let ticks=0;const reader=createArtifactReaders({policy:frozen(f.policy),artifacts:frozen(f.artifacts),clock:()=>++ticks>=5?NOW+120001:NOW});
    ticks=0;rejects(()=>reader.readBackup(f.topology),'backup_capture_stale_or_chronology');assert.equal(ticks,5);});
  withFixture(f=>{let ticks=0;const reader=createArtifactReaders({policy:frozen(f.policy),artifacts:frozen(f.artifacts),clock:()=>++ticks>=6?NOW+120001:NOW});
    ticks=0;rejects(()=>reader.readOaPage(f.topology),'oa_capture_stale_or_incarnation');assert.equal(ticks,6);});
});
test('raw UTF-8 config digest belongs to the independent loader; no conflicting JSON digest is recomputed',()=>withFixture(f=>{
  // Inner-reader test only: the real loader must first check these actual file
  // bytes. Different whitespace changes the raw digest, not the parsed paths.
  f.policy.artifactConfigSha256=hash(JSON.stringify(f.artifacts,null,2));
  assert.equal(f.reader().readBackup(f.topology).hub.verified,true);
  rejects(()=>createArtifactReaders({policy:f.policy,artifacts:f.artifacts}),'artifact_inputs_not_frozen');
}));
