// Exact ordinary-source synthetic QA; no real app, credential or store mounts.
import {spawn} from 'node:child_process';
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const hash=b=>createHash('sha256').update(b).digest('hex');
const originalSender='58a94eb60df9021193c9b23480b73910ef857ade0428b655f21566e83954a635';
const baselineProofHash='be33bf622026d22b82dd3b958d9141ac053112830db4dfeca0a32bdc77413c3e';
if(process.platform!=='linux'||process.arch!=='x64'||process.getuid?.()!==10001
 ||resolve(process.cwd())!=='/qa'||process.version!=='v22.23.2')throw Error('Pinned isolated runner identity mismatch');
if(JSON.stringify(Object.keys(process.env).sort())!==JSON.stringify(['PATH'])
 ||process.env.PATH!=='/usr/local/bin:/usr/bin:/bin')throw Error('QA inherited environment denied');
const manifest=JSON.parse(readFileSync('/qa/EXACT-PAYLOAD-PROOF.json','utf8'));
if(manifest.scope!=='exact-58a-source-only-synthetic-qa'||manifest.productionDeployable!==false
 ||manifest.productionMutation!==false||manifest.originalSender!==originalSender
 ||!Number.isInteger(manifest.expectedTopLevelCases)||manifest.expectedTopLevelCases<20
 ||!Array.isArray(manifest.files)||manifest.files.length!==34)throw Error('Frozen exact QA manifest mismatch');
const proofRaw=readFileSync('/qa/BASELINE-PROOF.json');
if(hash(proofRaw)!==baselineProofHash)throw Error('Ordinary baseline provenance changed');
const proof=JSON.parse(proofRaw);
if(proof.sourceSnapshotSha256!=='9e806f4ee7c3a65731464bdc7980ec52fc6f8a7cfb1f28d0ea4fd8f0c475b772'
 ||proof.formalContainerId!=='c1e3c6b48623ff9888e2baf6048a4db6eb1cf6363bd57e172c5debe080aba666'
 ||proof.formalImage!=='sha256:27e494a0094e0e34a932876ff91988ca608be9bc0688a56c76a511a8154086dc'
 ||proof.originalFileCount!==16||proof.files.length!==16)throw Error('Baseline source observation mismatch');
const pins=new Map();
for(const pin of manifest.files){
 if(typeof pin.path!=='string'||!(/^(baseline|candidate)\/[a-z0-9-]+\.mjs$/.test(pin.path)
  ||pin.path==='qa/exact-fairness.test.mjs'||pin.path==='BASELINE-PROOF.json')||pins.has(pin.path))throw Error('Unexpected manifest path');
 const st=lstatSync('/qa/'+pin.path),raw=readFileSync('/qa/'+pin.path);
 if(!st.isFile()||st.isSymbolicLink()||st.size!==pin.bytes||hash(raw)!==pin.sha256)throw Error('Frozen ordinary QA bytes changed');
 pins.set(pin.path,pin);
}
for(const source of proof.files){
 if(pins.get('baseline/'+source.name)?.sha256!==source.sha256
  ||pins.get('baseline/'+source.name)?.bytes!==source.bytes)throw Error('Original source changed');
 if(source.name!=='flow-feishu.mjs'&&pins.get('candidate/'+source.name)?.sha256!==source.sha256)throw Error('Outside sender patch scope');
}
if(pins.get('baseline/flow-feishu.mjs')?.sha256!==originalSender
 ||pins.get('candidate/flow-feishu.mjs')?.sha256===originalSender)throw Error('Sender differential fixture not frozen');
const inventory=[];
function walk(path,rel=''){
 for(const name of readdirSync(path).sort()){
  const p=path+'/'+name,r=rel?rel+'/'+name:name,st=lstatSync(p);
  if(st.isSymbolicLink())throw Error('QA symlink denied');
  if(st.isDirectory())walk(p,r);else if(st.isFile())inventory.push(r);else throw Error('QA special file denied');
 }
}
walk('/qa');
if(JSON.stringify(inventory.sort())!==JSON.stringify([...pins.keys(),'qa-entry.mjs','EXACT-PAYLOAD-PROOF.json'].sort()))throw Error('Extra QA file denied');
const child=spawn(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1','qa/exact-fairness.test.mjs'],{
 cwd:'/qa',env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe'],
});
let timedOut=false,hardTimer;
const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');hardTimer=setTimeout(()=>process.exit(1),3000);},55000);
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
child.once('error',()=>{clearTimeout(timer);clearTimeout(hardTimer);process.exitCode=1;});
child.once('exit',(code,signal)=>{clearTimeout(timer);clearTimeout(hardTimer);process.exitCode=timedOut||signal||code!==0?1:0;});
