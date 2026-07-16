/**
 * Validator.gs
 * ตัวช่วยตรวจสอบข้อมูล, สร้าง ID (UUID), และป้องกัน Formula Injection ก่อนเขียนลง Google Sheets
 */

/* ============================================================
 * ID Generation — ใช้ Utilities.getUuid() เสมอ ห้าม hardcode/สุ่มเอง
 * ============================================================ */

/**
 * สร้าง UUID เต็มรูปแบบ (ใช้กับ Sessions.Token ที่ต้องการ entropy สูงและคาดเดายาก)
 * @return {string}
 */
function generateUuid_() {
  return Utilities.getUuid();
}

/**
 * สร้าง short id พร้อม prefix อ่านง่าย เช่น "P-3f9a1c2b" สำหรับ Primary Key ของ record ทั่วไป
 * @param {string} prefix เช่น 'U', 'P', 'V', 'A-DEP', 'LOG'
 * @return {string}
 */
function generateShortId_(prefix) {
  var uuid = Utilities.getUuid().replace(/-/g, '');
  return prefix + '-' + uuid.substring(0, 8);
}

/* ============================================================
 * Formula Injection Defense
 * Google Sheets ตีความ cell string ที่ขึ้นต้นด้วย = + - @ หรือ tab เป็นสูตรเสมอ
 * ไม่ว่าจะเขียนผ่าน UI หรือผ่าน API (Range.setValue/setValues) ก็ตาม
 * ป้องกันด้วยการ prefix single quote ให้ Sheets เก็บเป็น literal text แทนการรันเป็นสูตร
 *
 * หมายเหตุ: string รูปแบบวันที่ "YYYY-MM-DD" ก็ถูก Google Sheets auto-convert เป็น Date object ได้เช่นกัน
 * แต่ป้องกันด้วยวิธีอื่นแทน (ตั้ง column format เป็น Plain Text ผ่าน applyPlainTextColumns_ ใน Setup.gs
 * ร่วมกับเขียนด้วย Range.setValues() แทน sheet.appendRow() ใน SheetService.gs — appendRow() ไม่เคารพ
 * number format ที่ตั้งไว้ล่วงหน้า ทำให้ยังโดน auto-convert อยู่ดีถ้าใช้ appendRow())
 * ============================================================ */

var FORMULA_INJECTION_PATTERN_ = /^[=+\-@\t\r]/;

/**
 * ทำความสะอาดค่าที่จะเขียนลง Sheet 1 ค่า — เรียกจาก SheetService.gs ทุกจุดที่เขียนข้อมูล
 * @param {*} value
 * @return {*} ค่าที่ปลอดภัยสำหรับเขียนลง cell
 */
function sanitizeForSheetValue_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  var str = String(value);
  if (FORMULA_INJECTION_PATTERN_.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * ทำความสะอาดทุก field ของ object ก่อนเขียนลง Sheet (ใช้เมื่อจำเป็นต้อง sanitize นอก path ปกติของ SheetService)
 * @param {Object} obj
 * @return {Object}
 */
function sanitizeObjectForSheet_(obj) {
  var sanitized = {};
  Object.keys(obj).forEach(function (key) {
    sanitized[key] = sanitizeForSheetValue_(obj[key]);
  });
  return sanitized;
}

/* ============================================================
 * Type / Shape Validators
 * ============================================================ */

/** @param {*} v @return {boolean} */
function isNonEmptyString_(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @param {*} v
 * @param {Array} allowedValues
 * @return {boolean}
 */
function isValidEnum_(v, allowedValues) {
  return allowedValues.indexOf(v) !== -1;
}

/** @param {*} v ต้องเป็น ISO date string ที่ parse ได้ @return {boolean} */
function isValidIsoDate_(v) {
  if (typeof v !== 'string' || v.trim().length === 0) return false;
  var d = new Date(v);
  return !isNaN(d.getTime());
}

/**
 * ตรวจเลขประจำตัวประชาชนไทย 13 หลัก ด้วยสูตร checksum ทางการ
 * sum(digit[i] * (13 - i)), i=0..11 → checkDigit = (11 - (sum mod 11)) mod 10 ต้องตรงกับ digit[12]
 * @param {string} v
 * @return {boolean}
 */
function isValidThaiCid_(v) {
  if (typeof v !== 'string' || !/^[0-9]{13}$/.test(v)) return false;
  var digits = v.split('').map(function (c) { return Number(c); });
  var sum = 0;
  for (var i = 0; i < 12; i++) {
    sum += digits[i] * (13 - i);
  }
  var checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === digits[12];
}

/**
 * ตรวจฟิลด์ที่จำเป็นต้องมีค่าใน payload — ใช้คู่กับ err_(ERROR_CODES.VALIDATION, ..., { fields })
 * @param {Object} payload
 * @param {Array<string>} requiredFields
 * @return {{valid: boolean, fields: Object}}
 */
function validateRequiredFields_(payload, requiredFields) {
  var fields = {};
  requiredFields.forEach(function (field) {
    var value = payload ? payload[field] : undefined;
    if (value === undefined || value === null || value === '') {
      fields[field] = 'จำเป็นต้องกรอกข้อมูลนี้';
    }
  });
  return { valid: Object.keys(fields).length === 0, fields: fields };
}

/**
 * แปลงค่า boolean-ish ให้เป็น boolean จริงเสมอ
 * จำเป็นเพราะคอลัมน์ enum แบบ TRUE/FALSE ใน Sheet อาจเป็น native boolean (เขียนผ่าน API)
 * หรือ string 'TRUE'/'FALSE' (พิมพ์ผ่าน dropdown ใน UI ด้วยมือ) แล้วแต่ที่มาของข้อมูล
 * @param {*} value
 * @return {boolean}
 */
function coerceBoolean_(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';
  return !!value;
}

/**
 * ปิดบังเลขประจำตัวประชาชนสำหรับแสดงผล — ห้ามส่งเลขเต็มออกไปยัง client เด็ดขาด (PDPA, ดู BLUEPRINT.md §17)
 * รูปแบบ: 1-XXXX-XXXXX-012-X (โชว์เฉพาะหลักแรกกับ 3 หลักก่อนตัวสุดท้าย)
 * @param {string} cid เลข 13 หลัก
 * @return {string}
 */
function maskCid_(cid) {
  if (typeof cid !== 'string' || cid.length !== 13) return '';
  return cid.slice(0, 1) + '-XXXX-XXXXX-' + cid.slice(-4, -1) + '-X';
}
