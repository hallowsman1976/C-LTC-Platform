/**
 * screens/admin/audit-log.js
 * ดู Audit Trail (/admin/audit-log) ตาม BLUEPRINT.md §4/§17 — ADMIN เท่านั้น
 *
 * หมายเหตุสำคัญเรื่องรูปร่างข้อมูล: admin.auditLog.list คืน "แถวดิบ" จากชีตตรง ๆ (queryAuditLogs_ ไม่ได้ผ่าน
 * sanitizer เหมือน action อื่น) ฟิลด์จึงเป็น PascalCase ตาม header ของชีต — LogId/Timestamp/UserId/Action/
 * TargetType/TargetId/Detail — ไม่ใช่ camelCase แบบที่เหลือทั้งระบบ และ Detail เป็น JSON string ที่ต้อง parse เอง
 *
 * ตัวกรอง userId/action/targetType ฝั่ง backend เป็นการเทียบ "ตรงตัวเป๊ะ" (===) ไม่ใช่ค้นหาบางส่วน
 * จึงทำเป็นช่องกรอกค่าเต็มไม่ใช่ search box กันผู้ใช้พิมพ์บางส่วนแล้วงงว่าทำไมไม่เจอ
 */
import { apiCall } from '../../api.js';
import { renderListSkeleton, renderEmptyState, renderPagination, escapeHtml } from '../../ui.js';
import { formatThaiDateTime, initThaiDatePicker } from '../../date-picker.js';
import { getUserDirectoryMap } from '../../directory.js';

const PAGE_SIZE = 50;

/** @param {HTMLElement} content */
export async function renderAdminAuditLog(content) {
  const state = { userId: '', action: '', targetType: '', dateFrom: '', dateTo: '', page: 1 };

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl mx-auto">
      <a href="#/admin" class="text-sm text-sky-600 mb-3 inline-block">← กลับไปเมนูผู้ดูแลระบบ</a>
      <h1 class="text-lg font-bold text-slate-800 mb-1">Audit Log</h1>
      <p class="text-xs text-slate-400 mb-4">ประวัติการกระทำทั้งหมดในระบบ เรียงใหม่สุดก่อน</p>

      <div class="flat-card bg-white rounded-2xl p-3 mb-4 space-y-2">
        <div class="grid grid-cols-2 gap-2">
          <input id="al-action" type="text" placeholder="การกระทำ (เช่น users.update)"
            class="px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <input id="al-targettype" type="text" placeholder="ประเภทเป้าหมาย (เช่น User)"
            class="px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input id="al-datefrom" type="text" placeholder="ตั้งแต่วันที่"
            class="px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <input id="al-dateto" type="text" placeholder="ถึงวันที่"
            class="px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div class="flex gap-2">
          <button id="al-apply" type="button" class="flex-1 py-2 rounded-xl bg-sky-600 text-white text-xs font-medium">กรอง</button>
          <button id="al-clear" type="button" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium">ล้าง</button>
        </div>
      </div>

      <div id="al-results"></div>
      <div id="al-pagination"></div>
    </div>
  `;

  const resultsEl = content.querySelector('#al-results');
  const paginationEl = content.querySelector('#al-pagination');
  const actionInput = content.querySelector('#al-action');
  const targetTypeInput = content.querySelector('#al-targettype');
  const dateFromInput = content.querySelector('#al-datefrom');
  const dateToInput = content.querySelector('#al-dateto');

  // ปฏิทิน พ.ศ. — input เก็บ ISO (YYYY-MM-DD) ซึ่งเทียบกับ Timestamp (ISO string) ฝั่ง backend ได้ตรง ๆ
  const thisYear = new Date().getFullYear();
  initThaiDatePicker(dateFromInput, { minYear: thisYear - 5, maxYear: thisYear, clearable: true });
  initThaiDatePicker(dateToInput, { minYear: thisYear - 5, maxYear: thisYear, clearable: true });

  // แปลง UserId → ชื่อคน ไม่งั้นอ่าน log แล้วเห็นแต่รหัส U-xxxx ว่าใครทำ
  let userMap = {};
  try {
    userMap = await getUserDirectoryMap();
  } catch (err) {
    userMap = {};   // ดึงรายชื่อไม่ได้ก็ยังดู log ได้ แค่โชว์เป็นรหัสผู้ใช้แทนชื่อ
  }

  async function loadList() {
    renderListSkeleton(resultsEl, 6);
    paginationEl.innerHTML = '';
    const data = await apiCall('admin.auditLog.list', {
      userId: state.userId, action: state.action, targetType: state.targetType,
      dateFrom: state.dateFrom, dateTo: endOfDayIso(state.dateTo), page: state.page, pageSize: PAGE_SIZE
    });

    if (!data.items || data.items.length === 0) {
      renderEmptyState(resultsEl, { title: 'ไม่พบรายการที่ตรงกับเงื่อนไขนี้', message: 'ลองปรับตัวกรองหรือล้างตัวกรองดูอีกครั้ง' });
      return;
    }

    // มือถือ: การ์ดเรียงคอลัมน์เดียว (เดิม) / จอกว้าง md+: ตารางแทน — ไม่มีปุ่ม/การโต้ตอบต่อแถวเลย (ดูอย่างเดียว)
    // จึงแค่สร้าง markup 2 ชุดแล้วสลับด้วย CSS breakpoint โดยไม่ต้อง sync state ระหว่างกันเหมือนหน้ามอบหมายทีมดูแล
    resultsEl.innerHTML = `
      <div class="md:hidden">${data.items.map((row) => mobileLogRowHtml(row, userMap)).join('')}</div>
      <div class="hidden md:block flat-card bg-white rounded-2xl overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-100 text-xs text-slate-400 text-left">
              <th class="px-4 py-2.5 font-medium whitespace-nowrap">เวลา</th>
              <th class="px-4 py-2.5 font-medium">การกระทำ</th>
              <th class="px-4 py-2.5 font-medium">ผู้ทำรายการ</th>
              <th class="px-4 py-2.5 font-medium">เป้าหมาย</th>
              <th class="px-4 py-2.5 font-medium">รายละเอียด</th>
            </tr>
          </thead>
          <tbody>${data.items.map((row) => desktopLogRowHtml(row, userMap)).join('')}</tbody>
        </table>
      </div>
    `;

    renderPagination(paginationEl, { page: data.page, pageSize: data.pageSize, total: data.total }, (nextPage) => {
      state.page = nextPage;
      loadList();
    });
  }

  content.querySelector('#al-apply').addEventListener('click', () => {
    state.action = actionInput.value.trim();
    state.targetType = targetTypeInput.value.trim();
    state.dateFrom = dateFromInput.value.trim();
    state.dateTo = dateToInput.value.trim();
    state.page = 1;
    loadList();
  });

  content.querySelector('#al-clear').addEventListener('click', () => {
    actionInput.value = '';
    targetTypeInput.value = '';
    dateFromInput._flatpickr ? dateFromInput._flatpickr.clear() : (dateFromInput.value = '');
    dateToInput._flatpickr ? dateToInput._flatpickr.clear() : (dateToInput.value = '');
    Object.assign(state, { userId: '', action: '', targetType: '', dateFrom: '', dateTo: '', page: 1 });
    loadList();
  });

  await loadList();
}

/**
 * ขยาย "ถึงวันที่" ให้ครอบคลุมทั้งวัน
 *
 * queryAuditLogs_ เทียบ string ตรง ๆ (r.Timestamp <= filters.dateTo) โดย Timestamp เป็น ISO เต็ม เช่น
 * "2026-07-16T02:30:00.000Z" — ถ้าส่ง dateTo เป็น "2026-07-16" เฉย ๆ การเทียบจะได้ false เพราะส่วน "T02:30..."
 * ทำให้ string ยาวกว่าและมากกว่า ผลคือ log ของ "วันที่เลือก" หายทั้งวันแบบเงียบ ๆ ซึ่งผู้ใช้ไม่มีทางเดาถูก
 * จึงต่อท้ายเป็นสิ้นสุดวันก่อนส่ง
 *
 * @param {string} isoDate "YYYY-MM-DD" หรือค่าว่าง
 * @return {string} "YYYY-MM-DDT23:59:59.999Z" หรือค่าว่างเดิม
 */
function endOfDayIso(isoDate) {
  return isoDate ? `${isoDate}T23:59:59.999Z` : '';
}

/** @param {Object} row แถวดิบจาก admin.auditLog.list @param {Object} userMap @return {string} */
function mobileLogRowHtml(row, userMap) {
  const actor = userMap[row.UserId];
  return `
    <div class="flat-card bg-white rounded-2xl p-3 mb-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-800 break-all">${escapeHtml(row.Action || '-')}</p>
          <p class="text-xs text-slate-400 mt-0.5">
            ${escapeHtml(actor ? actor.name : (row.UserId || 'ระบบ'))}
            ${row.TargetType ? ' · ' + escapeHtml(row.TargetType) : ''}${row.TargetId ? ' ' + escapeHtml(row.TargetId) : ''}
          </p>
        </div>
        <span class="shrink-0 text-xs text-slate-400">${escapeHtml(formatThaiDateTime(row.Timestamp))}</span>
      </div>
      ${renderDetail(row.Detail)}
    </div>
  `;
}

/** @param {Object} row แถวดิบจาก admin.auditLog.list @param {Object} userMap @return {string} */
function desktopLogRowHtml(row, userMap) {
  const actor = userMap[row.UserId];
  return `
    <tr class="border-b border-slate-50 last:border-0 align-top">
      <td class="px-4 py-3 whitespace-nowrap text-xs text-slate-400">${escapeHtml(formatThaiDateTime(row.Timestamp))}</td>
      <td class="px-4 py-3 text-sm font-medium text-slate-800 break-all">${escapeHtml(row.Action || '-')}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${escapeHtml(actor ? actor.name : (row.UserId || 'ระบบ'))}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${row.TargetType ? escapeHtml(row.TargetType) : '-'}${row.TargetId ? ' ' + escapeHtml(row.TargetId) : ''}</td>
      <td class="px-4 py-3">${renderDetail(row.Detail) || '<span class="text-xs text-slate-300">-</span>'}</td>
    </tr>
  `;
}

/**
 * Detail เป็น JSON string ที่ logAudit_ เขียนไว้ — parse ไม่ได้ก็โชว์ดิบไปเลย ดีกว่าไม่โชว์อะไร
 * @param {string} rawDetail
 * @return {string}
 */
function renderDetail(rawDetail) {
  if (!rawDetail || rawDetail === '{}') return '';
  let text = rawDetail;
  try {
    const parsed = JSON.parse(rawDetail);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) return '';
    text = JSON.stringify(parsed);
  } catch (err) {
    // ไม่ใช่ JSON — โชว์ค่าดิบตามที่เก็บไว้
  }
  return `<p class="text-xs text-slate-500 mt-1.5 bg-slate-50 rounded-lg px-2 py-1.5 break-all font-mono">${escapeHtml(text)}</p>`;
}
