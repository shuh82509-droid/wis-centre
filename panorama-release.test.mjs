import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {gunzipSync,brotliDecompressSync} from 'node:zlib';
const file=new URL('./dist/workflow-panorama/index.html',import.meta.url);
const html=readFileSync(file,'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const parse=source=>spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'});
test('published panorama module parses, including the task deep-link entry',()=>{
 assert.equal(scripts.length,1);
 const r=parse(scripts[0]);assert.equal(r.status,0,r.stderr);
 assert.equal((scripts[0].match(/const flowRoute=/g)||[]).length,1);
 assert.ok(scripts[0].includes("new URLSearchParams(location.search).get('task')"));
});
test('syntax acceptance rejects a duplicate route declaration',()=>{
 const r=parse(scripts[0]+'\nconst flowRoute=null;');assert.notEqual(r.status,0);assert.match(r.stderr,/already been declared/);
});
test('published gzip panorama is identical to verified HTML',()=>assert.equal(gunzipSync(readFileSync(new URL(file.href+'.gz'))).toString(),html));
test('published brotli panorama is identical to verified HTML',()=>assert.equal(brotliDecompressSync(readFileSync(new URL(file.href+'.br'))).toString(),html));
