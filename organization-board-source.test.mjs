import test from 'node:test';
import assert from 'node:assert/strict';
import {ORGANIZATION_BOARDS,organizationFromBoards} from './organization-board-source.mjs';
const at='2026-09-23T09:00:00Z';
const blocks=()=>[...ORGANIZATION_BOARDS.map(token=>({board:{token}})),...['营销端新架构（91）-202604','直播端新架构（58）-202608'].map(content=>({text:{elements:[{text_run:{content}}]}}))];
const boards=()=>Object.fromEntries(ORGANIZATION_BOARDS.map((id,i)=>[id,{nodes:i?[{text:{text:'直播中心'}}]:[{text:{text:'营销中心C\n负责人：[mentionUser]曾业高(enName:曾业高)'}},{text:{text:'视频中心\n负责人：[mentionUser]舒豪(enName:舒豪)[mentionUser]何雨庭(enName:何雨庭)（预离职）'}},{text:{text:'品牌营销部\n部门负责人：[mentionUser]赵佳乐(enName:赵佳乐)'}},{text:{text:'薪酬\n工资 123456 私密内容'}}]}]));
test('组织来源仅抽取展示字段，保留人员原文备注且历史人数不冒充今日事实',()=>{
 const data=organizationFromBoards(blocks(),boards(),at);
 assert.equal(data.factsDate,null);assert.deepEqual(data.snapshots.map(x=>[x.headcount,x.snapshotMonth]),[[91,'2026-04'],[58,'2026-08']]);
 assert.deepEqual(data.leaders.find(x=>x.name==='何雨庭'),{center:'视频中心',name:'何雨庭',note:'（预离职）'});
 assert.equal(data.sourceMetadata.identity,'application');assert.ok(!JSON.stringify(data).includes('123456'));assert.ok(data.centers.includes('营销中心C'));
});
test('组织来源有未完整读取、未知画板或格式改变时保留上次版本',()=>{
 const raw=boards();delete raw[ORGANIZATION_BOARDS[1]];assert.throws(()=>organizationFromBoards(blocks(),raw,at),/读取不完整/);
 const changed=blocks();changed[0].board.token='unexpected';assert.throws(()=>organizationFromBoards(changed,boards(),at),/来源已变化/);
 const truncated=boards();truncated[ORGANIZATION_BOARDS[0]].has_more=true;assert.throws(()=>organizationFromBoards(blocks(),truncated,at),/读取不完整/);
 const missing=boards();missing[ORGANIZATION_BOARDS[0]].nodes=[{text:{text:'营销中心C\n负责人：未知新格式'}}];assert.throws(()=>organizationFromBoards(blocks(),missing,at),/格式未核验/);
});
