import { ApiError } from './api';
import type { TaskAssistantResult, TaskCenterItem, TaskCenterSourceKind } from './types';

export type TaskDraft = { workflow: string; sourceKind: TaskCenterSourceKind; title: string; description: string; acceptance: string; sourceUrl: string; sourceReference: string; assignees: string[]; dueAt: string; video?: { filename: string; mimeType: string; dataBase64: string } };

// Keep only the operation key and content hash in session storage, never files or credentials.
// A response lost after a successful write can be retried with the same identity across reloads.
const memoryKeys = new Map<string,string>();
async function mutation<T>(person: string, path: string, body: unknown, method='POST'): Promise<T> {
  const serialized=JSON.stringify(body);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const storageKey=`wis-workflow-intent:${person}:${path}:${digest}`;
  let key=memoryKeys.get(storageKey);
  try { key=key || sessionStorage.getItem(storageKey) || undefined; } catch { /* storage may be unavailable */ }
  if(!key) key=crypto.randomUUID();memoryKeys.set(storageKey,key);
  try {sessionStorage.setItem(storageKey,key);}catch { /* memory fallback preserves retries in this page */ }
  let response: Response;
  try {
    response=await fetch(path,{method,redirect:'error',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:serialized,signal:AbortSignal.timeout(45000)});
  } catch { throw new ApiError('连接中断，填写内容已保留。请先刷新任务核对；再次提交将复用原操作编号。',503); }
  const payload=await response.json().catch(()=>null);
  if(!response.ok || !payload || (!payload.id && !payload.accepted)) throw new ApiError(payload?.detail || '未收到有效结果，请刷新任务核对，勿重复推送。',response.ok?503:response.status);
  memoryKeys.delete(storageKey);try {sessionStorage.removeItem(storageKey);}catch { /* no persistent storage */ }
  return payload as T;
}
export const workflowApi={
  create:(person:string,draft:TaskDraft)=>mutation<TaskCenterItem>(person,'api/task-center/tasks',draft),
  command:(person:string,item:TaskCenterItem,action:string,body:Record<string,unknown>={})=>mutation<TaskCenterItem>(person,`api/task-center/tasks/${encodeURIComponent(item.id)}/${action}`,{...body,expectedVersion:item.version},action==='status'?'PATCH':'POST'),
  assistant:(person:string,item:TaskCenterItem,kind:'prepare'|'preflight')=>mutation<TaskAssistantResult>(person,`api/task-center/tasks/${encodeURIComponent(item.id)}/${kind}`,{expectedVersion:item.version}),
};
