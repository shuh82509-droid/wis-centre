const liveTaskId = /^task_[0-9a-f]{32}$/u;

// Only old task links are eligible. Keep non-live links on Panorama.
export function liveTaskNavigation(url, session, readTask) {
  if (!['/workflow-panorama', '/workflow-panorama/'].includes(url.pathname)) return null;
  if (url.searchParams.getAll('task').length !== 1) return null;
  if (url.searchParams.getAll('view').length > 1) return null;
  const taskId = url.searchParams.get('task') || '';
  if (!liveTaskId.test(taskId)) return null;
  const base = url.pathname.endsWith('/') ? '../#' : './#';
  const recordView = url.searchParams.get('view') === 'record';

  if (session?.status === 401) {
    const hash = new URLSearchParams({module: 'workflow-engine', workflowTask: taskId});
    if (recordView) hash.set('workflowView', 'record');
    return `${base}${hash}`;
  }
  if (session?.status !== 200) return null;

  let task;
  try { task = readTask(taskId); } catch { return null; }
  if (task?.workflow !== '04' || !task.runtime?.liveSession) return null;
  const hash = new URLSearchParams({module: 'live-room-management', liveTask: taskId});
  if (recordView) hash.set('liveView', 'record');
  return `${base}${hash}`;
}
