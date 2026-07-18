/**
 * screens/care-plan.js
 * แผนการดูแลผู้ป่วย (Care Plan) — สร้าง/แก้ไข (draft ↔ pendingApproval) และอนุมัติ/ปฏิเสธ (ADMIN, CM เท่านั้น)
 * รายการปัญหา/เป้าหมาย/กิจกรรม กรอกเป็น textarea บรรทัดละ 1 รายการ เพื่อความง่ายในการกรอกบนมือถือ
 */
import { apiCall } from '../api.js';
import { hasRole } from '../auth.js';
import { renderCardSkeleton, renderEmptyState, renderBreadcrumb, showToast, confirmDialog, promptDialog, escapeHtml } from '../ui.js';
import { initThaiAppointmentDatePicker, formatThaiDateDisplay } from '../date-picker.js';
import { carePlanStatusLabel, carePlanStatusBadgeClass } from '../constants.js';

/**
 * @param {HTMLElement} content
 * @param {{id: string}} params
 */
export async function renderCarePlan(content, params) {
  const patientId = params.id;
  const canReview = hasRole('ADMIN', 'CM');
  const canEditPlans = hasRole('ADMIN', 'CM', 'CG');

  content.innerHTML = `
    <div class="px-4 py-5 max-w-2xl mx-auto">
      <div id="cp-breadcrumb"></div>
      <div id="cp-patient-header"></div>
      <div class="flex items-center justify-between mt-4 mb-3">
        <h1 class="text-lg font-bold text-slate-800">แผนการดูแล (Care Plan)</h1>
        ${canEditPlans ? '<button id="cp-new-btn" type="button" class="px-3 py-2 rounded-xl accent-gradient text-white text-sm font-medium">+ สร้างแผนใหม่</button>' : ''}
      </div>
      <div id="cp-new-form-slot"></div>
      <div id="cp-list"></div>
    </div>
  `;

  renderBreadcrumb(content.querySelector('#cp-breadcrumb'), [
    { label: 'ผู้ป่วย', href: '#/patients' },
    { label: 'รายละเอียด', href: `#/patients/${encodeURIComponent(patientId)}` },
    { label: 'Care Plan' }
  ]);

  const patientHeaderEl = content.querySelector('#cp-patient-header');
  const listEl = content.querySelector('#cp-list');
  const newBtn = content.querySelector('#cp-new-btn');
  const newFormSlot = content.querySelector('#cp-new-form-slot');

  renderCardSkeleton(patientHeaderEl);

  async function loadPatientHeader() {
    const data = await apiCall('patients.get', { patientId });
    patientHeaderEl.innerHTML = `
      <div class="flat-card bg-white rounded-2xl p-4">
        <p class="text-sm font-semibold text-slate-800">${escapeHtml(data.patient.name)}</p>
        <p class="text-xs text-slate-400">HN ${escapeHtml(data.patient.hn)}</p>
      </div>
    `;
  }

  async function loadPlans() {
    listEl.innerHTML = '';
    renderCardSkeleton(listEl);
    const data = await apiCall('careplans.list', { patientId, pageSize: 20 });
    renderPlanList(listEl, data.items, { patientId, canReview, canEditPlans, onChange: loadPlans });
  }

  if (newBtn) {
    newBtn.addEventListener('click', () => {
      if (newFormSlot.innerHTML) {
        newFormSlot.innerHTML = '';
        return;
      }
      renderPlanForm(newFormSlot, null, {
        patientId,
        onCancel: () => { newFormSlot.innerHTML = ''; },
        onSaved: async () => { newFormSlot.innerHTML = ''; await loadPlans(); }
      });
    });
  }

  await Promise.all([loadPatientHeader(), loadPlans()]);
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} plans
 * @param {{patientId:string, canReview:boolean, onChange:Function}} ctx
 */
function renderPlanList(container, plans, ctx) {
  if (!plans || plans.length === 0) {
    renderEmptyState(container, {
      title: 'ยังไม่มีแผนการดูแลสำหรับผู้ป่วยรายนี้',
      message: 'กด "+ สร้างแผนใหม่" ด้านบนเพื่อเริ่มต้น'
    });
    return;
  }

  container.innerHTML = plans.map((plan) => `<div class="mb-3" data-plan-slot="${escapeHtml(plan.carePlanId)}"></div>`).join('');

  plans.forEach((plan) => {
    const slot = container.querySelector(`[data-plan-slot="${cssEscape(plan.carePlanId)}"]`);
    renderPlanCard(slot, plan, ctx);
  });
}

/**
 * @param {string} value
 * @return {string}
 */
function cssEscape(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}

const EDITABLE_STATUSES = ['draft', 'pendingApproval'];

/**
 * @param {HTMLElement} slot
 * @param {Object} plan
 * @param {{patientId:string, canReview:boolean, onChange:Function}} ctx
 */
function renderPlanCard(slot, plan, ctx) {
  const canEdit = ctx.canEditPlans && EDITABLE_STATUSES.indexOf(plan.status) !== -1;
  const canSubmitForApproval = ctx.canEditPlans && plan.status === 'draft';
  const canApprove = ctx.canReview && plan.status === 'pendingApproval';
  const safeId = cssEscapeId(plan.carePlanId);

  slot.innerHTML = `
    <div class="flat-card bg-white rounded-2xl p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium px-2 py-1 rounded-full ${carePlanStatusBadgeClass(plan.status)}">${escapeHtml(carePlanStatusLabel(plan.status))}</span>
        <span class="text-xs text-slate-400">${escapeHtml(plan.reviewDate ? 'นัดทบทวน ' + formatThaiDateDisplay(plan.reviewDate) : '')}</span>
      </div>
      ${renderPlanSection('ปัญหา', plan.problems)}
      ${renderPlanSection('เป้าหมาย', plan.goals)}
      ${renderPlanSection('กิจกรรม/การดูแล', plan.interventions)}
      ${plan.status === 'rejected' && plan.rejectedReason ? `<p class="text-xs text-rose-600 mt-2">เหตุผลที่ปฏิเสธ: ${escapeHtml(plan.rejectedReason)}</p>` : ''}
      <div id="cp-card-actions-${escapeHtml(safeId)}" class="flex flex-wrap gap-2 mt-3"></div>
      <div id="cp-card-edit-${escapeHtml(safeId)}"></div>
    </div>
  `;

  const actionsEl = slot.querySelector(`#cp-card-actions-${safeId}`);
  const editSlotEl = slot.querySelector(`#cp-card-edit-${safeId}`);
  const buttons = [];

  if (canEdit) buttons.push(`<button data-action="edit" type="button" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">แก้ไข</button>`);
  if (canSubmitForApproval) buttons.push(`<button data-action="submit" type="button" class="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-medium">ส่งขออนุมัติ</button>`);
  if (canApprove) {
    buttons.push(`<button data-action="approve" type="button" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium">อนุมัติ</button>`);
    buttons.push(`<button data-action="reject" type="button" class="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-xs font-medium">ปฏิเสธ</button>`);
  }
  actionsEl.innerHTML = buttons.join('');

  const editBtn = actionsEl.querySelector('[data-action="edit"]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (editSlotEl.innerHTML) {
        editSlotEl.innerHTML = '';
        return;
      }
      renderPlanForm(editSlotEl, plan, {
        patientId: ctx.patientId,
        onCancel: () => { editSlotEl.innerHTML = ''; },
        onSaved: async () => { editSlotEl.innerHTML = ''; await ctx.onChange(); }
      });
    });
  }

  const submitBtn = actionsEl.querySelector('[data-action="submit"]');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const confirmed = await confirmDialog('ส่งแผนการดูแลนี้เพื่อขออนุมัติหรือไม่?');
      if (!confirmed) return;
      try {
        await apiCall('careplans.update', { carePlanId: plan.carePlanId, patch: { status: 'pendingApproval' } });
        showToast('ส่งขออนุมัติแล้ว', 'success');
        await ctx.onChange();
      } catch (err) {
        showToast(err && err.message ? err.message : 'เกิดข้อผิดพลาด', 'error');
      }
    });
  }

  const approveBtn = actionsEl.querySelector('[data-action="approve"]');
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      const confirmed = await confirmDialog('อนุมัติแผนการดูแลนี้หรือไม่?');
      if (!confirmed) return;
      try {
        await apiCall('careplans.approve', { carePlanId: plan.carePlanId, decision: 'approve' });
        showToast('อนุมัติแผนการดูแลแล้ว', 'success');
        await ctx.onChange();
      } catch (err) {
        showToast(err && err.message ? err.message : 'เกิดข้อผิดพลาด', 'error');
      }
    });
  }

  const rejectBtn = actionsEl.querySelector('[data-action="reject"]');
  if (rejectBtn) {
    rejectBtn.addEventListener('click', async () => {
      const reason = await promptDialog('กรุณาระบุเหตุผลที่ปฏิเสธแผนการดูแลนี้', { placeholder: 'เหตุผล...' });
      if (reason === null) return;
      try {
        await apiCall('careplans.approve', { carePlanId: plan.carePlanId, decision: 'reject', reason });
        showToast('ปฏิเสธแผนการดูแลแล้ว', 'success');
        await ctx.onChange();
      } catch (err) {
        showToast(err && err.message ? err.message : 'เกิดข้อผิดพลาด', 'error');
      }
    });
  }
}

/** @param {string} value @return {string} เวอร์ชันปลอดภัยสำหรับใช้เป็น CSS id selector */
function cssEscapeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/**
 * @param {string} label
 * @param {Array<string>} items
 * @return {string}
 */
function renderPlanSection(label, items) {
  if (!items || items.length === 0) return '';
  return `
    <div class="mb-2">
      <p class="text-xs font-medium text-slate-500">${escapeHtml(label)}</p>
      <ul class="list-disc list-inside text-sm text-slate-700">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * ฟอร์มสร้าง/แก้ไขแผนการดูแล (ใช้ทั้งสร้างใหม่และแก้ไข ขึ้นกับว่ามี existingPlan หรือไม่)
 * @param {HTMLElement} container
 * @param {Object|null} existingPlan
 * @param {{patientId:string, onCancel:Function, onSaved:Function}} ctx
 */
function renderPlanForm(container, existingPlan, ctx) {
  const v = existingPlan || { problems: [], goals: [], interventions: [], reviewDate: '' };
  container.innerHTML = `
    <form id="cp-form" class="border border-slate-100 rounded-xl p-3 mt-2 space-y-3 bg-slate-50">
      <p id="cp-form-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">ปัญหา (1 บรรทัดต่อ 1 รายการ)</label>
        <textarea id="cp-problems" rows="3" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml((v.problems || []).join('\n'))}</textarea>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">เป้าหมาย (1 บรรทัดต่อ 1 รายการ)</label>
        <textarea id="cp-goals" rows="3" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml((v.goals || []).join('\n'))}</textarea>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">กิจกรรม/การดูแล (1 บรรทัดต่อ 1 รายการ)</label>
        <textarea id="cp-interventions" rows="3" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">${escapeHtml((v.interventions || []).join('\n'))}</textarea>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">วันนัดทบทวนแผน</label>
        <input id="cp-reviewdate" type="text" value="${escapeHtml(v.reviewDate || '')}" placeholder="เลือกวันนัด (พ.ศ.)"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
      </div>
      <div class="flex gap-2">
        <button id="cp-form-cancel" type="button" class="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">ยกเลิก</button>
        <button id="cp-form-submit" type="submit" class="flex-1 py-2 rounded-xl accent-gradient text-white text-sm font-medium">บันทึก</button>
      </div>
    </form>
  `;

  const form = container.querySelector('#cp-form');
  const errorEl = container.querySelector('#cp-form-error');

  initThaiAppointmentDatePicker(form.querySelector('#cp-reviewdate'));

  container.querySelector('#cp-form-cancel').addEventListener('click', () => ctx.onCancel());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');

    const problems = splitLines(form.querySelector('#cp-problems').value);
    const goals = splitLines(form.querySelector('#cp-goals').value);
    const interventions = splitLines(form.querySelector('#cp-interventions').value);
    const reviewDate = form.querySelector('#cp-reviewdate').value;

    const submitBtn = form.querySelector('#cp-form-submit');
    submitBtn.disabled = true;
    try {
      if (existingPlan) {
        await apiCall('careplans.update', {
          carePlanId: existingPlan.carePlanId,
          patch: { problems, goals, interventions, reviewDate }
        });
        showToast('บันทึกแผนการดูแลสำเร็จ', 'success');
      } else {
        await apiCall('careplans.create', { patientId: ctx.patientId, problems, goals, interventions, reviewDate });
        showToast('สร้างแผนการดูแลใหม่สำเร็จ', 'success');
      }
      await ctx.onSaved();
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/** @param {string} text @return {Array<string>} */
function splitLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
