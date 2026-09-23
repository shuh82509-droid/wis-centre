// Display-only organization extraction from the two reviewed document boards.
// Never publishes compensation nodes or changes admission/authorization.
import {createHash} from 'node:crypto';
import {validateSourceData} from './organization-daily-sources.mjs';
export const ORGANIZATION_BOARDS=Object.freeze(['CPu6w7iJyhbQ0ebgl5ucb8gYn8c','LiwVwHbN6htdFkb0FDVcIpetnGc']);
const plain=block=>(block.text?.elements||[]).map(e=>e.text_run?.content||'').join('').trim();
export function organizationFromBoards(blocks,boards,readAt){
 const tokens=blocks.filter(b=>b.board?.token).map(b=>b.board.token);
 if(tokens.length!==2||!ORGANIZATION_BOARDS.every(id=>tokens.includes(id)))throw new Error('组织资料画板来源已变化，保留上次成功版本');
 if(!ORGANIZATION_BOARDS.every(id=>Array.isArray(boards[id]?.nodes)&&boards[id].nodes.length&&!boards[id].has_more))throw new Error('组织画板读取不完整，保留上次成功版本');
 const centers=[],leaders=[],directors=[],snapshots=[];
 for(const id of ORGANIZATION_BOARDS){
  for(const node of boards[id].nodes){
   const text=node.text?.text;
   if(typeof text!=='string')continue;
   const [center,...lines]=text.split(/\r?\n/);const detail=lines.join('\n');
   if(!/^(?:品牌营销部|[\p{Script=Han}A-Za-z]+中心[A-Z]?|未分中心)$/u.test(center.trim()))continue;
   if(center!=='品牌营销部'&&!centers.includes(center))centers.push(center);
   if(!/^(?:部门)?负责人[：:]/.test(detail))continue;
   const names=[...detail.matchAll(/\[mentionUser\]([^\[\n(]+)\(enName:[^)]*\)([^\[]*)/g)];
   if(!names.length)throw new Error('组织负责人格式未核验，保留上次成功版本');
   for(const [,rawName,rawNote] of names){
    const name=rawName.trim();if(!name)continue;
    if(center==='品牌营销部'){if(!directors.some(x=>x.name===name))directors.push({name,role:'部门负责人（源文档）'});}
    else if(!leaders.some(x=>x.center===center&&x.name===name))leaders.push({center,name,...(rawNote?.trim()?{note:rawNote.trim().slice(0,80)}:{})});
   }
  }
 }
 for(const block of blocks){
  const caption=plain(block),m=caption.match(/^(营销端|直播端)新架构[（(](\d+)[）)]\s*[-－]\s*(20\d{2})(0[1-9]|1[0-2])$/);
  if(m)snapshots.push({key:m[1]==='营销端'?'marketing':'live',label:m[1]+'历史资料人数',headcount:Number(m[2]),snapshotMonth:m[3]+'-'+m[4]});
 }
 if(!centers.length||!leaders.length||snapshots.length!==2)throw new Error('组织结构或资料日期未完整解析，保留上次成功版本');
 const sourceUrl='https://jqx28l0j4lx.feishu.cn/docx/IE67d4MdKo2xpqxvClLcYeACn15';
 return validateSourceData('organization',{factsDate:null,sourceTitle:'品牌营销部组织架构（源文档）',sourceUrl,centers,leaders,directors,snapshots,
  sourceMetadata:{identity:'application',readAt,sourceUrl,documentId:'IE67d4MdKo2xpqxvClLcYeACn15',rawSha256:createHash('sha256').update(JSON.stringify({blocks,boards})).digest('hex')},
  warnings:['人数为原文所标月份的独立历史快照，不代表今天在职人数，不相加。','组织图用于展示；账号准入、离职状态和模块权限继续以中央权限配置为准。']});
}
