/**
 * Setup.gs
 * Bootstrap ระบบทั้งหมดแบบ idempotent (รันซ้ำได้เรื่อย ๆ โดยไม่ทำข้อมูลเดิมพัง)
 *
 * วิธีใช้งาน: เปิด Apps Script Editor → เลือกฟังก์ชัน setupSystem → กด Run (อนุญาต OAuth ตอนรันครั้งแรก)
 * ผลลัพธ์: สร้าง Spreadsheet (ถ้ายังไม่มี), สร้างทุกชีตตาม schema ใน BLUEPRINT.md §7 พร้อม header,
 *          ตั้ง Data Validation ของคอลัมน์ที่เป็น enum, สร้างโฟลเดอร์ Drive สำหรับเก็บไฟล์, และ seed ค่า Config เริ่มต้น
 */

var SYSTEM_VERSION_ = '1.0.0';
var DEFAULT_SPREADSHEET_NAME_ = 'LTC_SmartCare_DB';
var DRIVE_ROOT_FOLDER_NAME_ = 'LTC_SmartCare_Files';
var VALIDATION_ROW_COUNT_ = 2000;

/** enum ที่ใช้ซ้ำหลายชีต */
var ENUM_ROLE_ = ['ADMIN', 'CM', 'CG', 'VIEWER'];
var ENUM_BOOL_ = ['TRUE', 'FALSE'];
var ENUM_GENDER_ = ['ชาย', 'หญิง'];
var ENUM_ADL_GROUP_ = ['ติดสังคม', 'ติดบ้าน', 'ติดเตียง'];
var ENUM_RISK_LEVEL_ = ['ต่ำ', 'ปานกลาง', 'สูง', 'สูงมาก'];
var ENUM_PATIENT_STATUS_ = ['นัดวันนี้', 'เยี่ยมแล้ว', 'เลยนัด', 'ยังไม่นัด'];
var ENUM_WOUND_STAGE_ = ['1', '2', '3', '4'];
var ENUM_VISIT_STATUS_ = ['draft', 'submitted'];
var ENUM_NOTIFICATION_CHANNEL_ = ['LINE'];
var ENUM_NOTIFICATION_STATUS_ = ['sent', 'failed', 'skipped_no_line_id'];
var ENUM_CAREPLAN_STATUS_ = ['draft', 'pendingApproval', 'approved', 'rejected'];
var ENUM_VISIT_REVIEW_STATUS_ = ['pending', 'reviewed'];

/**
 * นิยาม schema ของทุกชีต — ต้องตรงกับ BLUEPRINT.md §7 เป๊ะทุกคอลัมน์
 * @type {Array<{name: string, headers: Array<string>, validations: Array<{column: string, values: Array<string>}>}>}
 */
var SHEET_DEFINITIONS_ = [
  {
    name: SHEET_NAMES.USERS,
    headers: ['UserId', 'Role', 'Name', 'Username', 'PasswordHash', 'CID', 'Phone', 'LineUserId', 'Active', 'CreatedAt', 'UpdatedAt'],
    validations: [
      { column: 'Role', values: ENUM_ROLE_ },
      { column: 'Active', values: ENUM_BOOL_ }
    ]
  },
  {
    name: SHEET_NAMES.PATIENTS,
    headers: ['PatientId', 'HN', 'CID', 'Name', 'Gender', 'BirthDate', 'Village', 'Tambon', 'Amphoe', 'Changwat',
      'AdlGroup', 'AdlScore', 'RiskLevel', 'PrimaryCgUserId', 'ResponsibleCmUserId', 'Status', 'NextVisitDate',
      'DriveFolderId', 'IsDeleted', 'CreatedAt', 'UpdatedAt'],
    validations: [
      { column: 'Gender', values: ENUM_GENDER_ },
      { column: 'AdlGroup', values: ENUM_ADL_GROUP_ },
      { column: 'RiskLevel', values: ENUM_RISK_LEVEL_ },
      { column: 'Status', values: ENUM_PATIENT_STATUS_ },
      { column: 'IsDeleted', values: ENUM_BOOL_ }
    ],
    // บังคับ Plain Text กันชีตแปลง string "YYYY-MM-DD" เป็น Date object อัตโนมัติ (ทำให้อ่านกลับมาไม่ตรงกับที่เขียนไป)
    plainTextColumns: ['BirthDate', 'NextVisitDate']
  },
  {
    name: SHEET_NAMES.VISITS,
    headers: ['VisitId', 'PatientId', 'VisitedByUserId', 'VisitNumber', 'VisitDate', 'GpsLat', 'GpsLng',
      'CaregiverName', 'Relation', 'BP', 'HR', 'Temp', 'SpO2', 'HasWound', 'WoundLocation', 'WoundStage',
      'WoundSize', 'WoundCare', 'WoundPhotoFileIds', 'Symptoms', 'Medication', 'Nutrition', 'Excretion', 'Sleep',
      'FallRiskNote', 'CaregiverBurdenNote', 'ServicesGiven', 'Notes', 'NextVisitDate', 'SignatureFileId',
      'Status', 'SyncedFromOffline', 'ClientTempId', 'CreatedAt', 'UpdatedAt',
      'ReviewStatus', 'ReviewedByUserId', 'ReviewedAt', 'ReviewNote'],
    validations: [
      { column: 'HasWound', values: ENUM_BOOL_ },
      { column: 'WoundStage', values: ENUM_WOUND_STAGE_ },
      { column: 'Status', values: ENUM_VISIT_STATUS_ },
      { column: 'SyncedFromOffline', values: ENUM_BOOL_ },
      { column: 'ReviewStatus', values: ENUM_VISIT_REVIEW_STATUS_ }
    ],
    plainTextColumns: ['NextVisitDate']
  },
  {
    name: SHEET_NAMES.ASSESSMENTS_BARTHEL,
    headers: ['AssessmentId', 'PatientId', 'VisitId', 'AssessedByUserId', 'Answers', 'TotalScore', 'Group', 'CreatedAt', 'RequestId'],
    validations: [
      { column: 'Group', values: ENUM_ADL_GROUP_ }
    ]
  },
  {
    name: SHEET_NAMES.ASSESSMENTS_DEPRESSION,
    headers: ['AssessmentId', 'PatientId', 'VisitId', 'AssessedByUserId', 'TwoQAnswers', 'NineQAnswers',
      'NineQTotal', 'EightQAnswers', 'EightQTotal', 'EightQVerdict', 'AlertSent', 'CreatedAt', 'RequestId'],
    validations: [
      { column: 'AlertSent', values: ENUM_BOOL_ }
    ]
  },
  {
    name: SHEET_NAMES.ASSESSMENTS_FALLRISK,
    headers: ['AssessmentId', 'PatientId', 'VisitId', 'AssessedByUserId', 'Answers', 'TotalScore', 'Verdict', 'CreatedAt', 'RequestId'],
    validations: []
  },
  {
    name: SHEET_NAMES.ASSESSMENTS_CAREGIVERBURDEN,
    headers: ['AssessmentId', 'PatientId', 'VisitId', 'AssessedByUserId', 'Answers', 'TotalScore', 'Verdict', 'CreatedAt', 'RequestId'],
    validations: []
  },
  {
    name: SHEET_NAMES.ASSESSMENTS_PRESSUREULCER,
    headers: ['AssessmentId', 'PatientId', 'VisitId', 'AssessedByUserId', 'HasWound', 'Location', 'Size', 'CreatedAt', 'Stage', 'RequestId'],
    validations: [
      { column: 'HasWound', values: ENUM_BOOL_ },
      { column: 'Stage', values: ENUM_WOUND_STAGE_ }
    ]
  },
  {
    name: SHEET_NAMES.ASSESSMENTS_INHOMESSS,
    headers: ['AssessmentId', 'PatientId', 'VisitId', 'AssessedByUserId', 'RequestId', 'Answers', 'TotalScore', 'Verdict', 'CreatedAt'],
    validations: []
  },
  {
    name: SHEET_NAMES.CARE_PLANS,
    headers: ['CarePlanId', 'PatientId', 'CreatedByUserId', 'Problems', 'Goals', 'Interventions', 'ReviewDate',
      'Status', 'ApprovedByUserId', 'ApprovedAt', 'RejectedReason', 'CreatedAt', 'UpdatedAt'],
    validations: [
      { column: 'Status', values: ENUM_CAREPLAN_STATUS_ }
    ],
    plainTextColumns: ['ReviewDate']
  },
  {
    name: SHEET_NAMES.SESSIONS,
    headers: ['Token', 'UserId', 'CreatedAt', 'ExpiresAt', 'LastActiveAt', 'DeviceInfo'],
    validations: []
  },
  {
    name: SHEET_NAMES.CONFIG,
    headers: ['Key', 'Value', 'UpdatedAt'],
    validations: []
  },
  {
    name: SHEET_NAMES.AUDIT_LOG,
    headers: ['LogId', 'Timestamp', 'UserId', 'Action', 'TargetType', 'TargetId', 'Detail'],
    validations: []
  },
  {
    name: SHEET_NAMES.NOTIFICATIONS,
    headers: ['NotificationId', 'RecipientUserId', 'Type', 'Message', 'RelatedPatientId', 'Channel', 'Status', 'CreatedAt',
      'RetryCount', 'LastAttemptAt'],
    validations: [
      { column: 'Channel', values: ENUM_NOTIFICATION_CHANNEL_ },
      { column: 'Status', values: ENUM_NOTIFICATION_STATUS_ }
    ]
  }
];

/**
 * จุดเริ่มต้นเดียวสำหรับตั้งค่าระบบทั้งหมด — เรียกซ้ำได้เสมอ (idempotent)
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function setupSystem() {
  var startedAt = new Date().getTime();
  try {
    var spreadsheetId = ensureSpreadsheetId_();
    var ss = getSpreadsheet_();

    var sheetsCreated = [];
    var sheetsExisting = [];
    SHEET_DEFINITIONS_.forEach(function (definition) {
      var created = ensureSheet_(ss, definition);
      if (created) {
        sheetsCreated.push(definition.name);
      } else {
        sheetsExisting.push(definition.name);
      }
    });

    var driveFolderId = ensureDriveRootFolder_();
    var configSeeded = seedDefaultConfig_(driveFolderId);
    var passwordSaltGenerated = ensurePasswordSalt_();

    var summary = {
      spreadsheetId: spreadsheetId,
      spreadsheetUrl: ss.getUrl(),
      sheetsCreated: sheetsCreated,
      sheetsExisting: sheetsExisting,
      driveFolderId: driveFolderId,
      configSeeded: configSeeded,
      passwordSaltGenerated: passwordSaltGenerated,
      durationMs: new Date().getTime() - startedAt
    };

    Logger.log('[setupSystem] เสร็จสมบูรณ์: ' + JSON.stringify(summary));
    logAudit_('SYSTEM', 'system.setup', 'System', spreadsheetId, summary);
    return ok_(summary);
  } catch (err) {
    Logger.log('[setupSystem] ล้มเหลว: ' + (err.stack || err));
    return errFromException_(err, ERROR_CODES.SERVER);
  }
}

/**
 * ตรวจ/สร้าง Spreadsheet ID ใน Script Properties — ถ้ามีอยู่แล้วตรวจว่าเปิดได้จริง, ถ้าไม่มีให้สร้างใหม่ทั้ง Spreadsheet
 * @return {string} spreadsheetId
 */
function ensureSpreadsheetId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SCRIPT_PROPERTY_KEYS.SPREADSHEET_ID);
  if (id) {
    try {
      SpreadsheetApp.openById(id);
      return id;
    } catch (err) {
      throw new Error('SPREADSHEET_ID ที่ตั้งค่าไว้ (' + id + ') เปิดไม่ได้: ' + err.message + ' — กรุณาตรวจสอบ Script Properties');
    }
  }
  var ss = SpreadsheetApp.create(DEFAULT_SPREADSHEET_NAME_);
  id = ss.getId();
  props.setProperty(SCRIPT_PROPERTY_KEYS.SPREADSHEET_ID, id);
  _cachedSpreadsheet_ = ss;
  Logger.log('[setupSystem] สร้าง Spreadsheet ใหม่: ' + id);
  return id;
}

/**
 * สร้าง PASSWORD_SALT ใน Script Properties อัตโนมัติถ้ายังไม่มี (จำเป็นสำหรับ hashPassword_ ใน Auth.gs)
 * สุ่มด้วย Utilities.getUuid() เสมอ — ห้าม hardcode ค่าไว้ในโค้ดเด็ดขาด
 * @return {boolean} true ถ้าเพิ่งสร้างใหม่ในรอบนี้ (false ถ้ามีอยู่แล้ว)
 */
function ensurePasswordSalt_() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(SCRIPT_PROPERTY_KEYS.PASSWORD_SALT);
  if (existing) return false;
  props.setProperty(SCRIPT_PROPERTY_KEYS.PASSWORD_SALT, Utilities.getUuid() + Utilities.getUuid());
  Logger.log('[setupSystem] สร้าง PASSWORD_SALT ใหม่ใน Script Properties');
  return true;
}

/**
 * สร้างชีต (ถ้ายังไม่มี), เติม/ซ่อม header, และตั้ง data validation — ปลอดภัยต่อการรันซ้ำ
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Object} definition หนึ่งรายการจาก SHEET_DEFINITIONS_
 * @return {boolean} true ถ้าเพิ่งสร้างชีตใหม่ (ไม่เคยมีมาก่อน)
 */
function ensureSheet_(ss, definition) {
  var sheet = ss.getSheetByName(definition.name);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(definition.name);
    created = true;
  }
  applyHeaders_(sheet, definition.headers);
  applyValidations_(sheet, definition);
  applyPlainTextColumns_(sheet, definition);
  sheet.setFrozenRows(1);
  return created;
}

/**
 * เขียน header แถวแรก — ถ้ามี header เดิมอยู่แล้ว จะเติมเฉพาะคอลัมน์ที่ยังขาดต่อท้าย (ไม่ลบ/ไม่สลับของเดิม)
 * เพื่อความปลอดภัยเวลามีการเพิ่มคอลัมน์ใหม่ใน schema ภายหลัง (แนวทาง schema migration แบบ append-only)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<string>} headers
 */
function applyHeaders_(sheet, headers) {
  var existingHeaders = getHeaderRow_(sheet);
  if (existingHeaders.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
    if (missing.length > 0) {
      var startCol = existingHeaders.length + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    }
  }
  var headerRange = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length));
  headerRange.setFontWeight('bold').setBackground('#f1f5f9');
}

/**
 * ตั้ง Data Validation (dropdown list) ให้คอลัมน์ enum ตาม definition.validations
 * ขยายจำนวนแถวของชีตให้ครอบคลุม VALIDATION_ROW_COUNT_ แถวไว้ล่วงหน้า
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object} definition
 */
function applyValidations_(sheet, definition) {
  if (!definition.validations || definition.validations.length === 0) return;

  if (sheet.getMaxRows() < VALIDATION_ROW_COUNT_) {
    sheet.insertRowsAfter(sheet.getMaxRows(), VALIDATION_ROW_COUNT_ - sheet.getMaxRows());
  }

  var headers = getHeaderRow_(sheet);
  var maxRows = sheet.getMaxRows();

  definition.validations.forEach(function (rule) {
    var colIndex = headers.indexOf(rule.column) + 1;
    if (colIndex === 0) return; // ไม่พบคอลัมน์นี้ ข้าม (กันพลาดจาก schema ไม่ตรงกัน)
    var range = sheet.getRange(2, colIndex, maxRows - 1, 1);
    var validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(rule.values, true)
      .setAllowInvalid(false)
      .build();
    range.setDataValidation(validation);
  });
}

/**
 * บังคับคอลัมน์ที่เก็บ string วันที่ (YYYY-MM-DD) ให้เป็น Plain Text เสมอ
 * กัน Google Sheets ตีความ string วันที่เป็น Date object อัตโนมัติตอนเขียน (ทำให้อ่านกลับมาไม่ตรงกับที่ส่งเข้ามา
 * และ isValidIsoDate_/computeAge_ พังเพราะเจอ Date object แทน string)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object} definition
 */
function applyPlainTextColumns_(sheet, definition) {
  if (!definition.plainTextColumns || definition.plainTextColumns.length === 0) return;

  if (sheet.getMaxRows() < VALIDATION_ROW_COUNT_) {
    sheet.insertRowsAfter(sheet.getMaxRows(), VALIDATION_ROW_COUNT_ - sheet.getMaxRows());
  }

  var headers = getHeaderRow_(sheet);
  var maxRows = sheet.getMaxRows();

  definition.plainTextColumns.forEach(function (columnName) {
    var colIndex = headers.indexOf(columnName) + 1;
    if (colIndex === 0) return;
    sheet.getRange(2, colIndex, maxRows - 1, 1).setNumberFormat('@');
  });
}

/**
 * หา/สร้างโฟลเดอร์ Drive สำหรับเก็บไฟล์ทั้งระบบ (idempotent: เช็ค Config ก่อน แล้วเช็คชื่อซ้ำใน Drive ก่อนสร้างใหม่)
 * @return {string} folderId
 */
function ensureDriveRootFolder_() {
  var existingId = getConfig_(CONFIG_KEYS.DRIVE_ROOT_FOLDER_ID, null);
  if (existingId) {
    try {
      DriveApp.getFolderById(existingId);
      return existingId;
    } catch (err) {
      Logger.log('[setupSystem] DRIVE_ROOT_FOLDER_ID เดิม (' + existingId + ') เปิดไม่ได้ จะสร้างใหม่: ' + err.message);
    }
  }

  var existingFolders = DriveApp.getFoldersByName(DRIVE_ROOT_FOLDER_NAME_);
  if (existingFolders.hasNext()) {
    return existingFolders.next().getId();
  }

  var folder = DriveApp.createFolder(DRIVE_ROOT_FOLDER_NAME_);
  return folder.getId();
}

/**
 * seed ค่าเริ่มต้นลง Config sheet (upsert — รันซ้ำไม่ทำให้ซ้ำแถว)
 * @param {string} driveFolderId
 * @return {Array<string>} รายชื่อคีย์ที่ seed
 */
function seedDefaultConfig_(driveFolderId) {
  var defaults = {};
  defaults[CONFIG_KEYS.APP_VERSION] = SYSTEM_VERSION_;
  defaults[CONFIG_KEYS.DRIVE_ROOT_FOLDER_ID] = driveFolderId;
  defaults[CONFIG_KEYS.SETUP_LAST_RUN_AT] = new Date().toISOString();

  var seeded = [];
  Object.keys(defaults).forEach(function (key) {
    setConfig_(key, defaults[key]);
    seeded.push(key);
  });
  return seeded;
}

/**
 * สร้างบัญชี ADMIN คนแรกของระบบ — เรียกเองจาก Apps Script Editor เท่านั้น (ไม่ผูกกับ Router.gs ไม่เปิดเป็น action สาธารณะ)
 * แก้ปัญหาไก่กับไข่: admin.users.create ต้องมี ADMIN อยู่แล้วถึงจะเรียกได้ แต่ระบบใหม่ยังไม่มี ADMIN เลยสักคน
 *
 * ทำงานเฉพาะตอนที่ยังไม่มีผู้ใช้ Role=ADMIN อยู่ในระบบเลยเท่านั้น (ป้องกันเรียกซ้ำ/ป้องกันคนนอกยิงมาสร้างเอง เพราะฟังก์ชันนี้ไม่ได้ผ่าน RBAC ใด ๆ)
 * วิธีใช้: เปิด Apps Script Editor → เลือกไฟล์นี้ → แก้ค่าที่ต้องการในบรรทัด bootstrapFirstAdmin_('username','password','ชื่อ-สกุล') ชั่วคราว → กด Run
 *
 * @param {string} username
 * @param {string} password ต้องยาวอย่างน้อย MIN_PASSWORD_LENGTH_ ตัวอักษร (ดู Auth.gs)
 * @param {string} name ชื่อ-สกุลที่แสดงผล
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function bootstrapFirstAdmin_(username, password, name) {
  try {
    var existingAdmin = findRecord_(SHEET_NAMES.USERS, function (r) { return r.Role === 'ADMIN'; });
    if (existingAdmin) {
      return err_(ERROR_CODES.CONFLICT, 'มีบัญชี ADMIN อยู่แล้วในระบบ ('
        + existingAdmin.Username + ') — ใช้ action admin.users.create ผ่าน API แทนสำหรับ ADMIN คนถัดไป');
    }
    if (!isNonEmptyString_(username) || !isNonEmptyString_(password) || !isNonEmptyString_(name)) {
      return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ username, password, name ให้ครบ');
    }
    if (password.length < MIN_PASSWORD_LENGTH_) {
      return err_(ERROR_CODES.VALIDATION, 'รหัสผ่านต้องมีความยาวอย่างน้อย ' + MIN_PASSWORD_LENGTH_ + ' ตัวอักษร');
    }

    var now = new Date().toISOString();
    var created = appendRecord_(SHEET_NAMES.USERS, {
      UserId: generateShortId_('U'),
      Role: 'ADMIN',
      Name: name,
      Username: username.trim().toLowerCase(),
      PasswordHash: hashPassword_(password),
      CID: '',
      Phone: '',
      LineUserId: '',
      Active: true,
      CreatedAt: now,
      UpdatedAt: now
    });

    logAudit_('SYSTEM', 'system.bootstrapFirstAdmin', 'User', created.UserId, {});
    Logger.log('[bootstrapFirstAdmin_] สร้างบัญชี ADMIN แรกสำเร็จ: ' + created.UserId);
    return ok_({ user: sanitizeUserForClient_(created) });
  } catch (err) {
    return errFromException_(err, ERROR_CODES.SERVER);
  }
}
