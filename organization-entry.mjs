// Additional entry restriction only: this store never grants a role or data scope.
import {readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const failure = (status, message) => Object.assign(new Error(message), {status});
export function employeeKey(user = {}) {
  const number = String(user.number || user.userNumber || user.user_number || '').trim().toUpperCase();
  return number && !number.includes(':') ? number : '';
}
export class OrganizationEntryStore {
  constructor(file) { this.file = file; }
  read() {
    let data;
    try { data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return {schema: 1, version: 0, entries: {}, audits: []};
      throw failure(503, '看板权限配置暂时不可读取，已安全停止变更，请联系维护人。');
    }
    if (data?.schema !== 1 || !Number.isSafeInteger(data.version) || data.version < 0 ||
        !data.entries || Array.isArray(data.entries) || typeof data.entries !== 'object' || !Array.isArray(data.audits) ||
        Object.values(data.entries).some(row => typeof row?.enabled !== 'boolean')) {
      throw failure(503, '看板权限配置校验失败，已安全停止变更，请联系维护人。');
    }
    return data;
  }
  allowed(user) {
    try { return this.read().entries[employeeKey(user)]?.enabled !== false; }
    catch { return false; } // Never fall back to unrestricted access on a corrupt/unreadable file.
  }
  // A single synchronous transaction, with revision check and audit in the same rename.
  update(changes, version, actor) {
    const data = this.read();
    if (!Number.isSafeInteger(version) || version !== data.version) throw failure(409, '看板权限已更新，请刷新权限状态后重新确认。');
    const now = new Date().toISOString();
    const next = {...data, version: data.version + 1, entries: {...data.entries}, audits: [...data.audits]};
    for (const change of changes) {
      if (!employeeKey({number: change.key}) || typeof change.enabled !== 'boolean') throw failure(400, '成员工号或看板权限格式不正确。');
      const before = data.entries[change.key]?.enabled;
      next.entries[change.key] = {enabled: change.enabled, updated_at: now, updated_by_name: actor.realName || actor.name || ''};
      next.audits.unshift({id: -Date.now() - next.audits.length, actor_number: employeeKey(actor),
        actor_name: actor.realName || actor.name || '', department: actor.department || '',
        module: '看板权限', action: change.enabled ? '允许组织经营看板入口' : '关闭组织经营看板入口',
        method: 'PUT', path: '/api/permissions/organization-entry', result: 'success', status_code: 200,
        resource_type: 'organization_dashboard_entry', resource_id: change.key,
        detail: `${change.name || change.key}：${before === undefined ? '沿用原规则' : before ? '允许' : '关闭'} → ${change.enabled ? '允许（仍受角色范围约束）' : '关闭'}；不修改角色、中心和业务模块。`, created_at: now});
    }
    mkdirSync(dirname(this.file), {recursive: true});
    const temp = this.file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, this.file);
    } catch {
      throw failure(503, '看板权限未保存，原配置保留；请稍后重试或联系维护人。');
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temp); } catch { /* renamed or never created */ }
    }
    return next;
  }
}

export function entryRows(modules, profiles, policyFor, store) {
  const data = store.read();
  return {version: data.version, items: modules.map(row => {
    const matches = profiles.filter(p => p.identifier === row.identifier ||
      (employeeKey(row) && employeeKey(p) === employeeKey(row)));
    const profile = matches.find(p => p.configured) || matches[0];
    const key = employeeKey(row) || employeeKey(profile);
    const conflicting = matches.some(p => employeeKey(p) && key && employeeKey(p) !== key);
    const user = {number: key, realName: row.real_name, department: profile?.department || row.department, center: profile?.center || row.center};
    const highest = row.highest_business_access === true;
    const policy = policyFor({user, permissions: {manage_permissions: highest}, access: {allowed_modules: profile?.modules || row.modules || [],
      workspace_profile: profile?.configured ? profile : null}});
    const eligible = !!policy.can_view_organization_dashboard;
    const identityValid = !!key && !conflicting && !!row.login_active;
    const editable = identityValid && !highest;
    const enabled = identityValid && eligible && (highest || data.entries[key]?.enabled !== false);
    return {identifier: row.identifier, key, eligible, editable, enabled, highest_business_access: highest,
      configured: !!data.entries[key], role: policy.role, scope: policy.dashboard_scope,
      center: policy.center || '', version: data.version,
      reason: !row.login_active ? '登录权限已关闭' : !key || conflicting ? '请先补全并核对成员工号' : highest ? '最高权限具有完整部门视角；取消最高权限后恢复这里的原配置' :
        !eligible ? '当前角色不开放此看板；此处不提升角色权限' :
          policy.dashboard_scope === 'center' ? `仅限${policy.center || '所属中心'}，不扩大数据范围` : '沿用现有部门数据范围，不增加管理权限',
      updated_by_name: data.entries[key]?.updated_by_name || '', updated_at: data.entries[key]?.updated_at || null};
  })};
}

export function createOrganizationEntryHandler({store, currentSession, callAuthority, policyFor, readBody, sendJson, clearSessionCache}) {
  return async (request, response, url) => {
    if (url.pathname !== '/api/permissions/organization-entry') return false;
    const session = await currentSession(request);
    if (session.status !== 200) { sendJson(response, session.status, session.payload); return true; }
    if (!session.payload?.permissions?.manage_permissions) { sendJson(response, 403, {detail: '只有权限管理员可以配置看板入口。'}); return true; }
    if (!['GET', 'PUT'].includes(request.method)) { sendJson(response, 405, {detail: '请求方式不支持'}); return true; }
    try {
      const [modules, profiles] = await Promise.all([callAuthority(request, '/admin/module-access'), callAuthority(request, '/admin/workspace-profiles')]);
      if (modules.status !== 200 || profiles.status !== 200 || !Array.isArray(modules.payload?.items) || !Array.isArray(profiles.payload?.items)) {
        throw failure(503, '成员权限资料尚未完整返回，未进行变更，请刷新重试。');
      }
      const listing = () => entryRows(modules.payload.items, profiles.payload.items, policyFor, store);
      const current = listing();
      if (request.method === 'GET') { sendJson(response, 200, current); return true; }
      let payload;
      try { payload = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8')); }
      catch { throw failure(400, '请求内容格式不正确。'); }
      if (!Array.isArray(payload.identifiers) || !payload.identifiers.length || payload.identifiers.length > 500 ||
          payload.identifiers.some(id => typeof id !== 'string') || typeof payload.enabled !== 'boolean') throw failure(400, '请选择成员并设置允许或关闭。');
      const changes = new Map();
      for (const id of new Set(payload.identifiers)) {
        const row = current.items.find(item => item.identifier === id);
        if (!row) throw failure(404, '部分成员不在当前名单中，未修改任何成员，请刷新。');
        if (!row.editable || (payload.enabled && !row.eligible)) throw failure(409, `${id}：${row.reason}。本次未修改任何成员。`);
        changes.set(row.key, {key: row.key, name: modules.payload.items.find(item => item.identifier === id)?.real_name, enabled: payload.enabled});
      }
      store.update([...changes.values()], payload.version, session.payload.user || {});
      clearSessionCache();
      // Read back the atomic result. No retries of writes, including on uncertain transport results.
      sendJson(response, 200, {...listing(), updated: changes.size});
    } catch (error) { sendJson(response, error.status || 503, {detail: error.status ? error.message : '看板权限请求未完成，请刷新状态后再操作。'}); }
    return true;
  };
}
