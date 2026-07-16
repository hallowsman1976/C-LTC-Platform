/**
 * AuditService.gs
 * บันทึกและสืบค้น Audit Trail (BLUEPRINT.md §17) — ทุก action ที่ mutate ข้อมูล หรือ login/logout ต้องเรียก logAudit_()
 */

/**
 * เขียนแถวใหม่ลง AuditLog — ออกแบบให้ "ไม่มีวันทำให้ request หลักล้มเหลว"
 * แม้เขียน log ไม่สำเร็จ (เช่น sheet ถูกลบ) ก็แค่ log เข้า Stackdriver แล้ว return null ไม่ throw ต่อ
 *
 * @param {string} userId ผู้ทำ action นี้ (ว่างได้ เช่น กรณี login ล้มเหลวยังไม่รู้ userId)
 * @param {string} action ชื่อ action เช่น 'auth.login', 'visits.submit', 'patients.update'
 * @param {string} targetType ประเภทของสิ่งที่ถูกกระทำ เช่น 'Patient', 'Visit', 'User'
 * @param {string} targetId id ของสิ่งที่ถูกกระทำ
 * @param {Object=} detail ข้อมูลเสริม (จะถูก JSON.stringify เก็บในคอลัมน์ Detail)
 * @return {Object|null} record ที่เขียนจริง หรือ null ถ้าเขียนไม่สำเร็จ
 */
function logAudit_(userId, action, targetType, targetId, detail) {
  try {
    var record = {
      LogId: generateShortId_('LOG'),
      Timestamp: new Date().toISOString(),
      UserId: userId || '',
      Action: action || '',
      TargetType: targetType || '',
      TargetId: targetId || '',
      Detail: JSON.stringify(detail || {})
    };
    return appendRecord_(SHEET_NAMES.AUDIT_LOG, record);
  } catch (err) {
    Logger.log('[logAudit_] เขียน audit log ไม่สำเร็จ: ' + (err.stack || err));
    return null;
  }
}

/**
 * สืบค้น Audit Log แบบมีตัวกรองและ pagination (ใช้โดย admin.auditLog.list ใน Phase ถัดไป)
 * @param {{userId:string=, action:string=, targetType:string=, dateFrom:string=, dateTo:string=}} filters
 * @param {number=} page เริ่มที่ 1
 * @param {number=} pageSize
 * @return {{total: number, page: number, pageSize: number, items: Array<Object>}}
 */
function queryAuditLogs_(filters, page, pageSize) {
  filters = filters || {};
  page = (page && page > 0) ? page : 1;
  pageSize = (pageSize && pageSize > 0) ? pageSize : 50;

  var records = readAllRecords_(SHEET_NAMES.AUDIT_LOG).records;
  var filtered = records;

  if (filters.userId) {
    filtered = filtered.filter(function (r) { return r.UserId === filters.userId; });
  }
  if (filters.action) {
    filtered = filtered.filter(function (r) { return r.Action === filters.action; });
  }
  if (filters.targetType) {
    filtered = filtered.filter(function (r) { return r.TargetType === filters.targetType; });
  }
  if (filters.dateFrom) {
    filtered = filtered.filter(function (r) { return r.Timestamp >= filters.dateFrom; });
  }
  if (filters.dateTo) {
    filtered = filtered.filter(function (r) { return r.Timestamp <= filters.dateTo; });
  }

  // ใหม่สุดก่อน
  filtered.sort(function (a, b) {
    if (a.Timestamp === b.Timestamp) return 0;
    return a.Timestamp < b.Timestamp ? 1 : -1;
  });

  var total = filtered.length;
  var start = (page - 1) * pageSize;
  var items = filtered.slice(start, start + pageSize);

  return { total: total, page: page, pageSize: pageSize, items: items };
}

/**
 * action: admin.auditLog.list (ADMIN เท่านั้น) — Phase 10: เปิดใช้งาน queryAuditLogs_ ที่เตรียมไว้ตั้งแต่ Phase 2
 * แต่ไม่เคยมี Router action ให้เรียกจริงจนถึงตอนนี้ (Audit Log เขียนได้มาตลอดแต่ admin ไม่มีทางอ่านย้อนหลังผ่าน API)
 * @param {{userId:string=, action:string=, targetType:string=, dateFrom:string=, dateTo:string=, page:number=, pageSize:number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}}
 */
function listAuditLogs(payload, callerUser) {
  payload = payload || {};
  var result = queryAuditLogs_({
    userId: payload.userId,
    action: payload.action,
    targetType: payload.targetType,
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo
  }, payload.page, payload.pageSize);
  return ok_(result);
}
