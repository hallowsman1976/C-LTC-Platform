/**
 * csv-export.js
 * แปลง array ของ object → ไฟล์ CSV แล้วสั่งดาวน์โหลดผ่านเบราว์เซอร์ (ไม่พึ่ง backend/library ภายนอก)
 */

/**
 * @param {string} filename เช่น 'patients-report-2026-07-13.csv'
 * @param {Array<Object>} rows แต่ละ object คือ 1 แถว key จะถูกใช้เป็น header คอลัมน์ (ใช้ key ของแถวแรกเป็นหลัก)
 */
export function exportToCsv(filename, rows) {
  if (!rows || rows.length === 0) return;

  var headers = Object.keys(rows[0]);
  var lines = [headers.map(escapeCsvValue_).join(',')];

  rows.forEach(function (row) {
    lines.push(headers.map(function (h) { return escapeCsvValue_(row[h]); }).join(','));
  });

  // เติม BOM (﻿) กัน Excel เปิดแล้วภาษาไทยเพี้ยนเป็นตัวอักษรมั่ว (encoding detection ผิดเป็น ANSI)
  var csvContent = '﻿' + lines.join('\r\n');
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);

  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * @param {*} value
 * @return {string}
 */
function escapeCsvValue_(value) {
  var str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
