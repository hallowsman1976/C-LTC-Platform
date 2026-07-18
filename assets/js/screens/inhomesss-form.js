/**
 * screens/inhomesss-form.js
 * แบบประเมิน INHOMESSS ฉบับเต็มตามแบบฟอร์มมาตรฐาน (แบบบันทึกติดตามดูแลผู้ป่วยต่อเนื่องที่บ้าน รพ.สต.)
 *
 * ใช้ร่วมกันจากสองทาง (เหมือนแบบประเมินชุดอื่นตามที่ form-widgets.js อธิบายไว้):
 * - screens/assessment-form.js (ประเมินเดี่ยวจากเมนูแบบประเมิน)
 * - screens/visit-form-steps.js ขั้นตอนที่ 4 (ประเมินระหว่างเยี่ยมบ้าน)
 * ทั้งสองทางต้องได้ payload รูปร่างเดียวกันเป๊ะ เพราะยิง action assessments.saveInhomesss เดียวกัน —
 * ต่างกันแค่มี visitId แนบมาหรือไม่เท่านั้น (ดู resolveAssessmentContext_/saveInhomesssAssessment ฝั่ง backend)
 *
 * DOMAIN_FIELDS ต้องตรงกับ INHOMESSS_DOMAIN_FIELDS_ ใน Assessments.gs เป๊ะทุก key/kind/options — backend
 * เป็นผู้ sanitize ค่าจริงที่เก็บ (ทิ้งค่าที่ไม่รู้จักแทนที่จะ error) เพราะฟอร์มนี้เป็นเอกสารบันทึกอิสระ ไม่ใช่
 * เครื่องมือให้คะแนนที่ต้องตอบครบทุกข้อแบบ Barthel/9Q — validate() ของทั้งสองทางจึงไม่บังคับความครบถ้วน
 */
import { escapeHtml } from '../ui.js';
import { isNonEmptyString } from '../validation.js';
import {
  card, sectionTitle, answerRow, yesNoToggle, wireYesNo,
  singleChoice, wireSingleChoice, chipMultiSelect, wireChips, toggleArrayValue, cssId
} from '../form-widgets.js';
import {
  INHOMESSS_DOMAIN_ORDER, INHOMESSS_DOMAIN_LABELS,
  INHOMESSS_ADL_STATUS_OPTIONS, INHOMESSS_NUTRITION_STATUS_OPTIONS, INHOMESSS_TASTE_OPTIONS,
  INHOMESSS_FOOD_SOURCE_OPTIONS, INHOMESSS_HOME_INSIDE_OPTIONS, INHOMESSS_HOME_SURROUNDING_OPTIONS,
  INHOMESSS_EMERGENCY_CONTACT_OPTIONS, INHOMESSS_MED_ADMIN_OPTIONS, INHOMESSS_MED_REGULARITY_OPTIONS,
  INHOMESSS_FALL_RISK_OPTIONS, INHOMESSS_SERVICE_SOURCE_OPTIONS
} from '../constants.js';

/**
 * นิยามฟิลด์รายมิติ ถอดมาจากแบบฟอร์มกระดาษตรง ๆ ทีละบรรทัด
 * kind: 'single' (เลือกได้ตัวเดียว) | 'multi' (เลือกได้หลายตัว) | 'boolean' (ใช่/ไม่ใช่) | 'text' | 'textarea'
 * showWhen(domainAnswers): ฟิลด์ตามเงื่อนไข (เช่น "ระบุอื่น ๆ" โผล่เฉพาะตอนเลือก "อื่น ๆ") — ไม่ระบุ = โชว์เสมอ
 */
const DOMAIN_FIELDS = {
  immobility: [
    { key: 'adlStatus', kind: 'single', label: 'กิจวัตรประจำวัน (ADL)', options: INHOMESSS_ADL_STATUS_OPTIONS },
    { key: 'balanceOrGaitProblem', kind: 'boolean', label: 'มีปัญหาการทรงตัว/การเดิน', yesLabel: 'มี', noLabel: 'ไม่มี' },
    { key: 'sensoryProblem', kind: 'boolean', label: 'มีปัญหาระบบประสาทสัมผัส', yesLabel: 'มี', noLabel: 'ไม่มี' }
  ],
  nutrition: [
    { key: 'status', kind: 'single', label: 'ภาวะโภชนาการ', options: INHOMESSS_NUTRITION_STATUS_OPTIONS },
    { key: 'favoriteFood', kind: 'text', label: 'อาหารโปรด' },
    { key: 'mealsPerDay', kind: 'text', label: 'จำนวนมื้อต่อวัน' },
    { key: 'foodCaregiver', kind: 'text', label: 'ผู้ดูแลเรื่องอาหาร' },
    { key: 'tastePreferences', kind: 'multi', label: 'รสชาติอาหารที่ชอบ', options: INHOMESSS_TASTE_OPTIONS },
    { key: 'foodSource', kind: 'multi', label: 'ที่มาของอาหาร', options: INHOMESSS_FOOD_SOURCE_OPTIONS },
    { key: 'foodSourceOtherDetail', kind: 'text', label: 'ระบุที่มาของอาหารอื่น ๆ', showWhen: (a) => (a.foodSource || []).includes('อื่น ๆ') },
    { key: 'alcohol', kind: 'boolean', label: 'เหล้า/แอลกอฮอล์', yesLabel: 'ดื่ม', noLabel: 'ไม่ดื่ม' },
    { key: 'alcoholAmount', kind: 'text', label: 'ปริมาณแอลกอฮอล์ต่อวัน', showWhen: (a) => a.alcohol === true },
    { key: 'tobacco', kind: 'boolean', label: 'บุหรี่/ยาเส้น', yesLabel: 'สูบ', noLabel: 'ไม่สูบ' },
    { key: 'tobaccoAmount', kind: 'text', label: 'ปริมาณบุหรี่ต่อวัน', showWhen: (a) => a.tobacco === true }
  ],
  homeEnvironment: [
    { key: 'inHouse', kind: 'multi', label: 'ภายในบ้าน', options: INHOMESSS_HOME_INSIDE_OPTIONS },
    { key: 'surrounding', kind: 'multi', label: 'บริเวณรอบบ้าน', options: INHOMESSS_HOME_SURROUNDING_OPTIONS },
    { key: 'surroundingOtherDetail', kind: 'text', label: 'ระบุรายละเอียดอื่น ๆ', showWhen: (a) => (a.surrounding || []).includes('อื่น ๆ') }
  ],
  otherPeople: [
    { key: 'emergencyContact', kind: 'single', label: 'เมื่อผู้ป่วยมีภาวะฉุกเฉินเจ็บป่วย ผู้นำส่ง รพ. คือ', options: INHOMESSS_EMERGENCY_CONTACT_OPTIONS },
    { key: 'emergencyContactOtherDetail', kind: 'text', label: 'ระบุ', showWhen: (a) => a.emergencyContact === 'อื่น ๆ' },
    { key: 'endOfLifeDecisionMakerName', kind: 'text', label: 'ผู้ตัดสินใจการรักษาระยะสุดท้ายของชีวิต (ชื่อ-สกุล)' },
    { key: 'endOfLifeDecisionMakerPhone', kind: 'text', label: 'เบอร์โทรผู้ตัดสินใจ' },
    { key: 'caregiverHealthRisk', kind: 'boolean', label: 'ผู้ดูแล (caregiver) มีภาวะเสี่ยงด้านสุขภาพกาย/สุขภาพจิต', yesLabel: 'มี', noLabel: 'ไม่มี' }
  ],
  medications: [
    { key: 'administeredBy', kind: 'single', label: 'การบริหารยา', options: INHOMESSS_MED_ADMIN_OPTIONS },
    { key: 'supplement', kind: 'text', label: 'อาหารเสริม' },
    { key: 'regularity', kind: 'single', label: 'ได้รับยาสม่ำเสมอหรือไม่', options: INHOMESSS_MED_REGULARITY_OPTIONS },
    { key: 'herbalMedicine', kind: 'text', label: 'ยาสมุนไพร' },
    { key: 'currentMedications', kind: 'textarea', label: 'ยาประจำ' }
  ],
  examination: [
    { key: 'temperature', kind: 'text', label: 'อุณหภูมิ (T, °C)' },
    { key: 'bp', kind: 'text', label: 'ความดันโลหิต (BP, mmHg.)' },
    { key: 'pr', kind: 'text', label: 'ชีพจร (PR, ครั้ง/นาที)' },
    { key: 'rr', kind: 'text', label: 'อัตราการหายใจ (RR, ครั้ง/นาที)' },
    { key: 'labResult', kind: 'text', label: 'ผล Lab' },
    { key: 'physicalExam', kind: 'textarea', label: 'การตรวจร่างกาย (PE)' }
  ],
  safety: [
    { key: 'fallRisk', kind: 'single', label: 'ความปลอดภัยต่อการพลัดตกหกล้ม', options: INHOMESSS_FALL_RISK_OPTIONS }
  ],
  spiritualHealth: [
    { key: 'beliefs', kind: 'textarea', label: 'ความเชื่อ/เครื่องยึดเหนี่ยวจิตใจ' }
  ],
  service: [
    { key: 'sources', kind: 'multi', label: 'แหล่งให้บริการสุขภาพใกล้บ้าน', options: INHOMESSS_SERVICE_SOURCE_OPTIONS },
    { key: 'hospitalDetail', kind: 'text', label: 'ชื่อโรงพยาบาล', showWhen: (a) => (a.sources || []).includes('โรงพยาบาล') },
    { key: 'healthCenterDetail', kind: 'text', label: 'รพ.สต./ศสม', showWhen: (a) => (a.sources || []).includes('รพ.สต./ศสม') },
    { key: 'clinicDetail', kind: 'text', label: 'คลินิก', showWhen: (a) => (a.sources || []).includes('คลินิก') },
    { key: 'otherDetail', kind: 'text', label: 'อื่น ๆ ระบุ', showWhen: (a) => (a.sources || []).includes('อื่น ๆ') }
  ]
};

/** @param {string} domain @param {string} key @return {string} ชื่อกลุ่มสำหรับ data-attribute (คั่นด้วย _ ไม่ใช่ . กัน CSS escape พลาด) */
function fieldName(domain, key) {
  return `${domain}_${key}`;
}

function visibleFields(domain, domainAnswers) {
  return DOMAIN_FIELDS[domain].filter((f) => !f.showWhen || f.showWhen(domainAnswers));
}

/* ============================================================
 * โหมดกรอก (แก้ไขได้) — ใช้ทั้งฟอร์มเดี่ยวและฟอร์มเยี่ยมบ้าน
 * ============================================================ */

function renderEditableField(domain, field, value) {
  const name = fieldName(domain, field.key);
  const label = `<p class="text-xs text-slate-600 mb-1.5">${escapeHtml(field.label)}</p>`;

  if (field.kind === 'single') {
    return `<div>${label}${singleChoice({ name, options: field.options, selectedValue: value || '' })}</div>`;
  }
  if (field.kind === 'multi') {
    return `<div>${label}${chipMultiSelect({ name, options: field.options, selectedValues: value || [] })}</div>`;
  }
  if (field.kind === 'boolean') {
    return `<div>${label}${yesNoToggle({ name, value, yesLabel: field.yesLabel, noLabel: field.noLabel })}</div>`;
  }
  if (field.kind === 'textarea') {
    return `
      <div>${label}
        <textarea data-ih-textarea="${escapeHtml(name)}" rows="2"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml(value || '')}</textarea>
      </div>`;
  }
  return `
    <div>${label}
      <input type="text" data-ih-text="${escapeHtml(name)}" value="${escapeHtml(value || '')}"
        class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
    </div>`;
}

/** แถบความคืบหน้าของ step ย่อยรายมิติ (ไม่ใช่ step ใหญ่ของฟอร์มเยี่ยมบ้าน — อันนั้นมีแถบของตัวเองใน visit-form.js) */
function renderDomainStepProgress(stepIndex, total) {
  const pct = ((stepIndex + 1) / total) * 100;
  return `
    <div class="mb-3">
      <p class="text-xs text-slate-400 mb-1">มิติที่ ${stepIndex + 1}/${total}</p>
      <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-1.5 accent-gradient transition-all duration-300" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

/**
 * เรนเดอร์การ์ดของ "มิติเดียว" ตาม stepIndex พร้อมแถบความคืบหน้า + ปุ่มก่อนหน้า/ถัดไปมิติ (โหมดกรอกแบบ step)
 * ไม่รวมแถบสรุปธงความเสี่ยง (ผู้เรียกจัดการเองแยกต่างหาก เพราะแต่ละหน้าจอมีสไตล์แถบสรุปของตัวเอง เช่น
 * assessment-form.js มี livePreview() ของมันอยู่แล้ว)
 * ไม่มีข้อบังคับต้องกรอกครบก่อนกดถัดไป — INHOMESSS เป็นเอกสารบันทึกอิสระ ไม่ใช่เครื่องมือให้คะแนน (ดูหัวไฟล์)
 * @param {Object} answers { domain: {...} } ค่าปัจจุบันของทุกมิติ
 * @param {number} stepIndex ลำดับมิติที่กำลังแสดง (0-based, อิง INHOMESSS_DOMAIN_ORDER)
 * @return {string}
 */
export function renderInhomesssStep(answers, stepIndex) {
  answers = answers || {};
  const total = INHOMESSS_DOMAIN_ORDER.length;
  const domain = INHOMESSS_DOMAIN_ORDER[stepIndex];
  const domainAnswers = answers[domain] || {};
  return `
    ${renderDomainStepProgress(stepIndex, total)}
    ${card(`
      ${sectionTitle(INHOMESSS_DOMAIN_LABELS[domain])}
      <div class="space-y-3">
        ${visibleFields(domain, domainAnswers).map((field) => renderEditableField(domain, field, domainAnswers[field.key])).join('')}
      </div>
    `)}
    <div class="flex gap-2 mt-3 mb-4">
      <button type="button" data-ih-prev class="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium disabled:opacity-40" ${stepIndex === 0 ? 'disabled' : ''}>← มิติก่อนหน้า</button>
      <button type="button" data-ih-next class="flex-1 py-2.5 rounded-xl accent-gradient text-white text-sm font-medium disabled:opacity-40" ${stepIndex === total - 1 ? 'disabled' : ''}>มิติถัดไป →</button>
    </div>
  `;
}

/**
 * ผูก event ให้ฟิลด์ของมิติเดียวที่เรนเดอร์จาก renderInhomesssStep (stepIndex เดียวกัน) — ต้องเรียกทันทีหลัง
 * set container.innerHTML ด้วยค่า answers/stepIndex ชุดเดียวกัน (render/wire อ่าน showWhen จาก answers ตัวเดียวกัน
 * ถ้าค่าเปลี่ยนระหว่างสองขั้นตอน รายการฟิลด์ที่ wire จะไม่ตรงกับที่ render จริง)
 *
 * @param {HTMLElement} container
 * @param {Object} answers ค่าปัจจุบันของทุกมิติ (อ้างอิงเดียวกับที่ใช้ตอน render)
 * @param {number} stepIndex ลำดับมิติที่กำลังแสดง — ต้องตรงกับที่ใช้ตอน renderInhomesssStep
 * @param {{onChange: (domain:string, patch:Object, opts:{rerender:boolean}) => void, onNavigate: (nextStepIndex:number) => void}} handlers
 *   onChange ต้อง merge patch เข้ากับ answers[domain] เอง (แต่ละหน้าจอมีกลไก state ของตัวเอง — ctx.setDeepValue
 *   ของฟอร์มเยี่ยมบ้าน vs การ mutate state.answers ตรง ๆ ของฟอร์มเดี่ยว) แล้ว rerender เองถ้า opts.rerender
 *   เป็น true (ปุ่มเลือกต้อง rerender ให้เห็นสถานะใหม่ + เผื่อเปิด/ปิดฟิลด์ตามเงื่อนไข ส่วนฟิลด์ข้อความธรรมดา
 *   ไม่ rerender กันเคอร์เซอร์กระโดด — ตามธรรมเนียมเดียวกับ visit-form-steps.js) onNavigate เปลี่ยน stepIndex
 *   แล้ว rerender เอง (ผู้เรียกเก็บ stepIndex ไว้ใน state ของตัวเอง คนละที่กับ answers)
 */
export function wireInhomesssStep(container, answers, stepIndex, { onChange, onNavigate }) {
  answers = answers || {};
  const total = INHOMESSS_DOMAIN_ORDER.length;
  const domain = INHOMESSS_DOMAIN_ORDER[stepIndex];
  // ใช้ snapshot นี้แค่ตัดสินใจว่าฟิลด์ไหน "visible" ตอน wire (ต้องตรงกับที่ render ไปแล้ว) — ห้ามใช้ค่านี้
  // ตอนคำนวณ patch ตอนคลิกจริง เพราะฟิลด์ข้อความธรรมดา (text/textarea) แก้ค่าโดยไม่ rerender ทำให้ snapshot
  // นี้ล้าสมัยได้ทันทีที่พิมพ์อะไรลงไปหลัง wire ครั้งล่าสุด — ถ้า withHiddenFieldsCleared เผลอใช้ snapshot
  // เก่าไปเทียบ จะไม่เห็นค่าที่เพิ่งพิมพ์ จึงไม่ล้างค่านั้นให้ตอนฟิลด์ถูกซ่อนในคลิกถัดไป (ค่าพิมพ์ค้างหลุดไปกับ payload)
  const domainAnswersAtWireTime = answers[domain] || {};
  const emit = (patch) => {
    const current = answers[domain] || {};   // อ่านค่าปัจจุบันจริง ๆ ตอนคลิก ไม่ใช่ snapshot ตอน wire
    onChange(domain, withHiddenFieldsCleared(domain, current, patch), { rerender: true });
  };

  visibleFields(domain, domainAnswersAtWireTime).forEach((field) => {
    const name = fieldName(domain, field.key);
    if (field.kind === 'single') {
      wireSingleChoice(container, name, (value) => emit({ [field.key]: value }));
    } else if (field.kind === 'multi') {
      wireChips(container, name, (value) => {
        const current = (answers[domain] || {})[field.key] || [];
        emit({ [field.key]: toggleArrayValue(current, value) });
      });
    } else if (field.kind === 'boolean') {
      wireYesNo(container, name, (value) => emit({ [field.key]: value }));
    } else if (field.kind === 'textarea') {
      const el = container.querySelector(`[data-ih-textarea="${cssId(name)}"]`);
      if (el) el.addEventListener('input', (e) => onChange(domain, { [field.key]: e.target.value }, { rerender: false }));
    } else {
      const el = container.querySelector(`[data-ih-text="${cssId(name)}"]`);
      if (el) el.addEventListener('input', (e) => onChange(domain, { [field.key]: e.target.value }, { rerender: false }));
    }
  });

  const prevBtn = container.querySelector('[data-ih-prev]');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (stepIndex > 0) onNavigate(stepIndex - 1); });
  const nextBtn = container.querySelector('[data-ih-next]');
  if (nextBtn) nextBtn.addEventListener('click', () => { if (stepIndex < total - 1) onNavigate(stepIndex + 1); });
}

/**
 * ล้างค่าฟิลด์ตามเงื่อนไข (showWhen) ที่กำลังจะถูกซ่อนหลัง patch นี้ — ป้องกันค่าค้าง เช่น พิมพ์ "ปริมาณต่อวัน"
 * ไว้ตอน alcohol=ดื่ม แล้วเปลี่ยนใจเป็นไม่ดื่ม ค่าที่พิมพ์ไว้ต้องหายไปด้วย ไม่ใช่แค่ซ่อนจาก UI เฉย ๆ เพราะไม่งั้น
 * payload ที่ส่งจะมี alcohol:false ควบคู่กับ alcoholAmount ที่ยังมีค่าอยู่ — ขัดกันเองในบันทึกที่เก็บจริง
 * (ตามธรรมเนียมเดียวกับ pressureUlcerRenderer ใน assessment-form.js ที่รีเซ็ต location/size/stage ทิ้งตอน
 * hasWound=false — ต่างกันที่ INHOMESSS มีฟิลด์ตามเงื่อนไขหลายจุดจึงเขียนเป็น loop ทั่วไปแทนเขียนเจาะจงทีละคู่)
 * @param {string} domain
 * @param {Object} domainAnswers ค่าก่อน patch
 * @param {Object} patch ค่าที่กำลังจะเปลี่ยน
 * @return {Object} patch เดิม + ฟิลด์ที่ต้องล้างเพิ่ม
 */
function withHiddenFieldsCleared(domain, domainAnswers, patch) {
  const nextAnswers = { ...domainAnswers, ...patch };
  const cleared = {};
  DOMAIN_FIELDS[domain].forEach((field) => {
    if (!field.showWhen || field.showWhen(nextAnswers)) return;
    if (fieldHasValue(field.kind, nextAnswers[field.key])) {
      cleared[field.key] = field.kind === 'multi' ? [] : '';
    }
  });
  return { ...patch, ...cleared };
}

/* ============================================================
 * โหมดดูผล (อ่านอย่างเดียว) — ใช้ใน assessment-detail.js
 * ============================================================ */

/** @param {string} kind @param {*} value @return {boolean} มีค่าที่ควรแสดงหรือไม่ */
function fieldHasValue(kind, value) {
  if (kind === 'boolean') return value === true || value === false;
  if (kind === 'multi') return Array.isArray(value) && value.length > 0;
  return isNonEmptyString(value);
}

function renderFieldDetailRow(field, value) {
  if (field.kind === 'boolean') {
    const text = value === true ? (field.yesLabel || 'ใช่') : (field.noLabel || 'ไม่ใช่');
    return answerRow(field.label, text, value === true);
  }
  if (field.kind === 'multi') {
    return answerRow(field.label, (value || []).join(', '));
  }
  return answerRow(field.label, String(value));
}

/**
 * แสดงผล INHOMESSS แบบอ่านอย่างเดียว — รองรับทั้งข้อมูลรูปแบบใหม่ (รายฟิลด์ตามฟอร์มจริง) และรูปแบบเก่า
 * ({hasIssue, note} ต่อมิติ ก่อนเปลี่ยนมาใช้ฟอร์มเต็ม) เพื่อให้ประวัติเก่ายังดูย้อนหลังได้ปกติ ไม่ต้อง migrate
 * ข้อมูลเดิม (backend เก็บเป็น append-only อยู่แล้ว — ดูคอมเมนต์ใน assessment-detail.js)
 * @param {Object} answers { domain: {...} }
 * @return {string}
 */
export function renderInhomesssDetail(answers) {
  answers = answers || {};
  return INHOMESSS_DOMAIN_ORDER.map((domain) => {
    const entry = answers[domain] || {};
    const isLegacyFormat = 'hasIssue' in entry;

    if (isLegacyFormat) {
      return card(`
        ${sectionTitle(INHOMESSS_DOMAIN_LABELS[domain])}
        <p class="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mb-2">บันทึกด้วยแบบฟอร์มรุ่นเก่า (สรุปแบบพบปัญหา/ไม่พบปัญหาเท่านั้น)</p>
        ${answerRow('สรุป', entry.hasIssue === true ? 'พบปัญหา' : 'ไม่พบปัญหา', entry.hasIssue === true)}
        ${entry.note ? `<p class="text-xs text-slate-500 mt-1 pl-1">↳ ${escapeHtml(entry.note)}</p>` : ''}
      `);
    }

    const filled = visibleFields(domain, entry).filter((field) => fieldHasValue(field.kind, entry[field.key]));
    return card(`
      ${sectionTitle(INHOMESSS_DOMAIN_LABELS[domain])}
      ${filled.length > 0
        ? filled.map((field) => renderFieldDetailRow(field, entry[field.key])).join('')
        : '<p class="text-xs text-slate-400">ไม่ได้บันทึกข้อมูลมิตินี้</p>'}
    `);
  }).join('');
}
