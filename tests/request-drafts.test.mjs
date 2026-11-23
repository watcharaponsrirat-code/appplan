import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mutate, totals, visibleState } from '../src/domain.mjs';
import { openDatabase } from '../src/database.mjs';
import { readSchoolReferenceCatalog } from '../src/project-references.mjs';

const actor=(role,id=role)=>({id,name:role,roles:[role]});
const teacher=actor('teacher'), other=actor('teacher','other');
const types=['unable','items','spend','quarter','purchase','budget'];
const catalog=readSchoolReferenceCatalog();
const data=()=>({title:'TEST ONLY request before approval',academicYear:'2569',fiscalYear:'2570',term:'2',group:'ทดสอบ',responsible:'ครูทดสอบ',
  referenceSelections:{strategicProject:[{id:catalog.items.find(item=>item.category==='strategicProject').id}]},projectType:'new',
  rationale:'ทดสอบ',objectives:'ทดสอบ',quantitativeTarget:'ทดสอบ',qualitativeTarget:'ทดสอบ',steps:'ทดสอบ',startDate:'2026-11-11',endDate:'2026-11-20',evaluation:'ทดสอบ',expectedResults:'ทดสอบ',quarter:'ไตรมาสเดิม',
  resources:[{name:'ทดสอบ',quantity:1,unit:'ชุด',unitPrice:100000,source:'TEST SOURCE',spending:[{month:'2026-11',amount:100000}]}]});
const act=(state,user,action,input={})=>mutate(state,user,{action,...input});
function transition(state,collection,id,user,action,decision){return act(state,user,action,{id,version:state[collection].find(row=>row.id===id).version,decision});}
function makeProject(state,target='draft') {
  let p=act(state,teacher,'project.save',{data:data()});
  if(target==='draft')return p;
  p=transition(state,'projects',p.id,teacher,'project.submit');if(target==='submitted')return p;
  p=transition(state,'projects',p.id,actor('planner'),'project.review','forward');if(target==='reviewed')return p;
  return transition(state,'projects',p.id,actor('director'),'project.approve','approve');
}
function saveRequest(state,p,type){return act(state,teacher,'request.save',{projectId:p?.id||null,type,reason:'ทดสอบคำขอก่อนโครงการอนุมัติ',source:'TEST SOURCE',amount:10000});}

test('all request types can save and submit for draft, submitted, reviewed and approved projects without changing project or budget',()=>{
  for(const projectStatus of ['draft','submitted','reviewed','approved'])for(const type of types){
    const state={},p=makeProject(state,projectStatus),before=structuredClone(state.projects),versions=structuredClone(state.versions),outbox=structuredClone(state.outbox),balance=totals(state,p.id);
    let request=saveRequest(state,p,type);
    assert.equal(request.original.title,p.data.title);assert.equal(request.original.quarter,'ไตรมาสเดิม');
    request=transition(state,'requests',request.id,teacher,'request.submit');assert.equal(request.status,'submitted',`${projectStatus}/${type}`);
    assert.deepEqual(state.projects,before);assert.deepEqual(state.versions,versions);assert.deepEqual(state.outbox,outbox);assert.deepEqual(totals(state,p.id),balance);assert.equal(state.commitments.length,0);
    assert.throws(()=>act(state,other,'request.save',{projectId:p.id,type,reason:'unauthorized'}),{status:403});
  }
});

test('unlinked drafts remain private and editable, require a project at submission, then autofill when linked',()=>{
  const state={};
  for(const type of types){
    let r=saveRequest(state,null,type);assert.equal(r.projectId,null);assert.equal(r.original,null);
    assert.ok(visibleState(state,teacher).requests.some(row=>row.id===r.id));assert.ok(!visibleState(state,other).requests.some(row=>row.id===r.id));
    assert.ok(visibleState(state,teacher).tasks.some(task=>task.requestId===r.id));
    assert.throws(()=>transition(state,'requests',r.id,teacher,'request.submit'),/เชื่อมโครงการ/);
    assert.throws(()=>act(state,other,'request.save',{id:r.id,version:r.version,type,reason:'not mine'}),{status:403});
    const p=makeProject(state);
    r=act(state,teacher,'request.save',{id:r.id,version:r.version,type,projectId:p.id,reason:r.reason,source:'TEST SOURCE',amount:10000});
    assert.equal(r.original.title,p.data.title);assert.equal(r.baseApprovedVersionId,null);
    r=transition(state,'requests',r.id,teacher,'request.submit');assert.equal(r.status,'submitted');
  }
});

test('approval of a preapproval request never approves a project; procurement waits for approved funds and reserves once',()=>{
  for(const type of types){
    const state={},p=makeProject(state),before=structuredClone(p);let r=saveRequest(state,p,type);
    for(const [role,action,decision] of [['teacher','request.submit'],['planner','request.review','forward'],['director','request.approve','approve']])r=transition(state,'requests',r.id,actor(role),action,decision);
    assert.equal(r.status,'approved');assert.deepEqual(state.projects[0],before);assert.equal(state.versions.length,0);assert.equal(state.outbox.length,0);assert.equal(totals(state,p.id).approved,0);
    if(['items','quarter','budget'].includes(type))assert.equal(r.amendmentApplied,false);
    if(['spend','purchase'].includes(type)){
      assert.throws(()=>act(state,actor('procurement'),'commitment.confirm',{requestId:r.id,requestVersion:r.version}),/วงเงิน/);
      transition(state,'projects',p.id,teacher,'project.submit');transition(state,'projects',p.id,actor('planner'),'project.review','forward');transition(state,'projects',p.id,actor('director'),'project.approve','approve');
      const c=act(state,actor('procurement'),'commitment.confirm',{requestId:r.id,requestVersion:r.version});
      const duplicate=act(state,actor('procurement'),'commitment.confirm',{requestId:r.id,requestVersion:r.version});
      assert.equal(duplicate.id,c.id);assert.equal(totals(state,p.id).reserved,10000);
    }
  }
});

test('SQLite migrates old required project links, preserves request history, and reopens unlinked drafts',()=>{
  const directory=mkdtempSync(join(tmpdir(),'hongson-request-migration-')),path=join(directory,'test.sqlite');let store;
  try{
    store=openDatabase(path,false);const p=store.transaction(state=>makeProject(state)).result;
    const linked=store.transaction(state=>saveRequest(state,p,'unable')).result;store.close();store=null;
    const old=new DatabaseSync(path);
    old.exec(`BEGIN; ALTER TABLE requests RENAME TO requests_new_shape; CREATE TABLE requests(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),body TEXT NOT NULL CHECK(json_valid(body))); INSERT INTO requests SELECT * FROM requests_new_shape; DROP TABLE requests_new_shape; COMMIT;`);old.close();
    store=openDatabase(path,false);assert.equal(store.db.prepare('PRAGMA table_info(requests)').all().find(row=>row.name==='project_id').notnull,0);
    assert.deepEqual(store.load().requests.find(row=>row.id===linked.id),linked);
    const unlinked=store.transaction(state=>saveRequest(state,null,'spend')).result;store.close();store=null;
    store=openDatabase(path,false);assert.deepEqual(store.load().requests.find(row=>row.id===unlinked.id),unlinked);
    assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{store?.close();if(dirname(resolve(directory))===resolve(tmpdir())&&basename(directory).startsWith('hongson-request-migration-'))rmSync(directory,{recursive:true,force:true});}
});
