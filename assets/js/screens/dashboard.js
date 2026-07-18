/**
 * screens/dashboard.js
 * หน้าหลัก — สรุปจำนวนผู้ป่วยที่มองเห็นได้ตามสิทธิ์ (backend กรอง ownership ให้อัตโนมัติผ่าน patients.list)
 * พร้อมกราฟ Chart.js สรุปตามระดับความเสี่ยงและสถานะนัดเยี่ยม
 *
 * หมายเหตุ: ยังไม่มี action สรุปสถิติแยกต่างหากฝั่ง backend จึงดึง patients.list (pageSize สูงสุด 100)
 * มาคำนวณสรุปฝั่ง client — ถ้าผู้ป่วยที่มองเห็นได้เกิน 100 คน กราฟจะสรุปได้แค่ 100 รายการแรกเท่านั้น (แจ้งเตือนในหน้าถ้าเกิน)
 *
 * ดีไซน์: mirror จาก aitmpl.com/featured/brightdata ตามที่ผู้ใช้เลือก — การ์ดพื้นแบน เส้นขอบบาง ไม่มีเงา/
 * กระจกฝ้า/gradient แทนที่ระบบ premium visual pass เดิมทั้งหมด สีเน้นเปลี่ยนเป็นน้ำเงินอินดิโก้ (ดู app.css)
 * ยังคงตัวเลขนับขึ้นและการ์ดทยอยปรากฏไว้ (ไม่ใช่ส่วนที่ต้องแทนที่ตามที่ผู้ใช้ระบุ)
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
    <div class="px-4 pt-5 pb-8 max-w-4xl mx-auto">
      <div class="flat-card rounded-[28px] px-5 pt-5 pb-6 md:px-7 md:pt-7 md:pb-8 bg-white">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">ยินดีต้อนรับ</p>
            <h1 class="text-2xl md:text-3xl font-extrabold text-slate-800 tracking-tight truncate">${escapeHtml(user ? user.name : '')}</h1>
            <span class="flat-badge inline-flex items-center mt-3 px-3 py-1 rounded-full text-xs font-medium">${escapeHtml(roleLabel(user && user.role))}</span>
          </div>
          <div id="dashboard-connection-status" class="flat-badge shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium"></div>
        </div>
      </div>

      <div id="dashboard-stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 px-1"></div>

      <div class="grid grid-cols-2 gap-3 mt-4 mb-1 md:hidden">
        <a href="#/map" class="flat-card flat-card-interactive bg-white rounded-2xl p-4 flex items-center gap-3">
          <span class="w-9 h-9 rounded-xl bg-[#eef1fc] text-[#3e63dd] flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
          </span>
          <span class="text-sm font-medium text-slate-700">แผนที่ผู้ป่วย</span>
        </a>
        <a href="#/reports" class="flat-card flat-card-interactive bg-white rounded-2xl p-4 flex items-center gap-3">
          <span class="w-9 h-9 rounded-xl bg-[#eef1fc] text-[#3e63dd] flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>
          </span>
          <span class="text-sm font-medium text-slate-700">รายงาน</span>
        </a>
      </div>

      <div id="dashboard-charts" class="grid md:grid-cols-2 gap-4 mt-3"></div>
    </div>
  `;

  const statsEl = content.querySelector('#dashboard-stats');
  const chartsEl = content.querySelector('#dashboard-charts');
  renderCardSkeleton(statsEl);
  renderCardSkeleton(chartsEl);

  const statusEl = content.querySelector('#dashboard-connection-status');
  statusEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse"></span><span>กำลังเชื่อมต่อ...</span>';
  verifySessionRemote()
    .then(() => { statusEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>เชื่อมต่อสำเร็จ</span>'; })
    .catch((err) => { statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span>${escapeHtml(err && err.message ? err.message : 'ออฟไลน์')}</span>`; });

  const data = await apiCall('patients.list', { page: 1, pageSize: DASHBOARD_PAGE_SIZE });
  const items = data.items || [];

  renderStatCards(statsEl, data, items, scopeLabel);
  renderCharts(chartsEl, items, data.total > items.length);
}

/**
 * นับเลขขึ้นจาก 0 ถึงค่าจริงแบบ ease-out (เคารพ prefers-reduced-motion — ข้ามอนิเมชันไปแสดงค่าสุดท้ายทันที)
 * @param {HTMLElement} el
 * @param {number} target
 * @param {number=} duration ms
 */
function animateCounter(el, target, duration = 800) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !target) {
    el.textContent = String(target);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = String(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
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
    { key: 'total', label: scopeLabel, value: data.total, color: 'text-sky-700' },
    { key: 'today', label: 'นัดเยี่ยมวันนี้', value: todayCount, color: 'text-emerald-700' },
    { key: 'overdue', label: 'เลยนัด', value: overdueCount, color: 'text-rose-700' },
    { key: 'highrisk', label: 'ความเสี่ยงสูง/สูงมาก', value: highRiskCount, color: 'text-orange-700' }
  ];

  container.innerHTML = cards.map((card, i) => `
    <div class="flat-card flat-card-interactive animate-rise-in bg-white rounded-2xl p-4" style="--delay:${i * 70}ms">
      <p class="text-2xl font-extrabold tabular-nums ${card.color}" data-counter="${card.key}">0</p>
      <p class="text-xs text-slate-400 mt-1">${escapeHtml(card.label)}</p>
    </div>
  `).join('');

  cards.forEach((card) => {
    const el = container.querySelector(`[data-counter="${card.key}"]`);
    if (el) animateCounter(el, card.value);
  });
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} items
 * @param {boolean} truncated true ถ้าผู้ป่วยที่มองเห็นได้มีมากกว่าที่ดึงมาคำนวณ
 */
function renderCharts(container, items, truncated) {
  container.innerHTML = `
    <div class="flat-card animate-rise-in bg-white rounded-2xl p-4" style="--delay:280ms">
      <p class="text-sm font-semibold text-slate-700 mb-3">สัดส่วนตามระดับความเสี่ยง</p>
      <canvas id="chart-risk" height="220"></canvas>
    </div>
    <div class="flat-card animate-rise-in bg-white rounded-2xl p-4" style="--delay:340ms">
      <p class="text-sm font-semibold text-slate-700 mb-3">สัดส่วนตามสถานะนัดเยี่ยม</p>
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
        backgroundColor: ['#10b981', '#f59e0b', '#f97316', '#e11d48'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      animation: { animateRotate: true, duration: 700, easing: 'easeOutCubic' },
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Noto Sans Thai' } } } }
    }
  });

  const statusCanvas = container.querySelector('#chart-status');
  statusChartInstance = new Chart(statusCanvas, {
    type: 'bar',
    data: {
      labels: PATIENT_STATUS_OPTIONS,
      datasets: [{
        label: 'จำนวนผู้ป่วย',
        data: statusCounts,
        backgroundColor: '#3e63dd',
        borderRadius: 6,
        maxBarThickness: 40
      }]
    },
    options: {
      responsive: true,
      animation: { duration: 700, easing: 'easeOutCubic' },
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { font: { family: 'Noto Sans Thai' } } } }
    }
  });
}
