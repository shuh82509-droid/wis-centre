// Internal transport primitive. Callers supply fixed read-only argument lists.
// On Linux each read owns a private session/process group. Cancellation kills
// that group, then requires direct-client close AND kernel ESRCH for the group.
// This covers descendants that remain in the group, not setsid escapees or a
// Docker daemon-side exec. Those gaps remain a release-side NO-GO elsewhere.
import {spawn} from 'node:child_process';
import {requireRead} from './trusted-policy.mjs';

export function runReadChild(program, args, {input, signal, maxBytes, timeoutMs = 10000,
  spawnImpl = spawn, platform = process.platform,
  killImpl = (pid, kind) => process.kill(pid, kind)} = {}) {
  requireRead(['docker', 'lark-cli'].includes(program) && Array.isArray(args) &&
    args.every(x => typeof x === 'string') && Number.isInteger(maxBytes) && maxBytes > 0 &&
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000,
  'read_transport_options_invalid');
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('Read unavailable'), {code: 'read_aborted'}));
  return new Promise((resolve, reject) => {
    let child;
    const linux = platform === 'linux';
    try { child = spawnImpl(program, args, {shell: false, windowsHide: true,
      detached: linux, stdio: ['pipe', 'pipe', 'pipe']}); }
    catch { reject(Object.assign(new Error('Read unavailable'), {code: 'read_process_failed'})); return; }
    // Only the freshly spawned detached leader's PID can be a group target.
    // A mock with no PID has only direct-client semantics, never group proof.
    const pgid = linux && Number.isSafeInteger(child.pid) && child.pid > 1 && child.pid !== process.pid
      ? child.pid : null;
    let chunks = [], length = 0, failed = false, aborted = false, settled = false, closed = false;
    let cleanupTimer, groupPoll, lifetimeUnknown = false, leftover = false;
    const finish = code => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(cleanupTimer); clearTimeout(groupPoll);
      signal?.removeEventListener('abort', onAbort);
      if (code) { chunks = []; reject(Object.assign(new Error('Read unavailable'), {code})); }
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const beginCleanupDeadline = () => {
      // Do not report successful drainage when SIGKILL/close cannot be proved.
      // A bounded unknown failure is distinct from a confirmed terminated read.
      cleanupTimer ??= setTimeout(() => finish('read_process_lifetime_unproven'), 2000);
    };
    const groupGone = () => {
      try { killImpl(-pgid, 0); return false; }
      catch (error) { if (error.code === 'ESRCH') return true; lifetimeUnknown = true; return false; }
    };
    const killOwnedProcesses = () => {
      try {
        if (pgid !== null) killImpl(-pgid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) { if (error.code !== 'ESRCH') lifetimeUnknown = true; }
    };
    const stop = () => {
      if (settled) return;
      failed = true; chunks = []; beginCleanupDeadline(); killOwnedProcesses();
    };
    const onAbort = () => { aborted = true; stop(); };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) onAbort();
    child.stdout.on('data', chunk => {
      if (settled || failed) return;
      length += chunk.length;
      if (length > maxBytes) { chunks = []; stop(); } else if (!failed) chunks.push(Buffer.from(chunk));
    });
    child.stderr.resume();
    child.stdin.on('error', stop);
    child.on('error', stop);
    child.on('close', code => {
      if (settled || closed) return; closed = true;
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      failed ||= code !== 0;
      const complete = () => finish(lifetimeUnknown ? 'read_process_lifetime_unproven'
        : aborted ? 'read_aborted' : leftover ? 'read_process_descendants_alive'
          : failed ? 'read_process_failed' : null);
      if (pgid === null || groupGone()) { complete(); return; }
      // Even a zero-exit leader must not leave a live local group behind.
      // Requiring ESRCH is deliberately stricter than ignoring zombie members.
      leftover = !failed; failed = true; chunks = [];
      beginCleanupDeadline(); killOwnedProcesses();
      const poll = () => {
        if (settled) return;
        if (groupGone()) { complete(); return; }
        groupPoll = setTimeout(poll, 10);
      };
      poll();
    });
    try { child.stdin.end(input); } catch { stop(); }
  });
}
