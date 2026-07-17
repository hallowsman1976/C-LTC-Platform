/**
 * Triggers.gs
 * Time-driven Triggers ตาม BLUEPRINT.md + Phase 9 — ตรวจเงื่อนไขที่ "ไม่ได้ผูกกับเหตุการณ์บันทึกข้อมูลครั้งเดียว"
 * (ต่างจาก RiskAlert.gs ที่ยิงทันทีตอน visits.submit/assessments.save* เพราะเงื่อนไขพวกนั้นรู้ผลได้จากคำตอบที่เพิ่งบันทึกโดยตรง)
 *
 * ติดตั้ง trigger: เปิด Apps Script Editor → เลือกไฟล์นี้ → รันฟังก์ชัน installTimeDrivenTriggers() ครั้งเดียว (ต้องอนุญาต OAuth)
 * ตรวจสอบ trigger ที่ติดตั้งแล้วได้ที่เมนู "Triggers" (นาฬิกา) ของ Apps Script Editor
 *
 * แจ้งเตือนที่ครอบคลุมในไฟล์นี้ (ที่เหลือ: แผลกดทับ/Mental Health Risk/Caregiver Burden สูง ยิงทันทีอยู่แล้วใน
 * Visits.gs/Assessments.gs/DepressionAssessment.gs ผ่าน triggerRiskAlertIfNeeded_ ไม่ต้องรอ trigger):
 *   - นัดวันนี้      → checkAppointmentsToday_      (แจ้ง CG)
 *   - ก่อนนัด        → checkAppointmentsTomorrow_   (แจ้ง CG)
 *   - เลยนัด         → checkOverdueAppointments_    (แจ้ง CM + อัปเดตสถานะผู้ป่วยเป็น "เลยนัด")
 *   - ADL ลดลง       → checkAdlDecline_             (แจ้ง CM)
 *   - ขาดยา          → checkMedicationNonAdherence_ (แจ้ง CM)
 */

var DAILY_TRIGGER_HOUR_ = 7;
var RETRY_TRIGGER_INTERVAL_MINUTES_ = 30;
/** เฉพาะแบบประเมิน/การเยี่ยมที่ "ใหม่" ภายในกี่ชั่วโมงเท่านั้นที่จะถูกพิจารณา ADL ลดลง/ขาดยา — กันแจ้งเตือนซ้ำทุกวันสำหรับเหตุการณ์เดิม */
var RECENT_CHECK_LOOKBACK_HOURS_ = 26;

/* ============================================================
 * ตัวช่วยเรื่องวันที่ (เทียบ NextVisitDate ซึ่งเก็บเป็น string "YYYY-MM-DD" เท่านั้น)
 * ============================================================ */

/** @return {string} วันที่ปัจจุบันตาม timezone ของสคริปต์ รูปแบบ YYYY-MM-DD */
function getTodayDateString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * @param {string} dateString YYYY-MM-DD
 * @return {Date} เที่ยงคืน UTC ของวันนั้น (anchor ที่เที่ยงวันกันปัญหา DST/timezone ตอนบวกวัน)
 */
function parseIsoDateOnly_(dateString) {
  var parts = dateString.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
}

/**
 * @param {string} dateString YYYY-MM-DD
 * @param {number} days จำนวนวันที่จะบวก (ติดลบได้)
 * @return {string} YYYY-MM-DD
 */
function shiftDateString_(dateString, days) {
  var d = parseIsoDateOnly_(dateString);
  d.setUTCDate(d.getUTCDate() + days);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/* ============================================================
 * นัดวันนี้ / ก่อนนัด / เลยนัด
 * ============================================================ */

/** @return {number} จำนวนผู้ป่วยที่แจ้งเตือน */
function checkAppointmentsToday_() {
  var today = getTodayDateString_();
  var patients = readAllRecords_(SHEET_NAMES.PATIENTS).records;
  var count = 0;
  patients.forEach(function (p) {
    if (coerceBoolean_(p.IsDeleted)) return;
    if (p.NextVisitDate === today) {
      notifyCgForPatient_(p, 'appointment_today', 'วันนี้มีนัดเยี่ยมผู้ป่วย ' + p.Name + ' (HN ' + p.HN + ') กรุณาไปเยี่ยมตามนัด');
      count++;
    }
  });
  return count;
}

/** @return {number} */
function checkAppointmentsTomorrow_() {
  var tomorrow = shiftDateString_(getTodayDateString_(), 1);
  var patients = readAllRecords_(SHEET_NAMES.PATIENTS).records;
  var count = 0;
  patients.forEach(function (p) {
    if (coerceBoolean_(p.IsDeleted)) return;
    if (p.NextVisitDate === tomorrow) {
      notifyCgForPatient_(p, 'appointment_tomorrow', 'พรุ่งนี้มีนัดเยี่ยมผู้ป่วย ' + p.Name + ' (HN ' + p.HN + ') กรุณาเตรียมตัวล่วงหน้า');
      count++;
    }
  });
  return count;
}

/** @return {number} */
function checkOverdueAppointments_() {
  var today = getTodayDateString_();
  var patients = readAllRecords_(SHEET_NAMES.PATIENTS).records;
  var count = 0;
  patients.forEach(function (p) {
    if (coerceBoolean_(p.IsDeleted)) return;
    if (!isNonEmptyString_(p.NextVisitDate)) return;
    if (p.NextVisitDate >= today) return;
    if (p.Status === 'เยี่ยมแล้ว') return;

    if (p.Status !== 'เลยนัด') {
      updateRecord_(SHEET_NAMES.PATIENTS, p._rowIndex, { Status: 'เลยนัด', UpdatedAt: new Date().toISOString() });
    }
    triggerRiskAlertIfNeeded_(p, 'appointment_overdue',
      'ผู้ป่วย ' + p.Name + ' (HN ' + p.HN + ') เลยกำหนดนัดเยี่ยม (นัดวันที่ ' + p.NextVisitDate + ') แล้ว ยังไม่ได้รับการเยี่ยม');
    count++;
  });
  return count;
}

/* ============================================================
 * ADL ลดลง / ขาดยาต่อเนื่อง — ดูเฉพาะข้อมูลที่เพิ่งเข้ามาใหม่ (กันแจ้งเตือนซ้ำทุกวันสำหรับเหตุการณ์เดิม)
 * ============================================================ */

/** @return {number} */
function checkAdlDecline_() {
  var records = readAllRecords_(SHEET_NAMES.ASSESSMENTS_BARTHEL).records;
  var byPatient = {};
  records.forEach(function (r) {
    if (!byPatient[r.PatientId]) byPatient[r.PatientId] = [];
    byPatient[r.PatientId].push(r);
  });

  // อ่าน Patients ครั้งเดียวมาทำ map ในหน่วยความจำ แทน findRecordByKey_ (ไล่สแกนทั้งชีต) ต่อผู้ป่วยในลูปข้างล่าง
  var patientsById = {};
  readAllRecords_(SHEET_NAMES.PATIENTS).records.forEach(function (p) { patientsById[p.PatientId] = p; });

  var recentCutoffMs = Date.now() - RECENT_CHECK_LOOKBACK_HOURS_ * 60 * 60 * 1000;
  var count = 0;

  Object.keys(byPatient).forEach(function (patientId) {
    var list = byPatient[patientId].slice().sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? 1 : -1; });
    if (list.length < 2) return;

    var latest = list[0];
    var previous = list[1];
    var latestTimeMs = new Date(latest.CreatedAt).getTime();
    if (isNaN(latestTimeMs) || latestTimeMs < recentCutoffMs) return;

    var latestScore = Number(latest.TotalScore);
    var previousScore = Number(previous.TotalScore);
    if (isNaN(latestScore) || isNaN(previousScore) || latestScore >= previousScore) return;

    var patient = patientsById[patientId];
    if (!patient || coerceBoolean_(patient.IsDeleted)) return;

    triggerRiskAlertIfNeeded_(patient, 'adl_decline',
      'คะแนน ADL (Barthel) ของผู้ป่วย ' + patient.Name + ' (HN ' + patient.HN + ') ลดลงจาก ' + previousScore + ' เป็น ' + latestScore + ' คะแนน — ควรติดตามอาการ');
    count++;
  });

  return count;
}

/** @return {number} */
function checkMedicationNonAdherence_() {
  var visits = findRecords_(SHEET_NAMES.VISITS, function (v) { return v.Status === 'submitted'; });
  var byPatient = {};
  visits.forEach(function (v) {
    if (!byPatient[v.PatientId]) byPatient[v.PatientId] = [];
    byPatient[v.PatientId].push(v);
  });

  // อ่าน Patients ครั้งเดียวมาทำ map ในหน่วยความจำ แทน findRecordByKey_ (ไล่สแกนทั้งชีต) ต่อผู้ป่วยในลูปข้างล่าง
  var patientsById = {};
  readAllRecords_(SHEET_NAMES.PATIENTS).records.forEach(function (p) { patientsById[p.PatientId] = p; });

  var recentCutoffMs = Date.now() - RECENT_CHECK_LOOKBACK_HOURS_ * 60 * 60 * 1000;
  var count = 0;

  Object.keys(byPatient).forEach(function (patientId) {
    var list = byPatient[patientId].slice().sort(function (a, b) { return a.VisitDate < b.VisitDate ? 1 : -1; });
    var latest = list[0];
    var latestTimeMs = new Date(latest.VisitDate).getTime();
    if (isNaN(latestTimeMs) || latestTimeMs < recentCutoffMs) return;
    if (latest.Medication !== 'ขาดยาต่อเนื่อง') return;

    var patient = patientsById[patientId];
    if (!patient || coerceBoolean_(patient.IsDeleted)) return;

    triggerRiskAlertIfNeeded_(patient, 'medication_non_adherence',
      'ผู้ป่วย ' + patient.Name + ' (HN ' + patient.HN + ') ขาดยาต่อเนื่องจากการเยี่ยมล่าสุด — ควรติดตามเรื่องการใช้ยา');
    count++;
  });

  return count;
}

/* ============================================================
 * Entry point ของ trigger แต่ละตัว
 * ============================================================ */

/** เรียกโดย time-driven trigger ทุกวัน (ตั้งเวลาไว้ที่ DAILY_TRIGGER_HOUR_) */
function runDailyNotificationChecks() {
  var summary = {
    appointmentsToday: checkAppointmentsToday_(),
    appointmentsTomorrow: checkAppointmentsTomorrow_(),
    overdueAppointments: checkOverdueAppointments_(),
    adlDeclines: checkAdlDecline_(),
    medicationNonAdherence: checkMedicationNonAdherence_()
  };
  Logger.log('[runDailyNotificationChecks] ' + JSON.stringify(summary));
  logAudit_('SYSTEM', 'system.dailyNotificationChecks', 'System', '', summary);
  return summary;
}

/** เรียกโดย time-driven trigger ทุก RETRY_TRIGGER_INTERVAL_MINUTES_ นาที — ประมวลผล Retry Queue (ดู NotificationService.gs) */
function runRetryQueueTrigger() {
  return retryFailedNotifications_();
}

/* ============================================================
 * ติดตั้ง/ถอน trigger — รันเองจาก Apps Script Editor เท่านั้น (ไม่ผูกกับ Router.gs)
 * ============================================================ */

/** รันครั้งเดียวตอน deploy (หรือรันซ้ำได้ปลอดภัย — ลบของเดิมแล้วสร้างใหม่เสมอ กันเกิด trigger ซ้ำซ้อน) */
function installTimeDrivenTriggers() {
  removeTimeDrivenTriggers_();

  ScriptApp.newTrigger('runDailyNotificationChecks')
    .timeBased()
    .atHour(DAILY_TRIGGER_HOUR_)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('runRetryQueueTrigger')
    .timeBased()
    .everyMinutes(RETRY_TRIGGER_INTERVAL_MINUTES_)
    .create();

  Logger.log('[installTimeDrivenTriggers] ติดตั้งสำเร็จ: runDailyNotificationChecks (ทุกวัน ~' + DAILY_TRIGGER_HOUR_ + ':00), '
    + 'runRetryQueueTrigger (ทุก ' + RETRY_TRIGGER_INTERVAL_MINUTES_ + ' นาที)');
}

/** ถอน trigger ทั้งหมดที่ไฟล์นี้เคยติดตั้งไว้ (เรียกจาก installTimeDrivenTriggers ทุกครั้งก่อนสร้างใหม่ กันซ้ำซ้อน) */
function removeTimeDrivenTriggers_() {
  var handlerNames = ['runDailyNotificationChecks', 'runRetryQueueTrigger'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlerNames.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
