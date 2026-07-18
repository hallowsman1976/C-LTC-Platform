/**
 * form-widgets.js
 * ชิ้นส่วน UI ที่ใช้ซ้ำระหว่างฟอร์มเยี่ยมบ้าน (screens/visit-form-steps.js) และหน้าแบบประเมิน (screens/assessment-form.js)
 * — แบบประเมินชุดเดียวกัน (Barthel/FallRisk/CaregiverBurden/INHOMESSS/2Q/9Q/8Q) ถูกกรอกได้จากสองทาง คือ
 * ระหว่างเยี่ยมบ้าน (แนบ visitId) และแบบเดี่ยวจากเมนูแบบประเมิน (ไม่มี visitId) จึงต้องหน้าตาเหมือนกันเป๊ะ
 *
 * รูปแบบการใช้งาน: ฟังก์ชัน build* คืน HTML string (ผู้เรียกเอาไปประกอบใน innerHTML) แล้วค่อยเรียก wire* ผูก event
 * ทีหลังโดยอ้างอิงผ่าน data-attribute — แยกกันเพื่อให้ประกอบ HTML ทั้งหน้าได้ในทีเดียวก่อนค่อยผูก event รอบเดียว
 */
import { escapeHtml } from './ui.js';

export function card(innerHtml, extraClass = '') {
  return `<div class="flat-card bg-white rounded-2xl p-4 mb-3 ${extraClass}">${innerHtml}</div>`;
}

export function sectionTitle(text) {
  return `<p class="text-sm font-semibold text-slate-700 mb-3">${escapeHtml(text)}</p>`;
}

/** แถบเลือกตัวเลข 0..max แบบปุ่ม (ใช้กับ Barthel, 9Q และ Stage แผล) */
export function segmentedChoice({ name, options, selectedValue }) {
  return `
    <div class="flex flex-wrap gap-2" data-segmented="${escapeHtml(name)}">
      ${options.map((opt) => `
        <button type="button" data-seg-value="${escapeHtml(String(opt.v))}"
          class="px-3 py-2 rounded-xl border text-xs font-medium transition-all ${String(selectedValue) === String(opt.v) ? 'accent-gradient border-transparent text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50/50'}">
          ${escapeHtml(opt.l)}
        </button>
      `).join('')}
    </div>
  `;
}

/**
 * ปุ่ม ใช่/ไม่ใช่ สองปุ่ม — ใช้กับข้อคำถามแบบ boolean ทุกจุด (FallRisk/CaregiverBurden/INHOMESSS/2Q/8Q)
 * สีแดง/เขียวตั้งใจคงไว้ (ไม่ใช่แค่สี accent ทั่วไป) เพราะสื่อความหมายทางคลินิกจริง — คำถามกลุ่มนี้ "ใช่" มักแปลว่า
 * พบปัญหา/ความเสี่ยง (จึงเป็นสีแดง) และ "ไม่ใช่" มักแปลว่าปกติ (จึงเป็นสีเขียว) เปลี่ยนเป็นไล่สีเข้มขึ้นเพื่อความ
 * มีมิติ (soft-shadow pass) แต่ยังคงโทนสีเดิมไว้ ไม่ใช้ accent-gradient (จะทำให้ผู้ใช้อ่านความหมายผิดได้)
 */
export function yesNoToggle({ name, value, yesLabel = 'ใช่', noLabel = 'ไม่ใช่' }) {
  return `
    <div class="flex gap-2" data-yesno="${escapeHtml(name)}">
      <button type="button" data-yesno-value="true" class="flex-1 py-2 rounded-xl border text-xs font-medium transition-all ${value === true ? 'bg-gradient-to-br from-rose-500 to-rose-600 border-transparent text-white shadow-[0_4px_12px_-2px_rgba(225,29,72,0.35)]' : 'bg-white border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50/50'}">${escapeHtml(yesLabel)}</button>
      <button type="button" data-yesno-value="false" class="flex-1 py-2 rounded-xl border text-xs font-medium transition-all ${value === false ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-transparent text-white shadow-[0_4px_12px_-2px_rgba(5,150,105,0.35)]' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/50'}">${escapeHtml(noLabel)}</button>
    </div>
  `;
}

/**
 * เลือกได้ตัวเดียวจาก string enum — ต่างจาก segmentedChoice ตรงที่ wireSingleChoice คืนค่าเป็น string ตรง ๆ
 * ไม่ coerce เป็น Number() (segmentedChoice ใช้กับตัวเลือกตัวเลขอย่าง Barthel/9Q เท่านั้น)
 */
export function singleChoice({ name, options, selectedValue }) {
  return `
    <div class="flex flex-wrap gap-2" data-single="${escapeHtml(name)}">
      ${options.map((opt) => `
        <button type="button" data-single-value="${escapeHtml(opt)}"
          class="px-3 py-2 rounded-xl border text-xs font-medium transition-all ${selectedValue === opt ? 'accent-gradient border-transparent text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50/50'}">
          ${escapeHtml(opt)}
        </button>
      `).join('')}
    </div>
  `;
}

export function wireSingleChoice(container, name, onSelect) {
  const group = container.querySelector(`[data-single="${cssId(name)}"]`);
  if (!group) return;
  group.querySelectorAll('[data-single-value]').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.singleValue));
  });
}

export function chipMultiSelect({ name, options, selectedValues }) {
  return `
    <div class="flex flex-wrap gap-2" data-chips="${escapeHtml(name)}">
      ${options.map((opt) => `
        <button type="button" data-chip-value="${escapeHtml(opt)}"
          class="px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${(selectedValues || []).includes(opt) ? 'accent-gradient border-transparent text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50/50'}">
          ${escapeHtml(opt)}
        </button>
      `).join('')}
    </div>
  `;
}

export function wireSegmented(container, name, onSelect) {
  const group = container.querySelector(`[data-segmented="${cssId(name)}"]`);
  if (!group) return;
  group.querySelectorAll('[data-seg-value]').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(Number(btn.dataset.segValue)));
  });
}

export function wireYesNo(container, name, onSelect) {
  const group = container.querySelector(`[data-yesno="${cssId(name)}"]`);
  if (!group) return;
  group.querySelectorAll('[data-yesno-value]').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.yesnoValue === 'true'));
  });
}

export function wireChips(container, name, onToggle) {
  const group = container.querySelector(`[data-chips="${cssId(name)}"]`);
  if (!group) return;
  group.querySelectorAll('[data-chip-value]').forEach((btn) => {
    btn.addEventListener('click', () => onToggle(btn.dataset.chipValue));
  });
}

/** escape ค่าที่จะเอาไปใส่ใน attribute selector ของ querySelector (ชื่อกลุ่มมี . หรือ : ได้) */
export function cssId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function toggleArrayValue(arr, value) {
  const list = arr || [];
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** แถวคำถาม-คำตอบแบบอ่านอย่างเดียว — ใช้ในหน้าดูผลย้อนหลัง (assessment-detail.js, inhomesss-form.js) */
export function answerRow(question, answer, highlight = false) {
  return `
    <div class="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <p class="text-xs text-slate-600 min-w-0">${escapeHtml(question)}</p>
      <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${highlight ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}">
        ${escapeHtml(answer)}
      </span>
    </div>
  `;
}
