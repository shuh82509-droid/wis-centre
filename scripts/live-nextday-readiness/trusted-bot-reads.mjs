// Concrete bot-only CLI transport. Fixed typed read commands, not arbitrary
// URLs/verbs. CLI owns the already-authorized app's tenant credential in memory;
// this adapter cannot obtain/refresh a user OAuth grant, send IM or add scopes.
import {requireRead} from './trusted-policy.mjs';
import {runReadChild} from './trusted-child-process.mjs';
import {constants} from 'node:fs';
import {mkdtemp, open, realpath, lstat, unlink, rmdir} from 'node:fs/promises';
import {join, relative, resolve, isAbsolute} from 'node:path';

const messageId = value => /^om_[A-Za-z0-9_-]+$/u.test(value || '');
const chatId = value => /^oc_[A-Za-z0-9_-]+$/u.test(value || '');
const openId = value => /^ou_[a-z0-9]+$/u.test(value || '');
const SHEETS = new Set(['NYB2iu', 'MVpDv0', 'LRAvIU', 'PhlV42']);
const cursorValid = value => typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f]/u.test(value);

export function botReadCommand(kind, id, cursor = '') {
  requireRead(cursorValid(cursor), 'bot_cursor_invalid');
  const paging = ['--page-size', '100', ...(cursor ? ['--page-token', cursor] : [])];
  let args;
  switch (kind) {
    case 'message':
      requireRead(messageId(id) && !cursor, 'bot_message_scope_invalid');
      // The shortcut mget expands thread replies even with --no-reactions.
      // This native single-message GET never follows threads or downloads.
      args = ['api', 'GET', '/open-apis/im/v1/messages/' + id,
        '--params', JSON.stringify({user_id_type: 'open_id', card_msg_content_type: 'user_card_content'})]; break;
    case 'chat':
      requireRead(chatId(id) && !cursor, 'bot_chat_scope_invalid');
      args = ['im', 'chats', 'get', '--chat-id', id, '--user-id-type', 'open_id']; break;
    case 'members':
      requireRead(chatId(id), 'bot_member_scope_invalid');
      args = ['im', 'chat.members', 'get', '--chat-id', id, '--member-id-type', 'open_id',
        '--check-security-conf', ...paging]; break;
    case 'read_users':
      requireRead(messageId(id), 'bot_read_users_scope_invalid');
      args = ['im', 'messages', 'read_users', '--message-id', id, '--user-id-type', 'open_id', ...paging]; break;
    case 'bots':
      requireRead(chatId(id) && !cursor, 'bot_list_scope_invalid');
      args = ['im', 'chat.members', 'bots', '--chat-id', id]; break;
    case 'user':
      requireRead(openId(id) && !cursor, 'bot_user_scope_invalid');
      args = ['api', 'GET', '/open-apis/contact/v3/users/' + id, '--params',
        JSON.stringify({user_id_type: 'open_id', department_id_type: 'open_department_id'})]; break;
    case 'bot_info':
      requireRead(id === undefined && !cursor, 'bot_identity_scope_invalid');
      args = ['api', 'GET', '/open-apis/bot/v3/info']; break;
    case 'sheet':
      requireRead(SHEETS.has(id) && !cursor, 'bot_sheet_scope_invalid');
      // This exact native values endpoint is the one used by the formal
      // official reader. Only these four A:Q tabs in the approved workbook.
      args = ['api', 'GET', '/open-apis/sheets/v2/spreadsheets/EuYqssm4WhNwAvtyybKcDdk1ned/values/' +
        encodeURIComponent(id + '!A:Q'), '--params', JSON.stringify({
          valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString'})]; break;
    default: requireRead(false, 'bot_operation_forbidden');
  }
  return [...args, '--as', 'bot', '--format', 'json'];
}

export async function executeBotCommand(args, {signal} = {}) {
  // A raw helper cannot be used to bypass the default read-only boundary.
  validateBotReadArguments(args);
  requireRead(process.platform === 'linux', 'live_reader_requires_linux_host');
  if (args[2] === '/open-apis/bot/v3/info') return readBotIdentityRawExport({signal});
  const stdout = await runReadChild('lark-cli', args, {signal, maxBytes: 32 * 1024 * 1024});
  let envelope;
  try { envelope = JSON.parse(stdout); }
  catch { requireRead(false, 'bot_json_invalid'); }
  // A different CLI profile/user success is not the authorized bot proof.
  requireRead(envelope?.ok === true && envelope.identity === 'bot',
    Number.isInteger(envelope?.error?.code) ? 'bot_api_' + envelope.error.code : 'bot_identity_or_api_failed');
  const data = envelope.data;
  if (Number.isInteger(data?.code)) {
    requireRead(data.code === 0, 'bot_api_' + data.code);
    return data.data ?? data;
  }
  return data;
}

// CLI 1.0.80's SuccessEnvelopeData drops API fields outside `data`, whereas
// bot/v3/info returns top-level `bot`. Its documented --output preserves the
// original response and keeps credential handling inside the CLI. Only this
// fixed metadata GET uses a private temporary export; no credential is saved.
// The runner/baseDirectory seams are fixtures, never live-factory options.
export async function readBotIdentityRawExport({signal, runner = runReadChild,
  baseDirectory = process.cwd()} = {}) {
  requireRead(!signal?.aborted, 'bot_identity_read_aborted');
  const base = await realpath(baseDirectory), baseScope = relative(await realpath(process.cwd()), base);
  requireRead(!isAbsolute(baseScope) && !baseScope.startsWith('..'), 'bot_identity_export_scope_invalid');
  const directory = await mkdtemp(join(base, '.wis-bot-info-'));
  const target = join(directory, 'response.json'), output = relative(process.cwd(), target);
  let handle, directoryPin;
  const directoryUnchanged = async () => {
    try {
      const current = await lstat(directory);
      return directoryPin && current.isDirectory() && !current.isSymbolicLink() &&
        current.dev === directoryPin.dev && current.ino === directoryPin.ino &&
        await realpath(directory) === directory;
    } catch { return false; }
  };
  try {
    directoryPin = await lstat(directory);
    requireRead(await directoryUnchanged(), 'bot_identity_export_directory_changed');
    requireRead(output && !isAbsolute(output) && !output.startsWith('..') && !output.includes('\u0000'),
      'bot_identity_export_scope_invalid');
    const text = await runner('lark-cli', [...botReadCommand('bot_info'), '--output', output],
      {signal, maxBytes: 65536});
    let metadata; try { metadata = JSON.parse(text); } catch { requireRead(false, 'bot_identity_export_metadata_invalid'); }
    requireRead(metadata && typeof metadata.saved_path === 'string' &&
      resolve(process.cwd(), metadata.saved_path) === target &&
      /^application\/json(?:;\s*charset=utf-8)?$/iu.test(metadata.content_type || '') &&
      Number.isSafeInteger(metadata.size_bytes) && metadata.size_bytes > 0 && metadata.size_bytes <= 65536,
    'bot_identity_export_metadata_invalid');
    requireRead(await directoryUnchanged(), 'bot_identity_export_directory_changed');
    const before = await lstat(target);
    requireRead(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 &&
      before.size === metadata.size_bytes, 'bot_identity_export_file_invalid');
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const pinned = await handle.stat(), bytes = Buffer.alloc(before.size + 1); let offset = 0;
    requireRead(pinned.dev === before.dev && pinned.ino === before.ino && pinned.size === before.size,
      'bot_identity_export_changed');
    while (offset < bytes.length) {
      requireRead(!signal?.aborted, 'bot_identity_read_aborted');
      const chunk = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!chunk.bytesRead) break; offset += chunk.bytesRead;
    }
    const after = await handle.stat(), named = await lstat(target);
    requireRead(offset === before.size && named.isFile() && !named.isSymbolicLink() && named.nlink === 1 &&
      [after, named].every(s => s.dev === pinned.dev && s.ino === pinned.ino && s.size === pinned.size &&
        s.mtimeMs === pinned.mtimeMs && s.ctimeMs === pinned.ctimeMs), 'bot_identity_export_changed');
    let response; try { response = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, offset))); }
    catch { requireRead(false, 'bot_identity_export_json_invalid'); }
    requireRead(!signal?.aborted, 'bot_identity_read_aborted');
    requireRead(response?.code === 0 && response.bot && openId(response.bot.open_id) &&
      Number.isSafeInteger(response.bot.activate_status), 'bot_identity_native_proof_invalid');
    // Do not retain avatar, app name, IP whitelist or any unrelated field.
    return {bot: {open_id: response.bot.open_id, activate_status: response.bot.activate_status}};
  } finally {
    await handle?.close();
    // Never follow a replaced directory even when an earlier guard/runner
    // failed. Exact pathname checks reduce this mutation hazard; they are not
    // an atomic dirfd/openat proof and do not remove the fixed release NO-GO.
    requireRead(await directoryUnchanged(), 'bot_identity_export_directory_changed');
    try { await unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireRead(await directoryUnchanged(), 'bot_identity_export_directory_changed');
    await rmdir(directory);
  }
}

export function validateBotReadArguments(args) {
  requireRead(Array.isArray(args) && args.every(x => typeof x === 'string'), 'bot_argv_forbidden');
  const body = args.slice(0, -4); let kind, id, cursor = '';
  if (body[0] === 'api' && body[1] === 'GET') {
    if (body[2] === '/open-apis/bot/v3/info') kind = 'bot_info';
    else if (body[2]?.startsWith('/open-apis/im/v1/messages/')) {kind = 'message'; id = body[2].split('/').at(-1);}
    else if (body[2]?.startsWith('/open-apis/contact/v3/users/')) {kind = 'user'; id = body[2].split('/').at(-1);}
    else {kind = 'sheet'; id = [...SHEETS].find(sheet =>
      body[2] === '/open-apis/sheets/v2/spreadsheets/EuYqssm4WhNwAvtyybKcDdk1ned/values/' + encodeURIComponent(sheet + '!A:Q'));}
  } else if (body[0] === 'im') {
    if (body[1] === 'chats' && body[2] === 'get') kind = 'chat';
    else if (body[1] === 'chat.members' && body[2] === 'get') kind = 'members';
    else if (body[1] === 'chat.members' && body[2] === 'bots') kind = 'bots';
    else if (body[1] === 'messages' && body[2] === 'read_users') kind = 'read_users';
    id = body[4];
    if (body.includes('--page-token')) cursor = body[body.indexOf('--page-token') + 1];
  }
  let canonical;
  try { canonical = botReadCommand(kind, id, cursor); } catch { requireRead(false, 'bot_argv_forbidden'); }
  requireRead(JSON.stringify(args) === JSON.stringify(canonical), 'bot_argv_forbidden');
}

export function createBotReadClient({expectedBotOpenId, execute = executeBotCommand} = {}) {
  requireRead(openId(expectedBotOpenId), 'actual_bot_identity_pin_missing');
  return Object.freeze({async read(kind, id, {cursor = '', signal} = {}) {
    const command = botReadCommand(kind, id, cursor);
    requireRead(kind !== 'bot_info', 'bot_identity_internal_only');
    // GET the actual current token owner's bot open_id before any scoped
    // business read. A bot-profile label or configured app name is not proof.
    const proof = await execute(botReadCommand('bot_info'), {signal});
    requireRead(proof?.bot?.open_id === expectedBotOpenId && proof.bot.activate_status === 2,
      'actual_bot_profile_mismatch');
    return execute(command, {signal});
  }});
}

export function normalizeBotMessage(data, requestedId, checkedAt) {
  requireRead(Array.isArray(data?.items) && data.items.length === 1, 'bot_message_incomplete');
  const row = data.items[0];
  requireRead(row.message_id === requestedId && messageId(row.message_id) && chatId(row.chat_id) &&
    row.sender?.sender_type === 'app' && row.sender.id_type === 'app_id' &&
    /^cli_[A-Za-z0-9]+$/u.test(row.sender?.id || ''),
  'bot_message_identity_mismatch');
  const content = row.body?.content ?? row.content;
  requireRead(typeof content === 'string' && content.length <= 1024 * 1024 &&
    typeof row.deleted === 'boolean' && typeof row.msg_type === 'string', 'bot_message_content_missing');
  return {messageId: row.message_id, chatId: row.chat_id, senderAppId: row.sender.id,
    msgType: row.msg_type, deleted: row.deleted, content, checkedAt};
}
