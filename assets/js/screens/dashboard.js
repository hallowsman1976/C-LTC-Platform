/**
 * screens/dashboard.js
 * หน้าหลัก — สรุปจำนวนผู้ป่วยที่มองเห็นได้ตามสิทธิ์ (backend กรอง ownership ให้อัตโนมัติผ่าน patients.list)
 * พร้อมกราฟ Chart.js สรุปตามระดับความเสี่ยงและสถานะนัดเยี่ยม
 *
 * หมายเหตุ: ยังไม่มี action สรุปสถิติแยกต่างหากฝั่ง backend จึงดึง patients.list (pageSize สูงสุด 100)
 * มาคำนวณสรุปฝั่ง client — ถ้าผู้ป่วยที่มองเห็นได้เกิน 100 คน กราฟจะสรุปได้แค่ 100 รายการแรกเท่านั้น (แจ้งเตือนในหน้าถ้าเกิน)
 */
import { apiCall } from '../api.js';
import { getCurrentUser, verifySessionRemote } from '../auth.js';
import { renderCardSkeleton, escapeHtml } from '../ui.js';
import { roleLabel, RISK_LEVEL_OPTIONS, PATIENT_STATUS_OPTIONS } from '../constants.js';

const DASHBOARD_PAGE_SIZE = 100;

let riskChartInstance = null;
let statusChartInstance = null;

/** @param {HTMLElement} content */
export async function renderDashboard(content) {
  const user = getCurrentUser();
  const scopeLabel = user && (user.role === 'CG' || user.role === 'CM') ? 'ผู้ป่วยของฉัน' : 'ผู้ป่วยทั้งหมด';

  content.innerHTML = `
    <div class="px-4 py-5 max-w-4xl mx-auto">
      <div class="relative rounded-2xl overflow-hidden mb-4 shadow-sm">
        <img src="assets/illustrations/dashboard-hero.svg" alt="" class="w-full h-28 md:h-32 object-cover" />
        <div class="absolute inset-0 flex flex-col justify-center px-5 max-w-[55%]">
          <p class="text-xs text-sky-100">ยินดีต้อนรับ</p>
          <h1 class="text-lg md:text-xl font-bold text-white truncate">${escapeHtml(user ? user.name : '')}</h1>
        </div>
      </div>

      <div class="bg-white rounded-2xl shadow-sm p-4 mb-4 flex items-center justify-between">
        <div>
          <p class="text-xs text-slate-400 mb-1">บทบาท</p>
          <p class="text-sm font-medium text-slate-700">${escapeHtml(roleLabel(user && user.role))}</p>
        </div>
        <div id="dashboard-connection-status" class="text-xs text-slate-400 text-right"></div>
      </div>

      <div id="dashboard-stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>

      <div class="grid grid-cols-2 gap-3 mb-4 md:hidden">
        <a href="#/map" class="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
          </span>
          <span class="text-sm font-medium text-slate-700">แผนที่ผู้ป่วย</span>
        </a>
        <a href="#/reports" class="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>
          </span>
          <span class="text-sm font-medium text-slate-700">รายงาน</span>
        </a>
      </div>

      <div id="dashboard-charts" class="grid md:grid-cols-2 gap-4"></div>
    </div>
  `;

  const statsEl = content.querySelector('#dashboard-stats');
  const chartsEl = content.querySelector('#dashboard-charts');
  renderCardSkeleton(statsEl);
  renderCardSkeleton(chartsEl);

  const statusEl = content.querySelector('#dashboard-connection-status');
  verifySessionRemote()
    .then(() => { if (statusEl) statusEl.textContent = 'เชื่อมต่อสำเร็จ'; })
    .catch((err) => { if (statusEl) statusEl.textContent = err && err.message ? err.message : ''; });

  const data = await apiCall('patients.list', { page: 1, pageSize: DASHBOARD_PAGE_SIZE });
  const items = data.items || [];

  renderStatCards(statsEl, data, items, scopeLabel);
  renderCharts(chartsEl, items, data.total > items.length);
}

/**
 * @param {HTMLElement} container
 * @param {{total:number}} data
 * @param {Array<Object>} items
 * @param {string} scopeLabel
 */
function renderStatCards(container, data, items, scopeLabel) {
  const todayCount = items.filter((p) => p.status === 'นัดวันนี้').length;
  const overdueCount = items.filter((p) => p.status === 'เลยนัด').length;
  const highRiskCount = items.filter((p) => p.riskLevel === 'สูง' || p.riskLevel === 'สูงมาก').length;

  const cards = [
    { label: scopeLabel, value: data.total, color: 'text-sky-700' },
    { label: 'นัดเยี่ยมวันนี้', value: todayCount, color: 'text-emerald-700' },
    { label: 'เลยนัด', value: overdueCount, color: 'text-rose-700' },
    { label: 'ความเสี่ยงสูง/สูงมาก', value: highRiskCount, color: 'text-orange-700' }
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
 * @param {boolean} truncated true ถ้าผู้ป่วยที่มองเห็นได้มีมากกว่าที่ดึงมาคำนวณ
 */
function renderCharts(container, items, truncated) {
  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm p-4">
      <p class="text-sm font-medium text-slate-700 mb-3">สัดส่วนตามระดับความเสี่ยง</p>
      <canvas id="chart-risk" height="220"></canvas>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-4">
      <p class="text-sm font-medium text-slate-700 mb-3">สัดส่วนตามสถานะนัดเยี่ยม</p>
      <canvas id="chart-status" height="220"></canvas>
    </div>
    ${truncated ? '<p class="md:col-span-2 text-xs text-amber-600">แสดงผลจากผู้ป่วย 100 รายการแรกเท่านั้น (มีมากกว่านี้)</p>' : ''}
  `;

  if (riskChartInstance) riskChartInstance.destroy();
  if (statusChartInstance) statusChartInstance.destroy();

  const riskCounts = RISK_LEVEL_OPTIONS.map((level) => items.filter((p) => p.riskLevel === level).length);
  const statusCounts = PATIENT_STATUS_OPTIONS.map((status) => items.filter((p) => p.status === status).length);

  const riskCanvas = container.querySelector('#chart-risk');
  riskChartInstance = new Chart(riskCanvas, {
    type: 'doughnut',
    data: {
      labels: RISK_LEVEL_OPTIONS,
      datasets: [{
        data: riskCounts,
        backgroundColor: ['#10b981', '#f59e0b', '#f97316', '#e11d48']
      }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Noto Sans Thai' } } } } }
  });

  const statusCanvas = container.querySelector('#chart-status');
  statusChartInstance = new Chart(statusCanvas, {
    type: 'bar',
    data: {
      labels: PATIENT_STATUS_OPTIONS,
      datasets: [{
        label: 'จำนวนผู้ป่วย',
        data: statusCounts,
        backgroundColor: '#0284c7'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { font: { family: 'Noto Sans Thai' } } } }
    }
  });
}
