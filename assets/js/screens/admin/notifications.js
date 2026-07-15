/**
 * screens/admin/notifications.js
 * สถานะการแจ้งเตือน LINE (/admin/notifications) — ADMIN เท่านั้น
 *
 * ไม่มีในผัง sitemap §4 (ที่เขียนไว้คือ /admin/config "ตั้งค่าระบบ, ทดสอบ LINE") แต่ action admin.notifications.list
 * มีอยู่จริงและใช้งานได้ ต่างจาก admin.config.get/set ที่ §9 เขียนไว้แต่ Router.gs ไม่เคยมี — หน้านี้จึงตอบโจทย์
 * "ตามดูว่าแจ้งเตือนส่งถึงจริงไหม" ได้เลยโดยไม่ต้องแตะ backend
 *
 * สถานะที่เป็นไปได้ตรงกับ ENUM_NOTIFICATION_STATUS_ (Setup.gs): sent / failed / skipped_no_line_id
 * "skipped_no_line_id" = ผู้รับยังไม่ได้ผูก LINE ID ไม่ใช่ระบบพัง — แก้ได้ที่หน้าจัดการผู้ใช้หรือให้เจ้าตัวผูกเองที่ตั้งค่า
 */
import { apiCall } from '../../api.js';
import { renderListSkeleton, renderEmptyState, renderPagination, escapeHtml } from '../../ui.js';
import { formatThaiDateTime } from '../../date-picker.js';
import { getUserDirectoryMap } from '../../directory.js';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'sent', label: 'ส่งสำเร็จ' },
  { value: 'failed', label: 'ส่งไม่สำเร็จ' },
  { value: 'skipped_no_line_id', label: 'ข้าม (ยังไม่ผูก LINE)' }
];

const STATUS_BADGE = {
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  skipped_no_line_id: 'bg-amber-100 text-amber-700'
};

/** @param {string} status @return {string} */
function statusLabel(status) {
  const found = STATUS_OPTIONS.find((s) => s.value === status);
  return found ? found.label : (status || '-');
}

/** @param {HTMLElement} content */
export async function renderAdminNotifications(content) {
  const state = { status: '', page: 1 };

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl">
      <a href="#/admin" class="text-sm text-sky-600 mb-3 inline-block">← กลับไปเมนูผู้ดูแลระบบ</a>
      <h1 class="text-lg font-bold text-slate-800 mb-1">การแจ้งเตือน</h1>
      <p class="text-xs text-slate-400 mb-4">สถานะการส่งแจ้งเตือน LINE ทั้งหมด เรียงใหม่สุดก่อน</p>

      <div class="bg-white rounded-2xl shadow-sm p-3 mb-4">
        <select id="an-status" class="w-full px-2 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">ทุกสถานะ</option>
          ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s.value)}">${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>

      <div id="an-results"></div>
      <div id="an-pagination"></div>
    </div>
  `;

  const resultsEl = content.querySelector('#an-results');
  const paginationEl = content.querySelector('#an-pagination');
  const statusSelect = content.querySelector('#an-status');

  let userMap = {};
  try {
    userMap = await getUserDirectoryMap();
  } catch (err) {
    userMap = {};   // ดึงรายชื่อไม่ได้ก็ยังดูรายการได้ แค่โชว์เป็นรหัสผู้ใช้แทนชื่อ
  }

  async function loadList() {
    renderListSkeleton(resultsEl, 5);
    paginationEl.innerHTML = '';
    const data = await apiCall('admin.notifications.list', { status: state.status, page: state.page, pageSize: PAGE_SIZE });

    if (!data.items || data.items.length === 0) {
      renderEmptyState(resultsEl, {
        title: 'ไม่พบการแจ้งเตือน',
        message: state.status ? 'ลองเปลี่ยนตัวกรองสถานะดูอีกครั้ง' : 'ยังไม่มีการแจ้งเตือนถูกส่งออกจากระบบ'
      });
      return;
    }

    resultsEl.innerHTML = data.items.map((n) => {
      const recipient = userMap[n.recipientUserId];
      return `
        <div class="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm text-slate-800">${escapeHtml(n.message)}</p>
              <p class="text-xs text-slate-400 mt-1">
                ถึง ${escapeHtml(recipient ? recipient.name : (n.recipientUserId || '-'))} · ${escapeHtml(n.channel || '-')} · ${escapeHtml(n.type || '-')}
              </p>
              <p class="text-xs text-slate-400 mt-0.5">
                ${escapeHtml(formatThaiDateTime(n.createdAt))}${n.retryCount > 0 ? ` · ลองส่งซ้ำ ${n.retryCount} ครั้ง` : ''}
              </p>
            </div>
            <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[n.status] || 'bg-slate-100 text-slate-600'}">
              ${escapeHtml(statusLabel(n.status))}
            </span>
          </div>
          ${n.relatedPatientId ? `
            <a href="#/patients/${encodeURIComponent(n.relatedPatientId)}" class="inline-block text-xs text-sky-600 mt-2">ดูผู้ป่วยที่เกี่ยวข้อง →</a>
          ` : ''}
        </div>
      `;
    }).join('');

    renderPagination(paginationEl, { page: data.page, pageSize: data.pageSize, total: data.total }, (nextPage) => {
      state.page = nextPage;
      loadList();
    });
  }

  statusSelect.addEventListener('change', () => { state.status = statusSelect.value; state.page = 1; loadList(); });

  await loadList();
}
