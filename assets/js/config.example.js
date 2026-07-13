/**
 * config.example.js
 * ต้นแบบไฟล์ config — คัดลอกเป็น assets/js/config.js แล้วแทนที่ API_BASE_URL
 * ด้วย URL ของ Google Apps Script Web App ที่ deploy จริง (รูปแบบ https://script.google.com/macros/s/{deploymentId}/exec)
 *
 * ห้ามใส่ secret/token/api key ใด ๆ ในไฟล์นี้หรือ config.js — เก็บเฉพาะ URL สาธารณะที่ frontend ใช้เรียก backend
 * (การพิสูจน์ตัวตนจริงทำผ่าน token ที่ได้จาก auth.login แล้วเก็บใน localStorage เท่านั้น ดู storage.js)
 */
export const API_BASE_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
