import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as template from '../public/project-template.js';
import * as referencePicker from '../public/reference-picker.js';

// Run the actual application authentication and event handlers. This small DOM
// fixture checks state and node preservation; it does not claim visual coverage.
class Element {
  constructor(tag = 'div', properties = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), childNodes: [], parentNode: null,
      dataset: {}, style: {}, textContent: '', value: '', open: false }, properties);
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get isConnected() { return this.connected || Boolean(this.parentNode?.isConnected); }
  get innerHTML() { return this.html || ''; }
  set innerHTML(html) { this.replaceChildren(); this.html = html; this.onHtml?.(html); }
  append(...nodes) { for (const node of nodes) { node.remove?.(); this.childNodes.push(node); node.parentNode = this; } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; this.html = ''; this.textContent = ''; this.append(...nodes); }
  remove() { if (this.parentNode) { this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; } }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '.error') return this.className === 'error';
    if (selector === '[type=submit]') return this.type === 'submit';
    if (selector === '[data-action]') return Boolean(this.dataset.action);
    const name = selector.match(/^\[name=["']?([^"'\]]+)["']?\]$/);
    if (name) return this.name === name[1];
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/);
    if (parts.length > 1) return this.querySelectorAll(parts[0]).flatMap(node => node.querySelectorAll(parts.slice(1).join(' ')));
    return this.childNodes.flatMap(node => [...(node.matches?.(selector) ? [node] : []), ...(node.querySelectorAll?.(selector) || [])]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector) || null; }
  contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() {}
  focus() {}
}

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const user = (id = 'teacher', roles = ['teacher']) => ({ id, name: `ครู ${id}`, username: id, roles });
const bootData = (who = user()) => ({ user: who, csrf: 'fresh-csrf', users: [], state: { projects: [], requests: [], references: [], versions: [], commitments: [], attachments: [], audit: [], tasks: [], outbox: [] } });
const response = (status, body = {}) => ({ status, body });
const decodeHtml = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);

function sessionUi() {
  const root = new Element('body', { connected: true });
  const app = new Element('div', { id: 'app' });
  const modal = new Element('dialog', { id: 'modal' });
  const toast = new Element('div', { id: 'toast' });
  const print = new Element('div', { id: 'print-area' });
  root.append(app, modal, toast, print);
  let loginRenders = 0;
  app.onHtml = html => {
    if (html.includes('id="login-form"')) {
      loginRenders++;
      const form = new Element('form', { id: 'login-form' });
      const initialValue = name => decodeHtml(html.match(new RegExp(`<input name="${name}"[^>]*value="([^"]*)"`))?.[1] || '');
      const initialError = decodeHtml(html.match(/<div class="error" role="alert">([^<]*)<\/div>/)?.[1] || '');
      form.append(new Element('input', { name: 'username', value: initialValue('username') }),
        new Element('input', { name: 'password', value: initialValue('password') }),
        new Element('div', { className: 'error', textContent: initialError }), new Element('button', { type: 'submit' }));
      app.append(form);
    } else if (html.includes('id="page"')) {
      app.append(new Element('div', { id: 'page-error', className: 'error' }), new Element('div', { id: 'page' }));
    }
  };
  const listeners = new Map(), queue = [], calls = [];
  const document = {
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    head: { append() {} }, body: root,
    querySelector: selector => root.querySelector(selector), querySelectorAll: selector => root.querySelectorAll(selector),
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); },
  };
  const context = vm.createContext({
    ...template, ...referencePicker, document, structuredClone,
    setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener() {}, scrollTo() {} },
    FormData: class { constructor(form) { this.entries = form.querySelectorAll('input').filter(node => node.name).map(node => [node.name, node.value]); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } },
    fetch: async (path, options) => {
      calls.push({ path, options });
      assert.ok(queue.length, `Unexpected fetch: ${path}`);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    },
  });
  const body = source.slice(source.indexOf('\n') + 1).replace(/\nawait startApplication\(\);?\s*$/, '');
  vm.runInContext(body + `
    renderDashboard = () => { $('#page').innerHTML = 'dashboard'; };
    renderProjects = () => { $('#page').innerHTML = 'projects'; };
    globalThis.auth = {
      api, act, startApplication, completeLogin, logout, expireSession, clearSession, showError,
      seed(value) { boot = value; state = value.state; render(); },
      navigateForTest(next, args) { page = next; pageArgs = args; projectTab = 'resources'; },
      snapshot() { return { boot, state, page, pageArgs, projectTab, sessionRecovery }; }
    };`, context);
  return {
    ...context.auth, app, modal, toast, print, calls, queue,
    get loginRenders() { return loginRenders; },
    find: selector => root.querySelector(selector),
    async dispatch(name, event) { for (const listener of listeners.get(name) || []) await listener(event); },
    draft(id = 'project-form', inModal = false) {
      const form = new Element('form', { id, dataset: { id: 'draft-1', version: '7' } });
      const title = new Element('input', { name: 'p.title', value: 'ข้อความที่ยังไม่บันทึก' });
      const checkbox = new Element('input', { name: 'reference', checked: true, type: 'checkbox' });
      const references = new Element('input', { name: 'references', value: '{"selected":[{"id":"hongson-o-2","fullText":"ข้อความเดิม"}]}' });
      const evidence = new Element('input', { name: 'evidence', files: [{ name: 'หลักฐาน.pdf' }] });
      form.append(title, checkbox, references, evidence, new Element('div', { className: 'error' }));
      if (inModal) { modal.append(form); modal.style.width = 'min(1100px,96vw)'; modal.showModal(); }
      else { root.querySelector('#page').append(form); context.auth.navigateForTest('projects', { edit: 'draft-1' }); }
      return { form, title, checkbox, references, evidence };
    },
  };
}

test('initial anonymous bootstrap renders a clean login using HTTP status, while network errors remain visible', async () => {
  const ui = sessionUi();
  ui.queue.push(response(401, { error: 'กรุณาเข้าสู่ระบบ' }));
  await ui.startApplication();
  assert.match(ui.app.innerHTML, /id="login-form"/);
  assert.equal(ui.find('#login-form').querySelector('.error').textContent, '');
  assert.doesNotMatch(ui.app.innerHTML, /user-area/);
  const offline = sessionUi();
  offline.queue.push(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
  await offline.startApplication();
  assert.match(offline.find('#login-form').querySelector('.error').textContent, /เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/);
});

test('protected401 removes stale authenticated UI, clears print output and shows expiry once', async () => {
  const ui = sessionUi(); ui.seed(bootData()); ui.print.innerHTML = 'เอกสารส่วนตัว';
  ui.queue.push(response(401, { error: 'กรุณาเข้าสู่ระบบ' }), response(401, { error: 'กรุณาเข้าสู่ระบบ' }));
  await assert.rejects(ui.api('/api/action', { action: 'project.save' }), error => error.status === 401 && error.sessionExpired === true);
  assert.equal(ui.snapshot().boot, null);
  assert.equal(ui.snapshot().state, null);
  assert.doesNotMatch(ui.app.innerHTML, /user-area/);
  assert.match(ui.app.innerHTML, /เข้าสู่ระบบ/);
  assert.equal(ui.print.innerHTML, '');
  assert.equal(ui.modal.open, false);
  const renders = ui.loginRenders;
  await assert.rejects(ui.api('/api/bootstrap'), error => error.status === 401);
  assert.equal(ui.loginRenders, renders, 'a second401 must not rebuild the current login form');
});

test('wrong login401 stays on the same form and shows the credential error', async () => {
  const ui = sessionUi(); ui.queue.push(response(401)); await ui.startApplication();
  const form = ui.find('#login-form');
  form.querySelector('[name=username]').value = 'ครูที่พิมพ์ไว้';
  form.querySelector('[name=password]').value = 'รหัสที่ผิด';
  ui.queue.push(response(401, { error: 'ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง' }));
  await ui.dispatch('submit', { target: form, preventDefault() {} });
  assert.strictEqual(ui.find('#login-form'), form);
  assert.equal(form.querySelector('[name=username]').value, 'ครูที่พิมพ์ไว้');
  assert.match(form.querySelector('.error').textContent, /ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง/);
  assert.equal(form.querySelector('[type=submit]').disabled, false);
});

test('permission403, CSRF403 and network errors preserve authentication and the unsaved form', async () => {
  for (const failure of [response(403, { error: 'ไม่มีสิทธิ์' }), response(403, { error: 'โทเคนความปลอดภัยไม่ถูกต้อง' }), new Error('Failed to fetch')]) {
    const ui = sessionUi(); const boot = bootData(); ui.seed(boot); const draft = ui.draft();
    ui.queue.push(failure);
    let caught; try { await ui.api('/api/action', { action: 'project.save' }); } catch (error) { caught = error; }
    assert.ok(caught); assert.notEqual(caught.sessionExpired, true);
    ui.showError(caught, draft.form);
    assert.strictEqual(ui.snapshot().boot, boot);
    assert.strictEqual(ui.find('#project-form'), draft.form);
    assert.equal(draft.title.value, 'ข้อความที่ยังไม่บันทึก');
    assert.ok(draft.form.querySelector('.error').textContent);
  }
});

test('expired logout still clears local authentication, retained draft and rendered private data', async () => {
  const ui = sessionUi(); ui.seed(bootData()); ui.draft();
  ui.queue.push(response(401, { error: 'กรุณาเข้าสู่ระบบ' }));
  await ui.logout();
  assert.equal(ui.snapshot().boot, null);
  assert.equal(ui.snapshot().state, null);
  assert.equal(ui.snapshot().sessionRecovery, null);
  assert.equal(ui.snapshot().page, 'dashboard');
  assert.match(ui.app.innerHTML, /id="login-form"/);
});

test('same-user reauthentication restores actual project nodes, values and original version without replaying a mutation', async () => {
  const ui = sessionUi(); ui.seed(bootData(user('teacher-one', ['teacher', 'planner']))); const draft = ui.draft();
  ui.queue.push(response(401, { error: 'กรุณาเข้าสู่ระบบ' }));
  let expired; try { await ui.api('/api/action', { action: 'project.save' }); } catch (error) { expired = error; }
  ui.showError(expired, draft.form);
  assert.equal(draft.form.querySelector('.error').textContent, '', 'do not report into a detached old form');
  assert.equal(draft.form.isConnected, false);
  const login = ui.find('#login-form'), recoveryNotice = login.querySelector('.error').textContent;
  assert.match(recoveryNotice, /อย่ารีเฟรชหรือปิดแท็บ/);
  assert.equal(login.querySelector('[name=username]').value, 'teacher-one');
  assert.equal(login.querySelector('[name=password]').value, '');
  ui.queue.push(response(401)); await assert.rejects(ui.api('/api/bootstrap'));
  assert.equal(login.querySelector('.error').textContent, recoveryNotice);
  login.querySelector('[name=password]').value = 'กรอกใหม่';
  ui.queue.push(response(200, { user: user('teacher-one'), csrf: 'fresh-csrf' }), response(200, bootData(user('teacher-one', ['planner', 'teacher']))));
  await ui.dispatch('submit', { target: login, preventDefault() {} });
  assert.strictEqual(ui.find('#project-form'), draft.form);
  assert.equal(draft.form.dataset.version, '7');
  assert.equal(draft.title.value, 'ข้อความที่ยังไม่บันทึก');
  assert.equal(draft.checkbox.checked, true);
  assert.match(draft.references.value, /hongson-o-2/);
  assert.equal(draft.evidence.files[0].name, 'หลักฐาน.pdf');
  assert.equal(ui.snapshot().page, 'projects');
  assert.equal(ui.snapshot().projectTab, 'resources');
  assert.equal(ui.snapshot().boot.csrf, 'fresh-csrf');
  assert.equal(ui.snapshot().sessionRecovery, null);
  assert.deepEqual(ui.calls.map(call => call.path), ['/api/action', '/api/bootstrap', '/api/login', '/api/bootstrap']);
});

test('same-user reauthentication restores an open request modal with its original nodes and width', async () => {
  const ui = sessionUi(); ui.seed(bootData()); const draft = ui.draft('request-form', true);
  ui.queue.push(response(401)); await assert.rejects(ui.api('/api/upload', { name: 'หลักฐาน.pdf' }));
  assert.equal(ui.modal.open, false);
  ui.queue.push(response(200, bootData())); await ui.completeLogin();
  assert.equal(ui.modal.open, true);
  assert.strictEqual(ui.find('#request-form'), draft.form);
  assert.equal(ui.modal.style.width, 'min(1100px,96vw)');
  assert.equal(draft.evidence.files[0].name, 'หลักฐาน.pdf');
  assert.deepEqual(ui.calls.map(call => call.path), ['/api/upload', '/api/bootstrap']);
});

test('another account or changed permissions never receives the prior account unsaved nodes', async () => {
  for (const nextUser of [user('other-teacher'), user('teacher', ['planner'])]) {
    const ui = sessionUi(); ui.seed(bootData()); const draft = ui.draft();
    ui.queue.push(response(401)); await assert.rejects(ui.api('/api/action', { action: 'project.save' }));
    ui.queue.push(response(200, bootData(nextUser))); await ui.completeLogin();
    assert.equal(ui.find('#project-form'), null);
    assert.equal(draft.form.isConnected, false);
    assert.equal(ui.snapshot().sessionRecovery, null);
    assert.equal(ui.snapshot().boot.user.id, nextUser.id);
    assert.equal(ui.snapshot().page, 'dashboard');
  }
});

test('successful mutation followed by bootstrap401 discards the saved draft and never automatically resubmits', async () => {
  const ui = sessionUi(); ui.seed(bootData()); const draft = ui.draft();
  ui.queue.push(response(200, { id: 'draft-1' }), response(401, { error: 'กรุณาเข้าสู่ระบบ' }));
  await assert.rejects(ui.act('project.save', { id: 'draft-1', version: 7 }), error => error.sessionExpired === true);
  assert.equal(ui.snapshot().sessionRecovery, null);
  assert.match(ui.app.innerHTML, /บันทึกการทำงานสำเร็จแล้ว/);
  ui.queue.push(response(200, bootData())); await ui.completeLogin();
  assert.equal(ui.find('#project-form'), null);
  assert.equal(draft.form.isConnected, false);
  assert.equal(ui.calls.filter(call => call.options.method === 'POST').length, 1);
});
