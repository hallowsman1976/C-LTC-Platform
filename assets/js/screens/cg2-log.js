/**
 * screens/cg2-log.js
 * รายงานการเยี่ยมบ้านผู้ป่วยและผู้สูงอายุ (CG.2) — บันทึกสั้นที่ผู้ดูแล (CG) จดทุกครั้งที่แวะเยี่ยม
 * ต่างจาก visit-form.js (การเยี่ยมเต็มรูปแบบ 10 ขั้นตอน) ตรงที่ไฟล์นี้เบากว่ามาก ไม่มี offline queue/draft/
 * ตรวจทาน และเป็น append-only (บันทึกผิดต้องบันทึกใหม่ ไม่มี action แก้) เหมือนแบบประเมินอื่น ๆ ในระบบ
 * (ดูรายละเอียดเหตุผลที่ Cg2Logs.gs ฝั่ง backend)
 *
 * หน้านี้มีสองส่วน: การ์ดโปรไฟล์ (ข้อมูลที่กรอกครั้งเดียว/แก้ไม่บ่อย เช่น โรค กลุ่มภาวะพึ่งพิง น้ำหนัก/ส่วนสูง
 * ผู้ดูแลหลัก — แก้ได้เฉพาะ ADMIN/CM เหมือนข้อมูลผู้ป่วยหลักอื่น ๆ) และประวัติการเยี่ยมแบบรายการ (ทุก role ที่
 * เข้าถึงผู้ป่วยรายนี้ได้ดูได้ แต่เพิ่มบันทึกใหม่ได้เฉพาะ ADMIN/CM/CG เหมือน visits.saveDraft)
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import {
  renderCardSkeleton, renderListSkeleton, renderEmptyState, renderPagination, renderBreadcrumb,
  showToast, escapeHtml
} from '../ui.js';
import { initThaiDatePicker, formatThaiDateDisplay, formatThaiDateTime } from '../date-picker.js';
import {
  singleChoice, wireSingleChoice, yesNoToggle, wireYesNo,
  chipMultiSelect, wireChips, toggleArrayValue
} from '../form-widgets.js';
import {
  DEPENDENCY_GROUP_OPTIONS, FAMILY_CAREGIVER_RELATION_OPTIONS, SYMPTOM_TREND_OPTIONS, RECOMMENDATION_OPTIONS,
  symptomTrendBadgeClass
} from '../constants.js';

const LOG_PAGE_SIZE = 10;

/**
 * ช่อง text input แบบ floating label — เหมือน floatField ใน patient-form.js (คัดลอกมาปรับใช้ในไฟล์นี้
 * เพราะเป็น local helper เล็ก ๆ ไม่ได้แยกไปไว้ใน form-widgets.js เนื่องจากต้องใช้ placeholder=" " เฉพาะตัว)
 * @param {{id:string, label:string, value?:string, required?:boolean, inputAttrs?:string}} f
 * @return {string}
 */
function floatField(f) {
  return `
    <div class="field-float">
      <input id="${f.id}" type="text" value="${escapeHtml(f.value || '')}" placeholder=" " ${f.inputAttrs || ''}
        class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition" />
      <label for="${f.id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
    </div>
  `;
}

/** @return {string} วันที่วันนี้ในรูปแบบ ISO YYYY-MM-DD */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {HTMLElement} content
 * @param {{id: string}} params
 */
export async function renderCg2Log(content, params) {
  const patientId = params.id;
  const canEditProfile = hasRole('ADMIN', 'CM');
  const canAddLog = hasRole('ADMIN', 'CM', 'CG');

  content.innerHTML = `
    <div class="px-4 py-5 max-w-2xl mx-auto">
      <div id="cg2-breadcrumb"></div>
      <h1 class="text-lg font-bold text-slate-800 mb-1">รายงานเยี่ยมบ้าน (CG.2)</h1>
      <p class="text-sm text-slate-400 mb-4">รายงานการเยี่ยมบ้านผู้ป่วยและผู้สูงอายุ — บันทึกสั้นทุกครั้งที่แวะเยี่ยม</p>

      <div id="cg2-profile"></div>

      <div class="flex items-center justify-between mt-5 mb-3">
        <p class="text-sm font-semibold text-slate-700">ประวัติการเยี่ยม</p>
        ${canAddLog ? `
          <button id="cg2-new-btn" type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-xl accent-gradient text-white text-sm font-medium hover:brightness-105 active:brightness-95 transition">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            เพิ่มบันทึกการเยี่ยม
          </button>
        ` : ''}
      </div>
      <div id="cg2-new-form-slot"></div>
      <div id="cg2-list"></div>
      <div id="cg2-pagination"></div>
    </div>
  `;

  renderBreadcrumb(content.querySelector('#cg2-breadcrumb'), [
    { label: 'ผู้ป่วย', href: '#/patients' },
    { label: 'รายละเอียด', href: `#/patients/${encodeURIComponent(patientId)}` },
    { label: 'CG.2' }
  ]);

  const profileEl = content.querySelector('#cg2-profile');
  const listEl = content.querySelector('#cg2-list');
  const paginationEl = content.querySelector('#cg2-pagination');
  const newBtn = content.querySelector('#cg2-new-btn');
  const newFormSlot = content.querySelector('#cg2-new-form-slot');

  const state = { page: 1 };

  renderCardSkeleton(profileEl);

  async function loadProfile() {
    const data = await apiCall('patients.get', { patientId });
    renderProfileCard(profileEl, data.patient, { canEdit: canEditProfile, onSaved: loadProfile });
  }

  async function loadLogs() {
    renderListSkeleton(listEl, 3);
    paginationEl.innerHTML = '';
    const data = await apiCall('cg2logs.listByPatient', { patientId, page: state.page, pageSize: LOG_PAGE_SIZE });
    renderLogList(listEl, data.items);
    renderPagination(paginationEl, { page: data.page, pageSize: data.pageSize, total: data.total }, (nextPage) => {
      state.page = nextPage;
      loadLogs();
    });
  }

  if (newBtn) {
    newBtn.addEventListener('click', () => {
      if (newFormSlot.innerHTML) {
        newFormSlot.innerHTML = '';
        return;
      }
      renderLogForm(newFormSlot, {
        patientId,
        onCancel: () => { newFormSlot.innerHTML = ''; },
        onSaved: async () => { newFormSlot.innerHTML = ''; state.page = 1; await loadLogs(); }
      });
    });
  }

  await Promise.all([loadProfile(), loadLogs()]);
}

/* ============================================================
 * การ์ดโปรไฟล์ (ข้อมูลที่กรอกครั้งเดียว/แก้ไม่บ่อย) — แสดงเสมอ, แก้ไขได้เฉพาะ ADMIN/CM
 * ============================================================ */

/**
 * @param {HTMLElement} container
 * @param {Object} patient จาก patients.get (มีฟิลด์โปรไฟล์ CG.2 ติดมาด้วยแล้ว — ดู sanitizePatientForClient_)
 * @param {{canEdit:boolean, onSaved:Function}} ctx
 */
function renderProfileCard(container, patient, ctx) {
  const bmi = computeBmi(patient.weight, patient.height);
  const relationText = patient.familyCaregiverRelation === 'อื่นๆ' && patient.familyCaregiverRelationOtherNote
    ? `อื่นๆ (${patient.familyCaregiverRelationOtherNote})`
    : (patient.familyCaregiverRelation || '');

  container.innerHTML = `
    <div class="flat-card bg-white rounded-2xl p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(patient.name)}</p>
          <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(patient.hn)} · อายุ ${patient.age ?? '-'} ปี${patient.hhcNumber ? ' · HHC ' + escapeHtml(patient.hhcNumber) : ''}</p>
        </div>
        ${ctx.canEdit ? '<button id="cg2-profile-edit-btn" type="button" class="shrink-0 text-xs font-medium text-sky-600 hover:underline">แก้ไข</button>' : ''}
      </div>

      <div class="grid grid-cols-2 gap-3 mt-3 text-sm">
        <div><p class="text-xs text-slate-400">โรค</p><p class="text-slate-700">${patient.diagnosis ? escapeHtml(patient.diagnosis) : '-'}</p></div>
        <div><p class="text-xs text-slate-400">กลุ่มภาวะพึ่งพิง</p><p class="text-slate-700">${patient.dependencyGroup ? 'กลุ่มที่ ' + escapeHtml(patient.dependencyGroup) : '-'}</p></div>
        <div><p class="text-xs text-slate-400">น้ำหนัก / ส่วนสูง</p><p class="text-slate-700">${patient.weight ? escapeHtml(patient.weight) + ' กก.' : '-'} / ${patient.height ? escapeHtml(patient.height) + ' ซม.' : '-'}</p></div>
        <div><p class="text-xs text-slate-400">BMI</p><p class="text-slate-700">${bmi ?? '-'}</p></div>
        <div><p class="text-xs text-slate-400">ผู้ดูแลตามมอบหมาย</p><p class="text-slate-700">${patient.primaryCgName ? escapeHtml(patient.primaryCgName) : 'ยังไม่มอบหมาย'}</p></div>
        <div><p class="text-xs text-slate-400">พยาบาลที่รับผิดชอบ</p><p class="text-slate-700">${patient.responsibleCmName ? escapeHtml(patient.responsibleCmName) : 'ยังไม่มอบหมาย'}</p></div>
        <div class="col-span-2"><p class="text-xs text-slate-400">ผู้ดูแลหลัก (ญาติ)</p>
          <p class="text-slate-700">${patient.familyCaregiverName ? escapeHtml(patient.familyCaregiverName) : '-'}${patient.familyCaregiverAge ? ' · อายุ ' + escapeHtml(patient.familyCaregiverAge) + ' ปี' : ''}${relationText ? ' · ' + escapeHtml(relationText) : ''}</p>
        </div>
      </div>

      <div id="cg2-profile-edit-slot"></div>
    </div>
  `;

  const editBtn = container.querySelector('#cg2-profile-edit-btn');
  const editSlot = container.querySelector('#cg2-profile-edit-slot');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (editSlot.innerHTML) {
        editSlot.innerHTML = '';
        return;
      }
      renderProfileEditForm(editSlot, patient, {
        onCancel: () => { editSlot.innerHTML = ''; },
        onSaved: async () => { editSlot.innerHTML = ''; await ctx.onSaved(); }
      });
    });
  }
}

/**
 * @param {string|number} weight กก.
 * @param {string|number} height ซม.
 * @return {string|null} BMI ทศนิยม 1 ตำแหน่ง หรือ null ถ้าคำนวณไม่ได้
 */
function computeBmi(weight, height) {
  const w = Number(weight);
  const h = Number(height);
  if (!w || !h) return null;
  const meters = h / 100;
  const bmi = w / (meters * meters);
  return Number.isFinite(bmi) ? bmi.toFixed(1) : null;
}

/**
 * ฟอร์มแก้ไขโปรไฟล์ CG.2 — ส่งผ่าน patients.update (patch keys ที่ Patients.gs เพิ่งเพิ่มรองรับ)
 * @param {HTMLElement} container
 * @param {Object} patient
 * @param {{onCancel:Function, onSaved:Function}} ctx
 */
function renderProfileEditForm(container, patient, ctx) {
  const state = {
    dependencyGroup: patient.dependencyGroup || '',
    familyCaregiverRelation: patient.familyCaregiverRelation || ''
  };

  container.innerHTML = `
    <form id="cg2-profile-form" class="border-t border-slate-100 mt-3 pt-3 space-y-3">
      <p id="cg2-profile-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>
      <div class="grid grid-cols-2 gap-3">
        ${floatField({ id: 'cg2-hhc', label: 'เลขที่ HHC', value: patient.hhcNumber })}
        <div class="col-span-2">${floatField({ id: 'cg2-diagnosis', label: 'โรค', value: patient.diagnosis })}</div>
        <div class="col-span-2">
          <p class="text-xs font-medium text-slate-500 mb-1.5">กลุ่มภาวะพึ่งพิง</p>
          <div id="cg2-dependencygroup">${singleChoice({ name: 'dependencygroup', options: DEPENDENCY_GROUP_OPTIONS, selectedValue: state.dependencyGroup })}</div>
        </div>
        ${floatField({ id: 'cg2-weight', label: 'น้ำหนัก (กก.)', value: patient.weight })}
        ${floatField({ id: 'cg2-height', label: 'ส่วนสูง (ซม.)', value: patient.height })}
      </div>

      <p class="text-xs font-semibold text-slate-600 pt-1">ผู้ดูแลหลัก (ญาติ)</p>
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2">${floatField({ id: 'cg2-fcname', label: 'ชื่อ-สกุล', value: patient.familyCaregiverName })}</div>
        ${floatField({ id: 'cg2-fcage', label: 'อายุ (ปี)', value: patient.familyCaregiverAge })}
      </div>
      <div>
        <p class="text-xs font-medium text-slate-500 mb-1.5">ความเกี่ยวข้อง</p>
        <div id="cg2-fcrelation">${singleChoice({ name: 'fcrelation', options: FAMILY_CAREGIVER_RELATION_OPTIONS, selectedValue: state.familyCaregiverRelation })}</div>
      </div>
      <div id="cg2-fcrelation-note-slot">${floatField({ id: 'cg2-fcrelation-note', label: 'ระบุความเกี่ยวข้อง', value: patient.familyCaregiverRelationOtherNote })}</div>

      <div class="flex gap-2 pt-1">
        <button id="cg2-profile-cancel" type="button" class="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">ยกเลิก</button>
        <button id="cg2-profile-submit" type="submit" class="flex-1 py-2 rounded-xl accent-gradient text-white text-sm font-medium">บันทึก</button>
      </div>
    </form>
  `;

  const form = container.querySelector('#cg2-profile-form');
  const errorEl = container.querySelector('#cg2-profile-error');

  function syncRelationNoteVisibility() {
    const noteSlot = container.querySelector('#cg2-fcrelation-note-slot');
    noteSlot.classList.toggle('hidden', state.familyCaregiverRelation !== 'อื่นๆ');
  }
  syncRelationNoteVisibility();

  function wireDependencyGroup() {
    wireSingleChoice(container, 'dependencygroup', (value) => {
      state.dependencyGroup = value;
      container.querySelector('#cg2-dependencygroup').innerHTML = singleChoice({ name: 'dependencygroup', options: DEPENDENCY_GROUP_OPTIONS, selectedValue: state.dependencyGroup });
      wireDependencyGroup();
    });
  }
  function wireFcRelation() {
    wireSingleChoice(container, 'fcrelation', (value) => {
      state.familyCaregiverRelation = value;
      container.querySelector('#cg2-fcrelation').innerHTML = singleChoice({ name: 'fcrelation', options: FAMILY_CAREGIVER_RELATION_OPTIONS, selectedValue: state.familyCaregiverRelation });
      syncRelationNoteVisibility();
      wireFcRelation();
    });
  }
  wireDependencyGroup();
  wireFcRelation();

  container.querySelector('#cg2-profile-cancel').addEventListener('click', () => ctx.onCancel());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');

    const val = (id) => form.querySelector(id).value.trim();
    const patch = {
      hhcNumber: val('#cg2-hhc'),
      diagnosis: val('#cg2-diagnosis'),
      dependencyGroup: state.dependencyGroup,
      weight: val('#cg2-weight'),
      height: val('#cg2-height'),
      familyCaregiverName: val('#cg2-fcname'),
      familyCaregiverAge: val('#cg2-fcage'),
      familyCaregiverRelation: state.familyCaregiverRelation,
      familyCaregiverRelationOtherNote: state.familyCaregiverRelation === 'อื่นๆ' ? val('#cg2-fcrelation-note') : ''
    };

    const submitBtn = form.querySelector('#cg2-profile-submit');
    submitBtn.disabled = true;
    try {
      await apiCall('patients.update', { patientId: patient.patientId, patch });
      showToast('บันทึกข้อมูลโปรไฟล์สำเร็จ', 'success');
      await ctx.onSaved();
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ============================================================
 * ฟอร์มเพิ่มบันทึกการเยี่ยม (append-only) — ส่งผ่าน cg2logs.create
 * ============================================================ */

/**
 * @param {HTMLElement} container
 * @param {{patientId:string, onCancel:Function, onSaved:Function}} ctx
 */
function renderLogForm(container, ctx) {
  const state = {
    logDate: todayIso(),
    symptomTrend: '',
    conditionNote: '',
    temp: '', pulse: '', respRate: '', bp: '', waistCircumference: '',
    dementiaScore: '', depressionScore: '', adlScore: '', taiScore: '',
    caregiverPresent: null,
    recommendations: [],
    recommendationOtherNote: ''
  };

  container.innerHTML = `
    <form id="cg2-log-form" class="flat-card bg-white rounded-2xl p-4 mb-4 space-y-3">
      <p class="text-sm font-semibold text-slate-700">เพิ่มบันทึกการเยี่ยม</p>
      <p id="cg2-log-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>
      <div id="cg2-log-fields"></div>
      <div class="flex gap-2">
        <button id="cg2-log-cancel" type="button" class="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">ยกเลิก</button>
        <button id="cg2-log-submit" type="submit" class="flex-1 py-2 rounded-xl accent-gradient text-white text-sm font-medium">บันทึก</button>
      </div>
    </form>
  `;

  const form = container.querySelector('#cg2-log-form');
  const errorEl = container.querySelector('#cg2-log-error');
  const fieldsEl = form.querySelector('#cg2-log-fields');

  function paintFields() {
    fieldsEl.innerHTML = `
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">วันที่เยี่ยม *</label>
        <input id="cg2-logdate" type="text" value="${escapeHtml(state.logDate)}"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
      </div>
      <div>
        <p class="text-xs font-medium text-slate-600 mb-1.5">สรุปอาการปัจจุบัน *</p>
        <div id="cg2-symptomtrend">${singleChoice({ name: 'symptomtrend', options: SYMPTOM_TREND_OPTIONS, selectedValue: state.symptomTrend })}</div>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">สภาพ/อาการที่พบ (ร่างกาย/จิตใจ)</label>
        <textarea id="cg2-conditionnote" rows="2"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml(state.conditionNote)}</textarea>
      </div>

      <p class="text-xs font-semibold text-slate-600 pt-1">การคัดกรองสุขภาพ</p>
      <div class="grid grid-cols-2 gap-3">
        ${floatField({ id: 'cg2-temp', label: 'อุณหภูมิ (°C)', value: state.temp })}
        ${floatField({ id: 'cg2-pulse', label: 'ชีพจร (ครั้ง/นาที)', value: state.pulse })}
        ${floatField({ id: 'cg2-resprate', label: 'อัตราการหายใจ', value: state.respRate })}
        ${floatField({ id: 'cg2-bp', label: 'ความดันโลหิต', value: state.bp })}
        <div class="col-span-2">${floatField({ id: 'cg2-waist', label: 'รอบเอว (ซม.)', value: state.waistCircumference })}</div>
      </div>

      <p class="text-xs font-semibold text-slate-600 pt-1">คะแนนประเมิน (ถ้ามี)</p>
      <div class="grid grid-cols-2 gap-3">
        ${floatField({ id: 'cg2-dementia', label: 'คะแนนภาวะสมองเสื่อม', value: state.dementiaScore })}
        ${floatField({ id: 'cg2-depression', label: 'คะแนนภาวะซึมเศร้า', value: state.depressionScore })}
        ${floatField({ id: 'cg2-adl', label: 'คะแนน ADL', value: state.adlScore })}
        ${floatField({ id: 'cg2-tai', label: 'คะแนน TAI', value: state.taiScore })}
      </div>

      <div>
        <p class="text-xs font-medium text-slate-600 mb-1.5">ผู้ดูแลที่บ้าน</p>
        <div id="cg2-caregiverpresent">${yesNoToggle({ name: 'caregiverpresent', value: state.caregiverPresent, yesLabel: 'มี', noLabel: 'ไม่มี' })}</div>
      </div>

      <div>
        <p class="text-xs font-medium text-slate-600 mb-1.5">คำแนะนำ/กิจกรรมที่ให้</p>
        <div id="cg2-recommendations">${chipMultiSelect({ name: 'recommendations', options: RECOMMENDATION_OPTIONS, selectedValues: state.recommendations })}</div>
        <div id="cg2-recnote-wrap" class="mt-2 ${state.recommendations.includes('อื่นๆ') ? '' : 'hidden'}">
          <input id="cg2-recnote" type="text" value="${escapeHtml(state.recommendationOtherNote)}" placeholder="ระบุคำแนะนำอื่น ๆ"
            class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
      </div>
    `;
    wireFields();
  }

  function wireFields() {
    const dateInput = fieldsEl.querySelector('#cg2-logdate');
    const thisYear = new Date().getFullYear();
    initThaiDatePicker(dateInput, { maxDate: 'today', minYear: thisYear - 5, maxYear: thisYear });
    dateInput.addEventListener('input', (e) => { state.logDate = e.target.value; });

    wireSingleChoice(fieldsEl, 'symptomtrend', (value) => { state.symptomTrend = value; paintFields(); });

    fieldsEl.querySelector('#cg2-conditionnote').addEventListener('input', (e) => { state.conditionNote = e.target.value; });

    const textFieldMap = {
      '#cg2-temp': 'temp', '#cg2-pulse': 'pulse', '#cg2-resprate': 'respRate', '#cg2-bp': 'bp', '#cg2-waist': 'waistCircumference',
      '#cg2-dementia': 'dementiaScore', '#cg2-depression': 'depressionScore', '#cg2-adl': 'adlScore', '#cg2-tai': 'taiScore'
    };
    Object.keys(textFieldMap).forEach((selector) => {
      const el = fieldsEl.querySelector(selector);
      if (el) el.addEventListener('input', (e) => { state[textFieldMap[selector]] = e.target.value; });
    });

    wireYesNo(fieldsEl, 'caregiverpresent', (value) => { state.caregiverPresent = value; paintFields(); });

    wireChips(fieldsEl, 'recommendations', (value) => {
      state.recommendations = toggleArrayValue(state.recommendations, value);
      paintFields();
    });

    const recNote = fieldsEl.querySelector('#cg2-recnote');
    if (recNote) recNote.addEventListener('input', (e) => { state.recommendationOtherNote = e.target.value; });
  }

  paintFields();

  container.querySelector('#cg2-log-cancel').addEventListener('click', () => ctx.onCancel());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');

    if (!state.logDate) {
      errorEl.textContent = 'กรุณาระบุวันที่เยี่ยม';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!state.symptomTrend) {
      errorEl.textContent = 'กรุณาเลือกสรุปอาการปัจจุบัน';
      errorEl.classList.remove('hidden');
      return;
    }

    const submitBtn = form.querySelector('#cg2-log-submit');
    submitBtn.disabled = true;
    try {
      await apiCall('cg2logs.create', { patientId: ctx.patientId, ...state });
      showToast('บันทึกการเยี่ยมสำเร็จ', 'success');
      await ctx.onSaved();
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ============================================================
 * ประวัติการเยี่ยม (อ่านอย่างเดียว)
 * ============================================================ */

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} items
 */
function renderLogList(container, items) {
  if (!items || items.length === 0) {
    renderEmptyState(container, {
      title: 'ยังไม่มีบันทึกการเยี่ยมสำหรับผู้ป่วยรายนี้',
      message: 'กด "เพิ่มบันทึกการเยี่ยม" ด้านบนเพื่อเริ่มต้น'
    });
    return;
  }

  container.innerHTML = items.map((log, i) => `
    <div class="flat-card animate-rise-in bg-white rounded-2xl p-4 mb-3" style="--delay:${Math.min(i, 8) * 40}ms">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold text-slate-800">${escapeHtml(formatThaiDateDisplay(log.logDate))}</p>
        <span class="text-xs font-medium px-2 py-0.5 rounded-full ${symptomTrendBadgeClass(log.symptomTrend)}">${escapeHtml(log.symptomTrend)}</span>
      </div>
      ${log.conditionNote ? `<p class="text-xs text-slate-600 mt-1.5">${escapeHtml(log.conditionNote)}</p>` : ''}
      <p class="text-xs text-slate-400 mt-2">
        ${[
          log.temp ? 'T ' + escapeHtml(log.temp) : '',
          log.pulse ? 'PR ' + escapeHtml(log.pulse) : '',
          log.respRate ? 'RR ' + escapeHtml(log.respRate) : '',
          log.bp ? 'BP ' + escapeHtml(log.bp) : '',
          log.waistCircumference ? 'รอบเอว ' + escapeHtml(log.waistCircumference) : ''
        ].filter(Boolean).join(' · ') || 'ไม่ได้บันทึกสัญญาณชีพ'}
      </p>
      ${(log.dementiaScore || log.depressionScore || log.adlScore || log.taiScore) ? `
        <p class="text-xs text-slate-400 mt-1">
          ${[
            log.dementiaScore ? 'สมองเสื่อม ' + escapeHtml(log.dementiaScore) : '',
            log.depressionScore ? 'ซึมเศร้า ' + escapeHtml(log.depressionScore) : '',
            log.adlScore ? 'ADL ' + escapeHtml(log.adlScore) : '',
            log.taiScore ? 'TAI ' + escapeHtml(log.taiScore) : ''
          ].filter(Boolean).join(' · ')}
        </p>
      ` : ''}
      <div class="flex items-center flex-wrap gap-1.5 mt-2">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full ${log.caregiverPresent ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
          ผู้ดูแลที่บ้าน: ${log.caregiverPresent ? 'มี' : 'ไม่มี'}
        </span>
        ${log.recommendations.map((r) => `<span class="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${escapeHtml(r)}</span>`).join('')}
      </div>
      ${log.recommendationOtherNote ? `<p class="text-xs text-slate-400 mt-1">↳ ${escapeHtml(log.recommendationOtherNote)}</p>` : ''}
      <p class="text-xs text-slate-300 mt-2">บันทึกเมื่อ ${escapeHtml(formatThaiDateTime(log.createdAt))}</p>
    </div>
  `).join('');
}
