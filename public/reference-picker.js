const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const legacyField = {strategicProject:'strategicProjectName',strategy:'strategy',standards:'standards',obecPolicy:'obecPolicy',onesqa:'onesqa',worldClass:'worldClass',kpd:'kpd',hongson:'hongson'};
const label = item => `${item.code ? item.code + ' ' : ''}${item.name || ''}`.trim();
export function referencePath(item, catalog) {
  const result = [], seen = new Set();
  while (item && !seen.has(item.id)) { seen.add(item.id); result.unshift(item); item = catalog?.items?.find(row => row.id === item.parentId); }
  return result;
}
export function referenceSnapshot(item, catalog) {
  const path = referencePath(item,catalog).map(({id,code,name})=>({id,code,name}));
  const fullText = path.map(label).join(' › ');
  return {...item,path,fullText,text:fullText,version:catalog.version,dataVersion:catalog.version};
}
function referenceAncestors(item,catalog) {
  const current=catalog?.items?.find(row=>row.id===item.id)||item;
  return [...(item.path||[]),...referencePath(current,catalog)].filter(parent=>parent.id!==item.id);
}
export function searchReferenceItems(catalog, category, query='', parentId=undefined) {
  const normalize = text => String(text).normalize('NFC').replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-0x0e50)).toLocaleLowerCase('th').replace(/\s+/g,' ').trim();
  const words=normalize(query).split(' ').filter(Boolean);
  return (catalog?.items||[]).filter(item=>item.category===category && (parentId===undefined || (item.parentId||null)===(parentId||null)) && words.every(word=>normalize([item.id,item.source?.locator,referencePath(item,catalog).map(label).join(' ')].join(' ')).includes(word)));
}
function initialState(data,category,catalog) {
  const selected = structuredClone(data.referenceSelections?.[category]||[]);
  let legacy = structuredClone(data.legacyReferences?.[category]||[]);
  if (!data.referenceSelections && !legacy.length) {
    const value = category==='strategicProject' ? data.strategicProjectName||data.strategicProjectId : data[legacyField[category]];
    legacy = (Array.isArray(value)?value:[value]).filter(value=>String(value??'').trim()).map(text=>({text:String(text),resolvedIds:[]}));
  }
  const expanded=[...new Set(selected.flatMap(item=>referenceAncestors(item,catalog).map(parent=>parent.id)))];
  return {selected,legacy,resolutions:null,expanded,query:''};
}
function reviewHtml(value,category) {
  const chosen=value.selected||[];
  const cards=chosen.map(row=>`<li><div class="reference-full-text">${escape(row.fullText||row.text||label(row))}</div>${category!=='strategy'?`<button type="button" class="small danger" data-reference-remove="${escape(row.id)}" aria-label="ยกเลิก ${escape(row.fullText||row.text||label(row))}">ยกเลิกการเลือก</button>`:''}</li>`).join('');
  const legacy=value.legacy||[];
  const resolved=legacy.length && legacy.every(row=>row.resolvedIds?.length && row.resolvedIds.every(id=>chosen.some(item=>item.id===id)));
  return `${category!=='strategy'?`<h4 class="reference-review-title">รายการที่เลือก (${chosen.length})</h4>`:''}<ul class="reference-selected" aria-live="polite">${cards}</ul>${!chosen.length?`<p class="form-help">${category==='strategy'?'กลยุทธ์จะแสดงอัตโนมัติเมื่อเลือกโครงการในข้อ 3':'ยังไม่ได้เลือกรายการ'}</p>`:''}${legacy.length?`<div class="reference-legacy"><strong>${resolved?'ตรวจจับคู่ข้อมูลเดิมแล้ว':'ข้อมูลเดิม — กรุณาตรวจจับคู่กับรายการกลาง'}</strong>${legacy.map(row=>`<p class="text-pre">${escape(row.text)}</p>`).join('')}<p class="form-help">เก็บข้อความเดิมไว้ในประวัติเสมอ เลือกรายการกลางให้ตรงแล้วกดยืนยันก่อนส่งตรวจ</p><button type="button" class="small" data-reference-confirm ${!chosen.length?'disabled':''}>${category==='strategy'?'ยืนยันกลยุทธ์กับข้อความเดิม':'ยืนยันจับคู่ข้อความเดิมกับรายการที่เลือก'}</button></div>`:''}`;
}
function choicesHtml(value,catalog,category) {
  const items=(catalog?.items||[]).filter(item=>item.category===category);
  const matches=searchReferenceItems(catalog,category,value.query);
  if(category==='strategicProject')return `<div role="listbox" aria-label="โครงการตามกลยุทธ์"><button type="button" role="option" aria-selected="${!value.selected.length}" data-reference-option="">ไม่เลือกโครงการ</button>${matches.map(item=>`<button type="button" role="option" aria-selected="${value.selected.some(row=>row.id===item.id)}" data-reference-option="${escape(item.id)}">${escape(label(item))}</button>`).join('')}${!matches.length?'<p class="form-help">ไม่พบรายการที่ตรงกับคำค้น</p>':''}</div>`;
  const visible=new Set(matches.flatMap(item=>referencePath(item,catalog).map(parent=>parent.id)));
  const render=item=>{
    if(!visible.has(item.id))return '';
    const children=items.filter(child=>child.parentId===item.id);
    if(!children.length)return `<label class="reference-check"><input type="checkbox" data-reference-choice="${escape(item.id)}" ${value.selected.some(row=>row.id===item.id)?'checked':''}><span>${escape(label(item))}</span></label>`;
    const open=value.expanded.includes(item.id)||Boolean(value.query.trim());
    return `<div class="reference-group"><label class="reference-check reference-group-label"><input type="checkbox" data-reference-group="${escape(item.id)}" ${open?'checked':''} aria-expanded="${open}" aria-controls="reference-children-${escape(item.id)}"><span><strong>${escape(label(item))}</strong><small>เลือกเพื่อแสดงข้อย่อย</small></span></label><div class="reference-children" id="reference-children-${escape(item.id)}" data-reference-children="${escape(item.id)}" ${open?'':'hidden'}>${children.map(render).join('')}</div></div>`;
  };
  return items.filter(item=>!item.parentId).map(render).join('')||'<p class="form-help">ไม่พบรายการที่ตรงกับคำค้น</p>';
}
function filterHtml() {return '<details class="reference-filter"><summary>ค้นหาในรายการ (ถ้าต้องการ)</summary><label>เลขข้อหรือข้อความภาษาไทย<input type="search" data-reference-filter autocomplete="off" placeholder="ค้นหาในหัวข้อนี้"></label></details>';}
export function projectReferenceEditor(data,catalog,category) {
  const value=initialState(data,category,catalog);
  const issues=(catalog?.issues||[]).filter(issue=>(!issue.category||issue.category===category)&&(!issue.categories||issue.categories.includes(category)));
  const available=(catalog?.items||[]).some(item=>item.category===category);
  let controls='';
  if(category==='strategicProject')controls=`<details class="reference-single-dropdown" data-reference-dropdown><summary data-reference-summary>${escape(value.selected[0]?.fullText||value.selected[0]?.text||'เลือกโครงการตามกลยุทธ์')}</summary>${filterHtml()}<div data-reference-choices>${choicesHtml(value,catalog,category)}</div></details>`;
  else if(category!=='strategy')controls=`<p class="form-help reference-instructions">ติ๊กข้อที่ต้องการเพื่อเลือกทันที หัวข้อที่มีข้อย่อยให้ติ๊กหัวข้อหลักเพื่อแสดงรายการ เมื่อนำเครื่องหมายถูกออกจากหัวข้อหลัก จะยกเลิกข้อย่อยในกลุ่มนั้นด้วย</p>${filterHtml()}<div class="reference-checklist" data-reference-choices>${choicesHtml(value,catalog,category)}</div>`;
  if(category!=='strategy'&&!available)controls='<p class="error">ยังไม่มีข้อมูลอ้างอิงหัวข้อนี้ กรุณาตรวจเอกสารต้นทางก่อนเลือก</p>';
  return `<div class="reference-editor" data-reference-category="${category}" tabindex="-1"><input type="hidden" data-reference-value value="${escape(JSON.stringify(value))}">${controls}<div data-reference-review>${reviewHtml(value,category)}</div>${issues.map(issue=>`<p class="error">${escape(typeof issue==='string'?issue:`${issue.file||''} ${issue.message||issue.topic||''}`)}</p>`).join('')}</div>`;
}
function read(editor) {return JSON.parse(editor.querySelector('[data-reference-value]').value);}
function update(editor,value,catalog,focusSelector='') {
  editor.querySelector('[data-reference-value]').value=JSON.stringify(value);
  editor.querySelector('[data-reference-review]').innerHTML=reviewHtml(value,editor.dataset.referenceCategory);
  const choices=editor.querySelector('[data-reference-choices]');if(choices)choices.innerHTML=choicesHtml(value,catalog,editor.dataset.referenceCategory);
  const summary=editor.querySelector('[data-reference-summary]');if(summary)summary.textContent=value.selected[0]?.fullText||value.selected[0]?.text||'เลือกโครงการตามกลยุทธ์';
  if(focusSelector)editor.querySelector(focusSelector)?.focus?.({preventScroll:true});
}
function selectionChanged(value,before) {return value.selected.length!==before.length||value.selected.some(row=>!before.some(old=>old.id===row.id));}
function invalidateLegacy(value) {value.resolutions=null;value.legacy=value.legacy.map(row=>({...row,resolvedIds:[]}));}
function syncStrategy(editor,value,catalog) {
  const strategyEditor=editor.closest('form').querySelector('[data-reference-category="strategy"]');if(!strategyEditor)return;
  const strategy=read(strategyEditor),previous=strategy.selected,linkedId=value.selected[0]?.strategyId;
  const old=previous.find(row=>row.id===linkedId),item=catalog?.items?.find(row=>row.id===linkedId&&row.category==='strategy');
  strategy.selected=old?[old]:item?[referenceSnapshot(item,catalog)]:[];
  if(selectionChanged(strategy,previous))invalidateLegacy(strategy);
  update(strategyEditor,strategy,catalog);
}
export function collectProjectReferences(form,catalog) {
  const editors=[...form.querySelectorAll('[data-reference-category]')];if(!editors.length)return {};
  const result={referenceSelections:{},referenceDataVersion:catalog?.version||'',legacyReferences:{},legacyReferenceResolutions:{}};
  for(const editor of editors) {
    const category=editor.dataset.referenceCategory,value=read(editor);
    result.referenceSelections[category]=value.selected;result.legacyReferences[category]=value.legacy;
    if(value.resolutions)result.legacyReferenceResolutions[category]=value.resolutions;
    const texts=value.selected.map(row=>row.fullText||row.text||label(row));
    if(category==='strategicProject'){result.strategicProjectId=value.selected[0]?.id||'';result.strategicProjectName=texts[0]||'';}
    else result[legacyField[category]]=category==='standards'?texts:texts.join('\n');
  }
  return result;
}
export function installReferencePickers(document,getCatalog) {
  document.addEventListener('input',event=>{
    const target=event.target;if(!target.matches('[data-reference-filter]'))return;
    const editor=target.closest('[data-reference-category]'),value=read(editor);value.query=target.value;update(editor,value,getCatalog());
  });
  document.addEventListener('change',event=>{
    const target=event.target;if(!target.matches('[data-reference-choice],[data-reference-group]'))return;
    const editor=target.closest('[data-reference-category]'),category=editor.dataset.referenceCategory,catalog=getCatalog(),value=read(editor),before=value.selected;
    const groupId=target.dataset.referenceGroup,choiceId=target.dataset.referenceChoice;
    const item=catalog?.items?.find(row=>row.id===(groupId||choiceId)&&row.category===category);if(!item||category==='strategy'||category==='strategicProject')return;
    let focus='';
    if(groupId) {
      if(!catalog.items.some(row=>row.parentId===groupId))return;
      if(target.checked){if(!value.expanded.includes(groupId))value.expanded.push(groupId);}
      else {
        const inside=row=>row.id===groupId||referenceAncestors(row,catalog).some(parent=>parent.id===groupId);
        value.selected=value.selected.filter(row=>!inside(row));
        value.expanded=value.expanded.filter(id=>!inside(catalog.items.find(row=>row.id===id)||{id}));
        value.query='';const filter=editor.querySelector('[data-reference-filter]');if(filter)filter.value='';
      }
      focus=`[data-reference-group="${groupId}"]`;
    } else {
      if(catalog.items.some(row=>row.parentId===choiceId))return;
      if(target.checked&&!value.selected.some(row=>row.id===choiceId))value.selected=[...value.selected,referenceSnapshot(item,catalog)];
      if(!target.checked)value.selected=value.selected.filter(row=>row.id!==choiceId);
      for(const parent of referencePath(item,catalog).slice(0,-1))if(!value.expanded.includes(parent.id))value.expanded.push(parent.id);
      focus=`[data-reference-choice="${choiceId}"]`;
    }
    if(selectionChanged(value,before))invalidateLegacy(value);
    update(editor,value,catalog,focus);
  });
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-reference-option],[data-reference-remove],[data-reference-confirm]');if(!target)return;
    const editor=target.closest('[data-reference-category]'),category=editor.dataset.referenceCategory,value=read(editor),catalog=getCatalog(),before=value.selected;
    if(target.hasAttribute('data-reference-confirm')) {
      if(!value.selected.length)return;value.resolutions=value.selected.map(row=>row.id);value.legacy=value.legacy.map(row=>({...row,resolvedIds:value.resolutions}));
    } else if(target.hasAttribute('data-reference-remove'))value.selected=value.selected.filter(row=>row.id!==target.dataset.referenceRemove);
    else {
      if(category!=='strategicProject')return;
      const item=catalog?.items?.find(row=>row.id===target.dataset.referenceOption&&row.category===category);
      if(target.dataset.referenceOption&&!item)return;
      value.selected=item?[value.selected.find(row=>row.id===item.id)||referenceSnapshot(item,catalog)]:[];
    }
    if(selectionChanged(value,before)){invalidateLegacy(value);if(category==='strategicProject')syncStrategy(editor,value,catalog);}
    update(editor,value,catalog);
    if(category==='strategicProject'){
      const dropdown=editor.querySelector('[data-reference-dropdown]');if(dropdown)dropdown.open=false;
      editor.querySelector('[data-reference-summary]')?.focus?.({preventScroll:true});
    } else if(target.hasAttribute('data-reference-confirm'))editor.querySelector('[data-reference-confirm]')?.focus?.({preventScroll:true});
    else if(target.hasAttribute('data-reference-remove')){
      const choice=editor.querySelector(`[data-reference-choice="${target.dataset.referenceRemove}"]`);
      const next=choice?.getClientRects?.().length?choice:editor.querySelector('[data-reference-remove]')||editor;
      next.focus?.({preventScroll:true});
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('[data-reference-filter]')){event.preventDefault();return;}
    const target=event.target,editor=target.closest('[data-reference-category="strategicProject"]');if(!editor)return;
    const dropdown=editor.querySelector('[data-reference-dropdown]');if(!dropdown)return;
    if(event.key==='Escape'){event.preventDefault();dropdown.open=false;editor.querySelector('[data-reference-summary]')?.focus?.();return;}
    if(!target.matches('[data-reference-option],[data-reference-summary]'))return;
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();dropdown.open=true;
    const options=[...editor.querySelectorAll('[data-reference-option]')],index=options.indexOf(target);
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowUp'?(index<=0?options.length-1:index-1):(index+1)%options.length;
    options[next]?.focus?.();
  });
}
