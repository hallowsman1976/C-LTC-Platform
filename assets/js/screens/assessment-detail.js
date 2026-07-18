/**
 * screens/assessment-detail.js
 * ดูผลแบบประเมินย้อนหลังรายรายการ (อ่านอย่างเดียว) — route: /assessments/:patientId/:type/:assessmentId
 *
 * VIEWER เข้าดูได้ (assessments.get อนุญาต ADMIN/CM/CG/VIEWER) หน้านี้จึงไม่จำกัด role
 * แก้ไขผลย้อนหลังไม่ได้โดยตั้งใจ — backend ไม่มี action แก้แบบประเมิน มีแต่ save (สร้างแถวใหม่) ประวัติจึงเป็น
 * append-only ตลอด ถ้าประเมินผิดต้องประเมินใหม่แล้วยึดผลล่าสุดแทน
 *
 * แต่ละชนิดคืน field ไม่เหมือนกัน (ดู sanitize*ForClient_ ใน Assessments.gs) จึงต้องแยก renderer ตาม kind
 * เหมือนฝั่งฟอร์ม — barthel มี group, pressureulcer ไม่มีคะแนนเลย, depression มี 3 ชั้น, ที่เหลือมี verdict
 */
import { apiCall } from '../api.js';
import { renderCardSkeleton, escapeHtml } from '../ui.js';
import { card, sectionTitle, answerRow } from '../form-widgets.js';
import { formatThaiDateTime } from '../date-picker.js';
import { ASSESSMENT_DEFS } from './assessment-form.js';
import { renderInhomesssDetail } from './inhomesss-form.js';
import {
  BARTHEL_ITEMS, NINE_Q_TEXTS, EIGHT_Q_TEXTS, FALL_RISK_TEXTS, CAREGIVER_BURDEN_TEXTS, countInhomesssRiskFlags
} from '../constants.js';

/** ชุดคำถามของแบบ yes/no แต่ละชนิด — ใช้แปลง key q1..qN กลับเป็นข้อความคำถามตอนแสดงผล */
const YES_NO_TEXTS = {
  fallrisk: FALL_RISK_TEXTS,
  caregiverburden: CAREGIVER_BURDEN_TEXTS
};

/**
 * @param {HTMLElement} content
 * @param {{patientId: string, type: string, assessmentId: string}} params
 */
export async function renderAssessmentDetail(content, params) {
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

  content.innerHTML = `<div class="px-4 py-5 max-w-xl mx-auto"><div id="ad-body"></div></div>`;
  const bodyEl = content.querySelector('#ad-body');
  renderCardSkeleton(bodyEl);

  const [assessmentData, patientData] = await Promise.all([
    apiCall('assessments.get', { type: params.type, assessmentId: params.assessmentId }),
    apiCall('patients.get', { patientId: params.patientId })
  ]);
  const assessment = assessmentData.assessment;
  const patient = patientData.patient;

  bodyEl.innerHTML = `
    <nav aria-label="breadcrumb" class="flex items-center flex-wrap gap-1.5 text-xs text-slate-400 mb-3">
      <a href="#/assessments" class="hover:text-sky-600 transition">แบบประเมิน</a>
      <svg class="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      <a href="#/assessments/${encodeURIComponent(params.patientId)}" class="hover:text-sky-600 transition">${escapeHtml(patient.name)}</a>
      <svg class="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      <span class="text-slate-600 font-medium">${escapeHtml(def.title)}</span>
    </nav>
    <h1 class="text-lg font-bold text-slate-800">${escapeHtml(def.title)}</h1>
    <p class="text-xs text-slate-400 mt-0.5 mb-1">
      ${escapeHtml(formatThaiDateTime(assessment.createdAt))}${assessment.visitId ? ' · บันทึกจากการเยี่ยมบ้าน' : ' · ประเมินเดี่ยว'}
    </p>
    <p class="text-xs text-slate-500 mb-4">${escapeHtml(patient.name)} · HN ${escapeHtml(patient.hn)}</p>

    ${DETAIL_RENDERERS[def.kind](assessment, params.type)}

    <p class="text-xs text-slate-400 mt-1">
      ผลที่บันทึกแล้วแก้ไขไม่ได้ — หากต้องการปรับปรุงให้ประเมินใหม่อีกครั้ง ระบบจะยึดผลล่าสุดเป็นหลัก
    </p>
  `;
}

/* ============================================================
 * ชิ้นส่วนแสดงผลที่ใช้ซ้ำ
 * ============================================================ */

/** แถบสรุปผลรวมด้านบนสุดของแต่ละชนิด */
function resultBanner(text, tone = 'sky') {
  const toneClass = {
    sky: 'bg-sky-50 text-sky-700', rose: 'bg-rose-50 text-rose-700',
    emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800'
  }[tone];
  return `<div class="${toneClass} text-sm font-medium rounded-xl px-3 py-2.5 mb-3">${escapeHtml(text)}</div>`;
}

/** @param {string} verdict @return {string} โทนสีตามระดับความเสี่ยงที่ backend แปลผลมา */
function verdictTone(verdict) {
  if (!verdict) return 'sky';
  if (verdict.includes('สูง') || verdict.includes('เร่งด่วน')) return 'rose';
  if (verdict.includes('ต่ำ') || verdict === 'ปกติ' || verdict.includes('ไม่มีความเสี่ยง')) return 'emerald';
  return 'sky';
}

/* ============================================================
 * Renderer ตาม kind — signature: (assessment, type) => html string
 * ============================================================ */

const DETAIL_RENDERERS = {
  barthel(a) {
    return `
      ${resultBanner(`คะแนนรวม ${a.totalScore}/20 · ${a.group || '-'}`)}
      ${card(`
        ${sectionTitle('คำตอบรายข้อ')}
        ${BARTHEL_ITEMS.map((item) => {
          const value = a.answers ? a.answers[item.key] : undefined;
          const option = (item.options || []).find((o) => o.v === value);
          return answerRow(item.label, option ? `${value} — ${option.l}` : '-');
        }).join('')}
      `)}
    `;
  },

  yesno(a, type) {
    const texts = YES_NO_TEXTS[type] || [];
    return `
      ${resultBanner(`พบความเสี่ยง ${a.totalScore} ข้อ · ${a.verdict || '-'}`, verdictTone(a.verdict))}
      ${card(`
        ${sectionTitle('คำตอบรายข้อ')}
        ${texts.map((text, i) => {
          const value = a.answers ? a.answers[`q${i + 1}`] : undefined;
          return answerRow(`${i + 1}. ${text}`, value === true ? 'ใช่' : 'ไม่ใช่', value === true);
        }).join('')}
      `)}
    `;
  },

  inhomesss(a) {
    const answers = a.answers || {};
    // แบบ INHOMESSS ไม่มีคะแนน/verdict ตามมาตรฐาน (ฟอร์มกระดาษไม่มีระบบให้คะแนน) — a.verdict ที่ backend
    // ส่งมาเป็นข้อความสรุปธงความเสี่ยงที่ระบบไล่ตรวจเองเท่านั้น คำนวณซ้ำฝั่ง client เผื่อ record เก่าก่อนมีฟิลด์นี้
    const riskCount = countInhomesssRiskFlags(answers);
    const verdictText = a.verdict || (riskCount === 0 ? 'ไม่พบข้อบ่งชี้ความเสี่ยงเพิ่มเติม' : `พบข้อบ่งชี้ความเสี่ยง ${riskCount} รายการ`);
    return `
      ${resultBanner(verdictText, riskCount === 0 ? 'emerald' : 'amber')}
      <p class="text-xs text-slate-400 mb-3 px-1">สรุปจากคำตอบที่กรอกไว้ ไม่ใช่คะแนนมาตรฐานทางคลินิก</p>
      ${renderInhomesssDetail(answers)}
    `;
  },

  pressureulcer(a) {
    if (!a.hasWound) {
      return resultBanner('ไม่พบแผลกดทับ', 'emerald');
    }
    const severe = a.stage === '3' || a.stage === '4';
    return `
      ${resultBanner(`พบแผลกดทับ ระยะ ${a.stage || '-'}`, severe ? 'rose' : 'sky')}
      ${card(`
        ${sectionTitle('รายละเอียดแผล')}
        ${answerRow('ตำแหน่งแผล', a.location || '-')}
        ${answerRow('ขนาดแผล', a.size || '-')}
        ${answerRow('ระยะของแผล (Stage)', a.stage || '-', severe)}
      `)}
    `;
  },

  depression(a) {
    const twoQ = a.twoQAnswers || {};
    const twoQBothNo = twoQ.q1 === false && twoQ.q2 === false;
    const hasNineQ = !!a.nineQAnswers;
    const hasEightQ = !!a.eightQAnswers;

    const banner = hasEightQ
      ? resultBanner(`8Q: ${a.eightQVerdict || '-'} (ตอบใช่ ${a.eightQTotal} ข้อ)`, verdictTone(a.eightQVerdict))
      : (hasNineQ
        ? resultBanner(`9Q คะแนนรวม ${a.nineQTotal}`, 'sky')
        : resultBanner('2Q: ไม่พบความเสี่ยง — ไม่ต้องประเมินต่อ', 'emerald'));

    return `
      ${banner}
      ${a.alertSent ? '<p class="text-xs text-rose-700 bg-rose-50 rounded-xl px-3 py-2 mb-3">ระบบได้ส่งการแจ้งเตือนความเสี่ยงให้ทีมดูแลจากผลการประเมินครั้งนี้แล้ว</p>' : ''}

      ${card(`
        ${sectionTitle('2Q — คัดกรองเบื้องต้น')}
        ${answerRow('1. รู้สึกหดหู่ เศร้า หรือท้อแท้สิ้นหวัง', twoQ.q1 === true ? 'มี' : 'ไม่มี', twoQ.q1 === true)}
        ${answerRow('2. รู้สึกเบื่อ ทำอะไรก็ไม่เพลิดเพลิน', twoQ.q2 === true ? 'มี' : 'ไม่มี', twoQ.q2 === true)}
        ${twoQBothNo ? '<p class="text-xs text-slate-400 mt-2">ตอบ "ไม่มี" ทั้ง 2 ข้อ จึงจบการประเมินที่ขั้นนี้</p>' : ''}
      `)}

      ${hasNineQ ? card(`
        ${sectionTitle(`9Q — ประเมินความรุนแรง (รวม ${a.nineQTotal})`)}
        ${NINE_Q_TEXTS.map((text, i) => {
          const value = a.nineQAnswers[`q${i + 1}`];
          return answerRow(`${i + 1}. ${text}`, `${value} คะแนน`, i === 8 && value > 0);
        }).join('')}
      `) : ''}

      ${hasEightQ ? card(`
        ${sectionTitle(`8Q — ความเสี่ยงฆ่าตัวตาย (ตอบใช่ ${a.eightQTotal} ข้อ)`)}
        ${EIGHT_Q_TEXTS.map((text, i) => {
          const value = a.eightQAnswers[`q${i + 1}`];
          return answerRow(`${i + 1}. ${text}`, value === true ? 'ใช่' : 'ไม่ใช่', value === true);
        }).join('')}
      `) : ''}
    `;
  }
};
