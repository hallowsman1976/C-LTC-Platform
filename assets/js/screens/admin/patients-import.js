/**
 * screens/admin/patients-import.js
 * นำเข้าผู้ป่วยหลายรายพร้อมกันจากไฟล์ CSV (/admin/patients-import) — ADMIN เท่านั้น
 *
 * ไม่รวมมอบหมายทีมดูแล (CG/CM) — ตั้งใจตัดออกจากขอบเขตนี้ ทำที่หน้า "มอบหมายทีมดูแล" (admin/assignments.js)
 * แยกต่างหากหลังนำเข้าแล้ว เพื่อให้การตรวจสอบแถวที่นำเข้าจำกัดอยู่แค่ข้อมูลหลักผู้ป่วยตาม PATIENT_REQUIRED_FIELDS_
 *
 * หัวข้อคอลัมน์ในไฟล์ (IMPORT_COLUMNS) ต้องตรงกับ payload ของ patients.import (key ตรงกับ createPatient/
 * importPatients ฝั่ง Patients.gs เป๊ะ) การตรวจสอบฝั่งนี้ (hintForRow) เป็นแค่คำเตือนก่อนกดส่งเท่านั้น
 * ตัวตัดสินจริงว่าแถวไหนผ่าน/ไม่ผ่านคือ backend (validateImportRow_) เสมอ
 */
import { apiCall, ApiError, NetworkError } from '../../api.js';
import { showToast, confirmDialog, renderBreadcrumb, escapeHtml } from '../../ui.js';
import { exportToCsv } from '../../csv-export.js';
import { parseCsv } from '../../csv-parse.js';
import { parseTypedDateToIso } from '../../date-picker.js';
import { GENDER_OPTIONS, PATIENT_STATUS_OPTIONS } from '../../constants.js';

/** ต้องตรงกับ PATIENT_IMPORT_MAX_ROWS_ ใน Patients.gs — เช็คซ้ำฝั่งนี้กันอัปโหลดไฟล์ใหญ่เกินไปโดยไม่จำเป็น */
const MAX_ROWS = 500;

/** key ต้องตรงกับ payload ของ patients.import (ไม่รวม primaryCgUserId/responsibleCmUserId — ดูหัวไฟล์) */
const IMPORT_COLUMNS = [
  { key: 'name', label: 'ชื่อ-นามสกุล', required: true },
  { key: 'hn', label: 'HN', required: true },
  { key: 'cid', label: 'เลขประจำตัวประชาชน 13 หลัก', required: true },
  { key: 'gender', label: 'เพศ (ชาย/หญิง)', required: true },
  { key: 'birthDate', label: 'วันเกิด (เช่น 16/7/2490)', required: true },
  { key: 'village', label: 'หมู่บ้าน', required: true },
  { key: 'tambon', label: 'ตำบล', required: true },
  { key: 'amphoe', label: 'อำเภอ', required: true },
  { key: 'changwat', label: 'จังหวัด', required: true },
  { key: 'status', label: 'สถานะ (ไม่บังคับ)', required: false },
  { key: 'nextVisitDate', label: 'วันนัดเยี่ยมถัดไป (ไม่บังคับ)', required: false }
];

function labelFor(key) {
  return IMPORT_COLUMNS.find((c) => c.key === key).label;
}

/** แถวตัวอย่าง 1 แถวสำหรับไฟล์ต้นแบบ — เลขบัตรประชาชนผ่าน checksum จริง (คิดขึ้นเอง ไม่ใช่เลขของใคร) */
function buildExampleRow() {
  return {
    [labelFor('name')]: 'สมชาย ใจดี',
    [labelFor('hn')]: '000123',
    [labelFor('cid')]: '1234567890121',
    [labelFor('gender')]: 'ชาย',
    [labelFor('birthDate')]: '16/7/2490',
    [labelFor('village')]: 'บ้านสวน',
    [labelFor('tambon')]: 'ในเมือง',
    [labelFor('amphoe')]: 'เมือง',
    [labelFor('changwat')]: 'ขอนแก่น',
    [labelFor('status')]: 'ยังไม่นัด',
    [labelFor('nextVisitDate')]: ''
  };
}

/**
 * แปลง 1 แถวที่ parseCsv คืนมา (คีย์ตามหัวคอลัมน์ภาษาไทยในไฟล์) → payload key ที่ patients.import ต้องการ
 * วันที่แปลงผ่าน parseTypedDateToIso รับรูปแบบเดียวกับ date picker ที่เหลือทั้งแอป ไม่บังคับพิมพ์ ISO เป๊ะ
 * @param {Object} rawRow
 * @return {Object}
 */
function mapRow(rawRow) {
  const mapped = {};
  IMPORT_COLUMNS.forEach((col) => {
    const raw = (rawRow[col.label] || '').trim();
    if (col.key === 'birthDate' || col.key === 'nextVisitDate') {
      mapped[col.key] = raw ? (parseTypedDateToIso(raw) || '') : '';
    } else {
      mapped[col.key] = raw;
    }
  });
  return mapped;
}

/**
 * คำเตือนฝั่ง client ก่อนกดส่ง — ไม่ใช่ตัวตัดสินจริง (ดูหัวไฟล์) แค่ช่วยให้เห็นแถวที่น่าจะพลาดก่อนเสียรอบ API
 * @param {Object} mapped
 * @return {string|null}
 */
function hintForRow(mapped) {
  if (!mapped.name) return 'ไม่มีชื่อ-นามสกุล';
  if (!mapped.hn) return 'ไม่มี HN';
  if (!mapped.cid) return 'ไม่มีเลขประจำตัวประชาชน';
  if (!GENDER_OPTIONS.includes(mapped.gender)) return 'เพศไม่ถูกต้อง (ต้องเป็น ชาย หรือ หญิง)';
  if (!mapped.birthDate) return 'วันเกิดว่างหรืออ่านรูปแบบไม่ออก';
  if (!mapped.village || !mapped.tambon || !mapped.amphoe || !mapped.changwat) {
    return 'ที่อยู่ไม่ครบ (หมู่บ้าน/ตำบล/อำเภอ/จังหวัด)';
  }
  if (mapped.status && !PATIENT_STATUS_OPTIONS.includes(mapped.status)) {
    return 'สถานะไม่ถูกต้อง — ระบบจะใช้ค่าเริ่มต้น "ยังไม่นัด" แทน';
  }
  return null;
}

/** @param {HTMLElement} content */
export async function renderAdminPatientsImport(content) {
  const state = { rawRows: [], mappedRows: [], submitting: false };

  content.innerHTML = `
    <div class="px-4 py-5 max-w-3xl mx-auto">
      <div id="pi-breadcrumb"></div>
      <h1 class="text-lg font-bold text-slate-800 mb-1">นำเข้าข้อมูลผู้ป่วย</h1>
      <p class="text-xs text-slate-400 mb-4">
        อัปโหลดไฟล์ CSV เพื่อเพิ่มผู้ป่วยหลายรายพร้อมกัน — ไม่รวมมอบหมายทีมดูแล (ทำที่หน้า "มอบหมายทีมดูแล" หลังนำเข้าแล้ว)
      </p>

      <div class="flat-card bg-white rounded-2xl p-4 mb-4">
        <p class="text-sm font-semibold text-slate-700 mb-2">1. ดาวน์โหลดไฟล์ต้นแบบ</p>
        <p class="text-xs text-slate-400 mb-3">กรอกข้อมูลตามหัวคอลัมน์ในไฟล์ แล้วบันทึกเป็น CSV ก่อนอัปโหลดกลับมาที่นี่</p>
        <button id="pi-download-template" type="button" class="w-full py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">
          ดาวน์โหลดไฟล์ต้นแบบ (CSV)
        </button>
      </div>

      <div class="flat-card bg-white rounded-2xl p-4 mb-4">
        <p class="text-sm font-semibold text-slate-700 mb-2">2. อัปโหลดไฟล์ที่กรอกแล้ว</p>
        <label id="pi-dropzone" class="flex flex-col items-center justify-center h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer text-slate-400 text-xs transition-colors hover:border-sky-300 hover:bg-sky-50/50">
          <svg class="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
          <span>แตะเพื่อเลือกไฟล์ CSV <span class="hidden sm:inline">หรือลากไฟล์มาวาง</span></span>
          <input type="file" accept=".csv,text/csv" class="hidden" id="pi-file-input" />
        </label>
        <p id="pi-file-name" class="text-xs text-slate-400 mt-2"></p>
      </div>

      <p id="pi-file-error" class="hidden text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-4"></p>

      <div id="pi-preview"></div>
      <div id="pi-result"></div>
    </div>
  `;

  renderBreadcrumb(content.querySelector('#pi-breadcrumb'), [
    { label: 'ผู้ดูแลระบบ', href: '#/admin' },
    { label: 'นำเข้าข้อมูลผู้ป่วย' }
  ]);

  const fileErrorEl = content.querySelector('#pi-file-error');
  const fileNameEl = content.querySelector('#pi-file-name');
  const fileInputEl = content.querySelector('#pi-file-input');
  const dropzoneEl = content.querySelector('#pi-dropzone');
  const previewEl = content.querySelector('#pi-preview');
  const resultEl = content.querySelector('#pi-result');

  function showFileError(message) {
    fileErrorEl.textContent = message;
    fileErrorEl.classList.remove('hidden');
  }

  content.querySelector('#pi-download-template').addEventListener('click', () => {
    exportToCsv('แบบฟอร์มนำเข้าข้อมูลผู้ป่วย.csv', [buildExampleRow()]);
  });

  async function processFile(file) {
    if (!file) return;

    fileErrorEl.classList.add('hidden');
    resultEl.innerHTML = '';
    previewEl.innerHTML = '';
    fileNameEl.textContent = `ไฟล์ที่เลือก: ${file.name}`;

    let text;
    try {
      text = await file.text();
    } catch (err) {
      showFileError('อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      return;
    }

    const rawRows = parseCsv(text);
    if (rawRows.length === 0) {
      showFileError('ไฟล์นี้ไม่มีข้อมูล (ต้องมีอย่างน้อย 1 แถวนอกเหนือจากหัวคอลัมน์)');
      return;
    }
    if (rawRows.length > MAX_ROWS) {
      showFileError(`ไฟล์นี้มี ${rawRows.length} แถว — นำเข้าได้สูงสุดครั้งละ ${MAX_ROWS} แถว กรุณาแบ่งไฟล์`);
      return;
    }

    const presentHeaders = Object.keys(rawRows[0]);
    const missingRequired = IMPORT_COLUMNS.filter((c) => c.required && !presentHeaders.includes(c.label));
    if (missingRequired.length > 0) {
      showFileError(`ไฟล์นี้ขาดคอลัมน์ที่จำเป็น: ${missingRequired.map((c) => c.label).join(', ')} — กรุณาใช้ไฟล์ต้นแบบ`);
      return;
    }

    state.rawRows = rawRows;
    state.mappedRows = rawRows.map(mapRow);
    renderPreview();
  }

  fileInputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    processFile(file);
  });

  // ลากไฟล์ CSV มาวาง (desktop) — เสริมจากช่องแตะเลือกไฟล์เดิม
  ['dragenter', 'dragover'].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add('border-sky-400', 'bg-sky-50');
    });
  });
  ['dragleave', 'dragend'].forEach((evt) => {
    dropzoneEl.addEventListener(evt, () => {
      dropzoneEl.classList.remove('border-sky-400', 'bg-sky-50');
    });
  });
  dropzoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove('border-sky-400', 'bg-sky-50');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv'))) {
      processFile(file);
    } else {
      showFileError('รองรับเฉพาะไฟล์ .csv เท่านั้น');
    }
  });

  function renderPreview() {
    const rows = state.mappedRows;
    const hints = rows.map(hintForRow);
    const okCount = hints.filter((h) => !h).length;
    const warnCount = rows.length - okCount;

    previewEl.innerHTML = `
      <div class="bg-sky-50 text-sky-700 text-xs rounded-xl px-3 py-2 mb-3">
        พบ ${rows.length} แถว · ดูปกติ ${okCount} แถว${warnCount > 0 ? ` · น่าจะมีปัญหา ${warnCount} แถว` : ''}
        <span class="text-sky-400">(ระบบจะตรวจซ้ำอีกครั้งตอนนำเข้าจริง)</span>
      </div>
      <div class="md:hidden">${rows.map((r, i) => mobilePreviewRowHtml(r, hints[i], i + 1)).join('')}</div>
      <div class="hidden md:block flat-card bg-white rounded-2xl overflow-hidden mb-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-100 text-xs text-slate-400 text-left">
              <th class="px-4 py-2.5 font-medium">แถว</th>
              <th class="px-4 py-2.5 font-medium">ชื่อ-นามสกุล</th>
              <th class="px-4 py-2.5 font-medium">HN</th>
              <th class="px-4 py-2.5 font-medium">เลขประจำตัวประชาชน</th>
              <th class="px-4 py-2.5 font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>${rows.map((r, i) => desktopPreviewRowHtml(r, hints[i], i + 1)).join('')}</tbody>
        </table>
      </div>
      <button id="pi-submit" type="button" class="w-full py-3 rounded-xl accent-gradient text-white font-medium text-sm disabled:opacity-50">
        นำเข้าข้อมูล ${rows.length} รายการ
      </button>
    `;

    previewEl.querySelector('#pi-submit').addEventListener('click', handleSubmit);
  }

  async function handleSubmit() {
    if (state.submitting) return;
    const confirmed = await confirmDialog(
      `ยืนยันนำเข้าผู้ป่วย ${state.mappedRows.length} รายการหรือไม่? แถวที่ข้อมูลไม่ถูกต้องจะถูกข้ามไป ระบบจะสร้างเฉพาะแถวที่ผ่านการตรวจเท่านั้น`,
      { confirmLabel: 'นำเข้าข้อมูล' }
    );
    if (!confirmed) return;

    state.submitting = true;
    const submitBtn = previewEl.querySelector('#pi-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังนำเข้า...';

    try {
      const result = await apiCall('patients.import', { rows: state.mappedRows });
      renderResult(result);
    } catch (err) {
      state.submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = `นำเข้าข้อมูล ${state.mappedRows.length} รายการ`;
      if (err instanceof NetworkError) {
        // ไม่เข้าคิว offline เหมือนฟอร์มเยี่ยมบ้าน — งานนี้เป็นงาน admin หน้าจอที่ทำตอนออนไลน์อยู่แล้วเสมอ
        showToast('คุณออฟไลน์อยู่หรือเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้งเมื่อกลับมาออนไลน์', 'error');
      } else {
        showToast(err instanceof ApiError && err.message ? err.message : 'นำเข้าข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'error');
      }
      return;
    }
    state.submitting = false;
  }

  function renderResult(result) {
    const failed = result.results.filter((r) => !r.ok);
    resultEl.innerHTML = `
      <div class="flat-card bg-white rounded-2xl p-4 mb-4">
        <p class="text-sm font-semibold text-slate-700 mb-1">ผลการนำเข้า</p>
        <p class="text-sm text-emerald-600">สำเร็จ ${result.createdCount} รายการ</p>
        ${result.failedCount > 0 ? `<p class="text-sm text-rose-600 mt-1">ล้มเหลว ${result.failedCount} รายการ</p>` : ''}
      </div>
      ${failed.length > 0 ? `
        <div class="flat-card bg-white rounded-2xl p-4 mb-4">
          <div class="flex items-center justify-between mb-2 gap-2">
            <p class="text-sm font-semibold text-slate-700">แถวที่ล้มเหลว</p>
            <button id="pi-download-failed" type="button" class="text-xs text-sky-600 font-medium shrink-0">ดาวน์โหลดแถวที่ล้มเหลว</button>
          </div>
          <div class="space-y-2">
            ${failed.map((r) => `
              <div class="bg-rose-50 rounded-lg px-3 py-2">
                <p class="text-xs font-medium text-rose-700">แถวที่ ${r.row}</p>
                <p class="text-xs text-rose-600 mt-0.5">${escapeHtml(r.message)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <a href="#/patients" class="block text-center text-sm text-sky-600 mt-2">ไปที่หน้าผู้ป่วยเพื่อตรวจสอบรายชื่อที่นำเข้า →</a>
    `;

    // เคลียร์ preview/ชื่อไฟล์เดิมทิ้ง กันกดนำเข้าซ้ำโดยไม่ได้ตั้งใจ — ต้องเลือกไฟล์ใหม่ถึงจะนำเข้าได้อีกครั้ง
    previewEl.innerHTML = '';
    fileNameEl.textContent = '';
    fileInputEl.value = '';

    const downloadBtn = resultEl.querySelector('#pi-download-failed');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const failedExport = failed.map((r) => ({ ...state.rawRows[r.row - 1], 'เหตุผลที่ไม่สำเร็จ': r.message }));
        exportToCsv('แถวที่นำเข้าไม่สำเร็จ.csv', failedExport);
      });
    }
  }
}

/** @param {Object} mapped @param {string|null} hint @param {number} rowNum @return {string} */
function mobilePreviewRowHtml(mapped, hint, rowNum) {
  return `
    <div class="flat-card bg-white rounded-2xl p-3 mb-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-800 truncate">${escapeHtml(mapped.name || '(ไม่มีชื่อ)')}</p>
          <p class="text-xs text-slate-400 mt-0.5">HN ${escapeHtml(mapped.hn || '-')} · ${escapeHtml(mapped.cid || '-')}</p>
        </div>
        <span class="shrink-0 text-xs text-slate-400">แถว ${rowNum}</span>
      </div>
      ${hint
        ? `<p class="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-2">⚠ ${escapeHtml(hint)}</p>`
        : '<p class="text-xs text-emerald-600 mt-2">✓ ข้อมูลดูปกติ</p>'}
    </div>
  `;
}

/** @param {Object} mapped @param {string|null} hint @param {number} rowNum @return {string} */
function desktopPreviewRowHtml(mapped, hint, rowNum) {
  return `
    <tr class="border-b border-slate-50 last:border-0 align-top">
      <td class="px-4 py-3 text-xs text-slate-400">${rowNum}</td>
      <td class="px-4 py-3 text-sm text-slate-800">${escapeHtml(mapped.name || '(ไม่มีชื่อ)')}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${escapeHtml(mapped.hn || '-')}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${escapeHtml(mapped.cid || '-')}</td>
      <td class="px-4 py-3">
        ${hint
          ? `<span class="text-xs text-amber-700 bg-amber-50 rounded-full px-2 py-1">⚠ ${escapeHtml(hint)}</span>`
          : '<span class="text-xs text-emerald-700 bg-emerald-50 rounded-full px-2 py-1">✓ ปกติ</span>'}
      </td>
    </tr>
  `;
}
