import test from 'node:test';
import assert from 'node:assert/strict';
import {liveTaskNavigation} from './live-task-navigation.mjs';

const id = 'task_0123456789abcdef0123456789abcdef';
const url = (query = `task=${id}`, path = '/workflow-panorama/') =>
  new URL(`https://hub.invalid${path}?${query}`);
const live = {workflow: '04', runtime: {liveSession: {key: 'slot'}}};

test('old live link goes to the protected live form for a visible task', () => {
  assert.equal(liveTaskNavigation(url(), {status: 200}, taskId => {
    assert.equal(taskId, id);
    return live;
  }), `../#module=live-room-management&liveTask=${id}`);
});

test('anonymous link retains the task through OA entry without looking up a task', () => {
  let reads = 0;
  assert.equal(liveTaskNavigation(url(), {status: 401}, () => {reads++;}),
    `../#module=workflow-engine&workflowTask=${id}`);
  assert.equal(reads, 0);
  assert.equal(liveTaskNavigation(url(`task=${id}&view=record`), {status: 401}, () => {reads++;}),
    `../#module=workflow-engine&workflowTask=${id}&workflowView=record`);
  assert.equal(reads, 0);
});

test('live record-view is read-only and non-live or invisible links retain Panorama', () => {
  assert.equal(liveTaskNavigation(url(), {status: 200}, () => ({workflow: '02', runtime: {}})), null);
  assert.equal(liveTaskNavigation(url(), {status: 200}, () => {throw new Error('not visible');}), null);
  assert.equal(liveTaskNavigation(url(`task=${id}&view=record`), {status: 200}, () => live),
    `../#module=live-room-management&liveTask=${id}&liveView=record`);
  assert.equal(liveTaskNavigation(url(`task=${id}&view=record`), {status: 200}, () => ({workflow: '02'})), null);
});

test('ambiguous, invalid and unavailable links never redirect', () => {
  assert.equal(liveTaskNavigation(url(`task=${id}&task=${id}`), {status: 401}, () => live), null);
  assert.equal(liveTaskNavigation(url('task=../../other'), {status: 401}, () => live), null);
  assert.equal(liveTaskNavigation(url(`task=${id}&view=x&view=y`), {status: 200}, () => live), null);
  assert.equal(liveTaskNavigation(url(), {status: 503}, () => live), null);
  assert.equal(liveTaskNavigation(url(`task=${id}`, '/other/'), {status: 200}, () => live), null);
});

test('both old URL spellings resolve to the same Hub entry without leaving its prefix', () => {
  for (const path of ['/workflow-panorama', '/workflow-panorama/']) {
    const browserUrl = new URL(`https://hub.invalid/yxb/wis-marketing-hub${path}?task=${id}`);
    const location = liveTaskNavigation(url(`task=${id}`, path), {status: 200}, () => live);
    assert.equal(new URL(location, browserUrl).href,
      `https://hub.invalid/yxb/wis-marketing-hub/#module=live-room-management&liveTask=${id}`);
  }
});

test('anonymous record link can resume through OA into the read-only live detail', () => {
  const original = url(`task=${id}&view=record`);
  const anonymous = liveTaskNavigation(original, {status: 401}, () => {
    throw new Error('anonymous must not read a task');
  });
  assert.equal(anonymous, `../#module=workflow-engine&workflowTask=${id}&workflowView=record`);
  assert.equal(liveTaskNavigation(url(`task=${id}&view=record`), {status: 200}, () => live),
    `../#module=live-room-management&liveTask=${id}&liveView=record`);
});
