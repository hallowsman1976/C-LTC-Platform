/**
 * Patients.gs
 * จัดการข้อมูลผู้ป่วย (master data) + มอบหมายทีมดูแล (CG/CM) ตาม BLUEPRINT.md §3, §7
 *
 * กติกาการมองเห็น (ownership scoping) — บังคับใช้ทุก action ในไฟล์นี้และไฟล์ที่เกี่ยวข้อง (CarePlans.gs):
 *   - ADMIN, VIEWER  เห็นผู้ป่วยทุกคน (VIEWER อ่านอย่างเดียว)
 *   - CM             เห็นเฉพาะผู้ป่วยที่ตน (ResponsibleCmUserId) รับผิดชอบ
 *   - CG             เห็นเฉพาะผู้ป่วยที่ตน (PrimaryCgUserId) รับผิดชอบ
 * ห้ามพึ่งการซ่อนปุ่มฝั่ง frontend — ต้องเช็คที่นี่เสมอ (canAccessPatient_)
 */

var PATIENT_REQUIRED_FIELDS_ = ['name', 'gender', 'birthDate', 'hn', 'cid', 'village', 'tambon', 'amphoe', 'changwat'];
var PATIENT_PATCH_ALLOWED_KEYS_ = ['name', 'gender', 'birthDate', 'hn', 'village', 'tambon', 'amphoe', 'changwat', 'status', 'nextVisitDate'];
var PATIENT_LIST_MAX_PAGE_SIZE_ = 100;

/* ============================================================
 * Ownership / Visibility scoping — ใช้ร่วมกับ CarePlans.gs
 * ============================================================ */

/**
 * ตรวจว่า user คนนี้เข้าถึงข้อมูลผู้ป่วยรายนี้ได้หรือไม่ ตามบทบาท (ADMIN/VIEWER เห็นทุกคน, CM/CG เห็นเฉพาะที่รับผิดชอบ)
 * @param {Object} user user object (camelCase) จาก requireUser_
 * @param {Object} patientRecord แถวดิบจาก Patients sheet
 * @return {boolean}
 */
function canAccessPatient_(user, patientRecord) {
  if (!user || !patientRecord) return false;
  if (user.role === 'ADMIN' || user.role === 'VIEWER') return true;
  if (user.role === 'CG') return isNonEmptyString_(patientRecord.PrimaryCgUserId) && String(patientRecord.PrimaryCgUserId) === String(user.userId);
  if (user.role === 'CM') return isNonEmptyString_(patientRecord.ResponsibleCmUserId) && String(patientRecord.ResponsibleCmUserId) === String(user.userId);
  return false;
}

/**
 * ตรวจว่า userId ที่จะมอบหมายเป็นทีมดูแลมีอยู่จริง, บทบาทตรงกับที่ต้องการ, และยัง Active อยู่
 * @param {string} userId
 * @param {string} expectedRole 'CG' หรือ 'CM'
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function validateCareTeamMember_(userId, expectedRole) {
  var user = findRecordByKey_(SHEET_NAMES.USERS, 'UserId', userId);
  if (!user) {
    return err_(ERROR_CODES.VALIDATION, 'ไม่พบผู้ใช้ที่ต้องการมอบหมายในระบบ');
  }
  if (user.Role !== expectedRole) {
    return err_(ERROR_CODES.VALIDATION, 'ผู้ใช้ที่เลือกไม่ได้มีบทบาทเป็น ' + expectedRole);
  }
  if (!coerceBoolean_(user.Active)) {
    return err_(ERROR_CODES.VALIDATION, 'ผู้ใช้ที่เลือกถูกปิดใช้งานอยู่');
  }
  return ok_(user);
}

/**
 * คำนวณอายุจากวันเกิด (ISO date string)
 * @param {string} birthDateStr
 * @return {number|null}
 */
function computeAge_(birthDateStr) {
  if (!isValidIsoDate_(birthDateStr)) return null;
  var birth = new Date(birthDateStr);
  var now = new Date();
  var age = now.getFullYear() - birth.getFullYear();
  var monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * แปลง record ผู้ป่วยดิบ → รูปแบบปลอดภัยสำหรับส่งให้ client
 * @param {Object} patientRecord
 * @param {Object} callerUser
 * @param {{forceMask: boolean}=} options forceMask=true บังคับ mask CID เสมอ (ใช้ใน list), false ให้ mask เฉพาะ VIEWER
 * @return {Object}
 */
function sanitizePatientForClient_(patientRecord, callerUser, options) {
  options = options || {};
  var forceMask = options.forceMask !== false;
  var cid = String(patientRecord.CID || '');
  var showFullCid = cid && !forceMask && callerUser && callerUser.role !== 'VIEWER';

  var result = {
    patientId: patientRecord.PatientId,
    hn: patientRecord.HN,
    cidMasked: cid ? maskCid_(cid) : '',
    name: patientRecord.Name,
    gender: patientRecord.Gender,
    birthDate: patientRecord.BirthDate,
    age: computeAge_(patientRecord.BirthDate),
    village: patientRecord.Village,
    tambon: patientRecord.Tambon,
    amphoe: patientRecord.Amphoe,
    changwat: patientRecord.Changwat,
    adlGroup: patientRecord.AdlGroup || '',
    adlScore: patientRecord.AdlScore || 0,
    riskLevel: patientRecord.RiskLevel || '',
    primaryCgUserId: patientRecord.PrimaryCgUserId || '',
    responsibleCmUserId: patientRecord.ResponsibleCmUserId || '',
    status: patientRecord.Status,
    nextVisitDate: patientRecord.NextVisitDate || '',
    isDeleted: coerceBoolean_(patientRecord.IsDeleted),
    createdAt: patientRecord.CreatedAt,
    updatedAt: patientRecord.UpdatedAt
  };
  if (showFullCid) {
    result.cid = cid;
  }
  return result;
}

/* ============================================================
 * createPatient — action: patients.create (ADMIN, CM)
 * ============================================================ */

/**
 * @param {Object} payload ดูฟิลด์ที่บังคับใน PATIENT_REQUIRED_FIELDS_
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function createPatient(payload, callerUser) {
  payload = payload || {};

  var requiredCheck = validateRequiredFields_(payload, PATIENT_REQUIRED_FIELDS_);
  if (!requiredCheck.valid) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณากรอกข้อมูลผู้ป่วยให้ครบถ้วน', { fields: requiredCheck.fields });
  }

  if (!isValidEnum_(payload.gender, ENUM_GENDER_)) {
    return err_(ERROR_CODES.VALIDATION, 'เพศไม่ถูกต้อง', { fields: { gender: 'ต้องเป็น ' + ENUM_GENDER_.join(' หรือ ') } });
  }
  if (!isValidIsoDate_(payload.birthDate)) {
    return err_(ERROR_CODES.VALIDATION, 'วันเกิดไม่ถูกต้อง', { fields: { birthDate: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' } });
  }

  var cid = String(payload.cid).trim();
  if (!isValidThaiCid_(cid)) {
    return err_(ERROR_CODES.VALIDATION, 'เลขประจำตัวประชาชนไม่ถูกต้อง', {
      fields: { cid: 'ต้องเป็นเลข 13 หลักที่ถูกต้องตาม checksum' }
    });
  }
  var hn = String(payload.hn).trim();

  var cidExists = findRecord_(SHEET_NAMES.PATIENTS, function (p) { return String(p.CID) === cid; });
  if (cidExists) {
    return err_(ERROR_CODES.CONFLICT, 'มีผู้ป่วยที่ใช้เลขประจำตัวประชาชนนี้อยู่แล้ว');
  }
  var hnExists = findRecord_(SHEET_NAMES.PATIENTS, function (p) { return String(p.HN).toLowerCase() === hn.toLowerCase(); });
  if (hnExists) {
    return err_(ERROR_CODES.CONFLICT, 'มีผู้ป่วยที่ใช้ HN นี้อยู่แล้ว');
  }

  var cgUserId = '';
  if (isNonEmptyString_(payload.primaryCgUserId)) {
    var cgCheck = validateCareTeamMember_(payload.primaryCgUserId, 'CG');
    if (!cgCheck.ok) return cgCheck;
    cgUserId = payload.primaryCgUserId;
  }
  var cmUserId = '';
  if (isNonEmptyString_(payload.responsibleCmUserId)) {
    var cmCheck = validateCareTeamMember_(payload.responsibleCmUserId, 'CM');
    if (!cmCheck.ok) return cmCheck;
    cmUserId = payload.responsibleCmUserId;
  }

  var now = new Date().toISOString();
  var newPatientRow = {
    PatientId: generateShortId_('P'),
    HN: hn,
    CID: cid,
    Name: payload.name,
    Gender: payload.gender,
    BirthDate: payload.birthDate,
    Village: payload.village,
    Tambon: payload.tambon,
    Amphoe: payload.amphoe,
    Changwat: payload.changwat,
    AdlGroup: '',
    AdlScore: 0,
    RiskLevel: '',
    PrimaryCgUserId: cgUserId,
    ResponsibleCmUserId: cmUserId,
    Status: isValidEnum_(payload.status, ENUM_PATIENT_STATUS_) ? payload.status : 'ยังไม่นัด',
    NextVisitDate: isValidIsoDate_(payload.nextVisitDate) ? payload.nextVisitDate : '',
    DriveFolderId: '',
    IsDeleted: false,
    CreatedAt: now,
    UpdatedAt: now
  };

  var created = appendRecord_(SHEET_NAMES.PATIENTS, newPatientRow);
  logAudit_(callerUser.userId, 'patients.create', 'Patient', created.PatientId, { hn: hn });

  return ok_({ patient: sanitizePatientForClient_(created, callerUser, { forceMask: false }) });
}

/* ============================================================
 * updatePatient — action: patients.update (ADMIN, CM ที่รับผิดชอบผู้ป่วยรายนี้)
 * ============================================================ */

/**
 * @param {{patientId: string, patch: Object}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function updatePatient(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ป่วยที่ต้องการแก้ไข', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var existing = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!existing || coerceBoolean_(existing.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }

  // ADMIN แก้ได้ทุกคน, CM แก้ได้เฉพาะผู้ป่วยที่ตนรับผิดชอบ (Router.gs คุม role ชั้นนอกแล้วว่าเป็น ADMIN/CM เท่านั้นที่เรียกถึงนี่ได้)
  if (callerUser.role === 'CM' && String(existing.ResponsibleCmUserId) !== String(callerUser.userId)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์แก้ไขข้อมูลผู้ป่วยรายนี้');
  }

  var patchInput = payload.patch || {};
  var patch = {};

  if (patchInput.name !== undefined) patch.Name = patchInput.name;

  if (patchInput.hn !== undefined) {
    var hn = String(patchInput.hn).trim();
    var hnExists = findRecord_(SHEET_NAMES.PATIENTS, function (p) {
      return String(p.HN).toLowerCase() === hn.toLowerCase() && p.PatientId !== patientId;
    });
    if (hnExists) {
      return err_(ERROR_CODES.CONFLICT, 'มีผู้ป่วยที่ใช้ HN นี้อยู่แล้ว');
    }
    patch.HN = hn;
  }

  if (patchInput.gender !== undefined) {
    if (!isValidEnum_(patchInput.gender, ENUM_GENDER_)) {
      return err_(ERROR_CODES.VALIDATION, 'เพศไม่ถูกต้อง', { fields: { gender: 'ต้องเป็น ' + ENUM_GENDER_.join(' หรือ ') } });
    }
    patch.Gender = patchInput.gender;
  }

  if (patchInput.birthDate !== undefined) {
    if (!isValidIsoDate_(patchInput.birthDate)) {
      return err_(ERROR_CODES.VALIDATION, 'วันเกิดไม่ถูกต้อง', { fields: { birthDate: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' } });
    }
    patch.BirthDate = patchInput.birthDate;
  }

  if (patchInput.village !== undefined) patch.Village = patchInput.village;
  if (patchInput.tambon !== undefined) patch.Tambon = patchInput.tambon;
  if (patchInput.amphoe !== undefined) patch.Amphoe = patchInput.amphoe;
  if (patchInput.changwat !== undefined) patch.Changwat = patchInput.changwat;

  if (patchInput.status !== undefined) {
    if (!isValidEnum_(patchInput.status, ENUM_PATIENT_STATUS_)) {
      return err_(ERROR_CODES.VALIDATION, 'สถานะไม่ถูกต้อง', { fields: { status: 'ต้องเป็นหนึ่งใน ' + ENUM_PATIENT_STATUS_.join(', ') } });
    }
    patch.Status = patchInput.status;
  }

  if (patchInput.nextVisitDate !== undefined) {
    if (patchInput.nextVisitDate && !isValidIsoDate_(patchInput.nextVisitDate)) {
      return err_(ERROR_CODES.VALIDATION, 'วันที่นัดเยี่ยมถัดไปไม่ถูกต้อง', { fields: { nextVisitDate: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' } });
    }
    patch.NextVisitDate = patchInput.nextVisitDate || '';
  }

  if (Object.keys(patch).length === 0) {
    return err_(ERROR_CODES.VALIDATION, 'ไม่มีข้อมูลที่จะแก้ไข — อนุญาตเฉพาะ ' + PATIENT_PATCH_ALLOWED_KEYS_.join(', '));
  }

  patch.UpdatedAt = new Date().toISOString();
  var updated = updateRecord_(SHEET_NAMES.PATIENTS, existing._rowIndex, patch);
  logAudit_(callerUser.userId, 'patients.update', 'Patient', patientId, { patch: patchInput });

  return ok_({ patient: sanitizePatientForClient_(updated, callerUser, { forceMask: false }) });
}

/* ============================================================
 * getPatient — action: patients.get (ADMIN, CM, CG, VIEWER — ต้องผ่าน canAccessPatient_)
 * ============================================================ */

/**
 * @param {{patientId: string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function getPatient(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ patientId', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || (coerceBoolean_(patient.IsDeleted) && callerUser.role !== 'ADMIN')) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }

  if (!canAccessPatient_(callerUser, patient)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ดูข้อมูลผู้ป่วยรายนี้');
  }

  var forceMask = callerUser.role === 'VIEWER';
  return ok_({ patient: sanitizePatientForClient_(patient, callerUser, { forceMask: forceMask }) });
}

/* ============================================================
 * listPatients — action: patients.list (ADMIN, CM, CG, VIEWER — filter ตาม ownership อัตโนมัติ)
 * รองรับ search, filter (status/adlGroup/riskLevel), sort, pagination — CID ถูก mask เสมอในผลลัพธ์ list
 * ============================================================ */

/** field ที่ยอมให้ sort ได้ → map เป็นชื่อคอลัมน์จริงใน sheet */
var PATIENT_SORT_FIELD_MAP_ = {
  name: 'Name', hn: 'HN', status: 'Status', riskLevel: 'RiskLevel',
  adlGroup: 'AdlGroup', nextVisitDate: 'NextVisitDate', createdAt: 'CreatedAt'
};

/**
 * @param {{search:string=, status:string=, adlGroup:string=, riskLevel:string=, sortBy:string=, sortDir:string=,
 *          page:number=, pageSize:number=, includeArchived:boolean=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}}
 */
function listPatients(payload, callerUser) {
  payload = payload || {};
  var page = payload.page > 0 ? payload.page : 1;
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, PATIENT_LIST_MAX_PAGE_SIZE_) : 20;

  var search = isNonEmptyString_(payload.search) ? payload.search.trim() : '';
  var searchLower = search.toLowerCase();
  var isExactCidSearch = /^[0-9]{13}$/.test(search); // ค้นด้วย CID เต็มได้เฉพาะพิมพ์ครบ 13 หลักตรงเป๊ะ กันการไล่สแกนบางส่วน

  var includeArchived = !!payload.includeArchived && callerUser.role === 'ADMIN';

  var records = readAllRecords_(SHEET_NAMES.PATIENTS).records;

  var visible = records.filter(function (p) {
    if (!includeArchived && coerceBoolean_(p.IsDeleted)) return false;
    return canAccessPatient_(callerUser, p);
  });

  if (search) {
    visible = visible.filter(function (p) {
      if (isExactCidSearch) return String(p.CID) === search;
      var haystack = (String(p.Name || '') + ' ' + String(p.HN || '') + ' ' + String(p.Village || '') + ' ' + String(p.Tambon || '')).toLowerCase();
      return haystack.indexOf(searchLower) !== -1;
    });
  }

  if (isNonEmptyString_(payload.status)) {
    visible = visible.filter(function (p) { return p.Status === payload.status; });
  }
  if (isNonEmptyString_(payload.adlGroup)) {
    visible = visible.filter(function (p) { return p.AdlGroup === payload.adlGroup; });
  }
  if (isNonEmptyString_(payload.riskLevel)) {
    visible = visible.filter(function (p) { return p.RiskLevel === payload.riskLevel; });
  }

  var sortField = PATIENT_SORT_FIELD_MAP_[payload.sortBy] || 'Name';
  var sortDir = payload.sortDir === 'desc' ? -1 : 1;
  visible.sort(function (a, b) {
    var av = String(a[sortField] || '');
    var bv = String(b[sortField] || '');
    return av.localeCompare(bv, 'th') * sortDir;
  });

  var total = visible.length;
  var start = (page - 1) * pageSize;
  var items = visible.slice(start, start + pageSize).map(function (p) {
    return sanitizePatientForClient_(p, callerUser, { forceMask: true });
  });

  return ok_({ total: total, page: page, pageSize: pageSize, items: items });
}

/* ============================================================
 * archivePatient — action: patients.archive (ADMIN เท่านั้น — soft delete)
 * ============================================================ */

/**
 * @param {{patientId: string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function archivePatient(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ patientId', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var existing = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!existing) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (coerceBoolean_(existing.IsDeleted)) {
    return err_(ERROR_CODES.CONFLICT, 'ผู้ป่วยรายนี้ถูกเก็บเข้าคลังไปแล้ว');
  }

  updateRecord_(SHEET_NAMES.PATIENTS, existing._rowIndex, {
    IsDeleted: true,
    UpdatedAt: new Date().toISOString()
  });

  logAudit_(callerUser.userId, 'patients.archive', 'Patient', patientId, {});

  return ok_({ patientId: patientId, archived: true });
}

/* ============================================================
 * assignCareTeam — action: patients.assignCareTeam (ADMIN ทุกกรณี, CM ปรับได้เฉพาะ CG ของผู้ป่วยที่ตนรับผิดชอบ)
 * ============================================================ */

/**
 * @param {{patientId: string, primaryCgUserId: (string|null)=, responsibleCmUserId: (string|null)=}} payload
 *        ส่ง key ที่ต้องการแก้เท่านั้น — ส่งค่าว่าง/null เพื่อ "เคลียร์" ผู้รับผิดชอบตำแหน่งนั้น
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function assignCareTeam(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ patientId', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var existing = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!existing || coerceBoolean_(existing.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }

  if (callerUser.role === 'CM' && String(existing.ResponsibleCmUserId) !== String(callerUser.userId)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์มอบหมายทีมดูแลของผู้ป่วยรายนี้');
  }

  var hasCg = payload.primaryCgUserId !== undefined;
  var hasCm = payload.responsibleCmUserId !== undefined;
  if (!hasCg && !hasCm) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ primaryCgUserId หรือ responsibleCmUserId อย่างน้อยหนึ่งอย่าง');
  }

  // CM โอนเคสไปให้ CM คนอื่นเองไม่ได้ (ต้องผ่าน ADMIN) — ป้องกันการเปลี่ยนความรับผิดชอบเคสโดยพลการ
  if (hasCm && callerUser.role === 'CM') {
    return err_(ERROR_CODES.FORBIDDEN, 'การโอนผู้ป่วยไปยัง Case Manager คนอื่นต้องดำเนินการโดยผู้ดูแลระบบ (ADMIN) เท่านั้น');
  }

  var patch = {};

  if (hasCg) {
    if (isNonEmptyString_(payload.primaryCgUserId)) {
      var cgCheck = validateCareTeamMember_(payload.primaryCgUserId, 'CG');
      if (!cgCheck.ok) return cgCheck;
      patch.PrimaryCgUserId = payload.primaryCgUserId;
    } else {
      patch.PrimaryCgUserId = '';
    }
  }

  if (hasCm) {
    if (isNonEmptyString_(payload.responsibleCmUserId)) {
      var cmCheck = validateCareTeamMember_(payload.responsibleCmUserId, 'CM');
      if (!cmCheck.ok) return cmCheck;
      patch.ResponsibleCmUserId = payload.responsibleCmUserId;
    } else {
      patch.ResponsibleCmUserId = '';
    }
  }

  patch.UpdatedAt = new Date().toISOString();
  var updated = updateRecord_(SHEET_NAMES.PATIENTS, existing._rowIndex, patch);
  logAudit_(callerUser.userId, 'patients.assignCareTeam', 'Patient', patientId, { patch: patch });

  return ok_({ patient: sanitizePatientForClient_(updated, callerUser, { forceMask: false }) });
}
