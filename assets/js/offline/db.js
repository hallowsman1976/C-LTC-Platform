/**
 * offline/db.js
 * IndexedDB wrapper สำหรับฟอร์มบันทึกการเยี่ยม (Visit Form) ตาม BLUEPRINT.md §14
 *
 * เก็บ 2 object store:
 * - visitDrafts: ร่างที่กำลังกรอกอยู่ (1 ผู้ป่วย = 1 ร่างที่ยัง active ได้ครั้งละ 1 ชุด) — อยู่ในเครื่องเท่านั้น
 *   ไม่ส่งขึ้น backend จนกว่าจะกด "บันทึกและส่ง" (การ autosave ระหว่างกรอกไปที่ visits.saveDraft เป็นแค่ best-effort สำรอง)
 * - syncQueue: ชุดข้อมูลที่กด "บันทึกและส่ง" ไปแล้วแต่ยังส่งไม่สำเร็จ (ออฟไลน์/เครือข่ายขัดข้อง) รอ sync manager ส่งซ้ำให้
 */

const DB_NAME = 'ltc_smart_care';
const DB_VERSION = 1;
const STORE_DRAFTS = 'visitDrafts';
const STORE_QUEUE = 'syncQueue';

let dbPromise = null;

/** @return {Promise<IDBDatabase>} */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        const draftStore = db.createObjectStore(STORE_DRAFTS, { keyPath: 'clientTempId' });
        draftStore.createIndex('patientId', 'patientId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'clientTempId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * @param {string} storeName
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} operation
 * @return {Promise<*>}
 */
async function runTransaction(storeName, mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ============================================================
 * visitDrafts
 * ============================================================ */

/** @param {Object} draft ต้องมี clientTempId, patientId @return {Promise<void>} */
export async function saveDraftLocal(draft) {
  draft.updatedAt = new Date().toISOString();
  await runTransaction(STORE_DRAFTS, 'readwrite', (store) => store.put(draft));
}

/** @param {string} clientTempId @return {Promise<Object|undefined>} */
export async function getDraftLocal(clientTempId) {
  return runTransaction(STORE_DRAFTS, 'readonly', (store) => store.get(clientTempId));
}

/**
 * หาร่างที่ยัง active ล่าสุดของผู้ป่วยรายนี้ (ใช้ตอนเปิดฟอร์มใหม่ เพื่อถามว่าจะกู้คืนร่างเดิมหรือเริ่มใหม่)
 * @param {string} patientId
 * @return {Promise<Object|undefined>}
 */
export async function findActiveDraftByPatient(patientId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DRAFTS, 'readonly');
    const index = tx.objectStore(STORE_DRAFTS).index('patientId');
    const request = index.getAll(IDBKeyRange.only(patientId));
    request.onsuccess = () => {
      const drafts = request.result || [];
      drafts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      resolve(drafts[0]);
    };
    request.onerror = () => reject(request.error);
  });
}

/** @param {string} clientTempId @return {Promise<void>} */
export async function deleteDraftLocal(clientTempId) {
  await runTransaction(STORE_DRAFTS, 'readwrite', (store) => store.delete(clientTempId));
}

/* ============================================================
 * syncQueue
 * ============================================================ */

/**
 * @param {{clientTempId:string, patientId:string, bundle:Object, status:string, createdAt:string, lastError:string=}} item
 * @return {Promise<void>}
 */
export async function enqueueSync(item) {
  await runTransaction(STORE_QUEUE, 'readwrite', (store) => store.put(item));
}

/** @return {Promise<Array<Object>>} เรียงจากเก่าไปใหม่ (ส่งตามลำดับเวลาเดิม ตาม BLUEPRINT.md §14) */
export async function listQueuedSync() {
  const items = await runTransaction(STORE_QUEUE, 'readonly', (store) => store.getAll());
  return (items || []).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** @param {string} clientTempId @return {Promise<void>} */
export async function removeQueuedSync(clientTempId) {
  await runTransaction(STORE_QUEUE, 'readwrite', (store) => store.delete(clientTempId));
}

/**
 * @param {string} clientTempId
 * @param {string} errorMessage
 * @return {Promise<void>}
 */
export async function markSyncFailed(clientTempId, errorMessage) {
  const item = await runTransaction(STORE_QUEUE, 'readonly', (store) => store.get(clientTempId));
  if (!item) return;
  item.status = 'failed';
  item.lastError = errorMessage;
  await enqueueSync(item);
}

/** @return {Promise<number>} จำนวนรายการที่ยังค้างอยู่ในคิว (ใช้แสดงตัวเลขแจ้งเตือนในหน้า UI) */
export async function countQueuedSync() {
  const items = await listQueuedSync();
  return items.length;
}
