import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {WorkflowStore} from './workflow-store.mjs';
import {ServiceNotifications} from './service-notifications.mjs';
import {creativeNotificationEvent} from './service-creative-notification.mjs';
import {notificationLinks} from './notification-links.mjs';
import {sourcePeople,creativeRecords,cloudRecords,remixRecords} from './service-source-records.mjs';

const env=process.env,links=notificationLinks(env),root=env.NOTIFICATION_DATA_DIR||'/data';
for(const key of ['NOTIFICATION_CLOUD_DB','NOTIFICATION_CREATIVE_DB','NOTIFICATION_REMIX_LIBRARY'])if(!env[key]||!existsSync(env[key]))throw Error('Missing source: '+key);
if(env.CREATIVE_LOCAL_NOTIFICATION_RECIPIENT||env.ALLOW_LOCAL_IDENTITY)throw Error('Local identities are not supported in production');
const cloud=new DatabaseSync(env.NOTIFICATION_CLOUD_DB),creative=new DatabaseSync(env.NOTIFICATION_CREATIVE_DB);
for(const db of [cloud,creative])db.exec('PRAGMA busy_timeout=5000');
const store=new WorkflowStore(resolve(root,'notifications.json'));let directory=[],lastSuccess=0,busy=false,closing=false;
const allowed=(env.NOTIFICATION_ALLOWED_NUMBERS||'').split(',').filter(Boolean);
const notifier=new ServiceNotifications(store,{people:()=>directory.filter(p=>!allowed.length||allowed.includes(p.number)),env});
const status={};const snapshotFile=env.FLOW_BUSINESS_EXPORT_FILE||'/exports/business.json';mkdirSync(dirname(snapshotFile),{recursive:true});
creative.exec('CREATE TABLE IF NOT EXISTS service_notification_receipts(notification_id TEXT PRIMARY KEY,state TEXT,message_id TEXT,error TEXT,sent_at TEXT)');
function readTransaction(db,fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function resolveRecipient(number,name){if(number)return number;const found=directory.filter(p=>p.name===name);return found.length===1?found[0].number:'unmapped:'+name;}
function receipts(source,db){
 for(const {event,receipt:n} of notifier.receipts(source)){if(!n)continue;
  if(source==='cloud')db.prepare('UPDATE user_notifications SET external_status=?,external_error=?,external_sent_at=?,external_message_id=? WHERE id=? AND (external_message_id IS NULL OR external_message_id=\'\' OR external_message_id=?)').run(n.state==='ready'?'pending':n.state==='attention'?'failed':n.state,n.error||'',n.sentAt?.replace(/Z$/,'')||null,n.messageId||'',Number(event.key),n.messageId||'');
  else db.prepare('INSERT INTO service_notification_receipts VALUES(?,?,?,?,?) ON CONFLICT(notification_id) DO UPDATE SET state=excluded.state,message_id=excluded.message_id,error=excluded.error,sent_at=excluded.sent_at').run(event.key,n.state,n.messageId||'',n.error||'',n.sentAt||null);
 }
}
async function tick(){if(busy||closing)return;busy=true;try{
 const cloudData=readTransaction(cloud,()=>({people:sourcePeople(cloud,(env.FLOW_EXTERNAL_COLLABORATOR_NUMBERS||'').split(',').filter(Boolean)),records:cloudRecords(cloud),events:cloud.prepare("SELECT * FROM user_notifications WHERE kind IN ('video_request','asset_review') ORDER BY id").all()}));
 directory=cloudData.people;
 const creativeData=readTransaction(creative,()=>({ ...creativeRecords(creative),events:creative.prepare(`SELECT n.*,u.employee_no,d.product,d.version,d.status,d.current_reviewer_id,s.employee_no AS supervisor_employee_no FROM notifications n JOIN workspace_users u ON u.id=n.user_id LEFT JOIN creative_drafts d ON d.id=n.draft_id LEFT JOIN workspace_users s ON s.id=d.supervisor_reviewer_id ORDER BY n.created_at,n.id`).all()}));
 const lib=JSON.parse(readFileSync(env.NOTIFICATION_REMIX_LIBRARY,'utf8'));
 store.transaction(s=>{s.recordBaselines??={};s.nativeSources??={};for(const [key,ids] of Object.entries({creative:creativeData.records.map(r=>r.id),cloud:cloudData.records.map(r=>r.id),remix:(lib.renders||[]).map(r=>r.id)}))s.recordBaselines[key]??=ids;for(const [key,ids] of Object.entries({creative:creativeData.events.map(r=>r.id),cloud:cloudData.events.map(r=>String(r.id)),remix:(lib.serviceNotifications||[]).map(r=>r.key)}))s.nativeSources[key]??={seen:ids,initializedAt:new Date().toISOString()};return true;});
 const baselines=store.read().recordBaselines;
 const remixData=await remixRecords(env.NOTIFICATION_REMIX_LIBRARY,baselines.remix);
 const events={remix:remixData.events,cloud:cloudData.events.map(n=>({key:String(n.id),recipient:resolveRecipient(n.recipient_number,n.recipient_name),service:'WIS 云管家',title:n.title,message:n.message+'\n业务编号：'+n.resource_id,createdAt:n.created_at,url:links.cloud})),creative:creativeData.events.map(n=>{const e=creativeNotificationEvent(n,{publicUrl:links.creative});if(e.originalRecipient==='LOCAL-CREATIVE')e.recipient='unmapped:LOCAL-CREATIVE';return e;})};
 for(const source of ['remix','cloud','creative']){notifier.import(source,events[source]);status[source]={state:'connected',checkedAt:new Date().toISOString()};}
 const {events:ignored,...creativeSnapshot}=creativeData;
 const snapshot={schemaVersion:1,checkedAt:new Date().toISOString(),people:directory.filter(p=>p.flowEligible),baselines,
  creative:creativeSnapshot,cloud:{records:cloudData.records},remix:{records:remixData.records},sources:status,notificationsEnabled:notifier.sender.enabled};
 writeFileSync(snapshotFile+'.tmp',JSON.stringify(snapshot),{mode:0o640});renameSync(snapshotFile+'.tmp',snapshotFile);
 await notifier.flush();
 if(cloud.prepare('PRAGMA table_info(user_notifications)').all().some(c=>c.name==='external_message_id'))receipts('cloud',cloud);
 receipts('creative',creative);delete status.error;lastSuccess=Date.now();
 }catch(e){status.error={state:'unavailable',code:e.code||e.name};console.error('Source notification cycle deferred:',e.code||e.name,String(e.message).slice(0,160));}finally{busy=false;}}
const server=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url!=='/health'){res.writeHead(404).end('{}');return;}const ok=lastSuccess>0&&Date.now()-lastSuccess<45000;res.statusCode=ok?200:503;res.end(JSON.stringify({ok,enabled:notifier.sender.enabled,lastSuccess:lastSuccess?new Date(lastSuccess).toISOString():null,sources:status}));});
server.listen(3000,'0.0.0.0');const timer=setInterval(()=>void tick(),3000);await tick();
async function stop(){closing=true;clearInterval(timer);server.close();while(busy)await new Promise(r=>setTimeout(r,50));cloud.close();creative.close();}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
