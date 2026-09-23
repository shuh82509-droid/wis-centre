import {readFileSync} from 'node:fs';

// This capability belongs to the workflow designer, not to task operations or
// other hub modules. Employee numbers come from the verified OA session.
export function readConfigurationGrants(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data.schema === 'wis.flow-configuration-grants.v1' && Array.isArray(data.grants)
      ? data.grants : [];
  } catch { return []; }
}

export function configurationAccess(base, grants, {inactive = false} = {}) {
  const allowed = !inactive && Array.isArray(base.modules) && base.modules.includes('workflow-engine');
  const grant = allowed && (Array.isArray(grants) ? grants : []).find(g => g && typeof g === 'object'
    && g.active === true && g.scope === 'department'
    && g.number === base.user.number && typeof g.id === 'string' && g.id.length > 0
    && Array.isArray(g.capabilities) && ['view', 'edit', 'publish'].every(c => g.capabilities.includes(c)));
  const configurationOnly = !!grant && !base.canManage;
  return {...base, enabled: allowed && (base.enabled || !!grant),
    canManage: allowed && base.canManage, department: allowed && base.department,
    canConfigure: allowed && (base.canManage || !!grant),
    configurationOnly,
    configurationScope: grant || base.department ? 'department' : 'center',
    ...(grant ? {configurationGrant: {id: grant.id, number: grant.number, scope: grant.scope}} : {})};
}

export const canConfigure = a => a.canConfigure ?? a.canManage;
export const configurationDepartment = a => a.configurationScope === 'department' || a.department;
export const configurationPeopleAccess = a => ({...a, department: configurationDepartment(a)});

// Method and path must both match. New operational endpoints stay closed to
// configuration-only collaborators without needing another deny-list update.
export function configurationEndpoint(method, path) {
  if (method === 'GET') return ['overview', 'catalog', 'people', 'blueprints'].includes(path)
    || /^blueprints\/revision\/\d+$/.test(path);
  return method === 'POST' && ['blueprints/nodes', 'blueprints/preview',
    'blueprints/save', 'blueprints/publish'].includes(path);
}
