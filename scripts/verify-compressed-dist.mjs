import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
const root = resolve(process.argv[2] || 'dist');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir,e.name)) : [join(dir,e.name)]))).flat();
}
let checked = 0;
for (const path of await walk(root)) {
  const suffix = path.endsWith('.gz') ? '.gz' : path.endsWith('.br') ? '.br' : null;
  if (!suffix) continue;
  const plain = await readFile(path.slice(0, -suffix.length));
  const raw = await readFile(path);
  const decoded = suffix === '.gz' ? gunzipSync(raw) : brotliDecompressSync(raw);
  if (!plain.equals(decoded)) throw new Error(`Compressed asset differs from source: ${path}`);
  checked++;
}
console.log(JSON.stringify({compressedFilesChecked: checked, mismatches: 0}));
