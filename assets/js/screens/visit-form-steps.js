/**
 * screens/visit-form-steps.js
 * เรนเดอร์เนื้อหาแต่ละขั้นตอน (10 ขั้น) ของฟอร์มบันทึกการเยี่ยมบ้าน + validate ต่อขั้นตอนก่อนกด "ถัดไป"
 * แยกจาก visit-form.js (ตัวควบคุม state/สเต็ปเปอร์/autosave/GPS/รูปภาพ) เพื่อไม่ให้ไฟล์เดียวยาวเกินไป
 *
 * รูปแบบการ interact: ปุ่ม/ตัวเลือกแบบ toggle (ที่มีผลต่อ conditional field) เรียก ctx.rerenderStep() หลังอัปเดต state
 * เพื่อรีเฟรช conditional UI — ส่วน input ข้อความ/ตัวเลข/select ธรรมดาแค่อัปเดต state เฉย ๆ (ไม่ rerender กันเคอร์เซอร์กระโดด)
 */
import { escapeHtml, showToast } from '../ui.js';
import { resizeImageFile, estimateDataUrlBytes, formatBytes } from '../image-utils.js';
import { createSignaturePad } from '../signature-pad.js';
import { initThaiAppointmentDatePicker, formatThaiDateDisplay } from '../date-picker.js';
import {
  card, sectionTitle, segmentedChoice, yesNoToggle, chipMultiSelect,
  wireSegmented, wireYesNo, wireChips, toggleArrayValue, cssId
} from '../form-widgets.js';
import {
  BARTHEL_ITEMS, INHOMESSS_DOMAIN_ORDER, INHOMESSS_DOMAIN_LABELS,
  NINE_Q_TEXTS, EIGHT_Q_TEXTS, FALL_RISK_TEXTS, CAREGIVER_BURDEN_TEXTS,
  SYMPTOM_OPTIONS, SERVICE_OPTIONS, MEDICATION_OPTIONS, NUTRITION_OPTIONS, EXCRETION_OPTIONS, SLEEP_OPTIONS,
  SHORT_RISK_OPTIONS, WOUND_STAGE_OPTIONS
} from '../constants.js';

export const STEP_TITLES = [
  'ข้อมูลการเยี่ยมและ GPS', 'Vital Signs', 'ADL', 'INHOMESSS', 'สุขภาพและยา',
  'แผลกดทับ/ความเสี่ยงล้ม', '2Q/9Q/8Q', 'ผู้ดูแลและบริการ', 'รูปถ่าย/ลายเซ็น', 'สรุปและยืนยัน'
];
export const TOTAL_STEPS = STEP_TITLES.length;

/* ============================================================
 * UI builder helpers ที่ใช้ซ้ำหลายขั้นตอน
 * ============================================================ */

function textField({ id, label, value, type = 'text', placeholder = '' }) {
  return `
    <div>
      <label class="block text-xs font-medium text-slate-500 mb-1">${escapeHtml(label)}</label>
      <input id="${id}" type="${type}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}"
        class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
    </div>
  `;
}

function selectField({ id, label, value, options, placeholder }) {
  return `
    <div>
      <label class="block text-xs font-medium text-slate-500 mb-1">${escapeHtml(label)}</label>
      <select id="${id}" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
        <option value="">${escapeHtml(placeholder)}</option>
        ${options.map((o) => `<option value="${escapeHtml(o)}" ${value === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>
    </div>
  `;
}

/* ============================================================
 * Step 1 — ข้อมูลการเยี่ยมและ GPS
 * ============================================================ */

function renderStep1(container, state, ctx) {
  const gps = state.gps;
  const gpsStatusHtml = gps.lat !== null
    ? `<p class="text-xs text-emerald-600 mt-2">✓ บันทึกตำแหน่งแล้ว (${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)})</p>`
    : gps.error
      ? `<p class="text-xs text-rose-600 mt-2">${escapeHtml(gps.error)}</p>`
      : '<p class="text-xs text-slate-400 mt-2">ยังไม่ได้บันทึกตำแหน่ง</p>';

  container.innerHTML = `
    ${card(`
      ${sectionTitle('ข้อมูลผู้ดูแลที่พบ ณ วันเยี่ยม')}
      <div class="grid grid-cols-2 gap-3">
        ${textField({ id: 'vf-caregiver-name', label: 'ผู้ดูแลหลักที่พบ', value: state.visit.caregiverName })}
        ${textField({ id: 'vf-relation', label: 'ความสัมพันธ์กับผู้ป่วย', value: state.visit.relation })}
      </div>
    `)}
    ${card(`
      ${sectionTitle('ตำแหน่ง GPS')}
      <p class="text-xs text-slate-500 mb-3">ระบบขอเข้าถึงตำแหน่งของคุณเพื่อบันทึกพิกัดสถานที่เยี่ยมบ้านไว้เป็นหลักฐานยืนยันการเยี่ยมจริง และช่วยวางแผนเส้นทางเยี่ยมครั้งถัดไป ข้อมูลนี้จะถูกเก็บไว้ในระบบของหน่วยงานเท่านั้น</p>
      <button id="vf-request-gps-btn" type="button" class="w-full py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium" ${gps.requesting ? 'disabled' : ''}>
        ${gps.requesting ? 'กำลังขอตำแหน่ง...' : (gps.lat !== null ? 'บันทึกตำแหน่งใหม่อีกครั้ง' : 'อนุญาตและบันทึกตำแหน่ง GPS')}
      </button>
      ${gpsStatusHtml}
    `)}
  `;

  container.querySelector('#vf-caregiver-name').addEventListener('input', (e) => {
    ctx.setNested('visit', { caregiverName: e.target.value });
  });
  container.querySelector('#vf-relation').addEventListener('input', (e) => {
    ctx.setNested('visit', { relation: e.target.value });
  });
  container.querySelector('#vf-request-gps-btn').addEventListener('click', () => ctx.requestGps());
}

/* ============================================================
 * Step 2 — Vital Signs
 * ============================================================ */

function renderStep2(container, state, ctx) {
  container.innerHTML = card(`
    ${sectionTitle('สัญญาณชีพ (Vital Signs)')}
    <div class="grid grid-cols-2 gap-3">
      ${textField({ id: 'vf-bp', label: 'ความดันโลหิต', value: state.visit.bp, placeholder: '120/80' })}
      ${textField({ id: 'vf-hr', label: 'ชีพจร (ครั้ง/นาที)', value: state.visit.hr, type: 'text' })}
      ${textField({ id: 'vf-temp', label: 'อุณหภูมิ (°C)', value: state.visit.temp })}
      ${textField({ id: 'vf-spo2', label: 'SpO2 (%)', value: state.visit.spo2 })}
    </div>
  `);

  ['bp', 'hr', 'temp', 'spo2'].forEach((key) => {
    container.querySelector(`#vf-${key}`).addEventListener('input', (e) => {
      ctx.setNested('visit', { [key]: e.target.value });
    });
  });
}

/* ============================================================
 * Step 3 — ADL (Barthel)
 * ============================================================ */

function renderStep3(container, state, ctx) {
  container.innerHTML = card(`
    ${sectionTitle('แบบประเมิน Barthel ADL Index')}
    <div class="space-y-4">
      ${BARTHEL_ITEMS.map((item) => `
        <div>
          <p class="text-xs font-medium text-slate-600 mb-1.5">${escapeHtml(item.label)}</p>
          ${segmentedChoice({ name: `barthel-${item.key}`, options: item.options, selectedValue: state.barthel[item.key] })}
        </div>
      `).join('')}
    </div>
  `);

  BARTHEL_ITEMS.forEach((item) => {
    wireSegmented(container, `barthel-${item.key}`, (value) => {
      ctx.setDeepValue('barthel', item.key, value);
      ctx.rerenderStep();
    });
  });
}

/* ============================================================
 * Step 4 — INHOMESSS
 * ============================================================ */

function renderStep4(container, state, ctx) {
  container.innerHTML = card(`
    ${sectionTitle('ประเมินสิ่งแวดล้อมและบริบทที่บ้าน (INHOMESSS)')}
    <div class="space-y-4">
      ${INHOMESSS_DOMAIN_ORDER.map((domain) => {
        const entry = state.inhomesss[domain];
        return `
          <div class="pb-3 ${domain !== INHOMESSS_DOMAIN_ORDER[INHOMESSS_DOMAIN_ORDER.length - 1] ? 'border-b border-slate-100' : ''}">
            <p class="text-xs font-medium text-slate-600 mb-1.5">${escapeHtml(INHOMESSS_DOMAIN_LABELS[domain])}</p>
            ${yesNoToggle({ name: `inhomesss-${domain}`, value: entry.hasIssue, yesLabel: 'พบปัญหา', noLabel: 'ไม่พบปัญหา' })}
            ${entry.hasIssue ? `
              <textarea data-inhomesss-note="${escapeHtml(domain)}" rows="2" placeholder="บันทึกรายละเอียดปัญหาที่พบ"
                class="w-full mt-2 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml(entry.note)}</textarea>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `);

  INHOMESSS_DOMAIN_ORDER.forEach((domain) => {
    wireYesNo(container, `inhomesss-${domain}`, (value) => {
      const entry = state.inhomesss[domain];
      ctx.setDeepValue('inhomesss', domain, { hasIssue: value, note: entry.note });
      ctx.rerenderStep();
    });
    const noteEl = container.querySelector(`[data-inhomesss-note="${cssId(domain)}"]`);
    if (noteEl) {
      noteEl.addEventListener('input', (e) => {
        const entry = state.inhomesss[domain];
        ctx.setDeepValue('inhomesss', domain, { hasIssue: entry.hasIssue, note: e.target.value });
      });
    }
  });
}

/* ============================================================
 * Step 5 — สุขภาพและยา
 * ============================================================ */

function renderStep5(container, state, ctx) {
  container.innerHTML = `
    ${card(`
      ${sectionTitle('อาการและปัญหาที่พบ')}
      ${chipMultiSelect({ name: 'symptoms', options: SYMPTOM_OPTIONS, selectedValues: state.visit.symptoms })}
    `)}
    ${card(`
      ${sectionTitle('การรับประทานยา / โภชนาการ / การขับถ่าย / การนอน')}
      <div class="grid grid-cols-2 gap-3">
        ${selectField({ id: 'vf-medication', label: 'การรับประทานยา', value: state.visit.medication, options: MEDICATION_OPTIONS, placeholder: 'เลือก' })}
        ${selectField({ id: 'vf-nutrition', label: 'โภชนาการ', value: state.visit.nutrition, options: NUTRITION_OPTIONS, placeholder: 'เลือก' })}
        ${selectField({ id: 'vf-excretion', label: 'การขับถ่าย', value: state.visit.excretion, options: EXCRETION_OPTIONS, placeholder: 'เลือก' })}
        ${selectField({ id: 'vf-sleep', label: 'การนอนหลับ', value: state.visit.sleep, options: SLEEP_OPTIONS, placeholder: 'เลือก' })}
      </div>
    `)}
  `;

  wireChips(container, 'symptoms', (value) => {
    ctx.setNested('visit', { symptoms: toggleArrayValue(state.visit.symptoms, value) });
    ctx.rerenderStep();
  });
  ['medication', 'nutrition', 'excretion', 'sleep'].forEach((key) => {
    container.querySelector(`#vf-${key}`).addEventListener('change', (e) => {
      ctx.setNested('visit', { [key]: e.target.value });
    });
  });
}

/* ============================================================
 * Step 6 — แผลกดทับ/ความเสี่ยงล้ม
 * ============================================================ */

function renderStep6(container, state, ctx) {
  const wound = state.wound;
  container.innerHTML = `
    ${card(`
      ${sectionTitle('แผลกดทับ')}
      ${yesNoToggle({ name: 'has-wound', value: wound.hasWound, yesLabel: 'พบแผลกดทับ', noLabel: 'ไม่มีแผล' })}
      ${wound.hasWound ? `
        <div class="mt-3 space-y-3 bg-rose-50 rounded-xl p-3">
          <div class="grid grid-cols-2 gap-3">
            ${textField({ id: 'vf-wound-location', label: 'ตำแหน่งแผล', value: wound.location })}
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">ระยะ (Stage)</label>
              ${segmentedChoice({ name: 'wound-stage', options: WOUND_STAGE_OPTIONS.map((s) => ({ v: s, l: 'ระยะ ' + s })), selectedValue: wound.stage })}
            </div>
            ${textField({ id: 'vf-wound-size', label: 'ขนาด (ซม.)', value: wound.size })}
            ${textField({ id: 'vf-wound-care', label: 'การดูแลแผล', value: wound.care })}
          </div>
        </div>
      ` : ''}
    `)}
    ${card(`
      ${sectionTitle('แบบประเมินความเสี่ยงหกล้ม')}
      <div class="space-y-3">
        ${FALL_RISK_TEXTS.map((text, i) => `
          <div>
            <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
            ${yesNoToggle({ name: `fallrisk-q${i + 1}`, value: state.fallRisk[`q${i + 1}`] })}
          </div>
        `).join('')}
      </div>
      <div class="mt-3">
        ${selectField({ id: 'vf-fallrisknote', label: 'สรุประดับความเสี่ยงหกล้ม (สั้น)', value: state.visit.fallRiskNote, options: SHORT_RISK_OPTIONS, placeholder: 'เลือก' })}
      </div>
    `)}
  `;

  wireYesNo(container, 'has-wound', (value) => {
    ctx.setNested('wound', { hasWound: value, stage: value ? wound.stage : '' });
    ctx.rerenderStep();
  });

  if (wound.hasWound) {
    container.querySelector('#vf-wound-location').addEventListener('input', (e) => ctx.setNested('wound', { location: e.target.value }));
    container.querySelector('#vf-wound-size').addEventListener('input', (e) => ctx.setNested('wound', { size: e.target.value }));
    container.querySelector('#vf-wound-care').addEventListener('input', (e) => ctx.setNested('wound', { care: e.target.value }));
    wireSegmented(container, 'wound-stage', (value) => {
      ctx.setNested('wound', { stage: String(value) });
      ctx.rerenderStep();
    });
  }

  for (let i = 1; i <= 5; i++) {
    wireYesNo(container, `fallrisk-q${i}`, (value) => {
      ctx.setDeepValue('fallRisk', `q${i}`, value);
      ctx.rerenderStep();
    });
  }

  container.querySelector('#vf-fallrisknote').addEventListener('change', (e) => ctx.setNested('visit', { fallRiskNote: e.target.value }));
}

/* ============================================================
 * Step 7 — 2Q/9Q/8Q
 * ============================================================ */

function renderStep7(container, state, ctx) {
  const dep = state.depression;
  const twoQBothAnswered = dep.twoQ.q1 !== null && dep.twoQ.q2 !== null;
  const twoQBothNo = dep.twoQ.q1 === false && dep.twoQ.q2 === false;
  const showNineQ = twoQBothAnswered && !twoQBothNo;
  const nineQComplete = NINE_Q_TEXTS.every((_, i) => dep.nineQ[`q${i + 1}`] !== null);
  const showEightQ = showNineQ && nineQComplete && Number(dep.nineQ.q9) > 0;

  container.innerHTML = `
    ${card(`
      ${sectionTitle('2Q — คัดกรองภาวะซึมเศร้าเบื้องต้น')}
      <div class="space-y-3">
        <div>
          <p class="text-xs text-slate-600 mb-1.5">1. ใน 2 สัปดาห์ที่ผ่านมา รู้สึกหดหู่ เศร้า หรือท้อแท้สิ้นหวังหรือไม่</p>
          ${yesNoToggle({ name: 'twoq-q1', value: dep.twoQ.q1 })}
        </div>
        <div>
          <p class="text-xs text-slate-600 mb-1.5">2. ใน 2 สัปดาห์ที่ผ่านมา รู้สึกเบื่อ ทำอะไรก็ไม่เพลิดเพลินหรือไม่</p>
          ${yesNoToggle({ name: 'twoq-q2', value: dep.twoQ.q2 })}
        </div>
      </div>
    `)}
    ${showNineQ ? card(`
      ${sectionTitle('9Q — ประเมินความรุนแรงของภาวะซึมเศร้า (0=ไม่มี, 1=บางวัน, 2=บ่อย, 3=ทุกวัน)')}
      <div class="space-y-3">
        ${NINE_Q_TEXTS.map((text, i) => `
          <div>
            <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
            ${segmentedChoice({ name: `nineq-q${i + 1}`, options: [0, 1, 2, 3].map((v) => ({ v, l: String(v) })), selectedValue: dep.nineQ[`q${i + 1}`] })}
          </div>
        `).join('')}
      </div>
    `) : ''}
    ${showEightQ ? card(`
      ${sectionTitle('8Q — ประเมินความเสี่ยงฆ่าตัวตาย (พบจาก 9Q ข้อ 9 มากกว่า 0 คะแนน)')}
      <div class="space-y-3">
        ${EIGHT_Q_TEXTS.map((text, i) => `
          <div>
            <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
            ${yesNoToggle({ name: `eightq-q${i + 1}`, value: dep.eightQ[`q${i + 1}`] })}
          </div>
        `).join('')}
      </div>
    `) : ''}
  `;

  wireYesNo(container, 'twoq-q1', (value) => { ctx.setDeepValue('depression', 'twoQ', { ...dep.twoQ, q1: value }); ctx.rerenderStep(); });
  wireYesNo(container, 'twoq-q2', (value) => { ctx.setDeepValue('depression', 'twoQ', { ...dep.twoQ, q2: value }); ctx.rerenderStep(); });

  if (showNineQ) {
    for (let i = 1; i <= 9; i++) {
      wireSegmented(container, `nineq-q${i}`, (value) => {
        ctx.setDeepValue('depression', 'nineQ', { ...dep.nineQ, [`q${i}`]: value });
        ctx.rerenderStep();
      });
    }
  }
  if (showEightQ) {
    for (let i = 1; i <= 8; i++) {
      wireYesNo(container, `eightq-q${i}`, (value) => {
        ctx.setDeepValue('depression', 'eightQ', { ...dep.eightQ, [`q${i}`]: value });
        ctx.rerenderStep();
      });
    }
  }
}

/* ============================================================
 * Step 8 — ผู้ดูแลและบริการ
 * ============================================================ */

function renderStep8(container, state, ctx) {
  container.innerHTML = `
    ${card(`
      ${sectionTitle('แบบประเมินภาระผู้ดูแล (Caregiver Burden)')}
      <div class="space-y-3">
        ${CAREGIVER_BURDEN_TEXTS.map((text, i) => `
          <div>
            <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
            ${yesNoToggle({ name: `cgburden-q${i + 1}`, value: state.caregiverBurden[`q${i + 1}`] })}
          </div>
        `).join('')}
      </div>
      <div class="mt-3">
        ${selectField({ id: 'vf-cgburdennote', label: 'สรุประดับภาระผู้ดูแล (สั้น)', value: state.visit.caregiverBurdenNote, options: SHORT_RISK_OPTIONS, placeholder: 'เลือก' })}
      </div>
    `)}
    ${card(`
      ${sectionTitle('บริการที่ให้ในการเยี่ยมครั้งนี้')}
      ${chipMultiSelect({ name: 'services', options: SERVICE_OPTIONS, selectedValues: state.visit.servicesGiven })}
    `)}
    ${card(`
      ${sectionTitle('คำแนะนำ / แผนติดตาม')}
      <textarea id="vf-notes" rows="3" placeholder="คำแนะนำสำหรับผู้ดูแล/แผนติดตามครั้งถัดไป"
        class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml(state.visit.notes)}</textarea>
      ${textField({ id: 'vf-nextvisit', label: 'วันนัดเยี่ยมถัดไป', value: state.visit.nextVisitDate, placeholder: 'เลือกวันนัด (พ.ศ.)' })}
    `)}
  `;

  for (let i = 1; i <= 5; i++) {
    wireYesNo(container, `cgburden-q${i}`, (value) => {
      ctx.setDeepValue('caregiverBurden', `q${i}`, value);
      ctx.rerenderStep();
    });
  }
  container.querySelector('#vf-cgburdennote').addEventListener('change', (e) => ctx.setNested('visit', { caregiverBurdenNote: e.target.value }));
  wireChips(container, 'services', (value) => {
    ctx.setNested('visit', { servicesGiven: toggleArrayValue(state.visit.servicesGiven, value) });
    ctx.rerenderStep();
  });
  container.querySelector('#vf-notes').addEventListener('input', (e) => ctx.setNested('visit', { notes: e.target.value }));
  container.querySelector('#vf-nextvisit').addEventListener('input', (e) => ctx.setNested('visit', { nextVisitDate: e.target.value }));
  // ขั้นนี้ rerender ทุกครั้งที่กดชิป/yes-no → container.innerHTML ถูกล้างทิ้ง แต่ปฏิทินของ flatpickr ไปแขวนไว้
  // ใต้ document.body จึงค้างเป็น orphan สะสมไปเรื่อย ๆ ถ้าไม่ destroy ตัวเก่าก่อนผูกตัวใหม่
  if (container.ltcNextVisitPicker) container.ltcNextVisitPicker.destroy();
  container.ltcNextVisitPicker = initThaiAppointmentDatePicker(container.querySelector('#vf-nextvisit'));
}

/* ============================================================
 * Step 9 — รูปถ่าย/ลายเซ็น
 * ============================================================ */

const PHOTO_SLOTS = [
  { key: 'before', label: 'ภาพก่อนทำแผล/ก่อนเยี่ยม' },
  { key: 'after', label: 'ภาพหลังทำแผล/หลังเยี่ยม' },
  { key: 'woundPhoto', label: 'ภาพระยะใกล้ของแผล', woundOnly: true }
];

function renderPhotoSlot(slot, photo) {
  let statusLine = '';
  if (photo) {
    if (photo.uploading) statusLine = '<p class="text-xs text-sky-600 mt-1">⏳ กำลังอัปโหลด...</p>';
    else if (photo.fileId) statusLine = '<p class="text-xs text-emerald-600 mt-1">✓ อัปโหลดสำเร็จ</p>';
    else if (photo.uploadFailed) statusLine = '<p class="text-xs text-rose-600 mt-1">⚠️ อัปโหลดไม่สำเร็จ — แตะ "ลบรูปนี้" แล้วลองแนบใหม่</p>';
  }

  return `
    <div>
      <p class="text-xs font-medium text-slate-600 mb-1.5">${escapeHtml(slot.label)}</p>
      ${photo ? `
        <div class="relative">
          <img src="${photo.dataUrl}" class="w-full h-40 object-cover rounded-xl border border-slate-200" />
          <p class="text-xs text-slate-400 mt-1">ขนาดหลังย่อ ${escapeHtml(formatBytes(photo.bytes))}</p>
          ${statusLine}
          <button type="button" data-remove-photo="${escapeHtml(slot.key)}" class="mt-1 text-xs text-rose-600 font-medium">ลบรูปนี้</button>
        </div>
      ` : `
        <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer text-slate-400 text-xs">
          <span class="text-2xl mb-1">📷</span>แตะเพื่อถ่าย/เลือกรูป
          <input type="file" accept="image/*" capture="environment" class="hidden" data-photo-input="${escapeHtml(slot.key)}" />
        </label>
      `}
    </div>
  `;
}

function renderStep9(container, state, ctx) {
  const visiblePhotoSlots = PHOTO_SLOTS.filter((slot) => !slot.woundOnly || state.wound.hasWound);

  container.innerHTML = `
    ${card(`
      ${sectionTitle('รูปถ่ายประกอบการเยี่ยม')}
      <p class="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2 mb-3">
        รูปจะถูกย่อขนาดและอัปโหลดขึ้น Google Drive ทันทีที่เลือก — ต้องมีสัญญาณอินเทอร์เน็ตขณะแนบรูปแต่ละใบ
        (ถ้าออฟไลน์ตอนแนบรูป จะขึ้นสถานะ "อัปโหลดไม่สำเร็จ" ให้ลองแนบใหม่อีกครั้งตอนกลับมาออนไลน์)
      </p>
      <div class="grid grid-cols-1 gap-4">
        ${visiblePhotoSlots.map((slot) => renderPhotoSlot(slot, state.photos[slot.key])).join('')}
      </div>
    `)}
    ${card(`
      ${sectionTitle('ลายเซ็นผู้เยี่ยม / ผู้ป่วยหรือญาติ')}
      <canvas id="vf-signature-canvas" width="600" height="220" class="w-full h-40 rounded-xl border border-slate-200 bg-slate-50 touch-none"></canvas>
      <div class="flex gap-2 mt-2">
        <button id="vf-signature-clear" type="button" class="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium">ล้างลายเซ็น</button>
        <button id="vf-signature-confirm" type="button" class="flex-1 py-2 rounded-xl bg-sky-600 text-white text-xs font-medium">ยืนยันลายเซ็น</button>
      </div>
      <p class="text-xs ${state.signatureFileId ? 'text-emerald-600' : (state.signatureDataUrl ? 'text-sky-600' : 'text-slate-400')} mt-2">
        ${state.signatureFileId ? '✓ บันทึกและอัปโหลดลายเซ็นแล้ว' : (state.signatureDataUrl ? '⏳ กำลังอัปโหลดลายเซ็น...' : 'ยังไม่ได้ลงลายเซ็น (ไม่บังคับ)')}
      </p>
    `)}
  `;

  visiblePhotoSlots.forEach((slot) => {
    const input = container.querySelector(`[data-photo-input="${cssId(slot.key)}"]`);
    if (input) {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) await ctx.addPhoto(slot.key, file);
      });
    }
    const removeBtn = container.querySelector(`[data-remove-photo="${cssId(slot.key)}"]`);
    if (removeBtn) {
      removeBtn.addEventListener('click', () => ctx.removePhoto(slot.key));
    }
  });

  const canvas = container.querySelector('#vf-signature-canvas');
  const pad = ctx.getOrCreateSignaturePad(canvas);
  container.querySelector('#vf-signature-clear').addEventListener('click', () => {
    pad.clear();
    ctx.setState({ signatureDataUrl: null, signatureFileId: null });
  });
  container.querySelector('#vf-signature-confirm').addEventListener('click', async () => {
    if (pad.isEmpty()) {
      showToast('กรุณาลงลายเซ็นก่อนกดยืนยัน', 'warning');
      return;
    }
    await ctx.confirmSignature(pad.toDataUrl());
  });
}

/* ============================================================
 * Step 10 — สรุปและยืนยัน
 * ============================================================ */

function summaryRow(label, value) {
  return `<div class="flex justify-between gap-3 py-1 text-sm"><span class="text-slate-400">${escapeHtml(label)}</span><span class="text-slate-700 text-right">${escapeHtml(value || '-')}</span></div>`;
}

function renderStep10(container, state) {
  const barthelTotal = BARTHEL_ITEMS.reduce((sum, item) => sum + (state.barthel[item.key] || 0), 0);
  const fallRiskCount = Object.values(state.fallRisk).filter(Boolean).length;
  const cgBurdenCount = Object.values(state.caregiverBurden).filter(Boolean).length;

  container.innerHTML = `
    ${card(`
      ${sectionTitle('ข้อมูลการเยี่ยม')}
      ${summaryRow('ผู้ดูแลที่พบ', state.visit.caregiverName)}
      ${summaryRow('ความสัมพันธ์', state.visit.relation)}
      ${summaryRow('ตำแหน่ง GPS', state.gps.lat !== null ? `${state.gps.lat.toFixed(5)}, ${state.gps.lng.toFixed(5)}` : 'ไม่ได้บันทึก')}
      ${summaryRow('BP / HR / Temp / SpO2', `${state.visit.bp || '-'} / ${state.visit.hr || '-'} / ${state.visit.temp || '-'} / ${state.visit.spo2 || '-'}`)}
    `)}
    ${card(`
      ${sectionTitle('ADL (Barthel)')}
      ${summaryRow('คะแนนรวม', `${barthelTotal} / 20`)}
    `)}
    ${card(`
      ${sectionTitle('แผลกดทับ / ความเสี่ยงหกล้ม')}
      ${summaryRow('แผลกดทับ', state.wound.hasWound ? `พบ ระยะ ${state.wound.stage}` : 'ไม่พบ')}
      ${summaryRow('ข้อที่มีความเสี่ยงหกล้ม', `${fallRiskCount} / 5`)}
    `)}
    ${card(`
      ${sectionTitle('2Q/9Q/8Q')}
      ${summaryRow('2Q', state.depression.twoQ.q1 === false && state.depression.twoQ.q2 === false ? 'ไม่มีความเสี่ยง' : 'พบความเสี่ยง ต้องประเมิน 9Q ต่อ')}
    `)}
    ${card(`
      ${sectionTitle('ผู้ดูแลและบริการ')}
      ${summaryRow('ข้อภาระผู้ดูแลที่พบ', `${cgBurdenCount} / 5`)}
      ${summaryRow('บริการที่ให้', (state.visit.servicesGiven || []).join(', '))}
      ${summaryRow('นัดเยี่ยมถัดไป', formatThaiDateDisplay(state.visit.nextVisitDate, 'ไม่ได้นัด'))}
    `)}
    ${card(`
      ${sectionTitle('รูปถ่าย/ลายเซ็น')}
      ${summaryRow('รูปที่อัปโหลดสำเร็จ', String(Object.values(state.photos).filter((p) => p && p.fileId).length) + ' / ' + String(Object.values(state.photos).filter(Boolean).length) + ' ที่แนบ')}
      ${summaryRow('ลายเซ็น', state.signatureFileId ? 'ลงลายเซ็นและอัปโหลดแล้ว' : (state.signatureDataUrl ? 'ลงลายเซ็นแล้วแต่ยังอัปโหลดไม่สำเร็จ' : 'ยังไม่ได้ลงลายเซ็น'))}
    `)}
    <p class="text-xs text-slate-400 px-1">ตรวจสอบข้อมูลให้ครบถ้วนก่อนกด "บันทึกและส่ง" ด้านล่าง — เมื่อส่งแล้วจะไม่สามารถแก้ไขผ่านฟอร์มนี้ได้อีก</p>
  `;
}

/* ============================================================
 * Dispatcher + Validation
 * ============================================================ */

const RENDERERS = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6, renderStep7, renderStep8, renderStep9, renderStep10];

/**
 * @param {number} stepNumber 1-10
 * @param {HTMLElement} container
 * @param {Object} state
 * @param {Object} ctx
 */
export function renderVisitFormStep(stepNumber, container, state, ctx) {
  RENDERERS[stepNumber - 1](container, state, ctx);
}

/**
 * @param {number} stepNumber
 * @param {Object} state
 * @return {string|null} ข้อความ error ถ้ายังกรอกไม่ครบ หรือ null ถ้าผ่าน
 */
export function validateVisitFormStep(stepNumber, state) {
  if (stepNumber === 3) {
    const missing = BARTHEL_ITEMS.find((item) => state.barthel[item.key] === null || state.barthel[item.key] === undefined);
    if (missing) return `กรุณาประเมินหัวข้อ "${missing.label}" ให้ครบก่อนไปขั้นตอนถัดไป`;
  }
  if (stepNumber === 4) {
    const missing = INHOMESSS_DOMAIN_ORDER.find((domain) => state.inhomesss[domain].hasIssue === null);
    if (missing) return `กรุณาตอบหัวข้อ "${INHOMESSS_DOMAIN_LABELS[missing]}" ให้ครบก่อนไปขั้นตอนถัดไป`;
  }
  if (stepNumber === 6) {
    if (state.wound.hasWound === null) return 'กรุณาระบุว่าพบแผลกดทับหรือไม่';
    if (state.wound.hasWound && !state.wound.stage) return 'กรุณาระบุระยะ (Stage) ของแผลกดทับ';
    for (let i = 1; i <= 5; i++) {
      if (state.fallRisk[`q${i}`] === null) return 'กรุณาตอบแบบประเมินความเสี่ยงหกล้มให้ครบทั้ง 5 ข้อ';
    }
  }
  if (stepNumber === 7) {
    const dep = state.depression;
    if (dep.twoQ.q1 === null || dep.twoQ.q2 === null) return 'กรุณาตอบแบบประเมิน 2Q ให้ครบทั้ง 2 ข้อ';
    const twoQBothNo = dep.twoQ.q1 === false && dep.twoQ.q2 === false;
    if (!twoQBothNo) {
      for (let i = 1; i <= 9; i++) {
        if (dep.nineQ[`q${i}`] === null) return 'กรุณาตอบแบบประเมิน 9Q ให้ครบทั้ง 9 ข้อ (เนื่องจาก 2Q พบความเสี่ยง)';
      }
      if (Number(dep.nineQ.q9) > 0) {
        for (let i = 1; i <= 8; i++) {
          if (dep.eightQ[`q${i}`] === null) return 'กรุณาตอบแบบประเมิน 8Q ให้ครบทั้ง 8 ข้อ (เนื่องจากพบความเสี่ยงจาก 9Q ข้อ 9)';
        }
      }
    }
  }
  if (stepNumber === 8) {
    for (let i = 1; i <= 5; i++) {
      if (state.caregiverBurden[`q${i}`] === null) return 'กรุณาตอบแบบประเมินภาระผู้ดูแลให้ครบทั้ง 5 ข้อ';
    }
  }
  return null;
}
