import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import {tmpdir,hostname} from 'node:os';import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'wis-lock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return new WorkflowStore(join(dir,'tasks.json'));}
test('已退出进程的锁安全归档后恢复同一任务库',t=>{const s=fixture(t);s.transaction(v=>{v.testValue=42;return true;});writeFileSync(s.file+'.lock',JSON.stringify({host:hostname(),pid:2147483647}));s.transaction(v=>{assert.equal(v.testValue,42);v.testValue++;return true;});assert.equal(s.read().testValue,43);assert.ok(readdirSync(join(s.file,'..')).some(n=>n.includes('.recovered.')));});
test('活跃进程、未知容器和不完整锁不会被自动删除',t=>{const s=fixture(t);for(const owner of [{host:hostname(),pid:process.pid},{host:'unknown-container',pid:2147483647},null]){const content=owner?JSON.stringify(owner):'';writeFileSync(s.file+'.lock',content);assert.throws(()=>s.transaction(()=>true),e=>e.status===503);assert.equal(readFileSync(s.file+'.lock','utf8'),content);}});
