/**
 * Assessments.gs
 * แบบประเมิน Barthel ADL, ความเสี่ยงหกล้ม, ความเสี่ยงแผลกดทับ, Caregiver Burden, INHOMESSS
 * (แบบประเมิน 2Q/9Q/8Q อยู่แยกที่ DepressionAssessment.gs เพราะเป็น conditional chain ที่ซับซ้อนกว่ามาก)
 *
 * กติกาสำคัญที่ทุกฟังก์ชันในไฟล์นี้ต้องทำตาม:
 * - Backend คำนวณคะแนน/แปลผลจากคำตอบดิบ (answers) เองเสมอ — "ไม่เชื่อ" totalScore/verdict/group ที่ frontend
 *   ส่งมาเลยแม้จะแนบมาด้วยก็ตาม (เผื่อ frontend ใช้แสดงผลแบบ optimistic ก่อนได้คำตอบจาก server) ค่าที่เก็บจริง
 *   ในชีตมาจากการคำนวณของ backend (computeXxxScore_) เท่านั้น
 * - ทุก action บังคับต้องมี requestId (idempotency key) — เรียกซ้ำด้วย requestId เดิมจะได้ผลลัพธ์เดิม ไม่สร้างซ้ำ
 * - ทุก action ตรวจสิทธิ์ผ่าน resolveAssessmentContext_ (ต้องเข้าถึงผู้ป่วยได้ + ไม่ใช่ VIEWER) ก่อนเสมอ
 */

/** นิยาม Barthel ADL Index — พอร์ต key/max ตรงจาก prototype เดิม (App.html BARTHEL_DEFS) */
var BARTHEL_DEFS_ = [
  { key: 'feeding', max: 2 },
  { key: 'bathing', max: 1 },
  { key: 'grooming', max: 2 },
  { key: 'dressing', max: 2 },
  { key: 'bowel', max: 2 },
  { key: 'bladder', max: 2 },
  { key: 'toilet', max: 3 },
  { key: 'transfer', max: 3 },
  { key: 'mobility', max: 2 },
  { key: 'stairs', max: 1 }
];

var FALL_RISK_ITEM_COUNT_ = 5;
var CAREGIVER_BURDEN_ITEM_COUNT_ = 5;
var INHOMESSS_DOMAINS_ = ['immobility', 'nutrition', 'homeEnvironment', 'otherPeople', 'medications', 'examination', 'safety', 'socialSupport'];

var ASSESSMENT_LIST_MAX_PAGE_SIZE_ = 100;

/**
 * map ชื่อประเภทแบบประเมิน (ใช้ใน payload.type) → sheet ปลายทาง
 *
 * ต้องเป็นฟังก์ชัน (lazy) ไม่ใช่ top-level var ตรง ๆ — เพราะไฟล์ .gs ทุกไฟล์ถูก concat ตามลำดับตัวอักษรของชื่อไฟล์
 * ("Assessments.gs" มาก่อน "Config.gs") ทำให้ตอน top-level code ของไฟล์นี้รัน SHEET_NAMES (นิยามใน Config.gs)
 * ยังไม่ถูกกำหนดค่า อ้างอิงตรง ๆ ตอนนี้จะได้ undefined — ต้องเลื่อนไปอ่านตอนถูกเรียกใช้งานจริงแทน (ตอนนั้นทุกไฟล์โหลดครบแล้วแน่นอน)
 * @return {Object<string, string>}
 */
function getAssessmentTypeSheetMap_() {
  return {
    barthel: SHEET_NAMES.ASSESSMENTS_BARTHEL,
    depression: SHEET_NAMES.ASSESSMENTS_DEPRESSION,
    fallrisk: SHEET_NAMES.ASSESSMENTS_FALLRISK,
    caregiverburden: SHEET_NAMES.ASSESSMENTS_CAREGIVERBURDEN,
    pressureulcer: SHEET_NAMES.ASSESSMENTS_PRESSUREULCER,
    inhomesss: SHEET_NAMES.ASSESSMENTS_INHOMESSS
  };
}

/* ============================================================
 * Shared helpers — ใช้ร่วมกับ DepressionAssessment.gs ด้วย
 * ============================================================ */

/**
 * แปลง string ที่ควรเป็น JSON object ให้ปลอดภัย (คืน {} ถ้า parse ไม่ได้)
 * @param {string} raw
 * @return {Object}
 */
function safeParseJsonObject_(rawInput) {
  if (!isNonEmptyString_(rawInput)) return {};
  try {
    var parsed = JSON.parse(rawInput);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/**
 * ตรวจสิทธิ์และความถูกต้องพื้นฐานร่วมของทุกแบบประเมิน: ต้องมี patientId + requestId, ผู้ป่วยต้องมีอยู่จริงและยังไม่ถูกลบ,
 * และผู้เรียกต้องเข้าถึงผู้ป่วยรายนี้ได้ (canAccessPatient_) และไม่ใช่ VIEWER (อ่านอย่างเดียว บันทึกแบบประเมินไม่ได้)
 * @param {Object} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}} data.patient ถ้าผ่าน
 */
function resolveAssessmentContext_(payload, callerUser) {
  if (!isNonEmptyString_(payload.patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ป่วย', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }
  if (!isNonEmptyString_(payload.requestId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ requestId เพื่อป้องกันการบันทึกซ้ำ', { fields: { requestId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }
  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', payload.patientId);
  if (!patient || coerceBoolean_(patient.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (!canAccessPatient_(callerUser, patient) || callerUser.role === 'VIEWER') {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์บันทึกแบบประเมินของผู้ป่วยรายนี้');
  }
  return ok_({ patient: patient });
}

/**
 * หา record เดิมที่เคยบันทึกด้วย requestId นี้แล้ว (ใช้ทำ idempotency — เรียกซ้ำได้ผลลัพธ์เดิม ไม่สร้างซ้ำ)
 * @param {string} sheetName
 * @param {string} requestId
 * @return {Object|null}
 */
function findExistingByRequestId_(sheetName, requestId) {
  if (!isNonEmptyString_(requestId)) return null;
  return findRecord_(sheetName, function (r) { return r.RequestId === requestId; });
}

function sanitizeBarthelAssessmentForClient_(record) {
  return {
    assessmentId: record.AssessmentId, patientId: record.PatientId, visitId: record.VisitId || '',
    assessedByUserId: record.AssessedByUserId, answers: safeParseJsonObject_(record.Answers),
    totalScore: record.TotalScore, group: record.Group, createdAt: record.CreatedAt
  };
}

function sanitizeScaleAssessmentForClient_(record) {
  return {
    assessmentId: record.AssessmentId, patientId: record.PatientId, visitId: record.VisitId || '',
    assessedByUserId: record.AssessedByUserId, answers: safeParseJsonObject_(record.Answers),
    totalScore: record.TotalScore, verdict: record.Verdict, createdAt: record.CreatedAt
  };
}

function sanitizePressureUlcerForClient_(record) {
  return {
    assessmentId: record.AssessmentId, patientId: record.PatientId, visitId: record.VisitId || '',
    assessedByUserId: record.AssessedByUserId, hasWound: coerceBoolean_(record.HasWound),
    location: record.Location || '', size: record.Size || '', stage: record.Stage ? String(record.Stage) : '',
    createdAt: record.CreatedAt
  };
}

/**
 * dispatch sanitizer ตามประเภท — ใช้โดย getAssessment/listAssessmentsByPatient
 * @param {string} type
 * @param {Object} record
 * @return {Object}
 */
function sanitizeAssessmentByType_(type, record) {
  if (type === 'barthel') return sanitizeBarthelAssessmentForClient_(record);
  if (type === 'depression') return sanitizeDepressionAssessmentForClient_(record);
  if (type === 'pressureulcer') return sanitizePressureUlcerForClient_(record);
  return sanitizeScaleAssessmentForClient_(record);
}

/* ============================================================
 * Barthel ADL Index — action: assessments.saveBarthel
 * ============================================================ */

/**
 * คำนวณคะแนน Barthel จากคำตอบดิบ — clamp ค่าที่ผิดปกติ/นอกช่วงเป็น 0 เสมอ (ไม่เชื่อค่าที่ frontend ส่งมาตรง ๆ)
 * @param {Object} answers { feeding:0-2, bathing:0-1, ... }
 * @return {{answers: Object, total: number, group: string}}
 */
function computeBarthelScore_(answers) {
  answers = answers || {};
  var clean = {};
  var total = 0;
  BARTHEL_DEFS_.forEach(function (def) {
    var raw = answers[def.key];
    var value = (typeof raw === 'number' && raw >= 0 && raw <= def.max && Math.floor(raw) === raw) ? raw : 0;
    clean[def.key] = value;
    total += value;
  });
  var group = total >= 12 ? 'ติดสังคม' : (total >= 5 ? 'ติดบ้าน' : 'ติดเตียง');
  return { answers: clean, total: total, group: group };
}

/**
 * @param {{patientId:string, requestId:string, visitId:string=, answers:Object}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function saveBarthelAssessment(payload, callerUser) {
  payload = payload || {};
  var context = resolveAssessmentContext_(payload, callerUser);
  if (!context.ok) return context;

  var existing = findExistingByRequestId_(SHEET_NAMES.ASSESSMENTS_BARTHEL, payload.requestId);
  if (existing) return ok_({ assessment: sanitizeBarthelAssessmentForClient_(existing) });

  var scored = computeBarthelScore_(payload.answers);
  var now = new Date().toISOString();
  var record = {
    AssessmentId: generateShortId_('A-ADL'),
    PatientId: context.data.patient.PatientId,
    VisitId: payload.visitId || '',
    AssessedByUserId: callerUser.userId,
    RequestId: payload.requestId,
    Answers: JSON.stringify(scored.answers),
    TotalScore: scored.total,
    Group: scored.group,
    CreatedAt: now
  };
  var created = appendRecord_(SHEET_NAMES.ASSESSMENTS_BARTHEL, record);

  // อัปเดต cache ADL บนตัวผู้ป่วยให้ตรงกับผลประเมินล่าสุดเสมอ (Patients.AdlGroup/AdlScore)
  updateRecord_(SHEET_NAMES.PATIENTS, context.data.patient._rowIndex, {
    AdlGroup: scored.group, AdlScore: scored.total, UpdatedAt: now
  });

  logAudit_(callerUser.userId, 'assessments.saveBarthel', 'Assessment', created.AssessmentId, {
    patientId: context.data.patient.PatientId, total: scored.total
  });

  return ok_({ assessment: sanitizeBarthelAssessmentForClient_(created) });
}

/* ============================================================
 * แบบประเมินแบบนับข้อ (Fall Risk / Caregiver Burden) — ใช้สูตรร่วมกัน
 * ============================================================ */

/**
 * นับจำนวนข้อที่ตอบ "ใช่"/true — clamp ค่าที่ไม่ใช่ boolean ให้เป็น false เสมอ
 * @param {Object} answers { q1: boolean, q2: boolean, ... }
 * @param {number} itemCount
 * @return {{answers: Object, total: number, verdict: string}}
 */
function computeSimpleScaleScore_(answers, itemCount) {
  answers = answers || {};
  var clean = {};
  var total = 0;
  for (var i = 1; i <= itemCount; i++) {
    var key = 'q' + i;
    var value = answers[key] === true;
    clean[key] = value;
    if (value) total++;
  }
  var verdict = total === 0 ? 'ความเสี่ยงต่ำ' : (total <= 2 ? 'ความเสี่ยงปานกลาง' : 'ความเสี่ยงสูง');
  return { answers: clean, total: total, verdict: verdict };
}

/**
 * ความเสี่ยงหกล้ม — action: assessments.saveFallRisk
 * @param {{patientId:string, requestId:string, visitId:string=, answers:Object}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function saveFallRiskAssessment(payload, callerUser) {
  payload = payload || {};
  var context = resolveAssessmentContext_(payload, callerUser);
  if (!context.ok) return context;

  var existing = findExistingByRequestId_(SHEET_NAMES.ASSESSMENTS_FALLRISK, payload.requestId);
  if (existing) return ok_({ assessment: sanitizeScaleAssessmentForClient_(existing) });

  var scored = computeSimpleScaleScore_(payload.answers, FALL_RISK_ITEM_COUNT_);
  var now = new Date().toISOString();
  var record = {
    AssessmentId: generateShortId_('A-FR'),
    PatientId: context.data.patient.PatientId,
    VisitId: payload.visitId || '',
    AssessedByUserId: callerUser.userId,
    RequestId: payload.requestId,
    Answers: JSON.stringify(scored.answers),
    TotalScore: scored.total,
    Verdict: scored.verdict,
    CreatedAt: now
  };
  var created = appendRecord_(SHEET_NAMES.ASSESSMENTS_FALLRISK, record);

  logAudit_(callerUser.userId, 'assessments.saveFallRisk', 'Assessment', created.AssessmentId, {
    patientId: context.data.patient.PatientId, total: scored.total
  });

  var riskResult = { triggered: false };
  if (scored.verdict === 'ความเสี่ยงสูง') {
    riskResult = triggerRiskAlertIfNeeded_(context.data.patient, 'fall_risk_high',
      'ผู้ป่วย ' + context.data.patient.Name + ' (HN ' + context.data.patient.HN + ') มีความเสี่ยงหกล้มระดับสูง จากแบบประเมินล่าสุด');
  }

  return ok_({ assessment: sanitizeScaleAssessmentForClient_(created), riskAlertTriggered: riskResult.triggered });
}

/**
 * ภาระผู้ดูแล (Caregiver Burden) — action: assessments.saveCaregiverBurden
 * @param {{patientId:string, requestId:string, visitId:string=, answers:Object}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function saveCaregiverBurdenAssessment(payload, callerUser) {
  payload = payload || {};
  var context = resolveAssessmentContext_(payload, callerUser);
  if (!context.ok) return context;

  var existing = findExistingByRequestId_(SHEET_NAMES.ASSESSMENTS_CAREGIVERBURDEN, payload.requestId);
  if (existing) return ok_({ assessment: sanitizeScaleAssessmentForClient_(existing) });

  var scored = computeSimpleScaleScore_(payload.answers, CAREGIVER_BURDEN_ITEM_COUNT_);
  var now = new Date().toISOString();
  var record = {
    AssessmentId: generateShortId_('A-CB'),
    PatientId: context.data.patient.PatientId,
    VisitId: payload.visitId || '',
    AssessedByUserId: callerUser.userId,
    RequestId: payload.requestId,
    Answers: JSON.stringify(scored.answers),
    TotalScore: scored.total,
    Verdict: scored.verdict,
    CreatedAt: now
  };
  var created = appendRecord_(SHEET_NAMES.ASSESSMENTS_CAREGIVERBURDEN, record);

  logAudit_(callerUser.userId, 'assessments.saveCaregiverBurden', 'Assessment', created.AssessmentId, {
    patientId: context.data.patient.PatientId, total: scored.total
  });

  var riskResult = { triggered: false };
  if (scored.verdict === 'ความเสี่ยงสูง') {
    riskResult = triggerRiskAlertIfNeeded_(context.data.patient, 'caregiver_burden_high',
      'ผู้ดูแลของผู้ป่วย ' + context.data.patient.Name + ' (HN ' + context.data.patient.HN + ') มีภาระการดูแลอยู่ในระดับสูง จากแบบประเมินล่าสุด — ควรพิจารณาให้ความช่วยเหลือ/ส่งต่อ');
  }

  return ok_({ assessment: sanitizeScaleAssessmentForClient_(created), riskAlertTriggered: riskResult.triggered });
}

/* ============================================================
 * ความเสี่ยงแผลกดทับ (แบบประเมินเดี่ยว แยกจากแผลที่บันทึกในฟอร์มเยี่ยม) — action: assessments.savePressureUlcer
 * ============================================================ */

/**
 * @param {{patientId:string, requestId:string, visitId:string=, hasWound:boolean, location:string=, size:string=, stage:string=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function savePressureUlcerAssessment(payload, callerUser) {
  payload = payload || {};
  var context = resolveAssessmentContext_(payload, callerUser);
  if (!context.ok) return context;

  var existing = findExistingByRequestId_(SHEET_NAMES.ASSESSMENTS_PRESSUREULCER, payload.requestId);
  if (existing) return ok_({ assessment: sanitizePressureUlcerForClient_(existing) });

  var hasWound = !!payload.hasWound;
  var stage = hasWound ? String(payload.stage || '') : '';
  if (hasWound && !isValidEnum_(stage, ENUM_WOUND_STAGE_)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุระยะ (Stage) ของแผลกดทับให้ถูกต้อง', {
      fields: { stage: 'ต้องเป็นหนึ่งใน ' + ENUM_WOUND_STAGE_.join(', ') }
    });
  }

  var now = new Date().toISOString();
  var record = {
    AssessmentId: generateShortId_('A-PU'),
    PatientId: context.data.patient.PatientId,
    VisitId: payload.visitId || '',
    AssessedByUserId: callerUser.userId,
    RequestId: payload.requestId,
    HasWound: hasWound,
    Location: hasWound ? (payload.location || '') : '',
    Size: hasWound ? (payload.size || '') : '',
    Stage: stage,
    CreatedAt: now
  };
  var created = appendRecord_(SHEET_NAMES.ASSESSMENTS_PRESSUREULCER, record);

  logAudit_(callerUser.userId, 'assessments.savePressureUlcer', 'Assessment', created.AssessmentId, {
    patientId: context.data.patient.PatientId, hasWound: hasWound, stage: stage
  });

  var riskResult = { triggered: false };
  if (hasWound && (stage === '3' || stage === '4')) {
    riskResult = triggerRiskAlertIfNeeded_(context.data.patient, 'pressure_ulcer_severe',
      'พบแผลกดทับระยะที่ ' + stage + ' ในผู้ป่วย ' + context.data.patient.Name + ' (HN ' + context.data.patient.HN + ') จากแบบประเมินความเสี่ยงแผลกดทับ');
  }

  return ok_({ assessment: sanitizePressureUlcerForClient_(created), riskAlertTriggered: riskResult.triggered });
}

/* ============================================================
 * INHOMESSS — ประเมินสิ่งแวดล้อมและบริบทที่บ้าน 8 มิติ (Immobility, Nutrition, Home environment,
 * Other people, Medications, Examination, Safety, Social support) — action: assessments.saveInhomesss
 * ============================================================ */

/**
 * @param {Object} answers { immobility: {hasIssue, note}=, nutrition: {...}=, ... } (8 domain ตาม INHOMESSS_DOMAINS_)
 * @return {{answers: Object, total: number, verdict: string}}
 */
function computeInhomesssScore_(answers) {
  answers = answers || {};
  var clean = {};
  var total = 0;
  INHOMESSS_DOMAINS_.forEach(function (domain) {
    var entry = answers[domain] || {};
    var hasIssue = entry.hasIssue === true;
    clean[domain] = { hasIssue: hasIssue, note: isNonEmptyString_(entry.note) ? entry.note : '' };
    if (hasIssue) total++;
  });
  var verdict = total <= 1 ? 'ปกติ' : (total <= 3 ? 'ควรติดตาม' : 'ต้องดูแลเร่งด่วน');
  return { answers: clean, total: total, verdict: verdict };
}

/**
 * @param {{patientId:string, requestId:string, visitId:string=, answers:Object}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function saveInhomesssAssessment(payload, callerUser) {
  payload = payload || {};
  var context = resolveAssessmentContext_(payload, callerUser);
  if (!context.ok) return context;

  var existing = findExistingByRequestId_(SHEET_NAMES.ASSESSMENTS_INHOMESSS, payload.requestId);
  if (existing) return ok_({ assessment: sanitizeScaleAssessmentForClient_(existing) });

  var scored = computeInhomesssScore_(payload.answers);
  var now = new Date().toISOString();
  var record = {
    AssessmentId: generateShortId_('A-IH'),
    PatientId: context.data.patient.PatientId,
    VisitId: payload.visitId || '',
    AssessedByUserId: callerUser.userId,
    RequestId: payload.requestId,
    Answers: JSON.stringify(scored.answers),
    TotalScore: scored.total,
    Verdict: scored.verdict,
    CreatedAt: now
  };
  var created = appendRecord_(SHEET_NAMES.ASSESSMENTS_INHOMESSS, record);

  logAudit_(callerUser.userId, 'assessments.saveInhomesss', 'Assessment', created.AssessmentId, {
    patientId: context.data.patient.PatientId, total: scored.total
  });

  return ok_({ assessment: sanitizeScaleAssessmentForClient_(created) });
}

/* ============================================================
 * getAssessment / listAssessmentsByPatient — ใช้ร่วมกันทุกประเภท (generic ตาม payload.type)
 * ============================================================ */

/**
 * action: assessments.get
 * @param {{type: string, assessmentId: string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function getAssessment(payload, callerUser) {
  payload = payload || {};
  var type = payload.type;
  var typeSheetMap = getAssessmentTypeSheetMap_();
  var sheetName = typeSheetMap[type];

  if (!sheetName) {
    return err_(ERROR_CODES.VALIDATION, 'ประเภทแบบประเมินไม่ถูกต้อง', {
      fields: { type: 'ต้องเป็นหนึ่งใน ' + Object.keys(typeSheetMap).join(', ') }
    });
  }
  if (!isNonEmptyString_(payload.assessmentId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ assessmentId', { fields: { assessmentId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var record = findRecordByKey_(sheetName, 'AssessmentId', payload.assessmentId);
  if (!record) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบแบบประเมินนี้ในระบบ');
  }
  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', record.PatientId);
  if (!patient || !canAccessPatient_(callerUser, patient)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ดูแบบประเมินนี้');
  }

  return ok_({ assessment: sanitizeAssessmentByType_(type, record) });
}

/**
 * action: assessments.listByPatient — ไม่ระบุ type = คืนทุกประเภทรวมกัน เรียงใหม่สุดก่อน
 * @param {{patientId: string, type: string=, page: number=, pageSize: number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function listAssessmentsByPatient(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;
  var type = payload.type;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุ patientId', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }
  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || !canAccessPatient_(callerUser, patient)) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ดูแบบประเมินของผู้ป่วยรายนี้');
  }
  var typeSheetMap = getAssessmentTypeSheetMap_();
  if (type && !typeSheetMap[type]) {
    return err_(ERROR_CODES.VALIDATION, 'ประเภทแบบประเมินไม่ถูกต้อง', {
      fields: { type: 'ต้องเป็นหนึ่งใน ' + Object.keys(typeSheetMap).join(', ') }
    });
  }

  var typesToQuery = type ? [type] : Object.keys(typeSheetMap);
  var allItems = [];
  typesToQuery.forEach(function (t) {
    var sheetName = typeSheetMap[t];
    var records = findRecords_(sheetName, function (r) { return r.PatientId === patientId; });
    records.forEach(function (r) {
      var sanitized = sanitizeAssessmentByType_(t, r);
      sanitized.type = t;
      allItems.push(sanitized);
    });
  });

  allItems.sort(function (a, b) {
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1; // ใหม่สุดก่อน
  });

  var page = payload.page > 0 ? payload.page : 1;
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, ASSESSMENT_LIST_MAX_PAGE_SIZE_) : 20;
  var total = allItems.length;
  var start = (page - 1) * pageSize;
  var items = allItems.slice(start, start + pageSize);

  return ok_({ total: total, page: page, pageSize: pageSize, items: items });
}
