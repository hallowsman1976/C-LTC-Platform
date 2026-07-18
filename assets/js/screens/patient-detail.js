/**
 * screens/patient-detail.js
 * รายละเอียดผู้ป่วยรายคน — ข้อมูล master data, ทีมดูแล, และประวัติการเยี่ยมล่าสุด (visits.listByPatient)
 * ปุ่มการกระทำแสดง/ซ่อนตาม role จริง (Role-Based UI) แต่สิทธิ์จริงยังถูกบังคับซ้ำที่ backend เสมอ
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import { renderCardSkeleton, renderListSkeleton, renderEmptyState, renderBreadcrumb, showToast, confirmDialog, escapeHtml } from '../ui.js';
import { formatThaiDateDisplay } from '../date-picker.js';
import { riskBadgeClass, statusBadgeClass } from '../constants.js';

/**
 * @param {HTMLElement} content
 * @param {{id: string}} params
 */
export async function renderPatientDetail(content, params) {
  const patientId = params.id;

  content.innerHTML = `
    <div class="px-4 py-5 max-w-2xl mx-auto">
      <div id="pd-breadcrumb"></div>
      <div id="pd-header"></div>
      <div id="pd-actions" class="flex flex-wrap gap-2 my-4"></div>
      <h2 class="text-sm font-semibold text-slate-700 mb-2">ประวัติการเยี่ยมล่าสุด</h2>
      <div id="pd-visits"></div>
    </div>
  `;

  renderBreadcrumb(content.querySelector('#pd-breadcrumb'), [
    { label: 'ผู้ป่วย', href: '#/patients' },
    { label: 'รายละเอียด' }
  ]);

  const headerEl = content.querySelector('#pd-header');
  const actionsEl = content.querySelector('#pd-actions');
  const visitsEl = content.querySelector('#pd-visits');
  renderCardSkeleton(headerEl);
  renderListSkeleton(visitsEl, 3);

  const [patientData, visitsData] = await Promise.all([
    apiCall('patients.get', { patientId }),
    apiCall('visits.listByPatient', { patientId, pageSize: 10 })
  ]);

  const patient = patientData.patient;
  renderHeader(headerEl, patient);
  renderActions(actionsEl, patient);
  renderVisits(visitsEl, visitsData.items);

  const archiveBtn = actionsEl.querySelector('#pd-archive-btn');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      const confirmed = await confirmDialog(`ต้องการเก็บผู้ป่วย "${patient.name}" เข้าคลังหรือไม่? (สามารถกู้คืนได้ภายหลังโดยผู้ดูแลระบบ)`, {
        confirmLabel: 'เก็บเข้าคลัง', danger: true
      });
      if (!confirmed) return;
      try {
        await apiCall('patients.archive', { patientId });
        showToast('เก็บผู้ป่วยเข้าคลังแล้ว', 'success');
        location.hash = '/patients';
      } catch (err) {
        showToast(err && err.message ? err.message : 'เกิดข้อผิดพลาด', 'error');
      }
    });
  }
}

/**
 * @param {HTMLElement} container
 * @param {Object} patient patients.get คืน primaryCgName/responsibleCmName resolved มาให้แล้ว (ทุก role เห็นชื่อ
 *        จริงได้ ไม่ต้องพึ่ง directory.js ที่คืนค่าว่างเปล่าถ้าไม่ใช่ ADMIN — ดูคอมเมนต์ resolveUserName_ ฝั่ง backend)
 */
function renderHeader(container, patient) {
  const cgName = patient.primaryCgUserId ? (patient.primaryCgName || patient.primaryCgUserId) : 'ยังไม่มอบหมาย';
  const cmName = patient.responsibleCmUserId ? (patient.responsibleCmName || patient.responsibleCmUserId) : 'ยังไม่มอบหมาย';

  container.innerHTML = `
    ${patient.isDeleted ? '<div class="bg-amber-50 text-amber-700 text-xs rounded-xl px-3 py-2 mb-3">ผู้ป่วยรายนี้ถูกเก็บเข้าคลังแล้ว</div>' : ''}
    <div class="flat-card animate-rise-in bg-white rounded-2xl p-4">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h1 class="text-lg font-bold text-slate-800">${escapeHtml(patient.name)}</h1>
          <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(patient.hn)} · เลขบัตร ${escapeHtml(patient.cid || patient.cidMasked)}</p>
        </div>
        <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClass(patient.status)}">${escapeHtml(patient.status)}</span>
      </div>

      <div class="grid grid-cols-2 gap-3 mt-4 text-sm">
        <div><p class="text-xs text-slate-400">เพศ / อายุ</p><p class="text-slate-700">${escapeHtml(patient.gender)} · ${patient.age ?? '-'} ปี</p></div>
        <div><p class="text-xs text-slate-400">วันนัดเยี่ยมถัดไป</p><p class="text-slate-700">${escapeHtml(formatThaiDateDisplay(patient.nextVisitDate))}</p></div>
        <div class="col-span-2"><p class="text-xs text-slate-400">ที่อยู่</p><p class="text-slate-700">${escapeHtml([patient.village, patient.tambon, patient.amphoe, patient.changwat].filter(Boolean).join(' '))}</p></div>
        <div><p class="text-xs text-slate-400">ผู้ดูแลหลัก (CG)</p><p class="text-slate-700">${escapeHtml(cgName)}</p></div>
        <div><p class="text-xs text-slate-400">Case Manager (CM)</p><p class="text-slate-700">${escapeHtml(cmName)}</p></div>
      </div>

      <div class="flex items-center gap-2 mt-3">
        ${patient.riskLevel ? `<span class="text-xs font-medium px-2 py-1 rounded-full ${riskBadgeClass(patient.riskLevel)}">ความเสี่ยง ${escapeHtml(patient.riskLevel)}</span>` : ''}
        ${patient.adlGroup ? `<span class="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">${escapeHtml(patient.adlGroup)} (ADL ${patient.adlScore})</span>` : ''}
      </div>
    </div>
  `;
}

/**
 * @param {HTMLElement} container
 * @param {Object} patient
 */
function renderActions(container, patient) {
  const buttons = [];
  const canEditMaster = hasRole('ADMIN', 'CM');
  const canAssign = hasRole('ADMIN', 'CM');
  const canCarePlan = hasRole('ADMIN', 'CM', 'CG');
  const canRecordVisit = hasRole('ADMIN', 'CM', 'CG');
  const canArchive = hasRole('ADMIN') && !patient.isDeleted;

  if (canRecordVisit && !patient.isDeleted) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/visit/new" class="flex items-center gap-1.5 px-3 py-2 rounded-xl accent-gradient text-white text-sm font-medium hover:brightness-105 active:brightness-95 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>บันทึกการเยี่ยมวันนี้</a>`);
  }
  if (canEditMaster) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/edit" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>แก้ไขข้อมูล</a>`);
  }
  if (canAssign) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/assign" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><path d="M17 8v6M14 11h6"/></svg>มอบหมายทีมดูแล</a>`);
  }
  if (canCarePlan) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/care-plan" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-50 text-sky-700 text-sm font-medium hover:bg-sky-100 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M8.5 13l2.2 2.2L15.5 10.5"/></svg>Care Plan</a>`);
  }
  if (canCarePlan) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/cg2-log" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-50 text-sky-700 text-sm font-medium hover:bg-sky-100 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 4l9 6.5"/><path d="M5.5 9.5V19a1 1 0 0 0 1 1H10v-4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1V9.5"/></svg>เยี่ยมบ้าน (CG.2)</a>`);
  }
  if (canArchive) {
    buttons.push(`<button id="pd-archive-btn" type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-sm font-medium hover:bg-rose-100 transition"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="13" rx="1.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 7h18"/></svg>เก็บเข้าคลัง</button>`);
  }

  container.innerHTML = buttons.join('');
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} visits
 */
function renderVisits(container, visits) {
  if (!visits || visits.length === 0) {
    renderEmptyState(container, { title: 'ยังไม่มีประวัติการเยี่ยมบ้าน' });
    return;
  }

  container.innerHTML = visits.map((v, i) => `
    <div class="flat-card flat-card-interactive animate-rise-in bg-white rounded-2xl p-4 mb-3" style="--delay:${Math.min(i, 8) * 40}ms">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <span class="w-8 h-8 rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sky-700 flex items-center justify-center shrink-0 text-xs font-bold">${v.visitNumber}</span>
          <p class="text-sm font-semibold text-slate-800">การเยี่ยมครั้งที่ ${v.visitNumber}</p>
        </div>
        <span class="text-xs font-medium px-2 py-0.5 rounded-full ${v.reviewStatus === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
          ${v.reviewStatus === 'reviewed' ? 'ตรวจทานแล้ว' : 'รอตรวจทาน'}
        </span>
      </div>
      <p class="text-xs text-slate-400 mt-2 ml-[42px]">${escapeHtml(formatDateTime(v.visitDate))}</p>
      <p class="text-xs text-slate-500 mt-1.5 ml-[42px]">BP ${escapeHtml(v.bp || '-')} · HR ${escapeHtml(v.hr || '-')} · Temp ${escapeHtml(v.temp || '-')} · SpO2 ${escapeHtml(v.spo2 || '-')}</p>
      ${v.hasWound ? `<p class="text-xs text-rose-600 mt-1 ml-[42px]">พบแผลกดทับ ระยะ ${escapeHtml(v.wound.stage || '-')}</p>` : ''}
    </div>
  `).join('');
}

/** @param {string} isoString @return {string} */
function formatDateTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}
