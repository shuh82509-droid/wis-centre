import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveFeishuService} from './live-feishu-service.mjs';
import {FlowRuntime} from './flow-runtime.mjs';

test('live assignment alarms wait for identity checks and callback transport, not a grant',()=>{
 let connected=false,valid=false,issues=[];
 const s={ready:()=>connected,participants:{bindings:[{number:'A'}],verified:()=>valid, get issues(){return issues;}}};
 const ready=()=>LiveFeishuService.prototype.assignmentChecksReady.call(s);
 assert.equal(ready(),false);connected=true;assert.equal(ready(),false);
 valid=true;assert.equal(ready(),true);connected=false;assert.equal(ready(),false);
 connected=true;valid=false;issues=[{number:'A'}];assert.equal(ready(),true);
});
function runtimeFixture(){
 const tasks=[{id:'live',version:1,runtime:{state:'running',manager:{number:'M'},liveSession:{},nodes:[{owner:{number:'A'},state:'ready'}]}},
 {id:'other',version:1,runtime:{state:'running',manager:{number:'M'},nodes:[{owner:{number:'B'},state:'ready'}]}}];
 const s={tasks};let ready=false;const events=[],notices=[];
 const r={people:()=>[{number:'M',active:true,role:'director'}],canNotify:()=>true,assignmentChecksReady:t=>!t.runtime.liveSession||ready,store:{read:()=>s,transaction:f=>f(s)},ensure(){},iso:()=>new Date().toISOString(),log:(s,t,n,kind)=>(events.push({task:t.id,kind}),{id:'e'}),notify:(s,t,n,kind)=>notices.push({task:t.id,kind})};
 return {r,tasks,events,notices,setReady:v=>ready=v};
}
test('cold live cache produces no false personnel notice and does not pause other flows',()=>{
 const f=runtimeFixture();FlowRuntime.prototype.checkAssignments.call(f.r);
 assert.equal(f.tasks[0].runtime.assignmentIssue,undefined);
 assert.deepEqual(f.notices,[{task:'other',kind:'assignment_attention'}]);
 f.setReady(true);FlowRuntime.prototype.checkAssignments.call(f.r);
 assert.ok(f.tasks[0].runtime.assignmentIssue);assert.equal(f.notices.filter(n=>n.task==='live').length,1);
 FlowRuntime.prototype.checkAssignments.call(f.r);assert.equal(f.notices.filter(n=>n.task==='live').length,1);
});
test('successful revalidation restores an existing live warning without completing work',()=>{
 const f=runtimeFixture();f.setReady(true);FlowRuntime.prototype.checkAssignments.call(f.r);
 f.r.people=()=>[{number:'M',active:true},{number:'A',active:true},{number:'B',active:true}];
 FlowRuntime.prototype.checkAssignments.call(f.r);
 assert.equal(f.tasks[0].runtime.assignmentIssue,undefined);
 assert.ok(f.events.some(e=>e.task==='live'&&e.kind==='assignment_restored'));
 assert.equal(f.tasks[0].runtime.nodes[0].state,'ready');
});
