/**
 * screens/patient-form.js
 * ฟอร์มเพิ่ม/แก้ไขผู้ป่วย ใช้ไฟล์เดียวกันทั้งสองโหมด (โหมด edit ถ้า params.id มีค่า)
 *
 * ข้อจำกัดที่ตั้งใจออกแบบตามจริงของ backend (ไม่ใช่ bug):
 * - แก้ไขได้เฉพาะฟิลด์ที่ updatePatient() อนุญาต (PATIENT_PATCH_ALLOWED_KEYS_) — ไม่รวม CID (เปลี่ยนไม่ได้หลังสร้าง)
 *   และไม่รวมการมอบหมาย CG/CM (ต้องทำผ่านหน้า "มอบหมายทีมดูแล" แยกต่างหาก ผ่าน action assignCareTeam เท่านั้น)
 * - การมอบหมาย CG/CM ตอน "สร้างใหม่" ทำได้เฉพาะ ADMIN (เลือกจาก dropdown ที่ดึงจาก admin.users.list ซึ่งเป็น action
 *   ที่ Router.gs อนุญาตเฉพาะ ADMIN) — ถ้าเป็น CM สร้างผู้ป่วยใหม่ ระบบจะกำหนด responsibleCmUserId เป็นตัวเองอัตโนมัติ
 *   (กันเคสผู้ป่วยที่สร้างไม่มีเจ้าของ แล้ว CM มองไม่เห็นผู้ป่วยที่ตัวเองเพิ่งสร้างอีกเลย) และให้กรอกรหัส CG แบบพิมพ์เอง
 *   เป็นทางเลือก (ไม่มี dropdown ให้ เพราะ CM ไม่มีสิทธิ์เรียก admin.users.list)
 */
import { apiCall } from '../api.js';
import { getCurrentUser, hasRole } from '../auth.js';
import { renderCardSkeleton, showToast, escapeHtml } from '../ui.js';
import { getUsersByRole } from '../directory.js';
import { isNonEmptyString, isValidThaiCid, isValidIsoDate, formatCidInput } from '../validation.js';
import { initThaiBirthDatePicker, initThaiAppointmentDatePicker, computeAgeFromIsoDate } from '../date-picker.js';
import { GENDER_OPTIONS, PATIENT_STATUS_OPTIONS } from '../constants.js';

/**
 * @param {HTMLElement} content
 * @param {{id?: string}} params
 */
export async function renderPatientForm(content, params) {
  const isEdit = !!(params && params.id);
  const currentUser = getCurrentUser();

  content.innerHTML = `<div class="px-4 py-5 max-w-xl mx-auto"><div id="pf-body"></div></div>`;
  const bodyEl = content.querySelector('#pf-body');
  renderCardSkeleton(bodyEl);

  let patient = null;
  let cgOptions = [];
  let cmOptions = [];

  if (isEdit) {
    const data = await apiCall('patients.get', { patientId: params.id });
    patient = data.patient;
  } else if (hasRole('ADMIN')) {
    [cgOptions, cmOptions] = await Promise.all([getUsersByRole('CG'), getUsersByRole('CM')]);
  }

  bodyEl.innerHTML = buildFormHtml({ isEdit, patient, currentUser, cgOptions, cmOptions });

  const form = bodyEl.querySelector('#pf-form');
  const errorEl = bodyEl.querySelector('#pf-error');

  initThaiBirthDatePicker(form.querySelector('#pf-birthdate'));
  initThaiAppointmentDatePicker(form.querySelector('#pf-nextvisit'));

  // อายุคำนวณสดจากวันเกิดด้วยสูตรเดียวกับ computeAge_ ฝั่ง backend — เป็นตัวช่วยยืนยันสายตาว่าเลือกปีถูก
  // (พลาดปี พ.ศ./ค.ศ. สลับกันจะเห็นทันทีว่าอายุเพี้ยนเป็นหลักร้อย) ไม่ได้ส่งขึ้น backend เพราะ backend
  // คำนวณเองจาก BirthDate อยู่แล้วและไม่มีคอลัมน์ Age ให้เก็บ
  const birthInput = form.querySelector('#pf-birthdate');
  const ageEl = form.querySelector('#pf-age');
  function paintAge() {
    const age = computeAgeFromIsoDate(birthInput.value);
    ageEl.textContent = age === null ? '' : `อายุ ${age} ปี`;
    ageEl.classList.toggle('text-rose-600', age !== null && (age < 0 || age > 120));
    ageEl.classList.toggle('text-slate-400', !(age !== null && (age < 0 || age > 120)));
  }
  // flatpickr ยิง event 'change' บน input ตัวจริงทุกครั้งที่ค่าเปลี่ยน ไม่ว่าจะเลือกจากปฏิทินหรือพิมพ์เอง
  birthInput.addEventListener('change', paintAge);
  paintAge();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');

    const values = readFormValues(form);
    const validationError = validateForm(values, isEdit);
    if (validationError) {
      errorEl.textContent = validationError;
      errorEl.classList.remove('hidden');
      return;
    }

    const submitBtn = form.querySelector('#pf-submit-btn');
    submitBtn.disabled = true;
    try {
      if (isEdit) {
        const patch = {
          name: values.name, hn: values.hn, gender: values.gender, birthDate: values.birthDate,
          village: values.village, tambon: values.tambon, amphoe: values.amphoe, changwat: values.changwat,
          status: values.status, nextVisitDate: values.nextVisitDate || ''
        };
        const result = await apiCall('patients.update', { patientId: params.id, patch });
        showToast('บันทึกข้อมูลผู้ป่วยสำเร็จ', 'success');
        location.hash = `/patients/${encodeURIComponent(result.patient.patientId)}`;
      } else {
        const payload = {
          name: values.name, gender: values.gender, birthDate: values.birthDate, hn: values.hn, cid: values.cid,
          village: values.village, tambon: values.tambon, amphoe: values.amphoe, changwat: values.changwat,
          nextVisitDate: values.nextVisitDate || ''
        };
        if (hasRole('ADMIN')) {
          if (values.primaryCgUserId) payload.primaryCgUserId = values.primaryCgUserId;
          if (values.responsibleCmUserId) payload.responsibleCmUserId = values.responsibleCmUserId;
        } else if (hasRole('CM')) {
          payload.responsibleCmUserId = currentUser.userId;
          if (values.primaryCgUserId) payload.primaryCgUserId = values.primaryCgUserId;
        }
        const result = await apiCall('patients.create', payload);
        showToast('เพิ่มผู้ป่วยใหม่สำเร็จ', 'success');
        location.hash = `/patients/${encodeURIComponent(result.patient.patientId)}`;
      }
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/**
 * @param {{isEdit:boolean, patient:Object|null, currentUser:Object, cgOptions:Array, cmOptions:Array}} ctx
 * @return {string}
 */
function buildFormHtml(ctx) {
  const { isEdit, patient, currentUser, cgOptions, cmOptions } = ctx;
  const v = patient || {};

  const cidField = isEdit
    ? `<div>
        <label class="block text-xs font-medium text-slate-500 mb-1">เลขประจำตัวประชาชน</label>
        <input type="text" value="${escapeHtml(v.cid || v.cidMasked || '')}" disabled
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-400" />
        <p class="text-xs text-slate-400 mt-1">แก้ไขเลขบัตรประชาชนไม่ได้หลังสร้างผู้ป่วยแล้ว</p>
      </div>`
    : `<div>
        <label class="block text-xs font-medium text-slate-500 mb-1">เลขประจำตัวประชาชน 13 หลัก *</label>
        <input id="pf-cid" name="cid" type="text" inputmode="numeric" maxlength="13"
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
      </div>`;

  const assignmentFields = !isEdit ? buildAssignmentFieldsHtml(currentUser, cgOptions, cmOptions) : '';
  const statusField = isEdit
    ? `<div>
        <label class="block text-xs font-medium text-slate-500 mb-1">สถานะ</label>
        <select id="pf-status" name="status" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
          ${PATIENT_STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${v.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </div>`
    : '';

  return `
    <a href="#/patients" class="text-sm text-sky-600 mb-3 inline-block">← กลับไปรายชื่อผู้ป่วย</a>
    <h1 class="text-lg font-bold text-slate-800 mb-4">${isEdit ? 'แก้ไขข้อมูลผู้ป่วย' : 'เพิ่มผู้ป่วยใหม่'}</h1>

    <form id="pf-form" class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
      <p id="pf-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>

      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-slate-500 mb-1">ชื่อ-นามสกุล *</label>
          <input id="pf-name" name="name" type="text" value="${escapeHtml(v.name || '')}"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">HN *</label>
          <input id="pf-hn" name="hn" type="text" value="${escapeHtml(v.hn || '')}"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">เพศ *</label>
          <select id="pf-gender" name="gender" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">เลือกเพศ</option>
            ${GENDER_OPTIONS.map((g) => `<option value="${escapeHtml(g)}" ${v.gender === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">วันเกิด *</label>
          <input id="pf-birthdate" name="birthDate" type="text" value="${escapeHtml(v.birthDate || '')}" placeholder="เลือกหรือพิมพ์ เช่น 16/7/2490"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <p id="pf-age" class="text-xs text-slate-400 mt-1"></p>
        </div>
        <div>${cidField}</div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">หมู่บ้าน *</label>
          <input id="pf-village" name="village" type="text" value="${escapeHtml(v.village || '')}"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">ตำบล *</label>
          <input id="pf-tambon" name="tambon" type="text" value="${escapeHtml(v.tambon || '')}"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">อำเภอ *</label>
          <input id="pf-amphoe" name="amphoe" type="text" value="${escapeHtml(v.amphoe || '')}"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">จังหวัด *</label>
          <input id="pf-changwat" name="changwat" type="text" value="${escapeHtml(v.changwat || '')}"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">วันนัดเยี่ยมถัดไป</label>
          <input id="pf-nextvisit" name="nextVisitDate" type="text" value="${escapeHtml(v.nextVisitDate || '')}" placeholder="เลือกวันนัด (พ.ศ.)"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        ${statusField}
      </div>

      ${assignmentFields}

      <button id="pf-submit-btn" type="submit" class="w-full py-3 rounded-xl bg-sky-600 text-white font-medium text-sm">
        ${isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ป่วย'}
      </button>
    </form>
  `;
}

/**
 * @param {Object} currentUser
 * @param {Array<Object>} cgOptions
 * @param {Array<Object>} cmOptions
 * @return {string}
 */
function buildAssignmentFieldsHtml(currentUser, cgOptions, cmOptions) {
  if (hasRole('ADMIN')) {
    return `
      <div class="border-t border-slate-100 pt-4 grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">ผู้ดูแลหลัก (CG)</label>
          <select id="pf-cg" name="primaryCgUserId" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">ยังไม่มอบหมาย</option>
            ${cgOptions.map((u) => `<option value="${escapeHtml(u.userId)}">${escapeHtml(u.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Case Manager (CM)</label>
          <select id="pf-cm" name="responsibleCmUserId" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">ยังไม่มอบหมาย</option>
            ${cmOptions.map((u) => `<option value="${escapeHtml(u.userId)}">${escapeHtml(u.name)}</option>`).join('')}
          </select>
        </div>
      </div>
    `;
  }
  // CM: ไม่มีสิทธิ์เรียก admin.users.list มาทำ dropdown ได้ — ให้กรอกรหัสผู้ใช้ CG ตรง ๆ เป็นทางเลือก
  return `
    <div class="border-t border-slate-100 pt-4">
      <p class="text-xs text-slate-400 mb-2">ผู้ป่วยรายนี้จะอยู่ในความรับผิดชอบของคุณ (${escapeHtml(currentUser.name)}) โดยอัตโนมัติ</p>
      <label class="block text-xs font-medium text-slate-500 mb-1">รหัสผู้ใช้ผู้ดูแลหลัก (CG) — ถ้าทราบ</label>
      <input id="pf-cg" name="primaryCgUserId" type="text" placeholder="เช่น U-a1b2c3"
        class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
      <p class="text-xs text-slate-400 mt-1">ไม่ทราบรหัสให้เว้นว่างไว้ก่อน แล้วขอผู้ดูแลระบบมอบหมายให้ภายหลังได้</p>
    </div>
  `;
}

/**
 * @param {HTMLFormElement} form
 * @return {Object}
 */
function readFormValues(form) {
  const get = (id) => {
    const el = form.querySelector(id);
    return el ? el.value.trim() : '';
  };
  return {
    name: get('#pf-name'),
    hn: get('#pf-hn'),
    gender: get('#pf-gender'),
    birthDate: get('#pf-birthdate'),
    cid: formatCidInput(get('#pf-cid')),
    village: get('#pf-village'),
    tambon: get('#pf-tambon'),
    amphoe: get('#pf-amphoe'),
    changwat: get('#pf-changwat'),
    nextVisitDate: get('#pf-nextvisit'),
    status: get('#pf-status'),
    primaryCgUserId: get('#pf-cg'),
    responsibleCmUserId: get('#pf-cm')
  };
}

/**
 * @param {Object} values
 * @param {boolean} isEdit
 * @return {string|null} ข้อความ error ตัวแรกที่พบ หรือ null ถ้าผ่านหมด
 */
function validateForm(values, isEdit) {
  if (!isNonEmptyString(values.name)) return 'กรุณากรอกชื่อ-นามสกุล';
  if (!isNonEmptyString(values.hn)) return 'กรุณากรอก HN';
  if (!isNonEmptyString(values.gender)) return 'กรุณาเลือกเพศ';
  if (!isValidIsoDate(values.birthDate)) return 'กรุณาเลือกวันเกิดให้ถูกต้อง';
  // ปฏิทินจำกัดให้เลือกได้แค่ 120 ปีย้อนหลังและห้ามอนาคตอยู่แล้ว แต่ตอนนี้ผู้ใช้พิมพ์วันที่เองได้
  // ซึ่งข้ามข้อจำกัดนั้นไปได้ (พิมพ์ 1/1/2400 = อายุ 169 ปี ก็ผ่าน) — backend ก็ไม่ได้ตรวจ (isValidIsoDate_
  // เช็คแค่ว่า parse ได้) ถ้าไม่ดักตรงนี้ วันเกิดที่พิมพ์พลาดจะถูกบันทึกจริงและอายุในระบบเพี้ยนตามไปหมด
  const age = computeAgeFromIsoDate(values.birthDate);
  if (age === null || age < 0 || age > 120) {
    return `วันเกิดไม่สมเหตุสมผล (คำนวณอายุได้ ${age === null ? '-' : age} ปี) กรุณาตรวจสอบอีกครั้ง`;
  }
  if (!isNonEmptyString(values.village)) return 'กรุณากรอกหมู่บ้าน';
  if (!isNonEmptyString(values.tambon)) return 'กรุณากรอกตำบล';
  if (!isNonEmptyString(values.amphoe)) return 'กรุณากรอกอำเภอ';
  if (!isNonEmptyString(values.changwat)) return 'กรุณากรอกจังหวัด';
  if (!isEdit && !isValidThaiCid(values.cid)) return 'กรุณากรอกเลขประจำตัวประชาชนให้ครบ 13 หลักและถูกต้อง';
  if (values.nextVisitDate && !isValidIsoDate(values.nextVisitDate)) return 'วันนัดเยี่ยมถัดไปไม่ถูกต้อง';
  return null;
}
