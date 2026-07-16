# LTC Smart Care

ระบบดูแลผู้มีภาวะพึ่งพิงในชุมชน (Long-Term Care) — บันทึกการเยี่ยมบ้าน แบบประเมินสุขภาพ 6 ชุด, Care Plan, แผนที่ผู้ป่วย,
รายงาน และแจ้งเตือนความเสี่ยงสูงผ่าน LINE พร้อมทำงานได้แม้ออฟไลน์

> สเปกฉบับเต็ม (Architecture, Schema, API Contract, Roadmap ฯลฯ) อยู่ที่ [BLUEPRINT.md](./BLUEPRINT.md)
> คู่มือ deploy ขึ้นใช้งานจริงอยู่ที่ [DEPLOYMENT.md](./DEPLOYMENT.md)
> แผนทดสอบและผลตรวจสอบระบบอยู่ที่ [TEST_PLAN.md](./TEST_PLAN.md)

## สถานะปัจจุบัน

ระบบผ่านครบทั้ง 10 Phase ตามแผนใน BLUEPRINT.md แล้ว — ใช้งานได้จริงทั้ง Backend (Google Apps Script Web App) และ
Frontend (Static SPA บน GitHub Pages) ดูรายละเอียดการเปลี่ยนแปลงแต่ละ Phase ที่ [CHANGELOG.md](./CHANGELOG.md)

| ส่วน | เทคโนโลยี | สถานะ |
|---|---|---|
| Backend API | Google Apps Script (clasp) + Google Sheets + Google Drive | ✅ ใช้งานได้จริง |
| Frontend | HTML + Tailwind CSS (CDN) + ES6 Modules, ไม่มี build step | ✅ ใช้งานได้จริง |
| Authentication | Token เอง (ไม่ใช้ Google Identity) — CID สำหรับ CG, username/password สำหรับ ADMIN/CM/VIEWER | ✅ |
| Offline Support | IndexedDB + Service Worker + Sync Queue | ✅ |
| แจ้งเตือน | LINE Messaging API (Push) + Time-driven Trigger + Retry Queue | ✅ (ต้องติดตั้ง Trigger เองครั้งแรก ดู DEPLOYMENT.md) |

## โครงสร้างโปรเจกต์

```
C-LTC-Platform/
├── BLUEPRINT.md          # สเปกเต็มของระบบ (single source of truth)
├── DEPLOYMENT.md          # วิธี deploy ขึ้นใช้งานจริง (Script Properties, Web App, GitHub Pages, Trigger)
├── TEST_PLAN.md           # แผนทดสอบ + ผลตรวจสอบระบบ 12 มิติ + วิธีทดสอบแต่ละ Role
├── README.md              # ไฟล์นี้
├── CHANGELOG.md           # ประวัติการเปลี่ยนแปลงแต่ละ Phase
├── .clasp.json            # ผูก clasp กับ Apps Script project (scriptId, rootDir=./src)
│
├── src/                   # Backend — Google Apps Script (rootDir ของ clasp)
│   ├── appsscript.json       # manifest: timezone, webapp config, oauth scopes
│   ├── Config.gs              # ค่าคงที่ระบบ + ตัวเข้าถึง Spreadsheet/Config sheet
│   ├── Setup.gs                # setupSystem() — bootstrap สร้าง Sheets/Headers/Validation/Drive folder
│   ├── SheetService.gs         # data-access layer: อ่าน/เขียน Google Sheets แบบ batch + lock
│   ├── Validator.gs            # UUID, sanitize กัน Formula Injection, ตรวจ CID/enum/required field
│   ├── Response.gs             # response envelope มาตรฐาน (ok_/err_) + รหัส error
│   ├── AuditService.gs         # บันทึก/สืบค้น Audit Trail (admin.auditLog.list)
│   ├── Code.gs                 # doGet (health check) / doPost (จุดเข้าเดียวของทุก action)
│   ├── Router.gs               # ตาราง action → handler + บังคับ auth/RBAC รวมศูนย์
│   ├── Auth.gs                 # login/logout/validateSession, password hash
│   ├── Middleware.gs           # requireUser_/requireRole_ (RBAC), rate limit login
│   ├── UserService.gs          # จัดการผู้ใช้ (ADMIN) + users.updateLineId (self-service)
│   ├── Patients.gs             # CRUD ผู้ป่วย + ownership scoping (canAccessPatient_) + มอบหมายทีมดูแล
│   ├── CarePlans.gs            # แผนการดูแล + workflow อนุมัติ
│   ├── Visits.gs               # บันทึกการเยี่ยมบ้าน (draft/submit, idempotent)
│   ├── Assessments.gs          # แบบประเมิน Barthel/FallRisk/CaregiverBurden/PressureUlcer/INHOMESSS
│   ├── DepressionAssessment.gs # แบบประเมิน 2Q/9Q/8Q (conditional chain)
│   ├── Files.gs                 # อัปโหลดไฟล์ภาพ/ลายเซ็นขึ้น Drive (idempotent, จำกัด 5MB)
│   ├── RiskAlert.gs             # แจ้งเตือนทันทีตอนบันทึกข้อมูล (แจ้ง CM) + ส่ง LINE
│   ├── NotificationService.gs   # แจ้งเตือน CG, Retry Queue, Notification Log
│   ├── Triggers.gs              # Time-driven triggers (นัดวันนี้/ก่อนนัด/เลยนัด/ADL ลดลง/ขาดยา)
│   ├── รหัส.js / Index.html / App.html / Styles.html  # (prototype เดิม เก็บไว้อ้างอิงเท่านั้น ไม่ถูกเรียกใช้งานจริง)
│
└── frontend/              # Frontend — Static SPA สำหรับ GitHub Pages
    ├── index.html            # app shell หลัง login (Sidebar desktop / Bottom Nav มือถือ)
    ├── login.html            # หน้า login (CID / username-password)
    ├── manifest.json         # PWA manifest
    ├── service-worker.js     # cache app shell สำหรับเปิดออฟไลน์ได้
    └── assets/
        ├── css/app.css          # สไตล์เสริม + @media print
        └── js/
            ├── config.js / config.example.js   # Public API URL เท่านั้น ไม่มี secret
            ├── api.js            # fetch() wrapper (ไม่ใช้ google.script.run)
            ├── auth.js / storage.js / validation.js / ui.js / constants.js / directory.js
            ├── csv-export.js     # ส่งออกรายงานเป็น CSV
            ├── image-utils.js    # ย่อขนาดรูปก่อนอัปโหลด
            ├── signature-pad.js  # ลายเซ็นบน canvas
            ├── router.js         # hash router + Route Guard + Role Guard
            ├── offline/          # db.js (IndexedDB), sync.js (Sync Queue), visit-submit.js
            └── screens/          # dashboard, patients-list, patient-form, patient-detail,
                                   # care-plan, assign-care-team, visit-form(-steps), reports, map
```

## เริ่มต้นใช้งาน

ดูขั้นตอนละเอียดทั้งหมด (ตั้งค่า Script Properties, deploy Web App, ติดตั้ง Trigger, deploy GitHub Pages,
วิธีเปลี่ยน API URL, checklist ก่อนใช้งานจริง) ที่ **[DEPLOYMENT.md](./DEPLOYMENT.md)**

สรุปย่อ:

```bash
npm install -g @google/clasp
clasp login
clasp push --force
# เปิด Apps Script Editor → รัน setupSystem() → รัน bootstrapFirstAdmin_() ครั้งเดียว
# Deploy เป็น Web App (Execute as: Me, Access: Anyone)
# ติดตั้ง Time-driven Trigger 2 ตัว (ดู DEPLOYMENT.md §4)
# แก้ frontend/assets/js/config.js ให้ชี้ Web App URL แล้ว push ขึ้น GitHub Pages
```

## หลักการออกแบบที่ต้องรักษาไว้ทุก Phase

- **ห้าม hardcode secret** — Spreadsheet ID, LINE token, password salt ต้องมาจาก Script Properties เท่านั้น; frontend เก็บเฉพาะ Public API URL ใน `config.js`
- **ใช้ UUID เสมอ** สำหรับสร้าง Primary Key ใหม่ (`generateUuid_()` / `generateShortId_()`)
- **ทุก mutation ต้องครอบด้วย Lock** (`withSheetLock_()`) กันข้อมูลชนกันเวลาเขียนพร้อมกัน
- **ทุกค่าที่เขียนลง Sheet ต้องผ่าน sanitize** กัน Formula Injection (`sanitizeForSheetValue_()`) — เกิดขึ้นอัตโนมัติทุก path เขียนข้อมูลใน `SheetService.gs`
- **ทุก handler คืนค่าเป็น envelope จาก `ok_()`/`err_()`** ห้าม throw exception ออกไปให้ client เห็น stack trace ตรง ๆ
- **ทุก action ที่ mutate ข้อมูลหรือ login/logout ต้องเรียก `logAudit_()`**
- **อ่านทั้งชีตครั้งเดียว, เขียนแบบ batch** — ใช้ฟังก์ชันใน `SheetService.gs` แทนการวน loop เขียนทีละเซลล์
- **RBAC บังคับที่ Router.gs เสมอ** ไม่พึ่งการซ่อนปุ่มฝั่ง frontend อย่างเดียว — ทุกจุดที่มี "เฉพาะของตนเอง" ต้องเช็คซ้ำใน handler (เช่น `canAccessPatient_`)
- **Idempotency ทุก endpoint ที่เขียนข้อมูลสำคัญ** ผ่าน `clientTempId`/`requestId` ที่ client ส่งมา — เรียกซ้ำต้องได้ผลลัพธ์เดิม ไม่สร้างข้อมูลซ้ำ
- **frontend ห้ามใช้ `google.script.run`** — ใช้ `fetch()` ธรรมดา POST + `Content-Type: text/plain;charset=utf-8` เพื่อกัน CORS preflight เสมอ

## เอกสารที่เกี่ยวข้อง

- [BLUEPRINT.md](./BLUEPRINT.md) — สเปกเต็มของระบบ (architecture, schema, API contract, roadmap)
- [DEPLOYMENT.md](./DEPLOYMENT.md) — วิธี deploy ขึ้นใช้งานจริงทั้งหมด
- [TEST_PLAN.md](./TEST_PLAN.md) — แผนทดสอบ, ผลตรวจสอบระบบ, วิธีทดสอบแต่ละ Role
- [CHANGELOG.md](./CHANGELOG.md) — ประวัติการเปลี่ยนแปลงแต่ละ Phase
