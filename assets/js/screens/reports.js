/**
 * screens/reports.js
 * Reports Module — ตารางสรุปผู้ป่วยพร้อม Filter, ส่งออก CSV, และจัดหน้าพร้อมพิมพ์/บันทึกเป็น PDF (window.print())
 * รูปแบบ print-friendly ควบคุมด้วย @media print ใน app.css (ซ่อน sidebar/header/bottom-nav/ปุ่มต่าง ๆ อัตโนมัติ)
 */
import { apiCall } from '../api.js';
import { renderListSkeleton, renderBreadcrumb, showToast, escapeHtml } from '../ui.js';
import { PATIENT_STATUS_OPTIONS, RISK_LEVEL_OPTIONS, ADL_GROUP_OPTIONS, riskBadgeClass, statusBadgeClass } from '../constants.js';
import { exportToCsv } from '../csv-export.js';
import { formatThaiDateDisplay } from '../date-picker.js';

const REPORT_MAX_ROWS = 100;

/** @param {HTMLElement} content */
const SORT_COLUMNS = {
  name: { label: 'ชื่อ-นามสกุล', type: 'string' },
  hn: { label: 'HN', type: 'string' },
  adlGroup: { label: 'กลุ่ม ADL', type: 'string' },
  riskLevel: { label: 'ความเสี่ยง', type: 'enum', order: RISK_LEVEL_OPTIONS },
  status: { label: 'สถานะ', type: 'enum', order: PATIENT_STATUS_OPTIONS },
  nextVisitDate: { label: 'นัดถัดไป', type: 'date' }
};

/**
 * เรียงสำเนาของ items ตาม sortKey/sortDir ปัจจุบัน — เรียงฝั่ง client ล้วน ๆ (ข้อมูลดึงมาครบชุดแล้วสูงสุด
 * REPORT_MAX_ROWS แถว ไม่คุ้มที่จะยิง API ซ้ำแค่เพื่อเปลี่ยนลำดับการแสดงผล)
 * @param {Array<Object>} items
 * @param {{sortKey:string|null, sortDir:'asc'|'desc'}} state
 * @return {Array<Object>}
 */
function sortItems(items, state) {
  if (!state.sortKey) return items;
  const col = SORT_COLUMNS[state.sortKey];
  if (!col) return items;
  const dir = state.sortDir === 'desc' ? -1 : 1;
  return items.slice().sort((a, b) => {
    let va = a[state.sortKey];
    let vb = b[state.sortKey];
    let cmp;
    if (col.type === 'enum') {
      cmp = col.order.indexOf(va) - col.order.indexOf(vb);
    } else if (col.type === 'date') {
      cmp = new Date(va || 0).getTime() - new Date(vb || 0).getTime();
    } else {
      cmp = String(va || '').localeCompare(String(vb || ''), 'th');
    }
    return cmp * dir;
  });
}

/** @param {HTMLElement} content */
export async function renderReports(content) {
  const state = { status: '', adlGroup: '', riskLevel: '', sortKey: null, sortDir: 'asc' };
  let currentItems = [];

  content.innerHTML = `
    <div class="px-4 py-5 max-w-5xl mx-auto">
      <div id="rp-breadcrumb" class="no-print"></div>
      <div class="flex items-start justify-between gap-3 mb-4 no-print">
        <div class="min-w-0">
          <h1 class="text-xl font-bold text-slate-800">รายงานผู้ป่วย</h1>
          <p class="text-sm text-slate-400 mt-0.5">สรุปข้อมูลผู้ป่วยตามตัวกรอง พร้อมส่งออกหรือพิมพ์</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button id="rp-export-btn" type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg><span class="hidden sm:inline">ส่งออก CSV</span></button>
          <button id="rp-print-btn" type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-xl accent-gradient text-white text-sm font-medium hover:brightness-105 active:brightness-95 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg><span class="hidden sm:inline">พิมพ์ / บันทึก PDF</span></button>
        </div>
      </div>

      <div class="flat-card bg-white rounded-2xl p-3 mb-4 grid grid-cols-3 gap-2 no-print">
        <select id="rp-status" class="px-2 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">สถานะทั้งหมด</option>
          ${PATIENT_STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
        </select>
        <select id="rp-adlgroup" class="px-2 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">กลุ่ม ADL ทั้งหมด</option>
          ${ADL_GROUP_OPTIONS.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
        </select>
        <select id="rp-risk" class="px-2 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">ความเสี่ยงทั้งหมด</option>
          ${RISK_LEVEL_OPTIONS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
        </select>
      </div>

      <div class="hidden print:block mb-4">
        <h1 class="text-lg font-bold">รายงานสรุปข้อมูลผู้ป่วย — LTC Smart Care</h1>
        <p class="text-xs text-slate-500">พิมพ์เมื่อ ${escapeHtml(new Date().toLocaleString('th-TH'))}</p>
      </div>

      <div id="rp-summary" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>
      <div id="rp-table" class="flat-card bg-white rounded-2xl overflow-auto max-h-[65vh] print:max-h-none print:overflow-visible"></div>
      <p id="rp-truncated-note" class="hidden text-xs text-amber-600 mt-2">แสดงผล 100 รายการแรกเท่านั้น (มีมากกว่านี้) — ใช้ตัวกรองเพื่อจำกัดผลลัพธ์</p>
    </div>
  `;

  renderBreadcrumb(content.querySelector('#rp-breadcrumb'), [
    { label: 'หน้าหลัก', href: '#/dashboard' },
    { label: 'รายงาน' }
  ]);

  const summaryEl = content.querySelector('#rp-summary');
  const tableEl = content.querySelector('#rp-table');
  const truncatedNoteEl = content.querySelector('#rp-truncated-note');
  const statusSelect = content.querySelector('#rp-status');
  const adlGroupSelect = content.querySelector('#rp-adlgroup');
  const riskSelect = content.querySelector('#rp-risk');
  const exportBtn = content.querySelector('#rp-export-btn');
  const printBtn = content.querySelector('#rp-print-btn');

  function renderTableWithCurrentSort() {
    renderTable(tableEl, sortItems(currentItems, state), state, (key) => {
      state.sortDir = state.sortKey === key && state.sortDir === 'asc' ? 'desc' : 'asc';
      state.sortKey = key;
      renderTableWithCurrentSort();
    });
  }

  async function loadReport() {
    renderListSkeleton(tableEl, 4);
    const data = await apiCall('patients.list', {
      status: state.status, adlGroup: state.adlGroup, riskLevel: state.riskLevel, page: 1, pageSize: REPORT_MAX_ROWS
    });
    currentItems = data.items;
    renderSummary(summaryEl, data.items);
    renderTableWithCurrentSort();
    truncatedNoteEl.classList.toggle('hidden', data.total <= data.items.length);
  }

  statusSelect.addEventListener('change', () => { state.status = statusSelect.value; loadReport(); });
  adlGroupSelect.addEventListener('change', () => { state.adlGroup = adlGroupSelect.value; loadReport(); });
  riskSelect.addEventListener('change', () => { state.riskLevel = riskSelect.value; loadReport(); });

  exportBtn.addEventListener('click', () => {
    if (currentItems.length === 0) {
      showToast('ไม่มีข้อมูลให้ส่งออก', 'warning');
      return;
    }
    const rows = currentItems.map((p) => ({
      'ชื่อ-นามสกุล': p.name, HN: p.hn, อายุ: p.age ?? '', เพศ: p.gender,
      หมู่บ้าน: p.village, ตำบล: p.tambon, อำเภอ: p.amphoe, จังหวัด: p.changwat,
      'กลุ่ม ADL': p.adlGroup, 'คะแนน ADL': p.adlScore, ความเสี่ยง: p.riskLevel,
      สถานะ: p.status, วันนัดเยี่ยมถัดไป: p.nextVisitDate
    }));
    exportToCsv(`ltc-patients-report-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    showToast('ส่งออก CSV สำเร็จ', 'success');
  });

  printBtn.addEventListener('click', () => window.print());

  await loadReport();
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} items
 */
function renderSummary(container, items) {
  const total = items.length;
  const highRisk = items.filter((p) => p.riskLevel === 'สูง' || p.riskLevel === 'สูงมาก').length;
  const bedbound = items.filter((p) => p.adlGroup === 'ติดเตียง').length;
  const overdue = items.filter((p) => p.status === 'เลยนัด').length;

  const cards = [
    { label: 'ผู้ป่วยในรายงานนี้', value: total, color: 'text-sky-700', chip: 'bg-sky-50 text-sky-600', icon: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><circle cx="17" cy="7" r="2.3"/><path d="M14.8 14.8c.7-.3 1.4-.5 2.2-.5 2.7 0 5 2.1 5 4.8"/>' },
    { label: 'ความเสี่ยงสูง/สูงมาก', value: highRisk, color: 'text-rose-700', chip: 'bg-rose-50 text-rose-600', icon: '<path d="M12 21s-7.5-5-9.5-10.5C1 6 3.5 3 7 3c2 0 3.8 1.1 5 3 1.2-1.9 3-3 5-3 3.5 0 6 3 4.5 7.5C19.5 16 12 21 12 21Z"/>' },
    { label: 'กลุ่มติดเตียง', value: bedbound, color: 'text-orange-700', chip: 'bg-orange-50 text-orange-600', icon: '<rect x="3" y="11" width="18" height="7" rx="1.5"/><path d="M3 11V8a2 2 0 0 1 2-2h3v3M7 18v2M17 18v2"/>' },
    { label: 'เลยนัด', value: overdue, color: 'text-amber-700', chip: 'bg-amber-50 text-amber-600', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>' }
  ];

  container.innerHTML = cards.map((card, i) => `
    <div class="flat-card animate-rise-in bg-white rounded-2xl p-4" style="--delay:${i * 60}ms">
      <span class="w-9 h-9 rounded-xl ${card.chip} flex items-center justify-center mb-2.5 no-print" aria-hidden="true">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${card.icon}</svg>
      </span>
      <p class="text-2xl font-extrabold tabular-nums ${card.color}">${card.value}</p>
      <p class="text-xs text-slate-400 mt-1">${escapeHtml(card.label)}</p>
    </div>
  `).join('');
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} items เรียงมาแล้ว (จาก sortItems)
 * @param {{sortKey:string|null, sortDir:'asc'|'desc'}} state
 * @param {(key:string)=>void} onSortClick
 */
function renderTable(container, items, state, onSortClick) {
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-slate-500">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</div>`;
    return;
  }

  const sortIcon = (key) => {
    if (state.sortKey !== key) {
      return '<svg class="w-3 h-3 text-slate-300 no-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>';
    }
    return state.sortDir === 'asc'
      ? '<svg class="w-3 h-3 text-sky-600 no-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>'
      : '<svg class="w-3 h-3 text-sky-600 no-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  };
  const th = (key) => `
    <th class="px-3 py-2">
      <button type="button" data-sort-key="${key}" class="no-print flex items-center gap-1 hover:text-slate-600 transition">
        ${escapeHtml(SORT_COLUMNS[key].label)}${sortIcon(key)}
      </button>
      <span class="hidden print:inline">${escapeHtml(SORT_COLUMNS[key].label)}</span>
    </th>
  `;

  container.innerHTML = `
    <table class="w-full text-sm">
      <thead class="sticky top-0 z-10 bg-white print:static">
        <tr class="border-b border-slate-100 text-left text-xs text-slate-400">
          ${th('name')}${th('hn')}${th('adlGroup')}${th('riskLevel')}${th('status')}${th('nextVisitDate')}
        </tr>
      </thead>
      <tbody>
        ${items.map((p) => `
          <tr class="border-b border-slate-50 last:border-0">
            <td class="px-3 py-2"><a href="#/patients/${encodeURIComponent(p.patientId)}" class="text-sky-700 no-print">${escapeHtml(p.name)}</a><span class="hidden print:inline">${escapeHtml(p.name)}</span></td>
            <td class="px-3 py-2 text-slate-500">${escapeHtml(p.hn)}</td>
            <td class="px-3 py-2 text-slate-500">${escapeHtml(p.adlGroup || '-')}</td>
            <td class="px-3 py-2"><span class="text-xs font-medium px-2 py-0.5 rounded-full ${riskBadgeClass(p.riskLevel)}">${escapeHtml(p.riskLevel || '-')}</span></td>
            <td class="px-3 py-2"><span class="text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(p.status)}">${escapeHtml(p.status)}</span></td>
            <td class="px-3 py-2 text-slate-500">${escapeHtml(formatThaiDateDisplay(p.nextVisitDate))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-sort-key]').forEach((btn) => {
    btn.addEventListener('click', () => onSortClick(btn.dataset.sortKey));
  });
}
