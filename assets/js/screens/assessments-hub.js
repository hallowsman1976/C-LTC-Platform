/**
 * screens/assessments-hub.js
 * ศูนย์รวมแบบประเมิน ตาม BLUEPRINT.md §4 — สองระดับ
 *   /assessments              → เลือกผู้ป่วยก่อน (backend ไม่มี action list แบบประเมินข้ามผู้ป่วย ทุก action
 *                               ผูกกับ patientId เสมอ — assessments.listByPatient) จึงต้องเลือกผู้ป่วยเป็นขั้นแรก
 *   /assessments/:patientId   → เมนูแบบประเมิน 6 ชนิดของผู้ป่วยรายนั้น + ประวัติที่เคยประเมิน
 *
 * VIEWER เข้าดูได้ (assessments.listByPatient อนุญาต) แต่กดเข้าฟอร์มไม่ได้ — backend ปฏิเสธการบันทึกของ VIEWER
 * อยู่แล้ว (resolveAssessmentContext_) หน้านี้จึงซ่อนปุ่มให้ตรงกันไม่ให้กดแล้วเจอ error เปล่า ๆ
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import { renderListSkeleton, renderCardSkeleton, renderEmptyState, renderPagination, escapeHtml } from '../ui.js';
import { ASSESSMENT_DEFS } from './assessment-form.js';
import { formatThaiDateTime } from '../date-picker.js';
import { statusBadgeClass } from '../constants.js';

const PATIENT_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

/* ============================================================
 * /assessments — เลือกผู้ป่วย
 * ============================================================ */

/** @param {HTMLElement} content */
export async function renderAssessmentsHub(content) {
  const state = { search: '', page: 1 };
  let searchDebounceTimer = null;

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl">
      <h1 class="text-lg font-bold text-slate-800 mb-1">แบบประเมิน</h1>
      <p class="text-xs text-slate-400 mb-4">เลือกผู้ป่วยที่ต้องการประเมิน แล้วจึงเลือกชนิดแบบประเมิน</p>

      <div class="bg-white rounded-2xl shadow-sm p-3 mb-4">
        <input id="ah-search" type="text" placeholder="ค้นหาชื่อ, HN, หมู่บ้าน หรือเลขบัตร 13 หลัก"
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
      </div>

      <div id="ah-results"></div>
      <div id="ah-pagination"></div>
    </div>
  `;

  const resultsEl = content.querySelector('#ah-results');
  const paginationEl = content.querySelector('#ah-pagination');
  const searchInput = content.querySelector('#ah-search');

  async function loadList() {
    renderListSkeleton(resultsEl, 4);
    paginationEl.innerHTML = '';
    const data = await apiCall('patients.list', { search: state.search, page: state.page, pageSize: PATIENT_PAGE_SIZE });

    if (!data.items || data.items.length === 0) {
      renderEmptyState(resultsEl, {
        title: 'ไม่พบผู้ป่วยที่ตรงกับเงื่อนไขนี้',
        message: 'ลองปรับคำค้นหาดูอีกครั้ง'
      });
      return;
    }

    resultsEl.innerHTML = data.items.map((p) => `
      <a href="#/assessments/${encodeURIComponent(p.patientId)}" class="block bg-white rounded-2xl shadow-sm p-4 mb-3 active:bg-slate-50">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(p.name)}</p>
            <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(p.hn)} · อายุ ${p.age ?? '-'} ปี · ${escapeHtml(p.village || '-')}</p>
          </div>
          <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
        </div>
      </a>
    `).join('');

    renderPagination(paginationEl, { page: data.page, pageSize: data.pageSize, total: data.total }, (nextPage) => {
      state.page = nextPage;
      loadList();
    });
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      loadList();
    }, SEARCH_DEBOUNCE_MS);
  });

  await loadList();
}

/* ============================================================
 * /assessments/:patientId — เมนูแบบประเมิน + ประวัติของผู้ป่วยรายนี้
 * ============================================================ */

/**
 * @param {HTMLElement} content
 * @param {{patientId: string}} params
 */
export async function renderPatientAssessments(content, params) {
  const canAssess = hasRole('ADMIN', 'CM', 'CG');
  const historyState = { page: 1 };

  content.innerHTML = `<div class="px-4 py-5 max-w-3xl"><div id="pa-body"></div></div>`;
  const bodyEl = content.querySelector('#pa-body');
  renderCardSkeleton(bodyEl);

  const data = await apiCall('patients.get', { patientId: params.patientId });
  const patient = data.patient;

  bodyEl.innerHTML = `
    <a href="#/assessments" class="text-sm text-sky-600 mb-3 inline-block">← เลือกผู้ป่วยคนอื่น</a>
    <h1 class="text-lg font-bold text-slate-800">${escapeHtml(patient.name)}</h1>
    <p class="text-xs text-slate-400 mt-0.5 mb-4">HN ${escapeHtml(patient.hn)} · อายุ ${patient.age ?? '-'} ปี</p>

    ${canAssess ? `
      <p class="text-sm font-semibold text-slate-700 mb-2">เลือกแบบประเมิน</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        ${Object.entries(ASSESSMENT_DEFS).map(([type, def]) => `
          <a href="#/assessments/${encodeURIComponent(params.patientId)}/${encodeURIComponent(type)}"
            class="block bg-white rounded-2xl shadow-sm p-4 active:bg-slate-50">
            <p class="text-sm font-semibold text-slate-800">${escapeHtml(def.title)}</p>
            <p class="text-xs text-slate-400 mt-1">${escapeHtml(def.subtitle)}</p>
          </a>
        `).join('')}
      </div>
    ` : `
      <p class="text-xs text-slate-500 bg-slate-100 rounded-xl px-3 py-2 mb-6">
        บทบาทของคุณดูผลแบบประเมินได้อย่างเดียว ไม่สามารถบันทึกแบบประเมินใหม่ได้
      </p>
    `}

    <p class="text-sm font-semibold text-slate-700 mb-2">ประวัติแบบประเมิน</p>
    <div id="pa-history"></div>
    <div id="pa-history-pagination"></div>
  `;

  const historyEl = bodyEl.querySelector('#pa-history');
  const historyPaginationEl = bodyEl.querySelector('#pa-history-pagination');

  async function loadHistory() {
    renderListSkeleton(historyEl, 3);
    historyPaginationEl.innerHTML = '';
    const result = await apiCall('assessments.listByPatient', {
      patientId: params.patientId, page: historyState.page, pageSize: HISTORY_PAGE_SIZE
    });

    if (!result.items || result.items.length === 0) {
      renderEmptyState(historyEl, {
        title: 'ยังไม่มีประวัติแบบประเมิน',
        message: canAssess ? 'เลือกแบบประเมินด้านบนเพื่อเริ่มประเมินครั้งแรก' : 'ผู้ป่วยรายนี้ยังไม่เคยถูกประเมิน'
      });
      return;
    }

    historyEl.innerHTML = result.items.map((item) => `
      <a href="#/assessments/${encodeURIComponent(params.patientId)}/${encodeURIComponent(item.type)}/${encodeURIComponent(item.assessmentId)}"
        class="block bg-white rounded-2xl shadow-sm p-4 mb-3 active:bg-slate-50">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-800">${escapeHtml(assessmentTitle(item.type))}</p>
            <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(formatThaiDateTime(item.createdAt))}${item.visitId ? ' · จากการเยี่ยมบ้าน' : ' · ประเมินเดี่ยว'}</p>
          </div>
          <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(summarizeResult(item))}</span>
        </div>
      </a>
    `).join('');

    renderPagination(historyPaginationEl, { page: result.page, pageSize: result.pageSize, total: result.total }, (nextPage) => {
      historyState.page = nextPage;
      loadHistory();
    });
  }

  await loadHistory();
}

/** @param {string} type @return {string} */
function assessmentTitle(type) {
  return ASSESSMENT_DEFS[type] ? ASSESSMENT_DEFS[type].title : type;
}

/**
 * สรุปผลสั้น ๆ ของแต่ละแถวประวัติ — แต่ละชนิดคืน field ไม่เหมือนกัน (ดู sanitize*ForClient_ ฝั่ง backend):
 * barthel มี group, pressureulcer ไม่มี score เลย, ที่เหลือมี verdict
 * @param {Object} item
 * @return {string}
 */
function summarizeResult(item) {
  if (item.type === 'barthel') return `${item.totalScore}/20 · ${item.group || '-'}`;
  if (item.type === 'pressureulcer') return item.hasWound ? `พบแผล ระยะ ${item.stage || '-'}` : 'ไม่พบแผล';
  if (item.type === 'depression') {
    if (item.eightQVerdict) return item.eightQVerdict;
    if (item.nineQTotal !== null && item.nineQTotal !== undefined) return `9Q = ${item.nineQTotal}`;
    return 'ไม่มีความเสี่ยง (2Q)';
  }
  return item.verdict || '-';
}

