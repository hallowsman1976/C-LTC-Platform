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
      ${onRetry ? '<button id="error-retry-btn" type="button" class="px-4 py-2 rounded-lg accent-gradient text-white text-sm font-medium">ลองใหม่</button>' : ''}
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
 * แสดงผล error/success ของ field เดี่ยว ๆ แบบ real-time — ใช้คู่กับ wireFieldValidation
 * เปลี่ยนสีขอบ input + ข้อความ error ใต้ช่อง โดยไม่ยุ่งกับ validate ตอน submit จริง (ยังคงเป็น source of truth เดิม)
 * @param {HTMLElement} inputEl
 * @param {HTMLElement=} errorEl ถ้าไม่ระบุ จะมองหา `${inputEl.id}-error` ให้อัตโนมัติ
 * @param {string|null} message null/'' = ผ่าน (แสดงสถานะ valid), string = error
 */
export function setFieldState(inputEl, errorEl, message) {
  if (!inputEl) return;
  const targetErrorEl = errorEl || document.getElementById(`${inputEl.id}-error`);
  inputEl.classList.remove('border-slate-200', 'focus:ring-sky-500', 'border-rose-400', 'focus:ring-rose-400', 'border-emerald-400');
  if (message) {
    inputEl.classList.add('border-rose-400', 'focus:ring-rose-400');
    inputEl.setAttribute('aria-invalid', 'true');
    if (targetErrorEl) {
      targetErrorEl.textContent = message;
      targetErrorEl.classList.remove('hidden');
    }
  } else {
    inputEl.classList.add(inputEl.dataset.touched === 'true' ? 'border-emerald-400' : 'border-slate-200', 'focus:ring-sky-500');
    inputEl.removeAttribute('aria-invalid');
    if (targetErrorEl) {
      targetErrorEl.textContent = '';
      targetErrorEl.classList.add('hidden');
    }
  }
}

/**
 * ผูก real-time validation ให้ input เดียว — ตรวจตอน blur (ครั้งแรกที่ผู้ใช้ออกจากช่อง) แล้วตรวจซ้ำสด ๆ
 * ทุกครั้งที่พิมพ์ต่อจากนั้น (ไม่รบกวนผู้ใช้ที่ยังไม่เคยแตะช่องนี้ด้วย error ก่อนเวลา)
 * @param {HTMLElement} inputEl
 * @param {(value: string) => string|null} validatorFn คืนข้อความ error หรือ null ถ้าผ่าน
 * @param {HTMLElement=} errorEl
 */
export function wireFieldValidation(inputEl, validatorFn, errorEl) {
  if (!inputEl) return;
  const check = () => {
    inputEl.dataset.touched = 'true';
    setFieldState(inputEl, errorEl, validatorFn(inputEl.value));
  };
  inputEl.addEventListener('blur', check);
  inputEl.addEventListener('input', () => {
    if (inputEl.dataset.touched === 'true') check();
  });
}

/**
 * เรนเดอร์การ์ด skeleton (animate-pulse) แทนที่รายการที่ยังโหลดไม่เสร็จ — ใช้กับหน้ารายการ (list)
 * @param {HTMLElement} container
 * @param {number=} count จำนวนการ์ด skeleton (default 5)
 */
export function renderListSkeleton(container, count = 5) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }).map(() => `
    <div class="flat-card bg-white rounded-2xl p-4 mb-3">
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
    <div class="flat-card bg-white rounded-2xl p-4 space-y-3">
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
    <div class="flex flex-col items-center justify-center text-center py-10 px-6 flat-card bg-white rounded-2xl">
      <img src="assets/illustrations/empty-state.svg" alt="" class="w-32 h-auto mb-4" />
      <p class="text-slate-700 font-medium text-sm mb-1">${escapeHtml(title)}</p>
      ${message ? `<p class="text-slate-400 text-xs mb-3">${escapeHtml(message)}</p>` : ''}
      ${actionLabel && onAction ? '<button id="empty-state-action-btn" type="button" class="mt-1 px-4 py-2 rounded-lg accent-gradient text-white text-xs font-medium">' + escapeHtml(actionLabel) + '</button>' : ''}
    </div>
  `;
  if (actionLabel && onAction) {
    const btn = container.querySelector('#empty-state-action-btn');
    if (btn) btn.addEventListener('click', onAction);
  }
}

/**
 * เรนเดอร์ breadcrumb นำทางกลับหน้าก่อนหน้า — ใช้ในหน้าย่อยที่ลึกกว่าเมนูหลัก (รายละเอียด/แก้ไข/รายงาน)
 * @param {HTMLElement} container
 * @param {Array<{label: string, href?: string}>} crumbs รายการสุดท้ายไม่ต้องมี href (คือหน้าปัจจุบัน)
 */
export function renderBreadcrumb(container, crumbs) {
  if (!container) return;
  container.innerHTML = `
    <nav aria-label="breadcrumb" class="flex items-center flex-wrap gap-1.5 text-xs text-slate-400 mb-3">
      ${crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const sep = i > 0 ? '<svg class="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' : '';
        const item = c.href && !isLast
          ? `<a href="${c.href}" class="hover:text-sky-600 transition">${escapeHtml(c.label)}</a>`
          : `<span class="${isLast ? 'text-slate-600 font-medium' : ''}">${escapeHtml(c.label)}</span>`;
        return sep + item;
      }).join('')}
    </nav>
  `;
}

/**
 * เรนเดอร์แถบเปลี่ยนหน้า (ก่อนหน้า/ถัดไป) พร้อมตัวเลือกจำนวนรายการ/หน้าแบบไม่บังคับ — ซ่อนปุ่มเปลี่ยนหน้าถ้ามีหน้าเดียว
 * (แต่ยังโชว์ตัวเลือกจำนวนรายการ/หน้าถ้าผู้เรียกส่ง pageSizeOptions มา เพราะมีประโยชน์แม้ข้อมูลพอดีหน้าเดียว)
 * @param {HTMLElement} container
 * @param {{page:number, pageSize:number, total:number}} state
 * @param {(nextPage:number)=>void} onPageChange
 * @param {{pageSizeOptions?: number[], onPageSizeChange?: (pageSize:number)=>void}=} options ไม่ระบุ = พฤติกรรมเดิมทุกประการ
 */
export function renderPagination(container, state, onPageChange, options = {}) {
  if (!container) return;
  const { pageSizeOptions, onPageSizeChange } = options;
  const showPageSize = !!(pageSizeOptions && pageSizeOptions.length && onPageSizeChange);
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));

  if (totalPages <= 1 && !showPageSize) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="flex flex-col sm:flex-row items-center justify-between gap-2 px-1 py-3 text-sm text-slate-500">
      ${showPageSize ? `
        <label class="flex items-center gap-1.5 text-xs text-slate-400">
          แสดง
          <select id="pg-pagesize" class="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
            ${pageSizeOptions.map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          รายการ/หน้า
        </label>
      ` : ''}
      ${totalPages > 1 ? `
        <div class="flex items-center gap-2">
          <button id="pg-prev" type="button" class="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40" ${state.page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
          <span class="text-xs sm:text-sm whitespace-nowrap">หน้า ${state.page} จาก ${totalPages} (ทั้งหมด ${state.total} รายการ)</span>
          <button id="pg-next" type="button" class="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40" ${state.page >= totalPages ? 'disabled' : ''}>ถัดไป</button>
        </div>
      ` : `<span class="text-xs text-slate-400">ทั้งหมด ${state.total} รายการ</span>`}
    </div>
  `;
  const prevBtn = container.querySelector('#pg-prev');
  const nextBtn = container.querySelector('#pg-next');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (state.page > 1) onPageChange(state.page - 1); });
  if (nextBtn) nextBtn.addEventListener('click', () => { if (state.page < totalPages) onPageChange(state.page + 1); });

  if (showPageSize) {
    const pageSizeSelect = container.querySelector('#pg-pagesize');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', () => onPageSizeChange(Number(pageSizeSelect.value)));
    }
  }
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
      <div class="bg-white rounded-2xl shadow-[0_12px_32px_-8px_rgba(2,132,199,0.18),0_2px_6px_rgba(15,23,42,0.06)] max-w-sm w-full p-5 animate-fade-in">
        <p class="text-sm text-slate-700 mb-5">${escapeHtml(message)}</p>
        <div class="flex gap-2 justify-end">
          <button id="confirm-cancel" type="button" class="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition">${escapeHtml(cancelLabel)}</button>
          <button id="confirm-ok" type="button" class="px-4 py-2 rounded-xl text-sm font-medium text-white transition hover:brightness-105 active:brightness-95 ${danger ? 'bg-gradient-to-br from-rose-500 to-rose-600' : 'accent-gradient'}">${escapeHtml(confirmLabel)}</button>
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
      <div class="bg-white rounded-2xl shadow-[0_12px_32px_-8px_rgba(2,132,199,0.18),0_2px_6px_rgba(15,23,42,0.06)] max-w-sm w-full p-5 animate-fade-in">
        <p class="text-sm text-slate-700 mb-3">${escapeHtml(message)}</p>
        <textarea id="prompt-input" rows="3" placeholder="${escapeHtml(placeholder)}"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-sky-500 transition"></textarea>
        <p id="prompt-error" class="hidden text-xs text-rose-500 mb-2"></p>
        <div class="flex gap-2 justify-end">
          <button id="prompt-cancel" type="button" class="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition">ยกเลิก</button>
          <button id="prompt-ok" type="button" class="px-4 py-2 rounded-xl text-sm font-medium text-white accent-gradient hover:brightness-105 active:brightness-95 transition">ยืนยัน</button>
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
