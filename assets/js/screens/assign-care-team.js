/**
 * screens/assign-care-team.js
 * มอบหมายผู้ดูแลหลัก (CG) และ Case Manager (CM) ให้ผู้ป่วยรายหนึ่ง ผ่าน action patients.assignCareTeam
 *
 * ข้อจำกัดตามจริงของ backend (Router.gs อนุญาต action นี้ให้ ADMIN, CM):
 * - ADMIN: มอบหมายได้ทั้ง CG และ CM ของผู้ป่วยรายใดก็ได้ — มี dropdown ให้เลือกทั้งคู่ (ผ่าน admin.users.list)
 * - CM: มอบหมายได้เฉพาะ CG ของผู้ป่วยที่ตนรับผิดชอบอยู่แล้วเท่านั้น (assignCareTeam.gs ปฏิเสธถ้า CM พยายามเปลี่ยน CM)
 *        และ CM ไม่มีสิทธิ์เรียก admin.users.list เพื่อทำ dropdown รายชื่อ CG ได้ — จึงให้กรอกรหัสผู้ใช้ CG ตรง ๆ แทน
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import { renderCardSkeleton, showToast, escapeHtml } from '../ui.js';
import { getUsersByRole } from '../directory.js';

/**
 * @param {HTMLElement} content
 * @param {{id: string}} params
 */
export async function renderAssignCareTeam(content, params) {
  const patientId = params.id;
  const isAdmin = hasRole('ADMIN');

  content.innerHTML = `
    <div class="px-4 py-5 max-w-xl">
      <a href="#/patients/${encodeURIComponent(patientId)}" class="text-sm text-sky-600 mb-3 inline-block">← กลับไปรายละเอียดผู้ป่วย</a>
      <h1 class="text-lg font-bold text-slate-800 mb-4">มอบหมายทีมดูแล</h1>
      <div id="ac-body"></div>
    </div>
  `;

  const bodyEl = content.querySelector('#ac-body');
  renderCardSkeleton(bodyEl);

  const [patientData, cgOptions] = await Promise.all([
    apiCall('patients.get', { patientId }),
    isAdmin ? getUsersByRole('CG') : Promise.resolve([])
  ]);
  const cmOptions = isAdmin ? await getUsersByRole('CM') : [];
  const patient = patientData.patient;

  bodyEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm p-4 mb-4">
      <p class="text-sm font-semibold text-slate-800">${escapeHtml(patient.name)}</p>
      <p class="text-xs text-slate-400">HN ${escapeHtml(patient.hn)}</p>
    </div>

    <form id="ac-form" class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
      <p id="ac-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>

      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">ผู้ดูแลหลัก (CG)</label>
        ${isAdmin ? `
          <select id="ac-cg" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">ยังไม่มอบหมาย</option>
            ${cgOptions.map((u) => `<option value="${escapeHtml(u.userId)}" ${patient.primaryCgUserId === u.userId ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
          </select>
        ` : `
          <input id="ac-cg" type="text" value="${escapeHtml(patient.primaryCgUserId || '')}" placeholder="เช่น U-a1b2c3"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <p class="text-xs text-slate-400 mt-1">ไม่มีสิทธิ์เรียกดูรายชื่อ CG ทั้งหมด กรุณากรอกรหัสผู้ใช้ CG โดยตรง (เว้นว่างเพื่อยกเลิกการมอบหมาย)</p>
        `}
      </div>

      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Case Manager (CM)</label>
        ${isAdmin ? `
          <select id="ac-cm" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">ยังไม่มอบหมาย</option>
            ${cmOptions.map((u) => `<option value="${escapeHtml(u.userId)}" ${patient.responsibleCmUserId === u.userId ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
          </select>
        ` : `
          <input type="text" value="${escapeHtml(patient.responsibleCmUserId || 'ยังไม่มอบหมาย')}" disabled
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-400" />
          <p class="text-xs text-slate-400 mt-1">การโอนผู้ป่วยไปยัง Case Manager คนอื่นต้องดำเนินการโดยผู้ดูแลระบบ (ADMIN) เท่านั้น</p>
        `}
      </div>

      <button id="ac-submit-btn" type="submit" class="w-full py-3 rounded-xl bg-sky-600 text-white font-medium text-sm">บันทึกการมอบหมาย</button>
    </form>
  `;

  const form = bodyEl.querySelector('#ac-form');
  const errorEl = bodyEl.querySelector('#ac-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');

    const cgInput = form.querySelector('#ac-cg');
    const cmInput = form.querySelector('#ac-cm');
    const payload = { patientId, primaryCgUserId: cgInput.value.trim() };
    if (isAdmin && cmInput) {
      payload.responsibleCmUserId = cmInput.value.trim();
    }

    const submitBtn = form.querySelector('#ac-submit-btn');
    submitBtn.disabled = true;
    try {
      await apiCall('patients.assignCareTeam', payload);
      showToast('บันทึกการมอบหมายทีมดูแลสำเร็จ', 'success');
      location.hash = `/patients/${encodeURIComponent(patientId)}`;
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
