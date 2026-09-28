// Release-side filesystem readers, never a browser, backup producer or signer.
// The caller MUST use loadTrustedInputs to verify policy and the actual UTF-8
// artifact config file bytes independently, then pass both deeply frozen inputs.
// policy.artifactConfigSha256 belongs to that loader's raw-file-byte contract;
// this reader MUST NOT reinterpret it as a JSON.stringify/canonical digest.
// A frozen object alone is not approval: this is an inner reader, not the loader.
// v1 config: {version:1,root,productionRoots,backups:{hub,calendar,dispatch},oa}.
// Each backup: {archive:{path,sha256,format:'tar'|'tar.gz'},manifest:{path,sha256},
// restoredTree,stoppedReport:{path,sha256},restoreReport:{path,sha256}}.
// Canonical manifest bytes: JSON.stringify({version:1,directories:[sorted paths],
// files:[sorted {path,size,sha256}]}); inventory includes ALL files/directories.
// Reports have explicit kinds below; historical/missing formats fail closed.
// OA: {export:{path,sha256},cases:[{kind,dom:{path,sha256},screenshot:{path,sha256}}]}.
// Each policy OA expectedProofSha256 pins JSON.stringify({version:1,
// exportSha256,domSha256,screenshotSha256}). DOM is an independently pinned
// browser export containing the raw HTML and browser-observed fields, not a
// caller passed flag. PNG bytes and all report/DOM bytes are physically read.
// File bytes cannot attest producer honesty: only an independently approved
// real stop/restore/browser exporter may create these artifacts. Synthetic
// tests must never be passed to live signing. This module performs no restore,
// extraction, writes, OAuth, HTTP or business actions.
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,
  realpathSync,opendirSync} from 'node:fs';
import {resolve,relative,dirname,parse,isAbsolute,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const ROLES=['hub','calendar','dispatch'],KINDS=['module','old-action','old-record','personal'];
const LIMIT=64*1024*1024,FILE_LIMIT=8*1024*1024,JSON_LIMIT=1024*1024,MAX_ENTRIES=2048;
const hash=b=>createHash('sha256').update(b).digest('hex');
const jsonHash=x=>hash(JSON.stringify(x)),validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const fail=(code)=>{const e=new Error('NO-GO: '+code);e.code=code;throw e;};
const requireThat=(ok,code)=>{if(!ok)fail(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const deeplyFrozen=value=>{
  const seen=new Set();const visit=x=>{
    if(!x||typeof x!=='object')return true;
    if(seen.has(x))return false;seen.add(x);
    return seen.size<=10000&&Object.isFrozen(x)&&Object.values(x).every(visit);
  };return visit(value);
};
const fresh=(time,now)=>{const n=Date.parse(time);return Number.isFinite(n)&&now>=n&&now-n<=120000;};
const within=(child,parent)=>{const r=relative(parent,child);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
const overlap=(a,b)=>within(a,b)||within(b,a);
const pathName=value=>{
  requireThat(typeof value==='string'&&isAbsolute(value)&&value.length<=1500&&
    !value.startsWith('\\\\')&&!value.startsWith('//')&&
    !/[\u0000-\u001f\u007f]/u.test(value)&&!value.split(/[\\/]/u).some(p=>p==='.'||p==='..'),
  'artifact_path_unsafe');
  const result=resolve(value);
  requireThat(result===value&&result!==parse(result).root,'artifact_path_unsafe');return result;
};
const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.mode===b.mode&&a.nlink===b.nlink;
const readBounded=(fd,size,limit)=>{
  requireThat(Number.isSafeInteger(size)&&size>=0&&size<=limit,'artifact_size_limit');
  const buffer=Buffer.alloc(size+1);let count=0;
  while(count<buffer.length){const got=readSync(fd,buffer,count,buffer.length-count,count);if(!got)break;count+=got;}
  requireThat(count===size,'artifact_changed');return buffer.subarray(0,count);
};
const listBounded=path=>{
  const dir=opendirSync(path),names=[];
  try{let entry;while((entry=dir.readSync())){requireThat(names.length<MAX_ENTRIES,'artifact_size_limit');names.push(entry.name);}}
  finally{dir.closeSync();}return names.sort();
};
const inspectPath=value=>{
  try{
    const path=pathName(value),parts=[];let current=path;
    while(current!==parse(current).root){parts.push(current);current=dirname(current);}
    for(const part of parts.reverse())requireThat(!lstatSync(part).isSymbolicLink(),'artifact_symlink');
    requireThat(realpathSync(path)===path,'artifact_path_not_canonical');return lstatSync(path);
  }catch(e){if(e.code==='ENOENT')fail('artifact_missing');throw e;}
};
const relName=name=>{
  requireThat(typeof name==='string'&&name.length>0&&name.length<=1000&&
    !name.startsWith('/')&&!name.endsWith('/')&&!name.includes('\\')&&!name.includes('//')&&
    !/[\u0000-\u0020\u007f:]/u.test(name)&&!name.split('/').some(p=>p==='.'||p==='..'),
  'inventory_path_unsafe');return name;
};
const canonical=inventory=>{
  requireThat(inventory?.version===1&&Array.isArray(inventory.files)&&Array.isArray(inventory.directories)&&
    inventory.files.length>0&&inventory.files.length+inventory.directories.length<=MAX_ENTRIES,'manifest_schema');
  const names=new Set(),directories=inventory.directories.map(p=>{relName(p);requireThat(!names.has(p),'inventory_duplicate');names.add(p);return p;}).sort();
  let total=0;
  const files=inventory.files.map(row=>{
    relName(row?.path);requireThat(!names.has(row.path),'inventory_duplicate');names.add(row.path);
    requireThat(Number.isSafeInteger(row.size)&&row.size>=0&&row.size<=FILE_LIMIT&&validHash(row.sha256),'manifest_file_schema');
    total+=row.size;requireThat(total<=LIMIT,'artifact_size_limit');
    return {path:row.path,size:row.size,sha256:row.sha256};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  for(const row of [...directories,...files.map(x=>x.path)]){
    const chunks=row.split('/');chunks.pop();while(chunks.length){requireThat(directories.includes(chunks.join('/')),'inventory_parent_missing');chunks.pop();}
  }
  return {version:1,directories,files};
};
const tarInventory=bytes=>{
  requireThat(bytes.length<=LIMIT&&bytes.length%512===0,'tar_length');
  const files=[],dirs=new Set(),seen=new Set();let offset=0,ended=false;
  const field=(b,start,length)=>{
    const x=b.subarray(start,start+length),end=x.indexOf(0);
    return new TextDecoder('utf-8',{fatal:true}).decode(end<0?x:x.subarray(0,end));
  };
  const octal=(b,start,length)=>{const text=field(b,start,length).trim();requireThat(/^[0-7]+$/u.test(text),'tar_numeric');return parseInt(text,8);};
  while(offset<bytes.length){
    const header=bytes.subarray(offset,offset+512);
    if(header.every(x=>x===0)){
      requireThat(offset+1024<=bytes.length&&bytes.subarray(offset).every(x=>x===0),'tar_end');ended=true;break;
    }
    const checksum=octal(header,148,8);let actual=0;
    for(let i=0;i<512;i++)actual+=(i>=148&&i<156)?32:header[i];
    requireThat(checksum===actual,'tar_checksum');
    requireThat(['ustar','ustar '].includes(field(header,257,6)),'tar_format_unsupported');
    const prefix=field(header,345,155),base=field(header,0,100),type=header[156],size=octal(header,124,12);
    let name=(prefix?prefix+'/':'')+base;
    if(type===53&&name.endsWith('/'))name=name.slice(0,-1);
    relName(name);requireThat(!seen.has(name),'inventory_duplicate');seen.add(name);
    requireThat(seen.size<=MAX_ENTRIES&&[0,48,53].includes(type),'tar_entry_unsupported');
    requireThat(!field(header,157,100),'tar_link_unsupported');
    requireThat(Number.isSafeInteger(size)&&size>=0&&size<=FILE_LIMIT&&offset+512+size<=bytes.length,'artifact_size_limit');
    const parents=name.split('/');parents.pop();while(parents.length){dirs.add(parents.join('/'));requireThat(dirs.size+files.length<=MAX_ENTRIES,'artifact_size_limit');parents.pop();}
    if(type===53){requireThat(size===0,'tar_directory_payload');dirs.add(name);}
    else files.push({path:name,size,sha256:hash(bytes.subarray(offset+512,offset+512+size))});
    requireThat(dirs.size+files.length<=MAX_ENTRIES,'artifact_size_limit');
    offset+=512+Math.ceil(size/512)*512;
  }
  requireThat(ended,'tar_end');return canonical({version:1,directories:[...dirs],files});
};
const pngValid=bytes=>{
  requireThat(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'oa_screenshot_invalid');
  let at=8,ihdr=false,idat=false,end=false;
  while(at<bytes.length){
    requireThat(at+12<=bytes.length,'oa_screenshot_invalid');const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8);
    requireThat(size<=FILE_LIMIT&&at+12+size<=bytes.length,'oa_screenshot_invalid');
    // PNG CRC over type/data, implemented locally to avoid optional codecs.
    let crc=0xffffffff;for(const byte of bytes.subarray(at+4,at+8+size)){
      crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    requireThat(((crc^0xffffffff)>>>0)===bytes.readUInt32BE(at+8+size),'oa_screenshot_invalid');
    if(!ihdr){requireThat(type==='IHDR'&&size===13&&bytes.readUInt32BE(at+8)>0&&bytes.readUInt32BE(at+12)>0,'oa_screenshot_invalid');ihdr=true;}
    if(type==='IDAT')idat=true;
    if(type==='IEND'){requireThat(size===0&&at+12===bytes.length,'oa_screenshot_invalid');end=true;}
    at+=12+size;
  }
  requireThat(ihdr&&idat&&end,'oa_screenshot_invalid');
};

export function createArtifactReaders({policy,artifacts,clock=Date.now}={}){
  requireThat(policy&&artifacts&&artifacts.version===1&&typeof clock==='function','artifacts_missing');
  requireThat(validHash(policy.artifactConfigSha256),'artifact_config_unpinned');
  requireThat(deeplyFrozen(policy)&&deeplyFrozen(artifacts),'artifact_inputs_not_frozen');
  const p=JSON.parse(JSON.stringify(policy)),a=JSON.parse(JSON.stringify(artifacts));
  const root=pathName(a.root);requireThat(inspectPath(root).isDirectory(),'artifact_root_invalid');
  requireThat(Array.isArray(a.productionRoots)&&a.productionRoots.length>0,'production_roots_missing');
  const production=[...a.productionRoots,...ROLES.map(k=>p.dataMounts?.[k]),...ROLES.map(k=>p.backupSources?.[k]?.dataMount)].map(pathName);
  for(const path of production)requireThat(inspectPath(path).isDirectory(),'production_root_invalid');
  requireThat(production.every(x=>!overlap(root,x)),'artifact_production_overlap');
  const exact=new Set(),trees=[];
  const allowed=(path,tree=false)=>{
    path=pathName(path);requireThat(within(path,root)&&path!==root&&production.every(x=>!overlap(path,x)),'artifact_scope');
    requireThat(!exact.has(path),'artifact_path_duplicate');exact.add(path);if(tree)trees.push(path);return path;
  };
  const pin=spec=>{requireThat(spec&&validHash(spec.sha256),'artifact_pin_missing');allowed(spec.path);};
  for(const key of ROLES){
    const row=a.backups?.[key];requireThat(row,'backup_artifacts_missing');
    for(const name of ['archive','manifest','stoppedReport','restoreReport'])pin(row[name]);
    requireThat(['tar','tar.gz'].includes(row.archive.format),'tar_format_unsupported');allowed(row.restoredTree,true);
  }
  pin(a.oa?.export);requireThat(Array.isArray(a.oa?.cases)&&a.oa.cases.length===4&&new Set(a.oa.cases.map(x=>x.kind)).size===4&&KINDS.every(k=>a.oa.cases.some(x=>x.kind===k)),'oa_artifacts_missing');
  requireThat(typeof p.oaAcceptance?.actorNumber==='string'&&p.oaAcceptance.actorNumber.length>0&&
    Array.isArray(p.oaAcceptance.cases)&&p.oaAcceptance.cases.length===4&&
    new Set(p.oaAcceptance.cases.map(x=>x.kind)).size===4&&KINDS.every(kind=>p.oaAcceptance.cases.some(x=>x.kind===kind))&&
    p.oaAcceptance.cases.every(x=>validHash(x.expectedProofSha256)&&validHash(x.linkSha256)),'oa_policy_missing');
  for(const row of a.oa.cases){pin(row.dom);pin(row.screenshot);}
  for(const tree of trees)requireThat([...exact].every(x=>x===tree||!overlap(x,tree)),'artifact_restore_overlap');
  const readPinned=(spec,limit=FILE_LIMIT)=>{
    const before=inspectPath(spec.path);requireThat(before.isFile()&&before.nlink===1&&before.size<=limit,'artifact_size_or_type');
    const fd=openSync(spec.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let bytes;
    try{requireThat(stable(before,fstatSync(fd)),'artifact_changed');bytes=readBounded(fd,before.size,limit);requireThat(stable(before,fstatSync(fd)),'artifact_changed');}
    finally{closeSync(fd);}
    requireThat(stable(before,inspectPath(spec.path)),'artifact_changed');
    requireThat(bytes.length<=limit&&hash(bytes)===spec.sha256,'artifact_digest_mismatch');return bytes;
  };
  const readJson=spec=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readPinned(spec,JSON_LIMIT)));}
    catch(e){if(e.code)throw e;fail('artifact_json_invalid');}};
  const treeInventory=tree=>{
    const directories=[],files=[];let total=0,entries=0;
    const walk=(path,prefix)=>{
      const before=inspectPath(path);requireThat(before.isDirectory(),'restore_tree_type');
      const names=listBounded(path);
      for(const name of names){const rel=prefix?prefix+'/'+name:name;relName(rel);requireThat(++entries<=MAX_ENTRIES,'artifact_size_limit');
        const full=join(path,name),stat=inspectPath(full);
        if(stat.isDirectory()){directories.push(rel);walk(full,rel);}
        else{requireThat(stat.isFile()&&stat.nlink===1&&stat.size<=FILE_LIMIT,'restore_tree_type');total+=stat.size;requireThat(total<=LIMIT,'artifact_size_limit');
          // No caller digest is used for tree files: read and hash actual bytes.
          const fd=openSync(full,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let bytes;
          try{requireThat(stable(stat,fstatSync(fd)),'artifact_changed');bytes=readBounded(fd,stat.size,FILE_LIMIT);requireThat(stable(stat,fstatSync(fd)),'artifact_changed');}
          finally{closeSync(fd);}
          requireThat(stable(stat,inspectPath(full)),'artifact_changed');files.push({path:rel,size:bytes.length,sha256:hash(bytes)});
        }
      }
      requireThat(stable(before,inspectPath(path))&&same(names,listBounded(path)),'artifact_changed');
    };walk(tree,'');return canonical({version:1,directories,files});
  };
  const topologyCheck=topology=>{
    const now=checkedNow(),gateway=topology?.gateway;
    requireThat(gateway?.id===p.containers?.gateway?.id&&gateway?.image===p.containers?.gateway?.image&&
      gateway?.status==='running'&&gateway?.health==='healthy'&&fresh(gateway.checkedAt,now)&&
      gateway.configHash===p.gatewayConfigHash&&ROLES.every(k=>gateway.routes?.[k]===p.containers?.[k]?.id),'artifact_current_cas');
    for(const key of ROLES){const actual=topology?.services?.[key],expected=p.containers?.[key];
      requireThat(actual&&actual.id===expected?.id&&actual.image===expected?.image&&actual.startedAt===expected?.startedAt&&
        actual.status==='running'&&actual.health==='healthy'&&fresh(actual.checkedAt,now)&&actual.dataMount?.source===p.dataMounts[key]&&actual.dataMount.rw===true&&
        same(actual.runningRwWriters,[actual.id])&&same(actual.dormantRwContainers,[])&&same(actual.dormantAutoRestartRw,[]),'artifact_current_cas');
    }
    const hub=topology.services.hub;requireThat(hub.release===p.containers.hub.release&&hub.liveNextDayInstance===p.containers.hub.liveNextDayInstance,'artifact_current_cas');
  };
  const sourceIdentity=(key)=>({id:p.backupSources[key].id,image:p.backupSources[key].image,startedAt:p.backupSources[key].startedAt,dataMount:p.backupSources[key].dataMount});
  const currentIdentity=(key)=>({id:p.containers[key].id,image:p.containers[key].image,startedAt:p.containers[key].startedAt,dataMount:p.dataMounts[key]});
  const checkedNow=()=>{const now=clock();requireThat(Number.isFinite(now),'artifact_clock');return now;};
  for(const key of ROLES){const source=p.backupSources?.[key],current=p.containers?.[key];
    requireThat(source&&current&&/^[a-f0-9]{64}$/u.test(source.id||'')&&/^sha256:[a-f0-9]{64}$/u.test(source.image||'')&&
      /^[a-f0-9]{64}$/u.test(current.id||'')&&/^sha256:[a-f0-9]{64}$/u.test(current.image||'')&&
      Number.isFinite(Date.parse(source.startedAt))&&Number.isFinite(Date.parse(current.startedAt))&&
      Date.parse(source.startedAt)<Date.parse(current.startedAt)&&Date.parse(current.startedAt)<=checkedNow()&&
      source.dataMount===p.dataMounts?.[key]&&(source.id!==current.id||source.image===current.image),'backup_source_policy_missing');
  }
  return Object.freeze({
    readBackup(topology){
      topologyCheck(topology);const rows={};
      for(const key of ROLES){const spec=a.backups[key],stop=readJson(spec.stoppedReport),probe=readJson(spec.restoreReport);
        const manifestBytes=readPinned(spec.manifest,JSON_LIMIT),manifest=canonical(JSON.parse(manifestBytes.toString('utf8')));
        requireThat(manifestBytes.equals(Buffer.from(JSON.stringify(manifest))),'manifest_not_canonical');
        const archive=readPinned(spec.archive,LIMIT);let plain=archive;
        if(spec.archive.format==='tar.gz')try{plain=gunzipSync(archive,{maxOutputLength:LIMIT});}catch{fail('archive_decode_failed');}
        requireThat(same(tarInventory(plain),manifest),'archive_inventory_mismatch');
        const restored=treeInventory(spec.restoredTree),manifestSha=jsonHash(manifest);
        requireThat(same(restored,manifest),'restored_inventory_mismatch');
        const now=checkedNow(),source=sourceIdentity(key),current=currentIdentity(key);
        requireThat(stop.version===1&&stop.kind==='wis-stopped-full-backup'&&stop.role===key&&stop.synthetic!==true&&
          same(stop.source,source)&&same(stop.current,current)&&stop.archiveSha256===spec.archive.sha256&&stop.manifestSha256===manifestSha&&
          stop.observations?.sourceWriterStopped===true&&same(stop.observations.runningRwWritersAtCapture,[])&&stop.observations.fullInventory===true,
        'backup_stop_report_binding');
        requireThat(fresh(stop.capturedAt,now)&&Date.parse(source.startedAt)<=Date.parse(stop.stoppedAt)&&
          Date.parse(stop.stoppedAt)<=Date.parse(stop.capturedAt)&&Date.parse(stop.capturedAt)<=Date.parse(current.startedAt),
        'backup_capture_stale_or_chronology');
        requireThat(probe.version===1&&probe.kind==='wis-isolated-restore'&&probe.role===key&&probe.synthetic!==true&&
          same(probe.source,source)&&same(probe.current,current)&&probe.treePath===spec.restoredTree&&probe.capturedAt===stop.capturedAt&&
          probe.archiveSha256===spec.archive.sha256&&probe.manifestSha256===manifestSha&&probe.observations?.isolated===true&&
          probe.observations.probeKind==='inventory-byte-compare'&&probe.observations.filesChecked===manifest.files.length&&probe.observations.exitCode===0&&
          Date.parse(probe.restoredAt)>=Date.parse(stop.capturedAt)&&Date.parse(probe.restoredAt)<=Date.parse(probe.probedAt)&&
          fresh(probe.probedAt,now),'backup_restore_report_binding');
        rows[key]={fullBackup:true,stoppedWriter:true,verified:true,restoreProbePassed:true,sourceContainerId:source.id,
          sourceImage:source.image,sourceStartedAt:source.startedAt,sourceDataMount:source.dataMount,
          archiveSha256:hash(archive),sourceManifestSha256:manifestSha,restoredManifestSha256:jsonHash(restored),
          restoreProbeHash:hash(readPinned(spec.restoreReport,JSON_LIMIT)),capturedAt:stop.capturedAt,checkedAt:new Date(now).toISOString()};
      }
      // Expiry during a large tree walk cannot freshen an older capture.
      const now=checkedNow();for(const row of Object.values(rows))requireThat(fresh(row.capturedAt,now),'backup_capture_stale_or_chronology');return rows;
    },
    readOaPage(topology){
      topologyCheck(topology);const exp=readJson(a.oa.export),hub=topology.services.hub,expectedHub={id:hub.id,image:hub.image,
        startedAt:hub.startedAt,release:hub.release,liveNextDayInstance:hub.liveNextDayInstance};
      requireThat(exp.version===1&&exp.kind==='wis-authenticated-browser-export'&&exp.origin==='browser'&&exp.synthetic!==true&&
        exp.mock!==true&&exp.actorNumber===p.oaAcceptance?.actorNumber&&same(exp.hub,expectedHub)&&Array.isArray(exp.cases)&&
        exp.cases.length===4&&new Set(exp.cases.map(x=>x.kind)).size===4,'oa_export_binding');
      const rows=[];let latest=0;
      for(const kind of KINDS){const fixed=p.oaAcceptance.cases.find(x=>x.kind===kind),spec=a.oa.cases.find(x=>x.kind===kind),
        row=exp.cases.find(x=>x.kind===kind),dom=readJson(spec.dom),screenshot=readPinned(spec.screenshot);
        pngValid(screenshot);
        const proof=jsonHash({version:1,exportSha256:a.oa.export.sha256,domSha256:spec.dom.sha256,screenshotSha256:spec.screenshot.sha256});
        requireThat(fixed&&row&&proof===fixed.expectedProofSha256,'oa_proof_digest_mismatch');
        const observations=row.observations;
        requireThat(dom.version===1&&dom.kind==='wis-browser-dom-export'&&dom.origin==='browser'&&dom.synthetic!==true&&dom.mock!==true&&
          dom.url===row.url&&dom.capturedAt===row.capturedAt&&dom.actorNumber===exp.actorNumber&&same(dom.hub,expectedHub)&&
          dom.readyState==='complete'&&typeof dom.html==='string'&&/<html[\s>]/iu.test(dom.html)&&dom.html.length>20&&
          same(dom.observations,observations),'oa_dom_binding');
        requireThat(typeof row.url==='string'&&row.url.startsWith('https://')&&hash(row.url)===fixed.linkSha256&&
          observations?.authenticated===true&&observations.actorNumber===exp.actorNumber&&observations.httpStatus===200&&
          observations.loginRedirect===false&&observations.rendered===true&&observations.businessActionInvoked===false&&
          observations.module===fixed.expectedModule&&observations.view===fixed.view&&
          row.noticeId===fixed.noticeId&&row.messageId===fixed.messageId&&row.taskId===fixed.taskId&&row.recipient===fixed.recipient&&
          observations.taskId===fixed.taskId&&observations.readOnly===(kind==='old-record')&&
          (kind!=='personal'||observations.scope==='self'&&observations.observedActorNumber===exp.actorNumber),'oa_false_observation');
        const now=checkedNow();requireThat(fresh(row.capturedAt,now)&&Date.parse(row.capturedAt)>=Date.parse(hub.startedAt),'oa_capture_stale_or_incarnation');
        latest=Math.max(latest,Date.parse(row.capturedAt));
        rows.push({kind,authenticated:true,actorNumber:exp.actorNumber,hubId:hub.id,hubImage:hub.image,release:hub.release,
          liveNextDayInstance:hub.liveNextDayInstance,noticeId:row.noticeId,messageId:row.messageId,taskId:row.taskId,recipient:row.recipient,
          view:fixed.view,linkSha256:hash(row.url),proofSha256:proof,observedModule:observations.module,observedTaskId:observations.taskId,
          observedView:observations.view,httpStatus:observations.httpStatus,loginRedirect:observations.loginRedirect,rendered:observations.rendered,
          businessActionInvoked:observations.businessActionInvoked,readOnly:observations.readOnly,observedScope:observations.scope,
          observedActorNumber:observations.observedActorNumber,capturedAt:row.capturedAt,checkedAt:new Date(now).toISOString()});
      }
      const now=checkedNow();requireThat(fresh(exp.capturedAt,now)&&Date.parse(exp.capturedAt)===latest&&
        rows.every(row=>fresh(row.capturedAt,now)),'oa_capture_stale_or_incarnation');
      return {authenticated:true,actorNumber:exp.actorNumber,hubId:hub.id,hubImage:hub.image,release:hub.release,
        liveNextDayInstance:hub.liveNextDayInstance,capturedAt:exp.capturedAt,checkedAt:new Date(now).toISOString(),cases:rows};
    }
  });
}
