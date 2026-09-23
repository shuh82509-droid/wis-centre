import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+\.(?:js|css))"/g)].map((match) => match[1]);
if (!assets.some((asset) => asset.endsWith('.js')) || !assets.some((asset) => asset.endsWith('.css'))) {
  throw new Error('Built entry is missing its JavaScript or CSS asset.');
}
for (const asset of assets) {
  if (!existsSync(join(dist, asset))) throw new Error(`Built entry references missing asset: ${asset}`);
}

// Import each preloaded vendor chunk in a fresh process. A successful static
// build can still contain cross-chunk ESM cycles that throw before React mounts.
const preloads = [...html.matchAll(/<link\s+rel="modulepreload"[^>]*href="(\.\/assets\/[^\"]+\.js)"/g)]
  .map((match) => match[1]);
for (const asset of preloads) {
  const url = pathToFileURL(join(dist, asset)).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', url], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.error || '').slice(-1_500);
    throw new Error(`Built vendor chunk failed to initialize: ${asset}\n${detail}`);
  }
}
console.log(JSON.stringify({ assetsChecked: assets.length, vendorChunksImported: preloads.length }));
