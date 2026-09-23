import {requireFact} from './workflow-store.mjs';

const APP = 'cli_aa9c744d6ffa1cc4';
const executionNode = id => /^W04\.S4\.(E1|A[1-9]\d*)$/.test(id || '');
// This registry authorizes only assigned live execution. It is never an OA
// account, module grant, manager role, or a substitute for a real Feishu user.
export class LiveFeishuParticipants {
  constructor({bindings = [], appId = APP, fetchUser, clock = Date.now, maxAgeMs = 15 * 60000} = {}) {
    requireFact(appId === APP, '直播参与人必须使用已确认的中枢机器人', 503);
    requireFact(Number.isFinite(maxAgeMs) && maxAgeMs > 0 && maxAgeMs <= 15 * 60000, '身份核验有效期无效');
    this.appId = appId; this.fetchUser = fetchUser; this.clock = clock; this.maxAgeMs = maxAgeMs;
    this.bindings = structuredClone(bindings); this.cache = new Map(); this.issues = [];
    const ids = new Set(), numbers = new Set();
    for (const b of this.bindings) {
      requireFact(b.appId === appId && /^ou_[a-z0-9]+$/.test(b.openId || '') && b.name && b.center === '直播中心' &&
        Array.isArray(b.departmentIds) && b.departmentIds.length && b.departmentIds.every(x => typeof x === 'string' && x) &&
        b.approvedBy === 'FD-026222' && Number.isFinite(Date.parse(b.approvedAt)), '缺少已核验的直播参与人绑定', 409);
      // Names may collide; never collapse them. A roster ambiguity must fail.
      b.number ||= `feishu:${appId}:${b.openId}`;
      requireFact(!ids.has(b.openId) && !numbers.has(b.number), '飞书参与人重复绑定', 409);
      ids.add(b.openId); numbers.add(b.number);
    }
  }
  async refresh() {
    requireFact(typeof this.fetchUser === 'function', '飞书人员核验服务未配置', 503);
    const next = new Map(), issues = [];
    for (const b of this.bindings) {
      try {
        const u = await this.fetchUser(b.openId);
        requireFact(u?.open_id === b.openId && u.name === b.name && u.status?.is_activated === true &&
          u.status?.is_resigned === false && u.status?.is_frozen === false && u.status?.is_exited === false &&
          Array.isArray(u.department_ids) && b.departmentIds.some(id => u.department_ids.includes(id)),
        '真实在职身份、姓名或部门无法核验', 409);
        requireFact(!b.employeeNo || u.employee_no === b.employeeNo, '绑定工号已变化', 409);
        next.set(b.number, {...b, checkedAt: this.clock()});
      } catch { issues.push({name: b.name, number: b.number, message: '飞书在职身份核验未通过，暂停通知及办理'}); }
    }
    // No last-good fallback after failed verification, including partial errors.
    this.cache = next; this.issues = issues;
    return {verified: next.size, issues: structuredClone(issues)};
  }
  verified(number) {
    const b = this.cache.get(number), age = this.clock() - (b?.checkedAt ?? NaN);
    return b && age >= 0 && age <= this.maxAgeMs ? b : null;
  }
  people() {
    return [...this.cache.keys()].map(n => this.verified(n)).filter(Boolean).map(b => ({
      number: b.number, name: b.name, center: b.center, active: true, role: 'live_participant',
      modules: [], workflowEnabled: false, liveFeishuOnly: true,
    }));
  }
  merge(hubPeople) {
    const result = [...hubPeople];
    for (const p of this.people()) {
      const existing = result.find(x => x.number === p.number);
      if (existing) requireFact(existing.name === p.name && existing.center === p.center, '中枢与飞书身份冲突', 409);
      else result.push(p);
    }
    return result;
  }
  recipient(number) {
    const b = this.verified(number);
    return b ? {id: b.openId, type: 'open_id', name: b.name} : null;
  }
  canOwn(number, nodeId) { return !!this.verified(number) && executionNode(nodeId); }
  actor({appId, openId, task, nodeId}) {
    requireFact(appId === this.appId, '不是已配置的直播机器人回执', 403);
    const hits = [...this.cache.keys()].map(n => this.verified(n)).filter(b => b?.openId === openId);
    requireFact(hits.length === 1, '当前飞书办理人未通过身份核验', 403);
    const b = hits[0], node = task?.runtime?.nodes.find(n => n.id === nodeId);
    requireFact(task?.workflow === '04' && task.runtime.liveSession && executionNode(nodeId) &&
      node?.owner.number === b.number && task.center === b.center, '只能办理本人被分配的直播节点', 403);
    return {channel: 'feishu-live', taskId: task.id, nodeId, user: {number: b.number, name: b.name, center: b.center},
      enabled: false, canManage: false, department: false, modules: []};
  }
}

export function liveFeishuVisible(task, actor) {
  return actor?.channel === 'feishu-live' && actor.enabled === false && !actor.canManage && !actor.department &&
    task?.workflow === '04' && !!task.runtime?.liveSession && task.id === actor.taskId &&
    task.center === actor.user?.center && executionNode(actor.nodeId) &&
    task.runtime.nodes.some(n => n.id === actor.nodeId && n.owner.number === actor.user.number);
}
