/**
 * offline/sync.js
 * Sync Manager — ส่งรายการที่ค้างอยู่ใน syncQueue (บันทึกตอนออฟไลน์/เครือข่ายขัดข้อง) ซ้ำเรียงตามลำดับเวลาเดิม
 * ทริกเกอร์ตอน network กลับมาออนไลน์ + วนทุก 60 วินาที ตาม BLUEPRINT.md §14
 *
 * ในคิวมีสองชนิดปนกันอยู่ แยกด้วยฟิลด์ item.kind:
 * - 'assessment' → แบบประเมินเดี่ยวจากหน้า /assessments (ยิง action เดียวจบ)
 * - นอกนั้นทั้งหมด → ชุดข้อมูลการเยี่ยมบ้าน (visits.submit + assessments.save* หลาย action ผ่าน submitVisitBundle)
 *   **ต้องถือว่า "ไม่มี kind" = การเยี่ยมบ้านเสมอ** เพราะรายการที่ค้างอยู่ในเครื่องผู้ใช้ตั้งแต่ก่อนเพิ่มฟิลด์นี้
 *   ไม่มี kind ติดมาด้วย ถ้าเปลี่ยนไปเช็ก kind === 'visit' ตรง ๆ ข้อมูลเก่าที่ยังไม่ได้ซิงค์จะค้างถาวร
 *
 * ทุกชนิดปลอดภัยต่อการส่งซ้ำ เพราะ payload พก requestId เดิมไปด้วยเสมอ (backend การันตี idempotency ตาม requestId)
 */
import { listQueuedSync, removeQueuedSync, markSyncFailed } from './db.js';
import { submitVisitBundle } from './visit-submit.js';
import { showToast } from '../ui.js';
import { apiCall, ApiError, NetworkError } from '../api.js';

const RETRY_INTERVAL_MS = 60000;
let syncInProgress = false;
let intervalHandle = null;

/** @param {Object} item @return {Promise<*>} */
function sendQueueItem(item) {
  if (item.kind === 'assessment') return apiCall(item.action, item.payload);
  return submitVisitBundle(item.bundle);
}

/** @param {Object} item @return {string} ข้อความเรียกรายการนี้ในภาษามนุษย์ สำหรับ toast */
function describeQueueItem(item) {
  return item.kind === 'assessment' ? `แบบประเมิน "${item.title}"` : 'ข้อมูลการเยี่ยม';
}

/** ส่งรายการที่ค้างอยู่ในคิวทั้งหมด เรียงจากเก่าสุดก่อน — หยุดรายการนั้นไว้ (ไม่ลบออกจากคิว) ถ้าเป็น network error เพื่อลองใหม่รอบถัดไป */
export async function drainSyncQueue() {
  if (syncInProgress) return;
  if (!navigator.onLine) return;

  syncInProgress = true;
  try {
    const items = await listQueuedSync();
    for (const item of items) {
      try {
        await sendQueueItem(item);
        await removeQueuedSync(item.clientTempId);
        showToast(`ซิงค์${describeQueueItem(item)}ที่ค้างอยู่สำเร็จแล้ว (${item.patientId})`, 'success');
      } catch (err) {
        if (err instanceof NetworkError) {
          // เครือข่ายยังมีปัญหา — เก็บไว้ในคิวเหมือนเดิม หยุดลูป รอรอบถัดไป (ไม่ไล่ยิงรายการที่เหลือให้ fail รัว ๆ)
          break;
        }
        if (err instanceof ApiError) {
          // error จาก validation/สิทธิ์ (4xx) — retry ต่อไปก็ไม่มีทางสำเร็จ ต้องให้ผู้ใช้แก้ไขเอง จึงทำเครื่องหมาย failed ไว้แทนการลบทิ้ง
          await markSyncFailed(item.clientTempId, err.message);
          showToast(`ซิงค์${describeQueueItem(item)}ของผู้ป่วย ${item.patientId} ไม่สำเร็จ: ${err.message}`, 'error');
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
