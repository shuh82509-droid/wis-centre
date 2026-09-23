import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const vendor=['vendor/sha256.umd.min.js','vendor/md5.umd.min.js'].map(read).join('\n');
const digest=(kind,b)=>createHash(kind).update(b).digest('hex');
function context(){const c=vm.createContext({Blob,Uint8Array,ArrayBuffer,TextEncoder,WebAssembly,DOMException,URL,AbortController,setTimeout,clearTimeout});c.self=c;vm.runInContext(vendor,c);return c;}
for(const [size,part] of [[3,2],[8*1024*1024+17,1024*1024+3],[6*1024*1024,3*1024*1024]])test('Worker 和主线程的完整 SHA 与逐片 MD5 一致：'+size+'/'+part,async()=>{
 const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*17+3)%251;const file=new Blob([bytes]);
 const expected=[];for(let p=0;p<size;p+=part)expected.push(digest('md5',bytes.subarray(p,p+part)));
 const c=context(),messages=[];c.postMessage=x=>messages.push(x);vm.runInContext(read('hash-worker.js'),c);await c.onmessage({data:{file,partSize:part}});
 const result=messages.at(-1);assert.equal(result.type,'complete');assert.equal(result.result.sha256,digest('sha256',bytes));assert.deepEqual(Array.from(result.result.partMd5s),expected);assert.ok(messages.filter(m=>m.type==='progress').every(m=>Number.isFinite(m.percent)&&m.percent<=100));
 vm.runInContext(read('video-upload.js'),c);const direct=await c.hashVideoFile(file,part,()=>{});assert.equal(direct.sha256,result.result.sha256);assert.deepEqual(Array.from(direct.partMd5s),expected);
});
test('已暂停的文件校验不会创建 Worker 或发起网络上传',async()=>{
 const c=context();vm.runInContext(read('video-upload.js'),c);const abort=new AbortController();abort.abort();await assert.rejects(c.hashVideoInWorker(new Blob(['abc']),2,()=>{},abort.signal),e=>e.name==='AbortError');
});
