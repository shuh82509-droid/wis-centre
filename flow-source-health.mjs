import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function checkSourceSnapshot(value, now=Date.now()) {
  const age = now-Date.parse(value?.exportedAt);
  if (!Number.isFinite(age) || age < -5000 || age > 90000) return {ok:false,reason:'snapshot_stale_or_invalid'};
  if (value?.schemaVersion!==1 || value?.cloud?.state!=='connected' || value?.remix?.state!=='connected') return {ok:false,reason:'source_unavailable'};
  return {ok:true,ageMs:age};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const result=checkSourceSnapshot(JSON.parse(readFileSync(process.env.FLOW_EXPORT_FILE||'/exports/flow-snapshot.json','utf8')));
    console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
  } catch {console.error('source_snapshot_unreadable');process.exitCode=1;}
}
