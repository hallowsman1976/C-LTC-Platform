/**
 * Code.gs
 * จุดเริ่มต้นเดียวของ Web App — doGet (health check) และ doPost (JSON API หลัก)
 * แทนที่ doGet เดิมใน รหัส.js ที่เคย serve HTML ตรง ๆ (prototype ก่อนหน้า)
 *
 * ออกแบบตาม BLUEPRINT.md §2 (ข้อจำกัดทางเทคนิค) และ §9 (API Contract):
 *
 * - frontend (GitHub Pages) เรียกด้วย fetch() ธรรมดา ไม่ใช้ google.script.run (คนละ origin กัน ใช้ไม่ได้อยู่แล้ว)
 * - ทุก request ที่มี body ต้องเป็น POST ด้วย Content-Type: text/plain;charset=utf-8 (ห้ามใช้ application/json ตรง ๆ)
 *   เพราะ text/plain ถือเป็น "simple request" ตาม CORS spec จึง "ไม่ trigger" OPTIONS preflight —
 *   Apps Script Web App ไม่มี doOptions() ให้ตอบ preflight ได้ ถ้าโดน preflight มาจริงจะพังทันที
 * - ฝั่ง Apps Script อ่าน body ดิบจาก e.postData.contents แล้ว JSON.parse() เอาเอง (ดู parseRequestBody_)
 * - ทุก action ส่งผ่าน field เดียว { action, token, payload } แล้ว routeAction_() (Router.gs) เป็นคนกระจายงานต่อ
 * - response ทุกอันเป็น JSON เดียวกันหมด { ok, data } หรือ { ok, code, message } (Response.gs)
 * - deployment ที่ access = ANYONE_ANONYMOUS จะได้ Access-Control-Allow-Origin: * มาจากแพลตฟอร์มของ Google เองอัตโนมัติ
 *   (ไม่ต้อง/ไม่สามารถตั้ง response header เองใน ContentService ได้)
 */

/**
 * GET request — ใช้เป็น health check เร็ว ๆ ว่า deployment ใช้งานได้ (เปิด URL ตรง ๆ ในเบราว์เซอร์ก็เห็นผลได้เลย)
 * ไม่ใช้สำหรับ business logic ใด ๆ — ทุก action จริงต้องผ่าน doPost เท่านั้น
 * @param {Object} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  try {
    return jsonOutput_(ok_({
      service: 'LTC Smart Care API',
      version: getConfig_(CONFIG_KEYS.APP_VERSION, SYSTEM_VERSION_),
      time: new Date().toISOString()
    }));
  } catch (err) {
    return jsonOutput_(errFromException_(err, ERROR_CODES.SERVER));
  }
}

/**
 * POST request — ทางเข้าเดียวของทุก action ในระบบ (auth.*, admin.users.* ฯลฯ)
 * @param {Object} e event ของ doPost — ต้องมี e.postData.contents เป็น JSON string
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    var body = parseRequestBody_(e);

    if (!isNonEmptyString_(body.action)) {
      return jsonOutput_(err_(ERROR_CODES.VALIDATION, 'ไม่พบ action ที่ต้องการเรียกใช้งาน'));
    }

    var result = routeAction_(body.action, body.token || null, body.payload || {}, e);
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_(errFromException_(err, ERROR_CODES.SERVER));
  }
}

/**
 * แกะ JSON ออกจาก request body ดิบ — client ต้องส่งเป็น POST + Content-Type: text/plain;charset=utf-8
 * แล้วฝัง JSON.stringify({action, token, payload}) เป็น body ตรง ๆ (ไม่ใช่ form fields)
 * @param {Object} e
 * @return {{action: string, token: (string|null), payload: Object}}
 */
function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('ไม่พบข้อมูล request body');
  }
  var parsed;
  try {
    parsed = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    throw new Error('รูปแบบ JSON ของ request body ไม่ถูกต้อง');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('รูปแบบ request body ไม่ถูกต้อง (ต้องเป็น JSON object)');
  }
  return parsed;
}
