import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as template from '../public/project-template.js';
import * as referencePicker from '../public/reference-picker.js';
import { validateProject } from '../src/domain.mjs';

// Exercise the real editor functions without a browser. This deliberately does
// not claim to check layout or native browser validation.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function editor(stateOverride = {}) {
  const listeners = {};
  const modal = {style:{},open:false,showModal(){this.open=true;}};
  const context = vm.createContext({
    ...template, ...referencePicker, structuredClone, setTimeout, clearTimeout,
    testState: {references:[],projects:[],requests:[],versions:[],commitments:[],attachments:[],audit:[],...stateOverride},
    document: {
      createElement: () => ({}), head: { append() {} }, querySelector: selector => selector==='#modal'?modal:{},
      addEventListener: (name, listener) => { const previous = listeners[name]; listeners[name] = event => { previous?.(event); listener(event); }; },
    },
    window: { addEventListener() {} },
  });
  const code = source.slice(source.indexOf('\n') + 1, source.lastIndexOf('await startApplication();'));
  vm.runInContext(code + `\nboot={user:{id:'teacher',name:'ครูทดสอบ',roles:['teacher']}};state=testState;globalThis.editor={projectFields,collectProject,recalcResources,compareProject,requestForm,requestPrintHtml};`, context);
  return { ...context.editor, listeners, modal };
}
const value = value => ({ value: String(value ?? '') });
const node = (one = {}, many = {}) => ({ querySelector: selector => one[selector] ?? null, querySelectorAll: selector => many[selector] ?? [] });
const plain = value => JSON.parse(JSON.stringify(value));

test('editor renders every SOPAA activity, including repeated and unassigned stages, and empty drafts', () => {
  const { projectFields } = editor();
  const data = {
    implementationSteps: [
      { stage: 'S', activity: 'สำรวจรอบแรก', period: 'พ.ย.', responsible: 'ครู ก' },
      { stage: 'S', activity: 'สำรวจรอบสอง', period: 'ธ.ค.', responsible: 'ครู ข' },
      { stage: '', activity: 'ยังไม่เลือกขั้นตอน', period: '', responsible: '' },
    ],
    evaluationRows: [{ indicator: 'ตัวชี้วัดหนึ่ง', method: 'ตรวจ', tool: 'แบบตรวจ' }, { indicator: 'ตัวชี้วัดสอง', method: 'สำรวจ', tool: 'แบบสำรวจ' }],
  };
  const html = projectFields(data);
  for (const row of data.implementationSteps) assert.ok(html.includes(row.activity));
  assert.equal((html.match(/data-implementation-row/g) || []).length, 7);
  assert.equal((html.match(/data-evaluation-row(?:\s|>)/g) || []).length, 2);
  assert.match(html, /name="step.stage"/);
  assert.match(html, /data-action="add-step"/);
  const blank = projectFields();
  assert.match(blank, /name="p.formTemplate" value="school-project-2569-v1"/);
  assert.doesNotMatch(blank, /required|1,781|126 คน/);
  assert.match(projectFields({ steps: 'วิธีเดิม', evaluation: 'ประเมินเดิม' }), /name="p.formTemplate" value=""/);
});

test('editor collector preserves typed structured data and satang across domain normalization', () => {
  const { collectProject } = editor();
  const steps = ['S', 'S', 'A1'].map((stage, index) => node({
    '[name="step.stage"]': value(stage), '[name="step.activity"]': value(`กิจกรรม ${index}`),
    '[name="step.period"]': value('พฤศจิกายน'), '[name="step.responsible"]': value('ครูทดสอบ'),
  }));
  const evaluation = node({ '[name="evaluation.indicator"]': value('ร้อยละ 80'), '[name="evaluation.method"]': value('ประเมิน'), '[name="evaluation.tool"]': value('แบบประเมิน') });
  const month = node({ '[name=month]': value('2026-11'), '[name=amount]': value('1.01') });
  const resourceValues = { name: 'กระดาษ', quantity: '1.005', unitPrice: '1.00', unit: 'ชุด', source: 'อุดหนุน', brand: 'เก็บยี่ห้อ', spec: 'รายละเอียด' };
  const resource = { ...node({}, {
    '[name^="r."]': Object.entries(resourceValues).map(([name, val]) => ({ name: `r.${name}`, ...value(val) })), '.spending-row': [month],
  }), dataset: { resourceId: 'r-1' } };
  const form = node({ '[data-strategic-reference]': value('{"code":"S1","origin":"ต้นฉบับ","edition":"2569"}') }, {
    '[name^="p."]': Object.entries({ title: ' แบบทดสอบ ', formTemplate: template.PROJECT_TEMPLATE_ID, standards: 'มาตรฐานหนึ่ง\nมาตรฐานสอง', steps: 'ข้อความเดิม', evaluation: 'ประเมินเดิม' }).map(([name, val]) => ({ name: `p.${name}`, ...value(val) })),
    '[data-implementation-row]': steps, '[data-evaluation-row]': [evaluation],
    '[name="budgetType"]:checked': [value('อุดหนุน')], '[name^="signature."]': [{ name: 'signature.proposerPosition', ...value('หัวหน้างาน') }], '[data-resource]': [resource],
  });
  const collected = plain(collectProject(form));
  const saved = validateProject(collected);
  assert.equal(saved.title, 'แบบทดสอบ');
  assert.deepEqual(saved.implementationSteps.map(row => row.stage), ['S', 'S', 'A1']);
  assert.equal(saved.evaluationRows[0].tool, 'แบบประเมิน');
  assert.equal(saved.signatories.proposerPosition, 'หัวหน้างาน');
  assert.equal(saved.strategicProjectReference.origin, 'ต้นฉบับ');
  assert.deepEqual(saved.standards, ['มาตรฐานหนึ่ง', 'มาตรฐานสอง']);
  assert.equal(saved.resources[0].total, 101);
  assert.equal(saved.resources[0].spending[0].amount, 101);
  assert.equal(saved.resources[0].brand, 'เก็บยี่ห้อ');
  assert.equal(saved.steps, 'ข้อความเดิม');
});

test('live totals show invalid inputs and recover without uncaught errors or stale totals', () => {
  const { recalcResources } = editor();
  const quantity = value('1.005'), price = value('1'), total = {}, check = {}, grand = {};
  const card = node({ '[name="r.quantity"]': quantity, '[name="r.unitPrice"]': price, '[data-resource-total]': total, '[data-spend-check]': check }, { '[name=amount]': [value('1.01')] });
  const form = node({}, { '[data-resource]': [card], '[data-grand-total]': [grand] });
  recalcResources(form);
  assert.equal(total.textContent, '1.01');
  assert.equal(grand.textContent, '1.01');
  quantity.value = '-1';
  assert.doesNotThrow(() => recalcResources(form));
  assert.equal(grand.textContent, 'ยังคำนวณไม่ได้');
  quantity.value = '1.005';
  recalcResources(form);
  assert.equal(grand.textContent, '1.01');
  assert.match(check.textContent, /ตรงกับยอดรายการ/);
});

test('unchanged legacy proposals do not show blank new fields as changes', () => {
  const { compareProject } = editor();
  const before = { title: 'โครงการเดิม', resources: [] };
  const after = { ...before, implementationSteps: [], evaluationRows: [], signatories: { proposer: '', director: '' }, administrationGroup: '', strategicProjectReference: {}, formTemplate: '' };
  const html = compareProject(before, after);
  assert.doesNotMatch(html, /SOPAA|signatories|administrationGroup|formTemplate|\[object Object\]/);
  assert.match(html, /งบประมาณรวม/);
});

test('request editor immediately displays all six types without projects and offers draft save',()=>{
  const {requestForm,modal,requestPrintHtml}=editor();requestForm();
  for(const type of ['unable','items','spend','quarter','purchase','budget'])assert.match(modal.innerHTML,new RegExp(`value="${type}"`));
  assert.match(modal.innerHTML,/ยังไม่เชื่อมโครงการ/);assert.match(modal.innerHTML,/บันทึกฉบับร่าง/);assert.doesNotMatch(modal.innerHTML,/ยังไม่มีกิจกรรมที่อนุมัติ/);
  assert.doesNotMatch(modal.innerHTML,/name="projectId"[^>]*required/);
  const print=requestPrintHtml({type:'spend',status:'draft',projectId:null,reason:'ข้อความร่าง',amount:0,source:'',original:null});
  assert.match(print,/ยังไม่เชื่อมโครงการ/);assert.match(print,/ข้อความร่าง/);assert.doesNotMatch(print,/undefined/);
});

test('request editor lists own projects in every state and autofills unapproved source data',()=>{
  const projects=['draft','submitted','reviewed','approved','returned'].map(status=>({id:status,status,ownerId:'teacher',approvedVersionId:null,data:{title:`กิจกรรม ${status}`,responsible:'ผู้รับผิดชอบต้นทาง',fiscalYear:'2570',quarter:'ไตรมาสต้นทาง',resources:[{quantity:1,unitPrice:12300,source:'แหล่งเงินต้นทาง'}]}}));
  projects.push({id:'foreign',status:'approved',ownerId:'other',data:{title:'ของครูคนอื่น'}});
  const {requestForm,modal}=editor({projects});requestForm('','reviewed','quarter');
  for(const status of ['draft','submitted','reviewed','approved','returned'])assert.match(modal.innerHTML,new RegExp(`value="${status}"`));
  for(const text of ['ฉบับร่าง','รอตรวจ','รอ ผอ.อนุมัติ','อนุมัติแล้ว','ส่งคืนแก้ไข','ผู้รับผิดชอบต้นทาง','ไตรมาสต้นทาง','123.00'])assert.ok(modal.innerHTML.includes(text),text);
  assert.doesNotMatch(modal.innerHTML,/ของครูคนอื่น/);
  requestForm('','draft','spend');assert.match(modal.innerHTML,/แหล่งเงินต้นทาง/);
});
