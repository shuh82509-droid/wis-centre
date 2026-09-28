// Release-side concrete acceptance collection. This entry point has no signer,
// permit installer, source sync, task write, message sender or OAuth refresh.
import {collectReadOnlyEvidence} from './readiness-collector.mjs';
import {evaluateNextDayEvidence} from './readiness-core.mjs';
import {loadTrustedInputs, readPinnedJson, freezeInput, digestBytes, digestJson, requireRead,
  validDigest} from './trusted-policy.mjs';
import {createBotReadClient, normalizeBotMessage} from './trusted-bot-reads.mjs';
import {createHubReadBridge} from './trusted-hub-reads.mjs';
import {createDockerTopologyReader} from './trusted-topology.mjs';
import {createArtifactReaders} from './trusted-artifacts.mjs';

const SHEETS = ['NYB2iu', 'MVpDv0', 'LRAvIU', 'PhlV42'];
const openId = value => /^ou_[a-z0-9]+$/u.test(value || '');
const execution = value => /^W04\.S4\.(E1|A[1-9]\d*)$/u.test(value || '');
const nextDate = ms => new Date(ms + 8 * 3600000 + 86400000).toISOString().slice(0, 10);
const fresh = (at, now) => Number.isFinite(Date.parse(at)) && now >= Date.parse(at) && now - Date.parse(at) <= 120000;
// These cannot be filled by caller flags or a synthetic policy. Actual mounted
// inode/device identity, daemon-side exec termination and the pinned native
// Linux CLI contract still require separate reviewed implementations/proof.
// This version is a concrete diagnostic reader, NOT a live signing authority.
export const TRUSTED_LIVE_BLOCKERS = Object.freeze(['trusted_kernel_mount_identity_unproven',
  'trusted_transport_lifetime_unproven', 'trusted_linux_cli_compatibility_unverified']);
export function finalizeDiagnosticEvidence(evidence, options) {
  requireRead(Array.isArray(evidence?.collectorIssues), 'diagnostic_evidence_invalid');
  const closed = {...evidence, collectorIssues: [...new Set([...evidence.collectorIssues, ...TRUSTED_LIVE_BLOCKERS])]};
  return {evidence: closed, result: evaluateNextDayEvidence(closed, options)};
}
const same = (a, b) => digestJson(a) === digestJson(b);
const clean = value => String(value || '').replace(/&#(\d+);/gu,
  (_, code) => String.fromCharCode(Number(code))).replace(/[*\n\r]/gu, '');

// Compare only the exact immutable identity block (date/room/person/times/work)
// in the frozen formal card and native mget format. Receipt/button updates are
// not immutable identity. This never backfills send-intent or peer provenance.
export function immutableCardDigest(content) {
  let card = typeof content === 'string' ? JSON.parse(content) : content;
  if (typeof card?.json_card === 'string') card = JSON.parse(card.json_card);
  let subtitle, lines;
  if (card?.header?.subtitle?.content && card?.body?.elements) {
    subtitle = card.header.subtitle.content;
    lines = card.body.elements[0]?.columns?.[0]?.elements?.map(e => clean(e.content));
  } else {
    subtitle = card?.header?.property?.subtitle?.property?.content;
    lines = card?.body?.property?.elements?.[0]?.property?.columns?.[0]?.property?.elements?.map(e =>
      clean(e.property?.elements?.map(value => value.property?.content || '').join('')));
  }
  requireRead(typeof subtitle === 'string' && subtitle.length > 0 && subtitle.length < 300 &&
    Array.isArray(lines) && lines.length === 2 && lines.every(x => typeof x === 'string' && x.length > 0),
  'card_immutable_identity_missing');
  return digestJson({subtitle, lines});
}

// Narrow composition is exported for offline tests. Injected observations are
// never a trusted live collector; only createTrustedReadOps wires real readers.
export function composeReadOps({policy, topology, artifacts, hub, bot, clock = Date.now, signal}) {
  let source = null, sourceSheets = null, bindings = null, state = null;
  const identities = new Map(), messages = new Map(), cards = new Map(), tasks = new Map();
  const personalChats = new Map();
  let active = 0;
  const queue = [], pending = new Set();
  function advance() {
    while (active < 4 && queue.length) {
      const {read, resolve, reject} = queue.shift();
      if (signal?.aborted) { reject(Object.assign(new Error('Read-only collection stopped'), {code: 'read_aborted'})); continue; }
      active++;
      const timer = new AbortController();
      const timeout = setTimeout(() => timer.abort(), 10000);
      const combined = signal ? AbortSignal.any([signal, timer.signal]) : timer.signal;
      const promise = Promise.resolve().then(() => read(combined)).then(value => {
        requireRead(!combined.aborted, 'read_timeout_or_aborted'); return value;
      }).then(resolve, error => reject(Object.assign(new Error('Read-only acceptance unavailable'), {
        code: combined.aborted ? 'read_timeout_or_aborted' : /^[a-z0-9_]{1,80}$/u.test(error?.code || '')
          ? error.code : 'trusted_read_failed'}))).finally(() => {
        clearTimeout(timeout); active--; pending.delete(promise); advance();
      });
      pending.add(promise);
    }
  }
  const read = fn => new Promise((resolve, reject) => { queue.push({read: fn, resolve, reject}); advance(); });
  const rpc = (kind, id, options = {}) => read(signal => bot.read(kind, id, {...options, signal}));
  const bridge = (operation, input) => read(signal => hub.read(operation, input, {signal}));
  const clone = value => structuredClone(value);
  async function readSheets() {
    const sheets = [];
    for (const sheetId of SHEETS) {
      const data = await rpc('sheet', sheetId), values = data?.valueRange?.values;
      const revision = Number(data?.revision ?? data?.valueRange?.revision);
      requireRead(Array.isArray(values) && Number.isSafeInteger(revision) && revision > 0,
        'official_values_or_revision_missing');
      sheets.push({sheetId, values, revision});
    }
    requireRead(new Set(sheets.map(x => x.revision)).size === 1, 'official_revision_changed');
    return sheets;
  }
  function requireCard(id) {
    const row = cards.get(id);
    requireRead(row && row.state === 'sent' && !row.unknown && bindings.some(b => b.number === row.recipient),
      'card_not_in_approved_current_ledger');
    return row;
  }
  async function pageIds(kind, id, field) {
    const ids = [], cursors = new Set(); let cursor = '';
    for (let page = 0; page < 4; page++) {
      const data = await rpc(kind, id, {cursor});
      requireRead(Array.isArray(data?.items) && typeof data.has_more === 'boolean' &&
        data.trigger_security_conf_limit !== true && (!data.truncations || data.truncations.length === 0),
      'personal_proof_partial');
      requireRead(data.items.every(x => x[field + '_type'] === 'open_id' && openId(x[field])),
        'personal_proof_id_type_invalid');
      ids.push(...data.items.map(x => x[field]));
      requireRead(new Set(ids).size === ids.length && ids.length <= 100, 'personal_proof_duplicate_or_excess');
      if (!data.has_more) {
        if (kind === 'members') requireRead(Number.isSafeInteger(data.member_total) &&
          data.member_total === ids.length && data.trigger_security_conf_limit === false,
        'personal_members_total_unverified');
        return ids;
      }
      requireRead(typeof data.page_token === 'string' && data.page_token && !cursors.has(data.page_token),
        'personal_proof_cursor_invalid');
      cursors.add(data.page_token); cursor = data.page_token;
    }
    requireRead(false, 'personal_proof_page_limit');
  }
  const ops = Object.freeze({
    async readTopology() { return read(signal => topology({signal})); },
    async readApprovedBindings() {
      requireRead(Array.isArray(policy.approvedNumbers) && policy.approvedNumbers.length > 0 &&
        new Set(policy.approvedNumbers).size === policy.approvedNumbers.length, 'approved_numbers_missing');
      const rows = await bridge('bindings');
      requireRead(Array.isArray(rows) && rows.length === policy.approvedNumbers.length &&
        rows.every(b => policy.approvedNumbers.includes(b.number) && b.appId === policy.botAppId &&
          openId(b.openId) && typeof b.name === 'string' && b.name && b.center === '直播中心' &&
          Array.isArray(b.departmentIds) && b.departmentIds.length > 0 &&
          b.departmentIds.every(x => typeof x === 'string' && x) && b.approvedBy === 'FD-026222' &&
          Number.isFinite(Date.parse(b.approvedAt))) &&
        new Set(rows.map(x => x.number)).size === rows.length && new Set(rows.map(x => x.openId)).size === rows.length,
      'approved_bindings_changed_or_invalid');
      bindings = freezeInput(clone(rows)); return clone(bindings);
    },
    async readIdentity(id, number) {
      const binding = bindings?.find(x => x.number === number && x.openId === id);
      requireRead(binding, 'identity_outside_approved_bindings');
      const data = await rpc('user', id), user = data?.user ?? data;
      const status = user?.status, departments = user?.department_ids;
      const checkedAt = new Date(clock()).toISOString();
      const row = {number, openId: user?.open_id, name: user?.name, checkedAt,
        active: status?.is_activated === true && status?.is_frozen === false && status?.is_exited === false,
        employed: status?.is_resigned === false,
        departmentVerified: Array.isArray(departments) && binding.departmentIds.some(x => departments.includes(x))};
      // No hire dates, employee numbers, email, telephone or raw user records.
      requireRead(row.openId === id && row.name === binding.name && row.active && row.employed &&
        row.departmentVerified, 'current_identity_unverified');
      identities.set(number, freezeInput(row)); return clone(row);
    },
    async readOfficialSource(date, {fresh: requestedFresh} = {}) {
      requireRead(requestedFresh === true && date === policy.expectedDate && date === nextDate(clock()),
        'official_date_or_fresh_read_invalid');
      const readAt = new Date(clock()).toISOString(), sheets = await readSheets();
      const raw = await bridge('parse', {date, readAt, sheets});
      requireRead(raw?.date === date && raw.updatedAt === readAt && Array.isArray(raw.rooms) &&
        raw.source?.mode === 'official_live' && raw.source.spreadsheetToken === policy.workbook,
      'formal_parser_readback_invalid');
      sourceSheets = freezeInput(clone(sheets));
      source = freezeInput(clone(raw)); return clone(source);
    },
    async deriveRoomSlots(raw, date, approved, readbacks) {
      requireRead(source && bindings && date === policy.expectedDate && same(approved, bindings) &&
        Array.isArray(raw?.rooms) && raw.rooms.length === 1 &&
        source.rooms.some(room => same(room, raw.rooms[0])) &&
        same({...raw, rooms: source.rooms}, source) && Array.isArray(readbacks) &&
        readbacks.every(row => same(row, identities.get(row.number))) &&
        readbacks.length === identities.size && fresh(source.updatedAt, clock()), 'derive_inputs_not_current');
      return bridge('derive', {source: raw, identities: readbacks});
    },
    async readHubState() {
      requireRead(bindings, 'bindings_not_read_before_state');
      const raw = await bridge('state');
      requireRead(Array.isArray(raw?.tasks) && Array.isArray(raw.flowNotifications), 'formal_state_missing');
      state = freezeInput(clone(raw));
      for (const task of state.tasks) {
        requireRead(!tasks.has(task.id), 'duplicate_formal_task'); tasks.set(task.id, task);
      }
      for (const notice of state.flowNotifications) {
        const task = tasks.get(notice.taskId);
        if (notice.kind !== 'live_assignment' || task?.workflow !== '04' ||
          task.runtime?.liveSession?.date !== policy.expectedDate || !notice.messageId) continue;
        requireRead(!cards.has(notice.messageId), 'duplicate_formal_card_message');
        cards.set(notice.messageId, notice);
      }
      return clone(state);
    },
    async readCardMessage(id) {
      requireCard(id);
      const message = normalizeBotMessage(await rpc('message', id), id, new Date(clock()).toISOString());
      requireRead(message.senderAppId === policy.botAppId && !message.deleted && message.msgType === 'interactive',
        'formal_card_sender_or_type_invalid');
      messages.set(id, freezeInput(message)); return clone(message);
    },
    async cardMatches(notice, task, message) {
      const cached = messages.get(notice?.messageId), stored = requireCard(notice?.messageId);
      requireRead(cached && same(cached, message) && same(stored, notice) &&
        same(tasks.get(task?.id), task) && task.id === notice.taskId &&
        task.runtime?.liveSession?.date === policy.expectedDate, 'card_compare_inputs_not_current');
      const node = task.runtime.nodes.find(x => x.id === notice.nodeId);
      requireRead(execution(node?.id) && node.owner?.number === notice.recipient &&
        node.attempt === notice.attempt, 'card_owner_node_or_attempt_mismatch');
      const expected = await bridge('card', {notice, task});
      const immutable = immutableCardDigest(expected);
      if (notice.delivery) requireRead(notice.delivery.msg_type === 'interactive' &&
        immutableCardDigest(notice.delivery.content) === immutable, 'frozen_card_differs_from_current_task');
      return immutableCardDigest(message.content) === immutable;
    },
    async readPersonalChat(id) {
      requireRead([...messages.values()].some(x => x.chatId === id), 'chat_not_from_current_card_get');
      const data = await rpc('chat', id);
      requireRead(data?.chat_mode === 'p2p' && data.chat_status === 'normal', 'card_not_normal_p2p');
      const row = {chatId: id, mode: data.chat_mode, status: data.chat_status,
        checkedAs: 'bot', checkedAt: new Date(clock()).toISOString()};
      personalChats.set(id, freezeInput(row)); return clone(row);
    },
    async readPersonalPeer(chatId, messageId) {
      const card = requireCard(messageId), message = messages.get(messageId), chat = personalChats.get(chatId);
      const person = bindings.find(b => b.number === card.recipient);
      requireRead(message?.chatId === chatId && chat?.mode === 'p2p' && chat.status === 'normal' &&
        fresh(chat.checkedAt, clock()) && fresh(message.checkedAt, clock()), 'personal_proof_message_chat_mismatch');
      // Positive same-message read_users is independent recipient evidence,
      // never an empty/unread list or a group/member alias. If it is unavailable
      // or unread, try a complete bot P2P member proof without expanding scope.
      // A permission error, partial page or ambiguous response remains a
      // diagnostic failure. Only a complete genuinely empty read-user list
      // may fall back to complete P2P membership; do not hide failed evidence.
      const readUsers = await pageIds('read_users', messageId, 'user_id');
      if (readUsers?.length) {
        requireRead(same(readUsers, [person.openId]), 'unexpected_personal_message_reader');
        return {kind: 'read_user', checkedAs: 'bot', chatId, messageId, openId: person.openId,
          checkedAt: new Date(clock()).toISOString(), complete: true, readUserIds: readUsers};
      }
      const members = await pageIds('members', chatId, 'member_id');
      requireRead(same(members, [person.openId]), 'p2p_peer_not_exact_person');
      return {kind: 'p2p_member', checkedAs: 'bot', chatId, messageId, openId: person.openId,
        checkedAt: new Date(clock()).toISOString(), complete: true, memberIds: members};
    },
    async readGroup(id) {
      requireRead(id === policy.groupId && id === 'oc_3f92ef62d6160399ee823e74def199e6' &&
        openId(policy.botOpenId), 'group_identity_pins_missing');
      const data = await rpc('chat', id), bots = await rpc('bots', id);
      requireRead(Array.isArray(bots?.items) && !bots.has_more &&
        new Set(bots.items.map(x => x.bot_id)).size === bots.items.length, 'group_bot_members_incomplete');
      return {id, name: data?.name, mode: data?.chat_mode, private: data?.chat_type === 'private',
        normal: data?.chat_status === 'normal', external: data?.external,
        botCanSend: data?.moderation_permission === 'all_members' &&
          bots.items.some(x => x.bot_id === policy.botOpenId), checkedAt: new Date(clock()).toISOString()};
    },
    async readGroupTest(id) {
      const pin = policy.groupTestApproval;
      requireRead(id === policy.approvedGroupTestMessageId && pin && validDigest(pin.sha256),
        'group_test_approval_missing');
      const approval = await readPinnedJson(pin.path, pin.sha256);
      requireRead(approval.kind === 'approved_war_room_test' && approval.authorizedBy === 'FD-026222' &&
        approval.groupId === policy.groupId && approval.appId === policy.botAppId && approval.messageId === id &&
        Number.isFinite(Date.parse(approval.approvedAt)) && Date.parse(approval.approvedAt) <= clock() &&
        validDigest(approval.contentSha256), 'group_test_approval_binding_invalid');
      const message = normalizeBotMessage(await rpc('message', id), id, new Date(clock()).toISOString());
      let text;
      try { text = JSON.parse(message.content)?.text; } catch { /* fail closed */ }
      return {messageId: message.messageId, chatId: message.chatId, senderAppId: message.senderAppId,
        deleted: message.deleted, checkedAt: message.checkedAt,
        exactTestMarker: typeof text === 'string' && text.startsWith('【联调测试｜WIS直播工作流】') &&
          digestBytes(message.content) === approval.contentSha256,
        approvalVerifiedExternally: message.chatId === approval.groupId && message.senderAppId === approval.appId};
    },
    async readBackup(first) { return read(signal => artifacts.readBackup(first, {signal})); },
    async readOaPage(first) { return read(signal => artifacts.readOaPage(first, {signal})); },
  });
  return {ops, async verifyUnchanged() {
    // Re-read actual official tabs, approved bindings and the full ledger
    // after all card/artifact GETs. Never replace their original timestamps
    // or quietly adopt newer state into this collection's signed snapshot.
    requireRead(sourceSheets && bindings && state, 'initial_read_incomplete');
    requireRead(same(await bridge('bindings'), bindings), 'bindings_changed_during_collection');
    requireRead(same(await readSheets(), sourceSheets), 'source_changed_during_collection');
    requireRead(same(await bridge('state'), state), 'ledger_changed_during_collection');
  }, async drain() {
    while (pending.size) await Promise.allSettled([...pending]);
    requireRead(queue.length === 0 && active === 0, 'read_drain_incomplete');
  }};
}

export async function createTrustedReadOps(inputPaths) {
  // No transport or clock injection on the live entry point. Offline tests use
  // composeReadOps directly and are explicitly not live proof or authorization.
  requireRead(inputPaths && Object.keys(inputPaths).every(key =>
    ['policyPath', 'pinnedPolicySha256', 'topologyPinPath', 'artifactConfigPath'].includes(key)),
  'live_adapter_unexpected_option');
  const inputs = await loadTrustedInputs(inputPaths), {policy, topologyPin, artifacts} = inputs;
  requireRead(process.platform === 'linux', 'live_reader_requires_linux_host');
  return Object.freeze({policy, async collect({mode = 'preview'} = {}) {
    requireRead(['preview', 'activation', 'renewal'].includes(mode), 'collection_mode_invalid');
    const started = Date.now(), controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 90000);
    let evidence, runtime;
    try {
      runtime = composeReadOps({policy,
        topology: createDockerTopologyReader({pin: topologyPin, policy, clock: Date.now}),
        artifacts: createArtifactReaders({policy, artifacts, clock: Date.now}),
        hub: createHubReadBridge({policy}), bot: createBotReadClient({expectedBotOpenId: policy.botOpenId}),
        signal: controller.signal});
      await inputs.recheck();
      evidence = await collectReadOnlyEvidence({ops: runtime.ops, policy, now: started, concurrency: 4});
      await runtime.drain();
      try {
        await runtime.verifyUnchanged();
        const last = await runtime.ops.readTopology();
        const projection = value => {
          const gateway = value?.gateway || {}, roles = ['hub', 'calendar', 'dispatch'];
          return {gateway: {id: gateway.id, image: gateway.image, status: gateway.status,
            health: gateway.health, routes: gateway.routes, configHash: gateway.configHash},
          services: Object.fromEntries(roles.map(key => {
            const role = value?.services?.[key] || {};
            return [key, {id: role.id, image: role.image, status: role.status, health: role.health,
              startedAt: role.startedAt, release: role.release, liveNextDayInstance: role.liveNextDayInstance,
              dataMount: role.dataMount, runningRwWriters: role.runningRwWriters,
              dormantAutoRestartRw: role.dormantAutoRestartRw, dormantRwContainers: role.dormantRwContainers}];
          }))};
        };
        requireRead(same(projection(last), projection(evidence.environment)), 'final_topology_drift');
      } catch (error) {
        evidence.collectorIssues.push('trusted_final_read:' + (/^[a-z0-9_]{1,80}$/u.test(error?.code || '')
          ? error.code : 'trusted_final_read_failed'));
      }
      await runtime.drain();
      await inputs.recheck();
      if (controller.signal.aborted) evidence.collectorIssues.push('trusted_round_budget_exceeded');
      // The *finished* clock, not collection start, controls all freshness and
      // Shanghai activation-window gates. No signing or sending occurs here.
      const closed = finalizeDiagnosticEvidence(evidence, {policy, mode, now: Date.now()});
      return {...closed, policy};
    } finally {
      controller.abort(); clearTimeout(deadline); if (runtime) await runtime.drain();
    }
  }});
}
