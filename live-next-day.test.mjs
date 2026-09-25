import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveNextDayReminder,LIVE_WAR_ROOM_RECIPIENT,currentNextDayGroup,currentOfficialNextDaySource,needsOfficialLiveSource,nextDayDirectMessage} from './live-next-day.mjs';
import {scheduleSessions} from './live-session-flow.mjs';
import {currentNodeNotice} from './flow-notice-validity.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {NEXT_DAY_PERMIT_MOUNT,isolatedNextDayPermitPath,nextDayReleaseManifest,installNextDayReleasePermit,
  readNextDayReleasePermit,createNextDayReleaseReader,currentNextDayRelease} from './live-next-day-release.mjs';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync,unlinkSync,rmdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';

function fixture(){
  let now=Date.parse('2026-09-24T16:00:00+08:00');
  const date='2026-09-25',room={code:'guanqi',name:'官旗',anchors:[['09:00','10:00','主播甲']],assistants:[['09:00','10:00','助理乙']]};
  const people=['主播甲','助理乙'].map((name,i)=>({number:i?'B':'A',name,active:true,center:'直播中心',workflowEnabled:true,modules:['live-room-management','workflow-engine']}));
  const otherRooms=[['brand_selection','品牌精选','MVpDv0'],['youxuan','优选','LRAvIU'],['wangou','王鸥美肤','PhlV42']]
    .map(([code,name])=>({...room,code,name}));
  const raw={date,updatedAt:new Date(now).toISOString(),rooms:[room,...otherRooms],
    source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},
    sourceStatus:{guanqi:{found:true,revision:15,sheetId:'NYB2iu'},
      brand_selection:{found:true,revision:15,sheetId:'MVpDv0'},youxuan:{found:true,revision:15,sheetId:'LRAvIU'},
      wangou:{found:true,revision:15,sheetId:'PhlV42'}}};
  const cardEligible={verified:number=>['A','B'].includes(number),canOwn:number=>['A','B'].includes(number)};
  const slots=scheduleSessions(raw,date,people,now,cardEligible),slot=slots[0];
  const tasks=slots.map((shift,i)=>({id:`T${i+1}`,runtime:{state:'running',liveSession:shift,
    nodes:[{id:'W04.S4.E1',state:i?'completed':'pending',attempt:1,owner:{number:'A'}},
      {id:'W04.S4.A1',state:i?'completed':'pending',attempt:1,owner:{number:'B'}}]}}));
  const nodes=tasks[0].runtime.nodes;
  const data={tasks,flowNotifications:tasks.flatMap((task,i)=>task.runtime.nodes.map((node,j)=>({id:`card-${i*2+j}`,
    taskId:task.id,nodeId:node.id,attempt:node.attempt,recipient:node.owner.number,kind:'live_assignment',
    state:'sent',messageId:`om_card_${i*2+j}`})))};
  const store={read:()=>structuredClone(data),transaction:fn=>fn(data)};
  const runtime={store,people:()=>people,liveParticipants:{people:()=>people,canOwn:(number,nodeId)=>['A','B'].includes(number)&&/^W04\.S4\.(E1|A\d+)$/.test(nodeId)},ensure:s=>{s.flowNotifications??=[];},notify:(s,t,n,kind,recipient,eventId)=>s.flowNotifications.push({id:'notice'+s.flowNotifications.length,key:[t.id,n?.id,kind,recipient,eventId].join(':'),taskId:t.id,nodeId:n?.id||null,attempt:n?.attempt||0,kind,recipient,state:'ready',attempts:0,nextAt:now,createdAt:new Date(now).toISOString()})};
  const notifier={enabled:true,recipient:n=>({id:n===LIVE_WAR_ROOM_RECIPIENT?'oc_3f92ef62d6160399ee823e74def199e6':n==='A'?'ou_anchor':'ou_assistant',type:n===LIVE_WAR_ROOM_RECIPIENT?'chat_id':'open_id'})};
  const liveSessions={enabled:true,readSchedule:async()=>({...raw,updatedAt:new Date(now).toISOString()})};
  const releaseId='hub-r62-nextday-test',bootId='boot-r62-nextday-test';
  const manifest=nextDayReleaseManifest({raw,snapshot:data,people,participants:runtime.liveParticipants,
    recipient:n=>notifier.recipient(n),date,now,releaseId,bootId});
  const permit={version:2,businessDate:date,scopeHash:manifest.scopeHash,sourceHash:manifest.sourceHash,
    sourceRevision:manifest.sourceRevision,roomCodes:manifest.roomCodes,groupChatId:manifest.groupChatId,
    releaseId,bootId,
    issuedAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+30*60000).toISOString()};
  const job=new LiveNextDayReminder({runtime,liveSessions,notifier,readReleasePermit:()=>permit,
    releaseId,bootId,enabled:true,clock:()=>now});
  const rearm=async()=>{
    const fresh=await liveSessions.readSchedule(null,date,{fresh:true});
    const latest=nextDayReleaseManifest({raw:fresh,snapshot:data,people,participants:runtime.liveParticipants,
      recipient:n=>notifier.recipient(n),date,now,releaseId,bootId});
    Object.assign(permit,{scopeHash:latest.scopeHash,sourceHash:latest.sourceHash,
      sourceRevision:latest.sourceRevision,roomCodes:latest.roomCodes});
    return latest;
  };
  return {job,data,nodes,slot,manifest,permit,rearm,advance:()=>{now+=300001;},setNow:v=>{now=Date.parse(v);},now:()=>now};
}
const verifySource=(f,notice)=>currentOfficialNextDaySource(notice,{runtime:f.job.runtime,liveSessions:f.job.liveSessions,
  notifier:f.job.notifier,readReleasePermit:f.job.readReleasePermit,releaseId:f.job.releaseId,
  bootId:f.job.bootId,clock:f.now});
const permitOptions=f=>({readNextDayPermit:f.job.readReleasePermit,releaseId:f.job.releaseId,bootId:f.job.bootId});
const firstActivationAt=Date.parse('2026-09-24T15:54:00+08:00');
const releaseManifestAt=(f,at)=>({...f.manifest,preparedAt:new Date(at-1000).toISOString()});
const permitTestDirectory=prefix=>{
  const dir=mkdtempSync(join(tmpdir(),prefix));
  if(process.platform==='linux')chmodSync(dir,0o755);
  return dir;
};
const releaseEvidence=(f,checkedAt)=>({operator:'FD-026222',scopeHash:f.manifest.scopeHash,
  sourceRevision:f.manifest.sourceRevision,gatewayReleaseId:f.manifest.releaseId,
  gatewayBootId:f.manifest.bootId,gatewayVerified:true,groupChatId:f.manifest.groupChatId,
  checkedAt:new Date(checkedAt).toISOString(),botAppId:'cli_testbot1234',
  cardMessages:f.manifest.refs.map((r,index)=>({cardNoticeId:r.cardNoticeId,
    cardMessageId:r.cardMessageId,recipientId:r.recipientId,recipientType:r.recipientType,
    chatId:`oc_testcard${index}chat`,messageReadback:{messageId:r.cardMessageId,
      chatId:`oc_testcard${index}chat`,senderAppId:'cli_testbot1234',
      checkedAt:new Date(checkedAt).toISOString()},recipientReadback:{kind:'p2p_member',
      openId:r.recipientId,chatId:`oc_testcard${index}chat`,checkedAt:new Date(checkedAt).toISOString()}}))});

test('only the exact isolated read-only mount path may be configured; no DATA_DIR fallback exists',()=>{
  assert.equal(isolatedNextDayPermitPath({}),null);
  assert.equal(isolatedNextDayPermitPath({FLOW_LIVE_NEXT_DAY_PERMIT_FILE:'/app/data/live-next-day-release-permit.json'}),null);
  assert.equal(isolatedNextDayPermitPath({FLOW_LIVE_NEXT_DAY_PERMIT_FILE:'/run/live-next-day-release/../data/permit.json'}),null);
  assert.equal(isolatedNextDayPermitPath({FLOW_LIVE_NEXT_DAY_PERMIT_FILE:NEXT_DAY_PERMIT_MOUNT}),NEXT_DAY_PERMIT_MOUNT);
});

test('a local release permit is atomically written only after exact external card and group readback',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-permit-'),file=join(dir,'release.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const original=JSON.stringify(f.data);
  const checkedAt=firstActivationAt;
  const evidence=releaseEvidence(f,checkedAt);
  try{
    assert.equal(readNextDayReleasePermit(file,{publicKey}),null);
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,checkedAt),
      evidence:{...evidence,cardMessages:evidence.cardMessages.slice(0,1)},privateKey,clock:()=>checkedAt}),/派工卡独立读回/);
    assert.equal(readNextDayReleasePermit(file,{publicKey}),null);
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,checkedAt),evidence,clock:()=>checkedAt}),/发布私钥/);
    const permit=installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,checkedAt),evidence,privateKey,clock:()=>checkedAt});
    assert.equal(readNextDayReleasePermit(file),null,'missing verifier is always OFF');
    assert.deepEqual(readNextDayReleasePermit(file,{publicKey}),permit);
    if(process.platform==='linux'){
      assert.equal(statSync(dir).mode&0o777,0o755);
      assert.equal(statSync(file).mode&0o777,0o644);
    }
    assert.equal(permit.businessDate,'2026-09-25');
    assert.equal(permit.groupChatId,'oc_3f92ef62d6160399ee823e74def199e6');
    assert.ok(Date.parse(permit.expiresAt)<=Date.parse('2026-09-24T16:30:00+08:00'));
    assert.equal(JSON.stringify(f.data),original,'permit installation never touches the active task/card ledger');
    const renewedAt=Date.parse('2026-09-24T16:20:00+08:00');
    let renewed;
    f.job.runtime.store.transaction(s=>{
      s.tasks[0].runtime.nodes[0].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'A',at:new Date(renewedAt).toISOString()}];
      renewed=installNextDayReleasePermit(file,{manifest:{...f.manifest,preparedAt:new Date(renewedAt).toISOString()},
        evidence:releaseEvidence(f,renewedAt),privateKey,clock:()=>renewedAt});
    });
    assert.equal(f.data.tasks[0].runtime.nodes[0].liveAcknowledgements.length,1,
      'a task callback ledger update must survive release-file installation');
    assert.equal(renewed.scopeHash,permit.scopeHash,'a renewed permit cannot widen the release claim');
    assert.ok(Date.parse(renewed.expiresAt)>Date.parse(permit.expiresAt));
    assert.notEqual(renewed.activationNonce,permit.activationNonce,'each activation receives a fresh nonce');
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:{...f.manifest,businessDate:'2026-09-26'},
      evidence,privateKey,clock:()=>checkedAt}),/签名|范围|日期/);
    assert.equal(JSON.parse(readFileSync(file,'utf8')).scopeHash,renewed.scopeHash);
  }finally{if(readNextDayReleasePermit(file,{publicKey}))unlinkSync(file);rmdirSync(dir);}
});

test('POSIX read-only permit mount is readable by a different Hub UID without exposing the private key',()=>{
  const f=fixture(),root=permitTestDirectory('wis-next-day-cross-uid-');
  const directory=join(root,'release'),file=join(directory,'permit.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  mkdirSync(directory,{mode:0o755});
  if(process.platform==='linux')chmodSync(directory,0o755);
  try{
    const permit=installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,firstActivationAt),
      evidence:releaseEvidence(f,firstActivationAt),privateKey,clock:()=>firstActivationAt});
    assert.deepEqual(readNextDayReleasePermit(file,{publicKey}),permit);
    assert.deepEqual(readdirSync(directory),['permit.json'],'the private signing key is never written to the mounted directory');
    if(process.platform==='linux'){
      assert.equal(statSync(directory).mode&0o777,0o755);
      assert.equal(statSync(file).mode&0o777,0o644);
      assert.equal(statSync(directory).mode&0o001,0o001,'other UID can traverse');
      assert.equal(statSync(file).mode&0o004,0o004,'other UID can read');
      assert.equal(statSync(file).mode&0o002,0,'other UID cannot write');
      if(process.getuid?.()===0){
        const read=spawnSync(process.execPath,['-e',
          "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(!p.signature)process.exit(3)",file],
        {uid:10001,gid:10001,encoding:'utf8'});
        assert.equal(read.status,0,read.stderr||'Hub UID10001 could not read the signed permit');
      }
    }
  }finally{unlinkSync(file);rmdirSync(directory);rmdirSync(root);}
});

test('an already activated permit is not misreported as failed when lock cleanup fails',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-lock-'),file=join(dir,'permit.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  let ticks=0;
  const previousLog=console.error;
  try{
    console.error=()=>{throw Error('release logger unavailable');};
    const permit=installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,firstActivationAt),
      evidence:releaseEvidence(f,firstActivationAt),privateKey,clock:()=>{
        if(++ticks===2)unlinkSync(file+'.install.lock');
        return firstActivationAt;
      }});
    assert.equal(ticks,2);
    assert.deepEqual(readNextDayReleasePermit(file,{publicKey}),permit);
  }finally{console.error=previousLog;if(existsSync(file))unlinkSync(file);rmdirSync(dir);}
});

test('signed permit is OFF for an absent key, wrong key, legacy format or changed field',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-signed-'),file=join(dir,'permit.json');
  const pair=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
  const now=firstActivationAt,evidence=releaseEvidence(f,now);
  try{
    const permit=installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,now),evidence,
      privateKey:pair.privateKey,clock:()=>now});
    const publicDer=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
    assert.equal(readNextDayReleasePermit(file),null);
    assert.equal(readNextDayReleasePermit(file,{publicKey:other.publicKey}),null);
    assert.deepEqual(readNextDayReleasePermit(file,{publicKey:publicDer}),permit);
    for(const changed of [
      {...permit,sourceRevision:permit.sourceRevision+1},
      {...permit,activationNonce:'00000000-0000-4000-8000-000000000000'},
      {...permit,expiresAt:new Date(now+31*60000).toISOString()},
      {...permit,version:1},
      {...permit,signature:undefined},
    ]){
      writeFileSync(file,JSON.stringify(changed));
      assert.equal(readNextDayReleasePermit(file,{publicKey:pair.publicKey}),null);
    }
  }finally{unlinkSync(file);rmdirSync(dir);}
});

test('a message ID alone cannot authorize a person: every card needs exact recipient readback',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-recipient-'),file=join(dir,'permit.json');
  const {privateKey}=generateKeyPairSync('ed25519'),now=firstActivationAt;
  const modify=[
    row=>{delete row.recipientReadback;},
    row=>{row.recipientReadback.openId='ou_someone_else';},
    row=>{row.recipientReadback.chatId='oc_other_chat';},
    row=>{row.recipientReadback.kind='unverified';},
    row=>{row.recipientReadback.checkedAt=new Date(now-121000).toISOString();},
  ];
  try{
    for(const change of modify){
      const evidence=releaseEvidence(f,now);
      change(evidence.cardMessages[0]);
      assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,now),evidence,
        privateKey,clock:()=>now}),/目标本人 open_id 与会话归属的独立读回/);
    }
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,now),
      evidence:{...releaseEvidence(f,now),cardMessages:f.manifest.refs.map(r=>({
        cardNoticeId:r.cardNoticeId,cardMessageId:r.cardMessageId}))},
      privateKey,clock:()=>now}),/目标本人 open_id 与会话归属的独立读回/);
  }finally{rmdirSync(dir);}
});

test('a slow fsync crossing the first activation cutoff leaves no permit file',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-cutoff-'),file=join(dir,'permit.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const before=Date.parse('2026-09-24T15:54:59.900+08:00');
  const after=Date.parse('2026-09-24T15:55:00.001+08:00');
  const times=[before,after];
  try{
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,before),
      evidence:releaseEvidence(f,before),privateKey,clock:()=>times.shift(),
      notAfterMs:Date.parse('2026-09-24T15:55:00+08:00')}),/原子提交时已超出批准时窗/);
    assert.equal(existsSync(file),false);
    assert.deepEqual(readdirSync(dir),[],'temporary file and lock are removed');
    assert.equal(readNextDayReleasePermit(file,{publicKey}),null);
  }finally{rmdirSync(dir);}
});

test('a first permit after 15:55 and an expired renewal cannot catch up',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-late-'),file=join(dir,'permit.json');
  const {privateKey}=generateKeyPairSync('ed25519');
  const first=firstActivationAt,later=Date.parse('2026-09-24T16:30:00+08:00');
  try{
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,later),
      evidence:releaseEvidence(f,later),privateKey,clock:()=>later}),/首次激活必须在上海时间 15:55 前/);
    assert.equal(existsSync(file),false);
    installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,first),
      evidence:releaseEvidence(f,first),privateKey,clock:()=>first});
    assert.throws(()=>installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,later),
      evidence:releaseEvidence(f,later),privateKey,clock:()=>later}),/首次激活必须在上海时间 15:55 前/);
  }finally{unlinkSync(file);rmdirSync(dir);}
});

test('same Hub rejects rollback to an older signed activation and clock rollback',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-rollback-'),file=join(dir,'permit.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  let now=firstActivationAt;
  try{
    const original=installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,now),evidence:releaseEvidence(f,now),
      privateKey,clock:()=>now});
    const reader=createNextDayReleaseReader(file,{publicKey,releaseId:f.job.releaseId,
      bootId:f.job.bootId,clock:()=>now});
    assert.deepEqual(reader(),original);
    now+=20*60000;
    const renewed=installNextDayReleasePermit(file,{manifest:{...f.manifest,preparedAt:new Date(now).toISOString()},
      evidence:releaseEvidence(f,now),privateKey,clock:()=>now});
    assert.deepEqual(reader(),renewed);
    writeFileSync(file,JSON.stringify(original));
    assert.equal(reader(),null,'older signed file is not reusable in the same process');
    writeFileSync(file,JSON.stringify(renewed));
    assert.equal(reader(),null,'a rollback permanently closes the current process gate');
    const fresh=createNextDayReleaseReader(file,{publicKey,releaseId:f.job.releaseId,
      bootId:'new-process-boot-id',clock:()=>now});
    assert.equal(fresh(),null,'restarting the process cannot reuse the previous boot permit');
  }finally{unlinkSync(file);rmdirSync(dir);}
});

test('signed activation is permanently closed after local clock moves backward',()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-clock-'),file=join(dir,'permit.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  let now=firstActivationAt;
  try{
    const permit=installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,now),evidence:releaseEvidence(f,now),
      privateKey,clock:()=>now});
    const reader=createNextDayReleaseReader(file,{publicKey,releaseId:f.job.releaseId,
      bootId:f.job.bootId,clock:()=>now});
    assert.deepEqual(reader(),permit);
    now-=2000;
    assert.equal(reader(),null);
    now+=2000;
    assert.equal(reader(),null,'correcting the wall clock cannot reopen the same process gate');
  }finally{unlinkSync(file);rmdirSync(dir);}
});

test('unactivated Hub queues nothing, then a signed permit is checked again before POST',async()=>{
  const f=fixture(),dir=permitTestDirectory('wis-next-day-gate-'),file=join(dir,'permit.json');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const reader=createNextDayReleaseReader(file,{publicKey,releaseId:f.job.releaseId,
    bootId:f.job.bootId,clock:f.now});
  f.job.readReleasePermit=reader;
  try{
    await f.job.tick();
    assert.equal(f.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);
    installNextDayReleasePermit(file,{manifest:releaseManifestAt(f,firstActivationAt),
      evidence:releaseEvidence(f,firstActivationAt),privateKey,clock:()=>firstActivationAt});
    f.advance();
    await f.job.tick();
    const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
    assert.ok(direct,'activation permits a fresh source-bound queue');
    const corrupted=JSON.parse(readFileSync(file,'utf8'));
    corrupted.sourceHash='0'.repeat(64);
    writeFileSync(file,JSON.stringify(corrupted));
    let posts=0;
    const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
      ...permitOptions(f),env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',
        FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
      fetchImpl:async()=>{posts++;throw Error('must not reach Feishu');}});
    await sender.flush();
    assert.equal(posts,0,'invalid activation cannot acquire a token or POST');
    assert.equal(direct.state,'superseded');
  }finally{unlinkSync(file);rmdirSync(dir);}
});

test('no permit or a slow source check crossing 17:00 cannot enqueue a formal reminder',async()=>{
  const absent=fixture();absent.job.readReleasePermit=()=>null;
  await absent.job.tick();
  assert.equal(absent.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);
  const late=fixture(),read=late.job.liveSessions.readSchedule;
  late.job.liveSessions.readSchedule=async(...args)=>{
    const raw=await read(...args);
    late.setNow('2026-09-24T17:00:01+08:00');
    return {...raw,updatedAt:new Date(late.now()).toISOString()};
  };
  await late.job.tick();
  assert.equal(late.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);
});

test('15:59 cannot enqueue or POST even with a pre-installed permit and a due queued notice',async()=>{
  const f=fixture();
  f.setNow('2026-09-24T15:59:00+08:00');
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);
  f.setNow('2026-09-24T16:00:00+08:00');
  await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  assert.ok(direct);
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  f.setNow('2026-09-24T15:59:59+08:00');
  f.permit.issuedAt=new Date(f.now()-60000).toISOString();
  direct.nextAt=f.now()-1;
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor'})},
    fetchImpl:async()=>{posts++;throw Error('must not POST');}});
  await sender.flush();
  assert.equal(posts,0);
  assert.equal(direct.state,'superseded');
});

test('missing even one of the four official rooms blocks the whole release',async()=>{
  const f=fixture(),read=f.job.liveSessions.readSchedule;
  f.job.liveSessions.readSchedule=async(...args)=>{
    const raw=await read(...args);
    return {...raw,rooms:raw.rooms.filter(room=>room.code!=='wangou')};
  };
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
  assert.match(f.data.liveNextDayStatus.issues.map(x=>x.message).join('；'),/全部四个直播间|四房解析/);
});

test('permit expiry inside 16:00 stops POST after token acquisition',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  f.permit.expiresAt=new Date(f.now()+1000).toISOString();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  const sent=await flushAfterTokenWait(f,()=>f.setNow('2026-09-24T16:00:02+08:00'),{map:{A:'ou_anchor'}});
  assert.deepEqual(sent,[]);
  assert.equal(direct.state,'attention');
  assert.equal(direct.unknown,false);
});

test('a new workbook revision or a changed assignment-card receipt cannot use the prior permit',async()=>{
  for(const change of ['source-revision','card-message']){
    const f=fixture();await f.job.tick();
    f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
    const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
    const original=f.job.liveSessions.readSchedule;
    const sent=await flushAfterTokenWait(f,()=>{
      if(change==='source-revision')f.job.liveSessions.readSchedule=async(...args)=>{
        const raw=await original(...args);
        return {...raw,sourceStatus:{...raw.sourceStatus,guanqi:{...raw.sourceStatus.guanqi,revision:16}}};
      };
      else f.data.flowNotifications.find(n=>n.id==='card-0').messageId='om_changed';
    },{map:{A:'ou_anchor'}});
    assert.deepEqual(sent,[],change);
    assert.equal(direct.state,'attention',change);
    assert.equal(direct.unknown,false,change);
  }
});

test('a new reminder object in the same Hub instance does not duplicate queued or uncertain notices',async()=>{
  const f=fixture();await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,2);
  const restarted=new LiveNextDayReminder({runtime:f.job.runtime,liveSessions:f.job.liveSessions,notifier:f.job.notifier,
    readReleasePermit:f.job.readReleasePermit,releaseId:f.job.releaseId,bootId:f.job.bootId,enabled:true,clock:f.now});
  await restarted.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,2);
  const uncertain=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  uncertain.state='sending';uncertain.leaseId='expired';uncertain.leaseUntil=f.now()-1;
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor'})},
    fetchImpl:async()=>{posts++;throw Error('must not POST');}});
  await sender.flush();
  assert.equal(posts,0);
  assert.equal(uncertain.state,'attention');
  assert.equal(uncertain.unknown,true);
});

test('an old volume permit cannot authorize a new Hub process or build at 16:00',async()=>{
  const f=fixture();
  const replaced=new LiveNextDayReminder({runtime:f.job.runtime,liveSessions:f.job.liveSessions,notifier:f.job.notifier,
    readReleasePermit:f.job.readReleasePermit,releaseId:f.job.releaseId,bootId:'boot-restarted-instance',
    enabled:true,clock:f.now});
  await replaced.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,0);
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,2);
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  let posts=0;
  const replacementSender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
    ...permitOptions(f),bootId:'boot-restarted-instance',
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor'})},
    fetchImpl:async()=>{posts++;throw Error('must not POST');}});
  await replacementSender.flush();
  assert.equal(posts,0);
  assert.equal(f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A').state,'superseded');
  const wrongBuild=new LiveNextDayReminder({runtime:f.job.runtime,liveSessions:f.job.liveSessions,notifier:f.job.notifier,
    readReleasePermit:f.job.readReleasePermit,releaseId:'hub-r63-different-build',bootId:f.job.bootId,
    enabled:true,clock:f.now});
  await wrongBuild.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,2);
});

test('an absent production RELEASE_ID fallback of local blocks enqueue and transport',async()=>{
  const f=fixture();
  const formalRelease=f.job.releaseId;
  f.job.releaseId='local';
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
  f.job.releaseId=formalRelease;
  f.advance();
  await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  assert.ok(direct);
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,
    ...permitOptions(f),releaseId:'local',
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor'})},
    fetchImpl:async()=>{posts++;throw Error('must not POST');}});
  await sender.flush();
  assert.equal(posts,0);
  assert.equal(direct.state,'superseded');
});

test('next-day messages are queued once; group confirms only after delivery and real acknowledgements',async()=>{
  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow');
  assert.equal(direct.length,2);
  assert.ok(direct.every(n=>n.delivery.channel==='live_tomorrow_text'&&currentNodeNotice(n,f.data.tasks[0],f.nodes.find(x=>x.id===n.nodeId),f.now())));
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.includes('group')).length,0);
  direct.forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(pending&&currentNextDayGroup(pending,f.data,f.now()));
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_confirmed').length,0);
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');
  assert.ok(confirmed&&currentNextDayGroup(confirmed,f.data,f.now()));
  assert.match(JSON.parse(confirmed.delivery.content).text,/已确认/);
  f.advance();await f.job.tick();assert.equal(f.data.flowNotifications.filter(n=>n.kind!=='live_assignment').length,4);
});

test('16:00 reminder window ends at 17:00, including queued direct and group notices',async()=>{
  const late=fixture();late.setNow('2026-09-24T23:59:00+08:00');
  await late.job.tick();
  assert.equal(late.data.flowNotifications.filter(n=>n.kind.startsWith('live_tomorrow')).length,0);

  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow');
  assert.ok(currentNodeNotice(direct,f.data.tasks[0],f.nodes[0],f.now()));
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{
    n.state='sent';n.messageId=`om_direct_${i}`;
  });
  f.advance();await f.job.tick();
  const group=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(group&&currentNextDayGroup(group,f.data,f.now()));
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');
  assert.ok(confirmed&&currentNextDayGroup(confirmed,f.data,f.now()));
  f.setNow('2026-09-24T17:00:00+08:00');
  assert.equal(currentNodeNotice(direct,f.data.tasks[0],f.nodes[0],f.now()),false);
  assert.equal(currentNextDayGroup(group,f.data,f.now()),false);
  assert.equal(currentNextDayGroup(confirmed,f.data,f.now()),false);
});

test('outdated date or changed official schedule invalidates unsent messages',async()=>{
  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow');
  f.data.tasks[0].runtime.liveSession.signature='changed';
  assert.equal(currentNodeNotice(direct,f.data.tasks[0],f.nodes[0],f.now()),false);
  f.data.tasks[0].runtime.liveSession.signature=f.slot.signature;
  f.setNow('2026-09-25T00:01:00+08:00');
  assert.equal(currentNodeNotice(direct,f.data.tasks[0],f.nodes[0],f.now()),false);
});

test('an official source issue blocks reminders for that room',async()=>{
  const f=fixture(),read=f.job.liveSessions.readSchedule;
  f.job.liveSessions.readSchedule=async(...args)=>({...await read(...args),issues:[{roomCode:'guanqi',message:'班表待核验'}]});
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind!=='live_assignment').length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
});

test('a new official-sheet assignment during token wait blocks wrong-person POST even while the task is stale',async()=>{
  const f=fixture();await f.job.tick();
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  const oldRead=f.job.liveSessions.readSchedule;
  const sent=await flushAfterTokenWait(f,()=>{
    f.job.liveSessions.readSchedule=async(req,date,options)=>{
      assert.equal(options?.fresh,true);
      const raw=await oldRead(req,date,options);
      return {...raw,rooms:raw.rooms.map(room=>({...room,anchors:[['09:00','10:00','主播丙']]}))};
    };
  },{map:{A:'ou_anchor',B:'ou_assistant'}});
  assert.deepEqual(sent,[]);
  assert.equal(direct.state,'attention');
  assert.match(direct.error,/正式班表.*核验/);
});

test('formal live assignment, today, ready and returned cards recheck the official sheet after token wait',async()=>{
  for(const kind of ['live_assignment','live_today','ready','returned']){
    const f=fixture(),notice=f.data.flowNotifications.find(n=>n.recipient==='A');
    notice.state='ready';notice.kind=kind;notice.nextAt=f.now();
    if(['ready','returned'].includes(kind))f.nodes[0].state='ready';
    if(kind==='live_today'){f.setNow('2026-09-25T08:00:00+08:00');notice.businessDate='2026-09-25';}
    assert.equal(needsOfficialLiveSource(notice,f.data.tasks[0]),true);
    const originalRead=f.job.liveSessions.readSchedule,sent=[];
    const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
      env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
      verifyLiveNoticeSource:row=>verifySource(f,row),
      fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))sent.push(url);return Response.json({code:0,data:{message_id:'om_unexpected'}});}});
    let releaseToken;
    sender.tenantToken=()=>new Promise(resolve=>{releaseToken=resolve;});
    const sending=sender.flush();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof releaseToken,'function');
    f.job.liveSessions.readSchedule=async(req,date,options)=>{
      assert.equal(options?.fresh,true);
      const raw=await originalRead(req,date,options);
      return {...raw,rooms:raw.rooms.map(room=>({...room,anchors:[['09:00','10:00','助理乙']]}))};
    };
    releaseToken('token');await sending;
    assert.deepEqual(sent,[],kind);
    assert.equal(notice.state,'attention',kind);
    assert.match(notice.error,/正式班表.*核验/,kind);
  }
});

test('a source-unreadable live card stays attention and manual retry cannot POST while source remains unreadable',async()=>{
  const f=fixture(),notice=f.data.flowNotifications.find(n=>n.recipient==='A');
  notice.state='ready';notice.kind='live_assignment';notice.nextAt=f.now();
  f.job.liveSessions.readSchedule=async()=>{throw new Error('official sheet unavailable');};
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
    verifyLiveNoticeSource:row=>verifySource(f,row),
    fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))posts++;return Response.json({code:0,data:{message_id:'om_unexpected'}});}});
  sender.token={value:'token',until:f.now()+3600000};
  await sender.flush();
  assert.equal(notice.state,'attention');assert.equal(notice.unknown,false);assert.equal(posts,0);
  f.data.tasks[0].runtime.participants=['A'];
  sender.retry({user:{number:'A'},canManage:true},notice.id);
  await sender.flush();
  assert.equal(notice.state,'attention');assert.equal(posts,0);
});

test('a current formal live card is allowed, while a source-change alert needs no current shift',async()=>{
  const f=fixture(),card=f.data.flowNotifications.find(n=>n.recipient==='A');
  card.state='ready';card.nextAt=f.now();
  assert.equal(await verifySource(f,card),true);
  const alert={...card,kind:'live_source_changed'};
  f.job.liveSessions.readSchedule=async()=>{throw new Error('official sheet unavailable');};
  assert.equal(needsOfficialLiveSource(alert,f.data.tasks[0]),false);
  assert.equal(await verifySource(f,alert),true);
});

test('manager source-change alert still sends when the official sheet cannot be read',async()=>{
  const f=fixture(),task=f.data.tasks[0];
  task.runtime.manager={number:'A'};task.runtime.liveSession.sourceIssue='正式班表发生变化';
  const alert={id:'source-alert',taskId:task.id,nodeId:null,attempt:0,recipient:'A',kind:'live_source_changed',state:'ready',attempts:0,nextAt:f.now(),createdAt:new Date(f.now()).toISOString()};
  f.data.flowNotifications.push(alert);
  f.job.liveSessions.readSchedule=async()=>{throw new Error('official sheet unavailable');};
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},
    verifyLiveNoticeSource:row=>verifySource(f,row),
    fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))posts++;return Response.json({code:0,data:{message_id:'om_source_alert'}});}});
  sender.token={value:'token',until:f.now()+3600000};
  await sender.flush();
  assert.equal(posts,1);assert.equal(alert.state,'sent');
});

test('a verified shift without a formal task is reported instead of marked ready',async()=>{
  const f=fixture();f.data.tasks=[];
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind!=='live_assignment').length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
  assert.match(f.data.liveNextDayStatus.issues[0].message,/尚未派工/);
});

test('an unmapped assistant is reported and the group is not told everyone was notified',async()=>{
  const f=fixture();f.job.notifier.recipient=number=>number==='A'?{id:'ou_anchor'}:null;
  await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').length,0);
  assert.equal(f.data.liveNextDayStatus.state,'attention');
  f.advance();await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind.includes('group')).length,0);
});
test('OA-only participant or unsent assignment card blocks all next-day messages for the room',async()=>{
  for(const failure of ['no-card','no-card-permission']){
    const f=fixture();
    if(failure==='no-card')f.data.flowNotifications.find(n=>n.kind==='live_assignment'&&n.recipient==='B').state='ready';
    else f.job.runtime.liveParticipants.canOwn=number=>number==='A';
    await f.job.tick();
    assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'||n.kind.includes('group')).length,0);
    assert.equal(f.data.liveNextDayStatus.state,'attention');
    assert.match(f.data.liveNextDayStatus.issues[0].message,/派工卡|卡片身份绑定/);
  }
});

test('a new execution attempt gets a fresh reminder and cannot reuse the old group acknowledgement',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const previous=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(previous);
  f.nodes[0].attempt=2;
  f.data.flowNotifications.push({id:'card-retry',taskId:'T1',nodeId:f.nodes[0].id,attempt:2,recipient:'A',kind:'live_assignment',state:'sent',messageId:'om_card_retry'});
  f.nodes[0].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'A',at:new Date(f.now()).toISOString()}];
  assert.equal(currentNextDayGroup(previous,f.data,f.now()),false);
  f.advance();await f.job.tick();
  assert.deepEqual(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'&&n.recipient==='A').map(n=>n.attempt),[1],
    'a changed attempt is blocked until the whole release claim is independently renewed');
  await f.rearm();
  f.advance();await f.job.tick();
  const fresh=f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  assert.deepEqual(fresh.map(n=>n.attempt),[1,2]);
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_pending').length,1);
  fresh.at(-1).state='sent';fresh.at(-1).messageId='om_direct_retry';f.advance();await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_pending').length,2);
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_confirmed').length,0);
});

test('queued group summary is invalid if a formal assignment card loses its sent receipt',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(currentNextDayGroup(pending,f.data,f.now()));
  f.data.flowNotifications.find(n=>n.kind==='live_assignment'&&n.recipient==='B').messageId=null;
  assert.equal(currentNextDayGroup(pending,f.data,f.now()),false);
});

test('旧轮次和非本人回执不能确认新轮次，排队中的待确认群消息在全员确认后失效',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');
  assert.ok(pending&&currentNextDayGroup(pending,f.data,f.now()));
  f.nodes[0].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'B',at:new Date(f.now()).toISOString()}];
  f.nodes[1].liveAcknowledgements=[{kind:'live_ack',attempt:1,by:'B',at:new Date(f.now()).toISOString()}];
  assert.equal(currentNextDayGroup({kind:'live_tomorrow_group_confirmed',businessDate:pending.businessDate,related:pending.related},f.data,f.now()),false);
  f.nodes[0].liveAcknowledgements.push({kind:'live_ack',attempt:1,by:'A',at:new Date(f.now()).toISOString()});
  assert.equal(currentNextDayGroup(pending,f.data,f.now()),false);
  f.advance();await f.job.tick();assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow_group_confirmed').length,1);
});

test('direct reminder states assigned role and does not claim completion',()=>{
  const f=fixture();const message=nextDayDirectMessage(f.slot,'B','assistant','助理乙');
  assert.match(message,/9月25日（星期五）/);assert.match(message,/直播助理/);assert.match(message,/确认收到不等于|不会把工作标记为完成/);
});

test('two assistants covering different parts of one anchor shift receive their own times, not the anchor full shift',async()=>{
  const f=fixture(),raw=await f.job.liveSessions.readSchedule();
  const people=f.job.runtime.people();
  people.push({...people[1],number:'C',name:'助理丙'});
  f.job.runtime.liveParticipants.canOwn=number=>['A','B','C'].includes(number);
  raw.rooms[0].anchors=[['09:00','17:00','主播甲']];
  raw.rooms[0].assistants=[['09:00','13:00','助理乙'],['13:00','17:00','助理丙']];
  const slot=scheduleSessions(raw,raw.date,people,f.now(),f.job.runtime.liveParticipants)[0];
  const early=nextDayDirectMessage(slot,'B','assistant','助理乙');
  const late=nextDayDirectMessage(slot,'C','assistant','助理丙');
  assert.match(early,/09:00-17:00 主播班次/);
  assert.match(early,/本人班表时段：09:00-13:00，本场协助时段：09:00-13:00/);
  assert.match(late,/本人班表时段：13:00-17:00，本场协助时段：13:00-17:00/);
  assert.doesNotMatch(early,/本人班表时段：09:00-17:00/);
  assert.doesNotMatch(late,/本人班表时段：09:00-17:00/);
});

test('assistant-time correction preserves formal task signature but invalidates the old queued text and queues a corrected reminder',async()=>{
  const f=fixture();await f.job.tick();
  const old=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B');
  assert.ok(old);
  const originalRead=f.job.liveSessions.readSchedule;
  f.job.liveSessions.readSchedule=async(...args)=>{
    const raw=await originalRead(...args);
    return {...raw,rooms:raw.rooms.map(room=>({...room,assistants:[['08:30','10:00','助理乙']]}))};
  };
  const changed=await f.job.liveSessions.readSchedule();
  assert.equal(scheduleSessions(changed,changed.date,f.job.runtime.people(),f.now(),f.job.runtime.liveParticipants)[0].signature,f.slot.signature);
  assert.equal(await verifySource(f,old),false);
  f.advance();await f.job.tick();
  assert.equal(f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'&&n.recipient==='B').length,1,
    'a corrected time cannot reuse the old source permit');
  await f.rearm();
  f.advance();await f.job.tick();
  const notices=f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow'&&n.recipient==='B');
  assert.equal(notices.length,2);
  assert.notEqual(notices[0].shiftFingerprint,notices[1].shiftFingerprint);
  assert.match(JSON.parse(notices[1].delivery.content).text,/本人班表时段：08:30-10:00，本场协助时段：09:00-10:00/);
});

test('confirmed group notice routes to the exact approved Feishu chat with a stable message UUID',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const sent=[];
  const sender=new FlowFeishu(f.job.runtime.store,{people:()=>[],clock:f.now,...permitOptions(f),env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6'},fetchImpl:async(url,options)=>{
    if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'token',expire:7200});
    sent.push({url,body:JSON.parse(options.body)});return Response.json({code:0,data:{message_id:'om_group'}});
  },verifyLiveNoticeSource:()=>verifySource(f,f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed'))});
  assert.equal(sender.recipient(LIVE_WAR_ROOM_RECIPIENT).type,'chat_id');
  await sender.flush();
  assert.equal(sent.length,1);
  assert.equal(sent[0].body.receive_id,'oc_3f92ef62d6160399ee823e74def199e6');
  assert.match(sent[0].url,/receive_id_type=chat_id/);
  assert.equal(f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed').state,'sent');
});

async function flushAfterTokenWait(f,mutate,{map={}}={}){
  const sent=[];
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify(map)},
    verifyLiveNoticeSource:notice=>verifySource(f,notice),
    fetchImpl:async(url)=>{if(url.includes('/im/v1/messages'))sent.push(url);return Response.json({code:0,data:{message_id:'om_unexpected'}});}});
  let releaseToken;
  sender.tenantToken=()=>new Promise(resolve=>{releaseToken=resolve;});
  const flushing=sender.flush();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof releaseToken,'function','send lease should wait for token before POST');
  mutate(sender);
  releaseToken('token');
  await flushing;
  return sent;
}

test('confirmed group is superseded if an acknowledgement changes during token acquisition',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');assert.ok(confirmed);
  const sent=await flushAfterTokenWait(f,()=>{f.nodes[1].liveAcknowledgements=[];});
  assert.deepEqual(sent,[]);
  assert.equal(confirmed.state,'superseded');
});

test('group summary cannot POST after an official-sheet edit that the persisted task has not reconciled',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');assert.ok(pending);
  const oldRead=f.job.liveSessions.readSchedule;
  const sent=await flushAfterTokenWait(f,()=>{
    f.job.liveSessions.readSchedule=async(req,date,options)=>{
      assert.equal(options?.fresh,true);
      const raw=await oldRead(req,date,options);
      return {...raw,rooms:raw.rooms.map(room=>({...room,assistants:[['09:00','10:00','助理丙']]}))};
    };
  });
  assert.deepEqual(sent,[]);
  assert.equal(pending.state,'attention');
});

test('a duplicate group member reference cannot replace an omitted person or POST',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');assert.ok(pending);
  assert.equal(currentNextDayRelease(f.permit,{manifest:f.manifest,notice:pending,now:f.now(),
    releaseId:f.job.releaseId,bootId:f.job.bootId}),true);
  pending.related[1]={...pending.related[0]};
  assert.equal(currentNextDayRelease(f.permit,{manifest:f.manifest,notice:pending,now:f.now(),
    releaseId:f.job.releaseId,bootId:f.job.bootId}),false);
  const sent=await flushAfterTokenWait(f,()=>{});
  assert.deepEqual(sent,[]);
  assert.equal(pending.state,'attention');
});

test('pending group is superseded if everyone confirms while token is being obtained',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.advance();await f.job.tick();
  const pending=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_pending');assert.ok(pending);
  const sent=await flushAfterTokenWait(f,()=>{f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);});
  assert.deepEqual(sent,[]);
  assert.equal(pending.state,'superseded');
});

test('direct reminder is superseded if the owner, attempt or Feishu recipient changes before POST',async()=>{
  for(const change of ['owner','attempt','recipient']){
    const f=fixture();await f.job.tick();
    const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
    f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
    const sent=await flushAfterTokenWait(f,sender=>{
      if(change==='owner')f.nodes[0].owner.number='B';
      if(change==='attempt')f.nodes[0].attempt=2;
      if(change==='recipient')sender.map.A='ou_changed';
    },{map:{A:'ou_anchor',B:'ou_assistant'}});
    assert.deepEqual(sent,[],change);
    assert.equal(direct.state,change==='recipient'?'superseded':'attention',change);
  }
});

test('token wait crossing 17:00 cannot POST an otherwise valid direct reminder',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  f.setNow('2026-09-24T16:59:59+08:00');
  f.permit.issuedAt='2026-09-24T08:45:00.000Z';
  f.permit.expiresAt='2026-09-24T09:00:00.000Z';
  const sent=await flushAfterTokenWait(f,()=>f.setNow('2026-09-24T17:00:01+08:00'),
    {map:{A:'ou_anchor'}});
  assert.deepEqual(sent,[]);
  assert.equal(direct.state,'attention');
  assert.equal(direct.unknown,false);
});

test('group confirmation is explicitly scoped to listed verified shifts if another room shift is added later',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');assert.ok(confirmed);
  f.data.tasks.push({id:'T-later',runtime:{state:'running',liveSession:{...f.slot,key:'live:later',signature:'later-shift',startAt:'2026-09-25T02:00:00.000Z',endAt:'2026-09-25T03:00:00.000Z'},nodes:[]}});
  assert.equal(currentNextDayGroup(confirmed,f.data,f.now()),true,'the original notice still describes its immutable listed shifts');
  const message=JSON.parse(confirmed.delivery.content).text;
  assert.match(message,/以下已核验班次人员已确认/);
  assert.match(message,/仅汇总以下已核验班次/);
  assert.match(message,/后续新增或调整的其他班次，以后续通知为准/);
  assert.doesNotMatch(message,/本直播间所有班次.*已确认/);
});

function managementReceipt(f,notice){
  const task=f.data.tasks[0];
  Object.assign(task,{workflow:'04',center:'直播中心',title:'隔离直播场次',assignee:{name:'主管甲',number:'A'}});
  task.runtime.participants=['A','B'];task.runtime.manager={number:'A'};
  for(const node of task.runtime.nodes)node.dependencies=[];
  const runtime=new FlowRuntime(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now});
  const manager={enabled:true,canManage:true,department:false,modules:['live-room-management'],user:{number:'A',name:'主管甲',center:'直播中心'}};
  const detail=runtime.get(manager,task.id);
  assert.deepEqual(detail.notifications.find(row=>row.id===notice.id)?.state,'attention');
  assert.match(detail.notifications.find(row=>row.id===notice.id)?.error||'',/发送结果不明.*人工核验/);
  assert.ok(runtime.overview(manager).metrics.notificationAttention>=1);
}

test('previously unknown group send becomes visible attention without acquiring another token',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{n.state='sent';n.messageId=`om_direct_${i}`;});
  f.nodes.forEach(n=>n.liveAcknowledgements=[{kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()}]);
  f.advance();await f.job.tick();
  const confirmed=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow_group_confirmed');assert.ok(confirmed);
  confirmed.unknown=true;confirmed.firstAttemptAt=new Date(f.now()-60000).toISOString();
  let tokenCalls=0,posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6'},
    fetchImpl:async()=>{posts++;throw Error('must not POST');}});
  sender.tenantToken=async()=>{tokenCalls++;return 'token';};
  await sender.flush();
  assert.equal(tokenCalls,0);assert.equal(posts,0);
  assert.equal(confirmed.state,'attention');assert.equal(confirmed.unknown,true);
  managementReceipt(f,confirmed);
  await sender.flush();assert.equal(confirmed.state,'attention');
});

test('stale unknown ready notice and expired sending lease both remain attention without another POST',async()=>{
  for(const prior of ['unknown-ready','expired-sending']){
    const f=fixture();await f.job.tick();
    const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
    f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
    direct.firstAttemptAt=new Date(f.now()-60000).toISOString();
    if(prior==='unknown-ready'){direct.unknown=true;direct.state='ready';direct.nextAt=f.now()+120000;}
    else{direct.state='sending';direct.leaseId='old-lease';direct.leaseUntil=f.now()-1;}
    let posts=0;
    const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'})},fetchImpl:async()=>{posts++;throw Error('must not send')}});
    await sender.flush();await sender.flush();
    assert.equal(posts,0,prior);assert.equal(direct.state,'attention',prior);assert.equal(direct.unknown,true,prior);
    assert.match(direct.error,/发送结果不明.*人工核验/,prior);
    assert.equal(direct.leaseId,undefined,prior);
    managementReceipt(f,direct);
  }
});

test('unknown direct reminder near one-hour UUID boundary is held before token wait',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  f.setNow('2026-09-24T16:59:59+08:00');
  direct.unknown=true;direct.firstAttemptAt=new Date(f.now()-3599000).toISOString();
  let tokenCalls=0,posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor'})},
    fetchImpl:async()=>{posts++;throw Error('must not POST');}});
  sender.tenantToken=async()=>{tokenCalls++;f.setNow('2026-09-24T17:00:01+08:00');return 'token';};
  await sender.flush();
  assert.equal(tokenCalls,0);assert.equal(posts,0);
  assert.equal(direct.state,'attention');assert.equal(direct.unknown,true);
  f.data.tasks[0].runtime.participants=['A'];
  assert.throws(()=>sender.retry({user:{number:'A'},canManage:true},direct.id),
    /发送结果不明.*禁止重发/);
});

test('uncertain next-day transport result remains attention after the first POST',async()=>{
  const f=fixture();await f.job.tick();
  f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='B').state='superseded';
  const direct=f.data.flowNotifications.find(n=>n.kind==='live_tomorrow'&&n.recipient==='A');
  let posts=0;
  const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
    env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor'})},
    verifyLiveNoticeSource:notice=>verifySource(f,notice),
    fetchImpl:async()=>{posts++;throw Error('transport result unknown');}});
  sender.tenantToken=async()=> 'token';
  await sender.flush();
  assert.equal(posts,1);assert.equal(direct.state,'attention');assert.equal(direct.unknown,true);
  f.advance();await sender.flush();
  assert.equal(posts,1);
});

test('success response without message ID is unknown and cannot retry any next-day notice kind',async()=>{
  for(const kind of ['live_tomorrow','live_tomorrow_group_pending','live_tomorrow_group_confirmed']){
    const f=fixture();await f.job.tick();
    if(kind!=='live_tomorrow'){
      f.data.flowNotifications.filter(n=>n.kind==='live_tomorrow').forEach((n,i)=>{
        n.state='sent';n.messageId=`om_direct_${i}`;
      });
      f.advance();await f.job.tick();
    }
    if(kind==='live_tomorrow_group_confirmed'){
      f.nodes.forEach(n=>n.liveAcknowledgements=[{
        kind:'live_ack',attempt:n.attempt,by:n.owner.number,at:new Date(f.now()).toISOString()
      }]);
      f.advance();await f.job.tick();
    }
    const target=f.data.flowNotifications.find(n=>n.kind===kind);
    assert.ok(target,kind);
    for(const notice of f.data.flowNotifications){
      if(notice!==target&&notice.state==='ready')notice.state='superseded';
    }
    let posts=0;
    const sender=new FlowFeishu(f.job.runtime.store,{people:f.job.runtime.people,clock:f.now,...permitOptions(f),
      env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',
        FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({A:'ou_anchor',B:'ou_assistant'}),
        FLOW_LIVE_WAR_ROOM_CHAT_ID:'oc_3f92ef62d6160399ee823e74def199e6'},
      verifyLiveNoticeSource:notice=>verifySource(f,notice),
      fetchImpl:async()=>{posts++;return Response.json({code:0,data:{}});}});
    sender.tenantToken=async()=> 'token';
    await sender.flush();
    assert.equal(posts,1,kind);
    assert.equal(target.state,'attention',kind);
    assert.equal(target.unknown,true,kind);
    assert.ok(!target.messageId,kind);
    await sender.flush();
    assert.equal(posts,1,kind);
    f.data.tasks[0].runtime.participants=['A'];
    assert.throws(()=>sender.retry({user:{number:'A'},canManage:true},target.id),
      /发送结果不明.*禁止重发/,kind);
  }
});
