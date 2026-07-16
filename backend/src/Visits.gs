/**
 * Visits.gs
 * บันทึกการเยี่ยมบ้าน (Visit) — vital signs, แผลกดทับ, อาการ, ยา/โภชนาการ/ขับถ่าย/นอน, บริการที่ให้, ลายเซ็น
 * ตาม BLUEPRINT.md §6, §7, §10.4
 *
 * หลักการสำคัญของไฟล์นี้:
 * - Visit Number คำนวณจากจำนวนการเยี่ยมที่ "submitted" แล้วของผู้ป่วยรายนั้น + 1 (นับตอน submit เท่านั้น ไม่นับตอน draft
 *   เพราะ draft ที่ถูกทิ้งไม่ควรไปแย่งเลขคิวการเยี่ยมจริง)
 * - บันทึก Draft ผ่าน saveVisitDraft (upsert ด้วย ClientTempId) และ Submit ผ่าน submitVisit
 * - ป้องกันข้อมูลซ้ำ: ทั้งสอง action บังคับต้องมี clientTempId เป็น idempotency key —
 *   submitVisit ที่เรียกซ้ำด้วย clientTempId เดิมที่ submitted ไปแล้ว จะคืนค่าของเดิมทันที ไม่สร้างซ้ำ
 *   (สำคัญมากสำหรับ offline sync ที่อาจ retry request เดิมซ้ำเมื่อกลับมามีสัญญาณ ตาม BLUEPRINT.md §14)
 * - CM/ADMIN ตรวจทาน (review) ผ่าน reviewVisit แยกจากสถานะ draft/submitted (คนละมิติกัน)
 * - Risk Alert: แผลกดทับ stage 3-4 ที่พบตอน submit จะ trigger แจ้งเตือนทันที (ดู RiskAlert.gs)
 */

var VISIT_LIST_MAX_PAGE_SIZE_ = 100;

/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * คำนวณลำดับครั้งที่เยี่ยมถัดไปของผู้ป่วยคนหนึ่ง (นับเฉพาะ visit ที่ submitted แล้วเท่านั้น)
 * @param {string} patientId
 * @return {number}
 */
function computeVisitNumber_(patientId) {
  var count = findRecords_(SHEET_NAMES.VISITS, function (v) {
    return v.PatientId === patientId && v.Status === 'submitted';
  }).length;
  return count + 1;
}

/**
 * แปลง payload (camelCase จาก client) → patch สำหรับ Visits sheet (PascalCase) — ใช้ทั้ง saveVisitDraft/submitVisit
 * รับเฉพาะฟิลด์ที่ client ส่งมาจริง (undefined = ไม่แตะ) เพื่อรองรับการบันทึก draft แบบบางส่วนได้
 * @param {Object} payload
 * @return {Object}
 */
function buildVisitPatchFromPayload_(payload) {
  var patch = {};
  if (payload.caregiverName !== undefined) patch.CaregiverName = payload.caregiverName;
  if (payload.relation !== undefined) patch.Relation = payload.relation;
  if (payload.bp !== undefined) patch.BP = payload.bp;
  if (payload.hr !== undefined) patch.HR = payload.hr;
  if (payload.temp !== undefined) patch.Temp = payload.temp;
  if (payload.spo2 !== undefined) patch.SpO2 = payload.spo2;
  if (payload.hasWound !== undefined) patch.HasWound = !!payload.hasWound;
  if (payload.woundLocation !== undefined) patch.WoundLocation = payload.woundLocation;
  if (payload.woundStage !== undefined) patch.WoundStage = String(payload.woundStage || '');
  if (payload.woundSize !== undefined) patch.WoundSize = payload.woundSize;
  if (payload.woundCare !== undefined) patch.WoundCare = payload.woundCare;
  if (payload.woundPhotoFileIds !== undefined) patch.WoundPhotoFileIds = JSON.stringify(payload.woundPhotoFileIds || {});
  if (payload.symptoms !== undefined) patch.Symptoms = JSON.stringify(Array.isArray(payload.symptoms) ? payload.symptoms : []);
  if (payload.medication !== undefined) patch.Medication = payload.medication;
  if (payload.nutrition !== undefined) patch.Nutrition = payload.nutrition;
  if (payload.excretion !== undefined) patch.Excretion = payload.excretion;
  if (payload.sleep !== undefined) patch.Sleep = payload.sleep;
  if (payload.fallRiskNote !== undefined) patch.FallRiskNote = payload.fallRiskNote;
  if (payload.caregiverBurdenNote !== undefined) patch.CaregiverBurdenNote = payload.caregiverBurdenNote;
  if (payload.servicesGiven !== undefined) patch.ServicesGiven = JSON.stringify(Array.isArray(payload.servicesGiven) ? payload.servicesGiven : []);
  if (payload.notes !== undefined) patch.Notes = payload.notes;
  if (payload.nextVisitDate !== undefined) patch.NextVisitDate = payload.nextVisitDate || '';
  if (payload.signatureFileId !== undefined) patch.SignatureFileId = payload.signatureFileId;
  if (payload.gps && payload.gps.lat !== undefined) patch.GpsLat = payload.gps.lat;
  if (payload.gps && payload.gps.lng !== undefined) patch.GpsLng = payload.gps.lng;
  return patch;
}

/**
 * แปลง record การเยี่ยมดิบ → รูปแบบสำหรับส่งให้ client
 * (ใช้ safeParseJsonObject_/safeParseJsonArray_ ที่นิยามไว้ใน Assessments.gs/CarePlans.gs ร่วมกัน ไม่ประกาศซ้ำที่นี่)
 * @param {Object} v
 * @return {Object}
 */
function sanitizeVisitForClient_(v) {
  return {
    visitId: v.VisitId,
    patientId: v.PatientId,
    visitedByUserId: v.VisitedByUserId,
    visitNumber: v.VisitNumber,
    visitDate: v.VisitDate,
    gps: { lat: v.GpsLat === '' ? null : v.GpsLat, lng: v.GpsLng === '' ? null : v.GpsLng },
    caregiverName: v.CaregiverName || '',
    relation: v.Relation || '',
    bp: v.BP || '', hr: v.HR || '', temp: v.Temp || '', spo2: v.SpO2 || '',
    hasWound: coerceBoolean_(v.HasWound),
    wound: {
      location: v.WoundLocation || '',
      stage: v.WoundStage ? String(v.WoundStage) : '',
      size: v.WoundSize || '',
      care: v.WoundCare || ''
    },
    woundPhotoFileIds: safeParseJsonObject_(v.WoundPhotoFileIds),
    symptoms: safeParseJsonArray_(v.Symptoms),
    medication: v.Medication || '', nutrition: v.Nutrition || '', excretion: v.Excretion || '', sleep: v.Sleep || '',
    fallRiskNote: v.FallRiskNote || '', caregiverBurdenNote: v.CaregiverBurdenNote || '',
    servicesGiven: safeParseJsonArray_(v.ServicesGiven),
    notes: v.Notes || '',
    nextVisitDate: v.NextVisitDate || '',
    signatureFileId: v.SignatureFileId || '',
    status: v.Status,
    reviewStatus: v.ReviewStatus || 'pending',
    reviewedByUserId: v.ReviewedByUserId || '',
    reviewedAt: v.ReviewedAt || '',
    reviewNote: v.ReviewNote || '',
    syncedFromOffline: coerceBoolean_(v.SyncedFromOffline),
    clientTempId: v.ClientTempId || '',
    createdAt: v.CreatedAt,
    updatedAt: v.UpdatedAt
  };
}

/* ============================================================
 * saveVisitDraft — action: visits.saveDraft (ADMIN, CM, CG ที่เข้าถึงผู้ป่วยรายนี้ได้)
 * ============================================================ */

/**
 * @param {Object} payload ต้องมี patientId, clientTempId + ฟิลด์ draft อื่น ๆ (ดู buildVisitPatchFromPayload_)
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function saveVisitDraft(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;
  var clientTempId = payload.clientTempId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ป่วย', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }
  if (!isNonEmptyString_(clientTempId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ clientTempId สำหรับอ้างอิง draft นี้ (กันบันทึกซ้ำ)', {
      fields: { clientTempId: 'จำเป็นต้องกรอกข้อมูลนี้' }
    });
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || coerceBoolean_(patient.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (!canAccessPatient_(callerUser, patient) || callerUser.role === 'VIEWER') {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์บันทึกการเยี่ยมของผู้ป่วยรายนี้');
  }

  var existing = findRecordByKey_(SHEET_NAMES.VISITS, 'ClientTempId', clientTempId);
  if (existing && existing.Status === 'submitted') {
    // draft ซ้ำกับ visit ที่ submit ไปแล้ว (เช่น กด save draft ค้างแล้วเพิ่ง sync) — คืนของเดิม ไม่แก้ทับ
    return ok_({ visit: sanitizeVisitForClient_(existing) });
  }

  var now = new Date().toISOString();
  var patch = buildVisitPatchFromPayload_(payload);
  patch.PatientId = patientId;
  patch.VisitedByUserId = callerUser.userId;
  patch.Status = 'draft';
  patch.ClientTempId = clientTempId;
  patch.UpdatedAt = now;

  if (!existing) {
    patch.VisitId = generateShortId_('V');
    patch.VisitNumber = 0; // ยังไม่ใช่ visit จริงจนกว่าจะ submit
    patch.CreatedAt = now;
    patch.SyncedFromOffline = !!payload.syncedFromOffline;
    patch.ReviewStatus = 'pending';
    patch.ReviewedByUserId = '';
    patch.ReviewedAt = '';
    patch.ReviewNote = '';
  }

  var saved = upsertByKey_(SHEET_NAMES.VISITS, 'ClientTempId', clientTempId, patch);
  return ok_({ visit: sanitizeVisitForClient_(saved) });
}

/* ============================================================
 * submitVisit — action: visits.submit (ADMIN, CM, CG ที่เข้าถึงผู้ป่วยรายนี้ได้)
 * ============================================================ */

/**
 * @param {Object} payload ต้องมี patientId, clientTempId + ฟิลด์การเยี่ยมครบ (ดู buildVisitPatchFromPayload_)
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function submitVisit(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;
  var clientTempId = payload.clientTempId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ป่วย', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }
  if (!isNonEmptyString_(clientTempId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ clientTempId เพื่อป้องกันการบันทึกซ้ำ', {
      fields: { clientTempId: 'จำเป็นต้องกรอกข้อมูลนี้' }
    });
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || coerceBoolean_(patient.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (!canAccessPatient_(callerUser, patient) || callerUser.role === 'VIEWER') {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์บันทึกการเยี่ยมของผู้ป่วยรายนี้');
  }

  // idempotency: เคย submit ด้วย clientTempId นี้ไปแล้ว → คืนของเดิมทันที ไม่สร้างซ้ำ ไม่คำนวณ VisitNumber ใหม่
  var existing = findRecordByKey_(SHEET_NAMES.VISITS, 'ClientTempId', clientTempId);
  if (existing && existing.Status === 'submitted') {
    return ok_({
      visit: sanitizeVisitForClient_(existing),
      visitNumber: existing.VisitNumber,
      riskAlertTriggered: false,
      alreadySubmitted: true
    });
  }

  var hasWound = !!payload.hasWound;
  var woundStage = hasWound ? String(payload.woundStage || '') : '';
  if (hasWound && !isValidEnum_(woundStage, ENUM_WOUND_STAGE_)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุระยะ (Stage) ของแผลกดทับให้ถูกต้อง', {
      fields: { woundStage: 'ต้องเป็นหนึ่งใน ' + ENUM_WOUND_STAGE_.join(', ') }
    });
  }

  var visitNumber = computeVisitNumber_(patientId);
  var now = new Date().toISOString();

  var patch = buildVisitPatchFromPayload_(payload);
  patch.PatientId = patientId;
  patch.VisitedByUserId = callerUser.userId;
  patch.VisitNumber = visitNumber;
  patch.VisitDate = now;
  patch.HasWound = hasWound;
  patch.WoundStage = woundStage;
  patch.Status = 'submitted';
  patch.SyncedFromOffline = !!payload.syncedFromOffline;
  patch.ClientTempId = clientTempId;
  patch.UpdatedAt = now;

  if (!existing) {
    patch.VisitId = generateShortId_('V');
    patch.CreatedAt = now;
    patch.ReviewStatus = 'pending';
    patch.ReviewedByUserId = '';
    patch.ReviewedAt = '';
    patch.ReviewNote = '';
  }

  var saved = upsertByKey_(SHEET_NAMES.VISITS, 'ClientTempId', clientTempId, patch);

  // อัปเดตสถานะผู้ป่วย: นัดวันนี้/เลยนัด/ยังไม่นัด → เยี่ยมแล้ว
  updateRecord_(SHEET_NAMES.PATIENTS, patient._rowIndex, { Status: 'เยี่ยมแล้ว', UpdatedAt: now });

  logAudit_(callerUser.userId, 'visits.submit', 'Visit', saved.VisitId, { patientId: patientId, visitNumber: visitNumber });

  var riskResult = { triggered: false };
  if (hasWound && (woundStage === '3' || woundStage === '4')) {
    riskResult = triggerRiskAlertIfNeeded_(patient, 'visit_pressure_ulcer_severe',
      'พบแผลกดทับระยะที่ ' + woundStage + ' ในผู้ป่วย ' + patient.Name + ' (HN ' + patient.HN + ') จากการเยี่ยมบ้านครั้งที่ ' + visitNumber);
  }

  return ok_({
    visit: sanitizeVisitForClient_(saved),
    visitNumber: visitNumber,
    riskAlertTriggered: riskResult.triggered
  });
}

/* ============================================================
 * getVisit — action: visits.get (ADMIN, CM, CG, VIEWER — ต้องผ่าน canAccessPatient_)
 * ============================================================ */

/**
 * @param {{visitId: string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function getVisit(payload, callerUser) {
  payload = payload || {};
  var visitId = payload.visitId;

  if (!isNonEmptyString_(visitId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ visitId', { fields: { visitId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var visit = findRecordByKey_(SHEET_NAMES.VISITS, 'VisitId', visitId);
  if (!visit) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบการเยี่ยมนี้ในระบบ');
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', visit.PatientId);
  if (!patient || !canAccessPatient_(callerUser, patient)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ดูการเยี่ยมนี้');
  }

  return ok_({ visit: sanitizeVisitForClient_(visit) });
}

/* ============================================================
 * listVisitsByPatient — action: visits.listByPatient (Visit History)
 * ============================================================ */

/**
 * @param {{patientId: string, includeDrafts: boolean=, page: number=, pageSize: number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function listVisitsByPatient(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ patientId', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || !canAccessPatient_(callerUser, patient)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ดูประวัติการเยี่ยมของผู้ป่วยรายนี้');
  }

  var page = payload.page > 0 ? payload.page : 1;
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, VISIT_LIST_MAX_PAGE_SIZE_) : 20;
  var includeDrafts = !!payload.includeDrafts;

  var records = findRecords_(SHEET_NAMES.VISITS, function (v) {
    if (v.PatientId !== patientId) return false;
    if (!includeDrafts && v.Status !== 'submitted') return false;
    return true;
  });

  records.sort(function (a, b) {
    if (a.VisitDate === b.VisitDate) return 0;
    return a.VisitDate < b.VisitDate ? 1 : -1; // ใหม่สุดก่อน
  });

  var total = records.length;
  var start = (page - 1) * pageSize;
  var items = records.slice(start, start + pageSize).map(sanitizeVisitForClient_);

  return ok_({ total: total, page: page, pageSize: pageSize, items: items });
}

/* ============================================================
 * reviewVisit — action: visits.review (ADMIN, CM ที่รับผิดชอบผู้ป่วยรายนี้เท่านั้น)
 * ============================================================ */

/**
 * @param {{visitId: string, reviewNote: string=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function reviewVisit(payload, callerUser) {
  payload = payload || {};
  var visitId = payload.visitId;

  if (!isNonEmptyString_(visitId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ visitId', { fields: { visitId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var visit = findRecordByKey_(SHEET_NAMES.VISITS, 'VisitId', visitId);
  if (!visit) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบการเยี่ยมนี้ในระบบ');
  }
  if (visit.Status !== 'submitted') {
    return err_(ERROR_CODES.VALIDATION, 'ตรวจทานได้เฉพาะการเยี่ยมที่ส่งแล้วเท่านั้น');
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', visit.PatientId);
  if (!patient || (callerUser.role === 'CM' && String(patient.ResponsibleCmUserId) !== String(callerUser.userId))) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ตรวจทานการเยี่ยมนี้');
  }
  if (visit.ReviewStatus === 'reviewed') {
    return err_(ERROR_CODES.CONFLICT, 'การเยี่ยมนี้ถูกตรวจทานไปแล้ว');
  }

  var now = new Date().toISOString();
  var updated = updateRecord_(SHEET_NAMES.VISITS, visit._rowIndex, {
    ReviewStatus: 'reviewed',
    ReviewedByUserId: callerUser.userId,
    ReviewedAt: now,
    ReviewNote: payload.reviewNote || '',
    UpdatedAt: now
  });

  logAudit_(callerUser.userId, 'visits.review', 'Visit', visitId, {});

  return ok_({ visit: sanitizeVisitForClient_(updated) });
}
