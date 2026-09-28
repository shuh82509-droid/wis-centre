// Concrete bot-only CLI transport. Fixed typed read commands, not arbitrary
// URLs/verbs. CLI owns the already-authorized app's tenant credential in memory;
// this adapter cannot obtain/refresh a user OAuth grant, send IM or add scopes.
import {requireRead} from './trusted-policy.mjs';
import {runReadChild} from './trusted-child-process.mjs';

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
