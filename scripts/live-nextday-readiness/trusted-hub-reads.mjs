// Fixed read-only bridge into the *pinned running Hub image*. Module hashes
// cover the transitive local import graph. No server startup, store constructor,
// transaction, source sync or notifier is instantiated by this program.
import {requireRead, validDigest} from './trusted-policy.mjs';
import {runReadChild} from './trusted-child-process.mjs';

const SCRIPT = String.raw`
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error('Hub read unavailable'),{code});};
const need=(ok,code)=>{if(!ok)fail(code);};
const sha=x=>createHash('sha256').update(x).digest('hex');
let bytes='';for await(const chunk of process.stdin){bytes+=chunk;need(Buffer.byteLength(bytes)<16*1024*1024,'bridge_input_too_large');}
const {config,operation,input}=JSON.parse(bytes);
const allowed=['bindings','state','parse','derive','card'];
need(allowed.includes(operation),'bridge_operation_forbidden');
need(config.expectedDate===new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10),'bridge_date_mismatch');
const file=(path,maxBytes=8*1024*1024)=>{
 const stat=statSync(path);need(realpathSync(path)===path&&stat.isFile(),'bridge_file_alias');
 need(stat.size>0&&stat.size<=maxBytes,'bridge_file_size_invalid');const raw=readFileSync(path);
 need(raw.length<=maxBytes,'bridge_file_size_invalid');return raw;
};
const bindings=()=>{
 const raw=file('/app/data/live-participants.json');need(sha(raw)===config.participantFileSha256,'bridge_binding_digest_mismatch');
 const rows=JSON.parse(raw);need(Array.isArray(rows)&&rows.length>0&&rows.length<=100,'bridge_bindings_invalid');
 return rows.map(b=>({appId:b.appId,name:b.name,openId:b.openId,center:b.center,
  number:b.number||('feishu:'+b.appId+':'+b.openId),departmentIds:b.departmentIds,
  approvedBy:b.approvedBy,approvedAt:b.approvedAt})).filter(b=>config.approvedNumbers.includes(b.number));
};
const seen=new Set();
function verifyModule(name){
 need(/^[a-z0-9][a-z0-9.-]*\.mjs$/u.test(name),'bridge_module_path_forbidden');
 if(seen.has(name))return;seen.add(name);
 const code=file('/app/'+name);need(sha(code)===config.moduleHashes[name],'bridge_module_digest_mismatch');
 const text=code.toString('utf8');
 need(!/\bimport\s*\(/u.test(text),'bridge_dynamic_import_unsupported');
 for(const match of text.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/gu)){
  need(/^\.\/[a-z0-9][a-z0-9.-]*\.mjs$/u.test(match[1]),'bridge_local_import_unsupported');verifyModule(match[1].slice(2));
 }
}
let output;
if(operation==='bindings')output=bindings();
if(operation==='state'){
 const path='/app/data/task-center.json';need(statSync(path).size<=64*1024*1024,'bridge_state_too_large');
 const raw=JSON.parse(file(path,64*1024*1024));need(Array.isArray(raw.tasks)&&Array.isArray(raw.flowNotifications),'bridge_state_invalid');
 output={tasks:raw.tasks.filter(t=>t.workflow==='04'),flowNotifications:raw.flowNotifications};
}
if(operation==='parse'){
 verifyModule('live-official-schedule.mjs');const {parseOfficialRoom,officialRooms}=await import('/app/live-official-schedule.mjs');
 need(input.date===config.expectedDate&&Array.isArray(input.sheets)&&input.sheets.length===4,'bridge_source_scope_invalid');
 const sourceStatus={},rooms=[],issues=[];
 for(const room of officialRooms){
  const rows=input.sheets.filter(x=>x.sheetId===room.sheetId);need(rows.length===1,'bridge_sheet_scope_invalid');
  const row=rows[0];need(Array.isArray(row.values)&&Number.isSafeInteger(row.revision)&&row.revision>0,'bridge_sheet_invalid');
  try{const p=parseOfficialRoom(room,row.values,input.date);rooms.push(p.room);issues.push(...p.issues);sourceStatus[room.code]={...p.source,revision:row.revision};}
  catch{issues.push({roomCode:room.code,code:'official_room_parse_failed'});}
 }
 need(new Set(input.sheets.map(x=>x.revision)).size===1,'bridge_source_revision_changed');
 output={date:input.date,updatedAt:input.readAt,rooms,sourceStatus,issues,
  source:{mode:'official_live',spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned',readOnly:true,verified:true}};
}
if(operation==='derive'){
 verifyModule('live-session-flow.mjs');const {scheduleSessions}=await import('/app/live-session-flow.mjs');
 const approved=bindings(),now=Date.now(),verified=new Map();
 for(const row of input.identities){const b=approved.find(x=>x.number===row.number);
  need(b&&b.openId===row.openId&&b.name===row.name&&row.active===true&&row.employed===true&&row.departmentVerified===true&&
   now-Date.parse(row.checkedAt)>=0&&now-Date.parse(row.checkedAt)<=120000,'bridge_identity_unverified');verified.set(row.number,b);}
 const participants={verified:number=>verified.get(number),canOwn:(number,node)=>verified.has(number)&&/^W04\.S4\.(E1|A[1-9]\d*)$/u.test(node)};
 const people=approved.filter(b=>verified.has(b.number)).map(b=>({number:b.number,name:b.name,center:b.center,active:true,
  modules:[],workflowEnabled:false,liveFeishuOnly:true}));
 output=scheduleSessions(input.source,config.expectedDate,people,now,participants);
}
if(operation==='card'){
 verifyModule('live-feishu-card.mjs');const {liveFeishuCard}=await import('/app/live-feishu-card.mjs');
 output=liveFeishuCard(input.notice,input.task);
}
process.stdout.write(JSON.stringify({ok:true,data:output}));
`;

export function createHubReadBridge({policy, execute = executeHubBridge} = {}) {
  requireRead(/^[a-f0-9]{64}$/u.test(policy?.containers?.hub?.id || '') &&
    validDigest(policy.participantFileSha256) && Array.isArray(policy.approvedNumbers) &&
    policy.moduleHashes && Object.entries(policy.moduleHashes).every(([name, hash]) =>
      /^[a-z0-9][a-z0-9.-]*\.mjs$/u.test(name) && validDigest(hash)), 'hub_bridge_pins_invalid');
  const config = {expectedDate: policy.expectedDate, participantFileSha256: policy.participantFileSha256,
    approvedNumbers: [...policy.approvedNumbers], moduleHashes: {...policy.moduleHashes}};
  return Object.freeze({async read(operation, input, {signal} = {}) {
    requireRead(['bindings', 'state', 'parse', 'derive', 'card'].includes(operation), 'hub_bridge_operation_forbidden');
    return execute(policy.containers.hub.id, JSON.stringify({config, operation, input}), {signal});
  }});
}

export async function executeHubBridge(containerId, input, {signal} = {}) {
  requireRead(process.platform === 'linux' && /^[a-f0-9]{64}$/u.test(containerId), 'live_reader_requires_linux_host');
  requireRead(typeof input === 'string' && Buffer.byteLength(input) <= 16 * 1024 * 1024, 'hub_bridge_input_too_large');
  const stdout = await runReadChild('docker', ['--host', 'unix:///run/user/1000/docker.sock', 'exec', '-i',
    containerId, 'node', '--input-type=module', '-e', SCRIPT], {input, signal, maxBytes: 64 * 1024 * 1024});
  let result;
  try { result = JSON.parse(stdout); } catch { requireRead(false, 'hub_bridge_invalid_response'); }
  requireRead(result?.ok === true, 'hub_bridge_invalid_response');
  return result.data;
}
