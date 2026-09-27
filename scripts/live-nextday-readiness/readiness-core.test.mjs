import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateNextDayEvidence} from './readiness-core.mjs';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const NOW=Date.parse('2026-09-27T07:45:00.000Z'); // Shanghai 15:45
const ISO=new Date(NOW-30000).toISOString();
const ROOM_CODES=['guanqi','brand_selection','youxuan','wangou'];
const workbook='EuYqssm4WhNwAvtyybKcDdk1ned';
const groupId='oc_3f92ef62d6160399ee823e74def199e6';
const appId='cli_aa9c744d6ffa1cc4';
const cid=(ch)=>ch.repeat(64),image=(ch)=>'sha256:'+ch.repeat(64);
const clone=x=>structuredClone(x);

function fixture(){
  const policy={expectedDate:'2026-09-28',workbook,groupId,botAppId:appId,
    approvedGroupTestMessageId:'om_group_test',
    containers:{gateway:{id:cid('a'),image:image('1')},hub:{id:cid('b'),image:image('2')},
      calendar:{id:cid('c'),image:image('3')},dispatch:{id:cid('d'),image:image('4')}},
    gatewayConfigHash:cid('e'),historicalUnknownHash:sha([]),
    dataMounts:{hub:'/data/hub',calendar:'/data/calendar',dispatch:'/data/dispatch'},
    approvedNumbers:ROOM_CODES.flatMap((_,i)=>[`N${i}a`,`N${i}b`])};
  const service=(key)=>({id:policy.containers[key].id,image:policy.containers[key].image,
    checkedAt:ISO,status:'running',health:'healthy',runningRwWriters:[policy.containers[key].id],
    dormantAutoRestartRw:[],dataMount:{source:policy.dataMounts[key],rw:true}});
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
    configHash:policy.gatewayConfigHash,routes:{hub:policy.containers.hub.id,
      calendar:policy.containers.calendar.id,dispatch:policy.containers.dispatch.id}},
    services:{hub:service('hub'),calendar:service('calendar'),dispatch:service('dispatch')},
    backup:{hub:{stoppedWriter:true,verified:true,restoreProbePassed:true,checkedAt:ISO,
      sourceContainerId:policy.containers.hub.id,sourceDataMount:policy.dataMounts.hub}},
    oaReadback:{authenticated:true,hubId:policy.containers.hub.id,checkedAt:ISO}},
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
    'current_stopped_writer_backup_unverified');
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
