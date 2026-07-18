/**
 * screens/patients-list.js
 * รายชื่อผู้ป่วย — Search + Filter (สถานะ/กลุ่ม ADL/ระดับความเสี่ยง) + Pagination ผ่าน action patients.list จริง
 * backend กรอง ownership ให้อัตโนมัติอยู่แล้ว (CG/CM เห็นเฉพาะที่รับผิดชอบ) — หน้านี้ไม่ต้องกรองซ้ำฝั่ง client
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import { renderListSkeleton, renderPagination, renderEmptyState, escapeHtml } from '../ui.js';
import { PATIENT_STATUS_OPTIONS, RISK_LEVEL_OPTIONS, ADL_GROUP_OPTIONS, riskBadgeClass, statusBadgeClass } from '../constants.js';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

/** @param {HTMLElement} content */
export async function renderPatientsList(content) {
  const canCreate = hasRole('ADMIN', 'CM');
  const state = { search: '', status: '', adlGroup: '', riskLevel: '', page: 1, pageSize: PAGE_SIZE };
  let searchDebounceTimer = null;

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-bold text-slate-800">ผู้ป่วย</h1>
        ${canCreate ? '<a href="#/patients/new" class="px-3 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium">+ เพิ่มผู้ป่วย</a>' : ''}
      </div>

      <div class="bg-white rounded-2xl flat-card p-3 mb-4 space-y-2">
        <input id="pl-search" type="text" placeholder="ค้นหาชื่อ, HN, หมู่บ้าน หรือเลขบัตร 13 หลัก"
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        <div class="grid grid-cols-3 gap-2">
          <select id="pl-status" class="px-2 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">สถานะทั้งหมด</option>
            ${PATIENT_STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
          </select>
          <select id="pl-adlgroup" class="px-2 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">กลุ่ม ADL ทั้งหมด</option>
            ${ADL_GROUP_OPTIONS.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
          </select>
          <select id="pl-risk" class="px-2 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">ความเสี่ยงทั้งหมด</option>
            ${RISK_LEVEL_OPTIONS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="pl-results"></div>
      <div id="pl-pagination"></div>
    </div>
  `;

  const resultsEl = content.querySelector('#pl-results');
  const paginationEl = content.querySelector('#pl-pagination');
  const searchInput = content.querySelector('#pl-search');
  const statusSelect = content.querySelector('#pl-status');
  const adlGroupSelect = content.querySelector('#pl-adlgroup');
  const riskSelect = content.querySelector('#pl-risk');

  async function loadList() {
    renderListSkeleton(resultsEl, 4);
    paginationEl.innerHTML = '';
    const data = await apiCall('patients.list', {
      search: state.search,
      status: state.status,
      adlGroup: state.adlGroup,
      riskLevel: state.riskLevel,
      page: state.page,
      pageSize: state.pageSize
    });
    renderResults(resultsEl, data.items);
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

  statusSelect.addEventListener('change', () => { state.status = statusSelect.value; state.page = 1; loadList(); });
  adlGroupSelect.addEventListener('change', () => { state.adlGroup = adlGroupSelect.value; state.page = 1; loadList(); });
  riskSelect.addEventListener('change', () => { state.riskLevel = riskSelect.value; state.page = 1; loadList(); });

  await loadList();
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} items
 */
function renderResults(container, items) {
  if (!items || items.length === 0) {
    renderEmptyState(container, {
      title: 'ไม่พบผู้ป่วยที่ตรงกับเงื่อนไขนี้',
      message: 'ลองปรับคำค้นหาหรือตัวกรองดูอีกครั้ง'
    });
    return;
  }

  container.innerHTML = items.map((p, i) => `
    <a href="#/patients/${encodeURIComponent(p.patientId)}" class="flat-card flat-card-interactive animate-rise-in block bg-white rounded-2xl p-4 mb-3 active:bg-slate-50" style="--delay:${Math.min(i, 8) * 40}ms">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(p.name)}</p>
          <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(p.hn)} · อายุ ${p.age ?? '-'} ปี · ${escapeHtml(p.village || '-')}</p>
        </div>
        <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
      </div>
      <div class="flex items-center gap-2 mt-2">
        ${p.riskLevel ? `<span class="text-xs font-medium px-2 py-0.5 rounded-full ${riskBadgeClass(p.riskLevel)}">ความเสี่ยง ${escapeHtml(p.riskLevel)}</span>` : ''}
        ${p.adlGroup ? `<span class="text-xs text-slate-400">${escapeHtml(p.adlGroup)}</span>` : ''}
      </div>
    </a>
  `).join('');
}
