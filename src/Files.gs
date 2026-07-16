/**
 * Files.gs
 * อัปโหลดไฟล์ภาพ/ลายเซ็น (base64) ขึ้น Google Drive — action: files.upload
 * ปิดช่องว่างที่ BLUEPRINT.md §9/§10.6/§15 ระบุไว้ตั้งแต่ Phase 1 แต่ยังไม่เคยมี backend action จริงจนถึง Phase 9
 * (ฟอร์มบันทึกการเยี่ยม Phase 8 จึงต้องส่ง woundPhotoFileIds/signatureFileId เป็นค่าว่างชั่วคราว — เฟสนี้แก้ไขจุดนั้น)
 *
 * กติกา:
 * - จำกัดขนาดไฟล์ไม่เกิน 5MB (หลังบีบอัด/ย่อขนาดฝั่ง frontend แล้ว) ตาม BLUEPRINT.md §15
 * - เก็บไฟล์แยกโฟลเดอร์ต่อผู้ป่วยใต้ DRIVE_ROOT_FOLDER_ID (lazy-create ครั้งแรกที่อัปโหลดของผู้ป่วยรายนั้น)
 * - ไฟล์ทุกไฟล์เป็น private ตามค่าเริ่มต้นของ DriveApp.createFile (ไม่เปิดสาธารณะ) ตาม PDPA — ห้ามเรียก setSharing
 *   ให้เป็น ANYONE ใด ๆ เด็ดขาด (เจ้าของไฟล์คือบัญชีที่ deploy เว็บแอป ซึ่งเป็นบัญชีเดียวที่เข้าถึง Spreadsheet ได้อยู่แล้ว)
 * - Idempotent แบบ deterministic filename (clientTempId + category) — เรียกซ้ำด้วยไฟล์ชื่อเดิมจะได้ fileId เดิม
 *   ไม่สร้างไฟล์ซ้ำซ้อน (สำคัญเพราะ Offline Queue ของฟอร์มบันทึกการเยี่ยมอาจเรียก submit ซ้ำได้ตาม BLUEPRINT.md §14)
 */

var MAX_FILE_SIZE_BYTES_ = 5 * 1024 * 1024; // 5MB
var ALLOWED_UPLOAD_MIME_TYPES_ = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * @param {{patientId:string, category:string, mimeType:string, fileName:string, base64Data:string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function uploadFile(payload, callerUser) {
  payload = payload || {};

  var requiredCheck = validateRequiredFields_(payload, ['patientId', 'mimeType', 'fileName', 'base64Data']);
  if (!requiredCheck.valid) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุข้อมูลไฟล์ให้ครบถ้วน', { fields: requiredCheck.fields });
  }

  if (!isValidEnum_(payload.mimeType, ALLOWED_UPLOAD_MIME_TYPES_)) {
    return err_(ERROR_CODES.VALIDATION, 'รองรับเฉพาะไฟล์ภาพ JPEG, PNG หรือ WEBP เท่านั้น', {
      fields: { mimeType: 'ต้องเป็นหนึ่งใน ' + ALLOWED_UPLOAD_MIME_TYPES_.join(', ') }
    });
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', payload.patientId);
  if (!patient || coerceBoolean_(patient.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (!canAccessPatient_(callerUser, patient) || callerUser.role === 'VIEWER') {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์อัปโหลดไฟล์ให้ผู้ป่วยรายนี้');
  }

  var decodedBytes;
  try {
    decodedBytes = Utilities.base64Decode(payload.base64Data);
  } catch (err) {
    return err_(ERROR_CODES.VALIDATION, 'ข้อมูลไฟล์ (base64) ไม่ถูกต้องหรือเสียหาย');
  }

  if (decodedBytes.length > MAX_FILE_SIZE_BYTES_) {
    return err_(ERROR_CODES.FILE_TOO_LARGE, 'ไฟล์มีขนาดเกิน 5MB กรุณาย่อขนาด/บีบอัดไฟล์ก่อนอัปโหลดใหม่อีกครั้ง');
  }

  var folder;
  try {
    folder = getOrCreatePatientDriveFolder_(patient);
  } catch (err) {
    return errFromException_(err, ERROR_CODES.SERVER);
  }

  // ชื่อไฟล์ deterministic จาก payload.fileName ที่ frontend ส่งมา (ควรฝัง clientTempId+category ไว้แล้ว) — ทำให้ idempotent
  var existingFiles = folder.getFilesByName(payload.fileName);
  if (existingFiles.hasNext()) {
    var existingFile = existingFiles.next();
    return ok_({ fileId: existingFile.getId(), viewUrl: buildDriveViewUrl_(existingFile.getId()) });
  }

  var blob = Utilities.newBlob(decodedBytes, payload.mimeType, payload.fileName);
  var createdFile = folder.createFile(blob);

  logAudit_(callerUser.userId, 'files.upload', 'File', createdFile.getId(), {
    patientId: payload.patientId, category: payload.category || '', sizeBytes: decodedBytes.length
  });

  return ok_({ fileId: createdFile.getId(), viewUrl: buildDriveViewUrl_(createdFile.getId()) });
}

/**
 * หา/สร้างโฟลเดอร์ Drive ของผู้ป่วยรายหนึ่ง (lazy-create ครั้งแรก) ใต้โฟลเดอร์รากของระบบ
 * @param {Object} patientRecord
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getOrCreatePatientDriveFolder_(patientRecord) {
  if (isNonEmptyString_(patientRecord.DriveFolderId)) {
    try {
      return DriveApp.getFolderById(patientRecord.DriveFolderId);
    } catch (err) {
      Logger.log('[getOrCreatePatientDriveFolder_] DriveFolderId เดิม (' + patientRecord.DriveFolderId + ') เปิดไม่ได้ จะสร้างใหม่: ' + err.message);
    }
  }

  var rootFolderId = getConfig_(CONFIG_KEYS.DRIVE_ROOT_FOLDER_ID, null);
  var parentFolder = rootFolderId ? DriveApp.getFolderById(rootFolderId) : DriveApp.getRootFolder();

  var folderName = patientRecord.PatientId + '_' + patientRecord.HN;
  var existingFolders = parentFolder.getFoldersByName(folderName);
  var patientFolder = existingFolders.hasNext() ? existingFolders.next() : parentFolder.createFolder(folderName);

  updateRecord_(SHEET_NAMES.PATIENTS, patientRecord._rowIndex, {
    DriveFolderId: patientFolder.getId(),
    UpdatedAt: new Date().toISOString()
  });

  return patientFolder;
}

/**
 * @param {string} fileId
 * @return {string}
 */
function buildDriveViewUrl_(fileId) {
  return 'https://drive.google.com/uc?id=' + fileId;
}
