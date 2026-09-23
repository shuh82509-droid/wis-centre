import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryLocations,FlowDelivery} from './flow-delivery.mjs';

const env={HUB_INTEGRATED_MODE:'1',FLOW_PUBLIC_URL:'https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/'};
test('integrated file and video uploads stay on the deployed hub',()=>{
  const locations=deliveryLocations(env);
  assert.equal(locations.base,'https://hub.fandow.com/yxb/wis-marketing-hub/api/flows/');
  assert.equal(locations.cloudBase,'/yxb/wis-marketing-hub/modules/cloud-manager/api');
  assert.equal(locations.cloudPage,'https://hub.fandow.com/yxb/wis-marketing-hub/#module=cloud-manager');
  const delivery=new FlowDelivery({env});
  const row={id:'attachment_a',filename:'sample.txt',sha256:'abc'};
  assert.equal(delivery.publicAttachment('task_a',row).uploadUrl,locations.base+'runs/task_a/attachments/attachment_a/content');
});
test('invalid integrated origin fails closed instead of silently using old server',()=>{
  for(const url of ['', 'file:///tmp/workflow-panorama/','https://user:pass@example.test/workflow-panorama/','https://example.test/other/'])
    assert.throws(()=>deliveryLocations({...env,FLOW_PUBLIC_URL:url}));
});
test('legacy deployment keeps its original routes',()=>{
  assert.equal(deliveryLocations({}).base,'https://app.fandow.top/fd-026222/wis-marketing-hub/api/flows/');
});
