/**
 * screens/dashboard.js
 * หน้าหลัก — สรุปจำนวนผู้ป่วยที่มองเห็นได้ตามสิทธิ์ (backend กรอง ownership ให้อัตโนมัติผ่าน patients.list)
 * พร้อมกราฟ Chart.js สรุปตามระดับความเสี่ยงและสถานะนัดเยี่ยม
 *
 * หมายเหตุ: ยังไม่มี action สรุปสถิติแยกต่างหากฝั่ง backend จึงดึง patients.list (pageSize สูงสุด 100)
 * มาคำนวณสรุปฝั่ง client — ถ้าผู้ป่วยที่มองเห็นได้เกิน 100 คน กราฟจะสรุปได้แค่ 100 รายการแรกเท่านั้น (แจ้งเตือนในหน้าถ้าเกิน)
 * "กิจกรรมล่าสุด" เรียงจาก patients.updatedAt จริงของชุดข้อมูลเดียวกัน ไม่ใช้ endpoint แยก และไม่ใส่ตัวเลข
 * % เทียบช่วงเวลาก่อนหน้าเพราะ backend ยังไม่มีสถิติย้อนหลัง (จะเป็นข้อมูลปลอมถ้าใส่เอง) — ใช้ % ของทั้งหมด
 * ในชุดข้อมูลปัจจุบันแทน ซึ่งคำนวณได้จริงจากข้อมูลที่ดึงมาแล้ว
 *
 * ดีไซน์: soft-shadow/gradient pass (ดู app.css) แทนที่ระบบการ์ดแบนไม่มีเงาเดิม
 */
import { apiCall } from '../api.js';
import { getCurrentUser, verifySessionRemote } from '../auth.js';
import { renderCardSkeleton, escapeHtml } from '../ui.js';
import { roleLabel, RISK_LEVEL_OPTIONS, PATIENT_STATUS_OPTIONS, statusBadgeClass } from '../constants.js';

const DASHBOARD_PAGE_SIZE = 100;

let riskChartInstance = null;
let statusChartInstance = null;

/** @param {HTMLElement} content */
export async function renderDashboard(content) {
  const user = getCurrentUser();
  const scopeLabel = user && (user.role === 'CG' || user.role === 'CM') ? 'ผู้ป่วยของฉัน' : 'ผู้ป่วยทั้งหมด';

  const initials = (user && user.name ? user.name.trim().charAt(0) : '?').toUpperCase();

  content.innerHTML = `
    <div class="px-4 pt-5 pb-8 max-w-5xl mx-auto">
      <div class="accent-gradient rounded-2xl px-5 pt-5 pb-6 md:px-7 md:pt-7 md:pb-8 text-white">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex items-center gap-4">
            <div class="hidden sm:flex w-14 h-14 rounded-2xl bg-white/15 border border-white/20 items-center justify-center text-xl font-bold shrink-0">${escapeHtml(initials)}</div>
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1">ยินดีต้อนรับกลับ</p>
              <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight truncate">${escapeHtml(user ? user.name : '')}</h1>
              <p class="text-sm text-white/80 mt-1">ภาพรวม${escapeHtml(scopeLabel)}และงานที่ต้องติดตามวันนี้</p>
              <span class="inline-flex items-center mt-3 px-3 py-1 rounded-full text-xs font-medium bg-white/15 border border-white/20">${escapeHtml(roleLabel(user && user.role))}</span>
            </div>
          </div>
          <div id="dashboard-connection-status" class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium bg-white/15 border border-white/20"></div>
        </div>
      </div>

      <div id="dashboard-stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4"></div>

      <p class="text-xs font-semibold uppercase tracking-wider text-slate-400 mt-6 mb-2 px-1">ทางลัด</p>
      <div id="dashboard-quick-actions" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1"></div>

      <div class="grid md:grid-cols-2 gap-4 mt-6">
        <div id="dashboard-charts" class="grid gap-4"></div>
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 px-1">กิจกรรมล่าสุด</p>
          <div id="dashboard-activity" class="flat-card bg-white rounded-2xl p-2"></div>
        </div>
      </div>
    </div>
  `;

  const statsEl = content.querySelector('#dashboard-stats');
  const chartsEl = content.querySelector('#dashboard-charts');
  const quickActionsEl = content.querySelector('#dashboard-quick-actions');
  const activityEl = content.querySelector('#dashboard-activity');
  renderCardSkeleton(statsEl);
  renderCardSkeleton(chartsEl);
  renderQuickActions(quickActionsEl);

  const statusEl = content.querySelector('#dashboard-connection-status');
  statusEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse"></span><span>กำลังเชื่อมต่อ...</span>';
  verifySessionRemote()
    .then(() => { statusEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-300"></span><span>เชื่อมต่อสำเร็จ</span>'; })
    .catch((err) => { statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-300"></span><span>${escapeHtml(err && err.message ? err.message : 'ออฟไลน์')}</span>`; });

  const data = await apiCall('patients.list', { page: 1, pageSize: DASHBOARD_PAGE_SIZE });
  const items = data.items || [];

  renderStatCards(statsEl, data, items, scopeLabel);
  renderCharts(chartsEl, items, data.total > items.length);
  renderRecentActivity(activityEl, items);
}

/**
 * แถวทางลัดไปหน้าที่ใช้บ่อย — แสดงทุกขนาดหน้าจอ (เดิมมีแค่มือถือ 2 ปุ่ม)
 * @param {HTMLElement} container
 */
function renderQuickActions(container) {
  const actions = [
    { href: '#/patients', label: 'ผู้ป่วย', icon: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><circle cx="17" cy="7" r="2.3"/><path d="M14.8 14.8c.7-.3 1.4-.5 2.2-.5 2.7 0 5 2.1 5 4.8"/>' },
    { href: '#/assessments', label: 'แบบประเมิน', icon: '<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 4.5V3.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 3.8v.7"/><path d="M8.5 13l2.2 2.2L15.5 10.5"/>' },
    { href: '#/map', label: 'แผนที่ผู้ป่วย', icon: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>' },
    { href: '#/reports', label: 'รายงาน', icon: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>' }
  ];

  container.innerHTML = actions.map((a, i) => `
    <a href="${a.href}" class="flat-card flat-card-interactive animate-rise-in bg-white rounded-2xl p-4 flex items-center gap-3" style="--delay:${i * 40}ms">
      <span class="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-50 to-indigo-50 text-sky-600 flex items-center justify-center shrink-0">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${a.icon}</svg>
      </span>
      <span class="text-sm font-medium text-slate-700 truncate">${escapeHtml(a.label)}</span>
    </a>
  `).join('');
}

/**
 * เรียงผู้ป่วยตาม updatedAt จริงจากชุดข้อมูลที่ดึงมาแล้ว (ไม่มี endpoint กิจกรรมแยกต่างหาก)
 * @param {HTMLElement} container
 * @param {Array<Object>} items
 */
function renderRecentActivity(container, items) {
  const recent = items
    .filter((p) => p.updatedAt)
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = '<p class="text-sm text-slate-400 text-center py-8 px-4">ยังไม่มีกิจกรรมล่าสุด</p>';
    return;
  }

  container.innerHTML = recent.map((p, i) => `
    <a href="#/patients/${encodeURIComponent(p.patientId)}" class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 animate-rise-in" style="--delay:${i * 40}ms">
      <span class="w-9 h-9 rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sky-700 flex items-center justify-center shrink-0 text-xs font-bold">${escapeHtml((p.name || '?').charAt(0))}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-slate-700 truncate">${escapeHtml(p.name)}</p>
        <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(relativeTime(p.updatedAt))}</p>
      </div>
      <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
    </a>
  `).join('');
}

/**
 * @param {string} isoString
 * @return {string} เวลาสัมพัทธ์แบบไทยคร่าว ๆ (นาที/ชั่วโมง/วันที่แล้ว)
 */
function relativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  return new Date(isoString).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
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
  const pctOfShown = (n) => (items.length ? `${Math.round((n / items.length) * 100)}% ของรายการที่แสดง` : '');

  const cards = [
    { key: 'total', label: scopeLabel, value: data.total, color: 'text-sky-700', chip: 'bg-sky-50 text-sky-600', helper: 'ทั้งหมดในระบบ', icon: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><circle cx="17" cy="7" r="2.3"/><path d="M14.8 14.8c.7-.3 1.4-.5 2.2-.5 2.7 0 5 2.1 5 4.8"/>' },
    { key: 'today', label: 'นัดเยี่ยมวันนี้', value: todayCount, color: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-600', helper: pctOfShown(todayCount), icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>' },
    { key: 'overdue', label: 'เลยนัด', value: overdueCount, color: 'text-rose-700', chip: 'bg-rose-50 text-rose-600', helper: pctOfShown(overdueCount), icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>' },
    { key: 'highrisk', label: 'ความเสี่ยงสูง/สูงมาก', value: highRiskCount, color: 'text-orange-700', chip: 'bg-orange-50 text-orange-600', helper: pctOfShown(highRiskCount), icon: '<path d="M12 21s-7.5-5-9.5-10.5C1 6 3.5 3 7 3c2 0 3.8 1.1 5 3 1.2-1.9 3-3 5-3 3.5 0 6 3 4.5 7.5C19.5 16 12 21 12 21Z"/>' }
  ];

  container.innerHTML = cards.map((card, i) => `
    <div class="flat-card flat-card-interactive animate-rise-in bg-white rounded-2xl p-4" style="--delay:${i * 70}ms">
      <span class="w-9 h-9 rounded-xl ${card.chip} flex items-center justify-center mb-2.5" aria-hidden="true">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${card.icon}</svg>
      </span>
      <p class="text-2xl font-extrabold tabular-nums ${card.color}" data-counter="${card.key}">0</p>
      <p class="text-xs text-slate-500 font-medium mt-1">${escapeHtml(card.label)}</p>
      ${card.helper ? `<p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(card.helper)}</p>` : ''}
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
    ${truncated ? '<p class="text-xs text-amber-600">แสดงผลจากผู้ป่วย 100 รายการแรกเท่านั้น (มีมากกว่านี้)</p>' : ''}
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
