/**
 * ui.js
 * ส่วนประกอบ UI ที่ใช้ซ้ำทุกหน้า: Toast, Loading overlay, Error state, Offline banner
 * อ้างอิง element id คงที่ที่ต้องมีอยู่ใน index.html และ login.html: #toast-container, #loading-overlay, #offline-banner
 */

let toastTimer = null;

const TOAST_COLOR_CLASS = {
  info: 'bg-slate-800',
  success: 'bg-emerald-600',
  error: 'bg-rose-600',
  warning: 'bg-amber-500'
};

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'=} type
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const colorClass = TOAST_COLOR_CLASS[type] || TOAST_COLOR_CLASS.info;
  container.innerHTML = `
    <div class="${colorClass} text-white text-sm px-4 py-3 rounded-xl shadow-lg animate-fade-in max-w-sm w-full text-center">
      ${escapeHtml(message)}
    </div>
  `;
  container.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    container.classList.add('hidden');
    container.innerHTML = '';
  }, 3200);
}

/** @param {boolean} isLoading */
export function setLoading(isLoading) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !isLoading);
}

/**
 * แสดงสถานะ error แทนเนื้อหาปกติในคอนเทนเนอร์ที่ระบุ พร้อมปุ่ม "ลองใหม่" (ถ้ามี callback)
 * @param {HTMLElement} container
 * @param {string} message
 * @param {Function=} onRetry
 */
export function renderErrorState(container, message, onRetry) {
  if (!container) return;
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center text-center py-16 px-6">
      <div class="text-4xl mb-3">⚠️</div>
      <p class="text-slate-600 mb-4">${escapeHtml(message)}</p>
      ${onRetry ? '<button id="error-retry-btn" type="button" class="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium">ลองใหม่</button>' : ''}
    </div>
  `;
  if (onRetry) {
    const btn = container.querySelector('#error-retry-btn');
    if (btn) btn.addEventListener('click', onRetry);
  }
}

/**
 * ผูก event listener online/offline เข้ากับ #offline-banner ครั้งเดียวตอนแอปเริ่มทำงาน
 */
export function initOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const update = () => {
    banner.classList.toggle('hidden', navigator.onLine);
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

/**
 * กัน XSS เวลาแทรกข้อความที่มาจากผู้ใช้/backend ลงใน innerHTML
 * @param {*} str
 * @return {string}
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str === undefined || str === null ? '' : String(str);
  return div.innerHTML;
}

/**
 * เรนเดอร์การ์ด skeleton (animate-pulse) แทนที่รายการที่ยังโหลดไม่เสร็จ — ใช้กับหน้ารายการ (list)
 * @param {HTMLElement} container
 * @param {number=} count จำนวนการ์ด skeleton (default 5)
 */
export function renderListSkeleton(container, count = 5) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }).map(() => `
    <div class="bg-white rounded-2xl shadow-sm p-4 mb-3">
      <div class="h-4 skeleton-shimmer rounded w-2/3 mb-2"></div>
      <div class="h-3 skeleton-shimmer rounded w-1/3 mb-1.5"></div>
      <div class="h-3 skeleton-shimmer rounded w-1/4"></div>
    </div>
  `).join('');
}

/**
 * เรนเดอร์ skeleton สำหรับการ์ดรายละเอียดหนึ่งใบ (เช่น หน้ารายละเอียดผู้ป่วย/แดชบอร์ด)
 * @param {HTMLElement} container
 */
export function renderCardSkeleton(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div class="h-5 skeleton-shimmer rounded w-1/2"></div>
      <div class="h-3 skeleton-shimmer rounded w-full"></div>
      <div class="h-3 skeleton-shimmer rounded w-5/6"></div>
      <div class="h-3 skeleton-shimmer rounded w-2/3"></div>
    </div>
  `;
}

/**
 * เรนเดอร์สถานะ "ยังไม่มีข้อมูล" พร้อมภาพประกอบ (flat illustration ชุดเดียวกับทั้งแอป) แทนรายการว่างเปล่า
 * @param {HTMLElement} container
 * @param {{title: string, message?: string, actionLabel?: string, onAction?: Function}} options
 */
export function renderEmptyState(container, options) {
  if (!container) return;
  const { title, message = '', actionLabel = '', onAction } = options;
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center text-center py-10 px-6 bg-white rounded-2xl shadow-sm">
      <img src="assets/illustrations/empty-state.svg" alt="" class="w-32 h-auto mb-4" />
      <p class="text-slate-700 font-medium text-sm mb-1">${escapeHtml(title)}</p>
      ${message ? `<p class="text-slate-400 text-xs mb-3">${escapeHtml(message)}</p>` : ''}
      ${actionLabel && onAction ? '<button id="empty-state-action-btn" type="button" class="mt-1 px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-medium">' + escapeHtml(actionLabel) + '</button>' : ''}
    </div>
  `;
  if (actionLabel && onAction) {
    const btn = container.querySelector('#empty-state-action-btn');
    if (btn) btn.addEventListener('click', onAction);
  }
}

/**
 * เรนเดอร์แถบเปลี่ยนหน้า (ก่อนหน้า/ถัดไป) — ซ่อนตัวเองถ้ามีหน้าเดียว
 * @param {HTMLElement} container
 * @param {{page:number, pageSize:number, total:number}} state
 * @param {(nextPage:number)=>void} onPageChange
 */
export function renderPagination(container, state, onPageChange) {
  if (!container) return;
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="flex items-center justify-between px-1 py-3 text-sm text-slate-500">
      <button id="pg-prev" type="button" class="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40" ${state.page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
      <span>หน้า ${state.page} จาก ${totalPages} (ทั้งหมด ${state.total} รายการ)</span>
      <button id="pg-next" type="button" class="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40" ${state.page >= totalPages ? 'disabled' : ''}>ถัดไป</button>
    </div>
  `;
  const prevBtn = container.querySelector('#pg-prev');
  const nextBtn = container.querySelector('#pg-next');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (state.page > 1) onPageChange(state.page - 1); });
  if (nextBtn) nextBtn.addEventListener('click', () => { if (state.page < totalPages) onPageChange(state.page + 1); });
}

/**
 * กล่องยืนยัน (แทน confirm() ของเบราว์เซอร์ เพื่อคุมสไตล์ให้ตรงกับดีไซน์แอป)
 * @param {string} message
 * @param {{confirmLabel?:string, cancelLabel?:string, danger?:boolean}=} options
 * @return {Promise<boolean>}
 */
export function confirmDialog(message, options = {}) {
  const { confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', danger = false } = options;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-6';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-lg max-w-sm w-full p-5">
        <p class="text-sm text-slate-700 mb-5">${escapeHtml(message)}</p>
        <div class="flex gap-2 justify-end">
          <button id="confirm-cancel" type="button" class="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-100">${escapeHtml(cancelLabel)}</button>
          <button id="confirm-ok" type="button" class="px-4 py-2 rounded-lg text-sm font-medium text-white ${danger ? 'bg-rose-600' : 'bg-sky-600'}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => {
      document.body.removeChild(overlay);
      resolve(result);
    };
    overlay.querySelector('#confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('#confirm-ok').addEventListener('click', () => cleanup(true));
  });
}

/**
 * กล่องรับข้อความสั้น ๆ จากผู้ใช้ (เช่น เหตุผลการปฏิเสธ Care Plan) — แทน prompt() ของเบราว์เซอร์
 * @param {string} message
 * @param {{placeholder?:string, required?:boolean}=} options
 * @return {Promise<string|null>} null ถ้ากดยกเลิก
 */
export function promptDialog(message, options = {}) {
  const { placeholder = '', required = true } = options;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-6';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-lg max-w-sm w-full p-5">
        <p class="text-sm text-slate-700 mb-3">${escapeHtml(message)}</p>
        <textarea id="prompt-input" rows="3" placeholder="${escapeHtml(placeholder)}"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-sky-500"></textarea>
        <p id="prompt-error" class="hidden text-xs text-rose-500 mb-2"></p>
        <div class="flex gap-2 justify-end">
          <button id="prompt-cancel" type="button" class="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-100">ยกเลิก</button>
          <button id="prompt-ok" type="button" class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-sky-600">ยืนยัน</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#prompt-input');
    const errorEl = overlay.querySelector('#prompt-error');
    input.focus();
    const cleanup = (result) => {
      document.body.removeChild(overlay);
      resolve(result);
    };
    overlay.querySelector('#prompt-cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('#prompt-ok').addEventListener('click', () => {
      const value = input.value.trim();
      if (required && !value) {
        errorEl.textContent = 'กรุณากรอกข้อมูล';
        errorEl.classList.remove('hidden');
        return;
      }
      cleanup(value);
    });
  });
}
