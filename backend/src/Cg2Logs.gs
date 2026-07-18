/**
 * Cg2Logs.gs
 * บันทึกการเยี่ยมบ้านผู้ป่วยและผู้สูงอายุแบบสั้น (CG.2) — ตามแบบฟอร์มกระดาษ "รายงานการเยี่ยมบ้านผู้ป่วยและ
 * ผู้สูงอายุ (CG 2)" ต่างจาก Visits.gs (การเยี่ยมแบบเต็ม 10 ขั้นตอนพร้อม Barthel/INHOMESSS/แผลกดทับ) ตรงที่
 * ไฟล์นี้เป็นบันทึกสั้น ๆ ที่ผู้ดูแล (CG) จดทุกครั้งที่แวะเยี่ยม — ไม่มี draft, ไม่มี offline queue, ไม่มี
 * ตรวจทาน (review) และเป็น append-only เหมือนแบบประเมินอื่น ๆ ในระบบ (ถ้าบันทึกผิดต้องบันทึกใหม่ ไม่มี action แก้)
 *
 * คะแนนสมองเสื่อม/ซึมเศร้า/ADL/TAI (DementiaScore/DepressionScore/AdlScore/TaiScore) เป็นตัวเลขที่ผู้ใช้พิมพ์เอง
 * ตามที่เขียนไว้ในกระดาษต้นฉบับ — ไม่ได้ดึงมาจากแบบประเมิน Barthel/2Q-9Q-8Q ที่มีอยู่แล้วในระบบอัตโนมัติ
 * (การเชื่อมสองระบบเข้าด้วยกันเป็นฟีเจอร์แยกต่างหากที่ใหญ่กว่านี้) และ TAI/สมองเสื่อมไม่มีเครื่องมือให้คะแนน
 * ในระบบเลย จึงรับเป็นข้อความอิสระเช่นกัน
 */

/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * แปลง record ดิบ → รูปแบบสำหรับส่งให้ client
 * @param {Object} r
 * @return {Object}
 */
function sanitizeCg2LogForClient_(r) {
  return {
    logId: r.LogId,
    patientId: r.PatientId,
    loggedByUserId: r.LoggedByUserId,
    logDate: r.LogDate,
    symptomTrend: r.SymptomTrend || '',
    conditionNote: r.ConditionNote || '',
    temp: r.Temp || '',
    pulse: r.Pulse || '',
    respRate: r.RespRate || '',
    bp: r.BP || '',
    waistCircumference: r.WaistCircumference || '',
    dementiaScore: r.DementiaScore || '',
    depressionScore: r.DepressionScore || '',
    adlScore: r.AdlScore || '',
    taiScore: r.TaiScore || '',
    caregiverPresent: coerceBoolean_(r.CaregiverPresent),
    recommendations: safeParseJsonArray_(r.Recommendations),
    recommendationOtherNote: r.RecommendationOtherNote || '',
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt
  };
}

/* ============================================================
 * createCg2Log — action: cg2logs.create (ADMIN, CM, CG ที่เข้าถึงผู้ป่วยรายนี้ได้)
 * ============================================================ */

/**
 * @param {Object} payload ต้องมี patientId, logDate + ฟิลด์อื่น ๆ ตาม sanitizeCg2LogForClient_ (ทั้งหมดไม่บังคับ
 *        ยกเว้น patientId/logDate/symptomTrend)
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function createCg2Log(payload, callerUser) {
  payload = payload || {};
  var patientId = payload.patientId;

  if (!isNonEmptyString_(patientId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ป่วย', { fields: { patientId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }
  if (!isValidIsoDate_(payload.logDate)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุวันที่เยี่ยมให้ถูกต้อง', { fields: { logDate: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' } });
  }
  if (!isValidEnum_(payload.symptomTrend, ENUM_SYMPTOM_TREND_)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาเลือกสรุปอาการปัจจุบัน', {
      fields: { symptomTrend: 'ต้องเป็นหนึ่งใน ' + ENUM_SYMPTOM_TREND_.join(', ') }
    });
  }

  var patient = findRecordByKey_(SHEET_NAMES.PATIENTS, 'PatientId', patientId);
  if (!patient || coerceBoolean_(patient.IsDeleted)) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ป่วยนี้ในระบบ');
  }
  if (!canAccessPatient_(callerUser, patient) || callerUser.role === 'VIEWER') {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์บันทึกการเยี่ยมของผู้ป่วยรายนี้');
  }

  var recommendations = Array.isArray(payload.recommendations) ? payload.recommendations : [];
  var now = new Date().toISOString();

  var record = {
    LogId: generateShortId_('CG2'),
    PatientId: patientId,
    LoggedByUserId: callerUser.userId,
    LogDate: payload.logDate,
    SymptomTrend: payload.symptomTrend,
    ConditionNote: payload.conditionNote || '',
    Temp: payload.temp || '',
    Pulse: payload.pulse || '',
    RespRate: payload.respRate || '',
    BP: payload.bp || '',
    WaistCircumference: payload.waistCircumference || '',
    DementiaScore: payload.dementiaScore || '',
    DepressionScore: payload.depressionScore || '',
    AdlScore: payload.adlScore || '',
    TaiScore: payload.taiScore || '',
    CaregiverPresent: !!payload.caregiverPresent,
    Recommendations: JSON.stringify(recommendations),
    RecommendationOtherNote: payload.recommendationOtherNote || '',
    CreatedAt: now,
    UpdatedAt: now
  };

  var created = appendRecord_(SHEET_NAMES.CG2_LOGS, record);
  logAudit_(callerUser.userId, 'cg2logs.create', 'CG2Log', created.LogId, { patientId: patientId, logDate: payload.logDate });

  return ok_({ log: sanitizeCg2LogForClient_(created) });
}

/* ============================================================
 * listCg2LogsByPatient — action: cg2logs.listByPatient (ADMIN, CM, CG, VIEWER — ต้องผ่าน canAccessPatient_)
 * ============================================================ */

/**
 * @param {{patientId: string, page: number=, pageSize: number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function listCg2LogsByPatient(payload, callerUser) {
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
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, 100) : 20;

  var records = findRecords_(SHEET_NAMES.CG2_LOGS, function (r) { return r.PatientId === patientId; });

  records.sort(function (a, b) {
    if (a.LogDate === b.LogDate) return 0;
    return a.LogDate < b.LogDate ? 1 : -1; // ใหม่สุดก่อน
  });

  var total = records.length;
  var start = (page - 1) * pageSize;
  var items = records.slice(start, start + pageSize).map(sanitizeCg2LogForClient_);

  return ok_({ total: total, page: page, pageSize: pageSize, items: items });
}
