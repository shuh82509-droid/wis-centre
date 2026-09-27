// Pure, read-only 4.9.2 preflight. Callers must supply independently read
// evidence from the *current* gateway, Docker daemon, official workbook and
// Feishu bot. This module cannot sign a permit, send IM or mutate a store.
import {createHash} from 'node:crypto';

const ROOMS=['guanqi','brand_selection','youxuan','wangou'];
const NEXT_DAY_KINDS=new Set(['live_tomorrow','live_tomorrow_group_pending','live_tomorrow_group_confirmed']);
const FRESH_MS=120000;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateAt=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const minuteAt=ms=>new Date(ms+8*3600000).toISOString().slice(11,16);
const ageValid=(at,now)=>{const age=now-Date.parse(at);return Number.isFinite(age)&&age>=0&&age<=FRESH_MS;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const unique=(rows,key)=>new Set(rows.map(key)).size===rows.length;
const validMessage=id=>/^om_[A-Za-z0-9_-]+$/u.test(id||'');
const validOpenId=id=>/^ou_[a-z0-9]+$/u.test(id||'');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

export function evaluateNextDayEvidence(evidence,{now=Date.now(),mode='preview',policy}={}){
  if(!['preview','activation'].includes(mode))throw new Error('Unsupported preflight mode');
  // Policy is a separate pinned, operator-reviewed input. Never take an
  // expected container ID, historical ledger hash or authorization from the
  // evidence being evaluated.
  const issueSet=new Set(),need=(ok,code)=>{if(!ok)issueSet.add(code);return Boolean(ok);};
  const date=dateAt(now+86400000),today=dateAt(now),clock=minuteAt(now);
  need(Array.isArray(evidence?.collectorIssues)&&evidence.collectorIssues.length===0,
    'independent_collection_incomplete');
  need(object(policy)&&policy.expectedDate===date,'policy_date_not_pinned');
  need(policy?.workbook==='EuYqssm4WhNwAvtyybKcDdk1ned'&&
    policy?.groupId==='oc_3f92ef62d6160399ee823e74def199e6'&&
    /^cli_[A-Za-z0-9]{8,64}$/u.test(policy?.botAppId||''),'policy_scope_not_pinned');
  need(object(policy?.containers)&&['gateway','hub','calendar','dispatch'].every(k=>
    /^[a-f0-9]{64}$/u.test(policy.containers[k]?.id||'')&&
    /^sha256:[a-f0-9]{64}$/u.test(policy.containers[k]?.image||'')),'container_baseline_not_pinned');
  need(/^[a-f0-9]{64}$/u.test(policy?.historicalUnknownHash||''),'unknown_baseline_not_pinned');
  need(Array.isArray(policy?.approvedNumbers)&&unique(policy.approvedNumbers,x=>x)&&
    policy.approvedNumbers.length>0,'personnel_scope_not_pinned');
  if(mode==='activation')need(clock>='15:40'&&clock<'15:55'&&today===dateAt(now),
    'outside_first_activation_window');
  else need(clock<'15:55','first_activation_cutoff_passed');

  const env=evidence?.environment||{},services=env.services||{},gateway=env.gateway||{};
  for(const key of ['gateway','hub','calendar','dispatch']){
    const actual=key==='gateway'?gateway:services[key],expected=policy?.containers?.[key];
    need(actual?.id===expected?.id&&actual?.image===expected?.image&&
      actual?.status==='running'&&actual?.health==='healthy'&&ageValid(actual?.checkedAt,now),
    `${key}_cas_or_health_invalid`);
  }
  need(gateway?.routes?.hub===services.hub?.id&&
    gateway?.routes?.calendar===services.calendar?.id&&
    gateway?.routes?.dispatch===services.dispatch?.id&&
    gateway?.configHash===policy?.gatewayConfigHash&&
    /^[a-f0-9]{64}$/u.test(policy?.gatewayConfigHash||''),'gateway_route_or_config_drift');
  for(const key of ['hub','calendar','dispatch']){
    const x=services[key];
    need(Array.isArray(x?.runningRwWriters)&&same(x.runningRwWriters,[x.id])&&
      Array.isArray(x?.dormantAutoRestartRw)&&x.dormantAutoRestartRw.length===0&&
      x?.dataMount?.rw===true&&x.dataMount.source===policy?.dataMounts?.[key],
    `${key}_writer_or_mount_unsafe`);
  }
  need(env.backup?.hub?.stoppedWriter===true&&env.backup.hub.verified===true&&
    env.backup.hub.restoreProbePassed===true&&
    env.backup.hub.sourceContainerId===services.hub?.id&&
    env.backup.hub.sourceDataMount===services.hub?.dataMount?.source&&
    ageValid(env.backup.hub.checkedAt,now),'current_stopped_writer_backup_unverified');
  need(env.oaReadback?.authenticated===true&&env.oaReadback?.hubId===services.hub?.id&&
    ageValid(env.oaReadback.checkedAt,now),'real_oa_page_unverified');

  const source=evidence?.source||{},status=source.sourceStatus||{};
  need(source.date===date&&source.source?.mode==='official_live'&&
    source.source?.verified===true&&source.source.spreadsheetToken===policy?.workbook&&
    !source.recovery&&ageValid(source.updatedAt,now)&&Array.isArray(source.issues)&&
    source.issues.length===0,'official_source_missing_stale_or_ambiguous');
  const rooms=Array.isArray(source.rooms)?source.rooms:[];
  need(rooms.length===4&&unique(rooms,r=>r.code)&&
    ROOMS.every(code=>rooms.some(r=>r.code===code)),'official_four_rooms_incomplete');
  const revisions=ROOMS.map(code=>Number(status[code]?.revision));
  need(revisions.every(n=>Number.isSafeInteger(n)&&n>0)&&new Set(revisions).size===1&&
    ROOMS.every(code=>status[code]?.found===true&&status[code]?.sheetId),
  'official_revision_or_sheet_drift');
  // Slots must have been calculated by the pinned scheduleSessions module
  // from those four fresh rows. A caller's assertion alone is not release
  // authority; the live collector and exact-image hash are still required.
  const slots=Array.isArray(source.slots)?source.slots:[];
  need(slots.length>0&&unique(slots,s=>s.key)&&
    ROOMS.every(code=>slots.filter(s=>s.roomCode===code).length===
      rooms.find(r=>r.code===code)?.anchors?.length)&&
    slots.every(s=>s.date===date&&s.anchor&&
      Array.isArray(s.assistants)&&unique(s.assistants,x=>x)&&
      s.assistants.length>0&&s.signature&&s.startAt&&s.endAt),
  'derived_shift_set_incomplete');

  const bindings=Array.isArray(evidence?.bindings)?evidence.bindings:[];
  const boundByNumber=new Map(bindings.map(b=>[b.number,b]));
  const targetNumbers=new Set(slots.flatMap(s=>[s.anchor,...s.assistants]));
  need(unique(bindings,b=>b.number)&&unique(bindings,b=>b.openId)&&
    targetNumbers.size>0&&[...targetNumbers].every(number=>
      policy?.approvedNumbers?.includes(number)&&validOpenId(boundByNumber.get(number)?.openId)),
  'target_personnel_not_approved_or_bound');
  const identities=Array.isArray(evidence?.identityReadbacks)?evidence.identityReadbacks:[];
  const identityByNumber=new Map(identities.map(x=>[x.number,x]));
  need(unique(identities,x=>x.number)&&[...targetNumbers].every(number=>{
    const b=boundByNumber.get(number),x=identityByNumber.get(number);
    return x?.openId===b?.openId&&x?.active===true&&x?.employed===true&&
      x?.departmentVerified===true&&x?.name===b?.name&&ageValid(x.checkedAt,now);
  }),'target_identity_readback_missing_or_inactive');

  const state=evidence?.state||{},tasks=Array.isArray(state.tasks)?state.tasks:[],
    notices=Array.isArray(state.notifications)?state.notifications:[];
  need(unique(tasks,t=>t.id)&&unique(notices,n=>n.id)&&unique(notices,n=>n.key),
    'task_or_notice_duplicate_identity');
  const targetTasks=tasks.filter(t=>t.workflow==='04'&&t.liveSession?.date===date&&!t.liveSession.replacedBy);
  need(targetTasks.length===slots.length,'formal_task_count_mismatch');
  const cards=notices.filter(n=>n.kind==='live_assignment'&&targetTasks.some(t=>t.id===n.taskId));
  const expectedCards=slots.reduce((n,s)=>n+1+s.assistants.length,0);
  need(cards.length===expectedCards&&unique(cards,n=>n.messageId)&&
    cards.every(n=>n.state==='sent'&&!n.unknown&&validMessage(n.messageId)),
  'assignment_card_count_or_ledger_invalid');
  const refs=[];
  for(const slot of slots){
    const matches=targetTasks.filter(t=>t.liveSession?.key===slot.key);
    if(!need(matches.length===1,'shift_task_not_unique'))continue;
    const task=matches[0];
    if(!need(task.state==='running'&&!task.liveSession.sourceIssue&&
      task.liveSession.signature===slot.signature&&task.liveSession.startAt===slot.startAt&&
      task.liveSession.endAt===slot.endAt&&task.liveSession.anchor===slot.anchor&&
      same(task.liveSession.assistants,slot.assistants)&&
      same(task.liveSession.assistantShifts,slot.assistantShifts),
    'formal_task_shift_drift'))continue;
    for(const number of [slot.anchor,...slot.assistants]){
      const node=(task.nodes||[]).filter(n=>/^W04\.S4\.(E1|A[1-9]\d*)$/u.test(n.id)&&n.owner===number);
      const card=node.length===1?cards.filter(n=>n.taskId===task.id&&n.nodeId===node[0].id&&
        n.attempt===node[0].attempt&&n.recipient===number):[];
      if(need(node.length===1&&['pending','ready'].includes(node[0].state)&&card.length===1,
        'execution_node_or_personal_card_not_unique'))
        refs.push({slot,task,node:node[0],card:card[0],number});
    }
  }
  need(refs.length===expectedCards,'personal_card_coverage_incomplete');
  const readbacks=Array.isArray(evidence?.cardReadbacks)?evidence.cardReadbacks:[],
    readById=new Map(readbacks.map(x=>[x.messageId,x]));
  need(readbacks.length===expectedCards&&unique(readbacks,x=>x.messageId)&&refs.every(({card,number})=>{
    const row=readById.get(card.messageId),openId=boundByNumber.get(number)?.openId;
    const chat=row?.personalChat,proof=row?.recipientProof;
    const peerProven=proof?.kind==='p2p_member'?
      proof.complete===true&&same(proof.memberIds,[openId]):
      proof?.kind==='read_user'&&proof.complete===true&&
        proof.messageId===card.messageId&&same(proof.readUserIds,[openId]);
    return row?.independentMessageId===card.messageId&&
      row?.chatId&&row?.senderAppId===policy?.botAppId&&row?.msgType==='interactive'&&
      row?.deleted===false&&row?.immutableCardMatched===true&&
      chat?.chatId===row.chatId&&chat.mode==='p2p'&&chat.status==='normal'&&
      chat.checkedAs==='bot'&&ageValid(chat.checkedAt,now)&&
      proof?.chatId===row.chatId&&proof.openId===openId&&proof.checkedAs==='bot'&&
      peerProven&&ageValid(row.checkedAt,now)&&ageValid(proof.checkedAt,now);
  }),'bot_card_or_exact_person_readback_missing');
  const unknown=notices.filter(n=>n.state==='unknown'||n.unknown===true).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  need(!notices.some(n=>n.state==='sending'||n.state==='verifying'),'notification_in_flight');
  need(sha(unknown)===policy?.historicalUnknownHash&&
    !unknown.some(n=>NEXT_DAY_KINDS.has(n.kind)),'unknown_ledger_changed_or_new');
  need(!notices.some(n=>NEXT_DAY_KINDS.has(n.kind)&&n.businessDate===date),
    'next_day_notice_already_exists');
  const group=evidence?.groupReadback||{},test=evidence?.groupTest||{};
  need(group.id===policy?.groupId&&group.name==='WIS直播战队'&&group.mode==='group'&&
    group.private===true&&group.normal===true&&group.botCanSend===true&&
    group.external===false&&ageValid(group.checkedAt,now),'group_identity_or_send_right_unverified');
  need(validMessage(policy?.approvedGroupTestMessageId)&&
    test.messageId===policy.approvedGroupTestMessageId&&
    test.chatId===policy?.groupId&&test.senderAppId===policy?.botAppId&&
    test.deleted===false&&test.exactTestMarker===true&&test.approvalVerifiedExternally===true&&
    ageValid(test.checkedAt,now),'approved_group_test_readback_missing');
  const issues=[...issueSet];
  return {date,checkedAt:new Date(now).toISOString(),mode,sourceRevision:revisions[0]||null,
    expectedShifts:slots.length,formalTasks:targetTasks.length,expectedCards,cardReadbacks:readbacks.length,
    historicalUnknown:unknown.length,groupTestProven:!issueSet.has('approved_group_test_readback_missing'),
    checksPassed:issues.length===0,safeToEnable:false,diagnosticOnly:true,issues};
}
