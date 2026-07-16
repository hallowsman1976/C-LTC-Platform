/**
 * UserService.gs
 * จัดการบัญชีผู้ใช้ (Users sheet) — สร้าง/แก้ไข/รีเซ็ตรหัสผ่าน/แสดงรายชื่อ
 * ทุกฟังก์ชันในไฟล์นี้เรียกได้เฉพาะ ADMIN เท่านั้น (บังคับที่ Router.gs ผ่าน requireRole_ ก่อนถึงจะเข้ามาที่นี่)
 * ตาม Permission Matrix ของ BLUEPRINT.md §3: "จัดการผู้ใช้ (สร้าง/ปิดบัญชี/กำหนดบทบาท)" = ADMIN เท่านั้น
 */

/** ฟิลด์ของ Users ที่ updateUser() อนุญาตให้แก้ได้ (ห้ามแก้ Username/CID/PasswordHash ตรงนี้ — มี flow เฉพาะของมันเอง) */
var USER_PATCH_ALLOWED_KEYS_ = ['name', 'phone', 'lineUserId', 'active', 'role'];

/**
 * สร้างผู้ใช้ใหม่ — action: admin.users.create
 * @param {{role:string, name:string, username:string=, password:string=, cid:string=, phone:string=, lineUserId:string=}} payload
 * @param {Object} callerUser ผู้เรียก (ADMIN) — ใช้บันทึก audit log
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function createUser(payload, callerUser) {
  payload = payload || {};
  var role = payload.role;

  if (!isValidEnum_(role, ENUM_ROLE_)) {
    return err_(ERROR_CODES.VALIDATION, 'บทบาทไม่ถูกต้อง', {
      fields: { role: 'ต้องเป็นหนึ่งใน ' + ENUM_ROLE_.join(', ') }
    });
  }

  var requiredCheck = (role === 'CG')
    ? validateRequiredFields_(payload, ['name', 'cid'])
    : validateRequiredFields_(payload, ['name', 'username', 'password']);

  if (!requiredCheck.valid) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณากรอกข้อมูลให้ครบถ้วน', { fields: requiredCheck.fields });
  }

  if (role === 'CG') {
    var cid = String(payload.cid).trim();
    if (!isValidThaiCid_(cid)) {
      return err_(ERROR_CODES.VALIDATION, 'เลขประจำตัวประชาชนไม่ถูกต้อง', {
        fields: { cid: 'รูปแบบหรือ checksum ไม่ถูกต้อง' }
      });
    }
    var cidExists = findRecord_(SHEET_NAMES.USERS, function (r) { return String(r.CID) === cid; });
    if (cidExists) {
      return err_(ERROR_CODES.CONFLICT, 'มีผู้ใช้ที่ใช้เลขประจำตัวประชาชนนี้อยู่แล้ว');
    }
  } else {
    if (String(payload.password).length < MIN_PASSWORD_LENGTH_) {
      return err_(ERROR_CODES.VALIDATION, 'รหัสผ่านต้องมีความยาวอย่างน้อย ' + MIN_PASSWORD_LENGTH_ + ' ตัวอักษร', {
        fields: { password: 'สั้นเกินไป' }
      });
    }
    var usernameLower = String(payload.username).trim().toLowerCase();
    var usernameExists = findRecord_(SHEET_NAMES.USERS, function (r) {
      return isNonEmptyString_(r.Username) && r.Username.trim().toLowerCase() === usernameLower;
    });
    if (usernameExists) {
      return err_(ERROR_CODES.CONFLICT, 'มีผู้ใช้ที่ใช้ชื่อผู้ใช้นี้อยู่แล้ว');
    }
  }

  var now = new Date().toISOString();
  var newUserRow = {
    UserId: generateShortId_('U'),
    Role: role,
    Name: payload.name,
    Username: role === 'CG' ? '' : String(payload.username).trim(),
    PasswordHash: role === 'CG' ? '' : hashPassword_(payload.password),
    CID: role === 'CG' ? String(payload.cid).trim() : (payload.cid || ''),
    Phone: payload.phone || '',
    LineUserId: payload.lineUserId || '',
    Active: true,
    CreatedAt: now,
    UpdatedAt: now
  };

  var created = appendRecord_(SHEET_NAMES.USERS, newUserRow);
  logAudit_(callerUser.userId, 'users.create', 'User', created.UserId, { role: role });

  return ok_({ user: sanitizeUserForClient_(created) });
}

/**
 * แก้ไขข้อมูลผู้ใช้ (ไม่รวมรหัสผ่าน/username/CID) — action: admin.users.update
 * @param {{userId:string, patch: {name:string=, role:string=, phone:string=, lineUserId:string=, active:boolean=}}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function updateUser(payload, callerUser) {
  payload = payload || {};
  var userId = payload.userId;

  if (!isNonEmptyString_(userId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ใช้ที่ต้องการแก้ไข', { fields: { userId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var existing = findRecordByKey_(SHEET_NAMES.USERS, 'UserId', userId);
  if (!existing) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้นี้ในระบบ');
  }

  var patchInput = payload.patch || {};
  var patch = {};

  if (patchInput.name !== undefined) patch.Name = patchInput.name;
  if (patchInput.phone !== undefined) patch.Phone = patchInput.phone;
  if (patchInput.lineUserId !== undefined) patch.LineUserId = patchInput.lineUserId;
  if (patchInput.active !== undefined) patch.Active = !!patchInput.active;
  if (patchInput.role !== undefined) {
    if (!isValidEnum_(patchInput.role, ENUM_ROLE_)) {
      return err_(ERROR_CODES.VALIDATION, 'บทบาทไม่ถูกต้อง', {
        fields: { role: 'ต้องเป็นหนึ่งใน ' + ENUM_ROLE_.join(', ') }
      });
    }
    patch.Role = patchInput.role;
  }

  if (Object.keys(patch).length === 0) {
    return err_(ERROR_CODES.VALIDATION, 'ไม่มีข้อมูลที่จะแก้ไข — อนุญาตเฉพาะ ' + USER_PATCH_ALLOWED_KEYS_.join(', '));
  }

  patch.UpdatedAt = new Date().toISOString();
  var updated = updateRecord_(SHEET_NAMES.USERS, existing._rowIndex, patch);

  // ปิดใช้งานบัญชี → เพิกถอน session ที่ค้างอยู่ทั้งหมดทันที
  if (patchInput.active === false) {
    revokeAllSessionsForUser_(userId);
  }

  logAudit_(callerUser.userId, 'users.update', 'User', userId, { patch: patchInput });

  return ok_({ user: sanitizeUserForClient_(updated) });
}

/**
 * รีเซ็ตรหัสผ่านผู้ใช้ (เฉพาะ CM/ADMIN/VIEWER — CG ไม่มีรหัสผ่านให้รีเซ็ต) — action: admin.users.resetPassword
 * ถ้าไม่ส่ง newPassword มา จะสุ่มรหัสผ่านชั่วคราวให้และคืนค่ากลับไปให้ Admin นำไปแจ้งผู้ใช้เอง (ยังไม่มีระบบส่งอีเมล/SMS ใน Phase นี้)
 * @param {{userId:string, newPassword:string=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function resetPassword(payload, callerUser) {
  payload = payload || {};
  var userId = payload.userId;

  if (!isNonEmptyString_(userId)) {
    return err_(ERROR_CODES.VALIDATION, 'กรุณาระบุผู้ใช้ที่ต้องการรีเซ็ตรหัสผ่าน', { fields: { userId: 'จำเป็นต้องกรอกข้อมูลนี้' } });
  }

  var existing = findRecordByKey_(SHEET_NAMES.USERS, 'UserId', userId);
  if (!existing) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้นี้ในระบบ');
  }

  if (existing.Role === 'CG') {
    return err_(ERROR_CODES.VALIDATION, 'ผู้ใช้ประเภทผู้ดูแล (CG) เข้าสู่ระบบด้วยเลขประจำตัวประชาชน ไม่มีรหัสผ่านให้รีเซ็ต');
  }

  var adminProvidedPassword = isNonEmptyString_(payload.newPassword);
  var newPassword = adminProvidedPassword ? payload.newPassword : generateTempPassword_();

  if (newPassword.length < MIN_PASSWORD_LENGTH_) {
    return err_(ERROR_CODES.VALIDATION, 'รหัสผ่านต้องมีความยาวอย่างน้อย ' + MIN_PASSWORD_LENGTH_ + ' ตัวอักษร', {
      fields: { newPassword: 'สั้นเกินไป' }
    });
  }

  updateRecord_(SHEET_NAMES.USERS, existing._rowIndex, {
    PasswordHash: hashPassword_(newPassword),
    UpdatedAt: new Date().toISOString()
  });

  // บังคับ login ใหม่ทุกอุปกรณ์หลังรีเซ็ตรหัสผ่าน
  revokeAllSessionsForUser_(userId);

  logAudit_(callerUser.userId, 'users.resetPassword', 'User', userId, { generatedByAdmin: !adminProvidedPassword });

  var result = { userId: userId };
  if (!adminProvidedPassword) {
    result.temporaryPassword = newPassword;
  }
  return ok_(result);
}

/**
 * สุ่มรหัสผ่านชั่วคราวอ่านง่าย (10 ตัวอักษร) — ใช้เมื่อ Admin ไม่ได้ระบุรหัสผ่านใหม่เอง
 * @return {string}
 */
function generateTempPassword_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 10);
}

/**
 * แสดงรายชื่อผู้ใช้ทั้งหมด พร้อมค้นหา/กรองตามบทบาท และแบ่งหน้า — action: admin.users.list
 * @param {{search:string=, role:string=, page:number=, pageSize:number=}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}}
 */
function listUsers(payload, callerUser) {
  payload = payload || {};
  var page = payload.page > 0 ? payload.page : 1;
  var pageSize = payload.pageSize > 0 ? payload.pageSize : 20;
  var search = isNonEmptyString_(payload.search) ? payload.search.trim().toLowerCase() : '';
  var roleFilter = payload.role;

  var records = readAllRecords_(SHEET_NAMES.USERS).records;

  var filtered = records.filter(function (r) {
    if (roleFilter && r.Role !== roleFilter) return false;
    if (search) {
      var haystack = (String(r.Name || '') + ' ' + String(r.Username || '') + ' ' + String(r.CID || '')).toLowerCase();
      if (haystack.indexOf(search) === -1) return false;
    }
    return true;
  });

  filtered.sort(function (a, b) { return String(a.Name || '').localeCompare(String(b.Name || ''), 'th'); });

  var total = filtered.length;
  var start = (page - 1) * pageSize;
  var pageItems = filtered.slice(start, start + pageSize).map(sanitizeUserForClient_);

  return ok_({ total: total, page: page, pageSize: pageSize, items: pageItems });
}

/**
 * ผูก/แก้ไข LineUserId ของผู้ใช้ — action: users.updateLineId (Phase 10 — ปิดช่องว่างจาก BLUEPRINT.md §3/§9
 * ที่ระบุไว้ตั้งแต่ Phase 1 ว่า "ทุกคนผูกของตนเองได้ ADMIN ผูกของทุกคนได้" แต่ไม่เคยมี action นี้มาก่อน
 * ทำให้ระบบแจ้งเตือน LINE ทั้งหมดที่สร้างใน Phase 5/9 ไม่มีทางถูกใช้งานจริงได้เลยถ้าไม่มี action นี้)
 *
 * ไม่บังคับ role ที่ Router.gs (roles: null) เพราะกติกาไม่ใช่ role-based ล้วน ๆ — ตรวจสิทธิ์ตาม "เจ้าของบัญชี" ในนี้แทน:
 * ไม่ระบุ userId (หรือระบุเป็นของตัวเอง) = แก้ของตัวเองได้เสมอทุก role, ระบุ userId ของคนอื่น = ต้องเป็น ADMIN เท่านั้น
 *
 * @param {{userId:string=, lineUserId:string}} payload
 * @param {Object} callerUser
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function updateLineId(payload, callerUser) {
  payload = payload || {};
  var targetUserId = isNonEmptyString_(payload.userId) ? payload.userId : callerUser.userId;

  if (targetUserId !== callerUser.userId && callerUser.role !== 'ADMIN') {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณสามารถผูก LINE ID ได้เฉพาะบัญชีของตนเองเท่านั้น');
  }

  var existing = findRecordByKey_(SHEET_NAMES.USERS, 'UserId', targetUserId);
  if (!existing) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้นี้ในระบบ');
  }

  var lineUserId = isNonEmptyString_(payload.lineUserId) ? payload.lineUserId.trim() : '';
  var updated = updateRecord_(SHEET_NAMES.USERS, existing._rowIndex, {
    LineUserId: lineUserId,
    UpdatedAt: new Date().toISOString()
  });

  logAudit_(callerUser.userId, 'users.updateLineId', 'User', targetUserId, { hasLineId: !!lineUserId });

  return ok_({ user: sanitizeUserForClient_(updated) });
}
