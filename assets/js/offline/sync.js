/**
 * offline/sync.js
 * Sync Manager — ส่งรายการที่ค้างอยู่ใน syncQueue (บันทึกตอนออฟไลน์/เครือข่ายขัดข้อง) ซ้ำเรียงตามลำดับเวลาเดิม
 * ทริกเกอร์ตอน network กลับมาออนไลน์ + วนทุก 60 วินาที ตาม BLUEPRINT.md §14
 */
import { listQueuedSync, removeQueuedSync, markSyncFailed } from './db.js';
import { submitVisitBundle } from './visit-submit.js';
import { showToast } from '../ui.js';
import { ApiError, NetworkError } from '../api.js';

const RETRY_INTERVAL_MS = 60000;
let syncInProgress = false;
let intervalHandle = null;

/** ส่งรายการที่ค้างอยู่ในคิวทั้งหมด เรียงจากเก่าสุดก่อน — หยุดรายการนั้นไว้ (ไม่ลบออกจากคิว) ถ้าเป็น network error เพื่อลองใหม่รอบถัดไป */
export async function drainSyncQueue() {
  if (syncInProgress) return;
  if (!navigator.onLine) return;

  syncInProgress = true;
  try {
    const items = await listQueuedSync();
    for (const item of items) {
      try {
        await submitVisitBundle(item.bundle);
        await removeQueuedSync(item.clientTempId);
        showToast(`ซิงค์ข้อมูลการเยี่ยมที่ค้างอยู่สำเร็จแล้ว (${item.patientId})`, 'success');
      } catch (err) {
        if (err instanceof NetworkError) {
          // เครือข่ายยังมีปัญหา — เก็บไว้ในคิวเหมือนเดิม หยุดลูป รอรอบถัดไป (ไม่ไล่ยิงรายการที่เหลือให้ fail รัว ๆ)
          break;
        }
        if (err instanceof ApiError) {
          // error จาก validation/สิทธิ์ (4xx) — retry ต่อไปก็ไม่มีทางสำเร็จ ต้องให้ผู้ใช้แก้ไขเอง จึงทำเครื่องหมาย failed ไว้แทนการลบทิ้ง
          await markSyncFailed(item.clientTempId, err.message);
          showToast(`ซิงค์ข้อมูลการเยี่ยมของผู้ป่วย ${item.patientId} ไม่สำเร็จ: ${err.message}`, 'error');
        } else {
          await markSyncFailed(item.clientTempId, 'เกิดข้อผิดพลาดที่ไม่คาดคิด');
        }
      }
    }
  } finally {
    syncInProgress = false;
  }
}

/** เริ่มระบบ sync อัตโนมัติ — เรียกครั้งเดียวตอนแอปเริ่มทำงาน (จาก router.js) */
export function initSyncManager() {
  if (intervalHandle) return;
  window.addEventListener('online', () => { drainSyncQueue(); });
  intervalHandle = setInterval(() => { drainSyncQueue(); }, RETRY_INTERVAL_MS);
  drainSyncQueue();
}
