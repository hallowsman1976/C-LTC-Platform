/**
 * screens/visit-log-hub.js
 * เมนูหลัก "บันทึกการเยี่ยม" — เลือกผู้ป่วยก่อน แล้วพาไปหน้ารายงานเยี่ยมบ้าน (CG.2) ของผู้ป่วยรายนั้น
 * รูปแบบเดียวกับ assessments-hub.js (เลือกผู้ป่วยก่อนเพราะทุก action ผูกกับ patientId เสมอ ไม่มี list ข้ามผู้ป่วย)
 */
import { apiCall } from '../api.js';
import { renderListSkeleton, renderPagination, renderEmptyState, escapeHtml } from '../ui.js';
import { PATIENT_STATUS_OPTIONS, statusBadgeClass } from '../constants.js';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

/** @param {HTMLElement} content */
export async function renderVisitLogHub(content) {
  const state = { search: '', status: '', page: 1 };
  let searchDebounceTimer = null;

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl mx-auto">
      <h1 class="text-lg font-bold text-slate-800 mb-1">บันทึกการเยี่ยม</h1>
      <p class="text-xs text-slate-400 mb-4">เลือกผู้ป่วยที่ต้องการบันทึกการเยี่ยมบ้าน (CG.2)</p>

      <div class="flat-card bg-white rounded-2xl p-3 mb-4 space-y-2">
        <div class="relative">
          <svg class="w-[18px] h-[18px] absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>
          <input id="vlh-search" type="text" placeholder="ค้นหาชื่อ, HN, หมู่บ้าน หรือเลขบัตร 13 หลัก"
            class="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition" />
        </div>
        <select id="vlh-status" class="w-full px-2 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">สถานะทั้งหมด</option>
          ${PATIENT_STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
        </select>
      </div>

      <div id="vlh-results"></div>
      <div id="vlh-pagination"></div>
    </div>
  `;

  const resultsEl = content.querySelector('#vlh-results');
  const paginationEl = content.querySelector('#vlh-pagination');
  const searchInput = content.querySelector('#vlh-search');
  const statusSelect = content.querySelector('#vlh-status');

  async function loadList() {
    renderListSkeleton(resultsEl, 4);
    paginationEl.innerHTML = '';
    const data = await apiCall('patients.list', {
      search: state.search, status: state.status, page: state.page, pageSize: PAGE_SIZE
    });

    if (!data.items || data.items.length === 0) {
      renderEmptyState(resultsEl, {
        title: 'ไม่พบผู้ป่วยที่ตรงกับเงื่อนไขนี้',
        message: 'ลองปรับคำค้นหาหรือตัวกรองดูอีกครั้ง'
      });
      return;
    }

    resultsEl.innerHTML = `
      <div class="grid md:grid-cols-2 gap-3">
        ${data.items.map((p, i) => `
          <a href="#/patients/${encodeURIComponent(p.patientId)}/cg2-log" class="flat-card flat-card-interactive animate-rise-in flex items-start gap-3 bg-white rounded-2xl p-4 active:bg-slate-50" style="--delay:${Math.min(i, 8) * 40}ms">
            <span class="w-10 h-10 rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sky-700 flex items-center justify-center shrink-0 text-sm font-bold mt-0.5">${escapeHtml((p.name || '?').charAt(0))}</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(p.name)}</p>
                <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(p.hn)} · อายุ ${p.age ?? '-'} ปี · ${escapeHtml(p.village || '-')}</p>
            </div>
          </a>
        `).join('')}
      </div>
    `;

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

  await loadList();
}
