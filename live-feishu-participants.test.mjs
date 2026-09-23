import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveFeishuParticipants, liveFeishuVisible} from './live-feishu-participants.mjs';
const appId = 'cli_aa9c744d6ffa1cc4';
const binding = {appId, openId: 'ou_testanchor', name: '测试主播', center: '直播中心', departmentIds: ['od_live'], approvedBy: 'FD-026222', approvedAt: '2026-09-23T00:00:00Z'};
const user = {open_id: binding.openId, name: binding.name, department_ids: ['od_live'], status: {is_activated: true, is_resigned: false, is_frozen: false, is_exited: false}};
const taskFor = number => ({id: 'task_test', workflow: '04', center: '直播中心', runtime: {liveSession: {date: '2026-09-23'}, nodes: [{id: 'W04.S4.E1', owner: {number}}]}});
test('never-login staff get no hub modules and can be a scoped Feishu execution participant', async () => {
  const d = new LiveFeishuParticipants({bindings: [binding], fetchUser: async () => user});
  await d.refresh(); const [p] = d.people();
  assert.deepEqual(p.modules, []); assert.equal(p.workflowEnabled, false);
  const task = taskFor(p.number), a = d.actor({appId, openId: binding.openId, task, nodeId: 'W04.S4.E1'});
  assert.equal(a.enabled, false); assert.equal(liveFeishuVisible(task, a), true);
  for (const changed of [{...task, id: 'task_other'}, {...task, workflow: '06'}, {...task, center: '视频中心'}, {...task, runtime: {...task.runtime, liveSession: null}}]) assert.equal(liveFeishuVisible(changed, a), false);
  assert.equal(d.canOwn(p.number, 'W04.S3.E2'), false); assert.equal(d.canOwn(p.number, 'W04.S4.A1'), true);
});
test('wrong operator, wrong app, unassigned node and management nodes are denied', async () => {
  const d = new LiveFeishuParticipants({bindings: [binding], fetchUser: async () => user}); await d.refresh();
  const task = taskFor(d.people()[0].number), input = {appId, openId: binding.openId, task, nodeId: 'W04.S4.E1'};
  for (const change of [{appId: 'other'}, {openId: 'ou_other'}, {nodeId: 'W04.S5.E1'}, {task: taskFor('other')}]) assert.throws(() => d.actor({...input, ...change}), e => e.status === 403);
});
test('partial contact records, departed/frozen staff and name/department changes fail closed', async () => {
  for (const mutate of [u => delete u.status, u => delete u.status.is_resigned, u => u.status.is_resigned = true, u => u.status.is_activated = false, u => u.status.is_frozen = true, u => u.status.is_exited = true, u => u.name = '同名误配', u => u.department_ids = ['other'], u => u.open_id = 'ou_other']) {
    let record = structuredClone(user); const d = new LiveFeishuParticipants({bindings: [binding], fetchUser: async () => record}); await d.refresh(); assert.equal(d.people().length, 1);
    mutate(record); await d.refresh(); assert.equal(d.people().length, 0); assert.equal(d.issues.length, 1);
  }
});
test('expired, future-dated and failed rechecks do not reuse last-good identity', async () => {
  let now = 1000000, fail = false;
  const d = new LiveFeishuParticipants({bindings: [binding], clock: () => now, fetchUser: async () => {if (fail) throw Error('offline'); return user;}});
  await d.refresh(); const number = d.people()[0].number;
  now += 900001; assert.equal(d.recipient(number), null);
  await d.refresh(); now--; assert.equal(d.recipient(number), null);
  now++; fail = true; await d.refresh(); assert.equal(d.people().length, 0);
});
test('duplicate identity and conflicting hub records are blocked without changing hub permissions', async () => {
  assert.throws(() => new LiveFeishuParticipants({bindings: [binding, binding]}));
  const d = new LiveFeishuParticipants({bindings: [{...binding, number: 'FD-TEST'}], fetchUser: async () => user}); await d.refresh();
  const hub = [{number: 'FD-TEST', name: binding.name, center: binding.center, modules: ['workflow-engine'], role: 'specialist'}];
  assert.deepEqual(d.merge(hub), hub); assert.deepEqual(hub[0].modules, ['workflow-engine']);
  assert.throws(() => d.merge([{...hub[0], name: 'another'}]));
});
