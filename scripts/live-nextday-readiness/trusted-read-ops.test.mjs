// Synthetic scope/transport tests. These are never live proof or approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {digestBytes, digestJson, readPinnedJson, loadTrustedInputs, freezeInput} from './trusted-policy.mjs';
import {botReadCommand, createBotReadClient, normalizeBotMessage, validateBotReadArguments,
  executeBotCommand} from './trusted-bot-reads.mjs';
import {createHubReadBridge} from './trusted-hub-reads.mjs';
import {runReadChild} from './trusted-child-process.mjs';
import {composeReadOps, immutableCardDigest, createTrustedReadOps, finalizeDiagnosticEvidence,
  TRUSTED_LIVE_BLOCKERS} from './trusted-read-ops.mjs';

const NOW = Date.parse('2026-09-28T01:30:00Z'), at = new Date(NOW).toISOString();
const DATE = '2026-09-29', APP = 'cli_aa9c744d6ffa1cc4';
const GROUP = 'oc_3f92ef62d6160399ee823e74def199e6';
const SHEETS = ['NYB2iu', 'MVpDv0', 'LRAvIU', 'PhlV42'];
const number = 'feishu:' + APP + ':ou_person';
const binding = () => ({number, name: '测试同事', openId: 'ou_person', center: '直播中心', appId: APP,
  departmentIds: ['od_live'], approvedBy: 'FD-026222', approvedAt: '2026-09-23T00:00:00Z'});
const policy = () => ({expectedDate: DATE, workbook: 'EuYqssm4WhNwAvtyybKcDdk1ned', groupId: GROUP,
  botAppId: APP, botOpenId: 'ou_bot', approvedNumbers: [number], participantFileSha256: 'a'.repeat(64),
  moduleHashes: {'live-feishu-card.mjs': 'b'.repeat(64)}, containers: {hub: {id: 'c'.repeat(64)}}});
const identity = () => ({open_id: 'ou_person', name: '测试同事', department_ids: ['od_live'],
  status: {is_activated: true, is_frozen: false, is_exited: false, is_resigned: false},
  mobile: 'must-not-retain', enterprise_email: 'must-not-retain'});
const card = () => ({header: {subtitle: {content: DATE}}, body: {elements: [{columns: [{elements: [
  {content: '**官旗** · 测试同事 · 主播'}, {content: '**计划时段：**08:00–10:00\n**本班工作：**话术准备'}]}]}]}});
const message = (id = 'om_current') => ({items: [{message_id: id, chat_id: 'oc_personal',
  sender: {sender_type: 'app', id_type: 'app_id', id: APP}, msg_type: 'interactive', deleted: false,
  body: {content: JSON.stringify(card())}}]});
const task = () => ({id: 'task1', workflow: '04', runtime: {state: 'running',
  liveSession: {date: DATE}, nodes: [{id: 'W04.S4.E1', owner: {number}, state: 'ready', attempt: 1}]}});
const notice = () => ({id: 'card1', key: 'card1', kind: 'live_assignment', taskId: 'task1',
  nodeId: 'W04.S4.E1', recipient: number, state: 'sent', messageId: 'om_current', attempt: 1});
const official = (readAt = at) => ({date: DATE, updatedAt: readAt, rooms: [{code: 'guanqi', anchors: []}],
  sourceStatus: {}, issues: [], source: {mode: 'official_live', spreadsheetToken: 'EuYqssm4WhNwAvtyybKcDdk1ned',
    readOnly: true, verified: true}});
function runtime({botOverride, hubOverride, policyOverride, clock = () => NOW, signal} = {}) {
  const calls = [], p = {...policy(), ...policyOverride};
  const hub = {async read(op, input, options) {
    calls.push(['hub', op, input, options]);
    if (hubOverride) { const output = await hubOverride(op, input); if (output !== undefined) return structuredClone(output); }
    if (op === 'bindings') return [binding()];
    if (op === 'state') return {tasks: [task()], flowNotifications: [notice()]};
    if (op === 'parse') return official(input.readAt);
    if (op === 'derive') return [];
    if (op === 'card') return card();
    throw new Error('unexpected bridge');
  }};
  const bot = {async read(kind, id, options) {
    calls.push(['bot', kind, id, options]);
    if (botOverride) { const output = await botOverride(kind, id, options); if (output !== undefined) return structuredClone(output); }
    if (kind === 'user') return {user: identity()};
    if (kind === 'sheet') return {valueRange: {values: [['source']]}, revision: 9};
    if (kind === 'message') return message(id);
    if (kind === 'chat') return id === GROUP ? {name: 'WIS直播战队', chat_mode: 'group', chat_status: 'normal',
      chat_type: 'private', external: false, moderation_permission: 'all_members'} : {chat_mode: 'p2p', chat_status: 'normal'};
    if (kind === 'read_users') return {items: [{user_id: 'ou_person', user_id_type: 'open_id'}], has_more: false};
    if (kind === 'members') return {items: [{member_id: 'ou_person', member_id_type: 'open_id'}],
      has_more: false, member_total: 1, trigger_security_conf_limit: false};
    if (kind === 'bots') return {items: [{bot_id: 'ou_bot'}]};
    throw new Error('unexpected bot');
  }};
  const inner = composeReadOps({policy: p, topology: async () => ({}), artifacts: {
    readBackup: async () => ({}), readOaPage: async () => ({})}, hub, bot, clock, signal});
  return {...inner, calls, policy: p};
}
async function fixtureDir(t) {
  const path = await mkdtemp(join(tmpdir(), 'wis-trusted-read-test-'));
  t.after(() => rm(path, {recursive: true, force: true})); return path;
}
async function beforeCard(inner) {
  await inner.ops.readApprovedBindings(); await inner.ops.readIdentity('ou_person', number);
  await inner.ops.readHubState(); const msg = await inner.ops.readCardMessage('om_current');
  await inner.ops.readPersonalChat(msg.chatId); return msg;
}
const expectCode = (fn, code) => assert.rejects(fn, error => error.code === code);

test('independent raw UTF8 pins accept formatting and deeply freeze, never recompute canonical config hash', async t => {
  const dir = await fixtureDir(t), files = ['policy', 'topology', 'artifact'].map(x => join(dir, x + '.json'));
  const topologyBytes = JSON.stringify({network: {name: 'real-network'}});
  const artifactBytes = JSON.stringify({version: 1, nested: {keys: ['actual-file']}}, null, 2);
  const policyBytes = JSON.stringify({...policy(), topologyPinSha256: digestBytes(topologyBytes),
    artifactConfigSha256: digestBytes(artifactBytes)}, null, 2);
  await Promise.all([policyBytes, topologyBytes, artifactBytes].map((bytes, i) => writeFile(files[i], bytes)));
  const inputs = await loadTrustedInputs({policyPath: files[0], pinnedPolicySha256: digestBytes(policyBytes),
    topologyPinPath: files[1], artifactConfigPath: files[2]});
  assert.ok(Object.isFrozen(inputs.policy) && Object.isFrozen(inputs.artifacts.nested.keys));
  assert.notEqual(digestJson(inputs.artifacts), digestBytes(artifactBytes));
  await inputs.recheck();
  await writeFile(files[1], topologyBytes + '\n');
  await expectCode(() => inputs.recheck(), 'input_digest_mismatch');
});
test('bad digest, malformed JSON, arrays, oversize and coincident input paths fail closed', async t => {
  const dir = await fixtureDir(t), path = join(dir, 'pin.json');
  for (const [bytes, code] of [['no-json', 'input_json_invalid'], ['[]', 'input_object_required']]) {
    await writeFile(path, bytes); await expectCode(() => readPinnedJson(path, digestBytes(bytes)), code);
  }
  await writeFile(path, '{"safe":true}');
  await expectCode(() => readPinnedJson(path, '0'.repeat(64)), 'input_digest_mismatch');
  await expectCode(() => readPinnedJson(path, digestBytes('{"safe":true}'), {maxBytes: 2}), 'input_size_invalid');
  await expectCode(() => loadTrustedInputs({policyPath: path, topologyPinPath: path,
    artifactConfigPath: path, pinnedPolicySha256: 'a'.repeat(64)}), 'independent_input_paths_required');
});
test('live entry rejects transport/clock/policy object injection before any read', async () => {
  for (const key of ['clock', 'execute', 'policy', 'evidence', 'ops'])
    await expectCode(() => createTrustedReadOps({[key]: () => true}), 'live_adapter_unexpected_option');
});
test('bot commands are typed reads, bot identity, no raw user OAuth, write or unknown source', () => {
  for (const [kind, id] of [['message', 'om_test'], ['chat', GROUP], ['members', 'oc_p2p'],
    ['read_users', 'om_test'], ['bots', GROUP], ['user', 'ou_person'], ...SHEETS.map(id => ['sheet', id])]) {
    const args = botReadCommand(kind, id);
    assert.deepEqual(args.slice(-4), ['--as', 'bot', '--format', 'json']);
    assert.ok(!args.includes('--download-resources'));
    if (kind === 'members') assert.ok(args.includes('--check-security-conf') && !args.includes('true'));
    if (kind === 'sheet') assert.equal(args[1], 'GET');
  }
  for (const [kind, id, cursor] of [['send', GROUP, ''], ['user', 'ou_person;write', ''],
    ['sheet', 'outside', ''], ['chat', GROUP, 'ignored'], ['members', 'oc_p2p', '\n']])
    assert.throws(() => botReadCommand(kind, id, cursor));
});
test('bot client cannot transform an unknown operation into a transport call', async () => {
  let calls = 0;
  const client = createBotReadClient({expectedBotOpenId: 'ou_bot', execute: async () => {calls++;}});
  await expectCode(() => client.read('oauth_refresh', 'token'), 'bot_operation_forbidden');
  assert.equal(calls, 0);
});
test('default raw bot transport independently validates canonical read arguments before spawn', async () => {
  for (const [kind, id, cursor] of [['message', 'om_one', ''], ['user', 'ou_person', ''],
    ['members', 'oc_personal', 'next'], ['read_users', 'om_one', 'next'], ['bot_info', undefined, ''],
    ['chat', GROUP, ''], ['bots', GROUP, ''], ...SHEETS.map(id => ['sheet', id, ''])]) {
    const args = botReadCommand(kind, id, cursor); assert.doesNotThrow(() => validateBotReadArguments(args));
    assert.throws(() => validateBotReadArguments([...args, '--page-all']));
  }
  for (const args of [['api', 'POST', '/open-apis/im/v1/messages', '--as', 'bot', '--format', 'json'],
    ['im', '+send', '--text', 'bad'], [...botReadCommand('message', 'om_one').slice(0, -4), '--as', 'user', '--format', 'json']])
    await expectCode(() => executeBotCommand(args), 'bot_argv_forbidden');
});
test('actual bot identity GET precedes scoped read and wrong/disabled profile stops before user lookup', async () => {
  const calls = [], client = createBotReadClient({expectedBotOpenId: 'ou_bot', execute: async args => {
    calls.push(args); return args[2] === '/open-apis/bot/v3/info' ? {bot: {open_id: 'ou_bot', activate_status: 2}} : {user: identity()};
  }});
  assert.equal((await client.read('user', 'ou_person')).user.open_id, 'ou_person');
  assert.deepEqual(calls.map(x => x[2]), ['/open-apis/bot/v3/info', '/open-apis/contact/v3/users/ou_person']);
  for (const bot of [{open_id: 'ou_other', activate_status: 2}, {open_id: 'ou_bot', activate_status: 1}, {}]) {
    let readCount = 0;
    const wrong = createBotReadClient({expectedBotOpenId: 'ou_bot', execute: async () => {readCount++; return {bot};}});
    await expectCode(() => wrong.read('user', 'ou_person'), 'actual_bot_profile_mismatch'); assert.equal(readCount, 1);
  }
  assert.throws(() => createBotReadClient({expectedBotOpenId: 'configured-label'}));
});
test('native message normalization binds one exact message, bot sender, type and content', () => {
  assert.equal(normalizeBotMessage(message(), 'om_current', at).senderAppId, APP);
  for (const mutate of [x => {x.items.push(x.items[0]);}, x => {x.items[0].message_id = 'om_other';},
    x => {x.items[0].sender.sender_type = 'user';}, x => {delete x.items[0].deleted;},
    x => {x.items[0].body.content = {};}, x => {x.items[0].chat_id = 'not-a-chat';}]) {
    const data = message(); mutate(data); assert.throws(() => normalizeBotMessage(data, 'om_current', at));
  }
});

function mockSpawn({content = '{}', closeDelay = 0, code = 0, onKill} = {}) {
  let instance;
  return {get instance() { return instance; }, spawn(program, args, options) {
    instance = new EventEmitter(); instance.stdout = new PassThrough(); instance.stderr = new PassThrough();
    instance.stdin = new PassThrough(); instance.invocation = {program, args, options};
    instance.kill = signal => {onKill?.(signal, instance); return true;};
    instance.stdin.on('finish', () => {
      setTimeout(() => {instance.stdout.write(content); instance.emit('close', code);}, closeDelay);
    }); return instance;
  }};
}
test('read child is shell-free, ignores stderr and returns only after close', async () => {
  const mock = mockSpawn({content: 'read-data'});
  const result = await runReadChild('lark-cli', ['read'], {maxBytes: 100, spawnImpl: mock.spawn});
  assert.equal(result, 'read-data'); assert.equal(mock.instance.invocation.options.shell, false);
});
test('pre-abort does not spawn; cancellation kills with SIGKILL and waits for close', async () => {
  const cancelled = new AbortController(); cancelled.abort(); let calls = 0;
  await expectCode(() => runReadChild('lark-cli', [], {signal: cancelled.signal, maxBytes: 50,
    spawnImpl: () => {calls++;}}), 'read_aborted'); assert.equal(calls, 0);
  const controller = new AbortController(), kills = [];
  const mock = mockSpawn({closeDelay: 40, onKill: sig => kills.push(sig)}); let settled = false;
  const pending = runReadChild('docker', ['read'], {signal: controller.signal, maxBytes: 100, spawnImpl: mock.spawn})
    .finally(() => {settled = true;});
  controller.abort(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(settled, false);
  await expectCode(() => pending, 'read_aborted'); assert.deepEqual(kills, ['SIGKILL']);
});
test('timeout, excessive stdout and nonzero close cannot return success or raw stderr', async () => {
  for (const fixture of [{closeDelay: 20}, {content: 'x'.repeat(20)}, {code: 1}]) {
    const kills = [], mock = mockSpawn({...fixture, onKill: sig => kills.push(sig)});
    await expectCode(() => runReadChild('docker', [], {maxBytes: 5, timeoutMs: 5, spawnImpl: mock.spawn}),
      'read_process_failed');
  }
});
test('Hub bridge permits only fixed ops and fixed full-ID/config pins', async () => {
  let invocation;
  const bridge = createHubReadBridge({policy: policy(), execute: async (id, bytes) => {
    invocation = {id, input: JSON.parse(bytes)}; return [];
  }});
  await bridge.read('bindings'); assert.equal(invocation.id, 'c'.repeat(64));
  assert.equal(invocation.input.config.participantFileSha256, 'a'.repeat(64));
  await expectCode(() => bridge.read('sync', {}), 'hub_bridge_operation_forbidden');
  assert.throws(() => createHubReadBridge({policy: {...policy(), moduleHashes: {'../unsafe.mjs': 'a'.repeat(64)}}}));
});
test('immutable card normal and native encodings match, dynamic buttons do not change identity', () => {
  const native = {header: {property: {subtitle: {property: {content: DATE}}}}, body: {property: {elements: [{
    property: {columns: [{property: {elements: card().body.elements[0].columns[0].elements.map(row => ({
      property: {elements: [{property: {content: row.content.replace('官', '&#23448;')}}]}}))}}]}}]}}};
  assert.equal(immutableCardDigest(card()), immutableCardDigest(JSON.stringify(native)));
  const updated = card(); updated.body.elements.push({type: 'button', content: '已回执'});
  assert.equal(immutableCardDigest(updated), immutableCardDigest(card()));
  const other = card(); other.header.subtitle.content = '2026-09-30';
  assert.notEqual(immutableCardDigest(other), immutableCardDigest(card()));
  assert.throws(() => immutableCardDigest({header: {}, body: {}}));
});
test('approved real identity discards nonapproved fields and refuses outside IDs before transport', async () => {
  const inner = runtime(); await inner.ops.readApprovedBindings();
  const row = await inner.ops.readIdentity('ou_person', number);
  assert.ok(row.active && row.employed && row.departmentVerified);
  assert.ok(!JSON.stringify(row).includes('must-not-retain'));
  const count = inner.calls.length;
  await expectCode(() => inner.ops.readIdentity('ou_outside', number), 'identity_outside_approved_bindings');
  assert.equal(inner.calls.length, count); await inner.drain();
});
for (const [label, mutate] of [['same-name wrong id', x => {x.open_id = 'ou_other';}],
  ['frozen', x => {x.status.is_frozen = true;}], ['resigned', x => {x.status.is_resigned = true;}],
  ['missing activation', x => {delete x.status.is_activated;}], ['wrong department', x => {x.department_ids = ['od_other'];}]])
  test('identity closes on ' + label, async () => {
    const user = identity(); mutate(user); const inner = runtime({botOverride: kind => kind === 'user' ? {user} : undefined});
    await inner.ops.readApprovedBindings();
    await expectCode(() => inner.ops.readIdentity('ou_person', number), 'current_identity_unverified'); await inner.drain();
  });
test('binding pins reject duplicate, extra person, wrong app, inactive approval and missing department', async () => {
  for (const mutate of [rows => rows.push(binding()), rows => {rows[0].appId = 'cli_other';},
    rows => {rows[0].approvedBy = 'someone';}, rows => {rows[0].departmentIds = [];},
    rows => {rows[0].number = 'N-outside';}]) {
    const rows = [binding()]; mutate(rows);
    const inner = runtime({hubOverride: op => op === 'bindings' ? rows : undefined});
    await expectCode(() => inner.ops.readApprovedBindings(), 'approved_bindings_changed_or_invalid'); await inner.drain();
  }
});
test('official read selects only four approved A:Q tabs at D+1, same revision, fixed parser', async () => {
  const inner = runtime(); const result = await inner.ops.readOfficialSource(DATE, {fresh: true});
  assert.equal(result.updatedAt, at);
  assert.deepEqual(inner.calls.filter(x => x[0] === 'bot').map(x => x[2]), SHEETS);
  await expectCode(() => inner.ops.readOfficialSource('2026-09-30', {fresh: true}), 'official_date_or_fresh_read_invalid');
  await expectCode(() => inner.ops.readOfficialSource(DATE, {fresh: false}), 'official_date_or_fresh_read_invalid'); await inner.drain();
});
test('changed sheet revision, missing actual values and forged parser date fail closed', async () => {
  for (const setup of [
    {botOverride: (kind, id) => kind === 'sheet' && id === SHEETS[2] ? {valueRange: {values: []}, revision: 10} : undefined},
    {botOverride: kind => kind === 'sheet' ? {revision: 9} : undefined},
    {hubOverride: op => op === 'parse' ? {...official(), date: '2026-09-30'} : undefined}]) {
    const inner = runtime(setup); await assert.rejects(() => inner.ops.readOfficialSource(DATE, {fresh: true})); await inner.drain();
  }
});
test('derive uses private exact source/binding/identity, not caller assertions or other room', async () => {
  const inner = runtime(), src = await inner.ops.readOfficialSource(DATE, {fresh: true});
  const rows = await inner.ops.readApprovedBindings(), who = await inner.ops.readIdentity('ou_person', number);
  assert.deepEqual(await inner.ops.deriveRoomSlots({...src, rooms: [src.rooms[0]]}, DATE, rows, [who]), []);
  for (const [raw, people, ids] of [[{...src, rooms: [{code: 'outside'}]}, rows, [who]],
    [src, [{...rows[0], openId: 'ou_other'}], [who]], [src, rows, [{...who, active: false}]]])
    await expectCode(() => inner.ops.deriveRoomSlots(raw, DATE, people, ids), 'derive_inputs_not_current'); await inner.drain();
});
test('ledger limits card queries to approved current date sent rows and exact immutable owner/attempt', async () => {
  const inner = runtime(), msg = await beforeCard(inner);
  assert.equal(await inner.ops.cardMatches(notice(), task(), msg), true);
  const count = inner.calls.length;
  await expectCode(() => inner.ops.readCardMessage('om_outside'), 'card_not_in_approved_current_ledger');
  assert.equal(inner.calls.length, count);
  await expectCode(() => inner.ops.cardMatches({...notice(), recipient: 'N-other'}, task(), msg), 'card_compare_inputs_not_current');
  await expectCode(() => inner.ops.cardMatches(notice(), task(), {...msg, messageId: 'om_other'}), 'card_compare_inputs_not_current');
  await inner.drain();
});
test('frozen wrong-card delivery and wrong owner/attempt cannot match current task', async () => {
  const row = notice(), other = card(); other.header.subtitle.content = '2026-09-30';
  row.delivery = {msg_type: 'interactive', content: JSON.stringify(other)};
  const inner = runtime({hubOverride: op => op === 'state' ? {tasks: [task()], flowNotifications: [row]} : undefined});
  const msg = await beforeCard(inner);
  await expectCode(() => inner.ops.cardMatches(row, task(), msg), 'frozen_card_differs_from_current_task'); await inner.drain();
  const changed = task(); changed.runtime.nodes[0].attempt = 2;
  const inner2 = runtime({hubOverride: op => op === 'state' ? {tasks: [changed], flowNotifications: [notice()]} : undefined});
  const msg2 = await beforeCard(inner2);
  await expectCode(() => inner2.ops.cardMatches(notice(), changed, msg2), 'card_owner_node_or_attempt_mismatch'); await inner2.drain();
});
test('wrong sender/deleted/noninteractive messages and duplicate ledger IDs reject', async () => {
  for (const mutate of [data => {data.items[0].sender.id = 'cli_other';},
    data => {data.items[0].deleted = true;}, data => {data.items[0].msg_type = 'text';}]) {
    const data = message(); mutate(data);
    const inner = runtime({botOverride: kind => kind === 'message' ? data : undefined});
    await inner.ops.readApprovedBindings(); await inner.ops.readHubState();
    await expectCode(() => inner.ops.readCardMessage('om_current'), 'formal_card_sender_or_type_invalid'); await inner.drain();
  }
  const inner = runtime({hubOverride: op => op === 'state' ? {tasks: [task()], flowNotifications: [notice(), notice()]} : undefined});
  await inner.ops.readApprovedBindings(); await expectCode(() => inner.ops.readHubState(), 'duplicate_formal_card_message'); await inner.drain();
});
test('only actual card chat can be queried; group is not a personal peer', async () => {
  const inner = runtime(); await beforeCard(inner);
  const count = inner.calls.length;
  await expectCode(() => inner.ops.readPersonalChat('oc_unrelated'), 'chat_not_from_current_card_get');
  await expectCode(() => inner.ops.readPersonalPeer(GROUP, 'om_current'), 'personal_proof_message_chat_mismatch');
  assert.equal(inner.calls.length, count); await inner.drain();
  const groupCard = runtime({botOverride: kind => kind === 'chat' ? {chat_mode: 'group', chat_status: 'normal'} : undefined});
  await groupCard.ops.readApprovedBindings(); await groupCard.ops.readHubState(); await groupCard.ops.readCardMessage('om_current');
  await expectCode(() => groupCard.ops.readPersonalChat('oc_personal'), 'card_not_normal_p2p'); await groupCard.drain();
});
test('same-message complete positive read_user identifies exact person, never a cached other card', async () => {
  const inner = runtime(); await beforeCard(inner);
  const row = await inner.ops.readPersonalPeer('oc_personal', 'om_current');
  assert.equal(row.kind, 'read_user'); assert.deepEqual(row.readUserIds, ['ou_person']);
  assert.equal(row.messageId, 'om_current'); assert.equal(inner.calls.filter(x => x[1] === 'members').length, 0);
  await expectCode(() => inner.ops.readPersonalPeer('oc_personal', 'om_other'), 'card_not_in_approved_current_ledger'); await inner.drain();
});
test('genuinely unread complete list falls back to complete exact P2P membership', async () => {
  const inner = runtime({botOverride: kind => kind === 'read_users' ? {items: [], has_more: false} : undefined});
  await beforeCard(inner); const row = await inner.ops.readPersonalPeer('oc_personal', 'om_current');
  assert.equal(row.kind, 'p2p_member'); assert.deepEqual(row.memberIds, ['ou_person']); await inner.drain();
});
for (const [label, data] of [['partial', {items: [], has_more: false, trigger_security_conf_limit: true}],
  ['bad id type', {items: [{user_id: 'ou_person', user_id_type: 'user_id'}], has_more: false}],
  ['different reader', {items: [{user_id: 'ou_other', user_id_type: 'open_id'}], has_more: false}],
  ['missing continuation', {items: [], has_more: true}],
  ['duplicate', {items: [{user_id: 'ou_person', user_id_type: 'open_id'}, {user_id: 'ou_person', user_id_type: 'open_id'}], has_more: false}]])
  test('read-user ' + label + ' does not silently fall back to members', async () => {
    const inner = runtime({botOverride: kind => kind === 'read_users' ? data : undefined}); await beforeCard(inner);
    await assert.rejects(() => inner.ops.readPersonalPeer('oc_personal', 'om_current'));
    assert.equal(inner.calls.filter(x => x[1] === 'members').length, 0); await inner.drain();
  });
test('permission errors stay explicit and do not turn into positive P2P evidence', async () => {
  const inner = runtime({botOverride: kind => {if (kind === 'read_users') throw Object.assign(new Error('private'), {code: 'bot_api_99991672'});}});
  await beforeCard(inner);
  await expectCode(() => inner.ops.readPersonalPeer('oc_personal', 'om_current'), 'bot_api_99991672');
  assert.equal(inner.calls.filter(x => x[1] === 'members').length, 0); await inner.drain();
});
test('P2P pagination cannot accept incomplete, wrong-member or security-truncated proof', async () => {
  for (const members of [{items: [], has_more: false, member_total: 1, trigger_security_conf_limit: false},
    {items: [{member_id: 'ou_other', member_id_type: 'open_id'}], has_more: false, member_total: 1, trigger_security_conf_limit: false},
    {items: [{member_id: 'ou_person', member_id_type: 'open_id'}], has_more: false, member_total: 1},
    {items: [], has_more: true, page_token: 'same', member_total: 1, trigger_security_conf_limit: false}]) {
    const inner = runtime({botOverride: kind => kind === 'read_users' ? {items: [], has_more: false}
      : kind === 'members' ? members : undefined}); await beforeCard(inner);
    await assert.rejects(() => inner.ops.readPersonalPeer('oc_personal', 'om_current')); await inner.drain();
  }
});
test('group scope is fixed, bot ID comes from complete bot roster not a name or policy canSend flag', async () => {
  const inner = runtime(); assert.equal((await inner.ops.readGroup(GROUP)).botCanSend, true);
  const count = inner.calls.length;
  await expectCode(() => inner.ops.readGroup('oc_other'), 'group_identity_pins_missing'); assert.equal(inner.calls.length, count);
  await inner.drain();
  for (const bots of [{items: [{bot_id: 'ou_other', bot_name: '品牌营销部中枢'}]},
    {items: [{bot_id: 'ou_bot'}], has_more: true}, {items: [{bot_id: 'ou_bot'}, {bot_id: 'ou_bot'}]}]) {
    const next = runtime({botOverride: kind => kind === 'bots' ? bots : undefined});
    if (bots.has_more || bots.items.length > 1) await expectCode(() => next.ops.readGroup(GROUP), 'group_bot_members_incomplete');
    else assert.equal((await next.ops.readGroup(GROUP)).botCanSend, false); await next.drain();
  }
});
test('an unapproved group test ID is never searched or queried', async () => {
  const inner = runtime();
  await expectCode(() => inner.ops.readGroupTest('om_similar'), 'group_test_approval_missing');
  assert.equal(inner.calls.length, 0); await inner.drain();
});
test('approved group test pins actual bytes and exact chat/app/id, never caller approval flags', async t => {
  const dir = await fixtureDir(t), path = join(dir, 'approved.json');
  const content = JSON.stringify({text: '【联调测试｜WIS直播工作流】仅验证送达，不是业务任务'});
  const approval = {kind: 'approved_war_room_test', authorizedBy: 'FD-026222', groupId: GROUP,
    appId: APP, messageId: 'om_approved', approvedAt: '2026-09-28T00:00:00Z', contentSha256: digestBytes(content)};
  const bytes = JSON.stringify(approval, null, 2); await writeFile(path, bytes);
  const data = message('om_approved'); data.items[0].chat_id = GROUP; data.items[0].body.content = content;
  data.items[0].msg_type = 'text';
  const inner = runtime({policyOverride: {approvedGroupTestMessageId: 'om_approved', groupTestApproval: {path, sha256: digestBytes(bytes)}},
    botOverride: kind => kind === 'message' ? data : undefined});
  const result = await inner.ops.readGroupTest('om_approved');
  assert.equal(result.exactTestMarker, true); assert.equal(result.approvalVerifiedExternally, true);
  data.items[0].body.content = JSON.stringify({text: '【联调测试｜WIS直播工作流】different'});
  assert.equal((await inner.ops.readGroupTest('om_approved')).exactTestMarker, false);
  await inner.drain();
});
test('global transport concurrency never exceeds four and drain waits for all abort closures', async () => {
  const controller = new AbortController(); let active = 0, maximum = 0, closures = 0;
  const inner = runtime({signal: controller.signal, botOverride: (kind, id, {signal}) => {
    if (kind !== 'user') return undefined;
    active++; maximum = Math.max(maximum, active);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => setTimeout(() => {
      active--; closures++; reject(Object.assign(new Error('closed'), {code: 'read_aborted'}));
    }, 10), {once: true}));
  }});
  await inner.ops.readApprovedBindings();
  const reads = Array.from({length: 12}, () => inner.ops.readIdentity('ou_person', number));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(maximum, 4);
  const settled = Promise.allSettled(reads); controller.abort(); await inner.drain();
  assert.equal(active, 0); assert.equal(closures, 4); assert.ok((await settled).every(x => x.status === 'rejected'));
});
test('final re-read refuses changed source, binding or ledger rather than timestamp-freshening them', async () => {
  for (const target of ['source', 'binding', 'ledger']) {
    let changed = false;
    const inner = runtime({hubOverride: op => {
      if (!changed) return;
      if (target === 'binding' && op === 'bindings') return [{...binding(), name: 'different'}];
      if (target === 'ledger' && op === 'state') return {tasks: [task()], flowNotifications: [notice(), {...notice(), id: 'new'}]};
    }, botOverride: kind => changed && target === 'source' && kind === 'sheet' ? {revision: 10, valueRange: {values: [['source']]}} : undefined});
    await inner.ops.readOfficialSource(DATE, {fresh: true}); await inner.ops.readApprovedBindings(); await inner.ops.readHubState();
    await inner.verifyUnchanged(); changed = true;
    await expectCode(() => inner.verifyUnchanged(), target === 'source' ? 'source_changed_during_collection'
      : target === 'binding' ? 'bindings_changed_during_collection' : 'ledger_changed_during_collection'); await inner.drain();
  }
});
test('initial missing snapshots cannot be promoted into a final live round', async () => {
  const inner = runtime(); await expectCode(() => inner.verifyUnchanged(), 'initial_read_incomplete'); await inner.drain();
});
test('live diagnostic finalizer always retains unproven mount, process and native CLI NO-GO gates', () => {
  const input = {collectorIssues: [], checksPassed: true, trustedMountVerified: true, trustedTransportVerified: true,
    trustedLinuxCliVerified: true};
  const closed = finalizeDiagnosticEvidence(input, {policy: policy(), mode: 'preview', now: NOW});
  assert.deepEqual(closed.evidence.collectorIssues, TRUSTED_LIVE_BLOCKERS);
  assert.equal(closed.result.checksPassed, false); assert.equal(closed.result.safeToEnable, false);
  assert.equal(closed.result.diagnosticOnly, true); assert.deepEqual(input.collectorIssues, []);
  assert.ok(closed.result.issues.includes('independent_collection_incomplete'));
  assert.throws(() => {TRUSTED_LIVE_BLOCKERS.push('caller-can-bypass');});
});
