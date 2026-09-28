// Release-side inputs are approved independently of the evidence being read.
// Loading this file does not constitute approval, sign a permit or edit it.
import {open, lstat, realpath} from 'node:fs/promises';
import {resolve, parse, join} from 'node:path';
import {createHash} from 'node:crypto';

export const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export const digestJson = value => digestBytes(JSON.stringify(value));
export const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const requireRead = (condition, code) => {
  if (!condition) throw Object.assign(new Error('Read-only acceptance unavailable'), {code});
};
export function freezeInput(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeInput);
    Object.freeze(value);
  }
  return value;
}

// Inspect every existing ancestor, not just the final leaf. The independent
// pin protects bytes; a file descriptor protects an individual read from a
// path replacement. Fresh evidence cannot silently replace approved inputs.
export async function readPinnedJson(path, expectedDigest, {maxBytes = 1024 * 1024} = {}) {
  requireRead(typeof path === 'string' && path.length > 0 && validDigest(expectedDigest) &&
    Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1024 * 1024, 'input_pin_missing');
  const absolute = resolve(path), root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    requireRead(!stat.isSymbolicLink(), 'input_symlink');
  }
  requireRead(resolve(await realpath(absolute)) === absolute, 'input_path_alias');
  const handle = await open(absolute, 'r');
  try {
    const before = await handle.stat();
    requireRead(before.isFile() && before.size > 0 && before.size <= maxBytes, 'input_size_invalid');
    const buffer = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const {bytesRead} = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break; count += bytesRead;
    }
    const bytes = buffer.subarray(0, count);
    const after = await handle.stat();
    requireRead(bytes.length === before.size && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'input_changed_during_read');
    requireRead(digestBytes(bytes) === expectedDigest, 'input_digest_mismatch');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { requireRead(false, 'input_json_invalid'); }
    requireRead(value && typeof value === 'object' && !Array.isArray(value), 'input_object_required');
    return freezeInput(value);
  } finally { await handle.close(); }
}

export async function loadTrustedInputs({policyPath, pinnedPolicySha256, topologyPinPath, artifactConfigPath}) {
  const paths = [policyPath, topologyPinPath, artifactConfigPath];
  requireRead(paths.every(x => typeof x === 'string' && x.length) &&
    new Set(paths.map(x => resolve(x))).size === 3, 'independent_input_paths_required');
  const policy = await readPinnedJson(policyPath, pinnedPolicySha256);
  requireRead(validDigest(policy.topologyPinSha256) && validDigest(policy.artifactConfigSha256) &&
    validDigest(policy.participantFileSha256) && policy.moduleHashes && typeof policy.moduleHashes === 'object',
  'adapter_input_pins_missing');
  const topologyPin = await readPinnedJson(topologyPinPath, policy.topologyPinSha256);
  const artifacts = await readPinnedJson(artifactConfigPath, policy.artifactConfigSha256);
  // These pins came from the frozen policy, never a field inside the evidence.
  return {policy, topologyPin, artifacts, async recheck() {
    await readPinnedJson(policyPath, pinnedPolicySha256);
    await readPinnedJson(topologyPinPath, policy.topologyPinSha256);
    await readPinnedJson(artifactConfigPath, policy.artifactConfigSha256);
  }};
}
