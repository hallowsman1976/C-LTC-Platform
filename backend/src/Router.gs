/**
 * Router.gs
 * ตาราง route กลาง ผูก action string (จาก request body) → handler function เดียว
 * บังคับ authentication (requireUser_) และ RBAC (requireRole_) ที่ชั้นนี้แบบรวมศูนย์
 * เพื่อไม่ให้แต่ละ handler ต้องเขียนโค้ดตรวจสิทธิ์ซ้ำเอง (และกันพลาดลืมตรวจ)
 *
 * เพิ่ม action ใหม่ในเฟสถัดไป (Files/Notifications/CarePlan approvals ฯลฯ) แค่เพิ่ม entry ใน ACTION_ROUTES_
 */

var ACTION_ROUTES_ = {
  'auth.login': {
    requireAuth: false,
    roles: null,
    handler: function (ctx) { return login(ctx.payload); }
  },
  'auth.logout': {
    // ไม่บังคับ auth ผ่าน middleware เพราะ logout ต้อง "เกือบไม่มีวันล้มเหลว"
    // แม้ token จะหมดอายุไปแล้วก็ตาม — ตัว logout() เองเช็ค/ลบ session ให้แล้ว
    requireAuth: false,
    roles: null,
    handler: function (ctx) { return logout(ctx.token); }
  },
  'auth.validateSession': {
    requireAuth: false,
    roles: null,
    handler: function (ctx) { return validateSession(ctx.token); }
  },
  'auth.me': {
    requireAuth: true,
    roles: null,
    handler: function (ctx) { return getCurrentUser(ctx.user); }
  },
  'admin.users.create': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return createUser(ctx.payload, ctx.user); }
  },
  'admin.users.update': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return updateUser(ctx.payload, ctx.user); }
  },
  'admin.users.resetPassword': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return resetPassword(ctx.payload, ctx.user); }
  },
  'admin.users.list': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return listUsers(ctx.payload, ctx.user); }
  },
  'patients.create': {
    requireAuth: true,
    roles: ['ADMIN', 'CM'],
    handler: function (ctx) { return createPatient(ctx.payload, ctx.user); }
  },
  'patients.update': {
    requireAuth: true,
    roles: ['ADMIN', 'CM'],
    handler: function (ctx) { return updatePatient(ctx.payload, ctx.user); }
  },
  'patients.get': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return getPatient(ctx.payload, ctx.user); }
  },
  'patients.list': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return listPatients(ctx.payload, ctx.user); }
  },
  'patients.archive': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return archivePatient(ctx.payload, ctx.user); }
  },
  'patients.import': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return importPatients(ctx.payload, ctx.user); }
  },
  'patients.assignCareTeam': {
    requireAuth: true,
    roles: ['ADMIN', 'CM'],
    handler: function (ctx) { return assignCareTeam(ctx.payload, ctx.user); }
  },
  'careplans.create': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return createCarePlan(ctx.payload, ctx.user); }
  },
  'careplans.update': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return updateCarePlan(ctx.payload, ctx.user); }
  },
  'careplans.get': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return getCarePlan(ctx.payload, ctx.user); }
  },
  'careplans.list': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return listCarePlans(ctx.payload, ctx.user); }
  },
  'careplans.approve': {
    requireAuth: true,
    roles: ['ADMIN', 'CM'],
    handler: function (ctx) { return approveCarePlan(ctx.payload, ctx.user); }
  },
  'visits.saveDraft': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return saveVisitDraft(ctx.payload, ctx.user); }
  },
  'visits.submit': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return submitVisit(ctx.payload, ctx.user); }
  },
  'visits.get': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return getVisit(ctx.payload, ctx.user); }
  },
  'visits.listByPatient': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return listVisitsByPatient(ctx.payload, ctx.user); }
  },
  'visits.review': {
    requireAuth: true,
    roles: ['ADMIN', 'CM'],
    handler: function (ctx) { return reviewVisit(ctx.payload, ctx.user); }
  },
  'assessments.saveBarthel': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return saveBarthelAssessment(ctx.payload, ctx.user); }
  },
  'assessments.saveDepression': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return saveDepressionAssessment(ctx.payload, ctx.user); }
  },
  'assessments.saveFallRisk': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return saveFallRiskAssessment(ctx.payload, ctx.user); }
  },
  'assessments.saveCaregiverBurden': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return saveCaregiverBurdenAssessment(ctx.payload, ctx.user); }
  },
  'assessments.savePressureUlcer': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return savePressureUlcerAssessment(ctx.payload, ctx.user); }
  },
  'assessments.saveInhomesss': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return saveInhomesssAssessment(ctx.payload, ctx.user); }
  },
  'assessments.get': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return getAssessment(ctx.payload, ctx.user); }
  },
  'assessments.listByPatient': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG', 'VIEWER'],
    handler: function (ctx) { return listAssessmentsByPatient(ctx.payload, ctx.user); }
  },
  'admin.notifications.list': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return listNotifications(ctx.payload, ctx.user); }
  },
  'admin.auditLog.list': {
    requireAuth: true,
    roles: ['ADMIN'],
    handler: function (ctx) { return listAuditLogs(ctx.payload, ctx.user); }
  },
  'users.updateLineId': {
    requireAuth: true,
    roles: null, // ตรวจสิทธิ์ตาม "เจ้าของบัญชี" ในตัว handler เอง (updateLineId ใน UserService.gs) ไม่ใช่ role-based ล้วน ๆ
    handler: function (ctx) { return updateLineId(ctx.payload, ctx.user); }
  },
  'files.upload': {
    requireAuth: true,
    roles: ['ADMIN', 'CM', 'CG'],
    handler: function (ctx) { return uploadFile(ctx.payload, ctx.user); }
  }
};

/**
 * จุดเดียวที่ Code.gs (doPost) เรียกเข้ามา — หา route ตาม action, ตรวจ auth/RBAC ตามที่ route กำหนด, แล้วเรียก handler
 * @param {string} action เช่น 'auth.login', 'admin.users.list'
 * @param {string|null} token
 * @param {Object} payload
 * @param {Object=} rawEvent event ดิบของ doPost (เผื่อ handler ในอนาคตต้องใช้ เช่น ตรวจ header)
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function routeAction_(action, token, payload, rawEvent) {
  var route = ACTION_ROUTES_[action];
  if (!route) {
    return err_(ERROR_CODES.NOT_FOUND, 'ไม่พบ action "' + action + '" ในระบบ');
  }

  var ctx = { token: token, payload: payload || {}, user: null, rawEvent: rawEvent };

  if (route.requireAuth) {
    var authResult = requireUser_(token);
    if (!authResult.ok) return authResult;
    ctx.user = authResult.data;

    if (route.roles && route.roles.length > 0) {
      var roleResult = requireRole_(ctx.user, route.roles);
      if (!roleResult.ok) return roleResult;
    }
  }

  try {
    return route.handler(ctx);
  } catch (err) {
    return errFromException_(err, ERROR_CODES.SERVER);
  }
}
