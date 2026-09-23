import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
test('live entry remains visible and points to current same-origin production module',()=>{
 const source=readFileSync(new URL('../src/data.ts',import.meta.url),'utf8');
 const live=source.slice(source.indexOf('id: "live-room-management"'));
 assert.match(source,/VITE_HUB_PUBLIC_BASE_PATH \|\| "\/yxb\/wis-marketing-hub\/"/);
 assert.match(live,/status: "beta"/);assert.match(live,/url: modulePath\("live-room-management\/"\)/);
 assert.doesNotMatch(live,/status: "building"/);
});
test('index identity, Brotli and gzip variants select exactly the same current build',()=>{
 const source=readFileSync(new URL('../dist/index.html',import.meta.url));
 assert.deepEqual(brotliDecompressSync(readFileSync(new URL('../dist/index.html.br',import.meta.url))),source);
 assert.deepEqual(gunzipSync(readFileSync(new URL('../dist/index.html.gz',import.meta.url))),source);
});
test('embedded layout remains imported after base styles and uses the available width',()=>{
 const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
 assert.ok(main.indexOf('import "./embedded-module.css"')>main.indexOf('import "./styles.css"'));
 const css=readFileSync(new URL('../src/embedded-module.css',import.meta.url),'utf8');
 assert.match(css,/\.embedded-module-frame\s*\{[^}]*width:\s*100%/);
 assert.match(css,/\.hub-module-active \.hub-shell\s*\{[^}]*height:\s*100dvh/);
});
