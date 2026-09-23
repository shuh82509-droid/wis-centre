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
