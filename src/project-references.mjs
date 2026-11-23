import { readFileSync } from 'node:fs';

export const REFERENCE_CATEGORIES = ['strategicProject', 'strategy', 'standards', 'obecPolicy', 'onesqa', 'worldClass', 'kpd', 'hongson'];
const labels = { strategicProject: 'โครงการตามกลยุทธ์', strategy: 'กลยุทธ์โรงเรียน', standards: 'มาตรฐานการศึกษาขั้นพื้นฐาน', obecPolicy: 'นโยบายและจุดเน้น สพฐ.', onesqa: 'มาตรฐาน สมศ.', worldClass: 'โรงเรียนมาตรฐานสากล', kpd: 'เป้าหมายโรงเรียน กพด.', hongson: 'HONGSON Model' };
const copy = value => structuredClone(value);
const reject = message => { throw Object.assign(new Error(message), { status: 422 }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

/** Keep the catalog outside stored projects. Old documents use their stored snapshots. */
export function readSchoolReferenceCatalog(catalogPath = new URL('../public/school-reference-data.json', import.meta.url)) {
  let source = 'public/school-reference-data.json';
  try {
    let contents;
    try {
      contents = readFileSync(catalogPath, 'utf8');
    } catch (error) {
      // Public checkouts contain synthetic examples only. A broken local catalog
      // must still report its error instead of silently switching data editions.
      if (error.code !== 'ENOENT') throw error;
      source = 'public/school-reference-data.example.json';
      contents = readFileSync(new URL('../public/school-reference-data.example.json', import.meta.url), 'utf8');
    }
    const catalog = JSON.parse(contents);
    if (!catalog.version || !Array.isArray(catalog.items)) throw new Error('รูปแบบข้อมูลอ้างอิงไม่ถูกต้อง');
    return catalog;
  } catch (error) {
    return { schemaVersion: 1, version: 'unavailable', sources: [], items: [], issues: [{ file: source, categories: REFERENCE_CATEGORIES, message: `อ่านข้อมูลอ้างอิงไม่ได้: ${error.message}` }] };
  }
}

export function legacyReferenceTexts(data = {}) {
  return Object.fromEntries(REFERENCE_CATEGORIES.map(category => {
    const value = category === 'strategicProject' ? data.strategicProjectName || data.strategicProjectId : data[category];
    return [category, (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value.trim())];
  }));
}

/** HTTP compatibility gate: existing text may be retained, but never newly authored. */
export function prepareReferenceAction(state, input) {
  function prepare(data, previous) {
    if (!Object.hasOwn(data, 'referenceSelections')) {
      const incoming = legacyReferenceTexts(data), existing = legacyReferenceTexts(previous);
      if (REFERENCE_CATEGORIES.some(category => incoming[category].some(text => !existing[category].includes(text)))) reject('กรุณาเลือกหัวข้อ 3–4 และ 6–11 จากรายการอ้างอิงของโรงเรียน ไม่รับข้อความใหม่ที่พิมพ์เอง');
      data.referenceSelections = copy(previous?.referenceSelections || {});
    }
  }
  if (input.action === 'project.save' && plain(input.data)) prepare(input.data, state.projects.find(project => project.id === input.id)?.data);
  if (input.action === 'request.save' && plain(input.proposed)) {
    const existing = state.requests?.find(request => request.id === input.id);
    const project = state.projects.find(project => project.id === (input.projectId || existing?.projectId));
    const original = state.versions?.find(version => version.id === project?.approvedVersionId)?.data || project?.data;
    prepare(input.proposed, existing?.proposed || original);
  }
  if (input.action === 'project.submit') {
    const data = state.projects.find(project => project.id === input.id)?.data;
    if (data && !data.referenceSelections) reject('กรุณาเปิดแก้ไขโครงการและตรวจจับคู่ข้อความเดิมกับรายการอ้างอิงกลางก่อนส่งตรวจ');
  }
}

function snapshotItem(item, catalog, byId) {
  const path = [], seen = new Set();
  let current = item;
  while (current) {
    if (seen.has(current.id)) reject(`ลำดับชั้นข้อมูลอ้างอิงวนซ้ำ: ${current.id}`);
    seen.add(current.id);
    path.unshift({ id: current.id, code: String(current.code || ''), name: current.name });
    if (!current.parentId) break;
    const parent = byId.get(current.parentId);
    if (!parent || parent.category !== item.category) reject(`ไม่พบหัวข้อหลักที่ถูกต้องของ ${item.id}`);
    current = parent;
  }
  const text = path.map(row => [row.code, row.name].filter(Boolean).join(' ')).join(' › ');
  return { id: item.id, category: item.category, code: String(item.code || ''), name: item.name, parentId: item.parentId || null, ...(item.strategyId ? { strategyId: item.strategyId } : {}), path, text, fullText: text, version: catalog.version, dataVersion: catalog.version, source: copy(item.source || {}), snapshotAt: new Date().toISOString() };
}

/** Only IDs come from the browser. Labels, hierarchy, editions and sources are authoritative. */
export function normalizeSchoolReferences(data, { previous = null, strict = false, catalog = readSchoolReferenceCatalog() } = {}) {
  if (!Object.hasOwn(data, 'referenceSelections')) return {};
  if (!plain(data.referenceSelections)) reject('รายการเชื่อมโยงข้อมูลอ้างอิงไม่ถูกต้อง');
  if (Object.keys(data.referenceSelections).some(category => !REFERENCE_CATEGORIES.includes(category))) reject('มีหมวดข้อมูลอ้างอิงที่ไม่รองรับ');
  const byId = new Map(catalog.items.map(item => [item.id, item]));
  if (byId.size !== catalog.items.length) reject('รหัสรายการอ้างอิงกลางซ้ำ กรุณาตรวจไฟล์ public/school-reference-data.json');
  const selections = {};
  for (const category of REFERENCE_CATEGORIES) {
    const selected = data.referenceSelections[category] || [];
    if (!Array.isArray(selected) || selected.length > 200) reject(`รายการ ${labels[category]} ไม่ถูกต้อง`);
    if (['strategicProject', 'strategy'].includes(category) && selected.length > 1) reject(`เลือก ${labels[category]} ได้หนึ่งรายการ`);
    const seen = new Set();
    selections[category] = selected.map(value => {
      const id = typeof value === 'string' ? value : value?.id;
      if (typeof id !== 'string' || !id || id.length > 200) reject(`รหัส ${labels[category]} ไม่ถูกต้อง`);
      if (seen.has(id)) reject(`เลือก ${labels[category]} ซ้ำไม่ได้`);
      seen.add(id);
      const frozen = previous?.referenceSelections?.[category]?.find(row => row.id === id);
      // Existing server-side snapshots survive renaming or removal from the next edition.
      if (frozen?.text && frozen?.version && frozen.category === category) return copy(frozen);
      const item = byId.get(id);
      if (!item || item.category !== category) reject(`ไม่พบรหัส ${id} ในหมวด ${labels[category]} ของข้อมูลอ้างอิงโรงเรียน`);
      if (item.selectable === false || category !== 'strategy' && catalog.items.some(child => child.parentId === item.id && child.category === category)) reject(`กรุณาเลือกข้อย่อยของ ${item.code} ${item.name}`);
      return snapshotItem(item, catalog, byId);
    });
  }
  const strategicProject = selections.strategicProject[0];
  if (strategicProject) {
    const linkedId = strategicProject.strategyId || byId.get(strategicProject.id)?.strategyId;
    if (!linkedId) reject(`เอกสารอ้างอิงไม่ได้ระบุกลยุทธ์ของ ${strategicProject.text}`);
    if (selections.strategy.length && selections.strategy[0].id !== linkedId) reject('กลยุทธ์โรงเรียนไม่สัมพันธ์กับโครงการตามกลยุทธ์ที่เลือก');
    const frozen = previous?.referenceSelections?.strategy?.find(row => row.id === linkedId);
    const strategy = byId.get(linkedId);
    if (frozen?.text && frozen.category === 'strategy') selections.strategy = [copy(frozen)];
    else if (strategy?.category === 'strategy') selections.strategy = [snapshotItem(strategy, catalog, byId)];
    else reject(`ไม่พบกลยุทธ์ที่สัมพันธ์กับโครงการ ${strategicProject.text}`);
  } else if (selections.strategy.length) reject('กรุณาเลือกโครงการตามกลยุทธ์ก่อนเลือกกลยุทธ์โรงเรียน');

  const legacy = copy(previous?.legacyReferences || {});
  if (previous && !previous.referenceSelections) {
    for (const [category, texts] of Object.entries(legacyReferenceTexts(previous))) if (texts.length) legacy[category] = texts.map(text => ({ text, resolvedIds: [] }));
  }
  const resolutions = data.legacyReferenceResolutions || {};
  if (!plain(resolutions) || Object.keys(resolutions).some(category => !REFERENCE_CATEGORIES.includes(category))) reject('ข้อมูลยืนยันจับคู่ข้อความเดิมไม่ถูกต้อง');
  for (const category of REFERENCE_CATEGORIES) {
    const ids = selections[category].map(row => row.id);
    const previousIds = (previous?.referenceSelections?.[category] || []).map(row => row.id);
    const selectionChanged = ids.length !== previousIds.length || ids.some(id => !previousIds.includes(id));
    for (const row of legacy[category] || []) row.resolvedIds = selectionChanged ? [] : (row.resolvedIds || []).filter(id => ids.includes(id));
    if (Object.hasOwn(resolutions, category)) {
      const matched = resolutions[category];
      if (!Array.isArray(matched) || !matched.length || new Set(matched).size !== matched.length || matched.some(id => !ids.includes(id))) reject(`กรุณาเลือก ${labels[category]} ก่อนยืนยันจับคู่ข้อความเดิม`);
      for (const row of legacy[category] || []) row.resolvedIds = [...matched];
    }
  }
  if (strict) {
    const unresolved = REFERENCE_CATEGORIES.filter(category => (legacy[category] || []).some(row => !row.resolvedIds?.length));
    if (unresolved.length) reject(`กรุณาตรวจจับคู่ข้อความเดิมกับรายการกลางก่อนส่งตรวจ: ${unresolved.map(category => labels[category]).join(', ')}`);
    if (!strategicProject) reject('กรุณาเลือกโครงการตามกลยุทธ์จากรายการอ้างอิงของโรงเรียน');
  }
  const output = { referenceSelections: selections, referenceDataVersion: previous?.referenceDataVersion || catalog.version, legacyReferences: legacy };
  const textFor = category => selections[category].length ? selections[category].map(row => row.text) : (legacy[category] || []).filter(row => !row.resolvedIds?.length).map(row => row.text);
  output.strategicProjectId = strategicProject?.id || ((legacy.strategicProject || []).some(row => !row.resolvedIds?.length) ? previous?.strategicProjectId || '' : '');
  output.strategicProjectName = textFor('strategicProject').join('\n');
  output.strategicProjectReference = strategicProject ? { code: strategicProject.code, origin: strategicProject.source?.file || '', edition: strategicProject.version } : copy(previous?.strategicProjectReference || { code: '', origin: '', edition: '' });
  for (const category of REFERENCE_CATEGORIES.filter(category => category !== 'strategicProject')) output[category] = category === 'standards' ? textFor(category) : textFor(category).join('\n');
  return output;
}
