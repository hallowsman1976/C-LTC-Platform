/**
 * screens/admin/hub.js
 * หน้ารวมเมนูผู้ดูแลระบบ (/admin) ตาม BLUEPRINT.md §4 — ADMIN เท่านั้น (บังคับที่ router.js อีกชั้น)
 *
 * ทำไมไม่มี /admin/config ตามที่ sitemap เขียนไว้: BLUEPRINT §9 ระบุ action admin.config.get/set ไว้จริง
 * แต่ Router.gs ยังไม่มี action นั้นให้เรียก (ไม่เคย implement) — ทำหน้านี้ไปก็ยิงอะไรไม่ได้ จึงเว้นไว้ก่อน
 * ส่วน /admin/patients ใช้หน้า /patients เดิมได้เลย (patients.list/update รองรับ ADMIN อยู่แล้ว) จึงลิงก์ไปที่นั่นแทน
 */
import { escapeHtml } from '../../ui.js';

const ADMIN_SECTIONS = [
  { href: '#/admin/users', title: 'จัดการผู้ใช้', desc: 'สร้าง/แก้ไขบัญชี กำหนดบทบาท เปิด-ปิดการใช้งาน และรีเซ็ตรหัสผ่าน' },
  { href: '#/admin/audit-log', title: 'Audit Log', desc: 'ประวัติการกระทำทั้งหมดในระบบ ค้นหาตามผู้ใช้/การกระทำ/ช่วงเวลา' },
  { href: '#/admin/notifications', title: 'การแจ้งเตือน', desc: 'สถานะการส่งแจ้งเตือน LINE ทั้งหมด รวมรายการที่ส่งไม่สำเร็จ' },
  { href: '#/patients', title: 'ข้อมูลผู้ป่วย', desc: 'จัดการข้อมูลหลักของผู้ป่วย (ใช้หน้าผู้ป่วยเดิม)' }
];

/** @param {HTMLElement} content */
export async function renderAdminHub(content) {
  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl">
      <h1 class="text-lg font-bold text-slate-800 mb-1">ผู้ดูแลระบบ</h1>
      <p class="text-xs text-slate-400 mb-4">เมนูสำหรับ ADMIN เท่านั้น</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${ADMIN_SECTIONS.map((s) => `
          <a href="${escapeHtml(s.href)}" class="block bg-white rounded-2xl shadow-sm p-4 active:bg-slate-50">
            <p class="text-sm font-semibold text-slate-800">${escapeHtml(s.title)}</p>
            <p class="text-xs text-slate-400 mt-1">${escapeHtml(s.desc)}</p>
          </a>
        `).join('')}
      </div>
    </div>
  `;
}
