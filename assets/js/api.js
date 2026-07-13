/**
 * api.js
 * ทางเดียวที่ทุกโมดูล frontend ใช้ยิง action ไปยัง Google Apps Script Web App ตาม BLUEPRINT.md §9
 *
 * - POST เสมอ + Content-Type: text/plain;charset=utf-8 (ไม่ใช่ application/json)
 *   เพื่อกัน CORS preflight (OPTIONS) เพราะ Apps Script Web App ตอบ OPTIONS ไม่ได้
 * - ห้ามใช้ google.script.run — ไฟล์นี้ใช้ fetch() ล้วน ๆ ตามสถาปัตยกรรมที่แยก frontend ออกจาก Apps Script
 * - แนบ token จาก storage.js อัตโนมัติทุกครั้ง (เว้นแต่ระบุ { skipAuth: true } เช่นตอน auth.login)
 * - แปลง error envelope { ok:false, code, message } → ApiError โยนออกไปให้ผู้เรียกจัดการเอง
 * - ถ้า code เป็น ERR_SESSION_EXPIRED/ERR_AUTH_REQUIRED → เคลียร์ session แล้วเด้งไป login.html ทันที (token expiry)
 */
import { API_BASE_URL } from './config.js';
import { getToken, clearSession } from './storage.js';

const REQUEST_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  /**
   * @param {string} code ค่าจาก ERROR_CODES ฝั่ง backend เช่น 'ERR_VALIDATION'
   * @param {string} message ข้อความภาษาไทยสำหรับผู้ใช้
   * @param {Object=} data ข้อมูลเสริม เช่น { fields: {...} } กรณี ERR_VALIDATION
   */
  constructor(code, message, data) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.data = data;
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * @param {string} action เช่น 'auth.login', 'patients.list'
 * @param {Object=} payload
 * @param {{skipAuth?: boolean}=} options skipAuth=true ไม่แนบ token (ใช้กับ auth.login/auth.validateSession)
 * @return {Promise<Object>} data ของ response เมื่อสำเร็จ (ok:true)
 * @throws {ApiError|NetworkError}
 */
export async function apiCall(action, payload = {}, options = {}) {
  const requestBody = {
    action,
    token: options.skipAuth ? null : getToken(),
    payload: payload || {}
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new NetworkError('การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง');
    }
    throw new NetworkError('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  } finally {
    clearTimeout(timeoutId);
  }

  let envelope;
  try {
    envelope = await response.json();
  } catch (err) {
    throw new ApiError('ERR_SERVER', 'เซิร์ฟเวอร์ตอบกลับข้อมูลที่ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
  }

  if (!envelope || envelope.ok !== true) {
    const code = (envelope && envelope.code) || 'ERR_SERVER';
    const message = (envelope && envelope.message) || 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง';

    if (code === 'ERR_SESSION_EXPIRED' || code === 'ERR_AUTH_REQUIRED') {
      clearSession();
      if (!location.pathname.endsWith('login.html')) {
        location.href = 'login.html';
      }
    }

    throw new ApiError(code, message, envelope && envelope.data);
  }

  return envelope.data;
}
