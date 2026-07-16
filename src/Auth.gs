/**
 * Auth.gs
 * การเข้าสู่ระบบ/ออกจากระบบ/ตรวจ session ตาม BLUEPRINT.md §13
 *
 * - CG login ด้วยเลขประจำตัวประชาชน (ไม่มีรหัสผ่าน — เจตนาตามสเปกเดิม จำกัดสิทธิ์ CG ให้แคบที่สุดเพื่อชดเชยความเสี่ยงนี้)
 * - Staff (CM/ADMIN/VIEWER) login ด้วย username + password (hash แบบ salted + stretched SHA-256 เพราะ
 *   Apps Script ไม่มี bcrypt/scrypt/Argon2 ให้ใช้ตรง ๆ — เป็นแนวทางที่ดีที่สุดเท่าที่แพลตฟอร์มรองรับ)
 * - Session เก็บใน Sessions sheet เป็น source of truth และ cache ผ่าน CacheService เป็น fast-path
 *   (invalidate ทันทีตอน logout/resetPassword) ตาม gas-best-practices rule "Cache ... พร้อม invalidate"
 */

/* ============================================================
 * ค่าคงที่
 * ============================================================ */

var SESSION_TTL_DEFAULT_HOURS_ = 12;
var SESSION_TTL_REMEMBER_HOURS_ = 24 * 30; // 30 วัน เมื่อติ๊ก "จดจำฉัน"
var SESSION_CACHE_TTL_SECONDS_ = 60;
var SESSION_INVALID_SENTINEL_ = '__INVALID__';

var PASSWORD_HASH_ITERATIONS_ = 1000;
var MIN_PASSWORD_LENGTH_ = 8;

/* ============================================================
 * Password Hashing
 * รูปแบบที่เก็บใน Users.PasswordHash: "<perUserSalt>$<stretchedHashHex>"
 * perUserSalt สุ่มใหม่ทุกครั้งที่สร้าง/รีเซ็ตรหัสผ่าน + pepper กลางจาก Script Properties (PASSWORD_SALT)
 * ============================================================ */

/**
 * สร้าง hash ของรหัสผ่าน (ใช้ทั้งตอนสร้างผู้ใช้ใหม่และตอนรีเซ็ตรหัสผ่าน)
 * @param {string} plainPassword
 * @param {string=} existingSalt ถ้าไม่ส่งมาจะสุ่ม salt ใหม่ (ใช้กรณีสร้าง hash ใหม่)
 * @return {string} รูปแบบ "salt$hash"
 */
function hashPassword_(plainPassword, existingSalt) {
  var pepper = getScriptProperty_(SCRIPT_PROPERTY_KEYS.PASSWORD_SALT, true);
  var perUserSalt = existingSalt || generateUuid_();
  var digestInput = perUserSalt + ':' + pepper + ':' + plainPassword;
  var hash = stretchedSha256_(digestInput, PASSWORD_HASH_ITERATIONS_);
  return perUserSalt + '$' + hash;
}

/**
 * ตรวจรหัสผ่านที่กรอกกับค่าที่เก็บไว้ (แบบ timing-safe กันการ leak เวลาเปรียบเทียบ)
 * @param {string} plainPassword
 * @param {string} storedValue รูปแบบ "salt$hash" จาก Users.PasswordHash
 * @return {boolean}
 */
function verifyPassword_(plainPassword, storedValue) {
  if (!isNonEmptyString_(storedValue)) return false;
  var parts = storedValue.split('$');
  if (parts.length !== 2) return false;
  var perUserSalt = parts[0];
  var expectedHash = parts[1];
  var recomputed = hashPassword_(plainPassword, perUserSalt).split('$')[1];
  return timingSafeEquals_(recomputed, expectedHash);
}

/**
 * ยืด SHA-256 ซ้ำหลายรอบ (key stretching) ให้ brute-force ช้าลงกว่า SHA-256 รอบเดียวมาก
 * @param {string} value
 * @param {number} iterations
 * @return {string} hex string
 */
function stretchedSha256_(value, iterations) {
  var current = value;
  for (var i = 0; i < iterations; i++) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, current);
    current = bytesToHex_(bytes);
  }
  return current;
}

/**
 * แปลง byte array → hex string
 * @param {Array<number>} bytes
 * @return {string}
 */
function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * เปรียบเทียบ string สองค่าแบบ timing-safe (เวลาที่ใช้ไม่ขึ้นกับตำแหน่งที่ต่างกัน) กัน timing attack
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function timingSafeEquals_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/* ============================================================
 * Login
 * ============================================================ */

/**
 * เข้าสู่ระบบ — action: auth.login (ไม่ต้องมี token)
 * @param {{mode: string, cid: string=, username: string=, password: string=, rememberMe: boolean=}} payload
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}}
 */
function login(payload) {
  payload = payload || {};
  var mode = payload.mode === 'cg' ? 'cg' : 'staff';
  return mode === 'cg' ? loginAsCg_(payload) : loginAsStaff_(payload);
}

/**
 * @param {Object} payload
 * @return {Object} envelope
 */
function loginAsCg_(payload) {
  var cid = isNonEmptyString_(payload.cid) ? payload.cid.trim() : '';
  var identifier = 'cg:' + cid;

  var rateCheck = checkLoginRateLimit_(identifier);
  if (!rateCheck.ok) {
    logAudit_('', 'auth.login', 'User', cid, { mode: 'cg', success: false, reason: 'rate_limited' });
    return rateCheck;
  }

  if (!isValidThaiCid_(cid)) {
    registerLoginFailure_(identifier);
    logAudit_('', 'auth.login', 'User', cid, { mode: 'cg', success: false, reason: 'invalid_cid_format' });
    return err_(ERROR_CODES.VALIDATION, 'กรุณากรอกเลขประจำตัวประชาชนให้ครบ 13 หลักและถูกต้อง', {
      fields: { cid: 'รูปแบบเลขบัตรประชาชนไม่ถูกต้อง' }
    });
  }

  var userRecord = findRecord_(SHEET_NAMES.USERS, function (r) {
    return r.Role === 'CG' && String(r.CID) === cid;
  });

  if (!userRecord || !coerceBoolean_(userRecord.Active)) {
    registerLoginFailure_(identifier);
    logAudit_('', 'auth.login', 'User', cid, { mode: 'cg', success: false, reason: 'not_found_or_inactive' });
    return err_(ERROR_CODES.AUTH_INVALID, 'ไม่พบผู้ใช้งานที่ตรงกับเลขประจำตัวประชาชนนี้ หรือบัญชีถูกปิดใช้งาน');
  }

  resetLoginRateLimit_(identifier);
  return issueSession_(userRecord, !!payload.rememberMe);
}

/**
 * @param {Object} payload
 * @return {Object} envelope
 */
function loginAsStaff_(payload) {
  var username = isNonEmptyString_(payload.username) ? payload.username.trim().toLowerCase() : '';
  var password = isNonEmptyString_(payload.password) ? payload.password : '';
  var identifier = 'staff:' + username;

  var rateCheck = checkLoginRateLimit_(identifier);
  if (!rateCheck.ok) {
    logAudit_('', 'auth.login', 'User', username, { mode: 'staff', success: false, reason: 'rate_limited' });
    return rateCheck;
  }

  if (!username || !password) {
    registerLoginFailure_(identifier);
    logAudit_('', 'auth.login', 'User', username, { mode: 'staff', success: false, reason: 'missing_credentials' });
    return err_(ERROR_CODES.VALIDATION, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  }

  var userRecord = findRecord_(SHEET_NAMES.USERS, function (r) {
    return isNonEmptyString_(r.Username) && r.Username.trim().toLowerCase() === username;
  });

  var passwordMatches = userRecord ? verifyPassword_(password, userRecord.PasswordHash) : false;

  if (!userRecord || !passwordMatches || !coerceBoolean_(userRecord.Active)) {
    registerLoginFailure_(identifier);
    logAudit_('', 'auth.login', 'User', userRecord ? userRecord.UserId : username, {
      mode: 'staff', success: false, reason: 'invalid_credentials'
    });
    // ไม่บอกว่า username หรือ password ผิดข้อไหน — กัน user enumeration
    return err_(ERROR_CODES.AUTH_INVALID, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  resetLoginRateLimit_(identifier);
  return issueSession_(userRecord, !!payload.rememberMe);
}

/**
 * ออก session token ใหม่ให้ user ที่ login ผ่านแล้ว บันทึกลง Sessions sheet และ Audit Log
 * @param {Object} userRecord แถวดิบจาก Users sheet
 * @param {boolean} rememberMe
 * @return {Object} envelope { token, expiresAt, user }
 */
function issueSession_(userRecord, rememberMe) {
  var now = new Date();
  var ttlHours = rememberMe ? SESSION_TTL_REMEMBER_HOURS_ : SESSION_TTL_DEFAULT_HOURS_;
  var expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  var token = generateUuid_();

  appendRecord_(SHEET_NAMES.SESSIONS, {
    Token: token,
    UserId: userRecord.UserId,
    CreatedAt: now.toISOString(),
    ExpiresAt: expiresAt.toISOString(),
    LastActiveAt: now.toISOString(),
    DeviceInfo: ''
  });

  logAudit_(userRecord.UserId, 'auth.login', 'User', userRecord.UserId, { success: true });

  return ok_({
    token: token,
    expiresAt: expiresAt.toISOString(),
    user: sanitizeUserForClient_(userRecord)
  });
}

/* ============================================================
 * Session validation — เรียกทั้งจาก Middleware.requireUser_() และ action: auth.validateSession โดยตรง
 * ============================================================ */

/**
 * ตรวจสอบ token: ต้องพบใน Sessions sheet, ยังไม่หมดอายุ, และเจ้าของ user ยัง Active อยู่
 * มี CacheService เป็น fast-path ลด round-trip ไปยัง Sheet ในคำขอถัด ๆ ไปของ token เดียวกัน (TTL สั้นเพื่อไม่ให้ stale นาน)
 * @param {string} token
 * @return {{ok: boolean, data: Object}|{ok: boolean, code: string, message: string}} data คือ user object (camelCase)
 */
function validateSession(token) {
  if (!isNonEmptyString_(token)) {
    return err_(ERROR_CODES.AUTH_REQUIRED, 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'session_' + token;
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    if (cached === SESSION_INVALID_SENTINEL_) {
      return err_(ERROR_CODES.SESSION_EXPIRED, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    return ok_(JSON.parse(cached));
  }

  var session = findRecordByKey_(SHEET_NAMES.SESSIONS, 'Token', token);
  if (!session) {
    cache.put(cacheKey, SESSION_INVALID_SENTINEL_, 30);
    return err_(ERROR_CODES.SESSION_EXPIRED, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  var now = new Date();
  var expiresAt = new Date(session.ExpiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < now.getTime()) {
    deleteRow_(SHEET_NAMES.SESSIONS, session._rowIndex);
    cache.put(cacheKey, SESSION_INVALID_SENTINEL_, 30);
    return err_(ERROR_CODES.SESSION_EXPIRED, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  var userRecord = findRecordByKey_(SHEET_NAMES.USERS, 'UserId', session.UserId);
  if (!userRecord || !coerceBoolean_(userRecord.Active)) {
    cache.put(cacheKey, SESSION_INVALID_SENTINEL_, 30);
    return err_(ERROR_CODES.FORBIDDEN, 'บัญชีผู้ใช้นี้ถูกปิดใช้งานหรือไม่พบในระบบ');
  }

  try {
    updateRecord_(SHEET_NAMES.SESSIONS, session._rowIndex, { LastActiveAt: now.toISOString() });
  } catch (e) {
    Logger.log('[validateSession] อัปเดต LastActiveAt ไม่สำเร็จ (ไม่ critical): ' + e.message);
  }

  var sanitized = sanitizeUserForClient_(userRecord);
  cache.put(cacheKey, JSON.stringify(sanitized), SESSION_CACHE_TTL_SECONDS_);
  return ok_(sanitized);
}

/* ============================================================
 * Logout
 * ============================================================ */

/**
 * ออกจากระบบ — action: auth.logout (ออกแบบให้ "แทบไม่มีวันล้มเหลว" แม้ token จะหมดอายุ/ไม่ถูกต้องไปแล้วก็ตาม)
 * @param {string} token
 * @return {{ok: boolean, data: Object}}
 */
function logout(token) {
  if (!isNonEmptyString_(token)) {
    return ok_({});
  }
  CacheService.getScriptCache().remove('session_' + token);
  var session = findRecordByKey_(SHEET_NAMES.SESSIONS, 'Token', token);
  if (session) {
    deleteRow_(SHEET_NAMES.SESSIONS, session._rowIndex);
    logAudit_(session.UserId, 'auth.logout', 'User', session.UserId, {});
  }
  return ok_({});
}

/**
 * เพิกถอน session ทั้งหมดของผู้ใช้คนหนึ่ง (บังคับ login ใหม่) — เรียกหลัง resetPassword หรือปิดใช้งานบัญชี
 * @param {string} userId
 * @return {number} จำนวน session ที่ถูกลบ
 */
function revokeAllSessionsForUser_(userId) {
  var matches = findRecords_(SHEET_NAMES.SESSIONS, function (r) { return String(r.UserId) === String(userId); });
  if (matches.length === 0) return 0;
  var cache = CacheService.getScriptCache();
  matches.forEach(function (s) { cache.remove('session_' + s.Token); });
  return deleteRecordsWhere_(SHEET_NAMES.SESSIONS, function (r) { return String(r.UserId) === String(userId); });
}

/* ============================================================
 * getCurrentUser — action: auth.me (requireAuth: true, ดังนั้น user ถูก resolve มาจาก Router แล้ว)
 * ============================================================ */

/**
 * @param {Object} user user object (camelCase) ที่ requireUser_ resolve มาให้แล้ว
 * @return {{ok: boolean, data: Object}}
 */
function getCurrentUser(user) {
  return ok_({ user: user });
}

/* ============================================================
 * แปลง record ดิบจาก Users sheet → รูปแบบปลอดภัยสำหรับส่งให้ client (ตัด PasswordHash, mask CID เต็ม)
 * ============================================================ */

/**
 * @param {Object} userRecord แถวดิบจาก Users sheet (มี _rowIndex ติดมาด้วยได้ ไม่เป็นไร จะไม่ถูกส่งออก)
 * @return {{userId: string, role: string, name: string, username: string, cidMasked: string, phone: string, lineUserId: string, active: boolean}}
 */
function sanitizeUserForClient_(userRecord) {
  return {
    userId: userRecord.UserId,
    role: userRecord.Role,
    name: userRecord.Name,
    username: userRecord.Username || '',
    cidMasked: userRecord.CID ? maskCid_(String(userRecord.CID)) : '',
    phone: userRecord.Phone || '',
    lineUserId: userRecord.LineUserId || '',
    active: coerceBoolean_(userRecord.Active)
  };
}
