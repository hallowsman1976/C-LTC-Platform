/**
 * router.js
 * Hash-based router สำหรับ index.html (app shell หลัง login) ตาม Sitemap ใน BLUEPRINT.md §4
 * เป็น entry point ของ index.html — ผูก Route Guard, Sidebar/Bottom Nav, offline banner ให้ตอน init()
 *
 * รองรับ dynamic segment แบบ ":param" ในตาราง route (เช่น '/patients/:id/edit') และตรวจสิทธิ์ตาม role
 * ต่อหน้า (route.roles) แยกจาก Route Guard ทั่วไปที่บังคับต้อง login ก่อนเสมออยู่แล้ว
 */
import { isAuthenticated, getCurrentUser, logout, verifySessionRemote, hasRole } from './auth.js';
import { setLoading, renderErrorState, initOfflineBanner, escapeHtml, showToast } from './ui.js';
import { apiCall, ApiError, NetworkError } from './api.js';
import { roleLabel } from './constants.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderPatientsList } from './screens/patients-list.js';
import { renderPatientForm } from './screens/patient-form.js';
import { renderPatientDetail } from './screens/patient-detail.js';
import { renderCarePlan } from './screens/care-plan.js';
import { renderAssignCareTeam } from './screens/assign-care-team.js';
import { renderVisitForm } from './screens/visit-form.js';
import { renderAssessmentsHub, renderPatientAssessments } from './screens/assessments-hub.js';
import { renderAssessmentForm } from './screens/assessment-form.js';
import { renderAssessmentDetail } from './screens/assessment-detail.js';
import { renderReports } from './screens/reports.js';
import { renderMap } from './screens/map.js';
import { renderAdminHub } from './screens/admin/hub.js';
import { renderAdminUsers } from './screens/admin/users.js';
import { renderAdminAssignments } from './screens/admin/assignments.js';
import { renderAdminAuditLog } from './screens/admin/audit-log.js';
import { renderAdminNotifications } from './screens/admin/notifications.js';
import { initSyncManager } from './offline/sync.js';

const DEFAULT_ROUTE = '/dashboard';

/**
 * ตาราง route — เรียงลำดับไม่มีผลต่อความถูกต้องของการจับคู่ (matchRoute เทียบทั้งจำนวน segment และ literal segment)
 * route.render ทุกตัวมี signature เดียวกัน: (container: HTMLElement, params: Object) => Promise<void>
 * route.roles: ถ้าระบุ ต้องมี role ตรงอย่างน้อยหนึ่งค่าถึงจะเข้าหน้านั้นได้ (ไม่ระบุ = ทุก role ที่ login แล้วเข้าได้)
 */
const routeDefs = [
  { pattern: '/dashboard', title: 'หน้าหลัก', render: renderDashboard },
  { pattern: '/patients', title: 'ผู้ป่วย', render: renderPatientsList },
  { pattern: '/patients/new', title: 'เพิ่มผู้ป่วย', roles: ['ADMIN', 'CM'], render: renderPatientForm },
  { pattern: '/patients/:id/visit/new', title: 'บันทึกการเยี่ยม', roles: ['ADMIN', 'CM', 'CG'], render: renderVisitForm },
  { pattern: '/patients/:id/edit', title: 'แก้ไขผู้ป่วย', roles: ['ADMIN', 'CM'], render: renderPatientForm },
  { pattern: '/patients/:id/care-plan', title: 'Care Plan', render: renderCarePlan },
  { pattern: '/patients/:id/assign', title: 'มอบหมายทีมดูแล', roles: ['ADMIN', 'CM'], render: renderAssignCareTeam },
  { pattern: '/patients/:id', title: 'รายละเอียดผู้ป่วย', render: renderPatientDetail },
  { pattern: '/assessments', title: 'แบบประเมิน', render: renderAssessmentsHub },
  { pattern: '/assessments/:patientId', title: 'แบบประเมินของผู้ป่วย', render: renderPatientAssessments },
  // VIEWER ดูประวัติได้แต่บันทึกไม่ได้ — ตรงกับ resolveAssessmentContext_ ฝั่ง backend ที่ปฏิเสธ VIEWER
  { pattern: '/assessments/:patientId/:type', title: 'บันทึกแบบประเมิน', roles: ['ADMIN', 'CM', 'CG'], render: renderAssessmentForm },
  // ดูผลย้อนหลัง (อ่านอย่างเดียว) — ไม่จำกัด role เพราะ assessments.get อนุญาต VIEWER ด้วย
  { pattern: '/assessments/:patientId/:type/:assessmentId', title: 'ผลแบบประเมิน', render: renderAssessmentDetail },
  { pattern: '/reports', title: 'รายงาน', render: renderReports },
  { pattern: '/map', title: 'แผนที่ผู้ป่วย', render: renderMap },
  { pattern: '/settings', title: 'ตั้งค่า', render: renderSettings },
  // /admin — ADMIN เท่านั้น ตรงกับ roles ของทุก action admin.* ฝั่ง backend (Router.gs)
  { pattern: '/admin', title: 'ผู้ดูแลระบบ', roles: ['ADMIN'], render: renderAdminHub },
  { pattern: '/admin/users', title: 'จัดการผู้ใช้', roles: ['ADMIN'], render: renderAdminUsers },
  { pattern: '/admin/assignments', title: 'มอบหมายทีมดูแล', roles: ['ADMIN'], render: renderAdminAssignments },
  { pattern: '/admin/audit-log', title: 'Audit Log', roles: ['ADMIN'], render: renderAdminAuditLog },
  { pattern: '/admin/notifications', title: 'การแจ้งเตือน', roles: ['ADMIN'], render: renderAdminNotifications }
];

function getContentEl() {
  return document.getElementById('app-content');
}

function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  return hash || DEFAULT_ROUTE;
}

/**
 * จับคู่ path กับ route ที่นิยามไว้ พร้อมแยก dynamic segment (":id") ออกมาเป็น params
 * @param {string} path
 * @return {{def:Object, params:Object}|null}
 */
function matchRoute(path) {
  const pathSegments = path.split('/').filter(Boolean);
  for (const def of routeDefs) {
    const patternSegments = def.pattern.split('/').filter(Boolean);
    if (patternSegments.length !== pathSegments.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const part = patternSegments[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathSegments[i]);
      } else if (part !== pathSegments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { def, params };
  }
  return null;
}

/** @param {string} path @return {string} top-level segment ('/patients/P-001/edit' → '/patients') ใช้ไฮไลต์เมนู */
function topLevelPath(path) {
  const first = path.split('/').filter(Boolean)[0];
  return first ? '/' + first : DEFAULT_ROUTE;
}

function setActiveNav(topPath) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    const isActive = el.getAttribute('data-route') === topPath;
    el.classList.toggle('text-sky-600', isActive);
    el.classList.toggle('bg-sky-50', isActive);
    el.classList.toggle('text-slate-400', !isActive);
  });
}

function renderForbidden(content) {
  content.innerHTML = `
    <div class="flex flex-col items-center justify-center text-center py-20 px-6">
      <div class="text-4xl mb-3">🔒</div>
      <h2 class="text-lg font-semibold text-slate-700 mb-1">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
      <p class="text-slate-500 text-sm">บทบาทของคุณไม่ได้รับอนุญาตให้ใช้งานส่วนนี้</p>
    </div>
  `;
}

/**
 * จับคู่ path ปัจจุบันกับ route table, บังคับ Route Guard + Role Guard, แล้วเรนเดอร์เนื้อหา
 */
async function renderRoute() {
  if (!isAuthenticated()) {
    location.href = 'login.html';
    return;
  }

  const path = currentPath();
  const match = matchRoute(path);
  const content = getContentEl();
  if (!content) return;

  if (!match) {
    location.hash = DEFAULT_ROUTE;
    return;
  }

  const { def, params } = match;
  setActiveNav(topLevelPath(path));
  document.title = `${def.title} · LTC Smart Care`;

  if (def.roles && !hasRole(...def.roles)) {
    renderForbidden(content);
    return;
  }

  setLoading(true);
  try {
    await def.render(content, params);
  } catch (err) {
    if (err instanceof ApiError || err instanceof NetworkError) {
      renderErrorState(content, err.message, renderRoute);
    } else {
      renderErrorState(content, 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง', renderRoute);
    }
  } finally {
    setLoading(false);
  }
}

/** @param {HTMLElement} content */
async function renderSettings(content) {
  const user = getCurrentUser();
  content.innerHTML = `
    <div class="px-4 py-5 max-w-md">
      <h1 class="text-lg font-bold text-slate-800 mb-4">ตั้งค่า</h1>
      <div class="bg-white rounded-2xl shadow-sm p-4 mb-3 space-y-2 text-sm">
        <div class="flex justify-between"><span class="text-slate-400">ชื่อ</span><span class="text-slate-700 font-medium">${escapeHtml(user ? user.name : '-')}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">บทบาท</span><span class="text-slate-700 font-medium">${escapeHtml(roleLabel(user && user.role))}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">ชื่อผู้ใช้</span><span class="text-slate-700 font-medium">${escapeHtml((user && user.username) || '-')}</span></div>
      </div>

      ${hasRole('ADMIN') ? `
        <a href="#/admin" class="block bg-white rounded-2xl shadow-sm p-4 mb-3 active:bg-slate-50">
          <p class="text-sm font-semibold text-slate-800">ผู้ดูแลระบบ</p>
          <p class="text-xs text-slate-400 mt-0.5">จัดการผู้ใช้ · Audit Log · การแจ้งเตือน</p>
        </a>
      ` : ''}

      <form id="line-id-form" class="bg-white rounded-2xl shadow-sm p-4 mb-3 space-y-3">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">ผูก LINE User ID (รับการแจ้งเตือนความเสี่ยง/นัดหมาย)</label>
          <input id="line-id-input" type="text" value="${escapeHtml((user && user.lineUserId) || '')}" placeholder="เช่น U1234567890abcdef1234567890abcdef"
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <p class="text-xs text-slate-400 mt-1">หา LINE User ID ได้จากแอด LINE Official Account ของหน่วยงานแล้วขอรหัสจากผู้ดูแลระบบ</p>
        </div>
        <button id="line-id-save-btn" type="submit" class="w-full py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium">บันทึก LINE ID</button>
      </form>

      <button id="logout-btn" type="button" class="w-full py-3 rounded-xl bg-rose-600 text-white font-medium text-sm">ออกจากระบบ</button>
    </div>
  `;

  const lineIdForm = content.querySelector('#line-id-form');
  lineIdForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = content.querySelector('#line-id-input');
    const saveBtn = content.querySelector('#line-id-save-btn');
    saveBtn.disabled = true;
    try {
      await apiCall('users.updateLineId', { lineUserId: input.value.trim() });
      showToast('บันทึก LINE ID สำเร็จ', 'success');
    } catch (err) {
      showToast(err && err.message ? err.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  const btn = content.querySelector('#logout-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      setLoading(true);
      await logout();
      setLoading(false);
      location.href = 'login.html';
    });
  }
}

/** เติมชื่อ/บทบาท/ปุ่ม logout ใน sidebar (desktop) ครั้งเดียวตอนเริ่มแอป */
function renderSidebarUser() {
  const el = document.getElementById('sidebar-user');
  const user = getCurrentUser();
  if (!el || !user) return;

  // เมนู ADMIN ใน index.html ตั้ง class="hidden" ไว้ตายตัว เปิดที่นี่เฉพาะ ADMIN
  // (เป็นแค่การซ่อน UI ไม่ใช่การกันสิทธิ์ — ตัวกันจริงคือ roles ใน routeDefs + roles ฝั่ง backend)
  const adminNav = document.getElementById('nav-admin');
  if (adminNav && hasRole('ADMIN')) {
    adminNav.classList.remove('hidden');
    adminNav.classList.add('flex');
  }

  el.innerHTML = `
    <p class="text-sm font-medium text-slate-700 truncate">${escapeHtml(user.name)}</p>
    <p class="text-xs text-slate-400 mb-2">${escapeHtml(roleLabel(user.role))}</p>
    <button id="sidebar-logout-btn" type="button" class="text-xs font-medium text-rose-600 hover:underline">ออกจากระบบ</button>
  `;

  const btn = el.querySelector('#sidebar-logout-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      setLoading(true);
      await logout();
      setLoading(false);
      location.href = 'login.html';
    });
  }
}

function init() {
  initOfflineBanner();

  if (!isAuthenticated()) {
    location.href = 'login.html';
    return;
  }

  renderSidebarUser();
  verifySessionRemote().catch(() => {
    // apiCall() จัดการ session expired (เคลียร์ + เด้ง login.html) ให้แล้วถ้าเกิดจริง — error อื่นไม่บล็อกการใช้งานต่อ
  });
  initSyncManager();

  window.addEventListener('hashchange', renderRoute);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', renderRoute);
  } else {
    renderRoute();
  }
}

init();
