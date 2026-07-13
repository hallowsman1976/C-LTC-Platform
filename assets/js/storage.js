/**
 * storage.js
 * เก็บ session (token, expiresAt, user) ไว้ใน localStorage คีย์เดียว ตาม BLUEPRINT.md §13
 * เป็นจุดเดียวที่โมดูลอื่นเข้าถึง localStorage — ห้ามไฟล์อื่นเรียก localStorage ตรง ๆ
 */

const SESSION_STORAGE_KEY = 'ltc_session';

/**
 * @return {{token:string, expiresAt:string, user:Object}|null}
 */
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.token || !session.expiresAt) return null;
    return session;
  } catch (err) {
    return null;
  }
}

/**
 * @param {{token:string, expiresAt:string, user:Object}} session
 */
export function setSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/** @return {string|null} */
export function getToken() {
  const session = getSession();
  return session ? session.token : null;
}

/** @return {Object|null} */
export function getCurrentUser() {
  const session = getSession();
  return session ? session.user : null;
}

/**
 * @param {{expiresAt:string}|null} session
 * @return {boolean}
 */
export function isSessionExpired(session) {
  if (!session || !session.expiresAt) return true;
  const expiresAt = new Date(session.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= Date.now();
}

/** ตรวจ session ฝั่ง client แบบเร็ว (ไม่ยิง network) — ถ้าหมดอายุแล้วจะเคลียร์ทิ้งให้ทันที */
export function hasValidSession() {
  const session = getSession();
  if (!session) return false;
  if (isSessionExpired(session)) {
    clearSession();
    return false;
  }
  return true;
}
