/**
 * validation.js
 * ตรวจข้อมูลฝั่ง client เพื่อ UX ที่ดี (แจ้ง error ก่อนยิง request) เท่านั้น
 * ไม่ใช่ security boundary — backend ต้องตรวจซ้ำเองเสมอ (ดู Validator.gs ฝั่ง backend ซึ่งใช้อัลกอริทึมเดียวกัน)
 */

/**
 * @param {*} value
 * @return {boolean}
 */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * ตรวจเลขประจำตัวประชาชนไทย 13 หลักด้วย checksum จริง (ตรงกับ isValidThaiCid_ ฝั่ง backend)
 * @param {string} cid
 * @return {boolean}
 */
export function isValidThaiCid(cid) {
  if (typeof cid !== 'string' || !/^[0-9]{13}$/.test(cid)) return false;
  const digits = cid.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === digits[12];
}

/**
 * @param {string} username
 * @return {boolean}
 */
export function isValidUsername(username) {
  return isNonEmptyString(username) && username.trim().length >= 3;
}

/**
 * @param {string} password
 * @return {boolean}
 */
export function isValidPassword(password) {
  return isNonEmptyString(password) && password.length >= 8;
}

/** ตัดอักขระที่ไม่ใช่ตัวเลขออกและจำกัดความยาว 13 หลัก — ใช้กับ input CID ระหว่างพิมพ์ */
export function formatCidInput(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 13);
}

/**
 * ตรวจว่าเป็นวันที่ที่ parse ได้ (ตรงกับ isValidIsoDate_ ฝั่ง backend) — ใช้กับ input type="date" (คืนค่า "YYYY-MM-DD")
 * @param {string} value
 * @return {boolean}
 */
export function isValidIsoDate(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return !Number.isNaN(new Date(value).getTime());
}
