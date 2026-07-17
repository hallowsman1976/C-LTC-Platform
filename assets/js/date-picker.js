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
 *  3) ผู้ใช้พิมพ์วันที่เองได้ (allowInput) โดย parseTypedDate รับรูปแบบที่คนไทยพิมพ์จริงหลายแบบ และ
 *     guardTypedInput กันไม่ให้ flatpickr ล้างค่าเดิมทิ้งเงียบ ๆ เมื่อพิมพ์ผิด
 */
import { showToast } from './ui.js';

const BE_OFFSET = 543;
const ISO_FORMAT = 'Y-m-d';

/**
 * เกณฑ์แยกว่าปีที่ผู้ใช้พิมพ์เป็น พ.ศ. หรือ ค.ศ. — ปีตั้งแต่ 2400 ขึ้นไปถือเป็น พ.ศ. เสมอ
 * ในทางปฏิบัติไม่มีทางกำกวม: ค.ศ. ที่เป็นไปได้ของวันเกิด/วันนัดคือ 1900-2100 ส่วน พ.ศ. คือ 2443-2643
 * ช่วงสองอันนี้ไม่ทับกันเลย จึงเดาถูกเสมอ และยอมรับทั้งคนที่พิมพ์ 2569 และคนที่เผลอพิมพ์ 2026
 */
const BE_YEAR_THRESHOLD = 2400;

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/** ชื่อย่อเดือนไทย เรียงตรงกับ THAI_MONTHS — รับตอนผู้ใช้พิมพ์เอง (เช่น "16 ก.ค. 2569") */
const THAI_MONTHS_ABBR = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
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
 * ประกอบ Date จากเลขวัน/เดือน/ปีที่ผู้ใช้พิมพ์ พร้อมตรวจว่ามีอยู่จริง
 * ต้องเช็คย้อนกลับด้วยเพราะ new Date(2569, 1, 31) ไม่ error แต่ "ไหล" ไปเป็น 3 มี.ค. เงียบ ๆ
 * ถ้าไม่ดัก ผู้ใช้พิมพ์ 31/02/2569 แล้วจะได้วันที่อื่นโดยไม่รู้ตัว
 * @param {number} year ปี พ.ศ. หรือ ค.ศ. ก็ได้ (ดู BE_YEAR_THRESHOLD)
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @return {Date|undefined}
 */
function buildDateFromParts(year, month, day) {
  const ceYear = year >= BE_YEAR_THRESHOLD ? year - BE_OFFSET : year;
  const date = new Date(ceYear, month - 1, day);
  const roundTrips = date.getFullYear() === ceYear && date.getMonth() === month - 1 && date.getDate() === day;
  return roundTrips ? date : undefined;
}

/**
 * หา index เดือนจากข้อความไทยที่ผู้ใช้พิมพ์ รับทั้งชื่อเต็มและชื่อย่อ (มีจุดหรือไม่มีก็ได้)
 * @param {string} text
 * @return {number} 0-11 หรือ -1 ถ้าไม่รู้จัก
 */
function resolveThaiMonth(text) {
  const normalized = String(text).replace(/[\s.]/g, '');
  const full = THAI_MONTHS.findIndex((m) => m === normalized);
  if (full !== -1) return full;
  return THAI_MONTHS_ABBR.findIndex((m) => m.replace(/\./g, '') === normalized);
}

/**
 * แปลงข้อความวันที่ที่ "ผู้ใช้พิมพ์เอง" เป็น Date — รับหลายรูปแบบเท่าที่คนไทยพิมพ์กันจริง:
 *   2026-07-16 (ISO ที่ input เก็บอยู่)  ·  16/7/2569  ·  16-07-2569  ·  16.7.2569
 *   16 กรกฎาคม 2569  ·  16 ก.ค. 2569
 * ปี 2 หลัก (16/7/69) จงใจไม่รับ เพราะเดาไม่ได้ว่าหมายถึง พ.ศ. 2569 หรือ ค.ศ. 1969 — วันเกิดผิด 543 ปี
 * หรือ 100 ปีคือความเสียหายที่แก้ยากกว่าการบังคับให้พิมพ์ปีเต็ม
 * @param {string} value
 * @return {Date|undefined}
 */
function parseTypedDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) return buildDateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})$/.exec(raw);
  if (numeric) return buildDateFromParts(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  const worded = /^(\d{1,2})\s+(.+?)\s+(\d{4})$/.exec(raw);
  if (worded) {
    const monthIndex = resolveThaiMonth(worded[2]);
    if (monthIndex !== -1) return buildDateFromParts(Number(worded[3]), monthIndex + 1, Number(worded[1]));
  }
  return undefined;
}

/**
 * แปลงข้อความวันที่ตามที่ผู้ใช้พิมพ์/วางมา (ISO, D/M/YYYY พ.ศ./ค.ศ., "16 กรกฎาคม 2569" ฯลฯ — ดู parseTypedDate
 * ด้านบนสำหรับรูปแบบทั้งหมดที่รับ) → ISO string ตรงตามที่ backend เก็บ — ใช้กับคอลัมน์วันที่ตอนนำเข้าไฟล์ CSV
 * ผู้ป่วยจำนวนมาก (screens/admin/patients-import.js) ที่ผู้กรอกอาจพิมพ์วันที่มาหลายรูปแบบต่างจาก date picker
 * @param {string} value
 * @return {string|null} "YYYY-MM-DD" หรือ null ถ้า parse ไม่ได้
 */
export function parseTypedDateToIso(value) {
  const date = parseTypedDate(value);
  return date ? toIsoString(date) : null;
}

/**
 * คำนวณอายุจากวันเกิด — ต้องให้ผลตรงกับ computeAge_ ใน Patients.gs เป๊ะ (สูตรเดียวกัน: ปีต่างกัน
 * แล้วลบ 1 ถ้ายังไม่ถึงวันเกิดปีนี้) ไม่งั้นตัวเลขที่โชว์ตอนกรอกจะไม่ตรงกับที่ backend คำนวณเก็บจริง
 * @param {string} isoValue "YYYY-MM-DD"
 * @return {number|null} null ถ้าวันเกิดไม่ถูกต้อง/ยังไม่ได้เลือก
 */
export function computeAgeFromIsoDate(isoValue) {
  const birth = parseIsoString(isoValue);
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
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
 * กันข้อมูลหายตอนพิมพ์เอง (ผลข้างเคียงของ allowInput: true)
 *
 * พฤติกรรมเดิมของ flatpickr: พอ blur แล้วมันเอาข้อความในช่องไป setDate ตรง ๆ — ถ้า parse ไม่ผ่านมันจะ
 * "ล้างค่าทิ้งเงียบ ๆ" ทั้งที่ก่อนหน้านั้นมีวันที่ที่ถูกต้องอยู่ ผู้ใช้พิมพ์ผิดนิดเดียว (หรือพิมพ์ค้างแล้วเผลอคลิกที่อื่น)
 * วันเกิดที่กรอกไว้ก็หายทันทีโดยไม่มีคำเตือน ซึ่งอันตรายกับเวชระเบียน
 *
 * จึงจำค่าที่ดีล่าสุดไว้ตอน focus แล้วถ้า blur ออกมาโดย parse ไม่ผ่าน ให้คืนค่าเดิม + บอกผู้ใช้ว่าพิมพ์ผิด
 * (ถ้าผู้ใช้ตั้งใจลบข้อความจนว่าง = ยอมให้ล้างตามปกติ ไม่ใช่เคสพิมพ์ผิด)
 * @param {Object} fp
 */
function guardTypedInput(fp) {
  const altInput = fp.altInput;

  altInput.addEventListener('focus', () => { fp.ltcIsoOnFocus = fp.input.value; });
  altInput.addEventListener('input', () => { fp.ltcTypedText = altInput.value; });

  // ทำงานหลัง blur handler ของ flatpickr เสมอ เพราะ flatpickr ผูกของมันตอน build (ก่อน onReady)
  altInput.addEventListener('blur', () => {
    const typed = String(fp.ltcTypedText || '').trim();
    fp.ltcTypedText = '';

    if (!typed) return;            // ไม่ได้พิมพ์ หรือผู้ใช้ลบทิ้งเอง (ตั้งใจล้างค่า)
    if (fp.input.value) return;    // parse ผ่านแล้ว

    if (fp.ltcIsoOnFocus) fp.setDate(fp.ltcIsoOnFocus, true);
    // แยกสองสาเหตุให้ชัด: พิมพ์ผิดรูปแบบ กับ พิมพ์ถูกแต่เป็นวันที่นอกช่วงที่อนุญาต (เช่น วันเกิดในอนาคต
    // ที่ maxDate กันไว้) — flatpickr ล้างค่าทิ้งเหมือนกันทั้งคู่ ถ้าบอกว่า "รูปแบบผิด" ทั้งที่พิมพ์ถูก ผู้ใช้จะงง
    showToast(
      parseTypedDate(typed)
        ? 'วันที่นี้อยู่นอกช่วงที่เลือกได้ กรุณาตรวจสอบอีกครั้ง'
        : 'รูปแบบวันที่ไม่ถูกต้อง — พิมพ์เช่น 16/7/2569 หรือ 16 ก.ค. 2569 (ปีเต็ม 4 หลัก)',
      'error'
    );
  });
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
 * instance ที่ยังมีชีวิตอยู่ทั้งหมด — ใช้เก็บกวาดตัวที่ input หลุดจาก DOM ไปแล้ว
 *
 * ทำไมต้องมี: flatpickr แขวนปฏิทินไว้ที่ document.body ไม่ใช่ข้าง input ส่วน router ของแอปเปลี่ยนหน้าด้วยการ
 * เขียนทับ content.innerHTML ทั้งก้อน — input หายไปแต่ปฏิทินยังค้างอยู่ใน body พร้อม event listener ครบชุด
 * เข้า-ออกหน้าฟอร์มผู้ป่วย 3 รอบ = ปฏิทินค้าง 6 อัน สะสมไปเรื่อย ๆ จนกว่าจะรีเฟรชทั้งแอป (PWA เปิดค้างทั้งวัน
 * ยิ่งสะสม) และ querySelector('.flatpickr-calendar.open') ก็ไปเจอปฏิทินผีเข้าแทนตัวจริงได้ด้วย
 */
const livePickers = new Set();

/** ทำลาย instance ที่ input ไม่อยู่ใน DOM แล้ว (หน้าถูกเปลี่ยนไป) — เรียกก่อนสร้างตัวใหม่ทุกครั้ง */
function sweepDetachedPickers() {
  livePickers.forEach((fp) => {
    if (fp.input && fp.input.isConnected) return;
    try {
      fp.destroy();
    } catch (err) {
      // ถูก destroy ไปแล้วจากที่อื่น (เช่น visit-form step 8 ที่จัดการเองตอน rerender) — ข้ามไป
    }
    livePickers.delete(fp);
  });
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

  sweepDetachedPickers();

  const { minYear, maxYear, clearable = false, ...flatpickrOptions } = options;
  const range = resolveYearRange(minYear, maxYear, parseIsoString(inputEl.value));

  const instance = window.flatpickr(inputEl, {
    locale: 'th',
    dateFormat: ISO_FORMAT,
    altInput: true,
    altFormat: 'thai',
    allowInput: true,
    disableMobile: true,
    monthSelectorType: 'dropdown',
    altInputClass: `${inputEl.className} ltc-fp-alt bg-white`,
    formatDate: (date, format) => (format === ISO_FORMAT ? toIsoString(date) : toThaiString(date)),
    // flatpickr เรียก parseDate ทั้งตอนอ่านค่าเริ่มต้นจาก input (ISO) และตอนผู้ใช้พิมพ์เองแล้ว blur
    // (ส่งข้อความในช่องที่เห็นมาให้) — ตัวเดียวกันจึงต้องรับได้ทั้งสองแบบ
    parseDate: (value) => parseTypedDate(value),
    onReady: (_selectedDates, _dateStr, fp) => {
      fp.ltcYearSelect = buildYearSelect(fp, range.minYear, range.maxYear);
      fp.ltcYearSelect.value = String(fp.currentYear);
      if (clearable) fp.ltcClearButton = buildClearButton(fp);
      guardTypedInput(fp);
      syncClearButton(fp);
    },
    onYearChange: (_selectedDates, _dateStr, fp) => {
      if (fp.ltcYearSelect) fp.ltcYearSelect.value = String(fp.currentYear);
    },
    onChange: (_selectedDates, _dateStr, fp) => syncClearButton(fp),
    ...flatpickrOptions
  });

  livePickers.add(instance);
  return instance;
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
