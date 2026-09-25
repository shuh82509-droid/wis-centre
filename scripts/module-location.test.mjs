import test from 'node:test';import assert from 'node:assert/strict';
import {initialModule,embeddedCloudAsset,linkedLiveTask,workflowReturnTarget} from '../src/moduleLocation.ts';
test('new cloud asset links retain old module entry support',()=>{
 assert.equal(initialModule('#module=cloud-manager'),'cloud-manager');
 assert.equal(initialModule('#module=cloud-manager&asset_id=98419&asset_etag=abcd-1'),'cloud-manager');
 assert.deepEqual(embeddedCloudAsset('#module=cloud-manager&asset_id=98419&asset_etag=abcd-1'),{id:'98419',etag:'abcd-1'});
});
test('asset parameters never propagate to another module or from ambiguous identity',()=>{
 assert.equal(embeddedCloudAsset('#module=ai-first-creation&asset_id=98419'),null);
 assert.equal(embeddedCloudAsset('#module=cloud-manager&asset_id=1&asset_id=2'),null);
 assert.equal(initialModule('#module=cloud-manager&module=ai-first-creation'),null);
 assert.equal(initialModule('#module=https://evil.invalid'),null);
 assert.equal(embeddedCloudAsset('#module=cloud-manager&asset_id=1e2'),null);
});
test('live task deep link stays in its module and rejects ambiguous task identity',()=>{
 assert.equal(initialModule('#module=live-room-management&liveTask=task_abc123'),'live-room-management');
 assert.equal(linkedLiveTask('#module=live-room-management&liveTask=task_abc123'),'task_abc123');
 for(const hash of ['#module=workflow-engine&liveTask=task_abc123','#module=live-room-management&liveTask=task_abc123&liveTask=task_other','#module=live-room-management&liveTask=https://evil.invalid','#module=live-room-management&module=other&liveTask=task_abc123'])assert.equal(linkedLiveTask(hash),null);
});
test('OA login return target is a same-origin protected workflow task, never an arbitrary URL',()=>{
 const href='https://hub.fandow.com/yxb/wis-marketing-hub/?old=1#module=workflow-engine&workflowTask=task_abc123';
 assert.equal(workflowReturnTarget(new URL(href).hash,href),'https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/?task=task_abc123');
 assert.equal(workflowReturnTarget('#module=workflow-engine&workflowTask=task_abc123&workflowView=record',href),'https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/?task=task_abc123&view=record');
 for(const hash of ['#module=live-room-management&workflowTask=task_abc123','#module=workflow-engine&workflowTask=https://evil.invalid','#module=workflow-engine&workflowTask=task_abc123&workflowTask=task_other','#module=workflow-engine&module=other&workflowTask=task_abc123','#module=workflow-engine&workflowTask=task_abc123&workflowView=https://evil.invalid','#module=workflow-engine&workflowTask=task_abc123&workflowView=record&workflowView=edit'])assert.equal(workflowReturnTarget(hash,href),null);
});
