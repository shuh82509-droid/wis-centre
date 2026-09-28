// Pure, read-only 4.9.2 preflight. Callers must supply independently read
// evidence from the *current* gateway, Docker daemon, official workbook and
// Feishu bot. This module cannot sign a permit, send IM or mutate a store.
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

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
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const safeMount=value=>typeof value==='string'&&value.startsWith('/')&&value.length>1&&value.length<=1000&&
  !value.endsWith('/')&&!value.includes('//')&&!/[\u0000-\u0020\u007f\\]/u.test(value)&&
  !value.split('/').some(part=>part==='.'||part==='..');
const nonempty=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const startedAt=(value,now)=>typeof value==='string'&&/^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/u.test(value)&&
  Number.isFinite(Date.parse(value))&&Date.parse(value)<=now;
const runtimeIdentity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)&&value!=='local';
const canonicalDnsServer=value=>{
  try { const normalized=new URL('http://'+value).hostname;return normalized===value&&isIP(normalized)===0; }
  catch { return false; }
};
const validListener=value=>object(value)&&same(Object.keys(value).sort(),['containerPort','loopbackPort','serverName'])&&
  ['containerPort','loopbackPort'].every(key=>Number.isInteger(value[key])&&value[key]>0&&value[key]<=65535)&&
  typeof value.serverName==='string'&&(value.serverName==='_'||value.serverName.length<=253&&
    isIP(value.serverName)===0&&value.serverName.split('.').length>=2&&
    value.serverName.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))&&
    canonicalDnsServer(value.serverName));
const OA_CASES=['module','old-action','old-record','personal'];

export function evaluateNextDayEvidence(evidence,{now=Date.now(),mode='preview',policy}={}){
  if(!['preview','activation','renewal'].includes(mode))throw new Error('Unsupported preflight mode');
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
  need(object(policy?.dataMounts)&&['hub','calendar','dispatch'].every(k=>
    safeMount(policy.dataMounts[k])),'data_mount_baseline_not_pinned');
  need(validListener(policy?.gatewayListener),'gateway_listener_policy_not_pinned');
  need(['hub','calendar','dispatch'].every(k=>startedAt(policy?.containers?.[k]?.startedAt,now))&&
    runtimeIdentity(policy?.containers?.hub?.release)&&
    runtimeIdentity(policy?.containers?.hub?.liveNextDayInstance),'runtime_instance_baseline_not_pinned');
  // The stopped backup source is a different incarnation from the running
  // CAS target, even for docker start on the same container ID. Replacement
  // is allowed only when its prior source identity/image/mount are separately
  // pinned; no current-container or evidence fallback may invent that source.
  need(object(policy?.backupSources)&&['hub','calendar','dispatch'].every(key=>{
    const source=policy.backupSources[key],current=policy?.containers?.[key];
    return /^[a-f0-9]{64}$/u.test(source?.id||'')&&/^sha256:[a-f0-9]{64}$/u.test(source?.image||'')&&
      startedAt(source?.startedAt,now)&&Date.parse(source.startedAt)<Date.parse(current?.startedAt)&&
      safeMount(source?.dataMount)&&source.dataMount===policy?.dataMounts?.[key]&&
      (source.id!==current?.id||source.image===current.image);
  }),'backup_source_baseline_not_pinned');
  need(/^[a-f0-9]{64}$/u.test(policy?.historicalUnknownHash||''),'unknown_baseline_not_pinned');
  need(Array.isArray(policy?.approvedNumbers)&&unique(policy.approvedNumbers,x=>x)&&
    policy.approvedNumbers.length>0,'personnel_scope_not_pinned');
  if(mode==='activation')need(clock>='15:40'&&clock<'15:55'&&today===dateAt(now),
    'outside_first_activation_window');
  else if(mode==='renewal')need(clock>='15:40'&&clock<'17:00'&&today===dateAt(now),
    'outside_valid_renewal_window');
  else need(clock<'15:55','first_activation_cutoff_passed');

  const env=evidence?.environment||{},services=env.services||{},gateway=env.gateway||{};
  for(const key of ['gateway','hub','calendar','dispatch']){
    const actual=key==='gateway'?gateway:services[key],expected=policy?.containers?.[key];
    need(actual?.id===expected?.id&&actual?.image===expected?.image&&
      actual?.status==='running'&&actual?.health==='healthy'&&ageValid(actual?.checkedAt,now),
    `${key}_cas_or_health_invalid`);
    if(key!=='gateway')need(startedAt(actual?.startedAt,now)&&actual.startedAt===expected?.startedAt,
      `${key}_started_at_drift`);
  }
  need(runtimeIdentity(services.hub?.release)&&runtimeIdentity(services.hub?.liveNextDayInstance)&&
    services.hub.release===policy?.containers?.hub?.release&&
    services.hub.liveNextDayInstance===policy?.containers?.hub?.liveNextDayInstance,'hub_process_instance_drift');
  need(gateway?.routes?.hub===services.hub?.id&&
    gateway?.routes?.calendar===services.calendar?.id&&
    gateway?.routes?.dispatch===services.dispatch?.id&&
    gateway?.configHash===policy?.gatewayConfigHash&&
    /^[a-f0-9]{64}$/u.test(policy?.gatewayConfigHash||''),'gateway_route_or_config_drift');
  need(validListener(gateway.listener)&&validListener(policy?.gatewayListener)&&
    ['containerPort','serverName','loopbackPort'].every(key=>gateway.listener[key]===policy.gatewayListener[key]),
  'gateway_listener_drift');
  for(const key of ['hub','calendar','dispatch']){
    const x=services[key];
    need(Array.isArray(x?.runningRwWriters)&&same(x.runningRwWriters,[x.id])&&
      Array.isArray(x?.dormantAutoRestartRw)&&x.dormantAutoRestartRw.length===0&&
      Array.isArray(x?.dormantRwContainers)&&x.dormantRwContainers.length===0&&
      x?.dataMount?.rw===true&&safeMount(policy?.dataMounts?.[key])&&
      x.dataMount.source===policy.dataMounts[key],
    `${key}_writer_or_mount_unsafe`);
  }
  for(const key of ['hub','calendar','dispatch']){
    const row=env.backup?.[key],source=policy?.backupSources?.[key];
    need(object(row)&&row.fullBackup===true&&row.stoppedWriter===true&&row.verified===true&&
      row.restoreProbePassed===true&&row.sourceContainerId===source?.id&&row.sourceImage===source?.image&&
      row.sourceStartedAt===source?.startedAt&&startedAt(row.sourceStartedAt,now)&&
      safeMount(policy?.dataMounts?.[key])&&
      row.sourceDataMount===source?.dataMount&&row.sourceDataMount===policy.dataMounts[key]&&
      row.sourceDataMount===services[key]?.dataMount?.source&&
      validHash(row.archiveSha256)&&validHash(row.sourceManifestSha256)&&
      row.restoredManifestSha256===row.sourceManifestSha256&&validHash(row.restoreProbeHash)&&
      ageValid(row.capturedAt,now)&&ageValid(row.checkedAt,now)&&
      Date.parse(row.sourceStartedAt)<=Date.parse(row.capturedAt)&&
      Date.parse(row.capturedAt)<=Date.parse(services[key]?.startedAt)&&
      Date.parse(row.capturedAt)<=Date.parse(row.checkedAt),
    `current_${key}_stopped_writer_backup_unverified`);
  }
  // These cases are independently approved inputs, not booleans inferred
  // from a login cookie or invented by the collector. The proof artifact hash
  // must already be pinned outside the readback before a release can sign.
  const oaPolicy=policy?.oaAcceptance,oa=env.oaReadback||{},cases=oaPolicy?.cases;
  const oaPinned=need(object(oaPolicy)&&nonempty(oaPolicy.actorNumber)&&
    Array.isArray(cases)&&cases.length===OA_CASES.length&&unique(cases,x=>x?.kind)&&
    OA_CASES.every(kind=>cases.some(x=>x?.kind===kind))&&cases.every(x=>
      nonempty(x?.expectedModule)&&nonempty(x?.view)&&validHash(x?.linkSha256)&&
      validHash(x?.expectedProofSha256)&&
      (['old-action','old-record'].includes(x.kind)?
        nonempty(x.noticeId)&&validMessage(x.messageId)&&nonempty(x.taskId)&&
        x.recipient===oaPolicy.actorNumber&&x.view===(x.kind==='old-record'?'record':'action'):
        x.noticeId===null&&x.messageId===null&&x.taskId===null&&
        x.view===(x.kind==='personal'?'personal':'module'))),
  'oa_acceptance_policy_not_pinned');
  need(oaPinned&&oa.authenticated===true&&oa.actorNumber===oaPolicy.actorNumber&&
    oa.hubId===services.hub?.id&&oa.hubImage===services.hub?.image&&
    oa.release===services.hub?.release&&oa.liveNextDayInstance===services.hub?.liveNextDayInstance&&
    ageValid(oa.capturedAt,now)&&ageValid(oa.checkedAt,now)&&
    Date.parse(services.hub?.startedAt)<=Date.parse(oa.capturedAt)&&
    Date.parse(oa.capturedAt)<=Date.parse(oa.checkedAt),'real_oa_page_unverified');
  const oaRows=Array.isArray(oa.cases)?oa.cases:[];
  need(oaRows.length===OA_CASES.length&&unique(oaRows,x=>x?.kind),
    'oa_acceptance_cases_incomplete');
  for(const kind of OA_CASES){
    const expected=Array.isArray(cases)?cases.find(x=>x?.kind===kind):null;
    const row=oaRows.find(x=>x?.kind===kind),old=['old-action','old-record'].includes(kind);
    const notice=old?(evidence?.state?.notifications||[]).find(x=>x.id===expected?.noticeId):null;
    const task=old?(evidence?.state?.tasks||[]).find(x=>x.id===expected?.taskId):null;
    need(oaPinned&&row?.authenticated===true&&row.actorNumber===oaPolicy.actorNumber&&
      row.hubId===services.hub?.id&&row.hubImage===services.hub?.image&&
      row.release===services.hub?.release&&row.liveNextDayInstance===services.hub?.liveNextDayInstance&&
      row.linkSha256===expected?.linkSha256&&row.proofSha256===expected?.expectedProofSha256&&
      row.noticeId===expected?.noticeId&&row.messageId===expected?.messageId&&
      row.taskId===expected?.taskId&&row.view===expected?.view&&
      row.observedModule===expected?.expectedModule&&row.observedTaskId===expected?.taskId&&
      row.observedView===expected?.view&&row.httpStatus===200&&row.loginRedirect===false&&
      row.rendered===true&&row.businessActionInvoked===false&&
      ageValid(row.capturedAt,now)&&ageValid(row.checkedAt,now)&&
      Date.parse(services.hub?.startedAt)<=Date.parse(row.capturedAt)&&
      Date.parse(row.capturedAt)<=Date.parse(row.checkedAt)&&
      (old?notice?.state==='sent'&&notice.messageId===expected.messageId&&
        notice.taskId===expected.taskId&&notice.recipient===oaPolicy.actorNumber&&
        row.recipient===notice.recipient&&task?.workflow==='04'&&object(task.liveSession)&&
        row.readOnly===(kind==='old-record'):
        kind!=='personal'||row.observedScope==='self'&&row.observedActorNumber===oaPolicy.actorNumber),
    `oa_${kind.replaceAll('-','_')}_acceptance_unverified`);
  }

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
