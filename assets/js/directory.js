/**
 * directory.js
 * ดึงรายชื่อผู้ใช้ (CG/CM) มาช่วยแสดงผล/เลือกในหน้า Assign CG/CM และหน้ารายละเอียดผู้ป่วย
 *
 * ข้อจำกัดสำคัญที่ต้องรู้: action 'admin.users.list' ฝั่ง backend (ดู Router.gs) อนุญาตเฉพาะ role ADMIN เท่านั้น
 * ดังนั้นฟังก์ชันในไฟล์นี้จะคืนค่าว่างทันทีถ้าผู้ใช้ปัจจุบันไม่ใช่ ADMIN — ไม่ยิง request ไปให้โดนปฏิเสธเปล่า ๆ
 * (หน้าจอที่เรียกใช้ไฟล์นี้ต้องออกแบบ UI สำรองสำหรับ CM เอง เช่น ให้กรอกรหัสผู้ใช้ตรง ๆ แทน dropdown)
 */
import { apiCall } from './api.js';
import { hasRole } from './auth.js';

let cachedUsersById = null;

/**
 * โหลดผู้ใช้ทั้งหมด (สูงสุด 100 รายการ) มาเก็บเป็น map userId → user แคชไว้ในหน่วยความจำระหว่างเซสชันนี้
 * @return {Promise<Object>} map ว่างเปล่าถ้าไม่ใช่ ADMIN
 */
export async function getUserDirectoryMap() {
  if (!hasRole('ADMIN')) return {};
  if (cachedUsersById) return cachedUsersById;

  const data = await apiCall('admin.users.list', { pageSize: 100 });
  cachedUsersById = {};
  data.items.forEach((user) => {
    cachedUsersById[user.userId] = user;
  });
  return cachedUsersById;
}

/**
 * ดึงรายชื่อผู้ใช้ตามบทบาท (เฉพาะที่ Active) — ใช้ประกอบ dropdown มอบหมายทีมดูแล
 * @param {'CG'|'CM'} role
 * @return {Promise<Array<Object>>} array ว่างถ้าไม่ใช่ ADMIN
 */
export async function getUsersByRole(role) {
  if (!hasRole('ADMIN')) return [];
  const data = await apiCall('admin.users.list', { role, pageSize: 100 });
  return data.items.filter((user) => user.active);
}

/** ล้างแคชผู้ใช้ (เรียกหลังสร้าง/แก้ไขผู้ใช้ ถ้ามีหน้าจัดการผู้ใช้ในเฟสถัดไป) */
export function invalidateUserDirectoryCache() {
  cachedUsersById = null;
}
