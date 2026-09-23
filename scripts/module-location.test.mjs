import test from 'node:test';import assert from 'node:assert/strict';
import {initialModule,embeddedCloudAsset} from '../src/moduleLocation.ts';
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
