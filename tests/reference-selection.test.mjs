import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchoolReferences, prepareReferenceAction, readSchoolReferenceCatalog, REFERENCE_CATEGORIES } from '../src/project-references.mjs';
import { mutate, validateProject } from '../src/domain.mjs';
import { projectTemplateHtml } from '../public/project-template.js';

// A deliberately small test catalog exercises revisions; production data comes from references.
const catalog = () => ({ version: 'test-edition-1', items: [
  { id: 'test-strategy-1', category: 'strategy', code: '1', name: 'กลยุทธ์ทดสอบหนึ่ง', source: { file: 'TEST ONLY' } },
  { id: 'test-strategy-2', category: 'strategy', code: '2', name: 'กลยุทธ์ทดสอบสอง', source: { file: 'TEST ONLY' } },
  { id: 'test-project', category: 'strategicProject', code: '1.1', name: 'โครงการสำหรับทดสอบ', strategyId: 'test-strategy-1', source: { file: 'TEST ONLY', page: 2 } },
  { id: 'test-standard', category: 'standards', code: '1', name: 'มาตรฐานหลักทดสอบ', source: { file: 'TEST ONLY' } },
  { id: 'test-standard-child', category: 'standards', code: '1.1', name: 'ตัวชี้วัดทดสอบ', parentId: 'test-standard', source: { file: 'TEST ONLY', page: 3 } },
  { id: 'test-hongson-o1', category: 'hongson', code: 'O', name: 'องค์ประกอบ O แรก', source: { file: 'TEST ONLY' } },
  { id: 'test-hongson-o2', category: 'hongson', code: 'O', name: 'องค์ประกอบ O ที่สอง', source: { file: 'TEST ONLY' } },
] });
const input = (referenceSelections = {}) => ({ referenceSelections: { strategicProject: [{ id: 'test-project' }], ...referenceSelections } });
const normalize = (data, options = {}) => normalizeSchoolReferences(data, { catalog: catalog(), ...options });

test('server resolves full hierarchy and the exact strategy, ignoring forged labels and editions', () => {
  const saved = normalize({ ...input({ standards: [{ id: 'test-standard-child', name: 'ปลอม', text: 'ปลอม', version: 'ปลอม' }] }), strategy: 'กลยุทธ์ปลอม', referenceDataVersion: 'ปลอม' });
  assert.equal(saved.strategy, '1 กลยุทธ์ทดสอบหนึ่ง');
  assert.equal(saved.strategicProjectName, '1.1 โครงการสำหรับทดสอบ');
  assert.equal(saved.referenceSelections.strategy[0].id, 'test-strategy-1');
  assert.equal(saved.standards[0], '1 มาตรฐานหลักทดสอบ › 1.1 ตัวชี้วัดทดสอบ');
  assert.equal(saved.referenceSelections.standards[0].version, 'test-edition-1');
  assert.deepEqual(saved.referenceSelections.standards[0].path.map(row => row.id), ['test-standard', 'test-standard-child']);
  assert.equal(saved.referenceSelections.strategicProject[0].source.page, 2);
  assert.ok(saved.referenceSelections.strategicProject[0].snapshotAt);
});

test('unknown IDs, category mismatches, duplicates and conflicting project/strategy pairs fail', () => {
  for (const selections of [
    { standards: [{ id: 'no-such-id' }] },
    { standards: [{ id: 'test-project' }] },
    { standards: [{ id: 'test-standard' }] },
    { standards: [{ id: 'test-standard-child' }, { id: 'test-standard-child' }] },
    { strategicProject: [{ id: 'test-project' }, { id: 'test-project' }] },
    { strategy: [{ id: 'test-strategy-2' }] },
    { strangeCategory: [] },
  ]) assert.throws(() => normalize(input(selections)), { status: 422 });
  assert.throws(() => normalize(input({ strategicProject: [], strategy: ['test-strategy-1'] })), /เลือกโครงการ/);
  const broken = catalog(); broken.items.find(row => row.id === 'test-standard-child').parentId = 'test-strategy-1';
  assert.throws(() => normalize(input({ standards: ['test-standard-child'] }), { catalog: broken }), /หัวข้อหลัก/);
});

test('HONGSON components with the same letter retain distinct IDs and full names', () => {
  const saved = normalize(input({ hongson: ['test-hongson-o1', 'test-hongson-o2'] }));
  assert.equal(saved.referenceSelections.hongson.length, 2);
  assert.match(saved.hongson, /O องค์ประกอบ O แรก\nO องค์ประกอบ O ที่สอง/);
});

test('stored snapshots survive catalog edits and deletion while browser-provided snapshots are untrusted', () => {
  const original = normalize(input({ standards: ['test-standard-child'] }));
  const changed = catalog(); changed.version = 'test-edition-2';
  for (const row of changed.items) row.name = 'ชื่อเปลี่ยนแล้ว';
  changed.items = changed.items.filter(row => row.id !== 'test-standard-child');
  const reopened = normalize(original, { previous: original, catalog: changed, strict: true });
  assert.deepEqual(reopened.referenceSelections, original.referenceSelections);
  assert.deepEqual(reopened.standards, original.standards);
  assert.equal(reopened.referenceDataVersion, original.referenceDataVersion);
  assert.throws(() => normalize(original, { catalog: changed }), /ไม่พบรหัส/);
  const removed = normalize(input({ strategicProject: [] }), { previous: original });
  assert.equal(removed.strategicProjectId, '');
  assert.equal(removed.strategicProjectName, '');
  assert.equal(removed.strategy, '');
});

test('legacy narratives remain untouched and require explicit matching, never fuzzy matching', () => {
  const previous = { strategicProjectId: 'old-id', strategicProjectName: ' ชื่อเดิม\nตามที่ครูพิมพ์ ', strategy: 'กลยุทธ์ทดสอบหนึ่ง', standards: ['มาตรฐานข้อความเก่า', 'อีกข้อความหนึ่ง'] };
  const saved = normalize(input({ standards: ['test-standard-child'] }), { previous });
  assert.equal(saved.legacyReferences.strategicProject[0].text, previous.strategicProjectName);
  assert.deepEqual(saved.legacyReferences.strategy[0].resolvedIds, []);
  assert.throws(() => normalize(saved, { previous: saved, strict: true }), /ตรวจจับคู่ข้อความเดิม/);
  const forged = normalize({ ...saved, legacyReferences: {} }, { previous: saved });
  assert.deepEqual(forged.legacyReferences, saved.legacyReferences);
  const matched = normalize({ ...saved, legacyReferenceResolutions: { strategicProject: ['test-project'], strategy: ['test-strategy-1'], standards: ['test-standard-child'] } }, { previous: saved, strict: true });
  assert.equal(matched.legacyReferences.standards.length, 2);
  assert.deepEqual(matched.legacyReferences.standards[0].resolvedIds, ['test-standard-child']);
  const removed = normalize(input(), { previous: matched });
  assert.deepEqual(removed.legacyReferences.standards[0].resolvedIds, []);
  assert.throws(() => normalize(removed, { previous: removed, strict: true }), /มาตรฐานการศึกษาขั้นพื้นฐาน/);
  assert.throws(() => normalize({ ...saved, legacyReferenceResolutions: { standards: ['unselected'] } }, { previous: saved }), /ก่อนยืนยันจับคู่/);
  const two = normalize(input({hongson:['test-hongson-o1','test-hongson-o2']}), {previous:{hongson:'ข้อความ O เดิม'}});
  const confirmed = normalize({...two,legacyReferenceResolutions:{hongson:['test-hongson-o1','test-hongson-o2']}},{previous:two});
  const partialRemoval = normalize(input({hongson:['test-hongson-o2']}),{previous:confirmed});
  assert.deepEqual(partialRemoval.legacyReferences.hongson[0].resolvedIds,[],'removing part of an explicit legacy match requires review again');
});

test('HTTP action gate rejects new free text, upgrades blank drafts and preserves unchanged legacy edits', () => {
  const state = { projects: [{ id: 'old', data: { strategy: 'ข้อความเก่าที่ต้องเก็บ' } }] };
  assert.throws(() => prepareReferenceAction(state, { action: 'project.save', data: { strategy: 'ข้อความสร้างใหม่' } }), /ไม่รับข้อความใหม่/);
  const blank = { action: 'project.save', data: { title: 'ร่างใหม่' } };
  prepareReferenceAction(state, blank); assert.deepEqual(blank.data.referenceSelections, {});
  const edit = { action: 'project.save', id: 'old', data: { title: 'ชื่อแก้ไข', strategy: 'ข้อความเก่าที่ต้องเก็บ' } };
  prepareReferenceAction(state, edit); assert.deepEqual(edit.data.referenceSelections, {});
  assert.throws(() => prepareReferenceAction(state, { action: 'project.submit', id: 'old' }), /ตรวจจับคู่/);
  assert.throws(() => prepareReferenceAction(state, { action: 'request.save', projectId: 'old', proposed: { strategy: 'ข้อความใหม่ผ่านคำขอ' } }), /ไม่รับข้อความใหม่/);
  const request = { action: 'request.save', projectId: 'old', proposed: { strategy: 'ข้อความเก่าที่ต้องเก็บ' } };
  prepareReferenceAction(state, request); assert.deepEqual(request.proposed.referenceSelections, {});
});

test('available catalog selections save, reopen, submit, approve and print the same frozen full text', () => {
  const realCatalog = readSchoolReferenceCatalog();
  assert.ok(realCatalog.items.length > 0, JSON.stringify(realCatalog.issues));
  const strategic = realCatalog.items.find(row => row.category === 'strategicProject' && row.strategyId);
  assert.ok(strategic, 'A source-backed project and strategy relationship is required');
  const selections = Object.fromEntries(REFERENCE_CATEGORIES.filter(category => category !== 'strategy').map(category => {
    const rows = realCatalog.items.filter(row => row.category === category && row.selectable !== false);
    const item = category === 'strategicProject' ? strategic : rows.find(row => !rows.some(other => other.parentId === row.id)) || rows[0];
    return [category, item ? [{ id: item.id }] : []];
  }));
  const actor = role => ({ id: role, name: role, roles: [role] });
  let state = { projects: [], versions: [] };
  let project = mutate(state, actor('teacher'), { action: 'project.save', data: { referenceSelections: selections, title: 'ทดสอบข้อมูลกลาง', academicYear: '2569', fiscalYear: '2570', term: '2', group: 'กลุ่มทดสอบ', responsible: 'ครูทดสอบ', projectType: 'new', rationale: 'ทดสอบ', objectives: 'ทดสอบ', quantitativeTarget: 'ทดสอบ', qualitativeTarget: 'ทดสอบ', steps: 'ทดสอบ', startDate: '2026-11-10', endDate: '2026-11-20', evaluation: 'ทดสอบ', expectedResults: 'ทดสอบ', resources: [] } });
  const initial = structuredClone(project.data.referenceSelections);
  state = JSON.parse(JSON.stringify(state));
  project = mutate(state, actor('teacher'), { action: 'project.save', id: project.id, version: project.version, data: { ...project.data, title: 'ทดสอบเปิดกลับมา' } });
  assert.deepEqual(project.data.referenceSelections, initial);
  for (const [role, action, decision] of [['teacher', 'project.submit'], ['planner', 'project.review', 'forward'], ['director', 'project.approve', 'approve']]) project = mutate(state, actor(role), { action, id: project.id, version: project.version, decision });
  const snapshot = state.versions.find(row => row.id === project.approvedVersionId);
  assert.deepEqual(snapshot.data.referenceSelections, initial);
  const printed = projectTemplateHtml(snapshot.data);
  for (const rows of Object.values(initial)) for (const row of rows) assert.ok(printed.includes(row.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')), row.id);
  const forged = validateProject({ referenceSelections: { strategicProject: [{ id: strategic.id, name: 'FORGED NAME' }] } });
  assert.doesNotMatch(forged.strategicProjectName, /FORGED/);
});
