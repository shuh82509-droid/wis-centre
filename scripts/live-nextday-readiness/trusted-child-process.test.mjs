// Local isolated transport fixtures only. No actual Docker/Lark process is
// launched. Linux cases spawn fresh Node groups, never signal a business PID.
// Detached/session-escaping descendants and Docker daemon exec are NOT proved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runReadChild} from './trusted-child-process.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const gone = pid => {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
};
const rejectCode = (fn, code) => assert.rejects(fn, error => error.code === code);
function mock({pid = 123456, closeCode = 137} = {}) {
  const child = new EventEmitter();
  child.pid = pid; child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new PassThrough(); child.kill = () => true;
  return {child, close: () => child.emit('close', closeCode), spawn: (...args) => {
    child.invocation = args; return child;
  }};
}

test('Linux abort targets only the fresh detached private group and waits for group ESRCH after client close', async () => {
  const fixture = mock(), controller = new AbortController(), calls = [];
  let groupExists = true, settled = false;
  const pending = runReadChild('lark-cli', ['fixture'], {platform: 'linux', signal: controller.signal,
    maxBytes: 100, spawnImpl: fixture.spawn, killImpl: (pid, signal) => {
      calls.push([pid, signal]);
      if (signal === 0 && !groupExists) throw Object.assign(new Error('gone'), {code: 'ESRCH'});
      return true;
    }}).finally(() => { settled = true; });
  assert.equal(fixture.child.invocation[2].detached, true);
  assert.equal(fixture.child.invocation[2].shell, false);
  controller.abort(); fixture.close(); await delay(25); assert.equal(settled, false);
  groupExists = false; await rejectCode(() => pending, 'read_aborted');
  assert.ok(calls.some(([, signal]) => signal === 'SIGKILL'));
  assert.ok(calls.every(([pid]) => pid === -123456));
});

test('zero-exit leader with lingering group is killed and cannot return successful output', async () => {
  const fixture = mock({closeCode: 0}); let groupExists = true, kills = 0;
  const pending = runReadChild('docker', [], {platform: 'linux', maxBytes: 100,
    spawnImpl: fixture.spawn, killImpl: (pid, signal) => {
      assert.equal(pid, -123456);
      if (signal === 'SIGKILL') { kills++; groupExists = false; }
      else if (!groupExists) throw Object.assign(new Error('gone'), {code: 'ESRCH'});
      return true;
    }});
  fixture.child.stdout.write('must-not-return'); fixture.close();
  await rejectCode(() => pending, 'read_process_descendants_alive'); assert.equal(kills, 1);
});

test('permission failure or missing close produces bounded lifetime-unknown, never fake drainage', async () => {
  for (const permissionDenied of [true, false]) {
    const fixture = mock(), controller = new AbortController();
    const pending = runReadChild('docker', [], {platform: 'linux', maxBytes: 100,
      signal: controller.signal, spawnImpl: fixture.spawn, killImpl: () => {
        if (permissionDenied) throw Object.assign(new Error('denied'), {code: 'EPERM'});
        return true;
      }});
    controller.abort(); if (permissionDenied) fixture.close();
    await rejectCode(() => pending, 'read_process_lifetime_unproven');
  }
});

test('non-Linux cancellation remains direct-client only and never sends a negative PID', async () => {
  const fixture = mock(), controller = new AbortController(); let kills = 0;
  fixture.child.kill = signal => { assert.equal(signal, 'SIGKILL'); kills++; return true; };
  const pending = runReadChild('lark-cli', [], {platform: 'win32', signal: controller.signal,
    maxBytes: 100, spawnImpl: fixture.spawn, killImpl: () => assert.fail('no Linux group signal')});
  assert.equal(fixture.child.invocation[2].detached, false);
  controller.abort(); fixture.close(); await rejectCode(() => pending, 'read_aborted'); assert.equal(kills, 1);
});

test('pre-abort cannot spawn or signal, and successful Linux read requires kernel group absence', async () => {
  const controller = new AbortController(); controller.abort();
  await rejectCode(() => runReadChild('lark-cli', [], {platform: 'linux', signal: controller.signal,
    maxBytes: 10, spawnImpl: () => assert.fail('no spawn'), killImpl: () => assert.fail('no signal')}), 'read_aborted');
  const fixture = mock({closeCode: 0});
  const pending = runReadChild('lark-cli', [], {platform: 'linux', maxBytes: 100,
    spawnImpl: fixture.spawn, killImpl: (pid, signal) => {
      assert.equal(pid, -123456); assert.equal(signal, 0);
      throw Object.assign(new Error('gone'), {code: 'ESRCH'});
    }});
  fixture.child.stdout.write('successful'); fixture.close(); assert.equal(await pending, 'successful');
});

async function isolatedFixture(t, mode) {
  const root = await mkdtemp(join(tmpdir(), 'wis-owned-process-group-'));
  const path = join(root, 'owned-pids.json'); let leader;
  const script = `const fs=require('node:fs'),{spawn}=require('node:child_process');
const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(path)},JSON.stringify({leader:process.pid,descendant:descendant.pid}));
${mode === 'zero-exit' ? "process.stdout.write('output');process.exit(0);"
  : mode === 'overflow' ? "process.stdout.write('x'.repeat(1000));setInterval(()=>{},1000);"
    : "process.stdout.write('ready');setInterval(()=>{},1000);"}`;
  const spawnImpl = (program, args, options) => {
    assert.ok(['docker', 'lark-cli'].includes(program)); assert.equal(options.detached, true);
    const child = spawn(process.execPath, ['-e', script], options); leader = child.pid; return child;
  };
  t.after(async () => {
    // This PGID was freshly created by this fixture, within the isolated PID
    // namespace. No caller-supplied or pre-existing PID is ever a signal target.
    if (leader) { try { process.kill(-leader, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await rm(root, {recursive: true, force: true});
  });
  const pids = async () => {
    for (let i = 0; i < 200; i++) {
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await delay(10); }
    }
    assert.fail('isolated fixture did not record its own PIDs');
  };
  return {spawnImpl, pids};
}

test('Linux real private group abort terminates Node leader and grandchild before rejection',
  {skip: process.platform !== 'linux'}, async t => {
    const fixture = await isolatedFixture(t, 'abort'), controller = new AbortController();
    const pending = runReadChild('lark-cli', [], {spawnImpl: fixture.spawnImpl, signal: controller.signal,
      maxBytes: 100, timeoutMs: 5000});
    const pids = await fixture.pids(); assert.equal(gone(pids.leader), false); assert.equal(gone(pids.descendant), false);
    controller.abort(); await rejectCode(() => pending, 'read_aborted');
    assert.equal(gone(pids.leader), true); assert.equal(gone(pids.descendant), true);
  });

for (const [mode, code] of [['timeout', 'read_process_failed'], ['overflow', 'read_process_failed'],
  ['zero-exit', 'read_process_descendants_alive']])
  test('Linux real private group ' + mode + ' cannot leave a descendant running',
    {skip: process.platform !== 'linux'}, async t => {
      const fixture = await isolatedFixture(t, mode);
      const pending = runReadChild('docker', [], {spawnImpl: fixture.spawnImpl,
        maxBytes: mode === 'overflow' ? 16 : 100, timeoutMs: mode === 'timeout' ? 1000 : 5000});
      // Install the rejection handler before the intentionally fast failures.
      const rejected = rejectCode(() => pending, code), pids = await fixture.pids();
      await rejected; assert.equal(gone(pids.leader), true); assert.equal(gone(pids.descendant), true);
    });

test('Linux real successful short read completes without group signals or external commands',
  {skip: process.platform !== 'linux'}, async () => {
    const output = await runReadChild('lark-cli', [], {maxBytes: 100,
      spawnImpl: (program, args, options) => spawn(process.execPath, ['-e', "process.stdout.write('isolated-ok')"], options)});
    assert.equal(output, 'isolated-ok');
  });
