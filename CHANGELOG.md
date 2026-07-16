# Changelog

รูปแบบอ้างอิง [Keep a Changelog](https://keepachangelog.com/) — เรียงจากใหม่ไปเก่า เวอร์ชันอ้างอิงตาม Phase ของ [BLUEPRINT.md](./BLUEPRINT.md)

## [0.10.0] - 2026-07-13 — Phase 10: Full System Audit + Documentation

### Added

- **`src/Files.gs`** (ใหม่) — action `files.upload`: อัปโหลดไฟล์ภาพ (base64) ขึ้น Google Drive แยกโฟลเดอร์ต่อผู้ป่วย (lazy-create), จำกัด 5MB, รับเฉพาะ JPEG/PNG/WEBP, **idempotent** ด้วยชื่อไฟล์ deterministic (`clientTempId` + category — เรียกซ้ำได้ fileId เดิม ไม่สร้างไฟล์ซ้ำ), ไฟล์เป็น private เสมอ (ไม่มีการเปิด public sharing)
- **`src/UserService.gs`** — action `users.updateLineId` ใหม่: ผูก/แก้ไข LINE User ID ของตัวเอง (ทุก role), หรือของผู้ใช้คนอื่นถ้าเป็น ADMIN
- **`src/AuditService.gs`** — action `admin.auditLog.list` ใหม่: เปิดใช้งาน `queryAuditLogs_()` ที่เตรียมไว้ตั้งแต่ Phase 2 ให้เรียกผ่าน API ได้จริง (ADMIN เท่านั้น)
- **`frontend/assets/js/router.js`** — หน้า "ตั้งค่า" เพิ่มฟอร์มผูก LINE User ID (เรียก `users.updateLineId`)
- **`frontend/assets/js/screens/visit-form.js` / `visit-form-steps.js`** — เชื่อมการอัปโหลดรูป/ลายเซ็นจริงเข้ากับ `files.upload` (อัปโหลดทันทีตอนแนบรูป/ยืนยันลายเซ็น แสดงสถานะ กำลังอัปโหลด/สำเร็จ/ล้มเหลว), แทนที่ `woundPhotoFileIds`/`signatureFileId` ที่เคยส่งค่าว่างเสมอ
- **`TEST_PLAN.md`** (ใหม่) — ผลตรวจสอบระบบ 12 มิติ (API Integration, Authentication, RBAC, Validation, CORS, Offline/Sync, Duplicate Submission, Upload, Audit Log, Responsive, Security, PDPA), วิธีทดสอบแต่ละมิติ, วิธีทดสอบแต่ละ Role (ADMIN/CM/CG/VIEWER), Regression smoke test checklist
- **`DEPLOYMENT.md`** (ใหม่) — คู่มือ deploy เต็มรูปแบบ: ตัวอย่าง Script Properties, ขั้นตอน deploy Web App, ติดตั้ง Time-driven Trigger (ผ่าน UI และผ่านฟังก์ชัน), deploy GitHub Pages, วิธีเปลี่ยน API URL, Checklist ก่อนใช้งานจริง
- **`README.md`** — เขียนใหม่ทั้งหมดให้ตรงกับสถานะระบบจริงหลัง Phase 10 (เดิมค้างอยู่ที่สถานะหลัง Phase 2)

### Fixed (พบจากการตรวจสอบระบบทั้งหมด)

- **Upload ใช้งานไม่ได้เลยตั้งแต่ Phase 1** — ไม่เคยมี action `files.upload` ทำให้ฟอร์มบันทึกการเยี่ยม (Phase 8) ต้องส่ง `woundPhotoFileIds: {}` / `signatureFileId: ''` เสมอ แก้โดยเพิ่ม `Files.gs` + เชื่อมเข้าฟอร์มจริง
- **ระบบแจ้งเตือน LINE ทั้งหมด (Phase 5, 9) ใช้งานจริงไม่ได้** — ไม่มีทางผูก `LineUserId` ของผู้ใช้เองเลย (มีแค่ ADMIN แก้ให้คนอื่นผ่าน `admin.users.update` แต่ไม่มี UI ให้ทำ) แก้โดยเพิ่ม `users.updateLineId` + ฟอร์มในหน้าตั้งค่า
- **Audit Log เขียนได้แต่อ่านย้อนหลังไม่ได้เลย** — `queryAuditLogs_()` เตรียมไว้ตั้งแต่ Phase 2 แต่ไม่เคยมี Router action ให้เรียก แก้โดยเพิ่ม `admin.auditLog.list`

### Verified

- ตรวจสอบเชิงลึก (อ่านโค้ดจริง) ยืนยันว่า Formula Injection defense, CORS pattern, RBAC ที่ Router.gs, Rate Limiting, LockService ทำงานถูกต้องสมบูรณ์อยู่แล้วไม่ต้องแก้ (ดูรายละเอียดใน TEST_PLAN.md)
- สร้างบัญชี ADMIN ทดสอบชั่วคราวจริง แล้วทดสอบผ่าน curl ยืนยัน `users.updateLineId`, `admin.auditLog.list`, `files.upload` (รวม idempotency — เรียกซ้ำด้วยชื่อไฟล์เดิมได้ fileId เดิมจริง) ทำงานถูกต้องกับ deployment จริง แล้วลบข้อมูล/โค้ดทดสอบออกหมดก่อนส่งมอบ
- ทดสอบ flow อัปโหลดรูป+ลายเซ็นในฟอร์มบันทึกการเยี่ยมแบบ end-to-end (mock `files.upload`) ยืนยัน `visitPayload.woundPhotoFileIds`/`signatureFileId` มี fileId จริงตอนส่งข้อมูลสำเร็จ

## [0.9.0] - 2026-07-12 — Phase 9: Map, Reports, LINE Notification Service, Time-driven Triggers

### Added

- **`src/NotificationService.gs`** (ใหม่) — `notifyCgForPatient_()` (แจ้ง CG คู่กับ `triggerRiskAlertIfNeeded_` เดิมที่แจ้ง CM เท่านั้น), `retryFailedNotifications_()` (Retry Queue), `listNotifications()` (action `admin.notifications.list`)
- **`src/Triggers.gs`** (ใหม่) — `installTimeDrivenTriggers()`/`removeTimeDrivenTriggers_()`, ตรวจนัดวันนี้/ก่อนนัด/เลยนัด (แจ้ง CG/CM ตามบทบาท) และ ADL ลดลง/ขาดยาต่อเนื่อง (เทียบข้อมูลล่าสุดเทียบกับที่เพิ่งบันทึกใหม่เท่านั้น กันแจ้งเตือนซ้ำทุกวัน)
- **`src/Assessments.gs`** — เพิ่มแจ้งเตือน Caregiver Burden สูง ที่ขาดหายไปจาก Phase 5 (มีแค่ FallRisk/PressureUlcer ที่ trigger alert)
- **`src/Setup.gs`** — เพิ่มคอลัมน์ `RetryCount`/`LastAttemptAt` ใน `Notifications` sheet รองรับ Retry Queue
- **`frontend/assets/js/screens/map.js`** (ใหม่) — Map Module ด้วย Leaflet + OpenStreetMap (ฟรี ไม่ต้องใช้ API key) ปักหมุดจาก GPS การเยี่ยมล่าสุดของผู้ป่วยแต่ละคน
- **`frontend/assets/js/screens/reports.js`**, **`csv-export.js`** (ใหม่) — Reports Module พร้อม Filter, สรุปสถิติ, Export CSV, Print/PDF-friendly (`@media print` ใน `app.css`)

### Verified

- Deploy ขึ้น live แล้วยืนยันด้วย curl ว่า backend ทำงานปกติหลังเพิ่มไฟล์ใหม่, `setupSystem()` migration คอลัมน์ใหม่สำเร็จ
- ทดสอบ Reports (สรุป+ตาราง+CSV escape ภาษาไทยถูกต้อง) และ Map (marker+popup+รายชื่อไม่มีพิกัด) ด้วยข้อมูลจำลองจริงในเบราว์เซอร์

### Known limitation

- ติดตั้ง Time-driven Trigger ต้องทำเองผ่าน Apps Script Editor ครั้งแรก (ขอสิทธิ์ scope ใหม่ที่ automation กดผ่านไม่ได้) — ดูขั้นตอนใน DEPLOYMENT.md §4

## [0.8.0] - 2026-07-12 — Phase 8: Multi-step Visit Form

### Added

- **`frontend/assets/js/screens/visit-form.js`**, **`visit-form-steps.js`** (ใหม่) — ฟอร์มบันทึกการเยี่ยมบ้าน 10 ขั้นตอน (ข้อมูลการเยี่ยม+GPS, Vital Signs, ADL, INHOMESSS, สุขภาพ/ยา, แผลกดทับ/ความเสี่ยงล้ม, 2Q/9Q/8Q, ผู้ดูแล/บริการ, รูปถ่าย/ลายเซ็น, สรุปยืนยัน) พร้อม Sticky Save, Validation ต่อขั้นตอน, Conditional Form (2Q→9Q→8Q ตรงกับ backend เป๊ะ)
- **`frontend/assets/js/offline/db.js`**, **`sync.js`**, **`visit-submit.js`** (ใหม่) — IndexedDB draft + Offline Queue + Sync Manager (ทุก 60 วินาที/เมื่อกลับมาออนไลน์)
- **`frontend/assets/js/image-utils.js`**, **`signature-pad.js`** (ใหม่) — ย่อขนาดรูปก่อนอัปโหลด, ลายเซ็นบน canvas

### Verified

- ทดสอบครบ 10 ขั้นตอนจริงในเบราว์เซอร์ รวม conditional chain ทั้ง 2 เส้นทาง, resize รูป 3000×2000→1280×853, offline→enqueue→sync สำเร็จจริง, ปุ่ม submit ป้องกันกดซ้ำ

### Known limitation (แก้แล้วใน Phase 10)

- ยังไม่มี backend action `files.upload` ตอน Phase นี้ — ฟอร์มส่ง `woundPhotoFileIds`/`signatureFileId` เป็นค่าว่างชั่วคราว

## [0.7.0] - 2026-07-12 — Phase 7: Dashboard, Patients, Care Plan, Assign

### Added

- **`frontend/assets/js/screens/dashboard.js`** (ใหม่) — สรุปสถิติ + กราฟ Chart.js
- **`frontend/assets/js/screens/patients-list.js`**, **`patient-form.js`**, **`patient-detail.js`** (ใหม่) — Search/Filter/Pagination, ฟอร์มเพิ่ม/แก้ไข, หน้ารายละเอียด
- **`frontend/assets/js/screens/care-plan.js`**, **`assign-care-team.js`** (ใหม่) — workflow แผนการดูแล + มอบหมายทีมดูแล
- **`frontend/assets/js/router.js`** — dynamic route (`:id`), Role Guard ต่อหน้า, Sidebar (desktop)/Bottom Nav (มือถือ)

### Known limitation

- `admin.users.list` เป็น ADMIN-only ตาม Router.gs เดิม ทำให้หน้ามอบหมายทีมดูแล/สร้างผู้ป่วยของ CM ไม่มี dropdown รายชื่อ CG ให้เลือก (ต้องพิมพ์รหัสผู้ใช้เอง) — เป็นข้อจำกัดจากสิทธิ์ที่ตั้งใจออกแบบไว้ ไม่ใช่บั๊ก

## [0.6.0] - 2026-07-12 — Phase 6: Frontend Foundation

### Added

- โครง Frontend เต็มรูปแบบสำหรับ GitHub Pages: `index.html`, `login.html`, `assets/js/{api,auth,router,storage,validation,ui,config}.js`, `manifest.json`, `service-worker.js`
- Route Guard, Token expiry auto-redirect, Loading/Toast/Error/Offline UI ครบ

## [0.5.0] - 2026-07-12 — Phase 5: Visit, Vital Signs, ADL, INHOMESSS, Assessments, Risk Alert

### Added

- **`src/Visits.gs`** — `saveVisitDraft`/`submitVisit` (Visit Number คำนวณอัตโนมัติ, idempotent ด้วย `clientTempId`), `reviewVisit`
- **`src/Assessments.gs`**, **`DepressionAssessment.gs`** — Barthel/FallRisk/CaregiverBurden/PressureUlcer/INHOMESSS + 2Q/9Q/8Q conditional chain, คำนวณคะแนน/แปลผลที่ backend เสมอ (ไม่เชื่อค่าจาก frontend)
- **`src/RiskAlert.gs`** — แจ้งเตือน CM ทันทีผ่าน LINE Messaging API ตอนพบความเสี่ยงสูง

### Fixed

- Google Sheets auto-convert string วันที่เป็น Date object ผ่าน `appendRow()` — แก้โดยเปลี่ยน `appendRecord_` ไปใช้ `Range.setValues()`
- Cross-file load order bug (`Assessments.gs` มาก่อน `Config.gs` ตามตัวอักษร) — แก้โดยเปลี่ยน top-level var เป็น lazy function

## [0.4.0] - 2026-07-12 — Phase 4: Patients, Care Plan

### Added

- **`src/Patients.gs`** — CRUD ผู้ป่วย, `canAccessPatient_` (ownership scoping ใช้ร่วมทุกไฟล์), `assignCareTeam`, mask CID ใน list เสมอ
- **`src/CarePlans.gs`** — แผนการดูแล + workflow อนุมัติ (แยกหน้าที่ผู้สร้าง/ผู้อนุมัติ)

## [0.3.0] - 2026-07-12 — Phase 3: Auth, Router, User Management

### Added

- **`src/Code.gs`**, **`Router.gs`** — จุดเข้าเดียว (`doPost`) + ตาราง action กลาง บังคับ auth/RBAC รวมศูนย์
- **`src/Auth.gs`**, **`Middleware.gs`**, **`UserService.gs`** — login/logout/validateSession, password hash (salted+stretched SHA-256), rate limit login, จัดการผู้ใช้ (ADMIN)

## [0.2.0] - 2026-07-12 — Phase 2: Backend Foundation

### Added

- **`src/Response.gs`** — response envelope มาตรฐาน `ok_()` / `err_()` / `errFromException_()` / `jsonOutput_()` และค่าคงที่ `ERROR_CODES` ครบ 11 รหัสตาม BLUEPRINT.md §11
- **`src/Validator.gs`** — `generateUuid_()` / `generateShortId_()` (สร้าง Primary Key ด้วย UUID), `sanitizeForSheetValue_()` (ป้องกัน Formula Injection), ตัวตรวจสอบ `isNonEmptyString_`, `isValidEnum_`, `isValidIsoDate_`, `isValidThaiCid_` (checksum เลขบัตรประชาชนไทย), `validateRequiredFields_`
- **`src/SheetService.gs`** — data-access layer กลางสำหรับ Google Sheets: `readAllRecords_`, `findRecord_`/`findRecords_`/`findRecordByKey_`, `appendRecord_`/`appendRecords_` (batch), `updateRecord_`/`batchUpdateRecords_` (batch), `upsertByKey_`, ครอบทุก mutation ด้วย `withSheetLock_()` (LockService) พร้อม `SheetLockError_` สำหรับแปลงเป็น `ERR_LOCK_TIMEOUT`
- **`src/Config.gs`** — `SHEET_NAMES` / `SCRIPT_PROPERTY_KEYS` / `CONFIG_KEYS` เป็น single source of truth ของชื่อชีต/คีย์ตั้งค่า, `getSpreadsheetId_()`/`getSpreadsheet_()` (อ่านจาก Script Properties เท่านั้น, ห้าม hardcode), `getConfig_()`/`setConfig_()`/`getAllConfigMap_()` (มี cache ผ่าน CacheService, invalidate อัตโนมัติเมื่อ set)
- **`src/AuditService.gs`** — `logAudit_()` (เขียน Audit Trail แบบไม่มีวันทำ request หลักล้มเหลว) และ `queryAuditLogs_()` (สืบค้นแบบมีตัวกรอง + pagination)
- **`src/Setup.gs`** — `setupSystem()`: bootstrap ระบบทั้งหมดแบบ idempotent
  - สร้าง/ตรวจสอบ Spreadsheet ผ่าน `SPREADSHEET_ID` ใน Script Properties (สร้างใหม่อัตโนมัติถ้ายังไม่มี)
  - สร้างครบทั้ง 12 ชีตตาม BLUEPRINT.md §7 (Users, Patients, Visits, Assessments_Barthel, Assessments_Depression, Assessments_FallRisk, Assessments_CaregiverBurden, Assessments_PressureUlcer, Sessions, Config, AuditLog, Notifications) พร้อม header แถวแรก (bold, freeze row)
  - ตั้ง Data Validation (dropdown) ให้ทุกคอลัมน์ enum ตาม schema (Role, Status, Gender, AdlGroup, RiskLevel, WoundStage, Channel ฯลฯ)
  - สร้างโฟลเดอร์ Drive สำหรับเก็บไฟล์ (`LTC_SmartCare_Files`) แบบ lazy + idempotent
  - Seed ค่าเริ่มต้นใน Config sheet (`APP_VERSION`, `DRIVE_ROOT_FOLDER_ID`, `SETUP_LAST_RUN_AT`)
  - เพิ่มคอลัมน์ header ที่ขาดต่อท้ายแบบปลอดภัย (append-only) ถ้ารันซ้ำแล้ว schema เปลี่ยน โดยไม่ลบข้อมูลเดิม
- **`appsscript.json`** — เพิ่ม `oauthScopes` (`spreadsheets`, `drive`, `script.external_request`) เตรียมรองรับ Auth/Files/Notifications ใน Phase ถัดไป
- **`README.md`** — คู่มือติดตั้ง/รัน backend, ตาราง Script Properties ที่ต้องตั้งค่า, หลักการออกแบบที่ต้องรักษาไว้ทุก Phase

### Verified

- รัน `setupSystem()` จริงผ่าน Apps Script Editor 2 ครั้งติดกัน — ครั้งแรกสร้าง Spreadsheet `LTC_SmartCare_DB` ใหม่พร้อมทุกชีต, ครั้งที่สองยืนยัน idempotency (คืน `sheetsExisting` แทน `sheetsCreated`, ไม่สร้างซ้ำ, ใช้ Drive folder เดิม)
- ตรวจ header row และ dropdown validation ของชีต `Users` ด้วยตา (Role: ADMIN/CM/CG/VIEWER ตรงตามสเปก)

### Not in scope (ยังไม่ทำ Phase นี้)

- ยังไม่มี `Main.gs` (doGet/doPost router) — `setupSystem()` เรียกได้เฉพาะจาก Apps Script Editor เท่านั้น
- ยังไม่มี `Auth.gs`, `Patients.gs`, `Visits.gs`, `Assessments.gs`, `Files.gs`, `Notifications.gs`
- ยังไม่มี Frontend (GitHub Pages SPA) — prototype เดิมใน `src/App.html` ฯลฯ ยังไม่ถูกแตะต้องหรือเชื่อมกับ backend ใหม่

## [0.1.0] - 2026-07-12 — Phase 1: Blueprint

### Added

- **`BLUEPRINT.md`** — เอกสารสถาปัตยกรรมฉบับเต็ม 20 หัวข้อ: Scope, System Architecture (GitHub Pages → fetch() → Apps Script API → Sheets/Drive), User Roles/Permission Matrix, Sitemap, User Flow (Admin/CM/CG), Data Flow, Google Sheets Schema (11 ชีต), Primary/Foreign Key, API Contract, Request/Response JSON, Error Codes, Folder Structure, Authentication/Session Flow, Offline/Sync Strategy, File Upload Flow, LINE Notification Flow (Messaging API — ไม่ใช่ LINE Notify ที่ยกเลิกบริการไปแล้ว), Security/PDPA/Audit Trail, Deployment Checklist, Acceptance Criteria, Roadmap Phase 2–10

## [0.0.1] - 2026-07-12 — Prototype (ก่อน Blueprint)

### Added

- Port การออกแบบ `LTC Smart Care.dc.html` (Claude Design handoff) เป็น GAS Web App ต้นแบบ (`src/Index.html`, `src/App.html`, `src/Styles.html`, `src/รหัส.js`) ใช้ Preact + htm ผ่าน CDN, mock data ในหน่วยความจำล้วน ไม่มี backend จริง — ใช้เป็นสเปก UI อ้างอิงสำหรับ Frontend จริงใน Phase ถัดไป ไม่ใช่สถาปัตยกรรมที่ใช้งานต่อ
