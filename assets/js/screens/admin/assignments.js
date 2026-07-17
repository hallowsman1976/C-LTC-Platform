/**
 * screens/admin/assignments.js
 * เมนูมอบหมายทีมดูแลรวมศูนย์ (/admin/assignments) — ADMIN เท่านั้น
 *
 * ต่างจากหน้า /patients/:id/assign เดิมที่มอบหมายได้ทีละคน: หน้านี้ตอบคำถาม "ใครยังไม่มีคนดูแลบ้าง"
 * ได้ในหน้าจอเดียว แล้วมอบหมายจากตรงนั้นได้เลยไม่ต้องเข้า-ออกทีละราย ใช้ action เดิมทั้งหมด ไม่แตะ backend
 *
 * ทำไมต้องโหลดผู้ป่วย "ทั้งหมด" มาก่อน แทนที่จะแบ่งหน้าเหมือน /patients:
 * listPatients กรองได้แค่ status/adlGroup/riskLevel — ไม่มีตัวกรอง "ยังไม่มอบหมาย" ฝั่ง backend และไม่มี
 * ตัวนับด้วย ถ้าดึงมาทีละหน้าแล้วกรองฝั่ง client ตัวเลข "ยังไม่มี CG 12 คน" จะหมายถึงแค่ในหน้านั้น ซึ่งผิด
 * และอันตรายกว่าไม่มีตัวเลขเลย จึงไล่ดึงทีละ 100 (เพดาน PATIENT_LIST_MAX_PAGE_SIZE_) จนครบก่อนค่อยนับ/กรอง
 *
 * ADMIN เท่านั้นเพราะ dropdown รายชื่อ CG/CM ต้องใช้ admin.users.list ซึ่งเปิดให้ ADMIN อย่างเดียว
 * (patients.assignCareTeam เปิดให้ CM ด้วย แต่ CM ทำผ่านหน้า /patients/:id/assign เดิมที่รองรับเคสนั้นอยู่แล้ว)
 */
import { apiCall } from '../../api.js';
import { renderCardSkeleton, renderEmptyState, showToast, escapeHtml } from '../../ui.js';
import { getUsersByRole } from '../../directory.js';

const FETCH_PAGE_SIZE = 100;   // เพดานของ listPatients (PATIENT_LIST_MAX_PAGE_SIZE_)
const MAX_PAGES = 20;          // กันลูปไม่รู้จบถ้า total ฝั่ง backend เพี้ยน — 2,000 รายมากพอสำหรับระดับตำบล

const FILTERS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'noCg', label: 'ยังไม่มีผู้ดูแล (CG)' },
  { value: 'noCm', label: 'ยังไม่มี Case Manager' },
  { value: 'none', label: 'ยังไม่มอบหมายเลย' }
];

/** @param {HTMLElement} content */
export async function renderAdminAssignments(content) {
  const state = { patients: [], truncated: false, filter: 'all', search: '' };

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl mx-auto">
      <a href="#/admin" class="text-sm text-sky-600 mb-3 inline-block">← กลับไปเมนูผู้ดูแลระบบ</a>
      <h1 class="text-lg font-bold text-slate-800 mb-1">มอบหมายทีมดูแล</h1>
      <p class="text-xs text-slate-400 mb-4">ดูภาพรวมว่าผู้ป่วยรายใดยังไม่มีผู้รับผิดชอบ และมอบหมายได้จากหน้านี้เลย</p>
      <div id="aa-body"></div>
    </div>
  `;
  const bodyEl = content.querySelector('#aa-body');
  renderCardSkeleton(bodyEl);

  const [{ items, truncated }, cgOptions, cmOptions] = await Promise.all([
    fetchAllPatients(),
    getUsersByRole('CG'),
    getUsersByRole('CM')
  ]);
  state.patients = items;
  state.truncated = truncated;

  bodyEl.innerHTML = `
    <div id="aa-summary"></div>
    <div class="shadow-soft bg-white rounded-2xl p-3 mb-4 space-y-2">
      <input id="aa-search" type="text" placeholder="ค้นหาชื่อ หรือ HN"
        class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
      <select id="aa-filter" class="w-full px-2 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
        ${FILTERS.map((f) => `<option value="${escapeHtml(f.value)}">${escapeHtml(f.label)}</option>`).join('')}
      </select>
    </div>
    <div id="aa-results"></div>
  `;

  const summaryEl = bodyEl.querySelector('#aa-summary');
  const resultsEl = bodyEl.querySelector('#aa-results');
  const searchInput = bodyEl.querySelector('#aa-search');
  const filterSelect = bodyEl.querySelector('#aa-filter');

  function paint() {
    renderSummary(summaryEl, state);
    // onChanged อัปเดตแค่ตัวนับด้านบน ไม่วาดแถวใหม่ทั้งชุด — ถ้าวาดใหม่ แถวที่เพิ่งมอบหมายจะหายวับไปทันที
    // ตอนกรอง "ยังไม่มี CG" อยู่ และสถานะ "บันทึกแล้ว" ก็ถูกล้างก่อนผู้ใช้ทันเห็น
    renderRows(resultsEl, state, { cgOptions, cmOptions, onChanged: () => renderSummary(summaryEl, state) });
  }

  // ค้นหา/กรองทำฝั่ง client ล้วน เพราะโหลดผู้ป่วยมาครบแล้ว — ไม่ต้องยิง backend ทุกตัวอักษรที่พิมพ์
  searchInput.addEventListener('input', () => { state.search = searchInput.value.trim().toLowerCase(); paint(); });
  filterSelect.addEventListener('change', () => { state.filter = filterSelect.value; paint(); });

  paint();
}

/**
 * ไล่ดึงผู้ป่วยทีละหน้าจนครบ total
 * @return {Promise<{items: Array<Object>, truncated: boolean}>} truncated = ชนเพดาน MAX_PAGES ก่อนครบ
 */
async function fetchAllPatients() {
  const items = [];
  let page = 1;
  let total = Infinity;

  while (items.length < total && page <= MAX_PAGES) {
    const data = await apiCall('patients.list', { page, pageSize: FETCH_PAGE_SIZE });
    total = data.total;
    if (!data.items || data.items.length === 0) break;
    items.push(...data.items);
    page++;
  }
  return { items, truncated: items.length < total };
}

/** @param {HTMLElement} container @param {Object} state */
function renderSummary(container, state) {
  const noCg = state.patients.filter((p) => !p.primaryCgUserId).length;
  const noCm = state.patients.filter((p) => !p.responsibleCmUserId).length;
  container.innerHTML = `
    <div class="grid grid-cols-3 gap-2 mb-4">
      ${summaryTile('ผู้ป่วยทั้งหมด', state.patients.length, 'text-slate-800')}
      ${summaryTile('ยังไม่มี CG', noCg, noCg > 0 ? 'text-rose-600' : 'text-emerald-600')}
      ${summaryTile('ยังไม่มี CM', noCm, noCm > 0 ? 'text-rose-600' : 'text-emerald-600')}
    </div>
    ${state.truncated ? `
      <p class="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3">
        ผู้ป่วยมีมากกว่า ${MAX_PAGES * FETCH_PAGE_SIZE} ราย — หน้านี้แสดงและนับเฉพาะ ${state.patients.length} รายแรกเท่านั้น
      </p>
    ` : ''}
  `;
}

function summaryTile(label, value, valueClass) {
  return `
    <div class="shadow-soft animate-rise-in bg-white rounded-2xl p-3 text-center">
      <p class="text-xs text-slate-400">${escapeHtml(label)}</p>
      <p class="text-lg font-bold ${valueClass}">${value}</p>
    </div>
  `;
}

/** @param {Object} state @return {Array<Object>} */
function applyFilters(state) {
  return state.patients.filter((p) => {
    if (state.filter === 'noCg' && p.primaryCgUserId) return false;
    if (state.filter === 'noCm' && p.responsibleCmUserId) return false;
    if (state.filter === 'none' && (p.primaryCgUserId || p.responsibleCmUserId)) return false;
    if (state.search) {
      const haystack = `${p.name || ''} ${p.hn || ''}`.toLowerCase();
      if (!haystack.includes(state.search)) return false;
    }
    return true;
  });
}

/**
 * @param {HTMLElement} container
 * @param {Object} state
 * @param {{cgOptions: Array, cmOptions: Array, onChanged: Function}} ctx
 */
function renderRows(container, state, ctx) {
  const rows = applyFilters(state);

  if (rows.length === 0) {
    renderEmptyState(container, {
      title: 'ไม่พบผู้ป่วยที่ตรงกับเงื่อนไขนี้',
      message: state.filter === 'all' ? 'ลองปรับคำค้นหาดูอีกครั้ง' : 'ผู้ป่วยทุกรายในเงื่อนไขนี้มีผู้รับผิดชอบครบแล้ว'
    });
    return;
  }

  // มือถือ: การ์ดเรียงคอลัมน์เดียว (เดิม) / จอกว้าง md+: ตารางแทน เพื่อใช้พื้นที่จอกว้างให้คุ้ม — ทั้งสองชุด
  // อยู่ใน DOM พร้อมกันเสมอ (สลับด้วย CSS md:hidden/hidden md:table เท่านั้น) เพราะ data-patient-row ซ้ำกัน
  // 2 ตัวต่อผู้ป่วย 1 คน wireRow ด้านล่างจึงต้อง sync ค่า select/สถานะให้ตรงกันทั้งสองชุดเสมอ ไม่งั้นถ้าผู้ใช้
  // ปรับขนาดหน้าต่าง (มือถือ ↔ จอกว้าง) หลังแก้ไข จะเห็นค่าเก่าค้างอยู่ในชุดที่ไม่ได้แสดงตอนแก้
  container.innerHTML = `
    <div class="md:hidden">${rows.map((p) => mobileRowHtml(p, ctx)).join('')}</div>
    <div class="hidden md:block shadow-soft bg-white rounded-2xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-xs text-slate-400 text-left">
            <th class="px-4 py-2.5 font-medium">ผู้ป่วย</th>
            <th class="px-4 py-2.5 font-medium">ผู้ดูแลหลัก (CG)</th>
            <th class="px-4 py-2.5 font-medium">Case Manager (CM)</th>
            <th class="px-4 py-2.5 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>${rows.map((p) => desktopRowHtml(p, ctx)).join('')}</tbody>
      </table>
    </div>
  `;

  rows.forEach((p) => wireRow(container, p, state, ctx));
}

/** @param {Object} p @param {{cgOptions:Array, cmOptions:Array}} ctx @return {string} */
function mobileRowHtml(p, ctx) {
  return `
    <div class="shadow-soft bg-white rounded-2xl p-4 mb-3" data-patient-row="${escapeHtml(p.patientId)}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <a href="#/patients/${encodeURIComponent(p.patientId)}" class="text-sm font-semibold text-slate-800 hover:text-sky-600 truncate block">${escapeHtml(p.name)}</a>
          <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(p.hn)} · ${escapeHtml(p.village || '-')}</p>
        </div>
        <span data-row-status class="shrink-0 text-xs text-slate-400"></span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">ผู้ดูแลหลัก (CG)</label>
          ${selectHtml('cg', ctx.cgOptions, p.primaryCgUserId)}
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Case Manager (CM)</label>
          ${selectHtml('cm', ctx.cmOptions, p.responsibleCmUserId)}
        </div>
      </div>
    </div>
  `;
}

/** @param {Object} p @param {{cgOptions:Array, cmOptions:Array}} ctx @return {string} */
function desktopRowHtml(p, ctx) {
  return `
    <tr class="border-b border-slate-50 last:border-0" data-patient-row="${escapeHtml(p.patientId)}">
      <td class="px-4 py-3 align-top">
        <a href="#/patients/${encodeURIComponent(p.patientId)}" class="text-sm font-semibold text-slate-800 hover:text-sky-600">${escapeHtml(p.name)}</a>
        <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(p.hn)} · ${escapeHtml(p.village || '-')}</p>
      </td>
      <td class="px-4 py-3 align-top">${selectHtml('cg', ctx.cgOptions, p.primaryCgUserId)}</td>
      <td class="px-4 py-3 align-top">${selectHtml('cm', ctx.cmOptions, p.responsibleCmUserId)}</td>
      <td class="px-4 py-3 align-top"><span data-row-status class="text-xs text-slate-400"></span></td>
    </tr>
  `;
}

/** @param {string} kind @param {Array<Object>} options @param {string} selected */
function selectHtml(kind, options, selected) {
  const known = !selected || options.some((u) => u.userId === selected);
  return `
    <select data-assign="${kind}" class="w-full px-2 py-2 rounded-xl border ${selected ? 'border-slate-200' : 'border-amber-300 bg-amber-50'} text-xs focus:outline-none focus:ring-2 focus:ring-sky-500">
      <option value="" ${!selected ? 'selected' : ''}>ยังไม่มอบหมาย</option>
      ${options.map((u) => `<option value="${escapeHtml(u.userId)}" ${selected === u.userId ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
      ${!known ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (บัญชีถูกปิดใช้งาน/ไม่พบ)</option>` : ''}
    </select>
  `;
}

/** สี/ข้อความสถานะ — แยกจาก positional class เดิม (เช่น shrink-0 ของการ์ดมือถือ) เพื่อไม่ให้ทับกันตอนอัปเดต */
const STATUS_TONE_CLASS = { pending: 'text-slate-400', ok: 'text-emerald-600', error: 'text-rose-600' };

/** @param {HTMLElement} row @param {string} text @param {'pending'|'ok'|'error'} tone */
function setRowStatus(row, text, tone) {
  const el = row.querySelector('[data-row-status]');
  if (!el) return;
  el.textContent = text;
  Object.values(STATUS_TONE_CLASS).forEach((c) => el.classList.remove(c));
  el.classList.add(STATUS_TONE_CLASS[tone]);
}

/**
 * ผูก event ให้ "ทุก" element ที่มี data-patient-row ตรงกัน — ปกติมี 2 ตัวเสมอ (การ์ดมือถือ + แถวตาราง
 * เดสก์ท็อป) เพราะทั้งสองชุดอยู่ใน DOM พร้อมกัน สลับด้วย CSS breakpoint เท่านั้น ไม่ใช่แค่ตัวที่มองเห็น
 * ตอนนี้ ต้องอัปเดตค่า select/สถานะทั้งสองชุดพร้อมกันทุกครั้ง ไม่งั้นสลับขนาดจอหลังแก้ไขจะเห็นค่าเก่าค้าง
 * @param {HTMLElement} container
 * @param {Object} patient
 * @param {Object} state
 * @param {{onChanged: Function}} ctx
 */
function wireRow(container, patient, state, ctx) {
  const instances = Array.from(container.querySelectorAll(`[data-patient-row="${cssEscape(patient.patientId)}"]`));
  if (instances.length === 0) return;

  const bind = (kind, payloadKey, stateKey) => {
    instances.forEach((row) => {
      const select = row.querySelector(`[data-assign="${kind}"]`);
      select.addEventListener('change', async () => {
        const previous = patient[stateKey] || '';
        const next = select.value;
        instances.forEach((r) => { r.querySelector(`[data-assign="${kind}"]`).disabled = true; setRowStatus(r, 'กำลังบันทึก...', 'pending'); });
        try {
          // ส่งเฉพาะ key ที่เปลี่ยน — assignCareTeam แก้เฉพาะ key ที่ส่งมา (ค่าว่าง = เคลียร์ผู้รับผิดชอบ)
          // ถ้าส่งทั้งสอง key ทุกครั้งจะกลายเป็นเขียนทับอีกฝั่งด้วยค่าที่หน้าจออาจเก่าไปแล้ว
          await apiCall('patients.assignCareTeam', { patientId: patient.patientId, [payloadKey]: next });
          patient[stateKey] = next;   // อัปเดต state ในเครื่องให้ตัวนับ/ตัวกรองตรงโดยไม่ต้องดึงใหม่ทั้งชุด
          instances.forEach((r) => { r.querySelector(`[data-assign="${kind}"]`).value = next; setRowStatus(r, 'บันทึกแล้ว', 'ok'); });
          showToast(`บันทึกการมอบหมายของ ${patient.name} แล้ว`, 'success');
          ctx.onChanged();
        } catch (err) {
          // ย้อนกลับให้ตรงกับของจริงบนเซิร์ฟเวอร์ ไม่ให้หน้าจอโกหกว่าบันทึกแล้ว
          instances.forEach((r) => { r.querySelector(`[data-assign="${kind}"]`).value = previous; setRowStatus(r, 'บันทึกไม่สำเร็จ', 'error'); });
          showToast(err && err.message ? err.message : 'บันทึกการมอบหมายไม่สำเร็จ', 'error');
        } finally {
          instances.forEach((r) => { r.querySelector(`[data-assign="${kind}"]`).disabled = false; });
        }
      });
    });
  };

  bind('cg', 'primaryCgUserId', 'primaryCgUserId');
  bind('cm', 'responsibleCmUserId', 'responsibleCmUserId');
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
