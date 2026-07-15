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
    <div class="px-4 py-5 max-w-3xl">
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
    <div class="bg-white rounded-2xl shadow-sm p-3 mb-4 space-y-2">
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
    <div class="bg-white rounded-2xl shadow-sm p-3 text-center">
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

  container.innerHTML = rows.map((p) => `
    <div class="bg-white rounded-2xl shadow-sm p-4 mb-3" data-patient-row="${escapeHtml(p.patientId)}">
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
  `).join('');

  rows.forEach((p) => wireRow(container, p, state, ctx));
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

/**
 * @param {HTMLElement} container
 * @param {Object} patient
 * @param {Object} state
 * @param {{onChanged: Function}} ctx
 */
function wireRow(container, patient, state, ctx) {
  const row = container.querySelector(`[data-patient-row="${cssEscape(patient.patientId)}"]`);
  if (!row) return;
  const statusEl = row.querySelector('[data-row-status]');

  const bind = (kind, payloadKey, stateKey) => {
    const select = row.querySelector(`[data-assign="${kind}"]`);
    select.addEventListener('change', async () => {
      const previous = patient[stateKey] || '';
      const next = select.value;
      select.disabled = true;
      statusEl.textContent = 'กำลังบันทึก...';
      statusEl.className = 'shrink-0 text-xs text-slate-400';
      try {
        // ส่งเฉพาะ key ที่เปลี่ยน — assignCareTeam แก้เฉพาะ key ที่ส่งมา (ค่าว่าง = เคลียร์ผู้รับผิดชอบ)
        // ถ้าส่งทั้งสอง key ทุกครั้งจะกลายเป็นเขียนทับอีกฝั่งด้วยค่าที่หน้าจออาจเก่าไปแล้ว
        await apiCall('patients.assignCareTeam', { patientId: patient.patientId, [payloadKey]: next });
        patient[stateKey] = next;   // อัปเดต state ในเครื่องให้ตัวนับ/ตัวกรองตรงโดยไม่ต้องดึงใหม่ทั้งชุด
        statusEl.textContent = 'บันทึกแล้ว';
        statusEl.className = 'shrink-0 text-xs text-emerald-600';
        showToast(`บันทึกการมอบหมายของ ${patient.name} แล้ว`, 'success');
        ctx.onChanged();
      } catch (err) {
        select.value = previous;   // ย้อนกลับให้ตรงกับของจริงบนเซิร์ฟเวอร์ ไม่ให้หน้าจอโกหกว่าบันทึกแล้ว
        statusEl.textContent = 'บันทึกไม่สำเร็จ';
        statusEl.className = 'shrink-0 text-xs text-rose-600';
        showToast(err && err.message ? err.message : 'บันทึกการมอบหมายไม่สำเร็จ', 'error');
      } finally {
        select.disabled = false;
      }
    });
  };

  bind('cg', 'primaryCgUserId', 'primaryCgUserId');
  bind('cm', 'responsibleCmUserId', 'responsibleCmUserId');
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
