import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateNextDayEvidence} from './readiness-core.mjs';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const NOW=Date.parse('2026-09-27T07:45:00.000Z'); // Shanghai 15:45
const ISO=new Date(NOW-30000).toISOString();
const STARTED='2026-09-27T07:00:00.000Z';
const CURRENT_STARTED=new Date(NOW-20000).toISOString();
const OA_ISO=new Date(NOW-10000).toISOString();
const ROOM_CODES=['guanqi','brand_selection','youxuan','wangou'];
const workbook='EuYqssm4WhNwAvtyybKcDdk1ned';
const groupId='oc_3f92ef62d6160399ee823e74def199e6';
const appId='cli_aa9c744d6ffa1cc4';
const cid=(ch)=>ch.repeat(64),image=(ch)=>'sha256:'+ch.repeat(64);
const clone=x=>structuredClone(x);
// Explicit synthetic fixtures only; these hashes are not live OA/backup
// artifacts, a deployment approval, or a trusted production adapter.
const oaFixture=(policy,at,{actor,noticeId,messageId,taskId})=>{
  policy.oaAcceptance={actorNumber:actor,cases:['module','old-action','old-record','personal'].map(kind=>({
    kind,expectedModule:kind==='personal'?'workflow-engine':'live-room-management',
    view:kind==='old-action'?'action':kind==='old-record'?'record':kind,
    noticeId:kind.startsWith('old-')?noticeId:null,messageId:kind.startsWith('old-')?messageId:null,
    taskId:kind.startsWith('old-')?taskId:null,recipient:kind.startsWith('old-')?actor:null,
    linkSha256:sha(['synthetic-link',kind]),expectedProofSha256:sha(['synthetic-oa-proof',kind])}))};
  return {authenticated:true,actorNumber:actor,hubId:policy.containers.hub.id,
    hubImage:policy.containers.hub.image,release:policy.containers.hub.release,
    liveNextDayInstance:policy.containers.hub.liveNextDayInstance,
    capturedAt:at,checkedAt:at,cases:policy.oaAcceptance.cases.map(c=>({
      kind:c.kind,authenticated:true,actorNumber:actor,hubId:policy.containers.hub.id,
      hubImage:policy.containers.hub.image,noticeId:c.noticeId,messageId:c.messageId,
      release:policy.containers.hub.release,liveNextDayInstance:policy.containers.hub.liveNextDayInstance,
      taskId:c.taskId,recipient:c.recipient,view:c.view,linkSha256:c.linkSha256,
      proofSha256:c.expectedProofSha256,observedModule:c.expectedModule,observedTaskId:c.taskId,
      observedView:c.view,httpStatus:200,loginRedirect:false,rendered:true,
      businessActionInvoked:false,readOnly:c.kind==='old-record',
      observedScope:c.kind==='personal'?'self':null,observedActorNumber:actor,capturedAt:at,checkedAt:at}))};
};
const backupFixture=(policy,at)=>Object.fromEntries(['hub','calendar','dispatch'].map(key=>{
  const manifest=sha(['synthetic-full-manifest',key]);return [key,{fullBackup:true,
    stoppedWriter:true,verified:true,restoreProbePassed:true,sourceContainerId:policy.backupSources[key].id,
    sourceImage:policy.backupSources[key].image,sourceStartedAt:policy.backupSources[key].startedAt,
    sourceDataMount:policy.backupSources[key].dataMount,archiveSha256:sha(['synthetic-archive',key]),
    sourceManifestSha256:manifest,restoredManifestSha256:manifest,
    restoreProbeHash:sha(['synthetic-restore',key]),capturedAt:at,checkedAt:at}];
}));

function fixture(){
  const policy={expectedDate:'2026-09-28',workbook,groupId,botAppId:appId,
    approvedGroupTestMessageId:'om_group_test',
    containers:{gateway:{id:cid('a'),image:image('1')},hub:{id:cid('b'),image:image('2'),startedAt:CURRENT_STARTED,
      release:'hub-synthetic-release',liveNextDayInstance:'boot-synthetic-instance'},
      calendar:{id:cid('c'),image:image('3'),startedAt:CURRENT_STARTED},dispatch:{id:cid('d'),image:image('4'),startedAt:CURRENT_STARTED}},
    gatewayConfigHash:cid('e'),gatewayListener:{containerPort:8080,serverName:'_',loopbackPort:19144},
    historicalUnknownHash:sha([]),
    dataMounts:{hub:'/data/hub',calendar:'/data/calendar',dispatch:'/data/dispatch'},
    approvedNumbers:ROOM_CODES.flatMap((_,i)=>[`N${i}a`,`N${i}b`])};
  policy.backupSources=Object.fromEntries(['hub','calendar','dispatch'].map(key=>[key,{
    id:policy.containers[key].id,image:policy.containers[key].image,startedAt:STARTED,dataMount:policy.dataMounts[key]}]));
  const service=(key)=>({id:policy.containers[key].id,image:policy.containers[key].image,
    startedAt:policy.containers[key].startedAt,
    ...(key==='hub'?{release:policy.containers.hub.release,liveNextDayInstance:policy.containers.hub.liveNextDayInstance}:{}),
    checkedAt:ISO,status:'running',health:'healthy',runningRwWriters:[policy.containers[key].id],
    dormantAutoRestartRw:[],dormantRwContainers:[],dataMount:{source:policy.dataMounts[key],rw:true}});
  const slots=ROOM_CODES.map((code,i)=>({date:'2026-09-28',roomCode:code,key:`live:${code}:1`,
    signature:`signature-${code}`,startAt:`2026-09-28T0${i}:00:00.000Z`,
    endAt:`2026-09-28T0${i+1}:00:00.000Z`,anchor:`N${i}a`,
    assistants:[`N${i}b`],assistantShifts:[{number:`N${i}b`,startAt:`2026-09-28T0${i}:00:00.000Z`}] }));
  const tasks=slots.map((slot,i)=>({id:`task-${i}`,workflow:'04',state:'running',
    liveSession:clone(slot),nodes:[
      {id:'W04.S4.E1',owner:slot.anchor,state:'pending',attempt:1},
      {id:'W04.S4.A1',owner:slot.assistants[0],state:'pending',attempt:1}]}));
  const notices=tasks.flatMap((task,i)=>task.nodes.map((node,j)=>({id:`notice-${i}-${j}`,key:`card-${i}-${j}`,
    kind:'live_assignment',taskId:task.id,nodeId:node.id,attempt:1,recipient:node.owner,
    state:'sent',unknown:false,messageId:`om_${i}_${j}`})));
  const bindings=policy.approvedNumbers.map((number,i)=>({number,name:`演练${i}`,openId:`ou_${i}person`}));
  const identityReadbacks=bindings.map(b=>({number:b.number,name:b.name,openId:b.openId,
    active:true,employed:true,departmentVerified:true,checkedAt:ISO}));
  const byNumber=new Map(bindings.map(b=>[b.number,b]));
  const cardReadbacks=notices.map(n=>({messageId:n.messageId,chatId:`oc_${n.id}`,
    independentMessageId:n.messageId,senderAppId:appId,msgType:'interactive',
    deleted:false,immutableCardMatched:true,checkedAt:ISO,
    personalChat:{chatId:`oc_${n.id}`,mode:'p2p',status:'normal',checkedAs:'bot',checkedAt:ISO},
    recipientProof:{kind:'p2p_member',checkedAs:'bot',chatId:`oc_${n.id}`,
      openId:byNumber.get(n.recipient).openId,checkedAt:ISO,
      complete:true,memberIds:[byNumber.get(n.recipient).openId]}}));
  const evidence={collectorIssues:[],environment:{gateway:{id:policy.containers.gateway.id,
    image:policy.containers.gateway.image,status:'running',health:'healthy',checkedAt:ISO,
    configHash:policy.gatewayConfigHash,listener:clone(policy.gatewayListener),routes:{hub:policy.containers.hub.id,
      calendar:policy.containers.calendar.id,dispatch:policy.containers.dispatch.id}},
    services:{hub:service('hub'),calendar:service('calendar'),dispatch:service('dispatch')},
    backup:backupFixture(policy,ISO),
    oaReadback:oaFixture(policy,OA_ISO,{actor:'N0a',noticeId:'notice-0-0',messageId:'om_0_0',taskId:'task-0'})},
    source:{date:'2026-09-28',updatedAt:ISO,source:{mode:'official_live',verified:true,spreadsheetToken:workbook},
      issues:[],rooms:ROOM_CODES.map(code=>({code,anchors:[['08:00','09:00','演练']],assistants:[]})),
      sourceStatus:Object.fromEntries(ROOM_CODES.map((code,i)=>[code,{found:true,
        revision:189107,sheetId:`sheet-${i}`}])) ,slots},
    bindings,identityReadbacks,state:{tasks,notifications:notices},cardReadbacks,
    groupReadback:{id:groupId,name:'WIS直播战队',mode:'group',private:true,
      normal:true,botCanSend:true,external:false,checkedAt:ISO},
    groupTest:{messageId:'om_group_test',chatId:groupId,senderAppId:appId,
      deleted:false,exactTestMarker:true,approvalVerifiedExternally:true,checkedAt:ISO}};
  return {policy,evidence};
}

const run=(f,mode='activation',now=NOW)=>evaluateNextDayEvidence(f.evidence,{mode,now,policy:f.policy});
const rejects=(change,issue,mode='activation')=>{
  const f=fixture();change(f);assert.ok(run(f,mode).issues.includes(issue),issue);
};

test('complete synthetic evidence only passes diagnostics and can never authorize a release',()=>{
  const r=run(fixture());assert.equal(r.checksPassed,true);assert.equal(r.safeToEnable,false);
  assert.equal(r.diagnosticOnly,true);assert.equal(r.expectedShifts,4);assert.equal(r.expectedCards,8);
});

test('gateway listener is independently pinned, never inferred from actual evidence',()=>{
  for(const value of [undefined,null,{},'8080',
    {containerPort:8080,serverName:'_',loopbackPort:'19144'},
    {containerPort:0,serverName:'_',loopbackPort:19144},
    {containerPort:65536,serverName:'_',loopbackPort:19144},
    {containerPort:8080.5,serverName:'_',loopbackPort:19144},
    {containerPort:8080,serverName:'*.fandow.com',loopbackPort:19144},
    {containerPort:8080,serverName:'~.*',loopbackPort:19144},
    {containerPort:8080,serverName:'hub.fandow.com _',loopbackPort:19144},
    {containerPort:8080,serverName:'localhost',loopbackPort:19144},
    {containerPort:8080,serverName:'127.0.0.1',loopbackPort:19144},
    {containerPort:8080,serverName:'Hub.fandow.com',loopbackPort:19144},
    {containerPort:8080,serverName:'hub.fandow.com.',loopbackPort:19144},
    {containerPort:8080,serverName:'_',loopbackPort:19144,approved:true}]){
    const f=fixture();f.policy.gatewayListener=value;
    const result=run(f);assert.ok(result.issues.includes('gateway_listener_policy_not_pinned'));
    assert.ok(result.issues.includes('gateway_listener_drift'));assert.equal(result.safeToEnable,false);
  }
});

test('gateway listener readback must match exact independent container port, name and loopback port',()=>{
  for(const field of ['containerPort','serverName','loopbackPort'])
    rejects(f=>{f.evidence.environment.gateway.listener[field]=field==='serverName'?'hub.fandow.com':80;},
      'gateway_listener_drift');
  for(const value of [undefined,null,{containerPort:8080,serverName:'_',loopbackPort:19144,unexpected:true}])
    rejects(f=>{f.evidence.environment.gateway.listener=value;},'gateway_listener_drift');
});

test('matching policy and evidence cannot disguise URL-normalized numeric hosts as DNS',()=>{
  for(const serverName of ['127.1','127.0.1','0177.1','0x7f.1','2130706433','0x7f000001','123.456','foo.1']){
    const f=fixture();f.policy.gatewayListener.serverName=serverName;
    f.evidence.environment.gateway.listener=clone(f.policy.gatewayListener);
    const result=run(f);assert.equal(result.checksPassed,false,serverName);
    assert.ok(result.issues.includes('gateway_listener_policy_not_pinned'),serverName);
    assert.ok(result.issues.includes('gateway_listener_drift'),serverName);
    assert.equal(result.safeToEnable,false);
  }
});

test('an explicit legacy 80/DNS contract is evaluated exactly and never silently defaulted',()=>{
  const f=fixture();f.policy.gatewayListener={containerPort:80,serverName:'hub.fandow.com',loopbackPort:19144};
  assert.ok(run(f).issues.includes('gateway_listener_drift'));
  f.evidence.environment.gateway.listener=clone(f.policy.gatewayListener);
  assert.equal(run(f).checksPassed,true);assert.equal(run(f).safeToEnable,false);
});
test('date rolls forward dynamically and expired first activation cannot be backfilled',()=>{
  const f=fixture();assert.ok(run(f,'activation',Date.parse('2026-09-27T07:55:00.000Z'))
    .issues.includes('outside_first_activation_window'));
  assert.ok(run(f,'activation',Date.parse('2026-09-28T07:45:00.000Z'))
    .issues.includes('policy_date_not_pinned'));
});
test('gateway, image and writer drift fail closed',()=>{
  rejects(f=>{f.evidence.environment.gateway.routes.hub=cid('f');},'gateway_route_or_config_drift');
  rejects(f=>{f.evidence.environment.services.hub.image=image('f');},'hub_cas_or_health_invalid');
  rejects(f=>{f.evidence.environment.services.hub.dormantAutoRestartRw.push(cid('f'));},
    'hub_writer_or_mount_unsafe');
  rejects(f=>{f.evidence.environment.backup.hub.verified=false;},
    'current_hub_stopped_writer_backup_unverified');
});
test('all three exact data mounts must be independently pinned and all dormant RW writers isolated',()=>{
  for(const key of ['hub','calendar','dispatch']){
    for(const mount of [undefined,'','/','/data//hub','/data/hub/','/data/../escape','relative','/data/with space','/data/\u0000bad'])
      rejects(f=>{f.policy.dataMounts[key]=mount;f.evidence.environment.services[key].dataMount.source=mount;},
        'data_mount_baseline_not_pinned');
    rejects(f=>{delete f.evidence.environment.services[key].dormantRwContainers;},`${key}_writer_or_mount_unsafe`);
    rejects(f=>{f.evidence.environment.services[key].dormantRwContainers.push({id:cid('f'),restart:'no'});},
      `${key}_writer_or_mount_unsafe`);
  }
});
test('fresh stopped-source backup followed by same-container restart or pinned replacement is valid',()=>{
  const sameContainer=fixture();assert.equal(run(sameContainer).checksPassed,true);
  for(const key of ['hub','calendar','dispatch']){
    const f=fixture(),old=f.policy.backupSources[key],current=f.policy.containers[key];
    assert.equal(old.id,current.id);assert.ok(Date.parse(old.startedAt)<Date.parse(f.evidence.environment.backup[key].capturedAt));
    assert.ok(Date.parse(f.evidence.environment.backup[key].capturedAt)<Date.parse(current.startedAt));
    // Replacement is independently pinned to the old stopped source, while
    // current gateway/health/writer CAS remains the new container identity.
    old.id=cid('f');old.image=image('f');
    f.evidence.environment.backup[key].sourceContainerId=old.id;
    f.evidence.environment.backup[key].sourceImage=old.image;
    assert.equal(run(f).checksPassed,true);
    rejects(x=>{delete x.policy.backupSources[key];},'backup_source_baseline_not_pinned');
    rejects(x=>{x.evidence.environment.backup[key].sourceStartedAt=CURRENT_STARTED;},`current_${key}_stopped_writer_backup_unverified`);
    rejects(x=>{x.evidence.environment.backup[key].sourceImage=image('f');},`current_${key}_stopped_writer_backup_unverified`);
    rejects(x=>{x.evidence.environment.backup[key].capturedAt=OA_ISO;},`current_${key}_stopped_writer_backup_unverified`);
    rejects(x=>{x.policy.backupSources[key].image=image('f');},'backup_source_baseline_not_pinned');
  }
});
test('same container ID and image cannot disguise a restarted service or Hub process',()=>{
  for(const key of ['hub','calendar','dispatch']){
    rejects(f=>{delete f.policy.containers[key].startedAt;},'runtime_instance_baseline_not_pinned');
    rejects(f=>{delete f.evidence.environment.services[key].startedAt;},`${key}_started_at_drift`);
    rejects(f=>{f.evidence.environment.services[key].startedAt=ISO;},`${key}_started_at_drift`);
    rejects(f=>{f.evidence.environment.backup[key].sourceStartedAt=ISO;},`current_${key}_stopped_writer_backup_unverified`);
  }
  for(const field of ['release','liveNextDayInstance']){
    rejects(f=>{f.policy.containers.hub[field]='local';},'runtime_instance_baseline_not_pinned');
    rejects(f=>{f.evidence.environment.services.hub[field]='different-process';},'hub_process_instance_drift');
    rejects(f=>{f.evidence.environment.oaReadback[field]='different-process';},'real_oa_page_unverified');
    rejects(f=>{f.evidence.environment.oaReadback.cases[1][field]='different-process';},'oa_old_action_acceptance_unverified');
  }
});
test('each service needs its current stopped full backup and matching restored manifest, never Hub-only proof',()=>{
  for(const key of ['hub','calendar','dispatch']){
    for(const change of [
      row=>{row.fullBackup=false;},row=>{row.stoppedWriter=false;},row=>{row.verified=false;},
      row=>{row.restoreProbePassed=false;},row=>{row.sourceContainerId=cid('f');},
      row=>{row.sourceDataMount='/wrong';},row=>{row.archiveSha256='bad';},
      row=>{row.sourceManifestSha256=undefined;},row=>{row.restoredManifestSha256=cid('f');},
      row=>{row.restoreProbeHash='bad';},row=>{row.capturedAt=new Date(NOW-120001).toISOString();},
      row=>{row.checkedAt=new Date(NOW-120001).toISOString();},
      row=>{row.capturedAt=new Date(NOW+1).toISOString();},
      row=>{row.checkedAt=new Date(NOW-60000).toISOString();},
    ])rejects(f=>change(f.evidence.environment.backup[key]),`current_${key}_stopped_writer_backup_unverified`);
    rejects(f=>{delete f.evidence.environment.backup[key];},`current_${key}_stopped_writer_backup_unverified`);
  }
});
test('a legacy OA login boolean or oldLinksAccepted flag cannot replace independently pinned rendered cases',()=>{
  rejects(f=>{delete f.policy.oaAcceptance;},'oa_acceptance_policy_not_pinned');
  rejects(f=>{f.evidence.environment.oaReadback={authenticated:true,hubId:f.policy.containers.hub.id,
    checkedAt:ISO,oldLinksAccepted:true};},'real_oa_page_unverified');
  rejects(f=>{f.evidence.environment.oaReadback.cases.pop();},'oa_acceptance_cases_incomplete');
  rejects(f=>{f.policy.oaAcceptance.cases[1].expectedProofSha256='';},'oa_acceptance_policy_not_pinned');
});
test('old action/record and personal pages bind exact approved proof, actor, notice, link and observed route',()=>{
  for(const kind of ['module','old-action','old-record','personal']){
    const issue=`oa_${kind.replaceAll('-','_')}_acceptance_unverified`;
    for(const change of [row=>{row.actorNumber='other';},row=>{row.hubId=cid('f');},
      row=>{row.hubImage=image('f');},row=>{row.authenticated=false;},
      row=>{row.proofSha256=cid('f');},row=>{row.linkSha256=cid('f');},
      row=>{row.observedModule='unrelated';},row=>{row.observedTaskId='other';},
      row=>{row.observedView='other';},row=>{row.httpStatus=401;},row=>{row.loginRedirect=true;},
      row=>{row.rendered=false;},row=>{row.businessActionInvoked=true;},
      row=>{row.capturedAt=new Date(NOW-120001).toISOString();},
      row=>{row.checkedAt=new Date(NOW-120001).toISOString();}])
      rejects(f=>change(f.evidence.environment.oaReadback.cases.find(x=>x.kind===kind)),issue);
    if(kind.startsWith('old-')){
      for(const change of [row=>{row.noticeId='other';},row=>{row.messageId='om_other';},
        row=>{row.taskId='other';},row=>{row.recipient='other';},row=>{row.readOnly=kind!=='old-record';}])
        rejects(f=>change(f.evidence.environment.oaReadback.cases.find(x=>x.kind===kind)),issue);
      rejects(f=>{f.evidence.state.notifications[0].recipient='other';},issue);
    }
  }
  rejects(f=>{f.evidence.environment.oaReadback.cases[3].observedScope='all';},'oa_personal_acceptance_unverified');
  rejects(f=>{f.evidence.environment.oaReadback.cases[3].observedActorNumber='other';},'oa_personal_acceptance_unverified');
});
test('source version, missing room and stale read all fail closed',()=>{
  rejects(f=>{f.evidence.source.sourceStatus.wangou.revision++;},'official_revision_or_sheet_drift');
  rejects(f=>{f.evidence.source.rooms.pop();},'official_four_rooms_incomplete');
  rejects(f=>{f.evidence.source.updatedAt=new Date(NOW-121000).toISOString();},
    'official_source_missing_stale_or_ambiguous');
  rejects(f=>{f.evidence.source.slots.pop();},'derived_shift_set_incomplete');
});
test('missing or altered task/card and off-roster recipient fail closed',()=>{
  rejects(f=>{f.evidence.state.tasks.pop();},'formal_task_count_mismatch');
  rejects(f=>{f.evidence.state.tasks[0].liveSession.signature='different';},'formal_task_shift_drift');
  rejects(f=>{f.evidence.state.notifications[0].messageId=null;},'assignment_card_count_or_ledger_invalid');
  rejects(f=>{f.policy.approvedNumbers.shift();},'target_personnel_not_approved_or_bound');
});
test('platform sent and mget without exact person proof are insufficient',()=>{
  rejects(f=>{f.evidence.cardReadbacks[0].independentMessageId='om_wrong';},
    'bot_card_or_exact_person_readback_missing');
  rejects(f=>{delete f.evidence.cardReadbacks[0].independentMessageId;},
    'bot_card_or_exact_person_readback_missing');
  rejects(f=>{f.evidence.cardReadbacks[0].recipientProof=null;},
    'bot_card_or_exact_person_readback_missing');
  rejects(f=>{f.evidence.cardReadbacks[0].recipientProof.checkedAs='user';},
    'bot_card_or_exact_person_readback_missing');
  rejects(f=>{f.evidence.cardReadbacks[0].recipientProof.memberIds=['ou_wrong'];},
    'bot_card_or_exact_person_readback_missing');
  rejects(f=>{f.evidence.cardReadbacks[0].immutableCardMatched=false;},
    'bot_card_or_exact_person_readback_missing');
});
test('a group read receipt cannot masquerade as an exact P2P personal card',()=>{
  rejects(f=>{
    const card=f.evidence.cardReadbacks[0],openId=card.recipientProof.openId;
    card.personalChat.mode='group';
    card.recipientProof={kind:'read_user',checkedAs:'bot',chatId:card.chatId,
      openId,messageId:card.messageId,complete:true,readUserIds:[openId],checkedAt:ISO};
  },'bot_card_or_exact_person_readback_missing');
  rejects(f=>{f.evidence.cardReadbacks[0].personalChat.checkedAs='user';},
    'bot_card_or_exact_person_readback_missing');
  rejects(f=>{f.evidence.cardReadbacks[0].recipientProof.complete=false;},
    'bot_card_or_exact_person_readback_missing');
});
test('a bot P2P read receipt proves only this exact card when target actually read it',()=>{
  const f=fixture(),card=f.evidence.cardReadbacks[0],openId=card.recipientProof.openId;
  card.recipientProof={kind:'read_user',checkedAs:'bot',chatId:card.chatId,
    openId,messageId:card.messageId,complete:true,readUserIds:[openId],checkedAt:ISO};
  assert.equal(run(f).checksPassed,true);
  card.recipientProof.messageId='om_other';
  assert.ok(run(f).issues.includes('bot_card_or_exact_person_readback_missing'));
  card.recipientProof.messageId=card.messageId;
  card.recipientProof.readUserIds=[];
  assert.ok(run(f).issues.includes('bot_card_or_exact_person_readback_missing'));
});
test('unknown, in-flight and already-issued next-day ledger cannot trigger another send',()=>{
  rejects(f=>{f.evidence.state.notifications.push({id:'n-new',key:'n-new',state:'sending'});},
    'notification_in_flight');
  rejects(f=>{f.evidence.state.notifications[0].unknown=true;},
    'unknown_ledger_changed_or_new');
  rejects(f=>{f.evidence.state.notifications.push({id:'n-tomorrow',key:'n-tomorrow',
    state:'sent',kind:'live_tomorrow',businessDate:'2026-09-28'});},
    'next_day_notice_already_exists');
});
test('group details, explicit test evidence and OA verification are mandatory',()=>{
  rejects(f=>{f.evidence.groupReadback.botCanSend=false;},
    'group_identity_or_send_right_unverified');
  rejects(f=>{f.evidence.groupTest.messageId='om_other';},
    'approved_group_test_readback_missing');
  rejects(f=>{f.policy.approvedGroupTestMessageId='om_other';},
    'approved_group_test_readback_missing');
  rejects(f=>{f.evidence.groupTest.approvalVerifiedExternally=false;},
    'approved_group_test_readback_missing');
  rejects(f=>{f.evidence.environment.oaReadback.authenticated=false;},
    'real_oa_page_unverified');
});
