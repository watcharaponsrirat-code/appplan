import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { searchReferenceItems, referencePath, referenceSnapshot, projectReferenceEditor, collectProjectReferences, installReferencePickers } from '../public/reference-picker.js';
import { projectTemplateHtml } from '../public/project-template.js';
import { readSchoolReferenceCatalog } from '../src/project-references.mjs';
// UI behavior uses synthetic data independently of private local originals.
const catalog=readSchoolReferenceCatalog(new URL('../public/school-reference-data.example.json',import.meta.url));
const row=id=>catalog.items.find(item=>item.id===id);
const escaped=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

test('private catalog matches all eight originals with complete category counts and unique hierarchical IDs',{
  skip:!existsSync(new URL('../public/school-reference-data.json',import.meta.url))&&'Private school catalog is not included in the public source bundle',
},()=>{
  const catalog=readSchoolReferenceCatalog();
  const row=id=>catalog.items.find(item=>item.id===id);
  assert.deepEqual(catalog.issues,[]);assert.equal(catalog.sources.length,8);
  for(const source of catalog.sources){const original=readFileSync(new URL('../references/'+source.file,import.meta.url));assert.equal(createHash('sha256').update(original).digest('hex'),source.sha256,source.file);}
  assert.deepEqual(Object.fromEntries(['strategy','strategicProject','standards','obecPolicy','onesqa','worldClass','kpd','hongson'].map(category=>[category,catalog.items.filter(item=>item.category===category).length])),{strategy:5,strategicProject:21,standards:26,obecPolicy:71,onesqa:21,worldClass:27,kpd:29,hongson:7});
  assert.equal(new Set(catalog.items.map(item=>item.id)).size,catalog.items.length);
  for(const item of catalog.items){assert.ok(item.name);assert.ok(catalog.sources.some(source=>source.file===item.source.file));if(item.parentId)assert.equal(row(item.parentId).category,item.category);if(item.category==='strategicProject')assert.equal(row(item.strategyId).category,'strategy');}
  for(const letter of ['O','N'])assert.equal(catalog.items.filter(item=>item.category==='hongson'&&item.code===letter).length,2);
});

test('search finds Thai text, Arabic and Thai item numbers, including nested numbers and ancestor context',()=>{
  assert.ok(searchReferenceItems(catalog,'standards','อ่าน').some(item=>item.id==='demo:standards:1.1.1'));
  assert.ok(searchReferenceItems(catalog,'standards','1.1.1').some(item=>item.id==='demo:standards:1.1.1'));
  assert.ok(searchReferenceItems(catalog,'standards','๑.๑.๑').some(item=>item.id==='demo:standards:1.1.1'));
  assert.equal(searchReferenceItems(catalog,'standards','not a real option').length,0);
  assert.ok(searchReferenceItems(catalog,'standards','คุณภาพ อ่าน').some(item=>item.id==='demo:standards:1.1.1'));
  assert.deepEqual(searchReferenceItems(catalog,'standards','',null).map(item=>item.id),['demo:standards:1','demo:standards:2','demo:standards:3']);
  assert.equal(searchReferenceItems(catalog,'standards','','demo:standards:1.1').length,6);
  assert.equal(searchReferenceItems(catalog,'standards','','demo:standards:1.2').length,4);
  assert.ok(searchReferenceItems(catalog,'standards','','demo:standards:2').every(item=>item.id.startsWith('demo:standards:2.')));
});

const categories=['strategicProject','strategy','standards','obecPolicy','onesqa','worldClass','kpd','hongson'];
const unescaped=s=>s.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const savedState=html=>JSON.parse(unescaped(html.match(/data-reference-value value="([^"]*)"/)[1]));

// A DOM event fixture runs the production event handlers. It does not claim
// browser layout, dropdown keyboard interaction or print pagination coverage.
function fixture(data={},liveCatalog=catalog) {
  const handlers={},editors=[];
  const form={querySelectorAll:()=>editors,querySelector:selector=>editors.find(editor=>selector===`[data-reference-category="${editor.dataset.referenceCategory}"]`)};
  for(const category of categories){
    const html=projectReferenceEditor(data,liveCatalog,category);
    const nodes={
      '[data-reference-value]':{value:JSON.stringify(savedState(html))},
      '[data-reference-review]':{innerHTML:''},
      '[data-reference-choices]':{innerHTML:''},
      '[data-reference-summary]':{innerHTML:'',textContent:''},
      '[data-reference-dropdown]':{open:true},
      '[data-reference-filter]':{value:'',focus:()=>{}},
    };
    editors.push({dataset:{referenceCategory:category},querySelector:selector=>nodes[selector]||null,querySelectorAll:()=>[],closest:()=>form,nodes,html});
  }
  installReferencePickers({addEventListener:(name,handler)=>{handlers[name]=handler;}},()=>liveCatalog);
  const editor=category=>editors.find(item=>item.dataset.referenceCategory===category);
  const read=category=>JSON.parse(editor(category).nodes['[data-reference-value]'].value);
  const node=(category,attribute,id='',checked=false)=>{
    const datasetKey=attribute.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    const target={dataset:{[datasetKey]:id},value:id,checked,type:'checkbox',hasAttribute:name=>name===attribute,getAttribute:name=>name===attribute?id:null};
    target.matches=selector=>selector.split(',').some(part=>part.trim()===`[${attribute}]`);
    target.closest=selector=>selector==='[data-reference-category]'?editor(category):selector==='form'?form:target.matches(selector)?target:null;
    return target;
  };
  const change=(category,attribute,id,checked=true)=>handlers.change({target:node(category,attribute,id,checked)});
  const click=(category,attribute,id='')=>handlers.click({target:node(category,attribute,id)});
  const filter=(category,query)=>{const target=node(category,'data-reference-filter');target.value=query;handlers.input({target});};
  const choices=category=>editor(category).nodes['[data-reference-choices]'].innerHTML;
  return {form,editor,read,change,click,filter,choices,handlers};
}

test('all top-level groups and HONGSON choices are immediately visible with one filter and no add step',()=>{
  for(const category of categories.filter(category=>!['strategy','strategicProject'].includes(category))){
    const html=projectReferenceEditor({},catalog,category);
    assert.equal((html.match(/data-reference-filter/g)||[]).length,1,category);
    assert.doesNotMatch(html,/data-reference-add|data-reference-level|data-reference-search|data-reference-result/,category);
    assert.doesNotMatch(html,/data-reference-dropdown/,category);
    for(const item of searchReferenceItems(catalog,category,'',null)){
      const attribute=catalog.items.some(child=>child.parentId===item.id)?'data-reference-group':'data-reference-choice';
      assert.ok(html.includes(`${attribute}="${item.id}"`),`${category}: ${item.id}`);
      assert.ok(html.includes(escaped(item.name)),`${item.id} has its complete name`);
    }
  }
  const hongson=projectReferenceEditor({},catalog,'hongson');
  assert.equal((hongson.match(/data-reference-choice=/g)||[]).length,7);
  const strategic=projectReferenceEditor({},catalog,'strategicProject');
  assert.match(strategic,/data-reference-dropdown/);
  assert.equal((strategic.match(/data-reference-filter/g)||[]).length,1);
  for(const item of catalog.items.filter(item=>item.category==='strategicProject')){
    assert.ok(strategic.includes(`data-reference-option="${item.id}"`));
    assert.ok(strategic.includes(escaped(item.name)));
  }
  assert.doesNotMatch(projectReferenceEditor({},catalog,'strategy'),/data-reference-choice|data-reference-option|data-reference-filter/);
});

test('checking parent groups reveals only their descendants and checking leaves immediately selects them',()=>{
  const ui=fixture();
  ui.change('standards','data-reference-group','demo:standards:1');
  assert.deepEqual(ui.read('standards').selected,[]);
  assert.match(ui.choices('standards'),/data-reference-group="demo:standards:1\.1"/);
  assert.ok(!ui.read('standards').expanded.includes('demo:standards:2'));
  ui.change('standards','data-reference-group','demo:standards:1.1');
  assert.match(ui.choices('standards'),/data-reference-choice="demo:standards:1\.1\.1"/);
  assert.ok(!ui.read('standards').expanded.includes('demo:standards:1.2'));
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  assert.equal(ui.read('standards').selected.length,1);
  assert.ok(ui.read('standards').selected[0].fullText.includes('อ่าน'));
  assert.ok(ui.editor('standards').nodes['[data-reference-review]'].innerHTML.includes(escaped(ui.read('standards').selected[0].fullText)));
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  assert.equal(ui.read('standards').selected.length,1,'repeated checked event does not create a duplicate');
  ui.change('standards','data-reference-choice','demo:standards:1.1.1',false);
  assert.deepEqual(ui.read('standards').selected,[]);
});

test('unchecking a parent removes its descendant selections and collapses nested groups while keeping other groups',()=>{
  const ui=fixture();
  for(const id of ['demo:standards:1','demo:standards:1.1','demo:standards:1.2','demo:standards:2'])ui.change('standards','data-reference-group',id);
  for(const id of ['demo:standards:1.1.1','demo:standards:1.2.4','demo:standards:2.1'])ui.change('standards','data-reference-choice',id);
  ui.change('standards','data-reference-group','demo:standards:1',false);
  assert.deepEqual(ui.read('standards').selected.map(item=>item.id),['demo:standards:2.1']);
  assert.ok(!ui.read('standards').expanded.some(id=>['demo:standards:1','demo:standards:1.1','demo:standards:1.2'].includes(id)));
  assert.ok(ui.read('standards').expanded.includes('demo:standards:2'));
  assert.ok(!ui.read('standards').expanded.includes('demo:standards:1.1'));
  ui.click('standards','data-reference-remove','demo:standards:2.1');
  assert.deepEqual(ui.read('standards').selected,[]);
});

test('one direct filter finds Thai text and numbers inside the same selectable tree without creating choices',()=>{
  const ui=fixture();
  for(const query of ['อ่าน','1.1.1','๑.๑.๑']){
    ui.filter('standards',query);
    assert.match(ui.choices('standards'),/data-reference-choice="demo:standards:1\.1\.1"/);
    assert.match(ui.choices('standards'),/data-reference-group="demo:standards:1"/);
    assert.doesNotMatch(ui.choices('standards'),/data-reference-choice="demo:standards:2\.1"/);
  }
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  assert.deepEqual(ui.read('standards').selected.map(item=>item.id),['demo:standards:1.1.1']);
  ui.filter('standards','invented option must not save');
  assert.match(ui.choices('standards'),/ไม่พบรายการ/);
  assert.deepEqual(ui.read('standards').selected.map(item=>item.id),['demo:standards:1.1.1']);
  ui.change('standards','data-reference-choice','invented option must not save');
  ui.change('standards','data-reference-choice','hongson:unknown');
  assert.deepEqual(ui.read('standards').selected.map(item=>item.id),['demo:standards:1.1.1']);
  ui.filter('standards','');
  assert.match(ui.choices('standards'),/data-reference-group="demo:standards:2"/);
});

test('choosing one strategic project immediately derives the matching strategy and allows clearing',()=>{
  const ui=fixture();
  for(const project of catalog.items.filter(item=>item.category==='strategicProject')){
    ui.click('strategicProject','data-reference-option',project.id);
    assert.equal(ui.read('strategy').selected[0].id,project.strategyId);
    assert.equal(ui.read('strategicProject').selected.length,1);
    assert.equal(ui.read('strategicProject').selected[0].id,project.id);
    assert.equal(ui.editor('strategicProject').nodes['[data-reference-dropdown]'].open,false);
  }
  ui.click('strategicProject','data-reference-option','');
  assert.deepEqual(ui.read('strategicProject').selected,[]);
  assert.deepEqual(ui.read('strategy').selected,[]);
  ui.click('strategicProject','data-reference-option',catalog.items.find(item=>item.category==='strategicProject').id);
  ui.click('strategicProject','data-reference-remove',ui.read('strategicProject').selected[0].id);
  assert.deepEqual(ui.read('strategy').selected,[]);
});

test('legacy text is preserved and confirmation resets only when the selection changes',()=>{
  const legacy='มาตรฐานเดิม <เก็บทั้งข้อความ>';const ui=fixture({standards:[legacy]});
  assert.equal(ui.read('standards').legacy[0].text,legacy);
  assert.deepEqual(ui.read('standards').selected,[]);
  const html=projectReferenceEditor({standards:[legacy]},catalog,'standards');
  assert.match(html,/ข้อมูลเดิม/);
  assert.ok(html.includes(escaped(legacy)));
  assert.ok(!html.includes(legacy));
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  assert.deepEqual(ui.read('standards').legacy[0].resolvedIds,[]);
  ui.click('standards','data-reference-confirm');
  assert.deepEqual(ui.read('standards').legacy[0].resolvedIds,['demo:standards:1.1.1']);
  ui.filter('standards','อ่าน');
  ui.change('standards','data-reference-group','demo:standards:2');
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  ui.click('standards','data-reference-remove','does-not-exist');
  assert.deepEqual(ui.read('standards').legacy[0].resolvedIds,['demo:standards:1.1.1'],'filtering, expanding and no-op selection leave confirmation intact');
  assert.deepEqual(collectProjectReferences(ui.form,catalog).legacyReferenceResolutions.standards,['demo:standards:1.1.1']);
  ui.change('standards','data-reference-choice','demo:standards:2.1');
  assert.deepEqual(ui.read('standards').legacy[0].resolvedIds,[]);
  ui.click('standards','data-reference-confirm');
  ui.click('standards','data-reference-remove','demo:standards:1.1.1');
  assert.equal(ui.read('standards').legacy[0].text,legacy);
  assert.deepEqual(ui.read('standards').legacy[0].resolvedIds,[]);
});

test('all multi-select categories persist full versioned snapshots and reopen the selected ancestor groups',()=>{
  const ui=fixture();
  for(const category of categories.filter(category=>!['strategy','strategicProject'].includes(category))){
    const leaves=catalog.items.filter(item=>item.category===category&&!catalog.items.some(child=>child.parentId===item.id)).slice(0,2);
    for(const item of leaves)ui.change(category,'data-reference-choice',item.id);
  }
  const data=collectProjectReferences(ui.form,catalog),reopened=fixture(data);
  assert.equal(data.referenceDataVersion,catalog.version);
  for(const category of categories.filter(category=>!['strategy','strategicProject'].includes(category))){
    assert.equal(data.referenceSelections[category].length,2);
    assert.deepEqual(reopened.read(category).selected,data.referenceSelections[category]);
    for(const snapshot of data.referenceSelections[category]){
      assert.equal(snapshot.version,catalog.version);
      assert.equal(snapshot.fullText,referenceSnapshot(row(snapshot.id),catalog).fullText);
      for(const ancestor of referencePath(row(snapshot.id),catalog).slice(0,-1))assert.ok(reopened.read(category).expanded.includes(ancestor.id));
      assert.ok(reopened.editor(category).html.includes(`data-reference-choice="${snapshot.id}"`));
      assert.ok(reopened.editor(category).html.includes(escaped(snapshot.fullText)));
    }
  }
  assert.deepEqual(collectProjectReferences(reopened.form,catalog).referenceSelections,data.referenceSelections);
});

test('repeated HONGSON letters remain distinct choices and frozen text survives catalog edits and printing',()=>{
  const ui=fixture();
  const repeated=catalog.items.filter(item=>item.category==='hongson'&&['O','N'].includes(item.code));
  for(const item of repeated)ui.change('hongson','data-reference-choice',item.id);
  const data=collectProjectReferences(ui.form,catalog),snapshots=data.referenceSelections.hongson;
  assert.equal(snapshots.length,4);
  assert.equal(new Set(snapshots.map(item=>item.id)).size,4);
  const changed=structuredClone(catalog);
  for(const snapshot of snapshots)changed.items.find(item=>item.id===snapshot.id).name='CHANGED CENTRAL TEXT';
  const reopened=projectReferenceEditor(data,changed,'hongson');
  const printed=projectTemplateHtml({...data,hongson:'TAMPERED TEXT'});
  for(const snapshot of snapshots){
    assert.ok(reopened.includes(escaped(snapshot.fullText)));
    assert.ok(printed.includes(escaped(snapshot.fullText)));
  }
  assert.doesNotMatch(printed,/TAMPERED TEXT|CHANGED CENTRAL TEXT/);
  assert.deepEqual(referencePath(row('demo:standards:1.1.1'),catalog).map(item=>item.id),['demo:standards:1','demo:standards:1.1','demo:standards:1.1.1']);
});

test('choice labels and selected reviews retain long complete text and safely escape document markup',()=>{
  const changed=structuredClone(catalog);
  const selectedItem=changed.items.find(item=>item.category==='hongson');
  selectedItem.name='ชื่อเต็มภาษาไทย '.repeat(30)+'<script>bad()</script> & "ข้อความ"';
  const initial=projectReferenceEditor({},changed,'hongson');
  assert.ok(initial.includes(escaped(selectedItem.code+' '+selectedItem.name)));
  assert.doesNotMatch(initial,/<script>bad\(\)<\/script>/);
  const ui=fixture({},changed);
  ui.change('hongson','data-reference-choice',selectedItem.id);
  const snapshot=ui.read('hongson').selected[0];
  assert.equal(snapshot.fullText,selectedItem.code+' '+selectedItem.name);
  assert.ok(ui.editor('hongson').nodes['[data-reference-review]'].innerHTML.includes(escaped(snapshot.fullText)));
  assert.ok(projectTemplateHtml(collectProjectReferences(ui.form,changed)).includes(escaped(snapshot.fullText)));
});

test('reselecting the same strategic project preserves its saved text and linked strategy after catalog changes',()=>{
  const ui=fixture(),item=catalog.items.find(item=>item.category==='strategicProject');
  ui.click('strategicProject','data-reference-option',item.id);
  const saved=collectProjectReferences(ui.form,catalog),changed=structuredClone(catalog);
  changed.version='next-version';
  changed.items.find(row=>row.id===item.id).name='ข้อความโครงการฉบับใหม่';
  changed.items.find(row=>row.id===item.id).strategyId=changed.items.find(row=>row.category==='strategy'&&row.id!==item.strategyId).id;
  changed.items.find(row=>row.id===item.strategyId).name='ข้อความกลยุทธ์ฉบับใหม่';
  const reopened=fixture(saved,changed);
  reopened.click('strategicProject','data-reference-option',item.id);
  assert.deepEqual(collectProjectReferences(reopened.form,changed).referenceSelections,saved.referenceSelections);
  const printed=projectTemplateHtml(collectProjectReferences(reopened.form,changed));
  assert.ok(printed.includes(escaped(saved.referenceSelections.strategicProject[0].fullText)));
  assert.ok(printed.includes(escaped(saved.referenceSelections.strategy[0].fullText)));
  assert.doesNotMatch(printed,/ข้อความโครงการฉบับใหม่|ข้อความกลยุทธ์ฉบับใหม่/);
});

test('retired selected items remain reviewable and removable through their saved ancestor group',()=>{
  const ui=fixture();
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  ui.change('standards','data-reference-choice','demo:standards:2.1');
  const saved=collectProjectReferences(ui.form,catalog),changed=structuredClone(catalog);
  changed.items=changed.items.filter(item=>item.id!=='demo:standards:1.1.1');
  const reopened=fixture(saved,changed);
  assert.ok(reopened.editor('standards').html.includes(escaped(saved.referenceSelections.standards[0].fullText)));
  assert.deepEqual(collectProjectReferences(reopened.form,changed).referenceSelections.standards,saved.referenceSelections.standards);
  reopened.change('standards','data-reference-group','demo:standards:1',false);
  assert.deepEqual(reopened.read('standards').selected.map(item=>item.id),['demo:standards:2.1']);
  const removed=fixture(saved,changed);
  removed.click('standards','data-reference-remove','demo:standards:1.1.1');
  assert.deepEqual(removed.read('standards').selected.map(item=>item.id),['demo:standards:2.1']);
});

test('moved catalog items expand and clear with either saved or current ancestors without changing frozen text',()=>{
  const ui=fixture();
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  const saved=collectProjectReferences(ui.form,catalog),changed=structuredClone(catalog);
  changed.items.find(item=>item.id==='demo:standards:1.1.1').parentId='demo:standards:2';
  for(const group of ['demo:standards:1','demo:standards:2']){
    const reopened=fixture(saved,changed);
    assert.ok(reopened.read('standards').expanded.includes('demo:standards:2'));
    assert.deepEqual(collectProjectReferences(reopened.form,changed).referenceSelections.standards,saved.referenceSelections.standards);
    reopened.change('standards','data-reference-group',group,false);
    assert.deepEqual(reopened.read('standards').selected,[]);
  }
});

test('pressing Enter while filtering never submits the project or changes selections',()=>{
  const ui=fixture();
  ui.change('hongson','data-reference-choice',catalog.items.find(item=>item.category==='hongson').id);
  const before=collectProjectReferences(ui.form,catalog);
  let prevented=false;
  ui.handlers.keydown({key:'Enter',target:{matches:selector=>selector==='[data-reference-filter]'},preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,true);
  assert.deepEqual(collectProjectReferences(ui.form,catalog),before);
});

test('legacy confirmation and unavailable checkbox removal retain keyboard focus within the category',()=>{
  const ui=fixture({standards:['ข้อความเดิม']});
  ui.change('standards','data-reference-choice','demo:standards:1.1.1');
  let focused='';
  ui.editor('standards').nodes['[data-reference-confirm]']={focus:()=>{focused='confirm';}};
  ui.click('standards','data-reference-confirm');
  assert.equal(focused,'confirm');
  ui.editor('standards').focus=()=>{focused='editor';};
  ui.click('standards','data-reference-remove','demo:standards:1.1.1');
  assert.equal(focused,'editor');
});
