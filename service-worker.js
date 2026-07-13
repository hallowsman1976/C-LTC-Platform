/**
 * service-worker.js
 * Cache app shell (HTML/CSS/JS) ให้เปิดแอปได้แม้ออฟไลน์ ตาม BLUEPRINT.md §14
 * ไม่ cache การเรียก API เด็ดขาด — ทุก action เป็น POST อยู่แล้วซึ่ง Cache API ไม่รองรับ จึงปล่อยผ่าน network ตรง ๆ เสมอ
 */

const CACHE_NAME = 'ltc-smart-care-v2';
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
