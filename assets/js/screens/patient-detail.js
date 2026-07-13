/**
 * screens/patient-detail.js
 * รายละเอียดผู้ป่วยรายคน — ข้อมูล master data, ทีมดูแล, และประวัติการเยี่ยมล่าสุด (visits.listByPatient)
 * ปุ่มการกระทำแสดง/ซ่อนตาม role จริง (Role-Based UI) แต่สิทธิ์จริงยังถูกบังคับซ้ำที่ backend เสมอ
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import { renderCardSkeleton, renderListSkeleton, renderEmptyState, showToast, confirmDialog, escapeHtml } from '../ui.js';
import { getUserDirectoryMap } from '../directory.js';
import { riskBadgeClass, statusBadgeClass } from '../constants.js';

/**
 * @param {HTMLElement} content
 * @param {{id: string}} params
 */
export async function renderPatientDetail(content, params) {
  const patientId = params.id;

  content.innerHTML = `
    <div class="px-4 py-5 max-w-2xl">
      <a href="#/patients" class="text-sm text-sky-600 mb-3 inline-block">← กลับไปรายชื่อผู้ป่วย</a>
      <div id="pd-header"></div>
      <div id="pd-actions" class="flex flex-wrap gap-2 my-4"></div>
      <h2 class="text-sm font-semibold text-slate-700 mb-2">ประวัติการเยี่ยมล่าสุด</h2>
      <div id="pd-visits"></div>
    </div>
  `;

  const headerEl = content.querySelector('#pd-header');
  const actionsEl = content.querySelector('#pd-actions');
  const visitsEl = content.querySelector('#pd-visits');
  renderCardSkeleton(headerEl);
  renderListSkeleton(visitsEl, 3);

  const [patientData, visitsData, directoryMap] = await Promise.all([
    apiCall('patients.get', { patientId }),
    apiCall('visits.listByPatient', { patientId, pageSize: 10 }),
    getUserDirectoryMap()
  ]);

  const patient = patientData.patient;
  renderHeader(headerEl, patient, directoryMap);
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
 * @param {Object} patient
 * @param {Object} directoryMap userId → user (ว่างเปล่าถ้าไม่ใช่ ADMIN)
 */
function renderHeader(container, patient, directoryMap) {
  const cgName = patient.primaryCgUserId
    ? (directoryMap[patient.primaryCgUserId] ? directoryMap[patient.primaryCgUserId].name : patient.primaryCgUserId)
    : 'ยังไม่มอบหมาย';
  const cmName = patient.responsibleCmUserId
    ? (directoryMap[patient.responsibleCmUserId] ? directoryMap[patient.responsibleCmUserId].name : patient.responsibleCmUserId)
    : 'ยังไม่มอบหมาย';

  container.innerHTML = `
    ${patient.isDeleted ? '<div class="bg-amber-50 text-amber-700 text-xs rounded-xl px-3 py-2 mb-3">ผู้ป่วยรายนี้ถูกเก็บเข้าคลังแล้ว</div>' : ''}
    <div class="bg-white rounded-2xl shadow-sm p-4">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h1 class="text-lg font-bold text-slate-800">${escapeHtml(patient.name)}</h1>
          <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(patient.hn)} · เลขบัตร ${escapeHtml(patient.cid || patient.cidMasked)}</p>
        </div>
        <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClass(patient.status)}">${escapeHtml(patient.status)}</span>
      </div>

      <div class="grid grid-cols-2 gap-3 mt-4 text-sm">
        <div><p class="text-xs text-slate-400">เพศ / อายุ</p><p class="text-slate-700">${escapeHtml(patient.gender)} · ${patient.age ?? '-'} ปี</p></div>
        <div><p class="text-xs text-slate-400">วันนัดเยี่ยมถัดไป</p><p class="text-slate-700">${escapeHtml(patient.nextVisitDate || '-')}</p></div>
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
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/visit/new" class="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium">+ บันทึกการเยี่ยมวันนี้</a>`);
  }
  if (canEditMaster) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/edit" class="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium">แก้ไขข้อมูล</a>`);
  }
  if (canAssign) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/assign" class="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium">มอบหมายทีมดูแล</a>`);
  }
  if (canCarePlan) {
    buttons.push(`<a href="#/patients/${encodeURIComponent(patient.patientId)}/care-plan" class="px-3 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium">Care Plan</a>`);
  }
  if (canArchive) {
    buttons.push(`<button id="pd-archive-btn" type="button" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-sm font-medium">เก็บเข้าคลัง</button>`);
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

  container.innerHTML = visits.map((v) => `
    <div class="bg-white rounded-2xl shadow-sm p-4 mb-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-slate-800">ครั้งที่ ${v.visitNumber}</p>
        <span class="text-xs font-medium px-2 py-0.5 rounded-full ${v.reviewStatus === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
          ${v.reviewStatus === 'reviewed' ? 'ตรวจทานแล้ว' : 'รอตรวจทาน'}
        </span>
      </div>
      <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(formatDateTime(v.visitDate))}</p>
      <p class="text-xs text-slate-500 mt-2">BP ${escapeHtml(v.bp || '-')} · HR ${escapeHtml(v.hr || '-')} · Temp ${escapeHtml(v.temp || '-')} · SpO2 ${escapeHtml(v.spo2 || '-')}</p>
      ${v.hasWound ? `<p class="text-xs text-rose-600 mt-1">พบแผลกดทับ ระยะ ${escapeHtml(v.wound.stage || '-')}</p>` : ''}
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
