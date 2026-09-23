import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowExecutionPolicy} from './workflow-execution-policy.mjs';
test('readonly preview cannot run historical background or legacy writes', () => {
  const p=workflowExecutionPolicy({WORKFLOW_WRITES_ENABLED:'false',WORKFLOW_BACKGROUND_ENABLED:'true'});
  assert.equal(p.backgroundEnabled,false);assert.equal(p.legacyWritesEnabled,false);
});
test('pilot scope blocks global background even with explicit background flag', () => {
  const p=workflowExecutionPolicy({FLOW_WRITES_ALLOWED_NUMBERS:' FD-026222 ',WORKFLOW_BACKGROUND_ENABLED:'true'});
  assert.deepEqual(p.writeAccounts,['FD-026222']);assert.equal(p.writesEnabled,true);
  assert.equal(p.backgroundEnabled,false);assert.equal(p.legacyWritesEnabled,false);
});
test('empty pilot list fails closed rather than becoming unrestricted', () => {
  const p=workflowExecutionPolicy({FLOW_WRITES_ALLOWED_NUMBERS:' , '});
  assert.deepEqual(p.writeAccounts,[]);assert.equal(p.backgroundEnabled,false);assert.equal(p.legacyWritesEnabled,false);
});
test('existing unrestricted writer retains behavior and supports background pause', () => {
  assert.equal(workflowExecutionPolicy({}).backgroundEnabled,true);
  const p=workflowExecutionPolicy({WORKFLOW_BACKGROUND_ENABLED:'false'});
  assert.equal(p.writesEnabled,true);assert.equal(p.legacyWritesEnabled,true);assert.equal(p.backgroundEnabled,false);
});
