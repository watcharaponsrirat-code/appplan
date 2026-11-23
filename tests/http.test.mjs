import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { createApplication } from '../server.mjs';
import { readSchoolReferenceCatalog } from '../src/project-references.mjs';
import { projectTemplateHtml } from '../public/project-template.js';

let directory, dbPath, app, base;
const sessions = new Map();
async function openApplication() {
  app = await createApplication({ dbPath, seed: true });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${app.server.address().port}`;
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hongson-http-test-'));
  dbPath = join(directory, 'test.sqlite');
  await openApplication();
});
after(async () => {
  if (app) await app.close();
  if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('hongson-http-test-')) {
    await rm(directory, { recursive: true, force: true });
  }
});
async function call(path, { session, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { response, data, raw };
}
async function login(username) {
  if (sessions.has(username)) return sessions.get(username);
  const { response, data } = await call('/api/login', { method: 'POST', body: { username, password: 'Demo@2569' } });
  assert.equal(response.status, 200, JSON.stringify(data));
  const cookieHeader = response.headers.get('set-cookie');
  assert.ok(cookieHeader?.includes('HttpOnly'));
  assert.match(cookieHeader, /SameSite=Strict/i);
  assert.ok(data.csrf);
  const session = { cookie: cookieHeader.split(';')[0], csrf: data.csrf, user: data.user };
  sessions.set(username, session);
  return session;
}
async function action(username, body, expected = 200) {
  const result = await call('/api/action', { session: await login(username), method: 'POST', body });
  assert.equal(result.response.status, expected, `${body.action}: ${JSON.stringify(result.data)}`);
  return result.data;
}
const schoolCatalog = readSchoolReferenceCatalog();
const schoolStandards = schoolCatalog.items.filter(row=>row.category==='standards'&&!schoolCatalog.items.some(child=>child.parentId===row.id)).slice(0,2);
const projectData = (title = 'HTTP TEST ONLY') => ({
  title, academicYear: '2569', fiscalYear: '2570', term: '2', group: 'Demo group', responsible: 'Demo teacher',
  referenceSelections: {strategicProject:[{id:schoolCatalog.items.find(row=>row.category==='strategicProject').id}],standards:schoolStandards.map(({id})=>({id}))}, projectType: 'new',
  rationale: 'HTTP test', objectives: 'HTTP test', quantitativeTarget: '20 test participants', qualitativeTarget: 'Verified test',
  steps: 'Prepare and test', startDate: '2026-11-10', endDate: '2026-11-20', evaluation: 'Test', expectedResults: 'Test',
  resources: [{ name: 'TEST ONLY item', spec: 'Test', brand: 'Test brand', quantity: 1, unit: 'item', unitPrice: 100000,
    source: 'http-demo-source', priceVersion: 'demo-1', priceDate: '2026-11-01', spending: [{ month: '2026-11', amount: 100000 }] }],
});
async function createProject(title, username = 'teacher') {
  const data = await action(username, { action: 'project.save', data: projectData(title) });
  const project = data.state.projects.find(row => row.data.title === title);
  assert.ok(project);
  return project;
}
async function approveProject(title) {
  let project = await createProject(title);
  for (const [username, actionName, decision] of [
    ['teacher', 'project.submit'], ['planner', 'project.review', 'forward'], ['director', 'project.approve', 'approve'],
  ]) {
    const data = await action(username, { action: actionName, id: project.id, version: project.version, ...(decision ? { decision } : {}) });
    project = data.state.projects.find(row => row.id === project.id);
  }
  return project;
}

test('health is public; protected state, exports, and file routes require a login', async () => {
  assert.equal((await call('/api/health')).response.status, 200);
  for (const path of ['/api/bootstrap', '/api/export?type=budget', '/api/files/unknown']) {
    assert.equal((await call(path)).response.status, 401, path);
  }
  assert.equal((await call('/api/action', { method: 'POST', body: { action: 'settings.save' } })).response.status, 401);
});

test('login rejects wrong credentials and bootstrap never exposes password hashes', async () => {
  const wrong = await call('/api/login', { method: 'POST', body: { username: 'teacher', password: 'incorrect' } });
  assert.equal(wrong.response.status, 401);
  const { response, data, raw } = await call('/api/bootstrap', { session: await login('teacher') });
  assert.equal(response.status, 200);
  assert.ok(data.user.roles.includes('teacher'));
  assert.equal(data.integrations.sheets, false);
  assert.equal(data.integrations.phone, false);
  assert.ok(!/passwordHash|password_hash|"salt"|Demo@2569/.test(raw));
});

test('every mutation needs its session CSRF token and rejects an external Origin', async () => {
  const session = await login('teacher');
  const body = { action: 'project.save', data: { title: 'SHOULD NOT EXIST', resources: [] } };
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'wrong' }, { Origin: 'https://unrelated.example' }]) {
    const { response } = await call('/api/action', { session, method: 'POST', body, headers });
    assert.equal(response.status, 403);
  }
  const state = (await call('/api/bootstrap', { session })).data.state;
  assert.ok(!state.projects.some(row => row.data.title === 'SHOULD NOT EXIST'));
});

test('role permissions and teacher ownership are enforced even with manually constructed API calls', async () => {
  const project = await createProject('HTTP owner-only project');
  await action('teacher2', { action: 'project.save', id: project.id, version: project.version, data: projectData('Forbidden') }, 403);
  await action('teacher2', { action: 'project.submit', id: project.id, version: project.version }, 403);
  await action('admin', { action: 'project.approve', id: project.id, version: project.version, decision: 'approve' }, 403);
  const otherState = (await call('/api/bootstrap', { session: await login('teacher2') })).data.state;
  assert.ok(!otherState.projects.some(row => row.id === project.id));
  const ownState = (await call('/api/bootstrap', { session: await login('teacher') })).data.state;
  assert.equal(ownState.projects.find(row => row.id === project.id).data.title, 'HTTP owner-only project');
});

test('two simultaneous edits with the same version persist exactly one change', async () => {
  const project = await createProject('HTTP concurrent original');
  const session = await login('teacher');
  const responses = await Promise.all(['A', 'B'].map(suffix => call('/api/action', {
    session, method: 'POST', body: { action: 'project.save', id: project.id, version: project.version, data: projectData(`HTTP concurrent ${suffix}`) },
  })));
  assert.deepEqual(responses.map(row => row.response.status).sort(), [200, 409]);
  const state = (await call('/api/bootstrap', { session })).data.state;
  const stored = state.projects.find(row => row.id === project.id);
  assert.equal(stored.version, project.version + 1);
  assert.match(stored.data.title, /^HTTP concurrent [AB]$/);
});

test('concurrent procurement retries reserve once and concurrent payments cannot overspend', async () => {
  const project = await approveProject('HTTP concurrent procurement and payment');
  let output = await action('teacher', { action: 'request.save', projectId: project.id, type: 'purchase', reason: 'HTTP test purchase', evidence: [], source: 'http-demo-source', amount: 80000 });
  let request = output.state.requests.find(row => row.projectId === project.id);
  for (const [username, actionName, decision] of [
    ['teacher', 'request.submit'], ['planner', 'request.review', 'forward'], ['director', 'request.approve', 'approve'],
  ]) {
    output = await action(username, { action: actionName, id: request.id, version: request.version, ...(decision ? { decision } : {}) });
    request = output.state.requests.find(row => row.id === request.id);
  }
  const procurement = await login('procurement');
  const confirms = await Promise.all([1, 2].map(() => call('/api/action', {
    session: procurement, method: 'POST', body: { action: 'commitment.confirm', requestId: request.id, requestVersion: request.version },
  })));
  assert.ok(confirms.every(row => row.response.status === 200), JSON.stringify(confirms.map(row => row.data)));
  let state = (await call('/api/bootstrap', { session: procurement })).data.state;
  const commitments = state.commitments.filter(row => row.projectId === project.id);
  assert.equal(commitments.length, 1);
  const commitment = commitments[0];
  const finance = await login('finance');
  const payments = await Promise.all([1, 2].map(n => call('/api/action', {
    session: finance, method: 'POST', body: { action: 'payment.create', commitmentId: commitment.id, version: commitment.version,
      amount: 60000, reference: `HTTP receipt ${n}`, evidence: [], idempotencyKey: `http-concurrent-payment-${n}` },
  })));
  assert.deepEqual(payments.map(row => row.response.status).sort(), [200, 409]);
  state = (await call('/api/bootstrap', { session: finance })).data.state;
  assert.equal(state.payments.filter(row => row.commitmentId === commitment.id).length, 1);
  const budget = state.budgets.find(row => row.projectId === project.id);
  assert.equal(budget.paid, 60000);
  assert.equal(budget.reserved, 20000);
  assert.equal(budget.available, 20000);
  const uploaded = await call('/api/upload', {
    session: procurement, method: 'POST', body: { projectId: project.id, name: 'release-test.txt', type: 'text/plain', data: Buffer.from('TEST ONLY release evidence').toString('base64') },
  });
  assert.equal(uploaded.response.status, 201);
  const currentCommitment = state.commitments.find(row => row.id === commitment.id);
  output = await action('procurement', { action: 'commitment.adjust', id: currentCommitment.id, version: currentCommitment.version,
    amount: 60000, reason: 'Release unpaid remainder', evidence: [uploaded.data.id] });
  const releasedBudget = output.state.budgets.find(row => row.projectId === project.id);
  assert.equal(releasedBudget.reserved, 0);
  assert.equal(releasedBudget.paid, 60000);
  assert.equal(releasedBudget.available, 40000);
});

test('project attachments are owner-scoped and returned as downloads', async () => {
  const project = await createProject('HTTP attachment project');
  const uploaded = await call('/api/upload', {
    session: await login('teacher'), method: 'POST',
    body: { projectId: project.id, name: 'test-evidence.txt', type: 'text/plain', data: Buffer.from('TEST ONLY evidence').toString('base64') },
  });
  assert.ok([200, 201].includes(uploaded.response.status), JSON.stringify(uploaded.data));
  assert.ok(uploaded.data.id);
  const ownFile = await call(`/api/files/${uploaded.data.id}`, { session: await login('teacher') });
  assert.equal(ownFile.response.status, 200);
  assert.match(ownFile.response.headers.get('content-disposition'), /^attachment;/i);
  assert.equal(ownFile.raw, 'TEST ONLY evidence');
  const otherFile = await call(`/api/files/${uploaded.data.id}`, { session: await login('teacher2') });
  assert.ok([403, 404].includes(otherFile.response.status));
  const otherUpload = await call('/api/upload', {
    session: await login('teacher2'), method: 'POST',
    body: { projectId: project.id, name: 'forbidden.txt', type: 'text/plain', data: Buffer.from('forbidden').toString('base64') },
  });
  assert.ok([403, 404].includes(otherUpload.response.status));
});

test('approved project exports exclude pending projects and do not multiply budgets for multiple standards', async () => {
  const title = 'HTTP export approved unique';
  await approveProject(title);
  await createProject('HTTP export draft excluded');
  const exported = await call('/api/export?type=budget', { session: await login('planner') });
  assert.equal(exported.response.status, 200, exported.raw);
  assert.match(exported.response.headers.get('content-type'), /text\/csv/);
  assert.ok(exported.raw.includes(title));
  assert.ok(!exported.raw.includes('HTTP export draft excluded'));
  const titleRows = exported.raw.split(/\r?\n/).filter(line => line.includes(title));
  assert.equal(titleRows.length, 1, 'one budget row per project/source, not per standard');
  assert.match(titleRows[0], /"1000","0","0","1000"$/);
  const standards = await call('/api/export?type=standards', { session: await login('planner') });
  const standardRows = standards.raw.split(/\r?\n/).filter(line => line.includes(title));
  assert.equal(standardRows.length, 1);
  for(const standard of schoolStandards)assert.ok(standardRows[0].includes(standard.name));
  assert.match(standardRows[0], /"1000"$/);
});

test('tasks are owner-scoped, acknowledgements are idempotent, and completed steps stop appearing', async () => {
  const project = await createProject('HTTP actionable task');
  const taskList = async username => (await call('/api/bootstrap', { session: await login(username) })).data.state.tasks.filter(row => row.projectId === project.id);
  const ownTask = (await taskList('teacher')).find(row => row.type === 'project.submit');
  assert.ok(ownTask);
  assert.equal((await taskList('teacher2')).length, 0);
  await action('teacher2', { action: 'notification.read', id: ownTask.id }, 404);
  const firstAck = await action('teacher', { action: 'notification.read', id: ownTask.id });
  const retryAck = await action('teacher', { action: 'notification.read', id: ownTask.id });
  assert.equal(firstAck.result.id, retryAck.result.id);
  assert.ok((await taskList('teacher')).find(row => row.id === ownTask.id).readAt);
  let output = await action('teacher', { action: 'project.submit', id: project.id, version: project.version });
  let current = output.state.projects.find(row => row.id === project.id);
  assert.ok(!(await taskList('teacher')).some(row => row.type === 'project.submit'));
  assert.ok((await taskList('planner')).some(row => row.type === 'project.review'));
  output = await action('planner', { action: 'project.review', id: project.id, version: current.version, decision: 'forward' });
  current = output.state.projects.find(row => row.id === project.id);
  assert.equal((await taskList('planner')).length, 0);
  assert.ok((await taskList('director')).some(row => row.type === 'project.approve'));
  await action('director', { action: 'project.approve', id: project.id, version: current.version, decision: 'approve' });
  assert.equal((await taskList('director')).length, 0);
  assert.ok((await taskList('teacher')).some(row => row.type === 'summary.submit'));
});

test('administrator can create multi-role users, and disabling a user revokes live sessions', async () => {
  const input = { action: 'user.save', username: 'http_test_user', name: 'HTTP TEST ONLY user', password: 'Demo@2569', roles: ['teacher', 'planner'] };
  await action('teacher', input, 403);
  const created = await action('admin', input);
  const account = created.result;
  assert.deepEqual(account.roles, ['teacher', 'planner']);
  assert.equal(account.passwordHash, undefined);
  const session = await login('http_test_user');
  assert.equal((await call('/api/bootstrap', { session })).response.status, 200);
  await action('admin', { ...input, id: account.id, version: account.version, password: '', disabled: true });
  assert.equal((await call('/api/bootstrap', { session })).response.status, 401);
  sessions.delete('http_test_user');
});

test('logout invalidates the session and SQLite persistence survives application restart', async () => {
  const input = { ...projectData('HTTP persisted across server restart'), formTemplate: 'school-project-2569-v1',
    referenceSelections:Object.fromEntries(['strategicProject','standards','obecPolicy','onesqa','worldClass','kpd','hongson'].map(category=>[category,schoolCatalog.items.filter(row=>row.category===category&&!schoolCatalog.items.some(child=>child.parentId===row.id)).slice(0,category==='strategicProject'?1:2).map(({id})=>({id}))])),
    strategicProjectId: 'ref-demo-project', administrationGroup: 'กลุ่มบริหารทดลอง',
    implementationSteps: ['S', 'O', 'P', 'A1', 'A2'].map(stage => ({ stage, activity: `กิจกรรม ${stage}`, period: 'พฤศจิกายน 2569', responsible: 'ครูทดลอง' })),
    evaluationRows: [{ indicator: 'จำนวนผู้เข้าร่วม', method: 'นับจำนวน', tool: 'บัญชีรายชื่อ' }],
    activityPeriod: 'ภาคเรียนที่ 2', procurementMonth: 'ตุลาคม 2569', activityMonth: 'พฤศจิกายน 2569', quarter: 'ตามช่วงโรงเรียน',
    budgetTypes: ['อุดหนุน', 'อื่นๆ'], budgetOther: 'รายการทดลอง',
    signatories: { proposer: 'ครูทดลอง', proposerPosition: 'ครู', planningHead: 'หัวหน้างานแผนทดลอง', budgetHead: '', budgetDeputy: '', administrationHead: '', administrationDeputy: '', director: 'ช่องชื่อพิมพ์เท่านั้น' },
  };
  const saved = await action('teacher', { action: 'project.save', data: input });
  const project = saved.result;
  assert.ok(project.data.strategicProjectName.includes(schoolCatalog.items.find(row=>row.category==='strategicProject').name));
  assert.equal(project.status, 'draft');
  await action('teacher', { action: 'project.save', data: { ...input, signatories: [] } }, 422);
  const session = await login('teacher2');
  const loggedOut = await call('/api/logout', { session, method: 'POST', body: {} });
  assert.equal(loggedOut.response.status, 200);
  assert.equal((await call('/api/bootstrap', { session })).response.status, 401);
  sessions.delete('teacher2');
  await app.close();
  app = null;
  sessions.clear();
  await openApplication();
  const { data, response } = await call('/api/bootstrap', { session: await login('teacher') });
  assert.equal(response.status, 200);
  const reloaded = data.state.projects.find(row => row.id === project.id);
  assert.deepEqual(reloaded.data, project.data);
  assert.equal(reloaded.data.title, 'HTTP persisted across server restart');
  assert.deepEqual(reloaded.data.implementationSteps, input.implementationSteps);
  assert.deepEqual(reloaded.data.evaluationRows, input.evaluationRows);
  assert.deepEqual(reloaded.data.signatories, input.signatories);
  assert.deepEqual(reloaded.data.budgetTypes, input.budgetTypes);
  const printed=projectTemplateHtml(reloaded.data);
  for(const rows of Object.values(reloaded.data.referenceSelections))for(const row of rows)assert.ok(printed.includes(row.fullText.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')),row.id);
});

test('expired sessions reject reads, writes and logout without changing data, then the same teacher can log in and save again',async()=>{
  const project=await createProject('HTTP session expiry draft','teacher2');
  const expired=await login('teacher2');
  app.db.prepare('UPDATE sessions SET expires=? WHERE user_id=?').run(Date.now()-1,expired.user.id);
  const before=app.store.load();
  for(const [path,method,body] of [
    ['/api/bootstrap','GET',undefined],
    ['/api/action','POST',{action:'project.save',id:project.id,version:project.version,data:{...project.data,title:'MUST NOT SAVE'}}],
    ['/api/logout','POST',{}],
  ]){
    const result=await call(path,{session:expired,method,body});
    assert.equal(result.response.status,401);
    assert.equal(result.data.error,'กรุณาเข้าสู่ระบบ');
  }
  assert.deepEqual(app.store.load(),before);
  sessions.delete('teacher2');
  const renewed=await login('teacher2');
  assert.notEqual(renewed.csrf,expired.csrf);
  const reopened=(await call('/api/bootstrap',{session:renewed})).data.state.projects.find(row=>row.id===project.id);
  assert.deepEqual(reopened,project);
  const saved=await action('teacher2',{action:'project.save',id:project.id,version:project.version,data:{...project.data,title:'HTTP draft saved after login'}});
  assert.equal(saved.result.version,project.version+1);
  assert.equal(saved.result.data.title,'HTTP draft saved after login');
});

test('HTTP serves the available catalog and picker, and rejects newly typed or duplicate references',async()=>{
  const {data}=await call('/api/bootstrap',{session:await login('teacher')});
  assert.equal(data.state.schoolReferenceCatalog.version,schoolCatalog.version);
  assert.deepEqual(data.state.schoolReferenceCatalog.items.map(({id})=>id),schoolCatalog.items.map(({id})=>id));
  assert.equal((await call('/reference-picker.js')).response.status,200);
  await action('teacher',{action:'project.save',data:{title:'typed reference rejection',strategy:'ข้อความสร้างเอง'}},422);
  await action('teacher',{action:'project.save',data:{referenceSelections:{standards:[{id:schoolStandards[0].id},{id:schoolStandards[0].id}]}}},422);
});

test('HTTP saves, reopens and submits all request types against a project that has never been approved',async()=>{
  const p=await createProject('HTTP request before project approval'),requests=[];
  for(const type of ['unable','items','spend','quarter','purchase','budget']){
    const {result:r}=await action('teacher',{action:'request.save',projectId:p.id,type,reason:'ทดสอบก่อนโครงการอนุมัติ',source:'http-demo-source',amount:10000});
    assert.equal(r.original.title,p.data.title);assert.equal(r.baseApprovedVersionId,null);
    const submitted=await action('teacher',{action:'request.submit',id:r.id,version:r.version});assert.equal(submitted.result.status,'submitted');
    assert.deepEqual(submitted.state.projects.find(row=>row.id===p.id),p);assert.equal(submitted.state.budgets.find(row=>row.projectId===p.id).approved,0);requests.push(submitted.result);
  }
  const bootstrap=await call('/api/bootstrap',{session:await login('teacher')});
  for(const r of requests)assert.deepEqual(bootstrap.data.state.requests.find(row=>row.id===r.id),r);
  const other=await call('/api/bootstrap',{session:await login('teacher2')});assert.ok(requests.every(r=>!other.data.state.requests.some(row=>row.id===r.id)));
});

test('HTTP persists unlinked drafts across restart, then links and submits without project approval',async()=>{
  const {result:draft}=await action('teacher',{action:'request.save',type:'spend',reason:'ร่างก่อนเชื่อม',source:'http-demo-source',amount:10000});
  assert.equal(draft.projectId,null);await action('teacher',{action:'request.submit',id:draft.id,version:draft.version},422);
  await app.close();app=null;sessions.clear();await openApplication();
  const reopened=(await call('/api/bootstrap',{session:await login('teacher')})).data.state.requests.find(row=>row.id===draft.id);assert.deepEqual(reopened,draft);
  const p=await createProject('HTTP link after drafting');
  const {result:linked}=await action('teacher',{action:'request.save',id:draft.id,version:draft.version,type:'spend',projectId:p.id,reason:draft.reason,source:draft.source,amount:draft.amount});
  assert.equal(linked.original.title,p.data.title);assert.equal(linked.reason,draft.reason);
  const submitted=await action('teacher',{action:'request.submit',id:linked.id,version:linked.version});assert.equal(submitted.result.status,'submitted');assert.equal(submitted.state.projects.find(row=>row.id===p.id).status,'draft');
});
