/**
 * auth.js
 * Login/Logout และการตรวจสถานะ session ฝั่ง client
 * source of truth ของ session คือ Sessions sheet ฝั่ง backend เสมอ — ฟังก์ชันที่ตรวจแบบ local (isAuthenticated)
 * ใช้เป็นด่านแรกของ Route Guard เท่านั้น ส่วน verifySessionRemote() ยืนยันกับ backend จริงผ่าน action auth.me
 */
import { apiCall } from './api.js';
import {
  getSession,
  setSession,
  clearSession,
  hasValidSession,
  getCurrentUser as getStoredUser
} from './storage.js';

/**
 * @param {{mode:'cg'|'staff', cid?:string, username?:string, password?:string, rememberMe?:boolean}} credentials
 * @return {Promise<Object>} user object ที่ backend คืนมา
 */
export async function login(credentials) {
  const data = await apiCall('auth.login', credentials, { skipAuth: true });
  setSession({ token: data.token, expiresAt: data.expiresAt, user: data.user });
  return data.user;
}

/** ออกจากระบบ — ต้อง "แทบไม่มีวันล้มเหลว" ฝั่ง UI แม้ backend เรียกไม่สำเร็จ (เช่น token หมดอายุไปแล้ว) */
export async function logout() {
  try {
    await apiCall('auth.logout', {});
  } catch (err) {
    // เพิกเฉย — เคลียร์ session ฝั่ง client ต่อไปเสมอ
  } finally {
    clearSession();
  }
}

/** ตรวจ session ฝั่ง client แบบเร็ว ไม่ยิง network — ใช้เป็น Route Guard เบื้องต้นก่อนเรนเดอร์แต่ละหน้า */
export function isAuthenticated() {
  return hasValidSession();
}

/** @return {Object|null} user profile ที่แคชไว้ล่าสุด (ไม่รับประกันว่า backend ยัง valid อยู่จริง) */
export function getCurrentUser() {
  return getStoredUser();
}

/**
 * ตรวจ session กับ backend จริงผ่าน auth.me — เรียกตอนโหลดแอปหรือเข้าเมนูที่สำคัญ
 * ถ้า token หมดอายุจริง apiCall() จะเคลียร์ session และเด้งไป login.html ให้อัตโนมัติอยู่แล้ว
 * @return {Promise<Object>} user profile ล่าสุดจาก backend
 */
export async function verifySessionRemote() {
  const data = await apiCall('auth.me', {});
  const current = getSession();
  if (current) {
    setSession({ ...current, user: data.user });
  }
  return data.user;
}

/**
 * @param {...string} roles
 * @return {boolean} true ถ้า user ปัจจุบันมีบทบาทตรงกับที่ระบุอย่างน้อยหนึ่งอย่าง
 */
export function hasRole(...roles) {
  const user = getStoredUser();
  return !!user && roles.includes(user.role);
}
