/**
 * csv-parse.js
 * แปลงข้อความ CSV (จากไฟล์ที่ผู้ใช้อัปโหลด) → array ของ object คู่กับ header แถวแรก
 * รองรับฟิลด์ที่ครอบด้วย "..." (มีจุลภาค/ขึ้นบรรทัดใหม่ในฟิลด์ได้) ตาม RFC 4180 พื้นฐาน — ไม่พึ่ง library
 * ภายนอก ตามธรรมเนียมเดียวกับ csv-export.js (ทิศทางตรงข้ามกัน: ที่นั่นแปลง object → CSV, ที่นี่ CSV → object)
 */

/**
 * @param {string} text เนื้อไฟล์ CSV ดิบ (ยังไม่ตัด BOM)
 * @return {Array<Object>} แต่ละ object คีย์ตาม header แถวแรกเป๊ะ (ค่าทุกช่อง trim แล้ว) — array ว่างถ้าไฟล์ว่าง
 */
export function parseCsv(text) {
  // ตัด BOM (﻿) ทิ้งก่อน ไม่งั้น header คอลัมน์แรกจะมีอักขระที่มองไม่เห็นติดมาด้วย ทำให้ map ชื่อคอลัมน์ไม่ตรง
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = parseRows_(clean);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))   // ข้ามแถวว่างท้ายไฟล์ (เช่น newline สุดท้าย)
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
      return obj;
    });
}

/**
 * ตัดข้อความ CSV เป็น array ของแถว โดยแต่ละแถวเป็น array ของค่าช่อง (ยังไม่ trim/map เป็น object)
 * เขียนเป็น state machine ทีละตัวอักษรเพราะต้องแยกกรณี comma/newline ที่อยู่ "ในเครื่องหมายคำพูด" ออกจาก
 * ตัวคั่นจริง — split(',') ธรรมดาจะพังทันทีถ้ามีค่าเช่น "สมชาย, ใจดี" ที่ผู้ใช้พิมพ์จุลภาคไว้ในชื่อ
 * @param {string} text
 * @return {Array<Array<string>>}
 */
function parseRows_(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ข้าม — จัดการที่ \n แทนกันนับแถวซ้ำตอนไฟล์ใช้ CRLF
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
