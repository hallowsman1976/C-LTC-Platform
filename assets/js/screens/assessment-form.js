/**
 * screens/assessment-form.js
 * ฟอร์มแบบประเมินเดี่ยว (ทำนอกรอบการเยี่ยมบ้าน) ทั้ง 6 ชนิด ตาม BLUEPRINT.md §4
 * route: /assessments/:patientId/:type
 *
 * ความสัมพันธ์กับฟอร์มเยี่ยมบ้าน: แบบประเมินชุดเดียวกันนี้กรอกได้จากสองทาง — ระหว่างเยี่ยมบ้าน (visit-form-steps.js
 * ส่งพร้อม visitId ผ่าน offline/visit-submit.js) และแบบเดี่ยวจากหน้านี้ (ไม่มี visitId) payload/action ปลายทาง
 * เป็นตัวเดียวกันเป๊ะ ต่างกันแค่ visitId เท่านั้น
 *
 * กติกาที่ยึดตาม backend (Assessments.gs / DepressionAssessment.gs):
 * - backend คำนวณคะแนน/แปลผลเองเสมอ หน้านี้จึงส่งแค่ "คำตอบดิบ" ไม่ส่ง totalScore/verdict
 *   (ที่โชว์สรุปคะแนนสดในหน้าเป็นแค่ preview ให้ผู้กรอกเห็นภาพ ไม่ใช่ค่าที่เก็บจริง)
 * - ทุก action บังคับมี requestId เพื่อกันบันทึกซ้ำ — สร้างครั้งเดียวตอนเปิดฟอร์มแล้วใช้ค่าเดิมทุกครั้งที่กดส่ง
 *   ถ้ากดส่งแล้วเน็ตหลุดจนไม่รู้ผล กดซ้ำได้ปลอดภัย backend จะคืนผลเดิมไม่สร้างแถวใหม่
 */
import { apiCall, ApiError, NetworkError } from '../api.js';
import { enqueueSync } from '../offline/db.js';
import { renderCardSkeleton, showToast, escapeHtml } from '../ui.js';
import {
  card, sectionTitle, segmentedChoice, yesNoToggle,
  wireSegmented, wireYesNo
} from '../form-widgets.js';
import { renderInhomesssStep, wireInhomesssStep } from './inhomesss-form.js';
import {
  BARTHEL_ITEMS, NINE_Q_TEXTS, EIGHT_Q_TEXTS, FALL_RISK_TEXTS, CAREGIVER_BURDEN_TEXTS,
  WOUND_STAGE_OPTIONS, countInhomesssRiskFlags
} from '../constants.js';

/**
 * นิยามแบบประเมินทั้ง 6 ชนิด — key ต้องตรงกับ payload.type ของ backend เป๊ะ (getAssessmentTypeSheetMap_)
 * kind = ตัวเลือก renderer: แบบที่โครงเหมือนกันใช้ renderer ตัวเดียวกัน (fallrisk/caregiverburden ต่างกันแค่ชุดคำถาม)
 */
export const ASSESSMENT_DEFS = {
  barthel: {
    kind: 'barthel', action: 'assessments.saveBarthel',
    title: 'Barthel ADL Index', subtitle: 'ความสามารถในการทำกิจวัตรประจำวัน 10 ด้าน'
  },
  depression: {
    kind: 'depression', action: 'assessments.saveDepression',
    title: 'ภาวะซึมเศร้า 2Q / 9Q / 8Q', subtitle: 'ประเมินต่อเป็นขั้นตามคำตอบ (2Q → 9Q → 8Q)'
  },
  fallrisk: {
    kind: 'yesno', action: 'assessments.saveFallRisk', texts: FALL_RISK_TEXTS,
    title: 'ความเสี่ยงหกล้ม', subtitle: 'คัดกรองความเสี่ยงการหกล้ม 5 ข้อ'
  },
  caregiverburden: {
    kind: 'yesno', action: 'assessments.saveCaregiverBurden', texts: CAREGIVER_BURDEN_TEXTS,
    title: 'ภาระผู้ดูแล (Caregiver Burden)', subtitle: 'ประเมินภาระของผู้ดูแลหลัก 5 ข้อ'
  },
  pressureulcer: {
    kind: 'pressureulcer', action: 'assessments.savePressureUlcer',
    title: 'ความเสี่ยงแผลกดทับ', subtitle: 'บันทึกตำแหน่ง ขนาด และระยะของแผล'
  },
  inhomesss: {
    kind: 'inhomesss', action: 'assessments.saveInhomesss',
    title: 'INHOMESSS', subtitle: 'ประเมินสิ่งแวดล้อมและบริบทที่บ้าน 9 มิติ'
  }
};

/** @return {string} idempotency key ใหม่ 1 ค่าต่อการเปิดฟอร์ม 1 ครั้ง */
function newRequestId() {
  return 'req-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
}

/**
 * @param {HTMLElement} content
 * @param {{patientId: string, type: string}} params
 */
export async function renderAssessmentForm(content, params) {
  const def = ASSESSMENT_DEFS[params.type];
  if (!def) {
    content.innerHTML = `
      <div class="flex flex-col items-center justify-center text-center py-20 px-6">
        <div class="text-4xl mb-3">❓</div>
        <h2 class="text-lg font-semibold text-slate-700 mb-1">ไม่รู้จักแบบประเมินนี้</h2>
        <a href="#/assessments" class="text-sm text-sky-600 mt-2">← กลับไปเลือกแบบประเมิน</a>
      </div>`;
    return;
  }

  content.innerHTML = `<div class="px-4 py-5 max-w-xl mx-auto"><div id="af-body"></div></div>`;
  const bodyEl = content.querySelector('#af-body');
  renderCardSkeleton(bodyEl);

  const data = await apiCall('patients.get', { patientId: params.patientId });
  const patient = data.patient;

  const state = { requestId: newRequestId(), answers: {}, submitting: false };

  bodyEl.innerHTML = `
    <nav aria-label="breadcrumb" class="flex items-center flex-wrap gap-1.5 text-xs text-slate-400 mb-3">
      <a href="#/assessments" class="hover:text-sky-600 transition">แบบประเมิน</a>
      <svg class="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      <a href="#/assessments/${encodeURIComponent(params.patientId)}" class="hover:text-sky-600 transition">${escapeHtml(patient.name)}</a>
      <svg class="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      <span class="text-slate-600 font-medium">${escapeHtml(def.title)}</span>
    </nav>
    <h1 class="text-lg font-bold text-slate-800">${escapeHtml(def.title)}</h1>
    <p class="text-xs text-slate-400 mt-0.5 mb-1">${escapeHtml(def.subtitle)}</p>
    <p class="text-xs text-slate-500 mb-4">${escapeHtml(patient.name)} · HN ${escapeHtml(patient.hn)}</p>

    <p id="af-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3"></p>
    <div id="af-fields"></div>
    <button id="af-submit" type="button" class="w-full py-3 rounded-xl accent-gradient text-white font-medium text-sm disabled:opacity-50">
      บันทึกแบบประเมิน
    </button>
  `;

  const fieldsEl = bodyEl.querySelector('#af-fields');
  const errorEl = bodyEl.querySelector('#af-error');
  const submitBtn = bodyEl.querySelector('#af-submit');

  const renderer = RENDERERS[def.kind];
  const rerender = () => renderer.render(fieldsEl, state, def, rerender);
  rerender();

  submitBtn.addEventListener('click', async () => {
    errorEl.classList.add('hidden');

    const validationError = renderer.validate(state, def);
    if (validationError) {
      errorEl.textContent = validationError;
      errorEl.classList.remove('hidden');
      return;
    }

    state.submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังบันทึก...';
    const payload = { patientId: params.patientId, requestId: state.requestId, ...renderer.buildPayload(state, def) };
    try {
      const result = await apiCall(def.action, payload);
      showToast('บันทึกแบบประเมินสำเร็จ', 'success');
      if (result && result.riskAlertTriggered) {
        showToast('ระบบส่งการแจ้งเตือนความเสี่ยงให้ทีมดูแลแล้ว', 'success');
      }
      location.hash = `/assessments/${encodeURIComponent(params.patientId)}`;
    } catch (err) {
      if (err instanceof NetworkError) {
        // ออฟไลน์/เน็ตขัดข้อง — เก็บเข้าคิวให้ sync manager ส่งซ้ำเอง (payload พก requestId เดิมไปด้วย
        // ถ้าที่จริงคำขอถึง backend แล้วแต่ตอบกลับไม่ถึงเรา การส่งซ้ำจะได้ผลเดิมไม่เกิดแถวซ้ำ)
        await enqueueSync({
          clientTempId: state.requestId, patientId: params.patientId, kind: 'assessment',
          action: def.action, payload, title: def.title,
          status: 'pending', createdAt: new Date().toISOString()
        });
        showToast('คุณออฟไลน์อยู่ — บันทึกแบบประเมินไว้ในเครื่องแล้ว ระบบจะซิงค์ให้อัตโนมัติเมื่อกลับมาออนไลน์', 'warning');
        location.hash = `/assessments/${encodeURIComponent(params.patientId)}`;
        return;
      }
      // ApiError (validation/สิทธิ์) — ส่งซ้ำอีกกี่ครั้งก็ไม่ผ่าน ต้องให้ผู้ใช้แก้ก่อน จึงไม่เข้าคิวและคาหน้าไว้
      errorEl.textContent = err instanceof ApiError && err.message ? err.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      state.submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'บันทึกแบบประเมิน';
    }
  });
}

/** แถบสรุปคะแนนสด — เป็นแค่ preview ฝั่ง client เท่านั้น ค่าที่บันทึกจริงมาจากการคำนวณของ backend */
function livePreview(text) {
  return `<div class="bg-sky-50 text-sky-700 text-xs rounded-xl px-3 py-2 mb-3">${escapeHtml(text)} <span class="text-sky-400">(ผลจริงคำนวณที่เซิร์ฟเวอร์)</span></div>`;
}

/* ============================================================
 * Renderer แต่ละตระกูล — signature เดียวกันหมด:
 *   render(container, state, def, rerender) / validate(state, def) → string|null / buildPayload(state, def) → Object
 * ============================================================ */

/** ใช่/ไม่ใช่ N ข้อ นับจำนวน "ใช่" (fallrisk, caregiverburden) — ตรงกับ computeSimpleScaleScore_ ฝั่ง backend */
const yesNoRenderer = {
  render(container, state, def, rerender) {
    const answered = def.texts.filter((_, i) => typeof state.answers[`q${i + 1}`] === 'boolean').length;
    const yesCount = def.texts.filter((_, i) => state.answers[`q${i + 1}`] === true).length;
    container.innerHTML = `
      ${livePreview(`ตอบแล้ว ${answered}/${def.texts.length} ข้อ · พบความเสี่ยง ${yesCount} ข้อ`)}
      ${card(`
        ${sectionTitle(def.title)}
        <div class="space-y-3">
          ${def.texts.map((text, i) => `
            <div>
              <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
              ${yesNoToggle({ name: `q${i + 1}`, value: state.answers[`q${i + 1}`] })}
            </div>
          `).join('')}
        </div>
      `)}
    `;
    def.texts.forEach((_, i) => {
      wireYesNo(container, `q${i + 1}`, (value) => {
        state.answers[`q${i + 1}`] = value;
        rerender();
      });
    });
  },
  validate(state, def) {
    for (let i = 1; i <= def.texts.length; i++) {
      if (typeof state.answers[`q${i}`] !== 'boolean') return `กรุณาตอบข้อ ${i} ให้ครบทุกข้อ`;
    }
    return null;
  },
  buildPayload(state) {
    return { answers: state.answers };
  }
};

/** Barthel ADL — 10 ข้อ ข้อละ 0..max ตาม BARTHEL_ITEMS (key/max ตรงกับ BARTHEL_DEFS_ ฝั่ง backend) */
const barthelRenderer = {
  render(container, state, def, rerender) {
    const total = BARTHEL_ITEMS.reduce((sum, item) => sum + (state.answers[item.key] || 0), 0);
    const answered = BARTHEL_ITEMS.filter((item) => typeof state.answers[item.key] === 'number').length;
    const group = total >= 12 ? 'ติดสังคม' : (total >= 5 ? 'ติดบ้าน' : 'ติดเตียง');
    container.innerHTML = `
      ${livePreview(`ตอบแล้ว ${answered}/${BARTHEL_ITEMS.length} ข้อ · คะแนนรวม ${total}/20 · ${group}`)}
      ${card(`
        ${sectionTitle('Barthel ADL Index')}
        <div class="space-y-4">
          ${BARTHEL_ITEMS.map((item, i) => `
            <div>
              <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(item.label)}</p>
              ${segmentedChoice({ name: item.key, options: item.options, selectedValue: state.answers[item.key] })}
            </div>
          `).join('')}
        </div>
      `)}
    `;
    BARTHEL_ITEMS.forEach((item) => {
      wireSegmented(container, item.key, (value) => {
        state.answers[item.key] = value;
        rerender();
      });
    });
  },
  validate(state) {
    const missing = BARTHEL_ITEMS.find((item) => typeof state.answers[item.key] !== 'number');
    return missing ? `กรุณาเลือกคำตอบข้อ "${missing.label}"` : null;
  },
  buildPayload(state) {
    return { answers: state.answers };
  }
};

/**
 * INHOMESSS — ฟอร์มเต็มตามแบบฟอร์มมาตรฐาน (แยกไปอยู่ inhomesss-form.js เพราะใช้ร่วมกับ visit-form-steps.js
 * ขั้นตอนที่ 4 ด้วย) ไม่มีข้อบังคับต้องตอบครบ — เป็นเอกสารบันทึกอิสระ ไม่ใช่เครื่องมือให้คะแนนแบบ Barthel/9Q
 * แถบสรุปด้านบนเป็น "ธงความเสี่ยง" ที่ระบบไล่ตรวจเอง ไม่ใช่คะแนนมาตรฐานทางคลินิก (ดู countInhomesssRiskFlags)
 */
const inhomesssRenderer = {
  render(container, state, def, rerender) {
    if (typeof state.inhomesssStep !== 'number') state.inhomesssStep = 0;
    const riskCount = countInhomesssRiskFlags(state.answers);
    const bannerText = riskCount === 0 ? 'ยังไม่พบข้อบ่งชี้ความเสี่ยงจากคำตอบที่กรอกไว้' : `พบข้อบ่งชี้ความเสี่ยง ${riskCount} รายการ`;
    container.innerHTML = `
      ${livePreview(bannerText)}
      ${renderInhomesssStep(state.answers, state.inhomesssStep)}
    `;
    wireInhomesssStep(container, state.answers, state.inhomesssStep, {
      onChange: (domain, patch, opts) => {
        state.answers[domain] = { ...(state.answers[domain] || {}), ...patch };
        if (opts.rerender) rerender();
      },
      onNavigate: (nextStep) => {
        state.inhomesssStep = nextStep;
        rerender();
      }
    });
  },
  validate() {
    return null;
  },
  buildPayload(state) {
    return { answers: state.answers };
  }
};

/** ความเสี่ยงแผลกดทับ — ถ้า hasWound=true ต้องระบุ stage (backend ตรวจ ENUM_WOUND_STAGE_ ซ้ำอีกชั้น) */
const pressureUlcerRenderer = {
  render(container, state, def, rerender) {
    const w = state.answers;
    container.innerHTML = `
      ${card(`
        ${sectionTitle('ความเสี่ยงแผลกดทับ')}
        <p class="text-xs text-slate-600 mb-1.5">พบแผลกดทับหรือไม่</p>
        ${yesNoToggle({ name: 'haswound', value: w.hasWound, yesLabel: 'พบแผล', noLabel: 'ไม่พบแผล' })}
        ${w.hasWound === true ? `
          <div class="mt-4 space-y-3">
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">ตำแหน่งแผล</label>
              <input id="af-pu-location" type="text" value="${escapeHtml(w.location || '')}" placeholder="เช่น ก้นกบ, สะโพกขวา"
                class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">ขนาดแผล</label>
              <input id="af-pu-size" type="text" value="${escapeHtml(w.size || '')}" placeholder="เช่น 2x3 ซม."
                class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <p class="text-xs font-medium text-slate-500 mb-1.5">ระยะของแผล (Stage) *</p>
              ${segmentedChoice({
                name: 'stage',
                options: WOUND_STAGE_OPTIONS.map((s) => ({ v: s, l: 'ระยะ ' + s })),
                selectedValue: w.stage
              })}
              <p class="text-xs text-slate-400 mt-1.5">ระยะ 3 หรือ 4 ระบบจะแจ้งเตือนทีมดูแลอัตโนมัติ</p>
            </div>
          </div>
        ` : ''}
      `)}
    `;
    wireYesNo(container, 'haswound', (value) => {
      state.answers = value ? { ...state.answers, hasWound: true } : { hasWound: false };
      rerender();
    });
    wireSegmented(container, 'stage', (value) => {
      state.answers.stage = String(value);
      rerender();
    });
    const locationEl = container.querySelector('#af-pu-location');
    if (locationEl) locationEl.addEventListener('input', (e) => { state.answers.location = e.target.value; });
    const sizeEl = container.querySelector('#af-pu-size');
    if (sizeEl) sizeEl.addEventListener('input', (e) => { state.answers.size = e.target.value; });
  },
  validate(state) {
    if (typeof state.answers.hasWound !== 'boolean') return 'กรุณาระบุว่าพบแผลกดทับหรือไม่';
    if (state.answers.hasWound && !WOUND_STAGE_OPTIONS.includes(String(state.answers.stage || ''))) {
      return 'กรุณาเลือกระยะ (Stage) ของแผลกดทับ';
    }
    return null;
  },
  buildPayload(state) {
    const w = state.answers;
    if (!w.hasWound) return { hasWound: false };
    return { hasWound: true, location: w.location || '', size: w.size || '', stage: String(w.stage) };
  }
};

/**
 * 2Q → 9Q → 8Q แบบมีเงื่อนไข — ต้องตรงกับ gating ของ computeDepressionChain_ เป๊ะ
 * 2Q ตอบ "ไม่มี" ทั้ง 2 ข้อ → จบ / ไม่งั้นต้องตอบ 9Q ครบ / 9Q ข้อ 9 > 0 → ต้องตอบ 8Q ครบด้วย
 */
const NINE_Q_OPTIONS = [
  { v: 0, l: 'ไม่มีเลย' }, { v: 1, l: 'เป็นบางวัน' }, { v: 2, l: 'เป็นบ่อย' }, { v: 3, l: 'เป็นทุกวัน' }
];

const depressionRenderer = {
  showNineQ(state) {
    const t = state.answers.twoQ || {};
    return typeof t.q1 === 'boolean' && typeof t.q2 === 'boolean' && !(t.q1 === false && t.q2 === false);
  },
  showEightQ(state) {
    return this.showNineQ(state) && ((state.answers.nineQ || {}).q9 || 0) > 0;
  },
  render(container, state, def, rerender) {
    const twoQ = state.answers.twoQ || {};
    const nineQ = state.answers.nineQ || {};
    const eightQ = state.answers.eightQ || {};
    const showNineQ = this.showNineQ(state);
    const showEightQ = this.showEightQ(state);
    const nineQTotal = NINE_Q_TEXTS.reduce((sum, _, i) => sum + (nineQ[`q${i + 1}`] || 0), 0);
    const eightQCount = EIGHT_Q_TEXTS.filter((_, i) => eightQ[`q${i + 1}`] === true).length;

    container.innerHTML = `
      ${card(`
        ${sectionTitle('2Q — คัดกรองเบื้องต้น')}
        <div class="space-y-3">
          <div>
            <p class="text-xs text-slate-600 mb-1.5">1. ใน 2 สัปดาห์ที่ผ่านมา รู้สึกหดหู่ เศร้า หรือท้อแท้สิ้นหวังหรือไม่</p>
            ${yesNoToggle({ name: '2q-q1', value: twoQ.q1, yesLabel: 'มี', noLabel: 'ไม่มี' })}
          </div>
          <div>
            <p class="text-xs text-slate-600 mb-1.5">2. ใน 2 สัปดาห์ที่ผ่านมา รู้สึกเบื่อ ทำอะไรก็ไม่เพลิดเพลินหรือไม่</p>
            ${yesNoToggle({ name: '2q-q2', value: twoQ.q2, yesLabel: 'มี', noLabel: 'ไม่มี' })}
          </div>
        </div>
        ${twoQ.q1 === false && twoQ.q2 === false
          ? '<p class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mt-3">ตอบ "ไม่มี" ทั้ง 2 ข้อ — ไม่ต้องประเมิน 9Q ต่อ บันทึกได้เลย</p>'
          : ''}
      `)}

      ${showNineQ ? card(`
        ${sectionTitle('9Q — ประเมินความรุนแรง')}
        ${livePreview(`คะแนนรวม 9Q = ${nineQTotal}`)}
        <div class="space-y-4">
          ${NINE_Q_TEXTS.map((text, i) => `
            <div>
              <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
              ${segmentedChoice({ name: `9q-q${i + 1}`, options: NINE_Q_OPTIONS, selectedValue: nineQ[`q${i + 1}`] })}
            </div>
          `).join('')}
        </div>
      `) : ''}

      ${showEightQ ? card(`
        ${sectionTitle('8Q — ประเมินความเสี่ยงฆ่าตัวตาย')}
        <p class="text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2 mb-3">
          ผู้ป่วยตอบ 9Q ข้อ 9 มากกว่า 0 คะแนน — ต้องประเมิน 8Q ต่อ และระบบจะแจ้งเตือนทีมดูแลทันทีเมื่อบันทึก
        </p>
        ${livePreview(`ตอบ "ใช่" ${eightQCount} ข้อ`)}
        <div class="space-y-3">
          ${EIGHT_Q_TEXTS.map((text, i) => `
            <div>
              <p class="text-xs text-slate-600 mb-1.5">${i + 1}. ${escapeHtml(text)}</p>
              ${yesNoToggle({ name: `8q-q${i + 1}`, value: eightQ[`q${i + 1}`] })}
            </div>
          `).join('')}
        </div>
      `) : ''}
    `;

    [1, 2].forEach((n) => {
      wireYesNo(container, `2q-q${n}`, (value) => {
        state.answers.twoQ = { ...(state.answers.twoQ || {}), [`q${n}`]: value };
        rerender();
      });
    });
    NINE_Q_TEXTS.forEach((_, i) => {
      wireSegmented(container, `9q-q${i + 1}`, (value) => {
        state.answers.nineQ = { ...(state.answers.nineQ || {}), [`q${i + 1}`]: value };
        rerender();
      });
    });
    EIGHT_Q_TEXTS.forEach((_, i) => {
      wireYesNo(container, `8q-q${i + 1}`, (value) => {
        state.answers.eightQ = { ...(state.answers.eightQ || {}), [`q${i + 1}`]: value };
        rerender();
      });
    });
  },
  validate(state) {
    const twoQ = state.answers.twoQ || {};
    if (typeof twoQ.q1 !== 'boolean' || typeof twoQ.q2 !== 'boolean') return 'กรุณาตอบแบบประเมิน 2Q ให้ครบทั้ง 2 ข้อ';
    if (!this.showNineQ(state)) return null;

    const nineQ = state.answers.nineQ || {};
    for (let i = 1; i <= NINE_Q_TEXTS.length; i++) {
      if (typeof nineQ[`q${i}`] !== 'number') return `กรุณาตอบแบบประเมิน 9Q ข้อ ${i}`;
    }
    if (!this.showEightQ(state)) return null;

    const eightQ = state.answers.eightQ || {};
    for (let j = 1; j <= EIGHT_Q_TEXTS.length; j++) {
      if (typeof eightQ[`q${j}`] !== 'boolean') return `กรุณาตอบแบบประเมิน 8Q ข้อ ${j}`;
    }
    return null;
  },
  buildPayload(state) {
    const payload = { twoQAnswers: state.answers.twoQ };
    // ส่งเฉพาะส่วนที่เงื่อนไขบังคับจริง — ถ้า 2Q ตอบไม่มีทั้งคู่แล้วยังส่ง 9Q ที่ค้างอยู่จากตอนกดเล่นไปด้วย
    // backend จะเก็บ 9Q นั้นลงชีตทั้งที่ chain ไม่ควรมี (computeDepressionChain_ คืนตั้งแต่ twoQBothNo)
    if (this.showNineQ(state)) payload.nineQAnswers = state.answers.nineQ;
    if (this.showEightQ(state)) payload.eightQAnswers = state.answers.eightQ;
    return payload;
  }
};

const RENDERERS = {
  yesno: yesNoRenderer,
  barthel: barthelRenderer,
  inhomesss: inhomesssRenderer,
  pressureulcer: pressureUlcerRenderer,
  depression: depressionRenderer
};
