import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../src/domain.mjs';
import { PROJECT_TEMPLATE_ID, PROJECT_PRINT_CSS, SOPAA_STAGES, projectTemplateHtml, resourceLineTotal } from '../public/project-template.js';

test('school form has all nineteen source headings in order and both distinct SOPAA A stages', () => {
  const headings = ['ชื่อกิจกรรม', 'ชื่อผู้รับผิดชอบกิจกรรม', 'ชื่อโครงการ (โครงการตามกลยุทธ์)', 'สนองกลยุทธ์โรงเรียน', 'ลักษณะของโครงการ', 'สนองมาตรฐานการศึกษาขั้นพื้นฐาน', 'สนองนโยบายและจุดเน้นของสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน', 'สนองมาตรฐาน สมศ.', 'สนองมาตรฐานสากล', 'สนองแผนพัฒนาเด็กและเยาวชนในถิ่นทุรกันดารฯ', 'HONGSON Model', 'หลักการและเหตุผล', 'วัตถุประสงค์', 'เป้าหมาย', 'วิธีดำเนินการ/ขั้นตอนดำเนินการ', 'ระยะเวลาดำเนินการช่วงเดือน', 'งบประมาณ', 'การประเมินผล', 'ผลที่คาดว่าจะได้รับ'];
  const html = projectTemplateHtml();
  assert.equal(PROJECT_TEMPLATE_ID, 'school-project-2569-v1');
  assert.deepEqual([...html.matchAll(/<section[^>]+data-section="(\d+)"[^>]*><h2>(.*?)<\/h2>/g)].map(match => [Number(match[1]), match[2]]), headings.map((heading, index) => [index + 1, `${index + 1}. ${heading}`]));
  assert.deepEqual(SOPAA_STAGES.map(stage => stage.value), ['S', 'O', 'P', 'A1', 'A2']);
  assert.equal(new Set(SOPAA_STAGES.map(stage => stage.label)).size, 5);
  for (const stage of SOPAA_STAGES) assert.ok(html.includes(stage.label));
  for (const heading of ['14.1 เป้าหมายเชิงปริมาณ', '14.2 เป้าหมายเชิงคุณภาพ', 'ระยะเวลาดำเนินงาน', 'ตัวชี้วัดความสำเร็จ', 'วิธีการประเมิน', 'เครื่องมือที่ใช้']) assert.ok(html.includes(heading));
  assert.doesNotMatch(html, /undefined|\bnull\b|NaN|\[object Object\]/);
  assert.equal(projectTemplateHtml(null), html);
});

test('all user-controlled fields are escaped, including table cells, names, references and status', () => {
  const attack = '<script>alert("x")</script>&\'';
  const escaped = '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;';
  const data = Object.fromEntries(['title', 'academicYear', 'fiscalYear', 'term', 'responsible', 'group', 'administrationGroup', 'strategy', 'obecPolicy', 'onesqa', 'worldClass', 'kpd', 'hongson', 'rationale', 'objectives', 'quantitativeTarget', 'qualitativeTarget', 'steps', 'evaluation', 'expectedResults', 'activityPeriod', 'quarter', 'procurementMonth', 'activityMonth', 'budgetOther', 'startDate', 'endDate'].map(key => [key, attack]));
  data.strategicProjectId = 'strategy-1';
  data.standards = [attack];
  data.implementationSteps = [{ stage: 'S', activity: attack, period: attack, responsible: attack }];
  data.evaluationRows = [{ indicator: attack, method: attack, tool: attack }];
  data.signatories = Object.fromEntries(['proposer', 'proposerPosition', 'planningHead', 'budgetHead', 'budgetDeputy', 'administrationHead', 'administrationDeputy', 'director'].map(key => [key, attack]));
  data.resources = [{ quantity: 1, unitPrice: 100, source: attack, brand: 'SECRET BRAND' }];
  const html = projectTemplateHtml(data, { references: [{ id: 'strategy-1', name: attack }], versionLabel: attack, statusLabel: attack });
  assert.doesNotMatch(html, /<script>|<\/script>|alert\("x"\)|SECRET BRAND/);
  assert.ok(html.split(escaped).length > 40);
});

test('fractional resource calculations match domain rounding and do not accept unsafe amounts', () => {
  for (const [quantity, unitPrice] of [[0, 0], [1, 12345], [0.001, 500], [0.001, 499], [0.145, 1900], [1.015, 90001], [999999.999, 9000000], [0.001, 9000000000000], [1, 9000000000000]]) {
    const resource = { name: 'Resource', quantity, unitPrice, source: 'source', unit: 'item' };
    const validated = validateProject({ resources: [resource] });
    assert.equal(resourceLineTotal(resource), validated.resources[0].total, `${quantity} × ${unitPrice}`);
    assert.equal(resourceLineTotal(resource), validated.total);
  }
  assert.equal(resourceLineTotal({ quantity: 0.001, unitPrice: 500 }), 1);
  assert.equal(resourceLineTotal(), 0);
  for (const resource of [{ quantity: -1, unitPrice: 100 }, { quantity: 0.0001, unitPrice: 100 }, { quantity: 1, unitPrice: 1.2 }, { quantity: Infinity, unitPrice: 100 }, { quantity: 2, unitPrice: 9000000000000 }]) {
    assert.throws(() => resourceLineTotal(resource), RangeError);
    assert.throws(() => validateProject({ resources: [resource] }));
  }
  const html = projectTemplateHtml({ total: 88888888, budgetTypes: ['อุดหนุน', 'อื่นๆ'], budgetOther: 'เงินบริจาค', resources: [{ quantity: 1.5, unitPrice: 10000, source: 'อุดหนุน', total: 99999999, brand: 'PRIVATE_SUPPLIER' }, { quantity: 0.001, unitPrice: 500, source: 'เงินบริจาค' }] });
  for (const amount of ['150.01', '150.00', '0.01']) assert.ok(html.includes(amount));
  assert.equal((html.match(/project-checkbox is-checked/g) || []).length, 2);
  assert.doesNotMatch(html, /PRIVATE_SUPPLIER|888,888\.88|999,999\.99/);
});

test('frozen strategic project names win over live references and legacy narratives remain visible', () => {
  const data = { strategicProjectId: 'strategy-1', strategicProjectName: 'ชื่อโครงการ ณ วันที่อนุมัติ', steps: 'วิธีดำเนินงานเดิม\nบรรทัดที่สอง', evaluation: 'วิธีประเมินเดิม', implementationSteps: [{ stage: 'A1', activity: 'ประเมินกิจกรรม', period: 'พฤศจิกายน', responsible: 'ผู้ประเมิน' }, { stage: 'A2', activity: 'นำผลไปพัฒนา', period: 'ธันวาคม', responsible: 'ผู้รับผิดชอบ' }], evaluationRows: [{ indicator: 'ร้อยละ 80', method: 'สำรวจ', tool: 'แบบสอบถาม' }] };
  const references = [{ id: 'strategy-1', name: 'ชื่ออ้างอิงที่เปลี่ยนภายหลัง' }];
  const html = projectTemplateHtml(data, { references });
  for (const value of ['ชื่อโครงการ ณ วันที่อนุมัติ', data.steps, data.evaluation, 'ประเมินกิจกรรม', 'นำผลไปพัฒนา', 'ร้อยละ 80', 'สำรวจ', 'แบบสอบถาม']) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /ชื่ออ้างอิงที่เปลี่ยนภายหลัง/);
  assert.match(projectTemplateHtml({ strategicProjectId: 'strategy-1' }, { references }), /ชื่ออ้างอิงที่เปลี่ยนภายหลัง/);
  assert.match(projectTemplateHtml({ strategicProjectId: 'deleted-reference' }), /deleted-reference/);
  assert.match(projectTemplateHtml({ steps: data.steps, evaluation: data.evaluation }), /วิธีประเมินเดิม/);
});

test('period, quarter and month text stay explicit while ISO dates print in the Buddhist calendar', () => {
  const html = projectTemplateHtml({ activityPeriod: 'พฤศจิกายน–มีนาคม', quarter: '1 และ 2', procurementMonth: 'ตุลาคม และ มกราคม', activityMonth: 'ตลอดภาคเรียน', startDate: '2026-11-10', endDate: '2027-03-05', term: '2', academicYear: '2569' });
  for (const value of ['พฤศจิกายน–มีนาคม', '1 และ 2', 'ตุลาคม และ มกราคม', 'ตลอดภาคเรียน', '10 พฤศจิกายน 2569', '5 มีนาคม 2570']) assert.ok(html.includes(value));
});

test('approval sheet is separate and never checks decisions or fabricates signed approval from status', () => {
  const html = projectTemplateHtml({ projectType: 'โครงการต่อเนื่อง', budgetTypes: ['อุดหนุน'], status: 'approved', approvedAt: '2026-11-10', signatories: { proposer: 'ผู้เสนอทดสอบ', proposerPosition: 'หัวหน้างานทดสอบ', director: 'ผู้อำนวยการทดสอบ' } }, { versionLabel: 'ฉบับที่ 3', statusLabel: 'อนุมัติแล้ว' });
  assert.match(html, /ฉบับที่ 3 · อนุมัติแล้ว/);
  assert.match(html, /ผู้เสนอทดสอบ/);
  assert.match(html, /หัวหน้างานทดสอบ/);
  const approval = html.slice(html.indexOf('<section class="approval-page"'));
  assert.ok(approval.includes('ผู้อำนวยการทดสอบ'));
  assert.equal((approval.match(/class="project-checkbox"/g) || []).length, 4);
  assert.doesNotMatch(approval, /is-checked|✓|2026-11-10|อนุมัติแล้ว/);
  assert.match(approval, /project-signature-line">\.{48}</);
  assert.equal((approval.match(/class="project-signature"/g) || []).length, 6);
  assert.match(PROJECT_PRINT_CSS, /@page school-project\{size:A4 portrait;margin:25\.4mm\}/);
  assert.match(PROJECT_PRINT_CSS, /\.approval-page\{[^}]*break-before:page/);
  assert.match(PROJECT_PRINT_CSS, /font-family:"TH Sarabun PSK"/);
});
