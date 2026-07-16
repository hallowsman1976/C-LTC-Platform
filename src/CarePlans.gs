/**
 * CarePlans.gs
 * แผนการดูแลผู้ป่วย (Care Plan) — ผูกกับผู้ป่วยแต่ละราย ต่อยอดจาก Patients.gs
 *
 * สิทธิ์:
 *   - สร้าง/แก้ไข: ADMIN, CM, CG ที่เข้าถึงผู้ป่วยรายนั้นได้ (canAccessPatient_) — VIEWER ทำไม่ได้ (อ่านอย่างเดียว)
 *   - อนุมัติ/ปฏิเสธ: ADMIN, CM เท่านั้น (แยกหน้าที่ — CG ห้ามอนุมัติแผนของตัวเอง)
 *   - แก้ไขได้เฉพาะสถานะ draft/pendingApproval — เมื่อ approved/rejected แล้วต้องสร้างแผนใหม่แทนการแก้ไขทับ
 *
 * การมองเห็น (list/get) ใช้กติกาเดียวกับ Patients.gs ทุกประการ: อิงจากผู้ป่วยเจ้าของแผน ไม่ใช่ผู้สร้างแผน
 */

var CARE_PLAN_EDITABLE_STATUSES_ = ['draft', 'pendingApproval'];
var CARE_PLAN_LIST_MAX_PAGE_SIZE_ = 100;

/**
 * แปลง string ที่ควรเป็น JSON array ให้ปลอดภัย (คืน [] ถ้า parse ไม่ได้ หรือไม่ใช่ array)
 * @param {string} raw
 * @return {Array}
 */
function safeParseJsonArray_(raw) {
  if (!isNonEmptyString_(raw)) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * แปลง record แผนการดูแลดิบ → รูปแบบสำหรับส่งให้ client (คลาย JSON string กลับเป็น array)
 * @param {Object} carePlanRecord
 * @return {Object}
 */
function sanitizeCarePlanForClient_(carePlanRecord) {
  return {
    carePlanId: carePlanRecord.CarePlanId,
    patientId: carePlanRecord.PatientId,
    createdByUserId: carePlanRecord.CreatedByUserId,
    problems: safeParseJsonArray_(carePlanRecord.Problems),
    goals: safeParseJsonArray_(carePlanRecord.Goals),
    interventions: safeParseJsonArray_(carePlanRecord.Interventions),
    reviewDate: carePlanRecord.ReviewDate || '',
    status: carePlanRecord.Status,
    approvedByUserId: carePlanRecord.ApprovedByUserId || '',
    approvedAt: carePlanRecord.ApprovedAt || '',
    rejectedReason: carePlanRecord.RejectedReason || '',
    createdAt: carePlanRecord.CreatedAt,
    updatedAt: carePlanRecord.UpdatedAt
  };
}

/**
 * ดึงผู้ป่วยเจ้าของแผน + ตรวจสิทธิ์เข้าถึงในขั้นตอนเดียว — ใช้ซ้ำในหลาย action ของไฟล์นี้
 * @param {string} patientId
 * @param {Object} callerUser
 * @param {boolean=} excludeViewer true = VIEWER ก็ถือว่าไม่มีสิทธิ์ (ใช้กับ action ที่แก้ไขข้อมูล)
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}} data คือ patient record ถ้าผ่าน
 */
function resolveCarePlanPatientAccess_(patientId, callerUser, excludeViewer) {
  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || coerceBoolean_(patient.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (!canAccessPatient_(callerUser, patient) || (excludeViewer && callerUser.role === 'VIEWER')) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ดำเนินการกับแผนการดูแลของผู้ป่วยรายนี้');
  }
  return ok_(patient);
}

/* ============================================================
 * createCarePlan — action: careplans.create (ADMIN, CM, CG ที่เข้าถึงผู้ป่วยรายนี้ได้)
 * ============================================================ */

/**
 * @param {{patientId: string, problems: Array<string>=, goals: Array<string>=, interventions: Array<string>=, reviewDate: string=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function createCarePlan(payload, callerUser) {
  payload = payload || {};

  var requiredCheck = validateRequiredFields_(payload, ['patientId']);
  if (!requiredCheck.valid) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ป่วย', { fields: requiredCheck.fields });
  }

  var accessCheck = resolveCarePlanPatientAccess_(payload.patientId, callerUser, true);
  if (!accessCheck.ok) return accessCheck;

  if (payload.reviewDate && !isValidIsoDate_(payload.reviewDate)) {
    return err_(ERROR_CODES.VALIDATION, 'วันที่นัดทบทวนแผนไม่ถูกต้อง', { fields: { reviewDate: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' } });
  }

  var now = new Date().toISOString();
  var record = {
    CarePlanId: generateShortId_('CP'),
    PatientId: payload.patientId,
    CreatedByUserId: callerUser.userId,
    Problems: JSON.stringify(Array.isArray(payload.problems) ? payload.problems : []),
    Goals: JSON.stringify(Array.isArray(payload.goals) ? payload.goals : []),
    Interventions: JSON.stringify(Array.isArray(payload.interventions) ? payload.interventions : []),
    ReviewDate: payload.reviewDate || '',
    Status: 'draft',
    ApprovedByUserId: '',
    ApprovedAt: '',
    RejectedReason: '',
    CreatedAt: now,
    UpdatedAt: now
  };

  var created = appendRecord_(SHEET_NAMES.CARE_PLANS, record);
  logAudit_(callerUser.userId, 'careplans.create', 'CarePlan', created.CarePlanId, { patientId: payload.patientId });

  return ok_({ carePlan: sanitizeCarePlanForClient_(created) });
}

/* ============================================================
 * updateCarePlan — action: careplans.update
 * ============================================================ */

/**
 * @param {{carePlanId: string, patch: {problems:Array=, goals:Array=, interventions:Array=, reviewDate:string=, status:string=}}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function updateCarePlan(payload, callerUser) {
  payload = payload || {};
  var carePlanId = payload.carePlanId;

  if (!isNonEmptyString_(carePlanId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ carePlanId', { fields: { carePlanId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var existing = findRecordByKey_(SHEET_NAMES.CARE_PLANS, 'CarePlanId', carePlanId);
  if (!existing) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบแผนการดูแลนี้ในระบบ');
  }

  var accessCheck = resolveCarePlanPatientAccess_(existing.PatientId, callerUser, true);
  if (!accessCheck.ok) return accessCheck;

  if (CARE_PLAN_EDITABLE_STATUSES_.indexOf(existing.Status) === -1) {
    return err_(ERROR_CODES.VALIDATION, 'แผนการดูแลนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว ไม่สามารถแก้ไขได้ กรุณาสร้างแผนใหม่แทน');
  }

  var patchInput = payload.patch || {};
  var patch = {};

  if (patchInput.problems !== undefined) {
    patch.Problems = JSON.stringify(Array.isArray(patchInput.problems) ? patchInput.problems : []);
  }
  if (patchInput.goals !== undefined) {
    patch.Goals = JSON.stringify(Array.isArray(patchInput.goals) ? patchInput.goals : []);
  }
  if (patchInput.interventions !== undefined) {
    patch.Interventions = JSON.stringify(Array.isArray(patchInput.interventions) ? patchInput.interventions : []);
  }
  if (patchInput.reviewDate !== undefined) {
    if (patchInput.reviewDate && !isValidIsoDate_(patchInput.reviewDate)) {
      return err_(ERROR_CODES.VALIDATION, 'วันที่นัดทบทวนแผนไม่ถูกต้อง', { fields: { reviewDate: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' } });
    }
    patch.ReviewDate = patchInput.reviewDate || '';
  }
  if (patchInput.status !== undefined) {
    // updateCarePlan สลับได้แค่ draft <-> pendingApproval — อนุมัติ/ปฏิเสธจริงต้องผ่าน careplans.approve เท่านั้น (แยกหน้าที่ + audit ชัดเจนกว่า)
    if (CARE_PLAN_EDITABLE_STATUSES_.indexOf(patchInput.status) === -1) {
      return err_(ERROR_CODES.VALIDATION, 'สถานะไม่ถูกต้อง — ใช้ action careplans.approve สำหรับอนุมัติ/ปฏิเสธแผน', {
        fields: { status: 'อนุญาตเฉพาะ ' + CARE_PLAN_EDITABLE_STATUSES_.join(', ') }
      });
    }
    patch.Status = patchInput.status;
  }

  if (Object.keys(patch).length === 0) {
    return err_(ERROR_CODES.VALIDATION, 'ไม่มีข้อมูลที่จะแก้ไข');
  }

  patch.UpdatedAt = new Date().toISOString();
  var updated = updateRecord_(SHEET_NAMES.CARE_PLANS, existing._rowIndex, patch);
  logAudit_(callerUser.userId, 'careplans.update', 'CarePlan', carePlanId, { patch: patchInput });

  return ok_({ carePlan: sanitizeCarePlanForClient_(updated) });
}

/* ============================================================
 * getCarePlan — action: careplans.get
 * ============================================================ */

/**
 * @param {{carePlanId: string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function getCarePlan(payload, callerUser) {
  payload = payload || {};
  var carePlanId = payload.carePlanId;

  if (!isNonEmptyString_(carePlanId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ carePlanId', { fields: { carePlanId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var carePlan = findRecordByKey_(SHEET_NAMES.CARE_PLANS, 'CarePlanId', carePlanId);
  if (!carePlan) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบแผนการดูแลนี้ในระบบ');
  }

  var accessCheck = resolveCarePlanPatientAccess_(carePlan.PatientId, callerUser, false);
  if (!accessCheck.ok) return accessCheck;

  return ok_({ carePlan: sanitizeCarePlanForClient_(carePlan) });
}

/* ============================================================
 * listCarePlans — action: careplans.list
 * รองรับ filter ตาม patientId/status, sort ตามวันที่สร้าง, และ pagination
 * ============================================================ */

/**
 * @param {{patientId: string=, status: string=, sortDir: string=, page: number=, pageSize: number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}}
 */
function listCarePlans(payload, callerUser) {
  payload = payload || {};
  var page = payload.page > 0 ? payload.page : 1;
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, CARE_PLAN_LIST_MAX_PAGE_SIZE_) : 20;

  // อ่านทั้งสองชีตครั้งเดียว (batch read) แล้วทำ map ในหน่วยความจำ — กัน N+1 sheet read เวลามีแผนหลายรายการ
  var carePlanRecords = readAllRecords_(SHEET_NAMES.CARE_PLANS).records;
  var patientRecords = readAllRecords_(SHEET_NAMES.PATIENTS).records;
  var patientsById = {};
  patientRecords.forEach(function (p) { patientsById[p.PatientId] = p; });

  var visible = carePlanRecords.filter(function (cp) {
    var patient = patientsById[cp.PatientId];
    return patient && canAccessPatient_(callerUser, patient);
  });

  if (isNonEmptyString_(payload.patientId)) {
    visible = visible.filter(function (cp) { return cp.PatientId === payload.patientId; });
  }
  if (isNonEmptyString_(payload.status)) {
    visible = visible.filter(function (cp) { return cp.Status === payload.status; });
  }

  var sortDir = payload.sortDir === 'asc' ? 1 : -1; // ค่าเริ่มต้น: ใหม่สุดก่อน
  visible.sort(function (a, b) {
    if (a.CreatedAt === b.CreatedAt) return 0;
    return (a.CreatedAt < b.CreatedAt ? -1 : 1) * sortDir;
  });

  var total = visible.length;
  var start = (page - 1) * pageSize;
  var items = visible.slice(start, start + pageSize).map(sanitizeCarePlanForClient_);

  return ok_({ total: total, page: page, pageSize: pageSize, items: items });
}

/* ============================================================
 * approveCarePlan — action: careplans.approve (ADMIN, CM เท่านั้น — แยกหน้าที่จาก CG ผู้สร้าง)
 * ============================================================ */

/**
 * @param {{carePlanId: string, decision: ('approve'|'reject')=, reason: string=}} payload decision default = 'approve'
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function approveCarePlan(payload, callerUser) {
  payload = payload || {};
  var carePlanId = payload.carePlanId;

  if (!isNonEmptyString_(carePlanId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ carePlanId', { fields: { carePlanId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var decision = payload.decision === 'reject' ? 'reject' : 'approve';

  var existing = findRecordByKey_(SHEET_NAMES.CARE_PLANS, 'CarePlanId', carePlanId);
  if (!existing) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบแผนการดูแลนี้ในระบบ');
  }

  var accessCheck = resolveCarePlanPatientAccess_(existing.PatientId, callerUser, true);
  if (!accessCheck.ok) return accessCheck;

  if (existing.Status === 'approved' || existing.Status === 'rejected') {
    return err_(ERROR_CODES.CONFLICT, 'แผนการดูแลนี้ถูก' + (existing.Status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ') + 'ไปแล้ว');
  }

  if (decision === 'reject' && !isNonEmptyString_(payload.reason)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุเหตุผลที่ปฏิเสธแผนการดูแล', { fields: { reason: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var now = new Date().toISOString();
  var patch = (decision === 'approve')
    ? { Status: 'approved', ApprovedByUserId: callerUser.userId, ApprovedAt: now, RejectedReason: '' }
    : { Status: 'rejected', ApprovedByUserId: callerUser.userId, ApprovedAt: now, RejectedReason: payload.reason };
  patch.UpdatedAt = now;

  var updated = updateRecord_(SHEET_NAMES.CARE_PLANS, existing._rowIndex, patch);
  logAudit_(callerUser.userId, 'careplans.approve', 'CarePlan', carePlanId, { decision: decision });

  return ok_({ carePlan: sanitizeCarePlanForClient_(updated) });
}
