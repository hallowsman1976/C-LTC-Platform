/**
 * Middleware.gs
 * ชั้นกลางที่ทุก request ที่ต้อง auth ต้องผ่าน: ตรวจ session (requireUser_), ตรวจสิทธิ์ตามบทบาท (requireRole_ — RBAC),
 * และ rate limiting สำหรับการเข้าสู่ระบบ (กัน brute-force เดารหัสผ่าน/เลขบัตรประชาชน)
 *
 * หลักการ: ทุกฟังก์ชันในไฟล์นี้ "ไม่ throw" — คืนค่าเป็น envelope จาก ok_()/err_() เสมอ
 * เพื่อให้ Router.gs เช็คแค่ .ok แล้วตัดสินใจต่อได้โดยไม่ต้อง try/catch ซ้อนทุกจุด
 */

/* ============================================================
 * Authentication / RBAC
 * ============================================================ */

/**
 * ตรวจว่า token ที่แนบมาถูกต้องและยังไม่หมดอายุหรือไม่ — ใช้เป็นด่านแรกของทุก action ที่ requireAuth: true
 * (ตัว logic จริงอยู่ใน validateSession() ของ Auth.gs — ฟังก์ชันนี้แค่บังคับว่าต้องมี token ก่อน)
 * @param {string} token
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}} data คือ user object (camelCase) ถ้าสำเร็จ
 */
function requireUser_(token) {
  if (!isNonEmptyString_(token)) {
    return err_(ERROR_CODES.AUTH_REQUIRED, 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
  }
  return validateSession(token);
}

/**
 * ตรวจว่า user (ที่ผ่าน requireUser_ มาแล้ว) มีบทบาทอยู่ในรายการที่อนุญาตหรือไม่ (RBAC)
 * @param {Object} user user object จาก requireUser_ (ต้องมี field .role)
 * @param {Array<string>} allowedRoles เช่น ['ADMIN'], ['ADMIN','CM']
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function requireRole_(user, allowedRoles) {
  if (!user || !allowedRoles || allowedRoles.indexOf(user.role) === -1) {
    return err_(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  }
  return ok_(user);
}

/* ============================================================
 * Rate Limiting สำหรับ Login — ป้องกัน brute-force เดารหัสผ่าน/เลขบัตรประชาชน
 * ใช้ CacheService นับจำนวนครั้งที่ล้มเหลวต่อ identifier (CID หรือ username) ภายในหน้าต่างเวลาที่กำหนด
 * ============================================================ */

var LOGIN_RATE_LIMIT_MAX_ATTEMPTS_ = 5;
var LOGIN_RATE_LIMIT_WINDOW_SECONDS_ = 300; // 5 นาที

/**
 * ตรวจว่า identifier นี้ยังพยายาม login ได้อยู่หรือถูกบล็อกชั่วคราวแล้ว — เรียกก่อนตรวจ credential ทุกครั้ง
 * @param {string} identifier เช่น 'cg:1234567890123' หรือ 'staff:cm001'
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function checkLoginRateLimit_(identifier) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'loginattempt_' + identifier;
  var raw = cache.get(cacheKey);
  var count = raw ? parseInt(raw, 10) : 0;
  if (count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS_) {
    return err_(ERROR_CODES.RATE_LIMIT, 'พยายามเข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณาลองใหม่อีกครั้งในอีกสักครู่');
  }
  return ok_({ remaining: LOGIN_RATE_LIMIT_MAX_ATTEMPTS_ - count });
}

/**
 * นับความล้มเหลวเพิ่ม 1 ครั้งสำหรับ identifier นี้ (ตั้ง/ต่ออายุ TTL ใหม่ทุกครั้งที่ล้มเหลว)
 * @param {string} identifier
 */
function registerLoginFailure_(identifier) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'loginattempt_' + identifier;
  var raw = cache.get(cacheKey);
  var count = (raw ? parseInt(raw, 10) : 0) + 1;
  cache.put(cacheKey, String(count), LOGIN_RATE_LIMIT_WINDOW_SECONDS_);
}

/**
 * เคลียร์ตัวนับ rate limit — เรียกทันทีที่ login สำเร็จ
 * @param {string} identifier
 */
function resetLoginRateLimit_(identifier) {
  CacheService.getScriptCache().remove('loginattempt_' + identifier);
}
