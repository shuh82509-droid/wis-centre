import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('app.js',import.meta.url),'utf8').split('const $=')[0];
for(const [path,base,api] of [
 ['/yxb/wis-marketing-hub/workflow-panorama/','/yxb/wis-marketing-hub/','/yxb/wis-marketing-hub/api/flows/'],
 ['/fd-026222/wis-marketing-hub/workflow-panorama/','/fd-026222/wis-marketing-hub/','/fd-026222/wis-marketing-hub/api/flows/'],
 ['/fd-026222/wis-marketing-hub/l2-candidate/workflow-panorama/','/fd-026222/wis-marketing-hub/','/fd-026222/wis-marketing-hub/l2-candidate/api/flows/'],
 ['/another-hub/workflow-panorama','/another-hub/','/another-hub/api/flows/']
])test(`迁移路径 ${path}`,()=>{
 const links=[{},{}];const c={location:{pathname:path},document:{querySelectorAll:()=>links}};
 const result=vm.runInNewContext(source+';({BASE,API})',c);
 assert.equal(result.BASE,base);assert.equal(result.API,api);assert.deepEqual(links.map(a=>a.href),[base,base]);
});
test('无流程入口时拒绝猜测旧服务器地址',()=>assert.throws(()=>vm.runInNewContext(source,{location:{pathname:'/unrelated/'}}),/流程入口/));
