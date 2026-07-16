/**
 * NotificationService.gs
 * ส่วนขยายของระบบแจ้งเตือน LINE (RiskAlert.gs มีของเดิมอยู่แล้วสำหรับ alert แบบ "ทันทีตอนบันทึกข้อมูล" ที่ CM)
 * ไฟล์นี้เพิ่ม 3 อย่างตาม Phase 9:
 *   1. notifyCgForPatient_ — แจ้งเตือนไปยัง "CG" ของผู้ป่วย (RiskAlert.gs เดิมแจ้งเฉพาะ CM เท่านั้น)
 *      ใช้กับแจ้งเตือนนัดหมาย (นัดวันนี้/ก่อนนัด) ที่ควรถึงมือผู้ดูแลหน้างานโดยตรง ไม่ใช่ Case Manager
 *   2. retryFailedNotifications_ — Retry Queue: สแกน Notifications ที่ Status=failed และยังไม่เกินโควตา retry แล้วยิงซ้ำ
 *   3. listNotifications — action: admin.notifications.list (Notification Log สำหรับ ADMIN ดูประวัติการแจ้งเตือนทั้งหมด)
 *
 * Secret (LINE_CHANNEL_ACCESS_TOKEN) อ่านผ่าน sendLineMessage_() ใน RiskAlert.gs ซึ่งอ่านจาก Script Properties อยู่แล้ว
 * ไฟล์นี้ไม่เก็บ/อ่าน secret ตรง ๆ เอง
 */

var NOTIFICATION_MAX_RETRY_ = 5;
var NOTIFICATION_LIST_MAX_PAGE_SIZE_ = 100;

/**
 * แจ้งเตือนไปยัง CG (ผู้ดูแลหลัก) ของผู้ป่วยรายหนึ่ง — คู่กับ triggerRiskAlertIfNeeded_ ใน RiskAlert.gs ที่แจ้ง CM
 * @param {Object} patientRecord แถวดิบจาก Patients sheet
 * @param {string} alertType เช่น 'appointment_today', 'appointment_tomorrow'
 * @param {string} message
 * @return {{triggered: boolean, status: string}}
 */
function notifyCgForPatient_(patientRecord, alertType, message) {
  if (!patientRecord) return { triggered: false, status: 'no_patient' };

  var cgUserId = patientRecord.PrimaryCgUserId;
  var recipientUser = isNonEmptyString_(cgUserId) ? findRecordByKey_(SHEET_NAMES.USERS, 'UserId', cgUserId) : null;

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
    Logger.log('[notifyCgForPatient_] เขียน Notifications ไม่สำเร็จ (ไม่ critical): ' + e.message);
  }

  Logger.log('[notifyCgForPatient_] type=' + alertType + ' patient=' + patientRecord.PatientId + ' status=' + status);
  return { triggered: true, status: status };
}

/* ============================================================
 * Retry Queue — เรียกจาก Triggers.gs (runRetryQueueTrigger) ทุก 30 นาที
 * ============================================================ */

/**
 * สแกน Notifications ที่ Status='failed' และ RetryCount < โควตา แล้วลองส่งซ้ำ
 * ไม่ retry รายการที่ status='skipped_no_line_id' (เพราะสาเหตุคือยังไม่ผูก LINE ID — ส่งซ้ำไปก็ไม่สำเร็จ รอผู้ใช้ผูกเองก่อน)
 * @return {{retried: number, sent: number, stillFailed: number}}
 */
function retryFailedNotifications_() {
  var candidates = findRecords_(SHEET_NAMES.NOTIFICATIONS, function (r) {
    var retryCount = Number(r.RetryCount) || 0;
    return r.Status === 'failed' && retryCount < NOTIFICATION_MAX_RETRY_;
  });

  var sentCount = 0;
  var stillFailedCount = 0;

  candidates.forEach(function (notification) {
    var recipient = isNonEmptyString_(notification.RecipientUserId)
      ? findRecordByKey_(SHEET_NAMES.USERS, 'UserId', notification.RecipientUserId)
      : null;

    var succeeded = false;
    if (recipient && isNonEmptyString_(recipient.LineUserId)) {
      succeeded = sendLineMessage_(recipient.LineUserId, notification.Message);
    }

    var now = new Date().toISOString();
    updateRecord_(SHEET_NAMES.NOTIFICATIONS, notification._rowIndex, {
      Status: succeeded ? 'sent' : 'failed',
      RetryCount: (Number(notification.RetryCount) || 0) + 1,
      LastAttemptAt: now
    });

    if (succeeded) {
      sentCount++;
    } else {
      stillFailedCount++;
    }
  });

  Logger.log('[retryFailedNotifications_] retried=' + candidates.length + ' sent=' + sentCount + ' stillFailed=' + stillFailedCount);
  return { retried: candidates.length, sent: sentCount, stillFailed: stillFailedCount };
}

/* ============================================================
 * Notification Log — action: admin.notifications.list (ADMIN เท่านั้น)
 * ============================================================ */

/**
 * @param {Object} record แถวดิบจาก Notifications sheet
 * @return {Object}
 */
function sanitizeNotificationForClient_(record) {
  return {
    notificationId: record.NotificationId,
    recipientUserId: record.RecipientUserId || '',
    type: record.Type,
    message: record.Message,
    relatedPatientId: record.RelatedPatientId || '',
    channel: record.Channel,
    status: record.Status,
    retryCount: Number(record.RetryCount) || 0,
    createdAt: record.CreatedAt,
    lastAttemptAt: record.LastAttemptAt || ''
  };
}

/**
 * แสดงประวัติการแจ้งเตือนทั้งหมด (Notification Log) พร้อมกรอง/แบ่งหน้า — action: admin.notifications.list
 * @param {{status:string=, type:string=, patientId:string=, page:number=, pageSize:number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}}
 */
function listNotifications(payload, callerUser) {
  payload = payload || {};
  var page = payload.page > 0 ? payload.page : 1;
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, NOTIFICATION_LIST_MAX_PAGE_SIZE_) : 20;

  var records = readAllRecords_(SHEET_NAMES.NOTIFICATIONS).records;

  var filtered = records.filter(function (r) {
    if (isNonEmptyString_(payload.status) && r.Status !== payload.status) return false;
    if (isNonEmptyString_(payload.type) && r.Type !== payload.type) return false;
    if (isNonEmptyString_(payload.patientId) && r.RelatedPatientId !== payload.patientId) return false;
    return true;
  });

  filtered.sort(function (a, b) {
    if (a.CreatedAt === b.CreatedAt) return 0;
    return a.CreatedAt < b.CreatedAt ? 1 : -1; // ใหม่สุดก่อน
  });

  var total = filtered.length;
  var start = (page - 1) * pageSize;
  var items = filtered.slice(start, start + pageSize).map(sanitizeNotificationForClient_);

  return ok_({ total: total, page: page, pageSize: pageSize, items: items });
}
