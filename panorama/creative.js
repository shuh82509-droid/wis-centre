const creativeStateLabels={generated:'待编写提交',pending_review:'待审核',pending_team_lead:'待组长审核',pending_supervisor:'待主管终审',returned_to_creator:'退回修改',approved:'审核通过并归档',archived:'已归档'};
function creativeTaskHtml(t){
 const c=t.runtime.creative;if(!c)return '';
 return `<div class="drawer-summary"><b>创意来源持续跟进</b><p>原始状态：${esc(creativeStateLabels[c.status]||c.status)} · 最近核验：${fmt(c.checkedAt)}</p><p class="help">在原创意系统完成提交、审核或修改，流程引擎同步当前办理人，来源服务独立发送飞书提醒。来源编号：${esc(c.recordId)}</p>${c.issue?'<div class="alert-box">'+esc(c.issue)+'</div>':''}<a class="button primary" href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer">前往创意工作台办理 ↗</a></div>`;
}
async function openCreativeConnect(){
 if(!state.overview.access.canManage||isConfigurationOnly())return;
 const [connection,people]=await Promise.all([api('creative/status'),api('people')]);state.people=people.items;
 if(connection.sources.idea?.automatic){
  const info=connection.sources.idea;
  showModal('创意任务自动同步','在创意工作台创建任务后，系统会在约 10 秒内自动建单。',
   '<div class="drawer-summary"><b>'+esc(info.state==='connected'?'已连接创意工作台':info.state==='attention'?'已连接，部分任务待核对':'正在连接创意工作台')+'</b><p>'+esc(info.issue||'提交、组长审核、主管终审与退回修改自动同步，无需手动接入。')+'</p><p>最近核验：'+fmt(info.checkedAt)+'</p><a class="button primary" href="'+esc(info.url)+'" target="_blank" rel="noopener noreferrer">打开创意工作台 ↗</a></div>'+
   connection.watches.map(w=>'<p><button type="button" class="button" data-creative-task="'+esc(w.taskId)+'">查看 '+esc(w.recordId)+'</button>'+(w.issue?' · '+esc(w.issue):'')+'</p>').join(''),'关闭');
  $('#edit-form').onsubmit=e=>{e.preventDefault();closeModal();};
  $('#edit-form').querySelectorAll('[data-creative-task]').forEach(b=>b.addEventListener('click',async()=>{closeModal();await openTask(b.dataset.creativeTask);}));
  return;
 }
 showModal('接入创意任务','读取原任务的真实状态，同步到流程引擎。',
  '<label class="field"><span>创意系统</span><select name="source"><option value="idea">Idea OS 创意工作台</option><option value="ppyxzx">品牌营销创意平台 · 选题审核</option></select></label>'+
  '<p id="creative-source-info" class="help"></p><label class="field"><span>来源任务</span><select name="recordId" required><option value="">正在读取…</option></select></label>'+
  '<button type="button" id="creative-more" class="button quiet" hidden>加载更早的任务</button>'+
  '<div id="creative-proposer"><label class="field"><span>选题提交人（来源缺少工号时明确指定）</span><select name="owner">'+peopleOptions()+'</select></label></div>'+
  '<label class="field"><span>审核人（Idea OS 已指定的审核人优先）</span><select name="reviewer" required>'+peopleOptions()+'</select></label>'+
  '<label class="field"><span>升级负责人 / 未指定时的主管审核人</span><select name="manager" required>'+peopleOptions(state.overview.access.number,true)+'</select></label>'+
  '<p class="help">实际节点负责人按工号匹配。飞书未绑定的成员会显示通知待处理，不会转发给其他人。</p>'+
  (connection.watches.length?'<details><summary>已接入 '+connection.watches.length+' 项</summary>'+connection.watches.map(w=>'<p>'+esc(w.recordId)+(w.issue?' · '+esc(w.issue):' · 已接入')+'</p>').join('')+'</details>':''),'接入并通知当前办理人');
 const form=$('#edit-form'),source=form.elements.source,records=form.elements.recordId,info=$('#creative-source-info'),more=$('#creative-more');let request=0,nextCursor=null,loaded=new Map();
 async function load(append=false){
  const token=++request,selected=append?records.value:'',cursor=append?nextCursor:null;
  if(!append){loaded=new Map();nextCursor=null;records.innerHTML='<option value="">正在读取…</option>';records.disabled=true;more.hidden=true;}
  more.disabled=true;$('#creative-proposer').hidden=source.value!=='ppyxzx';form.elements.owner.required=source.value==='ppyxzx';info.textContent='正在核验来源权限…';
  try{
   if(!connection.sources[source.value]?.configured)throw Error('此系统尚未配置业务接口，需先完成来源连接。');
   const data=await api('creative/records?source='+source.value+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(token!==request||!form.isConnected)return;
   const connected=new Set(connection.watches.filter(w=>w.source===source.value).map(w=>w.recordId));
   for(const row of data.items)if(!connected.has(row.id))loaded.set(row.id,row);
   records.innerHTML='<option value="">请选择来源任务</option>'+[...loaded.values()].map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+' · '+esc(creativeStateLabels[x.status]||x.status)+'</option>').join('');records.value=selected;records.disabled=false;
   nextCursor=data.nextCursor||null;more.hidden=!nextCursor;
   info.textContent=`已加载 ${loaded.size} 条可接入任务。`+(nextCursor?'可继续加载更早的任务。':'')+(data.historyAvailable?'同步原审核历史。':'当前来源只提供状态快照，暂不能补回两次同步之间的完整审核历史。');
  }catch(e){if(token!==request||!form.isConnected)return;info.textContent=e.message;if(!append)records.innerHTML='<option value="">来源尚未就绪</option>';}
  finally{if(token===request)more.disabled=false;}
 }
 source.addEventListener('change',()=>load());more.addEventListener('click',()=>load(true));await load();
 setupSubmit(f=>({source:f.get('source'),recordId:f.get('recordId'),owner:f.get('owner')||undefined,reviewer:f.get('reviewer'),manager:f.get('manager')}),(body,key)=>api('creative/watches',{body,key}),async task=>{toast('已接入创意任务，通知送达结果可在任务详情查看。');await refresh();await openTask(task.id);});
}
const flowRoute=location.pathname.match(/^(.*?\/)(?:l2-candidate\/)?workflow-panorama(?:\/|$)/);
if(!flowRoute)throw Error('流程入口路径不正确，请从中枢重新进入。');
