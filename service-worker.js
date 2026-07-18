/**
 * service-worker.js
 * Cache app shell (HTML/CSS/JS) ให้เปิดแอปได้แม้ออฟไลน์ ตาม BLUEPRINT.md §14
 * ไม่ cache การเรียก API เด็ดขาด — ทุก action เป็น POST อยู่แล้วซึ่ง Cache API ไม่รองรับ จึงปล่อยผ่าน network ตรง ๆ เสมอ
 */

// ต้องบัมพ์เลขนี้ทุกครั้งที่แก้ไฟล์ใน app shell — activate จะลบ cache ชื่อเก่าทิ้งแล้วโหลดใหม่ทั้งชุด
// ถ้าไม่บัมพ์ ผู้ใช้เดิมจะได้ไฟล์เก่าค้างตลอดไป เพราะ fetch handler เป็น cache-first (เจอใน cache แล้วไม่ยิง network เลย)
// v8: สร้าง INHOMESSS ฉบับเต็มตามแบบฟอร์มจริง (9 มิติ รายฟิลด์) แทนแบบ toggle เดิม → constants.js/form-widgets.js/assessment-form.js/assessment-detail.js/visit-form-steps.js/visit-form.js เปลี่ยน + ไฟล์ใหม่ inhomesss-form.js
// v9: soft-shadow/gradient design pass — app.css ดีไซน์ระบบใหม่ทั้งชุด + ui.js (breadcrumb, skeleton/empty state) เปลี่ยน
// v10: ui.js เพิ่ม real-time field validation (setFieldState/wireFieldValidation) — patient-form.js ใช้
// v11: floating label (app.css) + renderPagination เพิ่ม page-size selector (ui.js) + drag-drop dropzone (visit-form-steps.js)
// v12: floating label ขยายไปฟอร์มเยี่ยมบ้าน (visit-form-steps.js textField) + ฟอร์มผู้ใช้ ADMIN (admin/users.js)
// v13: form-widgets.js ปุ่มเลือก (segmented/yesno/single/chip) ไล่สี gradient + inhomesss progress bar +
// confirmDialog/promptDialog (ui.js) ไล่สี + CSV import (admin/patients-import.js) รองรับลากไฟล์วาง
// v14: แก้ไอคอนใหญ่ผิดปกติ — w-4.5/h-4.5 ไม่มีอยู่จริงใน Tailwind scale (ข้ามจาก 4 ไป 5) ทำให้ไม่มี CSS
// กำกับขนาด เปลี่ยนเป็น w-[18px] h-[18px] แทน (login.html, patients-list.js, visit-form.js)
// v15: หน้าใหม่ CG.2 (รายงานเยี่ยมบ้านผู้ป่วยและผู้สูงอายุ) — ไฟล์ใหม่ screens/cg2-log.js + route ใน router.js +
// ปุ่มเปิดจาก patient-detail.js + ตัวเลือก/badge ใหม่ใน constants.js
const CACHE_NAME = 'ltc-smart-care-v15';
const APP_SHELL_FILES = [
  './',
  './index.html',
  './login.html',
  './manifest.json',
  './assets/css/app.css',
  './assets/js/config.js',
  './assets/js/api.js',
  './assets/js/auth.js',
  './assets/js/router.js',
  './assets/js/storage.js',
  './assets/js/validation.js',
  './assets/js/ui.js',
  './assets/illustrations/hero-caregiving.svg',
  './assets/illustrations/dashboard-hero.svg',
  './assets/illustrations/empty-state.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // ปล่อยผ่าน POST (การเรียก API ทั้งหมดของระบบ) ไปยัง network ตรง ๆ เสมอ ไม่ยุ่งเกี่ยว
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && new URL(request.url).origin === location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        });
    })
  );
});
