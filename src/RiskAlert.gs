/**
 * RiskAlert.gs
 * ตรวจเงื่อนไขความเสี่ยงสูง (red-flag) จากผลการเยี่ยม/แบบประเมิน แล้วแจ้งเตือน CM ผู้รับผิดชอบผู้ป่วยรายนั้นทันที
 * ตาม BLUEPRINT.md §16 — ใช้ LINE Messaging API (Push Message) เพราะ LINE Notify ถูกยกเลิกบริการไปแล้ว
 *
 * เรียกจาก Visits.gs / Assessments.gs / DepressionAssessment.gs หลังบันทึกข้อมูลสำเร็จเท่านั้น
 * ออกแบบให้ "ไม่มีวันทำ request หลักล้มเหลว" แม้ยิง LINE ไม่สำเร็จ หรือยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN เลยก็ตาม
 * (ยิงไม่ได้ก็แค่บันทึก Notifications เป็น failed/skipped_no_line_id — ไม่ throw)
 */

/**
 * ประเมินและแจ้งเตือนถ้าจำเป็น
 * @param {Object} patientRecord แถวดิบจาก Patients sheet (เจ้าของข้อมูลที่เพิ่งบันทึกซึ่งเข้าเงื่อนไขความเสี่ยง)
 * @param {string} alertType เช่น 'depression_9q_alert', 'pressure_ulcer_severe', 'fall_risk_high', 'visit_pressure_ulcer_severe'
 * @param {string} message ข้อความสรุปสำหรับส่ง LINE และเก็บ log (ภาษาไทยที่ CM อ่านแล้วเข้าใจทันที)
 * @return {{triggered: boolean, status: string}}
 */
function triggerRiskAlertIfNeeded_(patientRecord, alertType, message) {
  if (!patientRecord) return { triggered: false, status: 'no_patient' };

  var cmUserId = patientRecord.ResponsibleCmUserId;
  var recipientUser = isNonEmptyString_(cmUserId) ? findRecordByKey_(SHEET_NAMES.USERS, 'UserId', cmUserId) : null;

  var status;
  if (!recipientUser || !isNonEmptyString_(recipientUser.LineUserId)) {
    status = 'skipped_no_line_id';
  } else {
    status = sendLineMessage_(recipientUser.LineUserId, message) ? 'sent' : 'failed';
  }

  try {
    appendRecord_(SHEET_NAMES.NOTIFICATIONS, {
      NotificationId: generateShortId_('NOTI'),
      RecipientUserId: recipientUser ? recipientUser.UserId : '',
      Type: alertType,
      Message: message,
      RelatedPatientId: patientRecord.PatientId,
      Channel: 'LINE',
      Status: status,
      CreatedAt: new Date().toISOString(),
      RetryCount: 0,
      LastAttemptAt: new Date().toISOString()
    });
  } catch (e) {
    Logger.log('[triggerRiskAlertIfNeeded_] เขียน Notifications ไม่สำเร็จ (ไม่ critical): ' + e.message);
  }

  Logger.log('[triggerRiskAlertIfNeeded_] type=' + alertType + ' patient=' + patientRecord.PatientId + ' status=' + status);
  return { triggered: true, status: status };
}

/**
 * ยิง LINE Messaging API push message แบบ best-effort — ไม่ throw ออกไปกระทบ request หลักเด็ดขาด
 * @param {string} lineUserId
 * @param {string} message
 * @return {boolean} true ถ้ายิงสำเร็จ (HTTP 2xx)
 */
function sendLineMessage_(lineUserId, message) {
  var token = getScriptProperty_(SCRIPT_PROPERTY_KEYS.LINE_CHANNEL_ACCESS_TOKEN, false);
  if (!isNonEmptyString_(token)) return false;

  try {
    var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: message }] }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('[sendLineMessage_] LINE API ตอบ HTTP ' + code + ': ' + response.getContentText());
    }
    return code >= 200 && code < 300;
  } catch (e) {
    Logger.log('[sendLineMessage_] ส่ง LINE ไม่สำเร็จ: ' + e.message);
    return false;
  }
}
