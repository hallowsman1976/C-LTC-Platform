/**
 * Response.gs
 * มาตรฐาน Response Envelope และรหัส Error ทั้งหมดของระบบ (อ้างอิง BLUEPRINT.md §9, §11)
 * ทุก handler ที่ frontend เรียกได้ต้องคืนค่าโดยใช้ ok_()/err_() เท่านั้น ห้าม throw ออกไปถึง client โดยตรง
 */

/** รหัส error มาตรฐาน — ห้ามเปลี่ยนค่า string โดยไม่ bump เวอร์ชัน BLUEPRINT.md */
var ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'ERR_AUTH_REQUIRED',
  AUTH_INVALID: 'ERR_AUTH_INVALID',
  SESSION_EXPIRED: 'ERR_SESSION_EXPIRED',
  FORBIDDEN: 'ERR_FORBIDDEN',
  VALIDATION: 'ERR_VALIDATION',
  NOT_FOUND: 'ERR_NOT_FOUND',
  CONFLICT: 'ERR_CONFLICT',
  LOCK_TIMEOUT: 'ERR_LOCK_TIMEOUT',
  FILE_TOO_LARGE: 'ERR_FILE_TOO_LARGE',
  RATE_LIMIT: 'ERR_RATE_LIMIT',
  SERVER: 'ERR_SERVER'
});

/**
 * สร้าง response envelope กรณีสำเร็จ
 * @param {Object=} data
 * @return {{ok: boolean, data: Object}}
 */
function ok_(data) {
  return { ok: true, data: (data !== undefined && data !== null) ? data : {} };
}

/**
 * สร้าง response envelope กรณีผิดพลาด
 * @param {string} code      ค่าจาก ERROR_CODES
 * @param {string} message   ข้อความภาษาไทยสำหรับผู้ใช้
 * @param {Object=} extraData ข้อมูลเสริม เช่น { fields: {...} } สำหรับ ERR_VALIDATION
 * @return {{ok: boolean, code: string, message: string, data: (Object|undefined)}}
 */
function err_(code, message, extraData) {
  var envelope = { ok: false, code: code, message: message };
  if (extraData !== undefined) {
    envelope.data = extraData;
  }
  return envelope;
}

/**
 * แปลง exception ที่ดักได้จาก try/catch ให้เป็น error envelope มาตรฐาน
 * รู้จัก SheetLockError (จาก SheetService.gs) เป็นกรณีพิเศษ → ERR_LOCK_TIMEOUT
 * ข้อความ technical จะถูก log เข้า Stackdriver เท่านั้น ไม่ส่งกลับ client ตรง ๆ
 * @param {Error} exception
 * @param {string=} fallbackCode ค่าเริ่มต้นถ้าไม่รู้จัก exception ชนิดนี้ (default: ERR_SERVER)
 * @return {{ok: boolean, code: string, message: string}}
 */
function errFromException_(exception, fallbackCode) {
  if (exception && exception.isLockTimeout) {
    return err_(ERROR_CODES.LOCK_TIMEOUT, exception.message || 'ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
  }
  var techMessage = (exception && exception.message) ? exception.message : String(exception);
  Logger.log('[errFromException_] ' + (exception && exception.stack ? exception.stack : techMessage));
  return err_(fallbackCode || ERROR_CODES.SERVER, 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง');
}

/**
 * ห่อ envelope เป็น ContentService TextOutput (JSON) พร้อมใช้กับ doGet/doPost ใน Phase ถัดไป (Main.gs)
 * @param {Object} envelope ผลลัพธ์จาก ok_()/err_()
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function jsonOutput_(envelope) {
  return ContentService
    .createTextOutput(JSON.stringify(envelope))
    .setMimeType(ContentService.MimeType.JSON);
}
