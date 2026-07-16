/**
 * DepressionAssessment.gs
 * แบบประเมินภาวะซึมเศร้า 2Q → 9Q → 8Q แบบมีเงื่อนไข (conditional chain) ตาม prototype เดิมและ BLUEPRINT.md §16
 * บันทึกเป็น 1 แถวต่อ 1 รอบการประเมิน (ครอบคลุมทั้ง chain) ตาม schema ของ Assessments_Depression
 *
 * กติกา gating ที่ backend ต้องตรวจซ้ำเองเสมอ (ห้ามเชื่อ flag ที่ frontend ส่งมาว่า "ตอบครบ/ผ่านเงื่อนไขแล้ว"):
 *   - 2Q ทั้ง 2 ข้อตอบ "ไม่มี" (false) ทั้งคู่ → จบ ไม่ต้องมี 9Q/8Q แนบมา
 *   - ถ้าไม่ใช่ทั้งคู่ตอบ false → ต้องมี 9Q ครบทั้ง 9 ข้อ (คะแนน 0-3 ต่อข้อ) แนบมาด้วย ไม่งั้น validation error
 *   - 9Q ข้อ 9 (ลำดับสุดท้าย) มีคะแนน > 0 → ต้องมี 8Q ครบทั้ง 8 ข้อ (boolean) แนบมาด้วย + trigger risk alert ทันที
 */

var NINE_Q_ITEM_COUNT_ = 9;
var EIGHT_Q_ITEM_COUNT_ = 8;

/**
 * คำนวณผลทั้ง chain จากคำตอบดิบ พร้อมตรวจ gating ครบถ้วน — คืน error ถ้าข้อมูลที่จำเป็น (ตามเงื่อนไข) ขาดหายไป
 * @param {{twoQAnswers: {q1: boolean, q2: boolean}, nineQAnswers: Object=, eightQAnswers: Object=}} payload
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function computeDepressionChain_(payload) {
  var twoQAnswers = payload.twoQAnswers || {};
  if (typeof twoQAnswers.q1 !== 'boolean' || typeof twoQAnswers.q2 !== 'boolean') {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาตอบแบบประเมิน 2Q ให้ครบทั้ง 2 ข้อ (true/false)', {
      fields: { twoQAnswers: 'ต้องตอบครบและเป็น true/false' }
    });
  }
  var twoQBothNo = twoQAnswers.q1 === false && twoQAnswers.q2 === false;

  var result = {
    twoQAnswers: { q1: twoQAnswers.q1, q2: twoQAnswers.q2 },
    twoQBothNo: twoQBothNo,
    showNineQ: !twoQBothNo,
    nineQAnswers: null, nineQTotal: null,
    nineQAlert: false, showEightQ: false,
    eightQAnswers: null, eightQTotal: null, eightQVerdict: ''
  };

  if (twoQBothNo) {
    return ok_(result);
  }

  var nineQAnswers = payload.nineQAnswers || {};
  var cleanNineQ = {};
  var nineQTotal = 0;
  for (var i = 1; i <= NINE_Q_ITEM_COUNT_; i++) {
    var key = 'q' + i;
    var value = nineQAnswers[key];
    if (typeof value !== 'number' || value < 0 || value > 3 || Math.floor(value) !== value) {
      return err_(ERROR_CODES.VALIDATION, 'กรุณาตอบแบบประเมิน 9Q ให้ครบทั้ง 9 ข้อ (คะแนน 0-3 ต่อข้อ)', {
        fields: { nineQAnswers: 'ข้อ ' + i + ' ไม่ถูกต้องหรือยังไม่ได้ตอบ' }
      });
    }
    cleanNineQ[key] = value;
    nineQTotal += value;
  }
  result.nineQAnswers = cleanNineQ;
  result.nineQTotal = nineQTotal;
  var nineQAlert = (cleanNineQ.q9 || 0) > 0;
  result.nineQAlert = nineQAlert;
  result.showEightQ = nineQAlert;

  if (!nineQAlert) {
    return ok_(result);
  }

  var eightQAnswers = payload.eightQAnswers || {};
  var cleanEightQ = {};
  var eightQTotal = 0;
  for (var j = 1; j <= EIGHT_Q_ITEM_COUNT_; j++) {
    var ekey = 'q' + j;
    var evalue = eightQAnswers[ekey];
    if (typeof evalue !== 'boolean') {
      return err_(ERROR_CODES.VALIDATION, 'กรุณาตอบแบบประเมิน 8Q ให้ครบทั้ง 8 ข้อ (เนื่องจากพบความเสี่ยงจาก 9Q ข้อ 9)', {
        fields: { eightQAnswers: 'ข้อ ' + j + ' ไม่ถูกต้องหรือยังไม่ได้ตอบ' }
      });
    }
    cleanEightQ[ekey] = evalue;
    if (evalue) eightQTotal++;
  }
  result.eightQAnswers = cleanEightQ;
  result.eightQTotal = eightQTotal;
  result.eightQVerdict = eightQTotal === 0 ? 'ไม่มีความเสี่ยง' : (eightQTotal <= 2 ? 'ความเสี่ยงต่ำ' : 'ความเสี่ยงสูง — ควรส่งต่อทันที');

  return ok_(result);
}

/**
 * @param {Object} record แถวดิบจาก Assessments_Depression
 * @return {Object}
 */
function sanitizeDepressionAssessmentForClient_(record) {
  return {
    assessmentId: record.AssessmentId,
    patientId: record.PatientId,
    visitId: record.VisitId || '',
    assessedByUserId: record.AssessedByUserId,
    twoQAnswers: safeParseJsonObject_(record.TwoQAnswers),
    nineQAnswers: isNonEmptyString_(record.NineQAnswers) ? safeParseJsonObject_(record.NineQAnswers) : null,
    nineQTotal: (record.NineQTotal !== '' && record.NineQTotal !== undefined && record.NineQTotal !== null) ? record.NineQTotal : null,
    eightQAnswers: isNonEmptyString_(record.EightQAnswers) ? safeParseJsonObject_(record.EightQAnswers) : null,
    eightQTotal: (record.EightQTotal !== '' && record.EightQTotal !== undefined && record.EightQTotal !== null) ? record.EightQTotal : null,
    eightQVerdict: record.EightQVerdict || '',
    alertSent: coerceBoolean_(record.AlertSent),
    createdAt: record.CreatedAt
  };
}

/**
 * บันทึกผลแบบประเมิน 2Q/9Q/8Q ทั้ง chain ในครั้งเดียว — action: assessments.saveDepression
 * @param {{patientId: string, requestId: string, visitId: string=, twoQAnswers: Object, nineQAnswers: Object=, eightQAnswers: Object=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function saveDepressionAssessment(payload, callerUser) {
  payload = payload || {};
  var context = resolveAssessmentContext_(payload, callerUser);
  if (!context.ok) return context;

  var existing = findExistingByRequestId_(SHEET_NAMES.ASSESSMENTS_DEPRESSION, payload.requestId);
  if (existing) return ok_({ assessment: sanitizeDepressionAssessmentForClient_(existing) });

  var chainResult = computeDepressionChain_(payload);
  if (!chainResult.ok) return chainResult;
  var chain = chainResult.data;

  var now = new Date().toISOString();
  var record = {
    AssessmentId: generateShortId_('A-DEP'),
    PatientId: context.data.patient.PatientId,
    VisitId: payload.visitId || '',
    AssessedByUserId: callerUser.userId,
    RequestId: payload.requestId,
    TwoQAnswers: JSON.stringify(chain.twoQAnswers),
    NineQAnswers: chain.nineQAnswers ? JSON.stringify(chain.nineQAnswers) : '',
    NineQTotal: chain.nineQTotal !== null ? chain.nineQTotal : '',
    EightQAnswers: chain.eightQAnswers ? JSON.stringify(chain.eightQAnswers) : '',
    EightQTotal: chain.eightQTotal !== null ? chain.eightQTotal : '',
    EightQVerdict: chain.eightQVerdict || '',
    AlertSent: false,
    CreatedAt: now
  };

  var created = appendRecord_(SHEET_NAMES.ASSESSMENTS_DEPRESSION, record);
  logAudit_(callerUser.userId, 'assessments.saveDepression', 'Assessment', created.AssessmentId, {
    patientId: context.data.patient.PatientId, nineQAlert: chain.nineQAlert, eightQTotal: chain.eightQTotal
  });

  var riskResult = { triggered: false };
  if (chain.nineQAlert) {
    var msg = 'ผู้ป่วย ' + context.data.patient.Name + ' (HN ' + context.data.patient.HN + ') ตอบ 9Q ข้อ 9 (คิดทำร้ายตัวเอง) มากกว่า 0 คะแนน';
    if (chain.eightQTotal !== null && chain.eightQTotal > 2) {
      msg += ' และผล 8Q อยู่ในระดับความเสี่ยงสูง ควรส่งต่อทันที';
    }
    riskResult = triggerRiskAlertIfNeeded_(context.data.patient, 'depression_9q_alert', msg);
    if (riskResult.triggered) {
      updateRecord_(SHEET_NAMES.ASSESSMENTS_DEPRESSION, created._rowIndex, { AlertSent: true });
      created.AlertSent = true;
    }
  }

  return ok_({
    assessment: sanitizeDepressionAssessmentForClient_(created),
    riskAlertTriggered: riskResult.triggered
  });
}
