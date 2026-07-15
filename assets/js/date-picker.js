/**
 * date-picker.js
 * ตัวเลือกวันที่แบบไทย (ปฏิทิน พ.ศ.) ครอบ flatpickr อีกชั้น
 *
 * ทำไมต้องครอบเอง: locale "th" ของ flatpickr แปลชื่อเดือน/ชื่อวันให้ก็จริง แต่ยังแสดงปีเป็น ค.ศ. เสมอ
 * และไม่มีออปชันปี พ.ศ. ในตัว จึงต้องเพิ่มเองสองจุด
 *  1) ช่องที่ผู้ใช้เห็น (altInput) ฟอร์แมตเป็น "16 กรกฎาคม 2569" ส่วน input ตัวจริงยังเก็บ "YYYY-MM-DD"
 *     (ค.ศ.) ไว้เหมือนเดิม — สัญญากับ backend (isValidIsoDate_) และ readFormValues ของแต่ละหน้าจึงไม่เปลี่ยน
 *  2) ช่องปีบนหัวปฏิทินของ flatpickr เป็น number input ที่ผูก event ตีความค่าเป็น ค.ศ. ตายตัว (พิมพ์ 2569
 *     แล้วมันกระโดดไป ค.ศ. 2569) เขียนทับค่าเฉย ๆ ไม่พอ จึงซ่อนทิ้งแล้ววาง <select> ปี พ.ศ. แทน
 *     ผลพลอยได้คือเลือกปีเกิดย้อนหลังหลายสิบปีได้ในคลิกเดียว ไม่ต้องกดลูกศรทีละปี
 */

const BE_OFFSET = 543;
const ISO_FORMAT = 'Y-m-d';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/** @param {Date} date @return {string} "YYYY-MM-DD" (ค.ศ.) */
function toIsoString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {Date} date @return {string} "16 กรกฎาคม 2569" */
function toThaiString(date) {
  return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${date.getFullYear() + BE_OFFSET}`;
}

/**
 * @param {string} value "YYYY-MM-DD"
 * @return {Date|undefined} undefined ถ้ารูปแบบไม่ตรง (flatpickr จะข้ามไปเอง)
 */
function parseIsoString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * สร้าง <select> ปี พ.ศ. แทนช่องปีเดิมของ flatpickr แล้วซ่อนของเดิมไว้ (ไม่ถอดออกจาก DOM
 * เพราะ flatpickr ยังเขียน .value ลงไปทุกครั้งที่เปลี่ยนเดือน/ปี — ปล่อยให้มันทำงานของมันไป)
 * @param {Object} fp instance ของ flatpickr
 * @param {number} minYear ปี ค.ศ. น้อยสุด
 * @param {number} maxYear ปี ค.ศ. มากสุด
 * @return {HTMLSelectElement}
 */
function buildYearSelect(fp, minYear, maxYear) {
  const select = document.createElement('select');
  select.className = 'ltc-fp-year';
  select.setAttribute('aria-label', 'ปี พ.ศ.');
  for (let year = maxYear; year >= minYear; year--) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year + BE_OFFSET);
    select.appendChild(option);
  }
  select.addEventListener('change', () => fp.changeYear(Number(select.value)));

  const wrapper = fp.currentYearElement.closest('.numInputWrapper');
  wrapper.classList.add('ltc-fp-year-hidden');
  wrapper.parentNode.insertBefore(select, wrapper);
  return select;
}

const CLEAR_ICON_SVG = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * ปุ่มล้างค่าสำหรับฟิลด์วันที่ที่ไม่บังคับ — picker พิมพ์เองไม่ได้ ถ้าไม่มีปุ่มนี้ผู้ใช้จะลบวันที่
 * ที่เคยเลือกไว้ไม่ได้เลย (backend ทุกตัวรับค่าว่างเพื่อล้างวันที่อยู่แล้ว)
 * ห่อ altInput ด้วย div.relative ให้เองเพื่อไม่ให้ผู้เรียกต้องเตรียม markup พิเศษ
 * @param {Object} fp instance ของ flatpickr
 * @return {HTMLButtonElement}
 */
function buildClearButton(fp) {
  const altInput = fp.altInput;
  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  altInput.parentNode.insertBefore(wrapper, altInput);
  wrapper.appendChild(altInput);
  altInput.classList.add('pr-9');

  const button = document.createElement('button');
  button.type = 'button';
  button.title = 'ล้างวันที่';
  button.setAttribute('aria-label', 'ล้างวันที่');
  button.className = 'absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600';
  button.innerHTML = CLEAR_ICON_SVG;
  button.addEventListener('click', () => fp.clear());
  wrapper.appendChild(button);
  return button;
}

/** ซ่อนปุ่มล้างตอนยังไม่มีค่า — ไม่มีอะไรให้ล้างก็ไม่ต้องโชว์ปุ่ม @param {Object} fp */
function syncClearButton(fp) {
  if (fp.ltcClearButton) fp.ltcClearButton.classList.toggle('hidden', !fp.input.value);
}

/**
 * หาช่วงปี ค.ศ. ของ dropdown โดยกันไม่ให้ค่าที่มีอยู่แล้วหลุดออกนอกช่วง
 * (เช่น ผู้ป่วยเก่าที่มีวันนัดย้อนหลังไปไกลกว่าช่วง default — ถ้าไม่มีปีนั้นใน select จะเลือกกลับไม่ได้)
 * @param {number|undefined} minYear
 * @param {number|undefined} maxYear
 * @param {Date|undefined} currentValue
 * @return {{minYear:number, maxYear:number}}
 */
function resolveYearRange(minYear, maxYear, currentValue) {
  const thisYear = new Date().getFullYear();
  let min = typeof minYear === 'number' ? minYear : thisYear - 10;
  let max = typeof maxYear === 'number' ? maxYear : thisYear + 10;
  if (currentValue) {
    min = Math.min(min, currentValue.getFullYear());
    max = Math.max(max, currentValue.getFullYear());
  }
  return { minYear: Math.min(min, max), maxYear: Math.max(min, max) };
}

/**
 * ผูก flatpickr ปี พ.ศ. เข้ากับ input หนึ่งช่อง
 * input ที่ส่งเข้ามาต้องเป็น type="text" (ไม่ใช่ type="date" ซึ่งเบราว์เซอร์จะยึด UI ปฏิทิน ค.ศ. ของตัวเองไว้)
 * และค่าเริ่มต้น/ค่าที่อ่านออกไปยังเป็น "YYYY-MM-DD" ค.ศ. เหมือนเดิมทุกประการ
 *
 * @param {HTMLInputElement|null} inputEl
 * @param {{minYear?:number, maxYear?:number, clearable?:boolean, minDate?:*, maxDate?:*}} [options]
 *   clearable=true เพิ่มปุ่มล้างค่าให้ (ใช้กับฟิลด์ที่ไม่บังคับ) ออปชันที่เหลือส่งต่อให้ flatpickr ตรง ๆ
 * @return {Object|null} instance ของ flatpickr หรือ null ถ้าผูกไม่ได้
 */
export function initThaiDatePicker(inputEl, options = {}) {
  if (!inputEl || typeof window.flatpickr !== 'function') return null;

  const { minYear, maxYear, clearable = false, ...flatpickrOptions } = options;
  const range = resolveYearRange(minYear, maxYear, parseIsoString(inputEl.value));

  return window.flatpickr(inputEl, {
    locale: 'th',
    dateFormat: ISO_FORMAT,
    altInput: true,
    altFormat: 'thai',
    allowInput: false,
    disableMobile: true,
    monthSelectorType: 'dropdown',
    altInputClass: `${inputEl.className} ltc-fp-alt bg-white cursor-pointer`,
    formatDate: (date, format) => (format === ISO_FORMAT ? toIsoString(date) : toThaiString(date)),
    parseDate: (value) => parseIsoString(value),
    onReady: (_selectedDates, _dateStr, fp) => {
      fp.ltcYearSelect = buildYearSelect(fp, range.minYear, range.maxYear);
      fp.ltcYearSelect.value = String(fp.currentYear);
      if (clearable) fp.ltcClearButton = buildClearButton(fp);
      syncClearButton(fp);
    },
    onYearChange: (_selectedDates, _dateStr, fp) => {
      if (fp.ltcYearSelect) fp.ltcYearSelect.value = String(fp.currentYear);
    },
    onChange: (_selectedDates, _dateStr, fp) => syncClearButton(fp),
    ...flatpickrOptions
  });
}

/**
 * แปลงค่า "YYYY-MM-DD" (ค.ศ.) เป็นข้อความไทย "5 สิงหาคม 2569" สำหรับ "แสดงผล" อย่างเดียว
 * (เช่นหน้าสรุปก่อนยืนยัน) — ค่าที่ส่งให้ backend ยังต้องใช้ ISO ค.ศ. ตัวเดิมเสมอ
 * @param {string} isoValue
 * @param {string} [fallback] ข้อความเมื่อไม่มีค่า/ค่าไม่ถูกต้อง
 * @return {string}
 */
export function formatThaiDateDisplay(isoValue, fallback = '-') {
  const date = parseIsoString(isoValue);
  return date ? toThaiString(date) : fallback;
}

/**
 * แปลง ISO datetime เต็ม (เช่น CreatedAt ที่ backend เก็บ) เป็น "10 ก.ค. 2569 09:00"
 * toLocaleString('th-TH') แปลงปีเป็น พ.ศ. ให้เองอยู่แล้ว จึงไม่ต้องบวก 543 ซ้ำ
 * @param {string} isoString
 * @param {string} [fallback]
 * @return {string}
 */
export function formatThaiDateTime(isoString, fallback = '-') {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * ปีเกิด: ย้อนหลังได้ 120 ปี และห้ามเลือกอนาคต (ฟิลด์บังคับ จึงไม่มีปุ่มล้าง)
 * @param {HTMLInputElement|null} inputEl
 * @return {Object|null}
 */
export function initThaiBirthDatePicker(inputEl) {
  const thisYear = new Date().getFullYear();
  return initThaiDatePicker(inputEl, {
    maxDate: 'today',
    minYear: thisYear - 120,
    maxYear: thisYear
  });
}

/**
 * วันนัดหมาย (วันนัดเยี่ยมถัดไป/วันนัดทบทวนแผน): เลือกได้ตั้งแต่ 2 ปีก่อนถึง 3 ปีข้างหน้า
 * ทุกฟิลด์นัดหมายเป็น optional ทั้งหมด (backend รับค่าว่างเพื่อล้างนัด) จึงติดปุ่มล้างให้เสมอ
 * @param {HTMLInputElement|null} inputEl
 * @return {Object|null}
 */
export function initThaiAppointmentDatePicker(inputEl) {
  const thisYear = new Date().getFullYear();
  return initThaiDatePicker(inputEl, {
    minYear: thisYear - 2,
    maxYear: thisYear + 3,
    clearable: true
  });
}
