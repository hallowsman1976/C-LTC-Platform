/**
 * SheetService.gs
 * ชั้นเข้าถึงข้อมูล (data-access layer) สำหรับ Google Sheets ทั้งหมด
 * กติกา: อ่านทั้งชีตครั้งเดียวด้วย getDataRange()/getRange().getValues() เสมอ,
 *        เขียนแบบ batch (setValues ครั้งเดียว) แทนการเขียนทีละเซลล์,
 *        ทุก mutation ครอบด้วย LockService กัน race condition เวลาเขียนพร้อมกันหลาย request
 */

/**
 * Error ชนิดพิเศษเมื่อขอ Lock ไม่สำเร็จภายในเวลาที่กำหนด — Response.gs จะแปลงเป็น ERR_LOCK_TIMEOUT ให้อัตโนมัติ
 * @param {string} message
 * @constructor
 */
function SheetLockError_(message) {
  this.name = 'SheetLockError';
  this.message = message;
  this.isLockTimeout = true;
}
SheetLockError_.prototype = Object.create(Error.prototype);
SheetLockError_.prototype.constructor = SheetLockError_;

var SHEET_LOCK_WAIT_MS_ = 10000;

/**
 * รันฟังก์ชันภายใต้ script lock — ใช้ครอบทุกการเขียน (append/update) กัน 2 request เขียนชนกัน
 * @param {function():*} fn
 * @return {*} ค่าที่ fn คืนกลับมา
 */
function withSheetLock_(fn) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(SHEET_LOCK_WAIT_MS_);
  if (!acquired) {
    throw new SheetLockError_('ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึง Sheet object ตามชื่อ — throw ถ้าไม่พบ (แปลว่ายังไม่ได้รัน setupSystem())
 * @param {string} sheetName
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheetByName_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('ไม่พบชีต "' + sheetName + '" กรุณารัน setupSystem() ก่อนใช้งานระบบ');
  }
  return sheet;
}

/**
 * อ่านแถว header (แถวที่ 1) ของชีต
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Array<string>}
 */
function getHeaderRow_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

/**
 * แปลงแถวข้อมูล (array) → record object ตาม header พร้อมแนบ _rowIndex ไว้ใช้ update/reference ภายหลัง
 * @param {Array<string>} headers
 * @param {Array<*>} rowValues
 * @param {number} rowIndex เลขแถวจริงใน sheet (1-indexed)
 * @return {Object}
 */
function rowToRecord_(headers, rowValues, rowIndex) {
  var record = {};
  headers.forEach(function (h, i) { record[h] = rowValues[i]; });
  record._rowIndex = rowIndex;
  return record;
}

/**
 * แปลง record object → แถวข้อมูล (array) ตามลำดับ header พร้อม sanitize ป้องกัน Formula Injection ทุกค่า
 * @param {Array<string>} headers
 * @param {Object} record
 * @return {Array<*>}
 */
function recordToRow_(headers, record) {
  return headers.map(function (h) {
    var v = record[h];
    return sanitizeForSheetValue_(v === undefined ? '' : v);
  });
}

/**
 * อ่านทุกแถวข้อมูลของชีต (ไม่รวม header) ด้วยการอ่านครั้งเดียว (batch read)
 * @param {string} sheetName
 * @return {{sheet: GoogleAppsScript.Spreadsheet.Sheet, headers: Array<string>, records: Array<Object>}}
 */
function readAllRecords_(sheetName) {
  var sheet = getSheetByName_(sheetName);
  var headers = getHeaderRow_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || headers.length === 0) {
    return { sheet: sheet, headers: headers, records: [] };
  }
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var records = values.map(function (row, i) { return rowToRecord_(headers, row, i + 2); });
  return { sheet: sheet, headers: headers, records: records };
}

/**
 * หา record แรกที่ผ่านเงื่อนไข predicate
 * @param {string} sheetName
 * @param {function(Object):boolean} predicateFn
 * @return {Object|null}
 */
function findRecord_(sheetName, predicateFn) {
  var records = readAllRecords_(sheetName).records;
  for (var i = 0; i < records.length; i++) {
    if (predicateFn(records[i])) return records[i];
  }
  return null;
}

/**
 * หา record ทั้งหมดที่ผ่านเงื่อนไข predicate (ไม่ส่ง predicate = คืนทั้งหมด)
 * @param {string} sheetName
 * @param {function(Object):boolean=} predicateFn
 * @return {Array<Object>}
 */
function findRecords_(sheetName, predicateFn) {
  var records = readAllRecords_(sheetName).records;
  return predicateFn ? records.filter(predicateFn) : records;
}

/**
 * หา record ด้วยคีย์ (เช่น PatientId, Token) แบบ exact match (แปลงเป็น string ก่อนเทียบ)
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {*} keyValue
 * @return {Object|null}
 */
function findRecordByKey_(sheetName, keyColumn, keyValue) {
  return findRecord_(sheetName, function (r) { return String(r[keyColumn]) === String(keyValue); });
}

/**
 * เพิ่มแถวใหม่ 1 แถว (append) ภายใต้ lock
 *
 * ใช้ getRange().setValues() แทน sheet.appendRow() โดยเจตนา — appendRow() ไม่เคารพ number format
 * ที่ตั้งไว้ล่วงหน้าบนเซลล์ปลายทาง (เช่น Plain Text '@' ที่ applyPlainTextColumns_ ตั้งไว้ใน Setup.gs)
 * ทำให้ string วันที่ "YYYY-MM-DD" ถูก Sheets auto-convert เป็น Date object ทุกครั้งที่ appendRow
 * ทั้งที่ updateRecord_ (ซึ่งใช้ setValues() อยู่แล้ว) ไม่มีปัญหานี้ — จึงรวมมาใช้ setValues() ให้ตรงกัน
 *
 * @param {string} sheetName
 * @param {Object} record
 * @return {Object} record ที่เขียนจริง พร้อม _rowIndex
 */
function appendRecord_(sheetName, record) {
  return withSheetLock_(function () {
    var sheet = getSheetByName_(sheetName);
    var headers = getHeaderRow_(sheet);
    var row = recordToRow_(headers, record);
    var rowIndex = sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
    return rowToRecord_(headers, row, rowIndex);
  });
}

/**
 * เพิ่มหลายแถวพร้อมกันด้วย setValues ครั้งเดียว (batch write) — ใช้ตอน sync offline queue หรือ seed ข้อมูล
 * @param {string} sheetName
 * @param {Array<Object>} records
 * @return {Array<Object>} รายการ record ที่เขียนจริง พร้อม _rowIndex
 */
function appendRecords_(sheetName, records) {
  if (!records || records.length === 0) return [];
  return withSheetLock_(function () {
    var sheet = getSheetByName_(sheetName);
    var headers = getHeaderRow_(sheet);
    var rows = records.map(function (r) { return recordToRow_(headers, r); });
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
    return rows.map(function (row, i) { return rowToRecord_(headers, row, startRow + i); });
  });
}

/**
 * แก้ไข record เดิม 1 แถว (merge patch เข้ากับของเดิม แล้วเขียนทับทั้งแถวในครั้งเดียว)
 * @param {string} sheetName
 * @param {number} rowIndex เลขแถวจริงใน sheet (1-indexed, ได้มาจาก record._rowIndex)
 * @param {Object} patch ฟิลด์ที่ต้องการแก้ไข (ไม่ต้องส่งครบทุกคอลัมน์)
 * @return {Object} record ใหม่หลังแก้ไข
 */
function updateRecord_(sheetName, rowIndex, patch) {
  return withSheetLock_(function () {
    var sheet = getSheetByName_(sheetName);
    var headers = getHeaderRow_(sheet);
    var current = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    var currentRecord = rowToRecord_(headers, current, rowIndex);
    var merged = Object.assign({}, currentRecord, patch);
    delete merged._rowIndex;
    var newRow = recordToRow_(headers, merged);
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([newRow]);
    return rowToRecord_(headers, newRow, rowIndex);
  });
}

/**
 * แก้ไขหลายแถวพร้อมกันด้วยการอ่าน+เขียนช่วงข้อมูลทั้งหมดครั้งเดียว (batch update)
 * เหมาะกับกรณีต้องอัปเดตหลายแถวไม่ติดกัน (เช่น ปิดใช้งานผู้ใช้หลายคนพร้อมกัน)
 * @param {string} sheetName
 * @param {Array<{rowIndex: number, patch: Object}>} updates
 * @return {Array<Object>} record ที่ถูกแก้ไข
 */
function batchUpdateRecords_(sheetName, updates) {
  if (!updates || updates.length === 0) return [];
  return withSheetLock_(function () {
    var sheet = getSheetByName_(sheetName);
    var headers = getHeaderRow_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var range = sheet.getRange(2, 1, lastRow - 1, headers.length);
    var values = range.getValues();
    var updatesByRow = {};
    updates.forEach(function (u) { updatesByRow[u.rowIndex] = u.patch; });
    var results = [];
    for (var i = 0; i < values.length; i++) {
      var rowIndex = i + 2;
      if (updatesByRow[rowIndex]) {
        var record = rowToRecord_(headers, values[i], rowIndex);
        var merged = Object.assign({}, record, updatesByRow[rowIndex]);
        delete merged._rowIndex;
        values[i] = recordToRow_(headers, merged);
        results.push(rowToRecord_(headers, values[i], rowIndex));
      }
    }
    range.setValues(values);
    return results;
  });
}

/**
 * Upsert ตามคีย์ — พบแล้วแก้ไข, ไม่พบให้เพิ่มใหม่ (ใช้กับ Config sheet และ draft ที่ sync ซ้ำได้)
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {*} keyValue
 * @param {Object} patch
 * @return {Object}
 */
function upsertByKey_(sheetName, keyColumn, keyValue, patch) {
  var existing = findRecordByKey_(sheetName, keyColumn, keyValue);
  if (existing) {
    return updateRecord_(sheetName, existing._rowIndex, patch);
  }
  var record = Object.assign({}, patch);
  record[keyColumn] = keyValue;
  return appendRecord_(sheetName, record);
}

/**
 * ลบแถวเดียวตามเลขแถวจริง (1-indexed) แบบถาวร — ใช้กับ logout (ลบ session) เป็นหลัก
 * @param {string} sheetName
 * @param {number} rowIndex
 * @return {boolean}
 */
function deleteRow_(sheetName, rowIndex) {
  return withSheetLock_(function () {
    var sheet = getSheetByName_(sheetName);
    sheet.deleteRow(rowIndex);
    return true;
  });
}

/**
 * ลบทุกแถวที่ตรงเงื่อนไข predicate ในครั้งเดียว (เรียงลบจากแถวล่างขึ้นบนกัน rowIndex เพี้ยนระหว่างลบ)
 * ใช้เมื่อ revoke session ทุกอันของผู้ใช้คนหนึ่ง (เช่น หลัง resetPassword)
 * @param {string} sheetName
 * @param {function(Object):boolean} predicateFn
 * @return {number} จำนวนแถวที่ถูกลบ
 */
function deleteRecordsWhere_(sheetName, predicateFn) {
  var matches = findRecords_(sheetName, predicateFn);
  if (matches.length === 0) return 0;
  return withSheetLock_(function () {
    var sheet = getSheetByName_(sheetName);
    var rowIndexes = matches.map(function (r) { return r._rowIndex; }).sort(function (a, b) { return b - a; });
    rowIndexes.forEach(function (rowIndex) { sheet.deleteRow(rowIndex); });
    return rowIndexes.length;
  });
}
