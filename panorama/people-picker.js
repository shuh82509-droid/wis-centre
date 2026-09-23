function matchingPeople(items,query,{managersOnly=false}={}){
 const q=String(query||'').trim().toLocaleLowerCase();
 return items.filter(p=>(!managersOnly||['manager','director'].includes(p.role))&&(!q||[p.name,p.number,p.center].join(' ').toLocaleLowerCase().includes(q)));
}
function peoplePicker(name,{value='',label='负责人',managersOnly=false,disabled=false}={}){
 const p=state.people.find(p=>p.number===value),id='person-'+name.replace(/[^a-z0-9_-]/gi,'-');
 return `<div class="person-picker" data-person-picker data-managers-only="${managersOnly}" data-label="${esc(label)}"><input type="hidden" name="${esc(name)}" value="${esc(value)}"><input id="${id}" class="person-search" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-results" aria-label="${esc(label)}，可搜索姓名、工号或中心" placeholder="搜索姓名、工号或中心" value="${esc(p?p.name+' · '+p.center:value)}" ${disabled?'disabled':''}><div class="person-options" id="${id}-results" role="listbox" hidden></div><small class="person-status help">${p?.notificationReady===false?'飞书尚未绑定，请先完成绑定':p?'已选择 '+esc(p.name):'输入后选择一位在职同事'}</small></div>`;
}
function initPeoplePickers(root=document){
 root.querySelectorAll('[data-person-picker]').forEach(box=>{
  if(box.dataset.bound)return;box.dataset.bound='true';const input=box.querySelector('.person-search'),hidden=box.querySelector('input[type=hidden]'),list=box.querySelector('.person-options'),hint=box.querySelector('.person-status');let index=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');index=-1;};
  const results=()=>{const query=hidden.value?'':input.value,rows=matchingPeople(state.people,query,{managersOnly:box.dataset.managersOnly==='true'});list.innerHTML=rows.length?rows.map((p,i)=>`<button type="button" role="option" id="${list.id}-${i}" data-person-value="${esc(p.number)}" aria-selected="false"><b>${esc(p.name)}</b><span>${esc(p.center)} · ${esc(p.number)}</span><small>${p.notificationReady===false?'飞书待绑定':p.role==='director'?'部门负责人':p.role==='manager'?'中心负责人':'在职同事'}</small></button>`).join(''):'<p class="help">没有匹配的在职人员，请换姓名或工号搜索。</p>';list.hidden=false;input.setAttribute('aria-expanded','true');index=-1;};
  const choose=number=>{const p=state.people.find(x=>x.number===number);if(!p)return;hidden.value=p.number;input.value=p.name+' · '+p.center;hint.textContent=p.notificationReady===false?'飞书尚未绑定，请先完成绑定':'已选择 '+p.name;close();hidden.dispatchEvent(new Event('change',{bubbles:true}));};
  input.addEventListener('focus',results);input.addEventListener('input',()=>{hidden.value='';hint.textContent='请选择搜索结果中的同事';results();hidden.dispatchEvent(new Event('change',{bubbles:true}));});
  list.addEventListener('mousedown',e=>e.preventDefault());list.addEventListener('click',e=>{const b=e.target.closest('[data-person-value]');if(b)choose(b.dataset.personValue);});
  input.addEventListener('keydown',e=>{const rows=[...list.querySelectorAll('[role=option]')];if(e.key==='Escape'){close();e.stopPropagation();return;}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(list.hidden)results();const buttons=[...list.querySelectorAll('[role=option]')];if(!buttons.length)return;index=Math.max(0,Math.min(buttons.length-1,index+(e.key==='ArrowDown'?1:-1)));buttons.forEach((b,i)=>b.setAttribute('aria-selected',String(i===index)));input.setAttribute('aria-activedescendant',buttons[index].id);buttons[index].scrollIntoView({block:'nearest'});}else if(e.key==='Enter'&&!list.hidden){e.preventDefault();if(rows[index>=0?index:0])choose(rows[index>=0?index:0].dataset.personValue);}});
  box.addEventListener('focusout',()=>setTimeout(()=>{if(!box.contains(document.activeElement))close();},0));
 });
}
function upgradePeopleSelects(root=document){
 root.querySelectorAll('select').forEach(select=>{
  if(![...select.options].some(o=>state.people.some(p=>p.number===o.value)))return;
  // Studio selectors also include symbolic task roles; keep those explicit.
  if([...select.options].some(o=>['task_owner','task_manager'].includes(o.value)))return;
  const name=select.name;if(!name)return;const label=select.getAttribute('aria-label')||select.closest('label')?.querySelector('span')?.textContent||'负责人';
  const holder=document.createElement('div');holder.innerHTML=peoplePicker(name,{value:select.value,label,managersOnly:['manager'].includes(name),disabled:select.disabled});const replacement=holder.firstElementChild;
  if(select.id)replacement.querySelector('input[type=hidden]').id=select.id;
  select.replaceWith(replacement);
 });initPeoplePickers(root);
}
