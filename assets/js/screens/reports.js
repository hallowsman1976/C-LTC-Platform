/**
 * screens/reports.js
 * Reports Module — ตารางสรุปผู้ป่วยพร้อม Filter, ส่งออก CSV, และจัดหน้าพร้อมพิมพ์/บันทึกเป็น PDF (window.print())
 * รูปแบบ print-friendly ควบคุมด้วย @media print ใน app.css (ซ่อน sidebar/header/bottom-nav/ปุ่มต่าง ๆ อัตโนมัติ)
 */
import { apiCall } from '../api.js';
import { renderListSkeleton, showToast, escapeHtml } from '../ui.js';
import { PATIENT_STATUS_OPTIONS, RISK_LEVEL_OPTIONS, ADL_GROUP_OPTIONS, riskBadgeClass, statusBadgeClass } from '../constants.js';
import { exportToCsv } from '../csv-export.js';

const REPORT_MAX_ROWS = 100;

/** @param {HTMLElement} content */
export async function renderReports(content) {
  const state = { status: '', adlGroup: '', riskLevel: '' };
  let currentItems = [];

  content.innerHTML = `
    <div class="px-4 py-5 max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4 no-print">
        <h1 class="text-lg font-bold text-slate-800">รายงานผู้ป่วย</h1>
        <div class="flex gap-2">
          <button id="rp-export-btn" type="button" class="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium">ส่งออก CSV</button>
          <button id="rp-print-btn" type="button" class="px-3 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium">พิมพ์ / บันทึก PDF</button>
        </div>
      </div>

      <div class="bg-white rounded-2xl shadow-sm p-3 mb-4 grid grid-cols-3 gap-2 no-print">
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
      <div id="rp-table" class="bg-white rounded-2xl shadow-sm overflow-x-auto"></div>
      <p id="rp-truncated-note" class="hidden text-xs text-amber-600 mt-2">แสดงผล 100 รายการแรกเท่านั้น (มีมากกว่านี้) — ใช้ตัวกรองเพื่อจำกัดผลลัพธ์</p>
    </div>
  `;

  const summaryEl = content.querySelector('#rp-summary');
  const tableEl = content.querySelector('#rp-table');
  const truncatedNoteEl = content.querySelector('#rp-truncated-note');
  const statusSelect = content.querySelector('#rp-status');
  const adlGroupSelect = content.querySelector('#rp-adlgroup');
  const riskSelect = content.querySelector('#rp-risk');
  const exportBtn = content.querySelector('#rp-export-btn');
  const printBtn = content.querySelector('#rp-print-btn');

  async function loadReport() {
    renderListSkeleton(tableEl, 4);
    const data = await apiCall('patients.list', {
      status: state.status, adlGroup: state.adlGroup, riskLevel: state.riskLevel, page: 1, pageSize: REPORT_MAX_ROWS
    });
    currentItems = data.items;
    renderSummary(summaryEl, data.items);
    renderTable(tableEl, data.items);
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
    { label: 'ผู้ป่วยในรายงานนี้', value: total, color: 'text-sky-700' },
    { label: 'ความเสี่ยงสูง/สูงมาก', value: highRisk, color: 'text-rose-700' },
    { label: 'กลุ่มติดเตียง', value: bedbound, color: 'text-orange-700' },
    { label: 'เลยนัด', value: overdue, color: 'text-amber-700' }
  ];

  container.innerHTML = cards.map((card) => `
    <div class="bg-white rounded-2xl shadow-sm p-4">
      <p class="text-2xl font-bold ${card.color}">${card.value}</p>
      <p class="text-xs text-slate-400 mt-1">${escapeHtml(card.label)}</p>
    </div>
  `).join('');
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} items
 */
function renderTable(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-slate-500">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</div>`;
    return;
  }

  container.innerHTML = `
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-100 text-left text-xs text-slate-400">
          <th class="px-3 py-2">ชื่อ-นามสกุล</th>
          <th class="px-3 py-2">HN</th>
          <th class="px-3 py-2">กลุ่ม ADL</th>
          <th class="px-3 py-2">ความเสี่ยง</th>
          <th class="px-3 py-2">สถานะ</th>
          <th class="px-3 py-2">นัดถัดไป</th>
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
            <td class="px-3 py-2 text-slate-500">${escapeHtml(p.nextVisitDate || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
