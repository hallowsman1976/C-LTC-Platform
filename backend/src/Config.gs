/**
 * Config.gs
 * ค่าคงที่ของระบบ (ชื่อชีต, คีย์ Script Properties) + ตัวเข้าถึง Spreadsheet/Config ที่ใช้ร่วมกันทุกไฟล์
 *
 * กติกาสำคัญ: SPREADSHEET_ID และ secret ทั้งหมด (LINE token, salt) มาจาก Script Properties เท่านั้น
 * ห้าม hardcode ค่าจริงไว้ในโค้ดเด็ดขาด — ตั้งค่าที่ Project Settings > Script Properties
 */

/** ชื่อชีตทั้งหมดในระบบ (ต้องตรงกับ SHEET_DEFINITIONS_ ใน Setup.gs เป๊ะ) */
var SHEET_NAMES = Object.freeze({
  USERS: 'Users',
  PATIENTS: 'Patients',
  VISITS: 'Visits',
  ASSESSMENTS_BARTHEL: 'Assessments_Barthel',
  ASSESSMENTS_DEPRESSION: 'Assessments_Depression',
  ASSESSMENTS_FALLRISK: 'Assessments_FallRisk',
  ASSESSMENTS_CAREGIVERBURDEN: 'Assessments_CaregiverBurden',
  ASSESSMENTS_PRESSUREULCER: 'Assessments_PressureUlcer',
  ASSESSMENTS_INHOMESSS: 'Assessments_INHOMESSS',
  CARE_PLANS: 'CarePlans',
  CG2_LOGS: 'CG2Logs',
  SESSIONS: 'Sessions',
  CONFIG: 'Config',
  AUDIT_LOG: 'AuditLog',
  NOTIFICATIONS: 'Notifications'
});

/** คีย์ที่เก็บใน Script Properties (ค่าจริงตั้งผ่าน Project Settings เท่านั้น ไม่ผ่านโค้ด) */
var SCRIPT_PROPERTY_KEYS = Object.freeze({
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  PASSWORD_SALT: 'PASSWORD_SALT'
});

/** คีย์ที่เก็บใน Config sheet (ค่าที่ไม่ใช่ secret เท่านั้น — ดู rules/project-structure ของ gas-best-practices) */
var CONFIG_KEYS = Object.freeze({
  APP_VERSION: 'APP_VERSION',
  DRIVE_ROOT_FOLDER_ID: 'DRIVE_ROOT_FOLDER_ID',
  SETUP_LAST_RUN_AT: 'SETUP_LAST_RUN_AT'
});

var CONFIG_CACHE_TTL_SECONDS_ = 300;
var CONFIG_NULL_SENTINEL_ = '__NULL__';

/** cache ระดับ execution เดียว กัน SpreadsheetApp.openById ซ้ำหลายครั้งในคำขอเดียวกัน */
var _cachedSpreadsheet_ = null;

/**
 * อ่านค่า Script Property แบบมีตัวเลือกบังคับว่าต้องมีค่า
 * @param {string} key
 * @param {boolean=} required ถ้า true และไม่พบค่า จะ throw
 * @return {string|null}
 */
function getScriptProperty_(key, required) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !value) {
    throw new Error('ไม่พบค่า Script Property "' + key + '" กรุณาตั้งค่าก่อนใช้งาน (Project Settings > Script Properties)');
  }
  return value;
}

/**
 * อ่าน Spreadsheet ID จาก Script Properties (ต้องรัน setupSystem() มาก่อนอย่างน้อย 1 ครั้ง)
 * @return {string}
 */
function getSpreadsheetId_() {
  return getScriptProperty_(SCRIPT_PROPERTY_KEYS.SPREADSHEET_ID, true);
}

/**
 * เปิด Spreadsheet หลักของระบบ (cache ไว้ในรอบ execution เดียวกัน)
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  if (_cachedSpreadsheet_) return _cachedSpreadsheet_;
  var id = getSpreadsheetId_();
  try {
    _cachedSpreadsheet_ = SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error('เปิด Spreadsheet ไม่สำเร็จ (ID: ' + id + '): ' + err.message);
  }
  return _cachedSpreadsheet_;
}

/**
 * อ่านค่าจาก Config sheet (มี cache ผ่าน CacheService ลด round-trip ไปยัง Sheet ซ้ำ ๆ)
 * @param {string} key ค่าจาก CONFIG_KEYS
 * @param {*=} defaultValue
 * @return {*}
 */
function getConfig_(key, defaultValue) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'config_' + key;
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    if (cached === CONFIG_NULL_SENTINEL_) {
      return defaultValue !== undefined ? defaultValue : null;
    }
    return cached;
  }
  var record = findRecordByKey_(SHEET_NAMES.CONFIG, 'Key', key);
  var value = record ? record.Value : null;
  cache.put(cacheKey, (value === null || value === undefined) ? CONFIG_NULL_SENTINEL_ : String(value), CONFIG_CACHE_TTL_SECONDS_);
  if (value === null || value === undefined) {
    return defaultValue !== undefined ? defaultValue : null;
  }
  return value;
}

/**
 * เขียน/อัปเดตค่าใน Config sheet แล้ว invalidate cache ทันที
 * @param {string} key ค่าจาก CONFIG_KEYS
 * @param {*} value
 * @return {Object} record ที่เขียนจริง
 */
function setConfig_(key, value) {
  var result = upsertByKey_(SHEET_NAMES.CONFIG, 'Key', key, {
    Value: value,
    UpdatedAt: new Date().toISOString()
  });
  CacheService.getScriptCache().remove('config_' + key);
  return result;
}

/**
 * อ่านค่า config ทั้งหมดเป็น key-value map เดียว (batch read)
 * @return {Object<string, *>}
 */
function getAllConfigMap_() {
  var records = readAllRecords_(SHEET_NAMES.CONFIG).records;
  var map = {};
  records.forEach(function (r) { map[r.Key] = r.Value; });
  return map;
}
