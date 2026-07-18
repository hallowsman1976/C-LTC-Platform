/**
 * screens/admin/users.js
 * จัดการผู้ใช้ (/admin/users) ตาม BLUEPRINT.md §4 — ADMIN เท่านั้น (บังคับที่ router.js + ทุก action ฝั่ง backend อีกชั้น)
 *
 * ข้อจำกัดที่ตั้งใจตามจริงของ backend (UserService.gs) ไม่ใช่ bug:
 * - CG ล็อกอินด้วยเลขบัตรประชาชน ไม่มีรหัสผ่าน — ตอนสร้างจึงกรอก cid แทน username/password และรีเซ็ตรหัสผ่านไม่ได้
 *   (resetPassword ปฏิเสธ role CG ตรง ๆ) หน้านี้จึงซ่อนปุ่มรีเซ็ตของ CG ไม่ให้กดแล้วเจอ error เปล่า ๆ
 * - updateUser แก้ได้เฉพาะ USER_PATCH_ALLOWED_KEYS_ (name/phone/lineUserId/active/role) — username/cid/password
 *   แก้ที่นี่ไม่ได้เลย แต่ละอย่างมี flow ของตัวเอง
 * - รีเซ็ตรหัสผ่านโดยไม่ระบุรหัสใหม่ = backend สุ่มให้แล้วคืน temporaryPassword กลับมาครั้งเดียว ไม่มีเก็บไว้ที่ไหนอีก
 *   ถ้าไม่คัดลอกตอนนั้นคือหายเลย ต้องรีเซ็ตใหม่ — หน้านี้จึงโชว์ค้างไว้ให้คัดลอกจนกว่าจะปิดเอง
 */
import { apiCall } from '../../api.js';
import { renderListSkeleton, renderEmptyState, renderPagination, renderBreadcrumb, showToast, confirmDialog, escapeHtml } from '../../ui.js';
import { invalidateUserDirectoryCache } from '../../directory.js';
import { ROLE_LABELS, roleLabel } from '../../constants.js';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_PASSWORD_LENGTH = 8;   // ต้องตรงกับ MIN_PASSWORD_LENGTH_ ใน Auth.gs

const ROLE_BADGE_CLASS = {
  ADMIN: 'bg-rose-100 text-rose-700',
  CM: 'bg-sky-100 text-sky-700',
  CG: 'bg-emerald-100 text-emerald-700',
  VIEWER: 'bg-slate-100 text-slate-600'
};

/** @param {HTMLElement} content */
export async function renderAdminUsers(content) {
  const state = { search: '', role: '', page: 1, pageSize: PAGE_SIZE };
  let searchDebounceTimer = null;

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl mx-auto">
      <div id="au-breadcrumb"></div>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-bold text-slate-800">จัดการผู้ใช้</h1>
        <button id="au-new-btn" type="button" class="px-3 py-2 rounded-xl accent-gradient text-white text-sm font-medium">+ เพิ่มผู้ใช้</button>
      </div>

      <div id="au-new-form-slot"></div>

      <div class="flat-card bg-white rounded-2xl p-3 mb-4 space-y-2">
        <input id="au-search" type="text" placeholder="ค้นหาชื่อ, ชื่อผู้ใช้ หรือเลขบัตรประชาชน"
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        <select id="au-role" class="w-full px-2 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">ทุกบทบาท</option>
          ${Object.keys(ROLE_LABELS).map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(ROLE_LABELS[r])}</option>`).join('')}
        </select>
      </div>

      <div id="au-results" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"></div>
      <div id="au-pagination"></div>
    </div>
  `;

  renderBreadcrumb(content.querySelector('#au-breadcrumb'), [
    { label: 'ผู้ดูแลระบบ', href: '#/admin' },
    { label: 'จัดการผู้ใช้' }
  ]);

  const resultsEl = content.querySelector('#au-results');
  const paginationEl = content.querySelector('#au-pagination');
  const newFormSlot = content.querySelector('#au-new-form-slot');
  const searchInput = content.querySelector('#au-search');
  const roleSelect = content.querySelector('#au-role');

  // directory.js แคชรายชื่อผู้ใช้ไว้ในหน่วยความจำตลอดเซสชัน — ถ้าไม่ล้างหลังแก้ไข หน้า "มอบหมายทีมดูแล"
  // กับชื่อผู้ทำรายการใน Audit Log จะยังโชว์ข้อมูลเก่าจนกว่าจะรีเฟรชทั้งแอป
  async function reloadAfterMutation() {
    invalidateUserDirectoryCache();
    await loadList();
  }

  async function loadList() {
    renderListSkeleton(resultsEl, 5);
    paginationEl.innerHTML = '';
    const data = await apiCall('admin.users.list', {
      search: state.search, role: state.role, page: state.page, pageSize: state.pageSize
    });

    if (!data.items || data.items.length === 0) {
      renderEmptyState(resultsEl, { title: 'ไม่พบผู้ใช้ที่ตรงกับเงื่อนไขนี้', message: 'ลองปรับคำค้นหาหรือตัวกรองดูอีกครั้ง' });
      renderPagination(paginationEl, { page: 1, pageSize: state.pageSize, total: 0 }, () => {}, {
        pageSizeOptions: [10, 20, 50, 100],
        onPageSizeChange: (pageSize) => { state.pageSize = pageSize; state.page = 1; loadList(); }
      });
      return;
    }

    resultsEl.innerHTML = data.items.map((u) => userCardHtml(u)).join('');
    data.items.forEach((u) => wireUserCard(resultsEl, u, reloadAfterMutation));

    renderPagination(paginationEl, { page: data.page, pageSize: data.pageSize, total: data.total }, (nextPage) => {
      state.page = nextPage;
      loadList();
    }, {
      pageSizeOptions: [10, 20, 50, 100],
      onPageSizeChange: (pageSize) => {
        state.pageSize = pageSize;
        state.page = 1;
        loadList();
      }
    });
  }

  content.querySelector('#au-new-btn').addEventListener('click', () => {
    if (newFormSlot.innerHTML) {
      newFormSlot.innerHTML = '';
      return;
    }
    renderCreateForm(newFormSlot, {
      onCancel: () => { newFormSlot.innerHTML = ''; },
      onCreated: () => { newFormSlot.innerHTML = ''; state.page = 1; return reloadAfterMutation(); }
    });
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      loadList();
    }, SEARCH_DEBOUNCE_MS);
  });
  roleSelect.addEventListener('change', () => { state.role = roleSelect.value; state.page = 1; loadList(); });

  await loadList();
}

/**
 * ช่อง text input แบบ floating label — id ต้องไม่ชนกัน จึงรับ id เต็มจากผู้เรียก (การ์ดแก้ไขผู้ใช้เปิดพร้อมกันได้
 * หลายใบ ต่างจากฟอร์มเพิ่มผู้ใช้ใหม่ที่เปิดได้ทีละใบ — ผู้เรียกจึงต้องผูก userId เข้ากับ id เองตอนเป็นฟอร์มแก้ไข)
 * @param {{id:string, field:string, label:string, value?:string, required?:boolean, inputAttrs?:string}} f
 * @return {string}
 */
function floatField(f) {
  return `
    <div class="field-float">
      <input id="${f.id}" data-field="${f.field}" type="text" value="${escapeHtml(f.value || '')}" placeholder=" " ${f.inputAttrs || ''}
        class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition" />
      <label for="${f.id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
    </div>
  `;
}

/**
 * @param {Object} u user ที่ sanitizeUserForClient_ คืนมา (cid ถูก mask มาแล้ว ไม่มี PasswordHash)
 * @return {string}
 */
function userCardHtml(u) {
  const identity = u.username ? `ชื่อผู้ใช้ ${u.username}` : (u.cidMasked ? `บัตร ${u.cidMasked}` : '-');
  return `
    <div class="flat-card flat-card-interactive animate-rise-in bg-white rounded-2xl p-4" data-user-card="${escapeHtml(u.userId)}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(u.name)}</p>
          <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(identity)}${u.phone ? ' · ' + escapeHtml(u.phone) : ''}</p>
        </div>
        <div class="shrink-0 flex items-center gap-1.5">
          <span class="text-xs font-medium px-2 py-1 rounded-full ${ROLE_BADGE_CLASS[u.role] || 'bg-slate-100 text-slate-600'}">${escapeHtml(roleLabel(u.role))}</span>
          <span class="text-xs font-medium px-2 py-1 rounded-full ${u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}">${u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <button type="button" data-action="edit" class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium">แก้ไข</button>
        ${u.role !== 'CG' ? '<button type="button" data-action="reset" class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium">รีเซ็ตรหัสผ่าน</button>' : ''}
        <button type="button" data-action="toggle" class="px-3 py-1.5 rounded-xl ${u.active ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'} text-xs font-medium">
          ${u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        </button>
      </div>
      <div data-edit-slot></div>
      <div data-temp-password-slot></div>
    </div>
  `;
}

/**
 * @param {HTMLElement} container
 * @param {Object} u
 * @param {Function} reload
 */
function wireUserCard(container, u, reload) {
  const card = container.querySelector(`[data-user-card="${cssEscape(u.userId)}"]`);
  if (!card) return;
  const editSlot = card.querySelector('[data-edit-slot]');
  const tempPasswordSlot = card.querySelector('[data-temp-password-slot]');

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    if (editSlot.innerHTML) {
      editSlot.innerHTML = '';
      return;
    }
    renderEditForm(editSlot, u, { onCancel: () => { editSlot.innerHTML = ''; }, onSaved: reload });
  });

  const resetBtn = card.querySelector('[data-action="reset"]');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const confirmed = await confirmDialog(
        `รีเซ็ตรหัสผ่านของ "${u.name}" หรือไม่? ระบบจะสุ่มรหัสผ่านชั่วคราวให้ และผู้ใช้รายนี้จะถูกบังคับออกจากระบบทุกอุปกรณ์ทันที`,
        { confirmLabel: 'รีเซ็ตรหัสผ่าน', danger: true }
      );
      if (!confirmed) return;
      try {
        const result = await apiCall('admin.users.resetPassword', { userId: u.userId });
        // รหัสชั่วคราวคืนมาครั้งเดียวเท่านั้น ไม่มีที่ไหนเก็บไว้อีก — โชว์ค้างไว้จนกว่า admin จะกดปิดเอง
        // (ใช้ toast ไม่ได้ เพราะหายเองใน 3 วินาที admin คัดลอกไม่ทันแล้วต้องรีเซ็ตใหม่)
        if (result.temporaryPassword) {
          renderTempPassword(tempPasswordSlot, u.name, result.temporaryPassword);
        } else {
          showToast('รีเซ็ตรหัสผ่านสำเร็จ', 'success');
        }
      } catch (err) {
        showToast(err && err.message ? err.message : 'รีเซ็ตรหัสผ่านไม่สำเร็จ', 'error');
      }
    });
  }

  card.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
    const turningOff = u.active;
    if (turningOff) {
      const confirmed = await confirmDialog(
        `ปิดใช้งานบัญชี "${u.name}" หรือไม่? ผู้ใช้รายนี้จะถูกบังคับออกจากระบบทุกอุปกรณ์ทันทีและเข้าใช้งานไม่ได้อีก`,
        { confirmLabel: 'ปิดใช้งาน', danger: true }
      );
      if (!confirmed) return;
    }
    try {
      await apiCall('admin.users.update', { userId: u.userId, patch: { active: !u.active } });
      showToast(turningOff ? 'ปิดใช้งานบัญชีแล้ว' : 'เปิดใช้งานบัญชีแล้ว', 'success');
      await reload();
    } catch (err) {
      showToast(err && err.message ? err.message : 'ดำเนินการไม่สำเร็จ', 'error');
    }
  });
}

/** @param {HTMLElement} slot @param {string} userName @param {string} password */
function renderTempPassword(slot, userName, password) {
  slot.innerHTML = `
    <div class="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
      <p class="text-xs text-amber-800 mb-1.5 font-medium">รหัสผ่านชั่วคราวของ ${escapeHtml(userName)} — แสดงเพียงครั้งเดียว</p>
      <p class="font-mono text-sm text-slate-800 bg-white rounded-lg px-3 py-2 select-all break-all">${escapeHtml(password)}</p>
      <p class="text-xs text-amber-700 mt-1.5">คัดลอกไปแจ้งผู้ใช้ก่อนปิด — ถ้าปิดแล้วดูย้อนหลังไม่ได้ ต้องรีเซ็ตใหม่</p>
      <button type="button" data-close-temp class="mt-2 text-xs font-medium text-amber-800 underline">ปิด</button>
    </div>
  `;
  slot.querySelector('[data-close-temp]').addEventListener('click', () => { slot.innerHTML = ''; });
}

/**
 * ฟอร์มแก้ไข — ส่งเฉพาะ key ที่ updateUser อนุญาต (name/phone/lineUserId/active/role)
 * @param {HTMLElement} container
 * @param {Object} u
 * @param {{onCancel:Function, onSaved:Function}} ctx
 */
function renderEditForm(container, u, ctx) {
  container.innerHTML = `
    <form class="border border-slate-100 rounded-xl p-3 mt-3 space-y-3 bg-slate-50">
      <p data-error class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>
      ${floatField({ id: `au-edit-name-${escapeHtml(u.userId)}`, field: 'name', label: 'ชื่อ-นามสกุล', value: u.name, required: true })}
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">บทบาท</label>
          <select data-field="role" class="w-full px-2 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
            ${Object.keys(ROLE_LABELS).map((r) => `<option value="${escapeHtml(r)}" ${u.role === r ? 'selected' : ''}>${escapeHtml(ROLE_LABELS[r])}</option>`).join('')}
          </select>
        </div>
        ${floatField({ id: `au-edit-phone-${escapeHtml(u.userId)}`, field: 'phone', label: 'เบอร์โทร', value: u.phone })}
      </div>
      ${floatField({ id: `au-edit-line-${escapeHtml(u.userId)}`, field: 'lineUserId', label: 'LINE User ID', value: u.lineUserId })}
      <p class="text-xs text-slate-400">ชื่อผู้ใช้และเลขบัตรประชาชนแก้ที่นี่ไม่ได้ · เปลี่ยนบทบาทเป็น CG จะทำให้ผู้ใช้ล็อกอินด้วยรหัสผ่านเดิมไม่ได้</p>
      <div class="flex gap-2">
        <button type="button" data-cancel class="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">ยกเลิก</button>
        <button type="submit" data-submit class="flex-1 py-2 rounded-xl accent-gradient text-white text-sm font-medium">บันทึก</button>
      </div>
    </form>
  `;

  const form = container.querySelector('form');
  const errorEl = form.querySelector('[data-error]');
  const val = (name) => form.querySelector(`[data-field="${name}"]`).value.trim();

  form.querySelector('[data-cancel]').addEventListener('click', () => ctx.onCancel());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');
    if (!val('name')) {
      errorEl.textContent = 'กรุณากรอกชื่อ-นามสกุล';
      errorEl.classList.remove('hidden');
      return;
    }
    const submitBtn = form.querySelector('[data-submit]');
    submitBtn.disabled = true;
    try {
      await apiCall('admin.users.update', {
        userId: u.userId,
        patch: { name: val('name'), role: val('role'), phone: val('phone'), lineUserId: val('lineUserId') }
      });
      showToast('บันทึกข้อมูลผู้ใช้สำเร็จ', 'success');
      await ctx.onSaved();
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/**
 * ฟอร์มสร้างผู้ใช้ใหม่ — ฟิลด์ที่บังคับต่างกันตาม role (CG: name+cid / อื่น ๆ: name+username+password)
 * ตรงกับ validateRequiredFields_ ใน createUser
 * @param {HTMLElement} container
 * @param {{onCancel:Function, onCreated:Function}} ctx
 */
function renderCreateForm(container, ctx) {
  const state = { role: 'CG' };

  function paint() {
    const isCg = state.role === 'CG';
    container.innerHTML = `
      <form class="flat-card bg-white rounded-2xl p-4 mb-4 space-y-3">
        <p class="text-sm font-semibold text-slate-700">เพิ่มผู้ใช้ใหม่</p>
        <p data-error class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2"></p>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">บทบาท *</label>
          <select data-field="role" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
            ${Object.keys(ROLE_LABELS).map((r) => `<option value="${escapeHtml(r)}" ${state.role === r ? 'selected' : ''}>${escapeHtml(ROLE_LABELS[r])}</option>`).join('')}
          </select>
        </div>
        ${floatField({ id: 'au-new-name', field: 'name', label: 'ชื่อ-นามสกุล', value: state.name, required: true })}

        ${isCg ? `
          <div>
            ${floatField({ id: 'au-new-cid', field: 'cid', label: 'เลขประจำตัวประชาชน 13 หลัก', value: state.cid, required: true, inputAttrs: 'inputmode="numeric" maxlength="13"' })}
            <p class="text-xs text-slate-400 mt-1">ผู้ดูแล/อสม. ล็อกอินด้วยเลขบัตรประชาชน ไม่ต้องตั้งรหัสผ่าน</p>
          </div>
        ` : `
          ${floatField({ id: 'au-new-username', field: 'username', label: 'ชื่อผู้ใช้', value: state.username, required: true })}
          <div>
            ${floatField({ id: 'au-new-password', field: 'password', label: 'รหัสผ่าน', value: state.password, required: true })}
            <p class="text-xs text-slate-400 mt-1">อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร — แจ้งให้ผู้ใช้เปลี่ยนเองภายหลัง</p>
          </div>
        `}

        ${floatField({ id: 'au-new-phone', field: 'phone', label: 'เบอร์โทร', value: state.phone })}

        <div class="flex gap-2">
          <button type="button" data-cancel class="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">ยกเลิก</button>
          <button type="submit" data-submit class="flex-1 py-2.5 rounded-xl accent-gradient text-white text-sm font-medium">สร้างผู้ใช้</button>
        </div>
      </form>
    `;

    const form = container.querySelector('form');
    const errorEl = form.querySelector('[data-error]');
    const val = (name) => {
      const el = form.querySelector(`[data-field="${name}"]`);
      return el ? el.value.trim() : '';
    };
    // เก็บค่าที่กรอกไว้ก่อน rerender ตอนสลับ role ไม่งั้นพิมพ์ชื่อไปแล้วเปลี่ยน role ทีเดียวหายหมด
    const capture = () => {
      state.name = val('name'); state.phone = val('phone');
      state.cid = val('cid'); state.username = val('username'); state.password = val('password');
    };

    form.querySelector('[data-field="role"]').addEventListener('change', (e) => {
      capture();
      state.role = e.target.value;
      paint();
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => ctx.onCancel());

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.classList.add('hidden');
      capture();

      const validationError = validateCreate(state);
      if (validationError) {
        errorEl.textContent = validationError;
        errorEl.classList.remove('hidden');
        return;
      }

      const payload = { role: state.role, name: state.name, phone: state.phone };
      if (state.role === 'CG') {
        payload.cid = state.cid;
      } else {
        payload.username = state.username;
        payload.password = state.password;
      }

      const submitBtn = form.querySelector('[data-submit]');
      submitBtn.disabled = true;
      try {
        await apiCall('admin.users.create', payload);
        showToast('สร้างผู้ใช้ใหม่สำเร็จ', 'success');
        await ctx.onCreated();
      } catch (err) {
        errorEl.textContent = err && err.message ? err.message : 'สร้างผู้ใช้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
        errorEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  paint();
}

/** @param {Object} state @return {string|null} */
function validateCreate(state) {
  if (!state.name) return 'กรุณากรอกชื่อ-นามสกุล';
  if (state.role === 'CG') {
    if (!/^\d{13}$/.test(state.cid || '')) return 'กรุณากรอกเลขประจำตัวประชาชนให้ครบ 13 หลัก';
    return null;
  }
  if (!state.username) return 'กรุณากรอกชื่อผู้ใช้';
  if ((state.password || '').length < MIN_PASSWORD_LENGTH) return `รหัสผ่านต้องมีความยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  return null;
}

/** userId มาจาก generateShortId_ (ตัวอักษร/ตัวเลข/ขีด) แต่ escape ไว้ก่อนกัน selector พังถ้ารูปแบบเปลี่ยนวันหลัง */
function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
