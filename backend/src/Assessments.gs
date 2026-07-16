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

/**
 * นิยาม Barthel ADL Index — max ต่อข้อยึดตามแบบฟอร์มมาตรฐาน (แบบบันทึกติดตามดูแลผู้ป่วยต่อเนื่องที่บ้าน รพ.สต.)
 * prototype เดิมสลับ max ของ 4 ข้อไว้ผิด (grooming/toilet/mobility/stairs) แม้ผลรวมเต็มยังได้ 20 เท่ากัน
 * แต่การให้คะแนนรายข้อไม่ตรงกับกระดาษ เช่น "ใช้ห้องน้ำเองได้" ระบบเดิมให้ 3 แต่ฟอร์มจริงเต็มแค่ 2
 * ต้องตรงกับ BARTHEL_ITEMS ใน frontend/constants.js เป๊ะ (key + max)
 */
var BARTHEL_DEFS_ = [
  { key: 'feeding', max: 2 },
  { key: 'bathing', max: 1 },
  { key: 'grooming', max: 1 },
  { key: 'dressing', max: 2 },
  { key: 'bowel', max: 2 },
  { key: 'bladder', max: 2 },
  { key: 'toilet', max: 2 },
  { key: 'transfer', max: 3 },
  { key: 'mobility', max: 3 },
  { key: 'stairs', max: 2 }
];

var FALL_RISK_ITEM_COUNT_ = 5;
var CAREGIVER_BURDEN_ITEM_COUNT_ = 5;
// INHOMESSS มี 9 มิติตามตัวย่อจริง (S สามตัว = Safety/Spiritual/Service) ตามแบบฟอร์ม รพ.สต.
// ของเดิมยุบเหลือ 8 แล้วแทนสามตัวท้ายด้วย 'socialSupport' ตัวเดียวซึ่งไม่มีในฟอร์ม
var INHOMESSS_DOMAINS_ = ['immobility', 'nutrition', 'homeEnvironment', 'otherPeople', 'medications', 'examination', 'safety', 'spiritualHealth', 'service'];

/**
 * นิยามฟิลด์รายมิติของ INHOMESSS ฉบับเต็ม ถอดจากแบบฟอร์มกระดาษตรง ๆ (แบบบันทึกติดตามดูแลผู้ป่วยต่อเนื่องที่บ้าน
 * รพ.สต.) — ต้องตรงกับ DOMAIN_FIELDS ใน frontend/screens/inhomesss-form.js เป๊ะทุก key/kind/options
 *
 * kind: 'boolean' | 'text' | 'enum' (เลือกได้ตัวเดียวจาก options) | 'enumArray' (เลือกได้หลายตัวจาก options)
 * ตัวเลือกของ enum/enumArray เป็นข้อความไทยตรง ๆ (ไม่ใช่ enum key ภาษาอังกฤษ) ตามแบบแผนเดียวกับฟิลด์ multi-select
 * อื่นในระบบ (Symptoms/ServicesGiven ของ Visits.gs) ซึ่งไม่ enum-validate เข้มงวดเช่นกัน — INHOMESSS เป็นเอกสาร
 * บันทึกอิสระ ไม่ใช่เครื่องมือให้คะแนนที่ต้องตอบครบแบบ Barthel/9Q จึงไม่มีฟิลด์ไหนบังคับ
 */
var INHOMESSS_DOMAIN_FIELDS_ = {
  immobility: [
    { key: 'adlStatus', kind: 'enum', options: ['ทำได้เอง', 'ทำเองไม่ได้', 'ผู้ป่วยติดเตียง', 'ผู้ป่วยติดบ้าน'] },
    { key: 'balanceOrGaitProblem', kind: 'boolean' },
    { key: 'sensoryProblem', kind: 'boolean' }
  ],
  nutrition: [
    { key: 'status', kind: 'enum', options: ['ปกติ', 'อ้วน', 'ผอม'] },
    { key: 'favoriteFood', kind: 'text' },
    { key: 'mealsPerDay', kind: 'text' },
    { key: 'foodCaregiver', kind: 'text' },
    { key: 'tastePreferences', kind: 'enumArray', options: ['หวาน', 'มัน', 'เค็ม', 'เผ็ด', 'เปรี้ยว', 'จืด'] },
    { key: 'foodSource', kind: 'enumArray', options: ['ปรุงเอง', 'ซื้อสำเร็จรูป', 'อาหารแช่แข็ง', 'อื่น ๆ'] },
    { key: 'foodSourceOtherDetail', kind: 'text' },
    { key: 'alcohol', kind: 'boolean' },
    { key: 'alcoholAmount', kind: 'text' },
    { key: 'tobacco', kind: 'boolean' },
    { key: 'tobaccoAmount', kind: 'text' }
  ],
  homeEnvironment: [
    { key: 'inHouse', kind: 'enumArray', options: ['แออัด', 'โปร่งสบาย', 'สะอาด'] },
    { key: 'surrounding', kind: 'enumArray', options: ['มีบริเวณ', 'ไม่มีบริเวณ', 'อื่น ๆ'] },
    { key: 'surroundingOtherDetail', kind: 'text' }
  ],
  otherPeople: [
    { key: 'emergencyContact', kind: 'enum', options: ['บุตร', 'ญาติ', 'อื่น ๆ'] },
    { key: 'emergencyContactOtherDetail', kind: 'text' },
    { key: 'endOfLifeDecisionMakerName', kind: 'text' },
    { key: 'endOfLifeDecisionMakerPhone', kind: 'text' },
    { key: 'caregiverHealthRisk', kind: 'boolean' }
  ],
  medications: [
    { key: 'administeredBy', kind: 'enum', options: ['ด้วยตนเอง', 'ผู้อื่น'] },
    { key: 'supplement', kind: 'text' },
    { key: 'regularity', kind: 'enum', options: ['สม่ำเสมอ', 'ไม่สม่ำเสมอ'] },
    { key: 'herbalMedicine', kind: 'text' },
    { key: 'currentMedications', kind: 'text' }
  ],
  examination: [
    { key: 'temperature', kind: 'text' },
    { key: 'bp', kind: 'text' },
    { key: 'pr', kind: 'text' },
    { key: 'rr', kind: 'text' },
    { key: 'labResult', kind: 'text' },
    { key: 'physicalExam', kind: 'text' }
  ],
  safety: [
    { key: 'fallRisk', kind: 'enum', options: ['ปลอดภัยต่อการพลัดตกหกล้ม', 'เสี่ยงต่อการพลัดตกหกล้ม'] }
  ],
  spiritualHealth: [
    { key: 'beliefs', kind: 'text' }
  ],
  service: [
    { key: 'sources', kind: 'enumArray', options: ['โรงพยาบาล', 'รพ.สต./ศสม', 'คลินิก', 'อื่น ๆ'] },
    { key: 'hospitalDetail', kind: 'text' },
    { key: 'healthCenterDetail', kind: 'text' },
    { key: 'clinicDetail', kind: 'text' },
    { key: 'otherDetail', kind: 'text' }
  ]
};

/**
 * ธงความเสี่ยงที่ระบบไล่ตรวจจากคำตอบ INHOMESSS เอง — ไม่ใช่คะแนน/verdict ตามมาตรฐานทางคลินิก เพราะฟอร์ม
 * กระดาษต้นฉบับไม่มีระบบให้คะแนน INHOMESSS เลย (ต่างจาก Barthel/9Q/FallRisk) เป็นเพียงตัวช่วยดูภาพรวมเร็ว ๆ
 * ต้องตรงกับ INHOMESSS_RISK_FLAGS ใน frontend/constants.js เป๊ะ
 */
var INHOMESSS_RISK_FLAGS_ = [
  { domain: 'immobility', key: 'balanceOrGaitProblem' },
  { domain: 'immobility', key: 'sensoryProblem' },
  { domain: 'nutrition', key: 'alcohol' },
  { domain: 'nutrition', key: 'tobacco' },
  { domain: 'otherPeople', key: 'caregiverHealthRisk' },
  { domain: 'safety', key: 'fallRisk', matchValue: 'เสี่ยงต่อการพลัดตกหกล้ม' }
];

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
 * INHOMESSS — ประเมินสิ่งแวดล้อมและบริบทที่บ้าน 9 มิติ (Immobility, Nutrition, Home environment,
 * Other people, Medications, Examination, Safety, Spiritual health, Service) — action: assessments.saveInhomesss
 * ============================================================ */

/**
 * sanitize ค่า 1 field ตาม kind ที่กำหนดใน INHOMESSS_DOMAIN_FIELDS_ — ค่าที่ไม่ผ่าน (นอก enum, ชนิดผิด)
 * ถูกทิ้งกลับเป็นค่าว่างเงียบ ๆ ไม่ error เพราะ INHOMESSS เป็นเอกสารบันทึกอิสระ ไม่ใช่เครื่องมือให้คะแนน
 * ที่ต้องตอบครบแบบ Barthel/9Q — clamp ผิดปกติแค่ไม่ให้ขยะเข้าไปในชีต ไม่ใช่ปฏิเสธทั้ง request
 * @param {Object} field รายการจาก INHOMESSS_DOMAIN_FIELDS_[domain]
 * @param {*} rawValue
 * @return {*}
 */
function sanitizeInhomesssFieldValue_(field, rawValue) {
  if (field.kind === 'boolean') return rawValue === true;
  if (field.kind === 'text') return isNonEmptyString_(rawValue) ? String(rawValue) : '';
  if (field.kind === 'enum') return isValidEnum_(rawValue, field.options) ? rawValue : '';
  if (field.kind === 'enumArray') {
    if (!Array.isArray(rawValue)) return [];
    return rawValue.filter(function (v) { return isValidEnum_(v, field.options); });
  }
  return '';
}

/**
 * คำนวณ "ธงความเสี่ยง" จากคำตอบที่ sanitize แล้ว — ไม่ใช่คะแนนมาตรฐานทางคลินิก (ฟอร์มกระดาษต้นฉบับไม่มี
 * ระบบให้คะแนน INHOMESSS) เก็บ verdict เป็นข้อความอธิบายจำนวนธงที่พบ ไม่ใช่ระดับความรุนแรงแบบ Barthel/9Q
 * @param {Object} cleanAnswers ผลลัพธ์ที่ sanitize แล้วจาก computeInhomesssScore_
 * @return {number}
 */
function countInhomesssRiskFlags_(cleanAnswers) {
  var count = 0;
  INHOMESSS_RISK_FLAGS_.forEach(function (flag) {
    var value = cleanAnswers[flag.domain][flag.key];
    var matched = flag.matchValue ? (value === flag.matchValue) : (value === true);
    if (matched) count++;
  });
  return count;
}

/**
 * @param {Object} answers { immobility: {adlStatus, balanceOrGaitProblem, ...}=, nutrition: {...}=, ... }
 *        (9 domain ตาม INHOMESSS_DOMAINS_ แต่ละมิติมีฟิลด์ต่างกันตาม INHOMESSS_DOMAIN_FIELDS_)
 * @return {{answers: Object, total: number, verdict: string}} total/verdict คือธงความเสี่ยงที่ไล่ตรวจเอง
 *        ไม่ใช่คะแนนมาตรฐาน (ดู countInhomesssRiskFlags_)
 */
function computeInhomesssScore_(answers) {
  answers = answers || {};
  var clean = {};
  INHOMESSS_DOMAINS_.forEach(function (domain) {
    var entry = answers[domain] || {};
    var cleanEntry = {};
    INHOMESSS_DOMAIN_FIELDS_[domain].forEach(function (field) {
      cleanEntry[field.key] = sanitizeInhomesssFieldValue_(field, entry[field.key]);
    });
    clean[domain] = cleanEntry;
  });

  var riskFlagCount = countInhomesssRiskFlags_(clean);
  var verdict = riskFlagCount === 0
    ? 'ไม่พบข้อบ่งชี้ความเสี่ยงเพิ่มเติม'
    : 'พบข้อบ่งชี้ความเสี่ยง ' + riskFlagCount + ' รายการ';

  return { answers: clean, total: riskFlagCount, verdict: verdict };
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
