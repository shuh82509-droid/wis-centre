import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir, mkdir, rename, lstat, unlink, rmdir, symlink} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {readBotIdentityRawExport, botReadCommand, createBotReadClient} from './trusted-bot-reads.mjs';

const botId = 'ou_fixturebot';
const proof = {code: 0, msg: 'ok', bot: {open_id: botId, activate_status: 2,
  app_name: 'must-not-retain', avatar_url: 'must-not-retain', ip_white_list: ['must-not-retain']}};
async function fixture(t, {body = proof, mutateMetadata, mutateFile, controller} = {}) {
  const directory = await mkdtemp(join(process.cwd(), '.wis-bot-test-'));
  t.after(async () => { assert.deepEqual(await readdir(directory), []); await rmdir(directory); });
  let calls = 0;
  const runner = async (program, args, options) => {
    calls++;
    assert.equal(program, 'lark-cli');
    assert.deepEqual(args.slice(0, -2), botReadCommand('bot_info'));
    assert.equal(args.at(-2), '--output');
    assert.equal(options.maxBytes, 65536);
    const target = resolve(process.cwd(), args.at(-1));
    assert.equal(dirname(dirname(target)), directory);
    const bytes = typeof body === 'string' ? body : JSON.stringify(body);
    await writeFile(target, bytes, {mode: 0o600});
    if (mutateFile) await mutateFile(target);
    const metadata = {content_type: 'application/json', saved_path: target, size_bytes: Buffer.byteLength(bytes)};
    if (mutateMetadata) mutateMetadata(metadata);
    if (controller) controller.abort();
    return JSON.stringify(metadata);
  };
  return {read: () => readBotIdentityRawExport({baseDirectory: directory, runner, signal: controller?.signal}),
    calls: () => calls, directory};
}

test('bot native raw metadata export preserves actual top-level identity and discards unrelated fields', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.read(), {bot: {open_id: botId, activate_status: 2}});
  assert.equal(f.calls(), 1);
  assert.deepEqual(await readdir(f.directory), []);
});

for (const [name, mutateMetadata] of [
  ['wrong output path', x => { x.saved_path = '/not-our-export'; }],
  ['missing output path', x => { delete x.saved_path; }],
  ['wrong content type', x => { x.content_type = 'text/html'; }],
  ['oversized response', x => { x.size_bytes = 65537; }],
  ['noninteger response size', x => { x.size_bytes = '263'; }],
]) test('native bot export rejects ' + name + ' and removes only its own temporary file', async t => {
  const f = await fixture(t, {mutateMetadata});
  await assert.rejects(f.read, e => e.code === 'bot_identity_export_metadata_invalid');
});

for (const [name, body, code] of [
  ['empty envelope data', {ok: true, identity: 'bot', data: {}}, 'bot_identity_native_proof_invalid'],
  ['failed native code', {...proof, code: 99991672}, 'bot_identity_native_proof_invalid'],
  ['missing bot', {code: 0, data: {}}, 'bot_identity_native_proof_invalid'],
  ['invalid open id', {...proof, bot: {open_id: 'user-not-bot', activate_status: 2}}, 'bot_identity_native_proof_invalid'],
  ['invalid activation type', {...proof, bot: {open_id: botId, activate_status: '2'}}, 'bot_identity_native_proof_invalid'],
  ['malformed JSON', '{', 'bot_identity_export_json_invalid'],
]) test('native bot export rejects ' + name + ' rather than guessing actual identity', async t => {
  const f = await fixture(t, {body});
  await assert.rejects(f.read, e => e.code === code);
});

test('export file size mismatch is not proof despite successful CLI metadata', async t => {
  const f = await fixture(t, {mutateFile: p => writeFile(p, JSON.stringify(proof) + ' ')});
  await assert.rejects(f.read, e => e.code === 'bot_identity_export_file_invalid');
});

test('abort after CLI closure rejects proof and still cleans the private export', async t => {
  const controller = new AbortController(), f = await fixture(t, {controller});
  await assert.rejects(f.read, e => e.code === 'bot_identity_read_aborted');
});

test('pre-aborted bot identity export creates no directory and sends no request', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => readBotIdentityRawExport({signal: controller.signal,
    runner: () => assert.fail('no request')}), e => e.code === 'bot_identity_read_aborted');
});

test('raw native proof still cannot substitute another or disabled bot before a resource GET', async () => {
  for (const bot of [{open_id: 'ou_otherbot', activate_status: 2}, {open_id: botId, activate_status: 0}]) {
    let calls = 0;
    const reader = createBotReadClient({expectedBotOpenId: botId, execute: async args => {
      calls++; assert.deepEqual(args, botReadCommand('bot_info')); return {bot};
    }});
    await assert.rejects(() => reader.read('user', 'ou_approvedperson'), e => e.code === 'actual_bot_profile_mismatch');
    assert.equal(calls, 1);
  }
});

async function directoryReplacementFixture(t, {symbolic = true, runnerFails = false} = {}) {
  const base = await mkdtemp(join(process.cwd(), '.wis-bot-directory-test-'));
  const outside = join(base, 'outside'), outsideTarget = join(outside, 'response.json');
  const moved = join(base, 'owned-export-moved'), movedTarget = join(moved, 'response.json');
  const outsideBytes = JSON.stringify({...proof, marker: 'outside-file-must-survive'});
  await mkdir(outside); await writeFile(outsideTarget, outsideBytes);
  let allocated;
  t.after(async () => {
    // Only this fixture's exact names are removed. The reader must leave the
    // mutated path and outside response untouched; there is no recursive rm.
    if (allocated) {
      const row = await lstat(allocated);
      if (row.isSymbolicLink()) await unlink(allocated);
      else { await unlink(join(allocated, 'response.json')); await rmdir(allocated); }
    }
    await unlink(movedTarget); await rmdir(moved);
    await unlink(outsideTarget); await rmdir(outside); await rmdir(base);
  });
  const runner = async (program, args) => {
    assert.equal(program, 'lark-cli');
    assert.deepEqual(args.slice(0, -2), botReadCommand('bot_info'));
    const target = resolve(process.cwd(), args.at(-1)); allocated = dirname(target);
    assert.equal(dirname(allocated), base);
    const bytes = JSON.stringify(proof); await writeFile(target, bytes);
    await rename(allocated, moved);
    if (symbolic) await symlink(outside, allocated, process.platform === 'win32' ? 'junction' : 'dir');
    else { await mkdir(allocated); await writeFile(target, outsideBytes); }
    if (runnerFails) throw Object.assign(new Error('isolated runner failure'), {code: 'read_process_failed'});
    return JSON.stringify({content_type: 'application/json', saved_path: target, size_bytes: Buffer.byteLength(bytes)});
  };
  return {read: () => readBotIdentityRawExport({baseDirectory: base, runner}),
    allocated: () => allocated, outsideTarget, movedTarget, outsideBytes};
}

for (const runnerFails of [false, true])
  test('replaced symlink/junction directory is never followed by cleanup' + (runnerFails ? ' after runner failure' : ''), async t => {
    const f = await directoryReplacementFixture(t, {runnerFails});
    await assert.rejects(f.read, e => e.code === 'bot_identity_export_directory_changed');
    assert.equal(await readFile(f.outsideTarget, 'utf8'), f.outsideBytes);
    assert.equal((await lstat(f.allocated())).isSymbolicLink(), true);
    assert.equal(await readFile(f.movedTarget, 'utf8'), JSON.stringify(proof));
  });

test('same canonical pathname with a different directory inode cannot be read or cleaned', async t => {
  const f = await directoryReplacementFixture(t, {symbolic: false});
  await assert.rejects(f.read, e => e.code === 'bot_identity_export_directory_changed');
  assert.equal(await readFile(f.outsideTarget, 'utf8'), f.outsideBytes);
  assert.equal(await readFile(join(f.allocated(), 'response.json'), 'utf8'), f.outsideBytes);
  assert.equal(await readFile(f.movedTarget, 'utf8'), JSON.stringify(proof));
});
