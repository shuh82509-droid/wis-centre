// Internal transport primitive. Callers supply fixed read-only argument lists.
// Cancellation is not complete until the killed subprocess has actually closed.
import {spawn} from 'node:child_process';
import {requireRead} from './trusted-policy.mjs';

export function runReadChild(program, args, {input, signal, maxBytes, timeoutMs = 10000,
  spawnImpl = spawn} = {}) {
  requireRead(['docker', 'lark-cli'].includes(program) && Array.isArray(args) &&
    args.every(x => typeof x === 'string') && Number.isInteger(maxBytes) && maxBytes > 0 &&
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000,
  'read_transport_options_invalid');
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('Read unavailable'), {code: 'read_aborted'}));
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(program, args, {shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}); }
    catch { reject(Object.assign(new Error('Read unavailable'), {code: 'read_process_failed'})); return; }
    let chunks = [], length = 0, failed = false, aborted = false, settled = false;
    const stop = () => { failed = true; child.kill('SIGKILL'); };
    const onAbort = () => { aborted = true; stop(); };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) onAbort();
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > maxBytes) { chunks = []; stop(); } else if (!failed) chunks.push(Buffer.from(chunk));
    });
    child.stderr.resume();
    child.stdin.on('error', () => { failed = true; });
    child.on('error', () => { failed = true; });
    child.on('close', code => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (failed || aborted || code !== 0) reject(Object.assign(new Error('Read unavailable'), {
        code: aborted ? 'read_aborted' : 'read_process_failed'}));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(input);
  });
}
