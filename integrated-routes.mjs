export function integratedLaunchTarget(moduleKey, rawPaths, hubBasePath = '/yxb/wis-marketing-hub/') {
  let paths;
  try { paths = JSON.parse(rawPaths || '{}'); } catch { return ''; }
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return '';
  const path = paths[moduleKey];
  if (typeof path !== 'string' || !path.startsWith(hubBasePath)) return '';
  if (/[%?#\\\r\n]/u.test(path) || path.includes('//') || path.includes('/../') || path.endsWith('/..')) return '';
  return path;
}
