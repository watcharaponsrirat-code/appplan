import { randomUUID } from 'node:crypto';
import { normalizeSchoolReferences } from './project-references.mjs';

/** All amounts are integer satang; this module never performs network requests. */
export class DomainError extends Error {
  constructor(status, message) { super(message); this.name = 'DomainError'; this.status = status; }
}
const fail = (message, status = 422) => { throw new DomainError(status, message); };
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const id = () => randomUUID();
const moneyLimit = 9_000_000_000_000;
const operational = ['planner', 'plan_head', 'director', 'procurement', 'finance', 'admin'];
const changes = ['items', 'quarter', 'budget'];
const requestTypes = ['unable', 'items', 'spend', 'quarter', 'purchase', 'budget'];
const problemCategories = ['บุคลากร', 'งบประมาณ', 'วัสดุ', 'การประสานงาน/บริหาร', 'สถานที่', 'อื่น ๆ'];
const projectTemplate = 'school-project-2569-v1';
const sopaaStages = ['S', 'O', 'P', 'A1', 'A2'];
const budgetTypeOptions = ['อุดหนุน', 'กิจกรรมพัฒนาผู้เรียน', 'บำรุงการศึกษา', 'ระดมทรัพยากร', 'อื่นๆ'];
const signatoryFields = ['proposer', 'proposerPosition', 'planningHead', 'budgetHead', 'budgetDeputy', 'administrationHead', 'administrationDeputy', 'director'];
const projectFields = ['title', 'academicYear', 'fiscalYear', 'term', 'group', 'responsible', 'strategicProjectId', 'strategy', 'projectType', 'obecPolicy', 'onesqa', 'worldClass', 'kpd', 'hongson', 'rationale', 'objectives', 'quantitativeTarget', 'qualitativeTarget', 'steps', 'startDate', 'endDate', 'evaluation', 'expectedResults'];
const requiredFields = ['title', 'academicYear', 'fiscalYear', 'term', 'group', 'responsible', 'strategicProjectId', 'strategy', 'projectType', 'rationale', 'objectives', 'quantitativeTarget', 'qualitativeTarget', 'steps', 'startDate', 'endDate', 'evaluation', 'expectedResults'];
const fieldNames = { title: 'ชื่อกิจกรรม', academicYear: 'ปีการศึกษา', fiscalYear: 'ปีงบประมาณ', term: 'ภาคเรียน', group: 'กลุ่มงาน', responsible: 'ผู้รับผิดชอบ', strategicProjectId: 'โครงการเชิงกลยุทธ์', strategy: 'กลยุทธ์', projectType: 'ลักษณะโครงการ', rationale: 'หลักการและเหตุผล', objectives: 'วัตถุประสงค์', quantitativeTarget: 'เป้าหมายเชิงปริมาณ', qualitativeTarget: 'เป้าหมายเชิงคุณภาพ', steps: 'ขั้นตอนดำเนินงาน', startDate: 'วันเริ่มกิจกรรม', endDate: 'วันสิ้นสุดกิจกรรม', evaluation: 'การประเมินผล', expectedResults: 'ผลที่คาดว่าจะได้รับ' };
function string(value, label = 'ข้อความ', max = 20000) {
  if (value === null || value === undefined) return '';
  if (!['string', 'number'].includes(typeof value)) fail(`${label} ต้องเป็นข้อความ`);
  const result = String(value).trim();
  if (result.length > max) fail(`${label} ยาวเกิน ${max} ตัวอักษร`);
  return result;
}
function amount(value, label = 'จำนวนเงิน') {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > moneyLimit) fail(`${label} ต้องเป็นจำนวนสตางค์เต็มที่ไม่ติดลบและไม่เกินขอบเขต`);
  return value;
}
function sum(values) { const result = values.reduce((a, b) => a + b, 0); return amount(result, 'ยอดรวม'); }
function date(value, label, required = false) {
  const result = string(value, label, 10);
  if (!result && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) fail(`${label} ไม่ใช่วันที่ที่ถูกต้อง`);
  return result;
}
function array(value, label, max = 1000) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} ต้องเป็นรายการไม่เกิน ${max} รายการ`);
  return value;
}
function object(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail(`${label} ต้องเป็นข้อมูลแบบออบเจ็กต์`);
  return value;
}
function evidence(value, required = false) {
  const list = [...new Set(array(value, 'หลักฐาน', 100).map(x => string(x, 'รหัสหลักฐาน', 200)))];
  if (list.some(x => !x) || required && !list.length) fail('กรุณาแนบหลักฐานประกอบรายการ');
  return list;
}
function has(user, ...roles) { return roles.some(role => user.roles?.includes(role)); }
function requireRole(user, ...roles) { if (!has(user, ...roles)) fail('คุณไม่มีสิทธิ์ดำเนินการนี้', 403); }
function get(state, list, entityId) { return state[list].find(x => x.id === entityId) || fail('ไม่พบรายการ', 404); }
function checkVersion(entity, version) {
  if (!Number.isSafeInteger(version) || entity.version !== version) fail('ข้อมูลถูกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำรายการ', 409);
}
function own(user, project) { requireRole(user, 'teacher'); if (project.ownerId !== user.id) fail('แก้ไขได้เฉพาะโครงการที่ตนรับผิดชอบ', 403); }
function status(entity, allowed) { if (!allowed.includes(entity.status)) fail('สถานะรายการไม่อนุญาตให้ทำขั้นตอนนี้', 409); }
function bump(entity) { entity.version += 1; entity.updatedAt = now(); }
function entityBase(user) { return { id: id(), version: 1, ownerId: user.id, createdAt: now(), updatedAt: now() }; }
function ensureState(state) {
  for (const key of ['projects', 'versions', 'requests', 'commitments', 'payments', 'summaries', 'audit', 'outbox', 'allocations', 'references', 'notifications']) state[key] ||= [];
  state.settings ||= { projectDeadline: '', summaryDeadline: '', reminderDays: 7 };
}
function audit(state, user, action, entityType, entity, before = null, reason = '') {
  state.audit.push({ id: id(), at: now(), actorId: user.id, actorName: user.name || user.id, action, entityType, entityId: entity.id, projectId: entityType === 'project' ? entity.id : entity.projectId || null, reason, before: clone(before), after: clone(entity) });
}
function inform(state, project, message, action, entityId) {
  state.notifications.push({ id: id(), version: 1, userId: project.ownerId, projectId: project.id, entityId, action, message, createdAt: now(), updatedAt: now(), readAt: null });
}
function lineTotal(resource) {
  const q = BigInt(Math.round(resource.quantity * 1000));
  return amount(Number((q * BigInt(resource.unitPrice) + 500n) / 1000n), 'ยอดทรัพยากร');
}
function budgetBySource(data) {
  const result = Object.create(null);
  for (const resource of data?.resources || []) result[resource.source] = sum([result[resource.source] || 0, lineTotal(resource)]);
  return result;
}

/** Returns a sanitized copy, throwing DomainError for invalid data. */
export function validateProject(data, strict = false, options = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('ไม่พบข้อมูลโครงการ');
  const result = {};
  for (const field of projectFields) result[field] = string(data[field], fieldNames[field] || field);
  result.formTemplate = string(data.formTemplate, 'รุ่นแบบฟอร์ม', 100);
  if (result.formTemplate && result.formTemplate !== projectTemplate) fail('ไม่รองรับรุ่นแบบฟอร์มโครงการนี้');
  for (const field of ['strategicProjectName', 'administrationGroup', 'activityPeriod', 'procurementMonth', 'activityMonth', 'quarter', 'budgetOther']) result[field] = string(data[field], field, 2000);
  const reference = object(data.strategicProjectReference, 'ที่มาของโครงการเชิงกลยุทธ์');
  result.strategicProjectReference = Object.fromEntries(['code', 'origin', 'edition'].map(key => [key, string(reference[key], key, 2000)]));
  const signatories = object(data.signatories, 'ผู้ลงนาม');
  result.signatories = Object.fromEntries(signatoryFields.map(key => [key, string(signatories[key], 'ข้อมูลผู้ลงนาม', 500)]));
  result.budgetTypes = [...new Set(array(data.budgetTypes, 'ประเภทงบประมาณ', 5).map(value => {
    const type = string(value, 'ประเภทงบประมาณ', 100);
    if (!budgetTypeOptions.includes(type)) fail('ประเภทงบประมาณไม่ตรงรายการในแบบฟอร์ม');
    return type;
  }))];
  result.implementationSteps = array(data.implementationSteps, 'ขั้นตอน SOPAA', 100).map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`ขั้นตอน SOPAA รายการ ${index + 1} ไม่ถูกต้อง`);
    const row = { stage: string(value.stage, 'ขั้นตอน SOPAA', 10), activity: string(value.activity, 'กิจกรรมในขั้นตอน SOPAA', 10000), period: string(value.period, 'ระยะเวลาในขั้นตอน SOPAA', 2000), responsible: string(value.responsible, 'ผู้รับผิดชอบในขั้นตอน SOPAA', 2000) };
    if (row.stage && !sopaaStages.includes(row.stage)) fail('ขั้นตอน SOPAA ต้องเป็น S, O, P, A1 หรือ A2');
    if (strict && Object.values(row).some(value => !value)) fail(`กรุณากรอกขั้นตอน กิจกรรม ระยะเวลา และผู้รับผิดชอบของ SOPAA รายการ ${index + 1}`);
    return row;
  });
  result.evaluationRows = array(data.evaluationRows, 'ตารางการประเมินผล', 100).map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`การประเมินผลรายการ ${index + 1} ไม่ถูกต้อง`);
    const row = { indicator: string(value.indicator, 'ตัวชี้วัด', 10000), method: string(value.method, 'วิธีการประเมิน', 10000), tool: string(value.tool, 'เครื่องมือการประเมิน', 10000) };
    if (strict && Object.values(row).some(value => !value)) fail(`กรุณากรอกตัวชี้วัด วิธีการ และเครื่องมือการประเมินรายการ ${index + 1}`);
    return row;
  });
  result.standards = [...new Set(array(data.standards, 'มาตรฐาน', 200).map(x => string(x, 'มาตรฐาน', 20000)).filter(Boolean))];
  try { Object.assign(result, normalizeSchoolReferences(data, { ...options, strict })); }
  catch (error) { if (error.status) fail(error.message, error.status); throw error; }
  if (strict) {
    const currentTemplate = result.formTemplate === projectTemplate;
    for (const field of requiredFields) if (!(currentTemplate && ['steps', 'evaluation'].includes(field)) && !result[field]) fail(`กรุณากรอก${fieldNames[field]}`);
    if (currentTemplate && sopaaStages.some(stage => !result.implementationSteps.some(row => row.stage === stage))) fail('กรุณากรอกขั้นตอน SOPAA ให้ครบ S, O, P, A1 และ A2');
    if (currentTemplate && !result.evaluationRows.length) fail('กรุณากรอกตารางการประเมินผลอย่างน้อยหนึ่งรายการ');
  }
  for (const field of ['academicYear', 'fiscalYear']) if (result[field] && !/^\d{4}$/.test(result[field])) fail(`${fieldNames[field]} ต้องเป็นปี 4 หลัก`);
  result.startDate = date(data.startDate, 'วันเริ่มกิจกรรม', strict);
  result.endDate = date(data.endDate, 'วันสิ้นสุดกิจกรรม', strict);
  if (result.startDate && result.endDate && result.endDate < result.startDate) fail('วันสิ้นสุดต้องไม่ก่อนวันเริ่มกิจกรรม');
  result.resources = array(data.resources, 'ทรัพยากร', 500).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`ทรัพยากรรายการ ${index + 1} ไม่ถูกต้อง`);
    const quantity = item.quantity ?? 0;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001) fail('จำนวนทรัพยากรต้องไม่ติดลบและมีทศนิยมไม่เกิน 3 ตำแหน่ง');
    const resource = { id: string(item.id, 'รหัสทรัพยากร', 200) || id(), name: string(item.name, 'ชื่อทรัพยากร', 1000), spec: string(item.spec, 'คุณลักษณะ'), brand: string(item.brand, 'ยี่ห้อ', 1000), quantity, unit: string(item.unit, 'หน่วย', 100), unitPrice: amount(item.unitPrice ?? 0, 'ราคาต่อหน่วย'), source: string(item.source, 'แหล่งเงิน', 500), priceVersion: string(item.priceVersion, 'รุ่นราคา', 500), priceDate: date(item.priceDate, 'วันที่ราคา'), spending: [] };
    if (strict && (!resource.name || !resource.unit || !resource.source || !resource.quantity)) fail(`กรุณากรอกชื่อ จำนวน หน่วย และแหล่งเงินของทรัพยากรรายการ ${index + 1}`);
    resource.total = lineTotal(resource);
    const months = new Set();
    resource.spending = array(item.spending, 'เดือนใช้เงิน', 120).map(part => {
      const month = string(part.month, 'เดือนใช้เงิน', 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('เดือนใช้เงินต้องเป็น YYYY-MM');
      if (months.has(month)) fail('เดือนใช้เงินซ้ำในทรัพยากรรายการเดียวกัน');
      months.add(month);
      return { month, amount: amount(part.amount, 'ยอดใช้เงินรายเดือน') };
    });
    const spendingTotal = sum(resource.spending.map(part => part.amount));
    if (spendingTotal > resource.total || strict && spendingTotal !== resource.total) fail(`ยอดแบ่งใช้เงินรายเดือนของรายการ ${index + 1} ต้องเท่ากับยอดทรัพยากร`);
    return resource;
  });
  if (new Set(result.resources.map(r => r.id)).size !== result.resources.length) fail('รหัสทรัพยากรซ้ำ');
  result.total = sum(result.resources.map(lineTotal));
  return result;
}

function resolveStrategicReference(state, data, previous = null) {
  if (data.referenceSelections) return;
  const clearReference = () => {
    data.strategicProjectName = '';
    data.strategicProjectReference = { code: '', origin: '', edition: '' };
  };
  if (!data.strategicProjectId) { clearReference(); return; }
  if (previous && data.strategicProjectId === previous.strategicProjectId) {
    data.strategicProjectName = previous.strategicProjectName || data.strategicProjectName;
    if (previous.strategicProjectReference) data.strategicProjectReference = clone(previous.strategicProjectReference);
    return;
  }
  const reference = state.references.find(row => row.id === data.strategicProjectId && row.kind === 'strategic_project');
  if (reference) {
    data.strategicProjectName = reference.name;
    data.strategicProjectReference = Object.fromEntries(['code', 'origin', 'edition'].map(key => [key, string(reference[key], key, 2000)]));
  } else clearReference();
}

export function totals(state, projectId) {
  const project = state.projects.find(p => p.id === projectId);
  const snapshot = state.versions.find(v => v.id === project?.approvedVersionId);
  const budgets = budgetBySource(snapshot?.data);
  const commitments = state.commitments.filter(c => c.projectId === projectId);
  const bySource = Object.create(null);
  for (const source of new Set([...Object.keys(budgets), ...commitments.map(c => c.source)])) {
    const relevant = commitments.filter(c => c.source === source);
    const paid = sum(relevant.map(c => c.paid));
    const reserved = sum(relevant.map(c => c.amount - c.paid));
    bySource[source] = { approved: budgets[source] || 0, paid, reserved, available: (budgets[source] || 0) - paid - reserved };
  }
  const rows = Object.values(bySource);
  return { approved: sum(rows.map(x => x.approved)), paid: sum(rows.map(x => x.paid)), reserved: sum(rows.map(x => x.reserved)), available: rows.reduce((a, x) => a + x.available, 0), bySource: Object.fromEntries(Object.entries(bySource)) };
}
function guardBudget(state, projectId, data) {
  const proposed = budgetBySource(data);
  const used = totals(state, projectId).bySource;
  for (const [source, balance] of Object.entries(used)) if ((proposed[source] || 0) < balance.paid + balance.reserved) fail(`แหล่งเงิน ${source} มีงบใหม่ต่ำกว่ายอดจ่ายจริงและยอดกันไว้`);
}
function snapshot(state, user, project, data, requestId = null) {
  guardBudget(state, project.id, data);
  const record = { id: id(), projectId: project.id, number: state.versions.filter(v => v.projectId === project.id).length + 1, data: clone(data), approvedAt: now(), approvedBy: user.id, requestId };
  state.versions.push(record);
  project.approvedVersionId = record.id;
  for (const destination of ['strategy', 'budget', 'quarter', 'standards']) {
    const key = `${project.id}:${record.id}:${destination}`;
    if (!state.outbox.some(x => x.key === key)) state.outbox.push({ id: id(), version: 1, key, projectId: project.id, approvedVersionId: record.id, destination, status: 'blocked', attempts: 0, error: 'ยังไม่ได้ตั้งค่าหรือเชื่อม Google Sheets จริง', createdAt: now(), updatedAt: now(), payload: clone(record) });
  }
  return record;
}
function approved(state, project) {
  if (!project.approvedVersionId) fail('ต้องเลือกกิจกรรมที่ได้รับอนุมัติแล้ว');
  return get(state, 'versions', project.approvedVersionId);
}
function transitionProject(state, user, input) {
  const project = get(state, 'projects', input.id);
  checkVersion(project, input.version);
  const before = clone(project);
  const reason = string(input.reason, 'เหตุผล');
  if (input.action === 'project.submit') {
    own(user, project); status(project, ['draft', 'returned']);
    project.data = validateProject(project.data, true, { previous: project.data });
    project.status = 'submitted'; project.submittedAt = now();
  } else if (input.action === 'project.review') {
    requireRole(user, 'planner', 'plan_head'); status(project, ['submitted']);
    if (!['forward', 'return'].includes(input.decision)) fail('ผลตรวจไม่ถูกต้อง');
    if (input.decision === 'return' && !reason) fail('กรุณาระบุเหตุผลส่งคืน');
    project.status = input.decision === 'return' ? 'returned' : 'reviewed';
    project.reviewedBy = user.id; project.reviewedAt = now();
  } else {
    requireRole(user, 'director'); status(project, ['reviewed']);
    if (!['approve', 'return'].includes(input.decision)) fail('ผลอนุมัติไม่ถูกต้อง');
    if (input.decision === 'return' && !reason) fail('กรุณาระบุเหตุผลส่งคืน');
    project.status = input.decision === 'return' ? 'returned' : 'approved';
    if (input.decision === 'approve') { project.data = validateProject(project.data, true, { previous: project.data }); snapshot(state, user, project, project.data); }
  }
  project.lastReason = reason; bump(project);
  audit(state, user, input.action, 'project', project, before, reason);
  if (input.action !== 'project.submit') inform(state, project, project.status === 'returned' ? `ส่งคืนโครงการ: ${reason}` : project.status === 'approved' ? 'โครงการได้รับอนุมัติแล้ว' : 'โครงการผ่านงานแผน รอผู้อำนวยการ', input.action, project.id);
  return project;
}
function normalizeRequest(state, user, input, existing) {
  requireRole(user, 'teacher');
  if (existing && existing.ownerId !== user.id) fail('แก้ไขได้เฉพาะคำขอของตนเอง', 403);
  const projectId = string(input.projectId ?? existing?.projectId, 'รหัสโครงการ', 200) || null;
  const project = projectId ? get(state, 'projects', projectId) : null;
  if (project) own(user, project);
  const original = project ? (project.approvedVersionId ? approved(state, project) : { id: null, data: project.data }) : null;
  const type = input.type || existing?.type;
  if (!requestTypes.includes(type)) fail('ประเภทคำขอไม่ถูกต้อง');
  if (existing && (existing.projectId && existing.projectId !== projectId || existing.type !== type)) fail('เปลี่ยนโครงการที่เชื่อมแล้วหรือประเภทของคำขอเดิมไม่ได้');
  const record = { projectId, type, reason: string(input.reason, 'เหตุผล'), evidence: evidence(input.evidence), proposed: changes.includes(type) ? validateProject(input.proposed || original?.data || {}, false, { previous: existing?.proposed || original?.data }) : null, source: string(input.source, 'แหล่งเงิน', 500), amount: amount(input.amount ?? 0), linkedCommitmentId: string(input.linkedCommitmentId, 'รหัสรายการกันวงเงิน', 200) || null };
  if (!project && record.evidence.length) fail('กรุณาเชื่อมโครงการก่อนแนบหลักฐาน');
  if (record.proposed) resolveStrategicReference(state, record.proposed, original?.data);
  if (record.linkedCommitmentId) {
    if (!['spend', 'purchase'].includes(type)) fail('เชื่อมวงเงินได้เฉพาะคำขอใช้เงินหรือจัดซื้อ');
    const commitment = get(state, 'commitments', record.linkedCommitmentId);
    if (!project || commitment.projectId !== project.id || commitment.source !== record.source) fail('รายการกันวงเงินต้องอยู่ในกิจกรรมและแหล่งเงินเดียวกัน');
  }
  return { project, record, original };
}
function validateRequest(state, request) {
  if (!request.reason) fail('กรุณาระบุเหตุผลคำขอ');
  if (!request.projectId) fail('กรุณาเชื่อมโครงการก่อนส่งคำขอ');
  const project = get(state, 'projects', request.projectId);
  if (changes.includes(request.type)) {
    if (request.baseApprovedVersionId && request.baseApprovedVersionId !== project.approvedVersionId) fail('ฉบับอนุมัติเปลี่ยนแล้ว กรุณาสร้างคำขอใหม่จากฉบับล่าสุด', 409);
    // A pre-approval request can be reviewed while the project itself is incomplete.
    // Only a request based on an approved version can revise an approved project.
    request.proposed = validateProject(request.proposed, Boolean(request.baseApprovedVersionId), { previous: request.proposed });
    guardBudget(state, project.id, request.proposed);
  }
  if (['spend', 'purchase'].includes(request.type)) {
    if (!request.source || request.amount <= 0) fail('กรุณาระบุแหล่งเงินและยอดขอใช้เงินมากกว่าศูนย์');
    if (project.approvedVersionId) {
      const limit = totals(state, project.id).bySource[request.source];
      if (!limit || request.amount > limit.approved) fail('ยอดคำขอเกินงบอนุมัติของแหล่งเงิน');
    }
    if (request.linkedCommitmentId) {
      const commitment = get(state, 'commitments', request.linkedCommitmentId);
      if (commitment.projectId !== project.id || commitment.source !== request.source || request.amount > commitment.amount) fail('คำขอเชื่อมต้องอยู่ในแหล่งเงินเดียวกันและไม่เกินรายการกันวงเงิน');
    }
  }
}
function normalizeSummary(data, strict = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('ข้อมูลสรุปไม่ถูกต้อง');
  const participants = data.participants === '' || data.participants === undefined || data.participants === null ? null : data.participants;
  if (participants !== null && (!Number.isSafeInteger(participants) || participants < 0 || participants > 10_000_000)) fail('ผู้เข้าร่วมต้องเป็นจำนวนเต็มที่ไม่ติดลบ');
  const success = data.success === '' || data.success === undefined || data.success === null ? null : data.success;
  if (success !== null && (typeof success !== 'number' || !Number.isFinite(success) || success < 0 || success > 100)) fail('ความสำเร็จต้องอยู่ระหว่าง 0 ถึง 100');
  const scores = array(data.scores, 'คะแนนประเมิน', 8).map(value => {
    if (value === '' || value === null || value === undefined) return null;
    if (!Number.isInteger(value) || value < 1 || value > 4) fail('คะแนนประเมินแต่ละข้อต้องเป็นจำนวนเต็ม 1 ถึง 4');
    return value;
  });
  while (scores.length < 8) scores.push(null);
  let problems = array(data.problems, 'ปัญหา', 6).map(p => {
    const problem = { category: string(p.category, 'หมวดปัญหา', 100), status: p.status || 'unanswered', cause: string(p.cause), solution: string(p.solution), result: string(p.result), suggestion: string(p.suggestion) };
    if (!problem.category || !['unanswered', 'none', 'problem'].includes(problem.status)) fail('หมวดหรือสถานะปัญหาไม่ถูกต้อง');
    if (strict && problem.status === 'problem' && (!problem.cause || !problem.solution)) fail('ปัญหาที่พบต้องระบุสาเหตุและแนวทางแก้ไข');
    return problem;
  });
  if (!problems.length) problems = problemCategories.map(category => ({ category, status: 'unanswered', cause: '', solution: '', result: '', suggestion: '' }));
  if (new Set(problems.map(p => p.category)).size !== problems.length) fail('หมวดปัญหาซ้ำ');
  const result = { actualDate: date(data.actualDate, 'วันที่จัดกิจกรรมจริง', strict), participants, outcome: string(data.outcome, 'ผลดำเนินงาน'), success, scores, problems, suggestions: string(data.suggestions), coverType: data.coverType || 'subject', evidence: evidence(data.evidence) };
  if (!['subject', 'administration'].includes(result.coverType)) fail('รูปแบบหน้าปกไม่ถูกต้อง');
  if (strict && (participants === null || success === null || !result.outcome || scores.some(x => x === null))) fail('กรุณากรอกผู้เข้าร่วม ผลดำเนินงาน ความสำเร็จ และคะแนนประเมินทั้ง 8 ข้อ');
  if (strict && (problems.length !== 6 || problems.some(p => p.status === 'unanswered'))) fail('กรุณาตอบสถานะปัญหาทั้ง 6 หมวด ช่องว่างไม่เท่ากับไม่มีปัญหา');
  return result;
}

function apply(state, user, input) {
  if (!user?.id || !Array.isArray(user.roles)) fail('กรุณาเข้าสู่ระบบ', 401);
  if (!input || typeof input.action !== 'string') fail('ไม่พบคำสั่ง');
  const action = input.action;
  if (action === 'project.save') {
    if (input.id) {
      const project = get(state, 'projects', input.id); own(user, project); checkVersion(project, input.version); status(project, ['draft', 'returned']);
      const data = validateProject(input.data, false, { previous: project.data });
      resolveStrategicReference(state, data, project.data);
      const before = clone(project); project.data = data; bump(project); audit(state, user, action, 'project', project, before); return project;
    }
    requireRole(user, 'teacher');
    const data = validateProject(input.data);
    resolveStrategicReference(state, data);
    const project = { ...entityBase(user), status: 'draft', data, approvedVersionId: null, lastReason: '' };
    state.projects.push(project); audit(state, user, action, 'project', project); return project;
  }
  if (['project.submit', 'project.review', 'project.approve'].includes(action)) return transitionProject(state, user, input);
  if (action === 'project.batch') {
    if (!['forward', 'approve'].includes(input.decision)) fail('ผลตรวจหลายรายการไม่ถูกต้อง');
    requireRole(user, input.decision === 'forward' ? 'plan_head' : 'director');
    const items = array(input.items, 'รายการที่เลือก', 500);
    if (!items.length || new Set(items.map(x => x.id)).size !== items.length) fail('กรุณาเลือกอย่างน้อยหนึ่งรายการและห้ามซ้ำ');
    const ids = items.map(item => transitionProject(state, user, { ...item, action: input.decision === 'forward' ? 'project.review' : 'project.approve', decision: input.decision }).id);
    return { ids };
  }
  if (action === 'request.save') {
    const existing = input.id ? get(state, 'requests', input.id) : null;
    if (existing) { checkVersion(existing, input.version); status(existing, ['draft', 'returned']); }
    const { record, original } = normalizeRequest(state, user, input, existing);
    if (existing) {
      const before = clone(existing);
      if (!existing.projectId && record.projectId) {
        existing.baseApprovedVersionId = original.id;
        existing.original = clone(original.data);
      }
      Object.assign(existing, record); bump(existing); audit(state, user, action, 'request', existing, before); return existing;
    }
    const request = { ...entityBase(user), ...record, status: 'draft', baseApprovedVersionId: original?.id || null, original: original ? clone(original.data) : null, history: [], lastReason: '' };
    state.requests.push(request); audit(state, user, action, 'request', request); return request;
  }
  if (['request.submit', 'request.review', 'request.approve'].includes(action)) {
    const request = get(state, 'requests', input.id); checkVersion(request, input.version);
    if (action === 'request.submit') {
      requireRole(user, 'teacher');
      if (request.ownerId !== user.id) fail('ส่งได้เฉพาะคำขอของตนเอง', 403);
    }
    if (!request.projectId) fail('กรุณาเชื่อมโครงการก่อนส่งคำขอ');
    const project = get(state, 'projects', request.projectId); const before = clone(request); const reason = string(input.reason, 'เหตุผล');
    if (action === 'request.submit') {
      own(user, project); status(request, ['draft', 'returned']); validateRequest(state, request); request.status = 'submitted'; request.submittedAt = now();
    } else if (action === 'request.review') {
      requireRole(user, 'planner', 'plan_head'); status(request, ['submitted']);
      if (!['forward', 'return'].includes(input.decision)) fail('ผลตรวจไม่ถูกต้อง');
      if (input.decision === 'return' && !reason) fail('กรุณาระบุเหตุผลส่งคืน');
      if (input.decision === 'forward') validateRequest(state, request);
      request.status = input.decision === 'forward' ? 'reviewed' : 'returned'; request.reviewedBy = user.id;
    } else {
      requireRole(user, 'director'); status(request, ['reviewed']);
      if (!['approve', 'return'].includes(input.decision)) fail('ผลอนุมัติไม่ถูกต้อง');
      if (input.decision === 'return' && !reason) fail('กรุณาระบุเหตุผลส่งคืน');
      if (input.decision === 'approve') {
        validateRequest(state, request);
        if (changes.includes(request.type) && request.baseApprovedVersionId) {
          const projectBefore = clone(project); snapshot(state, user, project, request.proposed, request.id); project.data = clone(request.proposed); bump(project);
          audit(state, user, 'project.revise', 'project', project, projectBefore, request.reason);
        }
        if (changes.includes(request.type)) request.amendmentApplied = Boolean(request.baseApprovedVersionId);
        request.approvedBy = user.id; request.approvedAt = now();
      }
      request.status = input.decision === 'approve' ? 'approved' : 'returned';
    }
    request.lastReason = reason; bump(request);
    request.history.push({ at: now(), actorId: user.id, action, version: request.version, status: request.status, reason, proposed: clone(request.proposed), amount: request.amount, source: request.source, evidence: clone(request.evidence) });
    audit(state, user, action, 'request', request, before, reason);
    if (action !== 'request.submit') inform(state, project, request.status === 'returned' ? `คำขอถูกส่งคืน: ${reason}` : request.status === 'approved' ? 'คำขอได้รับอนุมัติแล้ว' : 'คำขอผ่านงานแผน รอผู้อำนวยการ', action, request.id);
    return request;
  }
  if (action === 'commitment.confirm') {
    requireRole(user, 'procurement'); const request = get(state, 'requests', input.requestId);
    status(request, ['approved']); if (!['spend', 'purchase'].includes(request.type)) fail('กันวงเงินได้เฉพาะคำขอใช้เงินหรือจัดซื้อที่อนุมัติแล้ว');
    const existing = state.commitments.find(c => c.requestIds?.includes(request.id) || c.requestId === request.id);
    if (existing) return existing;
    checkVersion(request, input.requestVersion);
    if (request.linkedCommitmentId) {
      const commitment = get(state, 'commitments', request.linkedCommitmentId);
      if (commitment.projectId !== request.projectId || commitment.source !== request.source || request.amount > commitment.amount) fail('คำขอไม่ตรงกับรายการกันวงเงินที่เชื่อม หรือยอดไม่พอ');
      const before = clone(commitment); commitment.requestIds ||= [commitment.requestId]; commitment.requestIds.push(request.id); bump(commitment);
      audit(state, user, action, 'commitment', commitment, before, 'เชื่อมกับรายการเดิม ไม่หักงบซ้ำ'); return commitment;
    }
    const available = totals(state, request.projectId).bySource[request.source]?.available || 0;
    if (request.amount > available) fail('วงเงินคงเหลือของแหล่งเงินนี้ไม่พอ');
    const commitment = { ...entityBase(user), projectId: request.projectId, requestId: request.id, requestIds: [request.id], source: request.source, amount: request.amount, paid: 0, status: 'reserved', confirmedBy: user.id, confirmedAt: now() };
    state.commitments.push(commitment); audit(state, user, action, 'commitment', commitment); return commitment;
  }
  if (action === 'commitment.adjust') {
    requireRole(user, 'procurement'); const commitment = get(state, 'commitments', input.id); checkVersion(commitment, input.version);
    const newAmount = amount(input.amount); const reason = string(input.reason, 'เหตุผล'); const proof = evidence(input.evidence, true);
    if (!reason) fail('กรุณาระบุเหตุผลการปรับหรือคืนวงเงิน');
    if (newAmount < commitment.paid) fail('ปรับยอดต่ำกว่ายอดที่จ่ายจริงแล้วไม่ได้');
    const available = totals(state, commitment.projectId).bySource[commitment.source]?.available || 0;
    if (newAmount - commitment.amount > available) fail('วงเงินคงเหลือของแหล่งเงินนี้ไม่พอ');
    const before = clone(commitment); commitment.amount = newAmount; commitment.status = newAmount === 0 ? 'cancelled' : newAmount === commitment.paid ? 'settled' : commitment.paid ? 'partial' : 'reserved'; commitment.lastReason = reason; commitment.evidence = proof; bump(commitment);
    audit(state, user, action, 'commitment', commitment, before, reason); return commitment;
  }
  if (action === 'payment.create') {
    requireRole(user, 'finance'); const key = string(input.idempotencyKey, 'รหัสป้องกันซ้ำ', 200);
    if (!key) fail('ต้องมีรหัสป้องกันการบันทึกจ่ายซ้ำ');
    const paymentAmount = amount(input.amount); if (paymentAmount === 0) fail('ยอดจ่ายต้องมากกว่าศูนย์');
    const reference = string(input.reference, 'เลขอ้างอิงการจ่าย', 500); if (!reference) fail('กรุณาระบุเลขอ้างอิงการจ่าย');
    const proof = evidence(input.evidence);
    const existing = state.payments.find(p => p.idempotencyKey === key);
    if (existing) {
      if (existing.commitmentId !== input.commitmentId || existing.amount !== paymentAmount || existing.reference !== reference || JSON.stringify(existing.evidence) !== JSON.stringify(proof)) fail('รหัสป้องกันซ้ำถูกใช้กับข้อมูลรายการอื่นแล้ว', 409);
      return existing;
    }
    const commitment = get(state, 'commitments', input.commitmentId); checkVersion(commitment, input.version);
    if (paymentAmount > commitment.amount - commitment.paid) fail('ยอดจ่ายเกินยอดกันไว้คงค้าง');
    const before = clone(commitment); commitment.paid += paymentAmount; commitment.status = commitment.paid === commitment.amount ? 'settled' : 'partial'; bump(commitment);
    const payment = { ...entityBase(user), projectId: commitment.projectId, commitmentId: commitment.id, source: commitment.source, amount: paymentAmount, reference, evidence: proof, idempotencyKey: key, paidAt: now(), paidBy: user.id };
    state.payments.push(payment); audit(state, user, action, 'payment', payment); audit(state, user, 'commitment.payment', 'commitment', commitment, before); return payment;
  }
  if (action === 'summary.save') {
    const existing = input.id ? get(state, 'summaries', input.id) : null;
    const project = get(state, 'projects', input.projectId || existing?.projectId); own(user, project); const original = approved(state, project);
    const data = normalizeSummary(input.data);
    if (existing) {
      if (existing.projectId !== project.id) fail('เปลี่ยนกิจกรรมของสรุปเดิมไม่ได้');
      checkVersion(existing, input.version); status(existing, ['draft', 'returned', 'accepted']); const before = clone(existing);
      existing.data = data; existing.status = 'draft'; existing.scorePercent = null; bump(existing); audit(state, user, action, 'summary', existing, before); return existing;
    }
    if (state.summaries.some(s => s.projectId === project.id)) fail('กิจกรรมนี้มีสรุปอยู่แล้ว กรุณาเปิดแก้ไขรายการเดิม', 409);
    const summary = { ...entityBase(user), projectId: project.id, status: 'draft', data, approvedVersionId: original.id, projectSnapshot: clone(original.data), actualPaid: totals(state, project.id).paid, scorePercent: null, history: [], lastReason: '' };
    state.summaries.push(summary); audit(state, user, action, 'summary', summary); return summary;
  }
  if (['summary.submit', 'summary.review'].includes(action)) {
    const summary = get(state, 'summaries', input.id); checkVersion(summary, input.version); const project = get(state, 'projects', summary.projectId); const before = clone(summary); const reason = string(input.reason, 'เหตุผล');
    if (action === 'summary.submit') {
      own(user, project); status(summary, ['draft', 'returned']); summary.data = normalizeSummary(summary.data, true);
      const original = approved(state, project); summary.approvedVersionId = original.id; summary.projectSnapshot = clone(original.data); summary.actualPaid = totals(state, project.id).paid;
      summary.actualPaidBySource = Object.fromEntries(Object.entries(totals(state, project.id).bySource).map(([key, value]) => [key, value.paid]));
      summary.scorePercent = summary.data.scores.reduce((a, b) => a + b, 0) / 32 * 100; summary.status = 'submitted'; summary.submittedAt = now();
    } else {
      requireRole(user, 'planner', 'plan_head'); status(summary, ['submitted']);
      if (!['accept', 'return'].includes(input.decision)) fail('ผลตรวจสรุปไม่ถูกต้อง');
      if (input.decision === 'return' && !reason) fail('กรุณาระบุเหตุผลส่งคืน');
      summary.status = input.decision === 'accept' ? 'accepted' : 'returned'; summary.reviewedAt = now(); summary.reviewedBy = user.id;
      inform(state, project, summary.status === 'accepted' ? 'สรุปโครงการผ่านการตรวจแล้ว' : `สรุปโครงการถูกส่งคืน: ${reason}`, action, summary.id);
    }
    summary.lastReason = reason; bump(summary);
    summary.history.push({ id: id(), at: now(), actorId: user.id, action, version: summary.version, status: summary.status, reason, data: clone(summary.data), approvedVersionId: summary.approvedVersionId, projectSnapshot: clone(summary.projectSnapshot), actualPaid: summary.actualPaid, actualPaidBySource: clone(summary.actualPaidBySource || {}), scorePercent: summary.scorePercent });
    audit(state, user, action, 'summary', summary, before, reason); return summary;
  }
  if (action === 'allocation.save') {
    requireRole(user, 'planner', 'plan_head');
    const fields = { fiscalYear: string(input.fiscalYear, 'ปีงบประมาณ', 4), term: string(input.term, 'ภาคเรียน', 30), group: string(input.group, 'กลุ่มงาน', 500), source: string(input.source, 'แหล่งเงิน', 500), income: amount(input.income ?? 0), allocated: amount(input.allocated ?? 0), note: string(input.note) };
    if (!/^\d{4}$/.test(fields.fiscalYear) || !fields.term || !fields.group || !fields.source) fail('กรุณากรอกปีงบประมาณ ภาคเรียน กลุ่มงาน และแหล่งเงิน');
    if (state.allocations.some(a => a.id !== input.id && ['fiscalYear', 'term', 'group', 'source'].every(k => a[k] === fields[k]))) fail('กรอบจัดสรรสำหรับกลุ่มงาน/แหล่งเงิน/ภาคเรียนนี้มีแล้ว ให้แก้ไขรายการเดิม', 409);
    let record;
    if (input.id) { record = get(state, 'allocations', input.id); checkVersion(record, input.version); const before = clone(record); Object.assign(record, fields); bump(record); audit(state, user, action, 'allocation', record, before); }
    else { record = { ...entityBase(user), ...fields }; state.allocations.push(record); audit(state, user, action, 'allocation', record); }
    return record;
  }
  if (action === 'reference.save') {
    requireRole(user, 'admin');
    if (!['strategic_project', 'strategy', 'standard', 'price', 'group', 'source', 'other'].includes(input.kind)) fail('ประเภทข้อมูลอ้างอิงไม่ถูกต้อง');
    const fields = { kind: input.kind, name: string(input.name, 'ชื่อรายการ', 1000), code: string(input.code, 'รหัส', 200), parentId: string(input.parentId, 'รหัสอ้างอิงต้นทาง', 200) || null, origin: string(input.origin, 'ที่มาข้อมูล', 2000), edition: string(input.edition, 'รุ่นข้อมูล', 200), isDemo: input.isDemo !== false, data: clone(input.data || {}) };
    if (!fields.name || !fields.origin || !fields.edition) fail('ข้อมูลอ้างอิงต้องมีชื่อ ที่มา และรุ่นข้อมูล');
    if (!fields.data || typeof fields.data !== 'object' || Array.isArray(fields.data)) fail('รายละเอียดข้อมูลอ้างอิงไม่ถูกต้อง');
    if (fields.parentId) { if (fields.parentId === input.id) fail('อ้างอิงตนเองไม่ได้'); get(state, 'references', fields.parentId); }
    if (fields.kind === 'price') amount(fields.data.unitPrice, 'ราคาอ้างอิง');
    let record;
    if (input.id) { record = get(state, 'references', input.id); checkVersion(record, input.version); const before = clone(record); Object.assign(record, fields); bump(record); audit(state, user, action, 'reference', record, before); }
    else { record = { ...entityBase(user), ...fields }; state.references.push(record); audit(state, user, action, 'reference', record); }
    return record;
  }
  if (action === 'settings.save') {
    requireRole(user, 'planner', 'plan_head', 'admin'); const days = input.reminderDays;
    if (input.version !== undefined) checkVersion(state.settings, input.version);
    if (!Number.isInteger(days) || days < 1 || days > 365) fail('ความถี่แจ้งเตือนต้องเป็นจำนวนวัน 1 ถึง 365');
    const before = clone(state.settings);
    state.settings = { id: state.settings.id || id(), version: (state.settings.version || 0) + 1, projectDeadline: date(input.projectDeadline, 'กำหนดส่งโครงการ'), summaryDeadline: date(input.summaryDeadline, 'กำหนดส่งสรุป'), reminderDays: days, updatedAt: now(), updatedBy: user.id };
    audit(state, user, action, 'settings', state.settings, before); return state.settings;
  }
  if (action === 'notification.read') {
    const existing = state.notifications.find(n => n.id === input.id && n.userId === user.id);
    if (existing) {
      if (!existing.readAt) {
        const before = clone(existing); existing.readAt = now(); existing.version ||= 1; bump(existing);
        audit(state, user, action, 'notification', existing, before);
      }
      return existing;
    }
    const task = tasks(state, user).find(t => t.id === input.id);
    if (!task) fail('ไม่พบการแจ้งเตือนของคุณ', 404);
    const previous = state.notifications.find(n => n.taskId === task.id && n.userId === user.id);
    if (previous) return previous;
    const ack = { id: id(), version: 1, taskId: task.id, userId: user.id, projectId: task.projectId || null, readAt: now(), createdAt: now(), updatedAt: now(), type: 'ack' };
    state.notifications.push(ack); audit(state, user, action, 'notification', ack); return ack;
  }
  if (action === 'outbox.retry') {
    requireRole(user, 'planner', 'plan_head', 'admin'); const record = get(state, 'outbox', input.id); const before = clone(record);
    if (input.version !== undefined) checkVersion(record, input.version);
    record.status = 'blocked'; record.attempts += 1; record.error = 'ยังไม่ได้ตั้งค่าหรือเชื่อม Google Sheets จริง'; record.lastAttemptAt = now(); bump(record);
    audit(state, user, action, 'outbox', record, before); return record;
  }
  fail('ไม่รองรับคำสั่งนี้', 400);
}

/** Work on a copy so even a failed multi-item action is all-or-nothing. */
export function mutate(state, user, input) {
  const work = clone(state); ensureState(work);
  const result = apply(work, user, input);
  for (const key of Object.keys(state)) if (!(key in work)) delete state[key];
  Object.assign(state, work);
  return clone(result);
}

function tasks(state, user) {
  const result = []; const current = now();
  const reminderDays = state.settings.reminderDays || 7;
  const round = Math.floor(Date.now() / (86400000 * reminderDays));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function add(type, entity, project, message, due = '') {
    const kinds = { 'project.submit': 'project', 'project.review': 'review', 'project.approve': 'review', 'request.submit': 'request', 'request.review': 'request', 'request.approve': 'request', 'commitment.confirm': 'procurement', 'payment.create': 'finance', 'summary.submit': 'summary', 'summary.review': 'summary', activity: 'activity' };
    const projectTitle = project?.data.title || (type.startsWith('request.') ? 'ยังไม่เชื่อมโครงการ' : 'ร่างไม่มีชื่อ');
    result.push({ id: `task:${type}:${entity.id}:${entity.version}:${round}`, type, kind: kinds[type], projectId: project?.id || null, ...(type.startsWith('request.') || type === 'commitment.confirm' ? { requestId: entity.id } : {}), entityId: entity.id, message, projectTitle, title: `${message}: ${projectTitle}`, due, dueDate: due, overdue: Boolean(due && due < today), createdAt: current });
  }
  for (const project of state.projects) {
    if (project.ownerId === user.id && has(user, 'teacher')) {
      if (['draft', 'returned'].includes(project.status)) add('project.submit', project, project, project.status === 'returned' ? 'แก้ไขโครงการที่ส่งคืนและส่งตรวจอีกครั้ง' : 'จัดทำและส่งโครงการ', state.settings.projectDeadline);
      if (project.approvedVersionId) {
        const original = state.versions.find(v => v.id === project.approvedVersionId);
        const summary = state.summaries.find(s => s.projectId === project.id);
        if (!summary || ['draft', 'returned'].includes(summary.status)) add('summary.submit', summary || project, project, summary?.status === 'returned' ? 'แก้ไขสรุปโครงการที่ส่งคืน' : 'จัดทำและส่งสรุปโครงการ', state.settings.summaryDeadline || original?.data.endDate || '');
        if (original?.data.startDate && new Date(original.data.startDate) - new Date(today) <= reminderDays * 86400000 && !summary?.submittedAt) add('activity', project, project, original.data.startDate < today ? 'ติดตามกิจกรรมและบันทึกผลการดำเนินงาน' : 'เตรียมจัดกิจกรรมตามกำหนด', original.data.startDate);
      }
    }
    if (has(user, 'planner', 'plan_head') && project.status === 'submitted') add('project.review', project, project, 'ตรวจโครงการที่ครูส่ง');
    if (has(user, 'director') && project.status === 'reviewed') add('project.approve', project, project, 'พิจารณาอนุมัติโครงการ');
  }
  for (const request of state.requests) {
    const project = state.projects.find(p => p.id === request.projectId);
    if (request.ownerId === user.id && has(user, 'teacher') && ['draft', 'returned'].includes(request.status)) add('request.submit', request, project, request.status === 'returned' ? 'แก้ไขคำขอที่ส่งคืน' : request.projectId ? 'จัดทำและส่งคำขอ' : 'เชื่อมโครงการแล้วส่งคำขอ');
    if (!project) continue;
    if (has(user, 'planner', 'plan_head') && request.status === 'submitted') add('request.review', request, project, 'ตรวจบันทึกข้อความ/คำขอ');
    if (has(user, 'director') && request.status === 'reviewed') add('request.approve', request, project, 'พิจารณาอนุมัติคำขอ');
    if (has(user, 'procurement') && request.status === 'approved' && ['spend', 'purchase'].includes(request.type) && !state.commitments.some(c => c.requestId === request.id || c.requestIds?.includes(request.id))) add('commitment.confirm', request, project, 'ยืนยันดำเนินการและกันวงเงิน');
  }
  if (has(user, 'finance')) for (const commitment of state.commitments) {
    if (commitment.amount > commitment.paid) { const project = state.projects.find(p => p.id === commitment.projectId); if (project) add('payment.create', commitment, project, 'บันทึกจ่ายยอดกันไว้คงค้าง'); }
  }
  if (has(user, 'planner', 'plan_head')) for (const summary of state.summaries) {
    if (summary.status === 'submitted') { const project = state.projects.find(p => p.id === summary.projectId); if (project) add('summary.review', summary, project, 'ตรวจสรุปโครงการ ปัญหาและความพึงพอใจ'); }
  }
  return result.map(task => {
    const readAt = state.notifications.find(n => n.userId === user.id && n.taskId === task.id)?.readAt || null;
    return { ...task, readAt, read: Boolean(readAt) };
  });
}

/** Read authorization is applied independently of action authorization. */
export function visibleState(state, user) {
  if (!user?.id) fail('กรุณาเข้าสู่ระบบ', 401);
  const result = clone(state); ensureState(result);
  const all = has(user, ...operational);
  const allowed = new Set(result.projects.filter(p => all || p.ownerId === user.id).map(p => p.id));
  result.projects = result.projects.filter(p => allowed.has(p.id));
  for (const key of ['versions', 'commitments', 'payments', 'summaries', 'outbox']) result[key] = result[key].filter(row => allowed.has(row.projectId));
  result.requests = result.requests.filter(row => allowed.has(row.projectId) || !row.projectId && row.ownerId === user.id);
  const ownedRequestIds = new Set(result.requests.filter(row => row.ownerId === user.id).map(row => row.id));
  result.audit = result.audit.filter(row => all || row.projectId && allowed.has(row.projectId) || row.entityType === 'request' && ownedRequestIds.has(row.entityId));
  result.allocations = all ? result.allocations : [];
  result.notifications = result.notifications.filter(row => row.userId === user.id && row.type !== 'ack');
  result.tasks = tasks(state, user);
  result.balances = Object.fromEntries(result.projects.map(project => [project.id, totals(state, project.id)]));
  return result;
}
