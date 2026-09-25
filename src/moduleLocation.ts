export function embeddedCloudAsset(hash: string): { id: string; etag: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('module') !== 'cloud-manager' || params.getAll('asset_id').length !== 1) return null;
  const id = params.get('asset_id') || '';
  if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  const etag = params.getAll('asset_etag').length === 1 ? params.get('asset_etag') || '' : '';
  return { id, etag: /^[a-fA-F0-9]+(?:-\d+)?$/.test(etag) && etag.length <= 128 ? etag : '' };
}

export function initialModule(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const module = params.get('module') || '';
  return params.getAll('module').length === 1 && /^[a-z0-9-]+$/.test(module) ? module : null;
}

export function linkedLiveTask(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const task = params.get('liveTask') || '';
  return params.getAll('module').length === 1 && params.get('module') === 'live-room-management' &&
    params.getAll('liveTask').length === 1 && /^task_[a-z0-9]+$/.test(task) ? task : null;
}

export function workflowReturnTarget(hash: string, href: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const task = params.get('workflowTask') || '';
  const view = params.get('workflowView') || '';
  if (params.getAll('module').length !== 1 || params.get('module') !== 'workflow-engine' ||
      params.getAll('workflowTask').length !== 1 || !/^task_[a-z0-9]+$/.test(task) ||
      params.getAll('workflowView').length > 1 || (view && view !== 'record')) return null;
  const url = new URL('workflow-panorama/', href);
  url.searchParams.set('task', task);
  if (view === 'record') url.searchParams.set('view', 'record');
  return url.href;
}
