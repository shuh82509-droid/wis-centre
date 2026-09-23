import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSourceSnapshot} from './flow-source-health.mjs';
const now=Date.parse('2026-09-20T10:00:00Z');
const good={schemaVersion:1,exportedAt:'2026-09-20T09:59:30Z',cloud:{state:'connected'},remix:{state:'connected'}};
test('recent successful export is healthy',()=>assert.equal(checkSourceSnapshot(good,now).ok,true));
test('stopped, future, and invalid clocks are unhealthy',()=>{
 for(const exportedAt of ['2026-09-20T09:58:29Z','2026-09-20T10:00:06Z','bad'])assert.equal(checkSourceSnapshot({...good,exportedAt},now).ok,false);
});
test('fresh failed source is not healthy',()=>assert.equal(checkSourceSnapshot({...good,cloud:{state:'unavailable'}},now).ok,false));
