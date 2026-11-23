/** School project form, transcribed from the supplied 2569 DOCX. No DOM dependency. */
export const PROJECT_TEMPLATE_ID = 'school-project-2569-v1';

export const SOPAA_STAGES = Object.freeze([
  { value: 'S', label: 'ขั้นสำรวจความต้องการและความสนใจ (Survey : S)' },
  { value: 'O', label: 'ขั้นวางแผนและเตรียมการไว้ให้ครบถ้วน (Organize : O)' },
  { value: 'P', label: 'ขั้นดำเนินการตามลำดับไม่เรรวน (Perform : P)' },
  { value: 'A1', label: 'ขั้นประเมินผลครบถ้วนทุกกิจกรรม (Assessment : A)' },
  { value: 'A2', label: 'ขั้นสรุปผลและนำไปประยุกต์ใช้พัฒนา กิจกรรมใหม่ตามต้องการ (Aggregate and Apply : A)' },
].map(Object.freeze));

const MONEY_LIMIT = 9_000_000_000_000;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const text = value => Array.isArray(value) ? value.filter(item => item !== null && item !== undefined).join('\n') : String(value ?? '');
const blank = '<span class="project-blank" aria-label="ยังไม่ระบุ">........................................</span>';
const field = value => text(value).trim() ? `<span class="project-value">${escapeHtml(text(value))}</span>` : blank;
const body = value => `<div class="project-paragraph">${field(value)}</div>`;
const money = satang => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];

/** Integer satang, matching src/domain.mjs (quantity has at most three decimals). */
export function resourceLineTotal(resource = {}) {
  const quantity = resource.quantity ?? 0;
  const unitPrice = resource.unitPrice ?? 0;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001) {
    throw new RangeError('จำนวนทรัพยากรต้องไม่ติดลบและมีทศนิยมไม่เกิน 3 ตำแหน่ง');
  }
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > MONEY_LIMIT) {
    throw new RangeError('ราคาต่อหน่วยต้องเป็นจำนวนสตางค์เต็มที่ไม่ติดลบและไม่เกินขอบเขต');
  }
  const result = Number((BigInt(Math.round(quantity * 1000)) * BigInt(unitPrice) + 500n) / 1000n);
  if (!Number.isSafeInteger(result) || result > MONEY_LIMIT) throw new RangeError('ยอดทรัพยากรเกินขอบเขต');
  return result;
}

function checkbox(label, checked = false) {
  return `<span class="project-choice"><span class="project-checkbox${checked ? ' is-checked' : ''}" aria-label="${checked ? 'เลือก' : 'ไม่เลือก'}">${checked ? '✓' : ''}</span> ${escapeHtml(label)}</span>`;
}

function section(number, heading, contents, inline = false) {
  return `<section class="project-section${inline ? ' project-inline' : ''}" data-section="${number}"><h2>${number}. ${heading}</h2>${contents}</section>`;
}

function dateText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return text(value);
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const month = months[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${Number(match[1]) + 543}` : text(value);
}

function implementationTable(data) {
  const entries = list(data.implementationSteps);
  const rows = SOPAA_STAGES.map((stage, index) => {
    const matches = entries.filter(row => row.stage === stage.value);
    const stageRows = matches.length ? matches : [{}];
    return stageRows.map((row, rowIndex) => `<tr><td class="project-center">${rowIndex ? '' : index + 1}</td><td>${rowIndex ? '' : `<strong class="project-stage">${stage.label}</strong>`}${body(row.activity)}</td><td>${field(row.period)}</td><td>${field(row.responsible)}</td></tr>`).join('');
  }).join('');
  const otherRows = entries.filter(row => !SOPAA_STAGES.some(stage => stage.value === row.stage)).map(row => `<tr><td></td><td>${body(row.stage)}${body(row.activity)}</td><td>${field(row.period)}</td><td>${field(row.responsible)}</td></tr>`).join('');
  return `<table class="form-table project-steps-table"><colgroup><col style="width:4.35%"><col style="width:46.63%"><col style="width:22.83%"><col style="width:26.19%"></colgroup><thead><tr><th scope="col">ที่</th><th scope="col">กิจกรรม</th><th scope="col">ระยะเวลาดำเนินงาน</th><th scope="col">ผู้รับผิดชอบ</th></tr></thead><tbody>${rows}${otherRows}</tbody></table>${text(data.steps).trim() ? `<div class="project-legacy"><strong>${entries.length ? 'รายละเอียดขั้นตอนเพิ่มเติม (ข้อมูลเดิม)' : 'รายละเอียดขั้นตอนดำเนินงาน (ข้อมูลเดิม)'}</strong>${body(data.steps)}</div>` : ''}`;
}

function evaluationTable(data) {
  const entries = list(data.evaluationRows);
  const rows = entries.length ? entries : [{}, {}];
  return `<table class="form-table project-evaluation-table"><colgroup><col style="width:42.15%"><col style="width:27.14%"><col style="width:30.71%"></colgroup><thead><tr><th scope="col">ตัวชี้วัดความสำเร็จ</th><th scope="col">วิธีการประเมิน</th><th scope="col">เครื่องมือที่ใช้</th></tr></thead><tbody>${rows.map(row => `<tr><td>${field(row.indicator)}</td><td>${field(row.method)}</td><td>${field(row.tool)}</td></tr>`).join('')}</tbody></table>${text(data.evaluation).trim() ? `<div class="project-legacy"><strong>${entries.length ? 'รายละเอียดการประเมินเพิ่มเติม (ข้อมูลเดิม)' : 'รายละเอียดการประเมินผล (ข้อมูลเดิม)'}</strong>${body(data.evaluation)}</div>` : ''}`;
}

function budgetSection(data) {
  const sources = new Map();
  let total = 0;
  for (const resource of list(data.resources)) {
    const amount = resourceLineTotal(resource);
    const source = text(resource.source);
    total += amount;
    sources.set(source, (sources.get(source) || 0) + amount);
  }
  if (!Number.isSafeInteger(total) || total > MONEY_LIMIT) throw new RangeError('ยอดรวมงบประมาณเกินขอบเขต');
  const types = Array.isArray(data.budgetTypes) ? data.budgetTypes : [];
  return `<p><strong class="project-money">${money(total)}</strong> บาท${data.fiscalYear ? ` <span class="project-budget-year">(ปีงบประมาณ ${escapeHtml(data.fiscalYear)})</span>` : ''}</p><p>ประเภทงบประมาณ</p><div class="project-choices">${['อุดหนุน', 'กิจกรรมพัฒนาผู้เรียน', 'บำรุงการศึกษา', 'ระดมทรัพยากร', 'อื่นๆ'].map(type => checkbox(type, types.includes(type))).join('')}<span>ระบุ ${field(data.budgetOther)}</span></div>${sources.size ? `<table class="form-table project-budget-table"><caption>งบประมาณจากรายการทรัพยากร จำแนกตามแหล่งเงิน</caption><thead><tr><th scope="col">แหล่งเงิน</th><th scope="col">จำนวนเงิน (บาท)</th></tr></thead><tbody>${[...sources].map(([source, amount]) => `<tr><td>${field(source)}</td><td class="project-number">${money(amount)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">รวมงบประมาณ</th><td class="project-number">${money(total)}</td></tr></tfoot></table>` : ''}`;
}

function signature(name, role, position = '') {
  return `<div class="project-signature"><p>ลงชื่อ <span class="project-signature-line">................................................</span>${role ? ` ${escapeHtml(role)}` : ''}</p><p>( ${field(name)} )</p>${position ? `<p>${escapeHtml(position)}</p>` : ''}</div>`;
}

function approvalPage(data) {
  const names = data.signatories && typeof data.signatories === 'object' ? data.signatories : {};
  const administration = text(data.administrationGroup).trim();
  const administrationSuffix = administration ? ` ${administration}` : '........................................';
  return `<section class="approval-page" aria-label="ใบพิจารณาโครงการ"><h2 class="approval-heading">การประเมินความสอดคล้องของรายการทรัพยากร กับวัตถุประสงค์ของโครงการ</h2><div class="approval-decisions">${checkbox('รายการทรัพยากรสอดคล้องกับวัตถุประสงค์ สามารถดำเนินการตามโครงการได้')}${checkbox('รายการทรัพยากรไม่สอดคล้องกับวัตถุประสงค์ เห็นควรปรับปรุงแก้ไข')}</div><div class="project-review-signatures">${signature(names.planningHead, '', 'หัวหน้างานแผนงานและงบประมาณ')}${signature(names.budgetHead, '', 'หัวหน้ากลุ่มบริหารงานงบประมาณ')}${signature(names.budgetDeputy, '', 'รองผู้อำนวยการกลุ่มบริหารงานงบประมาณ')}</div><h2 class="approval-heading">การพิจารณาเห็นชอบโครงการ</h2><div class="project-endorsement-signatures">${signature(names.administrationHead, 'ผู้เห็นชอบโครงการ', `หัวหน้ากลุ่มบริหารงาน${administrationSuffix}`)}${signature(names.administrationDeputy, 'ผู้เห็นชอบโครงการ', `รองผู้อำนวยการกลุ่มบริหารงาน${administrationSuffix}`)}</div><h2 class="approval-heading">การพิจารณาอนุมัติโครงการ</h2><div class="approval-decisions project-choices">${checkbox('อนุมัติ')}${checkbox('ไม่อนุมัติ')}</div>${signature(names.director, 'ผู้อนุมัติโครงการ', 'ผู้อำนวยการโรงเรียนห้องสอนศึกษา ในพระอุปถัมภ์ฯ')}</section>`;
}

/** Generates the complete form; approval decisions and signature strokes stay blank. */
export function projectTemplateHtml(data = {}, { references = [], statusLabel = '', versionLabel = '' } = {}) {
  data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  // Printed documents resolve from their stored reference snapshots, never a newer catalog.
  if (data.referenceSelections) {
    data = { ...data };
    for (const category of ['strategicProject','strategy','standards','obecPolicy','onesqa','worldClass','kpd','hongson']) {
      const rows = data.referenceSelections[category] || [];
      const texts = rows.map(row => row.fullText || row.text).filter(Boolean);
      if (texts.length) data[category === 'strategicProject' ? 'strategicProjectName' : category] = category === 'standards' ? texts : texts.join('\n');
    }
  }
  // Printed documents resolve from their stored reference snapshots, never a newer catalog.
  if (data.referenceSelections) {
    data = { ...data };
    for (const category of ['strategicProject','strategy','standards','obecPolicy','onesqa','worldClass','kpd','hongson']) {
      const rows = data.referenceSelections[category] || [];
      const texts = rows.map(row => row.fullText || row.text).filter(Boolean);
      if (texts.length) data[category === 'strategicProject' ? 'strategicProjectName' : category] = category === 'standards' ? texts : texts.join('\n');
    }
  }
  const reference = list(references).find(row => row.id === data.strategicProjectId);
  const strategicProject = text(data.strategicProjectName).trim() || reference?.name || data.strategicProjectId;
  const names = data.signatories && typeof data.signatories === 'object' ? data.signatories : {};
  const projectType = data.projectType === 'new' ? 'โครงการใหม่' : data.projectType === 'continuing' ? 'โครงการต่อเนื่อง' : data.projectType;
  const dates = data.startDate || data.endDate ? `<p>วันที่ ${field(dateText(data.startDate))} ถึง ${field(dateText(data.endDate))}</p>` : '';
  const metadata = [versionLabel, statusLabel].filter(value => text(value).trim()).map(escapeHtml).join(' · ');
  return `<article class="project-paper" data-template-id="${PROJECT_TEMPLATE_ID}">${metadata ? `<p class="project-document-status">${metadata}</p>` : ''}${section(1, 'ชื่อกิจกรรม', `${field(data.title)} <span class="project-term">ภาคเรียนที่ ${field(data.term)} / ${field(data.academicYear)}</span>`, true)}${section(2, 'ชื่อผู้รับผิดชอบกิจกรรม', `${field(data.responsible)}<p>กลุ่มบริหารงาน ${field(data.administrationGroup)}</p>${text(data.group).trim() ? `<p>กลุ่มสาระการเรียนรู้ / งาน ${field(data.group)}</p>` : ''}`, true)}${section(3, 'ชื่อโครงการ (โครงการตามกลยุทธ์)', field(strategicProject), true)}${section(4, 'สนองกลยุทธ์โรงเรียน', body(data.strategy))}${section(5, 'ลักษณะของโครงการ', `<div class="project-choices">${checkbox('โครงการต่อเนื่อง', projectType === 'โครงการต่อเนื่อง')}${checkbox('โครงการใหม่', projectType === 'โครงการใหม่')}${projectType && !['โครงการต่อเนื่อง', 'โครงการใหม่'].includes(projectType) ? field(projectType) : ''}</div>`)}${section(6, 'สนองมาตรฐานการศึกษาขั้นพื้นฐาน', body(data.standards))}${section(7, 'สนองนโยบายและจุดเน้นของสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน', body(data.obecPolicy))}${section(8, 'สนองมาตรฐาน สมศ.', body(data.onesqa))}${section(9, 'สนองมาตรฐานสากล', body(data.worldClass))}${section(10, 'สนองแผนพัฒนาเด็กและเยาวชนในถิ่นทุรกันดารฯ', body(data.kpd))}${section(11, 'HONGSON Model', body(data.hongson))}${section(12, 'หลักการและเหตุผล', body(data.rationale))}${section(13, 'วัตถุประสงค์', body(data.objectives))}${section(14, 'เป้าหมาย', `<h3>14.1 เป้าหมายเชิงปริมาณ</h3>${body(data.quantitativeTarget)}<h3>14.2 เป้าหมายเชิงคุณภาพ</h3>${body(data.qualitativeTarget)}`)}${section(15, 'วิธีดำเนินการ/ขั้นตอนดำเนินการ', implementationTable(data))}${section(16, 'ระยะเวลาดำเนินการช่วงเดือน', `<p>${field(data.activityPeriod)} ไตรมาสที่ ${field(data.quarter)}</p><p>ภาคเรียนที่ ${field(data.term)} / ${field(data.academicYear)}</p>${dates}<p>จัดซื้อวัสดุอุปกรณ์ ในเดือน ${field(data.procurementMonth)}</p><p>ดำเนินการจัดกิจกรรม ในเดือน ${field(data.activityMonth)}</p>`)}${section(17, 'งบประมาณ', budgetSection(data))}${section(18, 'การประเมินผล', evaluationTable(data))}${section(19, 'ผลที่คาดว่าจะได้รับ', body(data.expectedResults))}<div class="project-proposer">${signature(names.proposer, 'ผู้เสนอโครงการ') }<p>ตำแหน่ง ${field(names.proposerPosition)}</p></div>${approvalPage(data)}</article>`;
}

/** A4, one-inch margins and 16pt TH Sarabun PSK as specified in the source OOXML. */
export const PROJECT_PRINT_CSS = `
.project-paper{box-sizing:border-box;max-width:210mm;margin:0 auto;padding:14mm 12mm;background:#fff;color:#000;font-family:"TH Sarabun PSK","TH Sarabun New","Sarabun","Leelawadee UI",Tahoma,sans-serif;font-size:16pt;line-height:1.22;letter-spacing:normal;overflow-wrap:anywhere;text-align:left}
.project-paper *{box-sizing:border-box}
.project-paper p,.project-paper h2,.project-paper h3{margin:0;font-size:inherit;line-height:inherit;color:#000;letter-spacing:normal}
.project-paper h2,.project-paper h3,.project-paper strong{font-size:inherit;font-weight:700}
.project-paper .project-section{margin:0 0 2mm}
.project-paper .project-section>h2{margin:0 0 1mm;break-after:avoid;page-break-after:avoid}
.project-paper .project-inline>h2{display:inline;margin-right:2mm}
.project-paper .project-inline>p{margin-top:1mm}
.project-paper .project-section h3{margin:1mm 0 0 7mm;break-after:avoid}
.project-paper .project-paragraph{white-space:pre-wrap;margin:0 0 1mm 7mm;orphans:2;widows:2}
.project-paper .project-value{white-space:pre-wrap;overflow-wrap:anywhere}
.project-paper .project-blank{display:inline;word-break:break-all;color:#000}
.project-paper .project-term{display:inline-block;margin-left:3mm}
.project-paper .project-document-status{font-size:11pt;color:#555;text-align:right;margin-bottom:3mm}
.project-paper .project-choices{display:flex;flex-wrap:wrap;align-items:baseline;gap:1mm 6mm;margin:1mm 0 1mm 7mm}
.project-paper .project-choice{display:inline-flex;align-items:baseline;gap:1mm}
.project-paper .project-checkbox{display:inline-flex;flex:none;justify-content:center;align-items:center;width:3.6mm;height:3.6mm;border:.5pt solid #000;font:12pt/1 Arial,sans-serif;transform:translateY(.3mm)}
.project-paper .form-table{border-collapse:collapse;table-layout:fixed;width:100%;max-width:100%;font-size:inherit;line-height:1.18;margin:2mm 0;border:.5pt solid #000;color:#000}
.project-paper .form-table th,.project-paper .form-table td{border:.5pt solid #000;padding:1.3mm 1.5mm;vertical-align:top;background:#fff;color:#000;font-size:inherit;font-weight:400;white-space:normal;overflow-wrap:anywhere}
.project-paper .form-table th{font-weight:700;text-align:center}
.project-paper .form-table tr:last-child td{border-bottom:.5pt solid #000}
.project-paper .form-table tr:hover td{background:#fff}
.project-paper .form-table thead{display:table-header-group}
.project-paper .form-table tr{break-inside:avoid;page-break-inside:avoid}
.project-paper .form-table .project-paragraph{margin:1mm 0 0}
.project-paper .form-table .project-stage{display:block;font-size:inherit;font-weight:700}
.project-paper .project-evaluation-table td{height:14.6mm}
.project-paper .project-center{text-align:center}
.project-paper .project-number{text-align:right;white-space:nowrap!important;font-variant-numeric:tabular-nums}
.project-paper .project-budget-table{margin-top:3mm}
.project-paper .project-budget-table caption{text-align:left;font-size:14pt;padding-bottom:1mm;color:#000}
.project-paper .project-budget-table th:last-child{width:36%}
.project-paper .project-budget-table tfoot td{font-weight:700}
.project-paper .project-legacy{margin-top:2mm}
.project-paper .project-legacy>strong{font-weight:400;font-style:italic}
.project-paper .project-signature{margin:5mm 0;text-align:center;break-inside:avoid;page-break-inside:avoid}
.project-paper .project-signature p{margin:1mm 0}
.project-paper .project-signature-line{white-space:nowrap}
.project-paper .project-proposer{margin:7mm 0 3mm;text-align:center;break-inside:avoid;page-break-inside:avoid}
.project-paper .project-proposer .project-signature{margin:0}
.project-paper .approval-page{margin-top:16mm;padding-top:8mm;border-top:1px dashed #bbb;break-before:page;page-break-before:always}
.project-paper .approval-heading{font-weight:700;text-align:left;margin:5mm 0 3mm;break-after:avoid;page-break-after:avoid}
.project-paper .approval-decisions{margin:0 0 4mm 7mm}
.project-paper .approval-decisions>.project-choice{display:flex;margin:1mm 0}
.project-paper .approval-decisions.project-choices>.project-choice{display:inline-flex}
.project-paper .project-review-signatures,.project-paper .project-endorsement-signatures{display:block}
.project-paper .approval-page{line-height:1.1}
.project-paper .approval-page .project-signature{margin:3mm 0}
.project-paper .approval-page .project-signature p{margin:.5mm 0}
.project-paper .approval-page .approval-heading{margin:3mm 0 2mm}
.project-paper+.project-paper{margin-top:12mm;break-before:page;page-break-before:always}
@media screen and (max-width:700px){.project-paper{padding:5mm 1mm;font-size:14pt}.project-paper .form-table{font-size:12pt}.project-paper .form-table th,.project-paper .form-table td{padding:1mm}.project-paper .project-term{margin-left:0}.project-paper .project-paragraph{margin-left:3mm}.project-paper .project-choices{margin-left:3mm;gap:1mm 3mm}.project-paper .project-signature-line{white-space:normal}.project-paper .project-document-status{font-size:10pt}}
@page school-project{size:A4 portrait;margin:25.4mm}
@media print{.project-paper{page:school-project;width:auto;max-width:none;padding:0;margin:0;font-size:16pt;line-height:1.22;box-shadow:none}.project-paper .project-section{margin-bottom:2mm}.project-paper .form-table{font-size:16pt}.project-paper .form-table th,.project-paper .form-table td{padding:1.3mm 1.5mm}.project-paper .approval-page{padding:0;margin:0;border:0;break-before:page;page-break-before:always}.project-paper+.project-paper{margin:0}.project-paper .project-document-status{font-size:10pt}.project-paper .approval-heading:first-child{margin-top:0}}
`;
