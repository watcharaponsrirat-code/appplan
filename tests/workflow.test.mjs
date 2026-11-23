import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, mutate, visibleState, totals, validateProject } from '../src/domain.mjs';

const user = (role, id = role) => ({ id, name: `Test ${id}`, roles: [role] });
const teacher = user('teacher');
const teacher2 = user('teacher', 'other-teacher');
const planner = user('planner');
const head = user('plan_head');
const director = user('director');
const procurement = user('procurement');
const finance = user('finance');
const admin = user('admin');
const initialState = () => ({
  projects: [], versions: [], requests: [], commitments: [], payments: [], summaries: [],
  audit: [], outbox: [], allocations: [], references: [], notifications: [],
  settings: { projectDeadline: '', summaryDeadline: '', reminderDays: 7 },
});
const resource = (source = 'source-a', amount = 100000, overrides = {}) => ({
  name: 'Demonstration supply', spec: 'test only', brand: 'Demo brand',
  quantity: 1, unit: 'item', unitPrice: amount, source, priceVersion: 'demo-1',
  priceDate: '2026-11-01', spending: [{ month: '2026-11', amount }], ...overrides,
});
const projectData = (overrides = {}) => ({
  title: 'TEST ONLY - local workflow', academicYear: '2569', fiscalYear: '2570', term: '2',
  group: 'Demo group', responsible: 'Demo teacher', strategicProjectId: 'demo-strategic',
  strategy: 'Demo strategy (not official)', projectType: 'new', standards: ['demo-standard-a', 'demo-standard-b'],
  obecPolicy: '', onesqa: '', worldClass: '', kpd: '', hongson: '',
  rationale: 'Test workflow', objectives: 'Verify workflow', quantitativeTarget: '20 test participants',
  qualitativeTarget: 'Completed local test', steps: 'Prepare, run, review',
  startDate: '2026-11-10', endDate: '2026-11-20', evaluation: 'Test assessment',
  expectedResults: 'Verified test behavior', resources: [resource()], ...overrides,
});
const schoolProjectData = (overrides = {}) => projectData({
  formTemplate: 'school-project-2569-v1', administrationGroup: 'กลุ่มบริหารทดลอง',
  activityPeriod: 'พฤศจิกายน 2569', procurementMonth: 'ตุลาคม 2569', activityMonth: 'พฤศจิกายน 2569', quarter: 'ไตรมาสตามโรงเรียน',
  budgetTypes: ['อุดหนุน', 'อื่นๆ'], budgetOther: 'แหล่งเงินทดลอง', steps: '', evaluation: '',
  implementationSteps: ['S', 'O', 'P', 'A1', 'A2'].map(stage => ({ stage, activity: `กิจกรรม ${stage}`, period: 'พฤศจิกายน 2569', responsible: 'ครูทดลอง' })),
  evaluationRows: [{ indicator: 'ผู้เข้าร่วมครบเป้าหมาย', method: 'นับจำนวน', tool: 'บัญชีรายชื่อ' }],
  signatories: { proposer: 'ครูทดลอง', proposerPosition: 'ครู', planningHead: 'งานแผนทดลอง', budgetHead: 'งานงบประมาณทดลอง', budgetDeputy: 'รองงบประมาณทดลอง', administrationHead: 'หัวหน้ากลุ่มทดลอง', administrationDeputy: 'รองกลุ่มทดลอง', director: 'ผู้อำนวยการทดลอง' },
  ...overrides,
});
const find = (state, collection, id) => state[collection].find(row => row.id === id);
const act = (state, actor, action, input = {}) => mutate(state, actor, { action, ...input });
const edit = (state, actor, collection, action, id, input = {}) =>
  act(state, actor, action, { id, version: find(state, collection, id).version, ...input });
function saveProject(state, data = projectData(), actor = teacher) {
  act(state, actor, 'project.save', { data });
  return state.projects.at(-1).id;
}
function approveProject(state, data = projectData(), actor = teacher) {
  const id = saveProject(state, data, actor);
  edit(state, actor, 'projects', 'project.submit', id);
  edit(state, planner, 'projects', 'project.review', id, { decision: 'forward' });
  edit(state, director, 'projects', 'project.approve', id, { decision: 'approve' });
  return id;
}
function saveRequest(state, projectId, input = {}) {
  act(state, teacher, 'request.save', {
    projectId, type: 'purchase', reason: 'TEST ONLY - needed for activity', evidence: [],
    amount: 60000, source: 'source-a', ...input,
  });
  return state.requests.at(-1).id;
}
function approveRequest(state, projectId, input = {}) {
  const id = saveRequest(state, projectId, input);
  edit(state, teacher, 'requests', 'request.submit', id);
  edit(state, planner, 'requests', 'request.review', id, { decision: 'forward' });
  edit(state, director, 'requests', 'request.approve', id, { decision: 'approve' });
  return id;
}
function confirm(state, requestId) {
  return act(state, procurement, 'commitment.confirm', {
    requestId, requestVersion: find(state, 'requests', requestId).version,
  });
}
const domainError = (fn, statuses = [400, 403, 409, 422]) => assert.throws(fn, error =>
  error instanceof DomainError && statuses.includes(error.status));
const summaryData = (overrides = {}) => ({
  actualDate: '2026-11-15', participants: 20, outcome: 'Test activity completed',
  success: 85, scores: [4, 4, 4, 4, 3, 3, 3, 3], suggestions: 'Test suggestion',
  coverType: 'subject', evidence: [], problems: [
    { category: 'personnel', status: 'none', cause: '', solution: '', result: '', suggestion: '' },
    { category: 'budget', status: 'none', cause: '', solution: '', result: '', suggestion: '' },
    { category: 'materials', status: 'problem', cause: 'Test cause', solution: 'Test fix', result: 'Test result', suggestion: 'Test suggestion' },
    { category: 'coordination', status: 'none', cause: '', solution: '', result: '', suggestion: '' },
    { category: 'location', status: 'none', cause: '', solution: '', result: '', suggestion: '' },
    { category: 'other', status: 'none', cause: '', solution: '', result: '', suggestion: '' },
  ], ...overrides,
});

test('draft survives incomplete fields; strict submission rejects incomplete project atomically', () => {
  const state = initialState();
  const id = saveProject(state, { title: 'Incomplete draft', resources: [] });
  const before = structuredClone(state);
  domainError(() => edit(state, teacher, 'projects', 'project.submit', id), [422]);
  assert.deepEqual(state, before);
  assert.equal(find(state, 'projects', id).status, 'draft');
});

test('school form drafts retain partial rows; strict checks preserve compatibility with legacy projects', () => {
  const draft = validateProject({ formTemplate: 'school-project-2569-v1', implementationSteps: [{ stage: 'S', activity: '' }], evaluationRows: [{}], signatories: {} });
  assert.deepEqual(draft.implementationSteps, [{ stage: 'S', activity: '', period: '', responsible: '' }]);
  assert.deepEqual(draft.evaluationRows, [{ indicator: '', method: '', tool: '' }]);
  assert.equal(draft.signatories.director, '');
  assert.equal(validateProject(projectData(), true).formTemplate, '');
  assert.equal(validateProject(schoolProjectData(), true).implementationSteps.length, 5);
  domainError(() => validateProject(schoolProjectData({ implementationSteps: [] }), true), [422]);
  domainError(() => validateProject(schoolProjectData({ implementationSteps: schoolProjectData().implementationSteps.slice(0, 4) }), true), [422]);
  domainError(() => validateProject(schoolProjectData({ evaluationRows: [] }), true), [422]);
  domainError(() => validateProject(schoolProjectData({ evaluationRows: [{ indicator: 'เป้าหมาย', method: '', tool: '' }] }), true), [422]);
  domainError(() => validateProject(projectData({ implementationSteps: [{ stage: 'S' }] }), true), [422]);
});

test('school form rejects malformed structures and excessive or unknown field values', () => {
  for (const patch of [
    { formTemplate: 'invented-template' }, { implementationSteps: {} }, { implementationSteps: [null] },
    { implementationSteps: [{ stage: 'X' }] }, { implementationSteps: Array(101).fill({}) },
    { evaluationRows: 'text' }, { evaluationRows: [[]] }, { evaluationRows: Array(101).fill({}) },
    { signatories: [] }, { signatories: { proposer: 'x'.repeat(501) } },
    { strategicProjectReference: [] }, { strategicProjectReference: { origin: 'x'.repeat(2001) } },
    { budgetTypes: 'อุดหนุน' }, { budgetTypes: ['ไม่ใช่ประเภทในแบบฟอร์ม'] }, { activityPeriod: {} },
  ]) domainError(() => validateProject(schoolProjectData(patch)), [422]);
});

test('school form and strategic reference metadata freeze in approved and revised snapshots', () => {
  const state = initialState();
  act(state, admin, 'reference.save', { kind: 'strategic_project', name: 'โครงการต้นฉบับ', code: 'STR-1', origin: 'ไฟล์ทดลอง', edition: '2569', isDemo: true });
  const referenceId = state.references[0].id;
  const id = approveProject(state, schoolProjectData({ strategicProjectId: referenceId, strategicProjectName: 'ชื่อจากผู้ใช้ที่ต้องแทนด้วยรายการอ้างอิง' }));
  const oldVersionId = find(state, 'projects', id).approvedVersionId;
  const original = structuredClone(find(state, 'versions', oldVersionId));
  assert.equal(original.data.strategicProjectName, 'โครงการต้นฉบับ');
  assert.deepEqual(original.data.strategicProjectReference, { code: 'STR-1', origin: 'ไฟล์ทดลอง', edition: '2569' });
  const reference = state.references[0];
  act(state, admin, 'reference.save', { id: reference.id, version: reference.version, kind: 'strategic_project', name: 'ชื่อที่แก้ไขใหม่', code: 'STR-2', origin: 'ไฟล์ใหม่', edition: '2570', isDemo: true });
  const proposed = structuredClone(original.data);
  proposed.implementationSteps[0].activity = 'กิจกรรมปรับปรุง';
  proposed.evaluationRows[0].tool = 'เครื่องมือปรับปรุง';
  proposed.signatories.director = 'ชื่อสำหรับช่องพิมพ์';
  delete proposed.strategicProjectName;
  delete proposed.strategicProjectReference;
  const requestId = saveRequest(state, id, { type: 'items', proposed });
  const request = find(state, 'requests', requestId);
  assert.equal(request.proposed.strategicProjectName, 'โครงการต้นฉบับ');
  assert.equal(find(state, 'projects', id).status, 'approved');
  assert.equal(state.versions.length, 1, 'print signatories cannot approve or revise a project');
  edit(state, teacher, 'requests', 'request.submit', requestId);
  edit(state, planner, 'requests', 'request.review', requestId, { decision: 'forward' });
  edit(state, director, 'requests', 'request.approve', requestId, { decision: 'approve' });
  const revised = find(state, 'versions', find(state, 'projects', id).approvedVersionId);
  assert.deepEqual(find(state, 'versions', oldVersionId), original);
  assert.equal(revised.data.implementationSteps[0].activity, 'กิจกรรมปรับปรุง');
  assert.equal(revised.data.evaluationRows[0].tool, 'เครื่องมือปรับปรุง');
  assert.equal(revised.data.signatories.director, 'ชื่อสำหรับช่องพิมพ์');
  assert.deepEqual(revised.data.strategicProjectReference, original.data.strategicProjectReference);
  assert.ok(state.outbox.filter(row => row.approvedVersionId === revised.id).every(row => row.payload.data.formTemplate === 'school-project-2569-v1'));
});

test('cleared or unknown strategic selections cannot retain a stale name and reference metadata', () => {
  const state = initialState();
  act(state, admin, 'reference.save', { kind: 'strategic_project', name: 'โครงการต้นฉบับ', code: 'STR-1', origin: 'ไฟล์ทดลอง', edition: '2569', isDemo: true });
  const referenceId = state.references[0].id;
  const id = saveProject(state, schoolProjectData({ strategicProjectId: referenceId }));
  const original = structuredClone(find(state, 'projects', id).data);
  for (const strategicProjectId of ['', 'missing-reference']) {
    edit(state, teacher, 'projects', 'project.save', id, { data: { ...original, strategicProjectId } });
    const data = find(state, 'projects', id).data;
    assert.equal(data.strategicProjectId, strategicProjectId);
    assert.equal(data.strategicProjectName, '');
    assert.deepEqual(data.strategicProjectReference, { code: '', origin: '', edition: '' });
  }
  const approvedId = approveProject(state, schoolProjectData({ strategicProjectId: referenceId }));
  for (const strategicProjectId of ['', 'missing-reference']) {
    const requestId = saveRequest(state, approvedId, { type: 'items', proposed: { ...original, strategicProjectId } });
    const proposed = find(state, 'requests', requestId).proposed;
    assert.equal(proposed.strategicProjectName, '');
    assert.deepEqual(proposed.strategicProjectReference, { code: '', origin: '', edition: '' });
  }
});

test('teacher return, edit, resubmit, plan review, director approval retain history and approved snapshot', () => {
  const state = initialState();
  const id = saveProject(state);
  edit(state, teacher, 'projects', 'project.submit', id);
  domainError(() => edit(state, planner, 'projects', 'project.review', id, { decision: 'return', reason: '' }));
  edit(state, planner, 'projects', 'project.review', id, { decision: 'return', reason: 'Clarify test objective' });
  assert.equal(find(state, 'projects', id).status, 'returned');
  edit(state, teacher, 'projects', 'project.save', id, { data: projectData({ objectives: 'Revised test objective' }) });
  edit(state, teacher, 'projects', 'project.submit', id);
  edit(state, planner, 'projects', 'project.review', id, { decision: 'forward' });
  edit(state, director, 'projects', 'project.approve', id, { decision: 'return', reason: 'Clarify test outcome' });
  edit(state, teacher, 'projects', 'project.save', id, { data: projectData({ expectedResults: 'Revised test outcome' }) });
  edit(state, teacher, 'projects', 'project.submit', id);
  edit(state, planner, 'projects', 'project.review', id, { decision: 'forward' });
  edit(state, director, 'projects', 'project.approve', id, { decision: 'approve' });
  const project = find(state, 'projects', id);
  const snapshot = find(state, 'versions', project.approvedVersionId);
  assert.equal(project.status, 'approved');
  assert.equal(snapshot.data.expectedResults, 'Revised test outcome');
  assert.equal(snapshot.data.resources[0].brand, 'Demo brand');
  assert.ok(state.audit.length >= 10);
  assert.equal(state.outbox.length, 4);
  assert.ok(state.outbox.every(row => row.status !== 'sent'));
  domainError(() => edit(state, teacher, 'projects', 'project.save', id, { data: projectData({ title: 'Overwrite?' }) }));
  assert.equal(snapshot.data.title, 'TEST ONLY - local workflow');
});

test('optimistic versions reject stale edits without adding history', () => {
  const state = initialState();
  const id = saveProject(state);
  const version = find(state, 'projects', id).version;
  edit(state, teacher, 'projects', 'project.save', id, { data: projectData({ title: 'First edit' }) });
  const before = structuredClone(state);
  domainError(() => act(state, teacher, 'project.save', { id, version, data: projectData({ title: 'Stale edit' }) }), [409]);
  assert.deepEqual(state, before);
});

test('teacher ownership and each operational role are enforced in domain', () => {
  const state = initialState();
  const first = saveProject(state);
  const second = saveProject(state, projectData({ title: 'Other teacher private draft' }), teacher2);
  domainError(() => edit(state, teacher2, 'projects', 'project.save', first, { data: projectData() }), [403]);
  domainError(() => edit(state, teacher2, 'projects', 'project.submit', first), [403]);
  edit(state, teacher, 'projects', 'project.submit', first);
  domainError(() => edit(state, teacher, 'projects', 'project.review', first, { decision: 'forward' }), [403]);
  domainError(() => edit(state, admin, 'projects', 'project.approve', first, { decision: 'approve' }), [403]);
  const own = visibleState(state, teacher);
  assert.deepEqual(own.projects.map(p => p.id), [first]);
  assert.equal(visibleState(state, planner).projects.length, 2);
  assert.ok(!JSON.stringify(own).includes('Other teacher private draft'));
  assert.ok(!own.audit.some(entry => entry.projectId === second));
});

test('batch validates every row before mutation; only plan head and director can batch their stage', () => {
  const state = initialState();
  const first = saveProject(state);
  const second = saveProject(state, projectData({ title: 'Second batch project' }));
  edit(state, teacher, 'projects', 'project.submit', first);
  const items = () => [first, second].map(id => ({ id, version: find(state, 'projects', id).version }));
  const before = structuredClone(state);
  domainError(() => act(state, head, 'project.batch', { items: items(), decision: 'forward' }));
  assert.deepEqual(state, before);
  edit(state, teacher, 'projects', 'project.submit', second);
  domainError(() => act(state, planner, 'project.batch', { items: items(), decision: 'forward' }), [403]);
  act(state, head, 'project.batch', { items: items(), decision: 'forward' });
  assert.ok(state.projects.every(p => p.status === 'reviewed'));
  act(state, director, 'project.batch', { items: items(), decision: 'approve' });
  assert.ok(state.projects.every(p => p.status === 'approved'));
  assert.equal(state.outbox.length, 8);
  assert.equal(new Set(state.outbox.map(row => `${row.projectId}|${row.versionId}|${row.destination}`)).size, 8);
});

test('fractional quantities round once to satang and monthly allocations must match', () => {
  const valid = projectData({ resources: [resource('source-a', 1001, {
    quantity: 1.125, spending: [{ month: '2026-11', amount: 1000 }, { month: '2026-12', amount: 126 }],
  })] });
  const state = initialState();
  const id = approveProject(state, valid);
  assert.equal(totals(state, id).approved, 1126);
  const mismatch = structuredClone(valid);
  mismatch.resources[0].spending[0].amount = 999;
  domainError(() => validateProject(mismatch, true), [422]);
  const excessivePrecision = structuredClone(valid);
  excessivePrecision.resources[0].quantity = 1.1234;
  domainError(() => validateProject(excessivePrecision, true), [422]);
});

test('negative, infinite, fractional currency and unsafe integers cannot become resource budgets', () => {
  for (const value of [-1, NaN, Infinity, -Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    domainError(() => validateProject(projectData({ resources: [resource('source-a', value)] }), false), [422]);
  }
  for (const quantity of [-1, NaN, Infinity]) {
    domainError(() => validateProject(projectData({ resources: [resource('source-a', 100, { quantity })] }), false), [422]);
  }
});

test('reservation begins only at procurement confirmation; payment converts reserved money without double deduction', () => {
  const state = initialState();
  const id = approveProject(state, projectData({ resources: [resource(), resource('source-b', 200000)] }));
  const requestId = approveRequest(state, id);
  assert.deepEqual(JSON.parse(JSON.stringify(totals(state, id))), {
    approved: 300000, paid: 0, reserved: 0, available: 300000,
    bySource: { 'source-a': { approved: 100000, paid: 0, reserved: 0, available: 100000 }, 'source-b': { approved: 200000, paid: 0, reserved: 0, available: 200000 } },
  });
  domainError(() => act(state, teacher, 'commitment.confirm', { requestId, requestVersion: find(state, 'requests', requestId).version }), [403]);
  confirm(state, requestId);
  confirm(state, requestId);
  assert.equal(state.commitments.length, 1);
  const commitmentId = state.commitments[0].id;
  assert.equal(totals(state, id).available, 240000);
  assert.equal(totals(state, id).bySource['source-a'].available, 40000);
  const initialVersion = state.commitments[0].version;
  act(state, finance, 'payment.create', { commitmentId, version: initialVersion, amount: 20000, reference: 'Test receipt', evidence: [], idempotencyKey: 'test-payment-1' });
  assert.equal(totals(state, id).paid, 20000);
  assert.equal(totals(state, id).reserved, 40000);
  assert.equal(totals(state, id).available, 240000);
  act(state, finance, 'payment.create', { commitmentId, version: initialVersion, amount: 20000, reference: 'Test receipt', evidence: [], idempotencyKey: 'test-payment-1' });
  assert.equal(state.payments.length, 1);
  domainError(() => act(state, finance, 'payment.create', { commitmentId, version: initialVersion, amount: 10000, reference: 'Stale payment', evidence: [], idempotencyKey: 'test-payment-2' }), [409]);
  domainError(() => edit(state, finance, 'commitments', 'payment.create', commitmentId, { commitmentId, amount: 40001, reference: 'Overpay', evidence: [], idempotencyKey: 'test-payment-3' }));
  domainError(() => edit(state, procurement, 'commitments', 'commitment.adjust', commitmentId, { amount: 19999, reason: 'Below paid', evidence: ['test-document'] }));
  edit(state, procurement, 'commitments', 'commitment.adjust', commitmentId, { amount: 20000, reason: 'Cancel unpaid remainder', evidence: ['test-document'] });
  assert.deepEqual(totals(state, id).bySource['source-a'], { approved: 100000, paid: 20000, reserved: 0, available: 80000 });
  assert.equal(totals(state, id).available, 280000);
});

test('source budgets cannot borrow from another source; links never create a second reservation', () => {
  const state = initialState();
  const id = approveProject(state, projectData({ resources: [resource(), resource('source-b', 200000)] }));
  const first = approveRequest(state, id, { amount: 80000 });
  confirm(state, first);
  const commitmentId = state.commitments[0].id;
  const linked = approveRequest(state, id, { type: 'spend', linkedCommitmentId: commitmentId, amount: 80000 });
  confirm(state, linked);
  assert.equal(state.commitments.length, 1);
  assert.equal(totals(state, id).reserved, 80000);
  const excess = approveRequest(state, id, { amount: 30000 });
  const before = structuredClone(state);
  domainError(() => confirm(state, excess));
  assert.deepEqual(state, before);
  domainError(() => edit(state, procurement, 'commitments', 'commitment.adjust', commitmentId, { amount: 100001, reason: 'Exceeds source budget', evidence: ['test-document'] }));
  assert.equal(totals(state, id).bySource['source-b'].available, 200000);
});

test('budget change stays pending until approved, protects obligations, freezes old snapshots and invalidates stale proposals', () => {
  const state = initialState();
  const id = approveProject(state);
  const oldVersionId = find(state, 'projects', id).approvedVersionId;
  const original = structuredClone(find(state, 'versions', oldVersionId));
  const purchase = approveRequest(state, id, { amount: 60000 });
  confirm(state, purchase);
  const increase = saveRequest(state, id, { type: 'budget', proposed: projectData({ resources: [resource('source-a', 150000)] }) });
  const stale = saveRequest(state, id, { type: 'quarter', proposed: projectData({ resources: [resource('source-a', 100000, { spending: [{ month: '2027-01', amount: 100000 }] })] }) });
  assert.equal(totals(state, id).approved, 100000);
  for (const requestId of [increase, stale]) {
    edit(state, teacher, 'requests', 'request.submit', requestId);
    edit(state, planner, 'requests', 'request.review', requestId, { decision: 'forward' });
  }
  edit(state, director, 'requests', 'request.approve', increase, { decision: 'approve' });
  assert.equal(totals(state, id).approved, 150000);
  assert.deepEqual(find(state, 'versions', oldVersionId), original);
  domainError(() => edit(state, director, 'requests', 'request.approve', stale, { decision: 'approve' }), [409]);
  const reduce = saveRequest(state, id, { type: 'budget', proposed: projectData({ resources: [resource('source-a', 50000)] }) });
  const before = structuredClone(state);
  domainError(() => edit(state, teacher, 'requests', 'request.submit', reduce));
  assert.deepEqual(state, before);
  assert.equal(totals(state, id).reserved, 60000);
});

test('a budget reduction rechecks obligations created after its review before approving', () => {
  const state = initialState();
  const id = approveProject(state);
  const reduce = saveRequest(state, id, { type: 'budget', proposed: projectData({ resources: [resource('source-a', 50000)] }) });
  edit(state, teacher, 'requests', 'request.submit', reduce);
  edit(state, planner, 'requests', 'request.review', reduce, { decision: 'forward' });
  confirm(state, approveRequest(state, id, { amount: 60000 }));
  const before = structuredClone(state);
  domainError(() => edit(state, director, 'requests', 'request.approve', reduce, { decision: 'approve' }));
  assert.deepEqual(state, before);
  assert.equal(totals(state, id).approved, 100000);
  assert.equal(totals(state, id).reserved, 60000);
});

test('unable-to-run report does not automatically release a confirmed obligation', () => {
  const state = initialState();
  const id = approveProject(state);
  confirm(state, approveRequest(state, id));
  approveRequest(state, id, { type: 'unable', amount: 0, source: '', reason: 'Test cancellation report' });
  assert.equal(totals(state, id).reserved, 60000);
  assert.equal(totals(state, id).available, 40000);
});

test('summary submission snapshots paid amount; return and revision keep one current summary and distinct success/score', () => {
  const state = initialState();
  const id = approveProject(state);
  confirm(state, approveRequest(state, id));
  const commitment = state.commitments[0];
  act(state, finance, 'payment.create', { commitmentId: commitment.id, version: commitment.version, amount: 25000, reference: 'Test receipt', evidence: [], idempotencyKey: 'summary-payment' });
  act(state, teacher, 'summary.save', { projectId: id, data: summaryData() });
  const summaryId = state.summaries[0].id;
  edit(state, teacher, 'summaries', 'summary.submit', summaryId);
  assert.equal(state.summaries[0].status, 'submitted');
  assert.equal(visibleState(state, planner).summaries.length, 1);
  assert.equal(state.summaries[0].data.success, 85);
  assert.equal(state.summaries[0].data.scores.reduce((a, b) => a + b, 0) / 32 * 100, 87.5);
  const submitted = structuredClone(state.summaries[0]);
  assert.ok(JSON.stringify(submitted).includes('25000'), 'summary should snapshot actual paid amount, not 60000 reserved+paid');
  assert.ok(JSON.stringify(submitted).includes(find(state, 'projects', id).approvedVersionId));
  assert.ok(submitted.data.problems.some(p => p.status === 'problem'));
  edit(state, planner, 'summaries', 'summary.review', summaryId, { decision: 'return', reason: 'Clarify result' });
  edit(state, teacher, 'summaries', 'summary.save', summaryId, { projectId: id, data: summaryData({ outcome: 'Revised result', scores: [4, 4, 4, 4, 4, 4, 4, 4], success: 75 }) });
  edit(state, teacher, 'summaries', 'summary.submit', summaryId);
  edit(state, planner, 'summaries', 'summary.review', summaryId, { decision: 'accept' });
  assert.equal(state.summaries.length, 1);
  assert.equal(state.summaries[0].status, 'accepted');
  assert.equal(state.summaries[0].data.success, 75);
  assert.equal(state.summaries[0].data.scores.reduce((a, b) => a + b, 0) / 32 * 100, 100);
  assert.ok(state.audit.some(entry => JSON.stringify(entry).includes('Clarify result')));
  domainError(() => act(state, teacher, 'summary.save', { projectId: id, data: summaryData() }));
});

test('summary needs eight integer assessment scores on submit; incomplete draft remains editable', () => {
  for (const scores of [[], [4, 4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, 4, 5], [4, 4, 4, 4, 4, 4, 4, 1.5]]) {
    const state = initialState();
    const id = approveProject(state);
    try {
      act(state, teacher, 'summary.save', { projectId: id, data: summaryData({ scores }) });
      domainError(() => edit(state, teacher, 'summaries', 'summary.submit', state.summaries[0].id), [422]);
    } catch (error) {
      assert.ok(error instanceof DomainError && error.status === 422);
    }
  }
});

test('an unanswered problem category is not silently converted to no problem', () => {
  const state = initialState();
  const projectId = approveProject(state);
  const data = summaryData();
  data.problems[0].status = 'unanswered';
  act(state, teacher, 'summary.save', { projectId, data });
  assert.equal(state.summaries[0].data.problems[0].status, 'unanswered');
  domainError(() => edit(state, teacher, 'summaries', 'summary.submit', state.summaries[0].id), [422]);
});

test('approved price snapshot remains unchanged when an administrator revises the price reference', () => {
  const state = initialState();
  act(state, admin, 'reference.save', { kind: 'price', name: 'Demo price', code: 'DEMO-PRICE', origin: 'Test only', edition: 'demo-1', isDemo: true, data: { unitPrice: 100000, brand: 'Demo brand' } });
  const reference = state.references[0];
  const id = approveProject(state);
  const approvedId = find(state, 'projects', id).approvedVersionId;
  const before = structuredClone(find(state, 'versions', approvedId));
  act(state, admin, 'reference.save', { id: reference.id, version: reference.version, kind: 'price', name: 'Demo price', code: 'DEMO-PRICE', origin: 'Test only', edition: 'demo-2', isDemo: true, data: { unitPrice: 999000, brand: 'New demo brand' } });
  assert.deepEqual(find(state, 'versions', approvedId), before);
  domainError(() => act(state, teacher, 'reference.save', { kind: 'price', name: 'Unauthorized price', isDemo: true }), [403]);
});

test('queued integration retries remain blocked without credentials and never duplicate approved destinations', () => {
  const state = initialState();
  approveProject(state);
  const ids = state.outbox.map(row => row.id);
  for (const id of ids) {
    act(state, planner, 'outbox.retry', { id });
    act(state, planner, 'outbox.retry', { id });
  }
  assert.equal(state.outbox.length, 4);
  assert.ok(state.outbox.every(row => row.status !== 'sent'));
  assert.deepEqual(state.outbox.map(row => row.id), ids);
});
