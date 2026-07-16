# BLUEPRINT — LTC Smart Care (Phase 1)

> เอกสารนี้เป็น "single source of truth" สำหรับ Phase 1 ของระบบ LTC Smart Care
> ออกแบบให้พัฒนาได้จริงทันทีโดยไม่ต้องย้อนถามสเปกซ้ำ และให้ Phase 2–10 อ้างอิงต่อได้โดยไม่ต้องอ่านโค้ดต้นฉบับใหม่ทั้งหมด
> ห้ามแก้ไข schema/contract ในเอกสารนี้โดยไม่ bump เลขเวอร์ชันที่ท้ายไฟล์

**สถานะ:** Draft พร้อมพัฒนา (v1.0)
**อ้างอิงต้นแบบ UI/UX:** `LTC Smart Care.dc.html` (Claude Design handoff) — ใช้เป็นสเปก UI แบบ pixel-level, ไม่ใช่สเปกสถาปัตยกรรม
**เปลี่ยนแปลงจาก prototype เดิม:** prototype ก่อนหน้ารันเป็น Google Apps Script Web App (HtmlService) ฝั่งเดียว เก็บ state ใน memory ของหน้าเว็บล้วน ๆ — Phase 1 นี้แยก frontend ออกไปอยู่ GitHub Pages และให้ Apps Script ทำหน้าที่เป็น API เท่านั้น พร้อมข้อมูลจริงใน Google Sheets/Drive

---

## สารบัญ

1. [Scope และเป้าหมาย](#1-scope-และเป้าหมาย)
2. [System Architecture](#2-system-architecture)
3. [User Roles และ Permission Matrix](#3-user-roles-และ-permission-matrix)
4. [Sitemap](#4-sitemap)
5. [User Flow (Admin / CM / CG)](#5-user-flow-admin--cm--cg)
6. [Data Flow](#6-data-flow)
7. [Google Sheets Schema](#7-google-sheets-schema)
8. [Primary Key / Logical Foreign Key](#8-primary-key--logical-foreign-key)
9. [API Contract](#9-api-contract)
10. [Request/Response JSON](#10-requestresponse-json)
11. [Error Codes](#11-error-codes)
12. [Frontend/Backend Folder Structure](#12-frontendbackend-folder-structure)
13. [Authentication และ Session Flow](#13-authentication-และ-session-flow)
14. [Offline/Sync Strategy](#14-offlinesync-strategy)
15. [File Upload Flow](#15-file-upload-flow)
16. [LINE Notification Flow](#16-line-notification-flow)
17. [Security, PDPA และ Audit Trail](#17-security-pdpa-และ-audit-trail)
18. [Deployment Checklist](#18-deployment-checklist)
19. [Acceptance Criteria](#19-acceptance-criteria)
20. [Roadmap Phase 2–10](#20-roadmap-phase-210)

---

## 1. Scope และเป้าหมาย

### เป้าหมาย Phase 1

สร้างระบบดูแลผู้มีภาวะพึ่งพิงในชุมชน (Long-Term Care) ที่ใช้งานได้จริงกับข้อมูลจริง โดยยกระดับจาก prototype (mock data ในหน่วยความจำ) ไปเป็นระบบที่มี:

- Backend API จริงบน Google Apps Script + Google Sheets/Drive เป็นฐานข้อมูล
- Frontend แยกอิสระ hosted บน GitHub Pages เรียก API ผ่าน `fetch()`
- ผู้ใช้หลายบทบาท (Admin / CM / CG) เข้าระบบจริง มี session และสิทธิ์แยกกัน
- บันทึกการเยี่ยมบ้านและแบบประเมิน 5 ชุด ที่มีอยู่ใน prototype ได้แก่ Barthel ADL, 2Q/9Q/8Q (ซึมเศร้า), ความเสี่ยงหกล้ม, ความเสี่ยงแผลกดทับ, Caregiver Burden
- แนบรูปภาพ (แผล/ก่อน-หลัง/ลายเซ็น) เก็บบน Google Drive
- แจ้งเตือน CM ผ่าน LINE เมื่อพบผลประเมินที่มีความเสี่ยงสูง
- ทำงาน offline-first บนสมาร์ทโฟนของ CG แล้ว sync เมื่อกลับมามีสัญญาณ
- มี audit trail และแนวทางสอดคล้อง PDPA

### อยู่ใน Scope Phase 1

- CRUD ผู้ป่วย, การเยี่ยมบ้าน, แบบประเมินทั้ง 5 ชุด
- Authentication แบบ custom token (CG login ด้วยเลขบัตรประชาชน, Staff login ด้วย username/password)
- Upload ไฟล์ภาพ (ไม่เกิน 5MB/ไฟล์ หลังบีบอัด)
- แจ้งเตือน LINE แบบ push message พื้นฐาน (ไม่รวมการผูกบัญชี LINE Login อัตโนมัติ — ผูกด้วยมือโดย Admin)
- Offline queue + sync แบบ manual/periodic (ยังไม่ใช่ Background Sync API เต็มรูปแบบ)
- Audit log ระดับ action (ไม่ใช่ full change-diff)

### ไม่อยู่ใน Scope Phase 1 (ดู [Roadmap](#20-roadmap-phase-210))

- LINE Login / OAuth binding อัตโนมัติ
- รายงานเชิงสถิติ/Dashboard วิเคราะห์ระดับประชากร
- ระบบส่งต่อ (Referral) ไป รพ.สต./รพช. แบบ workflow
- Multi-tenant (หลายหน่วยงาน/พื้นที่)
- การเข้ารหัสข้อมูลอ่อนไหวระดับ field (encryption at rest)
- แบบประเมิน INHOMESSS (มีปุ่มใน UI แต่ "อยู่ระหว่างพัฒนา" ต่อใน Phase 6)

---

## 2. System Architecture

```
┌─────────────────────┐        HTTPS fetch()         ┌───────────────────────────┐        SpreadsheetApp /        ┌──────────────────────┐
│   GitHub Pages       │ ───────────────────────────▶ │  Google Apps Script       │ ───────────────────────────▶  │  Google Sheets (DB)   │
│   (Static SPA/PWA)   │ ◀─────────────────────────── │  Web App (doGet/doPost)  │ ◀───────────────────────────  │  Google Drive (Files) │
└─────────────────────┘        JSON response          └───────────────────────────┘        DriveApp                └──────────────────────┘
        │                                                        │
        │ IndexedDB (offline queue)                              │ UrlFetchApp
        ▼                                                        ▼
┌─────────────────────┐                                ┌───────────────────────────┐
│  Service Worker      │                                │  LINE Messaging API       │
│  (app-shell cache)   │                                │  (push notification)      │
└─────────────────────┘                                └───────────────────────────┘
```

### องค์ประกอบ

| ชั้น | เทคโนโลยี | หน้าที่ |
|---|---|---|
| Frontend | Static HTML/CSS/JS (Preact + htm ผ่าน CDN, ไม่มี build step) hosted บน GitHub Pages | UI ทั้งหมด, state management ฝั่ง client, offline queue |
| API | Google Apps Script Web App เดียว (`doGet`/`doPost` เป็น router) | รับ request, ตรวจสิทธิ์, อ่าน/เขียน Sheets, จัดการไฟล์ Drive, ยิง LINE |
| Database | Google Sheets 1 ไฟล์ หลาย tab (ดู [§7](#7-google-sheets-schema)) | เก็บข้อมูลผู้ใช้/ผู้ป่วย/การเยี่ยม/แบบประเมิน/session/log |
| File storage | Google Drive (โฟลเดอร์แยกตาม PatientId) | เก็บรูปแผล, รูปก่อน-หลัง, ลายเซ็น |
| Notification | LINE Messaging API (Push Message) | แจ้งเตือน CM เมื่อพบผลประเมินความเสี่ยงสูง |

### เหตุผลที่แยก Frontend ออกจาก Apps Script (HtmlService)

- GitHub Pages ให้ custom domain, CDN, PWA/offline caching, และ CI/CD ที่ดีกว่า iframe ของ HtmlService
- Apps Script ทำหน้าที่ backend อย่างเดียวทำให้ deploy/versioning backend และ frontend แยกจากกันได้ (คนละ release cycle)
- รองรับการย้าย backend ไปแพลตฟอร์มอื่นในอนาคต (ดู Phase 10) โดยแก้แค่ `api.js` ฝั่ง frontend

### ข้อจำกัดทางเทคนิคที่ต้องออกแบบรองรับ (สำคัญมาก — อย่าลืมตอน implement)

1. **CORS / Preflight:** Apps Script Web App **ไม่รองรับ custom response header สำหรับ preflight (`OPTIONS`)** เมื่อเรียกข้าม origin จาก GitHub Pages ดังนั้น:
   - ทุก request ที่มี body ต้องส่งเป็น **`POST`** ด้วย `Content-Type: text/plain;charset=utf-8` (ถือเป็น "simple request" ไม่ trigger preflight) แล้วฝัง JSON เป็น string ใน body — ฝั่ง Apps Script อ่านด้วย `e.postData.contents` แล้ว `JSON.parse()` เอง
   - ห้ามใช้ `Content-Type: application/json` ตรง ๆ เพราะจะ trigger preflight `OPTIONS` ซึ่ง Apps Script ตอบไม่ได้ตามที่ browser ต้องการ
2. **Payload limit:** รวม request/response ต้องไม่เกิน ~50MB (ในทางปฏิบัติควรเล็กกว่านี้มาก) — ไฟล์ภาพต้องบีบอัดฝั่ง client ก่อน (ดู [§15](#15-file-upload-flow))
3. **Execution time limit:** สคริปต์รันได้ไม่เกิน 6 นาที/ครั้ง (ปกติทุก action ควรจบใน < 3 วินาที) — งานหนักเช่น export ต้องทำผ่าน trigger แบบ async (Phase 3+)
4. **Concurrent write:** ต้องใช้ `LockService` ครอบทุก mutation ที่เขียนแถวใหม่ (append) เพื่อกัน race condition เวลามีหลาย CG บันทึกพร้อมกัน
5. **Session ไม่ใช่ Google Identity:** เพราะ frontend เป็น origin อื่น และ CG login ด้วยเลขบัตรประชาชนไม่ใช่ Google Account ดังนั้น auth ทั้งหมดเป็น custom token ที่ backend ออกเองและตรวจเองทุก request (ดู [§13](#13-authentication-และ-session-flow))

---

## 3. User Roles และ Permission Matrix

### บทบาท

| Role | คำอธิบาย | วิธี Login |
|---|---|---|
| `ADMIN` | ผู้ดูแลระบบ ตั้งค่าผู้ใช้/สิทธิ์/ดู audit log | username + password |
| `CM` | Case Manager ดูแลผู้ป่วยหลายคน อนุมัติ/ตรวจแบบประเมิน รับแจ้งเตือนความเสี่ยงสูง | username + password |
| `CG` | Caregiver ผู้ดูแล/อสม. บันทึกการเยี่ยมบ้านและแบบประเมิน | เลขประจำตัวประชาชน (CID) 13 หลัก |
| `VIEWER` | ผู้เยี่ยมชม/หน่วยงานภายนอก ดูอย่างเดียว (read-only) | username + password |

### Permission Matrix

| Action / Resource | ADMIN | CM | CG | VIEWER |
|---|:---:|:---:|:---:|:---:|
| Login / ดู dashboard ของตนเอง | ✅ | ✅ | ✅ | ✅ |
| ดูรายชื่อผู้ป่วยทั้งหมด | ✅ | ✅ (เฉพาะที่รับผิดชอบ) | ✅ (เฉพาะที่รับผิดชอบ) | ✅ (read-only) |
| สร้าง/แก้ไขข้อมูลผู้ป่วย (master data) | ✅ | ✅ | ❌ | ❌ |
| ลบผู้ป่วย (soft delete) | ✅ | ❌ | ❌ | ❌ |
| บันทึกการเยี่ยมบ้าน (visit) | ✅ | ✅ | ✅ (เฉพาะผู้ป่วยที่ตนรับผิดชอบ) | ❌ |
| แก้ไข/ลบการเยี่ยมที่ submit แล้ว | ✅ | ✅ | ❌ (แก้ได้เฉพาะ draft ของตนเอง) | ❌ |
| บันทึกแบบประเมิน (5 ชุด) | ✅ | ✅ | ✅ (เฉพาะผู้ป่วยที่ตนรับผิดชอบ) | ❌ |
| อัปโหลดไฟล์ภาพ/ลายเซ็น | ✅ | ✅ | ✅ | ❌ |
| จัดการผู้ใช้ (สร้าง/ปิดบัญชี/กำหนดบทบาท) | ✅ | ❌ | ❌ | ❌ |
| ผูก LINE User Id ให้ผู้ใช้ | ✅ | ✅ (เฉพาะของตนเอง) | ✅ (เฉพาะของตนเอง) | ❌ |
| ดู Audit Log | ✅ | ❌ | ❌ | ❌ |
| ตั้งค่าระบบ (Config) | ✅ | ❌ | ❌ | ❌ |
| รับแจ้งเตือน LINE เมื่อผลประเมินเสี่ยงสูง | ✅ (สำเนา) | ✅ (ของผู้ป่วยที่ตนรับผิดชอบ) | ❌ | ❌ |

> กติกา "เฉพาะที่รับผิดชอบ" ตรวจจาก `Patients.PrimaryCgUserId` (สำหรับ CG) และ `Patients.ResponsibleCmUserId` (สำหรับ CM) — บังคับที่ backend ทุก endpoint ห้ามพึ่งการซ่อนปุ่มฝั่ง frontend อย่างเดียว

---

## 4. Sitemap

```
/login                                  (Login — เลือกโหมด CG / เจ้าหน้าที่)
└── /app                                (หลัง login — ต้องมี token ที่ valid)
    ├── /dashboard                      (หน้าหลัก — สรุปการ์ด, กราฟรายเดือน, นัดเยี่ยมวันนี้)
    ├── /patients                       (รายชื่อผู้ป่วย — ค้นหา/กรองสถานะ)
    │   └── /patients/:patientId        (ข้อมูลผู้ป่วย — ADL trend, ประวัติการเยี่ยม)
    │       └── /patients/:patientId/visit/new     (ฟอร์มบันทึกการเยี่ยม 3 ขั้นตอน)
    │           ├── step 1: ข้อมูลทั่วไป + Vital Signs + แผลกดทับ
    │           ├── step 2: อาการ/ADL/ยา/โภชนาการ/ขับถ่าย/นอน/หกล้ม/ภาระผู้ดูแล
    │           └── step 3: บริการที่ให้/คำแนะนำ/รูปก่อน-หลัง/ลายเซ็น
    ├── /assessments                    (ศูนย์รวมแบบประเมิน — เลือกผู้ป่วยก่อนเข้าแต่ละแบบ)
    │   ├── /assessments/depression      (2Q → 9Q → 8Q แบบมีเงื่อนไข)
    │   ├── /assessments/barthel         (Barthel ADL Index)
    │   ├── /assessments/fallrisk        (ความเสี่ยงหกล้ม)
    │   ├── /assessments/pressureulcer   (ความเสี่ยงแผลกดทับ)
    │   ├── /assessments/caregiverburden (Caregiver Burden)
    │   └── /assessments/inhomesss       (Phase 6 — placeholder "อยู่ระหว่างพัฒนา")
    ├── /settings                       (ตั้งค่าส่วนตัว, ผูก LINE, ออกจากระบบ)
    └── /admin                          (เฉพาะ ADMIN)
        ├── /admin/users                (จัดการผู้ใช้ + บทบาท)
        ├── /admin/patients             (จัดการผู้ป่วย master data)
        ├── /admin/audit-log            (ดู audit trail)
        └── /admin/config               (ตั้งค่าระบบ, ทดสอบ LINE)
```

Bottom navigation (มือถือ) มี 4 ปุ่มตรงกับ prototype เดิม: หน้าหลัก / ผู้ป่วย / แบบประเมิน / ตั้งค่า — เมนู `/admin` เข้าถึงผ่านปุ่ม "ตั้งค่า" เมื่อ role เป็น ADMIN เท่านั้น

---

## 5. User Flow (Admin / CM / CG)

### 5.1 CG (Caregiver) — งานหลัก: บันทึกการเยี่ยมบ้าน

```
เปิดแอป (PWA จากหน้าจอโฮม) → login ด้วย CID 13 หลัก
  → ระบบตรวจ CID กับ Users sheet (Role=CG) → ออก token
  → Dashboard: เห็นเฉพาะสรุปของผู้ป่วยที่ตนรับผิดชอบ (PrimaryCgUserId = ตนเอง)
  → แตะ "นัดเยี่ยมวันนี้" หรือไปที่ "ผู้ป่วย" → เลือกผู้ป่วย
  → หน้าข้อมูลผู้ป่วย → แตะ "+ บันทึกการเยี่ยมวันนี้"
  → กรอกฟอร์ม 3 ขั้นตอน (ระบบขอ GPS อัตโนมัติ, บันทึก Draft ได้ทุกขั้นตอน)
      → ถ้าพบแผลกดทับ → กรอกรายละเอียด + แนบรูป
      → ถ้าต้องประเมินเพิ่ม → กดลิงก์ไปแท็บ "แบบประเมิน" (บริบทผู้ป่วยเดิมติดไปด้วย)
  → กด "บันทึกและส่ง" ที่ step 3
      → ถ้าออนไลน์: ส่งเข้า backend ทันที → บันทึกลง Visits sheet → ตรวจเงื่อนไข alert
      → ถ้าออฟไลน์: เก็บเข้า IndexedDB queue → แสดง toast "บันทึกออฟไลน์ รอซิงค์"
  → กลับหน้าข้อมูลผู้ป่วย เห็นประวัติการเยี่ยมอัปเดต
```

### 5.2 CM (Case Manager) — งานหลัก: ติดตามผู้ป่วยและตรวจแบบประเมิน

```
login ด้วย username/password
  → Dashboard: เห็นสรุปของผู้ป่วยทุกคนที่ ResponsibleCmUserId = ตนเอง
  → ได้รับแจ้งเตือน LINE เมื่อ CG บันทึกผลประเมินความเสี่ยงสูง (เช่น 9Q ข้อ 9 > 0)
  → เปิดแอป → เข้าหน้าผู้ป่วยที่ถูกแจ้งเตือน → ดูรายละเอียดแบบประเมิน + ประวัติการเยี่ยม
  → ตัดสินใจ: บันทึกแบบประเมินเพิ่มเติมเอง (เช่น 8Q ต่อจาก 9Q) หรือประสานส่งต่อ (นอก scope Phase 1)
  → สามารถแก้ไขข้อมูลผู้ป่วย (master data) และมอบหมาย CG ผู้รับผิดชอบใหม่ได้
  → ดูรายชื่อผู้ป่วยทั้งหมดในทีม กรองตามสถานะ (นัดวันนี้/เยี่ยมแล้ว/เลยนัด/ยังไม่นัด)
```

### 5.3 Admin — งานหลัก: ดูแลระบบ

```
login ด้วย username/password
  → /admin/users: สร้างบัญชี CM/CG ใหม่ (กำหนด Username/CID, Role, ผูก CG กับ CM ที่ดูแล)
  → /admin/patients: นำเข้า/แก้ไขข้อมูลผู้ป่วย master data, กำหนด PrimaryCgUserId/ResponsibleCmUserId
  → /admin/config: ตั้งค่า LINE Channel Access Token, Drive root folder, ทดสอบส่งข้อความ LINE
  → /admin/audit-log: ตรวจสอบกิจกรรมย้อนหลัง (login, แก้ไขข้อมูล, ลบ)
  → ปิดใช้งานบัญชี (Active=false) แทนการลบถาวร
```

---

## 6. Data Flow

### 6.1 บันทึกการเยี่ยมบ้าน (เคสหลัก)

```
[CG กรอกฟอร์ม step 1-3 บนมือถือ]
        │ (state อยู่ใน memory ของ SPA, save draft = เขียนลง IndexedDB เท่านั้น)
        ▼
[กด "บันทึกและส่ง"]
        │
        ├─ ออนไลน์ ──▶ POST visits.submit (text/plain + JSON string)
        │                     │
        │                     ▼
        │              [Apps Script doPost]
        │                     │ 1. parse JSON, ตรวจ token → requireUser_()
        │                     │ 2. requireRole_(['CG','CM','ADMIN'])
        │                     │ 3. ตรวจสิทธิ์: ถ้า CG ต้องเป็นเจ้าของผู้ป่วยนี้เท่านั้น
        │                     │ 4. LockService.getScriptLock() ครอบ append แถว
        │                     │ 5. เขียนแถวใหม่ลง Visits sheet, สถานะ = submitted
        │                     │ 6. อัปเดต Patients.Status (นัดวันนี้→เยี่ยมแล้ว)
        │                     │ 7. ตรวจ red-flag จากแบบประเมินที่แนบมาด้วย (ถ้ามี)
        │                     │ 8. ถ้ามี red-flag → เรียก LINE push ไปหา CM ที่รับผิดชอบ
        │                     │ 9. เขียน AuditLog แถวใหม่
        │                     ▼
        │              ตอบ { ok:true, data:{ visitId, ... } }
        │
        └─ ออฟไลน์ ──▶ เก็บ payload เข้า IndexedDB (status:"pending")
                              │
                              ▼ (เมื่อ network online event ยิง หรือทุก 60s)
                        [Sync Manager] วนส่งทีละรายการตามลำดับเวลา
                              │ สำเร็จ → ลบออกจาก queue, map tempId → visitId จริง
                              │ ล้มเหลว (4xx) → คงไว้ + แจ้งผู้ใช้ให้แก้ไข
                              │ ล้มเหลว (network) → ลองใหม่รอบถัดไป
```

### 6.2 แจ้งเตือนความเสี่ยงสูง

```
Visits/Assessments write สำเร็จ
        │
        ▼
[evaluateRiskFlags_(payload)]  ── ตรวจเงื่อนไข:
        │   - 9Q ข้อ 9 (คิดทำร้ายตัวเอง) > 0
        │   - 8Q verdict = "ความเสี่ยงสูง"
        │   - แผลกดทับ stage 3-4
        │   - ความเสี่ยงหกล้ม = "สูง"
        ▼
ถ้าเข้าเงื่อนไขอย่างน้อย 1 ข้อ:
        │ 1. หา ResponsibleCmUserId ของผู้ป่วย
        │ 2. หา LineUserId ของ CM คนนั้นจาก Users sheet
        │ 3. ถ้ามี LineUserId → UrlFetchApp POST ไป LINE Messaging API (push)
        │ 4. บันทึกผลการแจ้งเตือนลง Notifications sheet (Sent/Failed)
        │ 5. ถ้าไม่มี LineUserId → บันทึก log แจ้งว่าไม่ได้แจ้งเตือน (ไม่ error ทั้ง request)
```

---

## 7. Google Sheets Schema

> 1 Google Sheets file ชื่อ `LTC_SmartCare_DB` แชร์เฉพาะบัญชีที่ deploy Apps Script (ไม่แชร์ให้ผู้ใช้ปลายทางเห็นโดยตรง — ดู [§17](#17-security-pdpa-และ-audit-trail))
> คอลัมน์ที่ต่อท้ายด้วย `(JSON)` เก็บเป็น string JSON ใน 1 เซลล์

### 7.1 `Users`

| Column | Type | หมายเหตุ |
|---|---|---|
| UserId | string (PK) | `U-` + uuid สั้น |
| Role | enum | `ADMIN` \| `CM` \| `CG` \| `VIEWER` |
| Name | string | ชื่อแสดงผล |
| Username | string | ใช้ login (ADMIN/CM/VIEWER), unique, lowercase |
| PasswordHash | string | bcrypt/SHA-256 + salt (ดู [§17](#17-security-pdpa-และ-audit-trail)) |
| CID | string | ใช้ login (CG เท่านั้น), unique เมื่อมีค่า |
| Phone | string | ไม่บังคับ |
| LineUserId | string | ผูกมือโดย Admin/ผู้ใช้เอง, ใช้ยิง push message |
| Active | boolean | false = ปิดใช้งาน (ห้ามลบแถว) |
| CreatedAt | datetime ISO | |
| UpdatedAt | datetime ISO | |

### 7.2 `Patients`

| Column | Type | หมายเหตุ |
|---|---|---|
| PatientId | string (PK) | `P-` + uuid สั้น |
| HN | string | เลขประจำตัวผู้ป่วย, unique |
| CID | string | เลขบัตรประชาชนผู้ป่วย (แสดงแบบ mask ในทุก response ที่ไม่ใช่ admin) |
| Name | string | |
| Gender | enum | `ชาย` \| `หญิง` |
| BirthDate | date ISO | ใช้คำนวณอายุแบบ dynamic แทนการเก็บ Age ตรง ๆ |
| Village / Tambon / Amphoe / Changwat | string ×4 | |
| AdlGroup | enum | `ติดสังคม` \| `ติดบ้าน` \| `ติดเตียง` (คำนวณ derive จาก AdlScore ล่าสุดได้ แต่เก็บ cache ไว้เพื่อ query เร็ว) |
| AdlScore | number | คะแนน Barthel ล่าสุด (cache) |
| RiskLevel | enum | `ต่ำ` \| `ปานกลาง` \| `สูง` \| `สูงมาก` (cache จากแบบประเมินล่าสุด) |
| PrimaryCgUserId | string (FK→Users.UserId) | CG ผู้รับผิดชอบหลัก |
| ResponsibleCmUserId | string (FK→Users.UserId) | CM ผู้รับผิดชอบ |
| Status | enum | `นัดวันนี้` \| `เยี่ยมแล้ว` \| `เลยนัด` \| `ยังไม่นัด` |
| NextVisitDate | date ISO | |
| DriveFolderId | string | โฟลเดอร์ Drive เก็บไฟล์ของผู้ป่วยคนนี้ (lazy-create ครั้งแรกที่ upload) |
| IsDeleted | boolean | soft delete |
| CreatedAt / UpdatedAt | datetime ISO | |

### 7.3 `Visits`

| Column | Type | หมายเหตุ |
|---|---|---|
| VisitId | string (PK) | `V-` + uuid สั้น |
| PatientId | string (FK→Patients.PatientId) | |
| VisitedByUserId | string (FK→Users.UserId) | |
| VisitNumber | number | ลำดับครั้งที่เยี่ยมของผู้ป่วยคนนี้ |
| VisitDate | datetime ISO | |
| GpsLat / GpsLng | number | |
| CaregiverName / Relation | string | ผู้ดูแลหลักที่พบ ณ วันเยี่ยม |
| BP / HR / Temp / SpO2 | string/number | vital signs |
| HasWound | boolean\|null | |
| WoundLocation / WoundStage / WoundSize / WoundCare | string | เฉพาะเมื่อ HasWound=true |
| WoundPhotoFileIds (JSON) | string | `{ before, after, woundPhoto }` → Drive fileId |
| Symptoms (JSON) | string | `["ไข้","ไอ",...]` |
| Medication / Nutrition / Excretion / Sleep | string | ตาม dropdown options ใน prototype |
| FallRiskNote / CaregiverBurdenNote | string | ค่าจาก dropdown สั้น (ไม่ใช่แบบประเมินเต็ม) |
| ServicesGiven (JSON) | string | `["ทำแผล","กายภาพเบื้องต้น",...]` |
| Notes | string | คำแนะนำ/แผนติดตาม |
| NextVisitDate | date ISO | |
| SignatureFileId | string | Drive fileId ของลายเซ็น |
| Status | enum | `draft` \| `submitted` |
| SyncedFromOffline | boolean | true ถ้ามาจาก offline queue |
| ClientTempId | string | tempId ฝั่ง client ตอนบันทึก offline (ใช้ map กลับ) |
| CreatedAt / UpdatedAt | datetime ISO | |

### 7.4 `Assessments_Barthel`

| Column | Type |
|---|---|
| AssessmentId (PK) | string |
| PatientId (FK) | string |
| VisitId (FK, nullable) | string |
| AssessedByUserId (FK) | string |
| Answers (JSON) | `{ feeding:2, bathing:1, ... }` |
| TotalScore | number (0–20) |
| Group | `ติดสังคม` \| `ติดบ้าน` \| `ติดเตียง` |
| CreatedAt | datetime ISO |

### 7.5 `Assessments_Depression` (2Q/9Q/8Q)

| Column | Type |
|---|---|
| AssessmentId (PK) | string |
| PatientId (FK) | string |
| VisitId (FK, nullable) | string |
| AssessedByUserId (FK) | string |
| TwoQAnswers (JSON) | `{ q1:bool, q2:bool }` |
| NineQAnswers (JSON) | `{ q1:0-3, ..., q9:0-3 }` (null ถ้าไม่ต้องประเมิน) |
| NineQTotal | number\|null |
| EightQAnswers (JSON) | `{ q1:bool, ..., q8:bool }` (null ถ้าไม่ต้องประเมิน) |
| EightQTotal | number\|null |
| EightQVerdict | string\|null |
| AlertSent | boolean |
| CreatedAt | datetime ISO |

### 7.6 `Assessments_FallRisk` / `Assessments_CaregiverBurden`

(โครงสร้างเหมือนกัน ใช้คนละ sheet เพื่อ query ง่าย)

| Column | Type |
|---|---|
| AssessmentId (PK) | string |
| PatientId (FK) | string |
| VisitId (FK, nullable) | string |
| AssessedByUserId (FK) | string |
| Answers (JSON) | `{ q1:bool, ..., q5:bool }` |
| TotalScore | number |
| Verdict | string |
| CreatedAt | datetime ISO |

### 7.7 `Assessments_PressureUlcer`

| Column | Type |
|---|---|
| AssessmentId (PK) | string |
| PatientId (FK) | string |
| VisitId (FK, nullable) | string |
| AssessedByUserId (FK) | string |
| HasWound | boolean |
| Location / Size | string |
| CreatedAt | datetime ISO |

### 7.8 `Sessions`

| Column | Type |
|---|---|
| Token (PK) | string (UUID) |
| UserId (FK) | string |
| CreatedAt | datetime ISO |
| ExpiresAt | datetime ISO (12 ชม. ปกติ / 30 วัน ถ้า "จดจำฉัน") |
| LastActiveAt | datetime ISO |
| DeviceInfo | string (User-Agent สั้น) |

### 7.9 `Config`

| Column | Type | หมายเหตุ |
|---|---|---|
| Key (PK) | string | เช่น `DRIVE_ROOT_FOLDER_ID`, `APP_VERSION` |
| Value | string | **ห้ามเก็บ secret ที่นี่** (secret → Script Properties) |
| UpdatedAt | datetime ISO | |

### 7.10 `AuditLog`

| Column | Type |
|---|---|
| LogId (PK) | string |
| Timestamp | datetime ISO |
| UserId (FK) | string |
| Action | string (เช่น `visits.submit`, `auth.login`, `patients.update`) |
| TargetType | string (`Patient`\|`Visit`\|`User`\|...) |
| TargetId | string |
| Detail (JSON) | string |

### 7.11 `Notifications`

| Column | Type |
|---|---|
| NotificationId (PK) | string |
| RecipientUserId (FK) | string |
| Type | string (`RISK_ALERT`, ...) |
| Message | string |
| RelatedPatientId (FK) | string |
| Channel | `LINE` |
| Status | `sent` \| `failed` \| `skipped_no_line_id` |
| CreatedAt | datetime ISO |

---

## 8. Primary Key / Logical Foreign Key

> Google Sheets ไม่มี FK constraint จริง — ทุกความสัมพันธ์ด้านล่าง **ต้อง validate ที่ backend ทุกครั้งก่อนเขียน** (เช่น ตรวจว่า PatientId ที่อ้างถึงมีอยู่จริงและยังไม่ถูกลบ)

| Sheet | Primary Key | Logical Foreign Key |
|---|---|---|
| Users | UserId | — |
| Patients | PatientId | PrimaryCgUserId → Users.UserId; ResponsibleCmUserId → Users.UserId |
| Visits | VisitId | PatientId → Patients.PatientId; VisitedByUserId → Users.UserId |
| Assessments_Barthel | AssessmentId | PatientId → Patients.PatientId; VisitId → Visits.VisitId; AssessedByUserId → Users.UserId |
| Assessments_Depression | AssessmentId | PatientId → Patients.PatientId; VisitId → Visits.VisitId; AssessedByUserId → Users.UserId |
| Assessments_FallRisk | AssessmentId | PatientId → Patients.PatientId; VisitId → Visits.VisitId; AssessedByUserId → Users.UserId |
| Assessments_CaregiverBurden | AssessmentId | PatientId → Patients.PatientId; VisitId → Visits.VisitId; AssessedByUserId → Users.UserId |
| Assessments_PressureUlcer | AssessmentId | PatientId → Patients.PatientId; VisitId → Visits.VisitId; AssessedByUserId → Users.UserId |
| Sessions | Token | UserId → Users.UserId |
| Config | Key | — |
| AuditLog | LogId | UserId → Users.UserId |
| Notifications | NotificationId | RecipientUserId → Users.UserId; RelatedPatientId → Patients.PatientId |

**กติกาการลบ:** ทุก entity ใช้ soft delete (`IsDeleted`/`Active` flag) ห้ามลบแถวจริง เพื่อรักษาความสมบูรณ์ของ FK เชิงตรรกะและ audit trail

---

## 9. API Contract

**Endpoint เดียว:** `POST {WEB_APP_URL}/exec` — ทุก action ส่งผ่าน field `action` ใน body (ไม่ใช้ REST path แยก เพราะ Apps Script Web App รองรับ path routing ไม่ได้ดีพอ)

**Request envelope (ทุก action):**
```json
{
  "action": "namespace.verb",
  "token": "string | null",
  "payload": { }
}
```

**Response envelope (ทุก action):**
```json
{ "ok": true, "data": { } }
```
หรือ
```json
{ "ok": false, "code": "ERR_XXX", "message": "ข้อความภาษาไทยสำหรับผู้ใช้" }
```

### รายการ Action ทั้งหมด (Phase 1)

| Action | Role ที่เรียกได้ | คำอธิบาย |
|---|---|---|
| `auth.login` | ทุกคน (ไม่ต้องมี token) | login ด้วย CID หรือ username/password |
| `auth.logout` | ผู้ที่ login แล้ว | ลบ session |
| `auth.me` | ผู้ที่ login แล้ว | ดึงข้อมูลโปรไฟล์ตนเอง + ตรวจ token ยัง valid |
| `patients.list` | ADMIN, CM, CG, VIEWER | รายชื่อผู้ป่วย (กรองตามสิทธิ์อัตโนมัติที่ backend) |
| `patients.get` | ADMIN, CM, CG, VIEWER | รายละเอียดผู้ป่วย + ADL history + visit log ล่าสุด |
| `patients.create` | ADMIN, CM | สร้างผู้ป่วยใหม่ |
| `patients.update` | ADMIN, CM | แก้ไข master data ผู้ป่วย |
| `patients.delete` | ADMIN | soft delete |
| `visits.saveDraft` | ADMIN, CM, CG | บันทึก draft (upsert ตาม ClientTempId) |
| `visits.submit` | ADMIN, CM, CG | ส่งการเยี่ยมฉบับสมบูรณ์ (trigger risk check) |
| `visits.listByPatient` | ADMIN, CM, CG, VIEWER | ประวัติการเยี่ยมของผู้ป่วยคนหนึ่ง |
| `assessments.saveBarthel` | ADMIN, CM, CG | บันทึกผล Barthel ADL |
| `assessments.saveDepression` | ADMIN, CM, CG | บันทึกผล 2Q/9Q/8Q (trigger risk check) |
| `assessments.saveFallRisk` | ADMIN, CM, CG | บันทึกผลความเสี่ยงหกล้ม (trigger risk check) |
| `assessments.saveCaregiverBurden` | ADMIN, CM, CG | บันทึกผล Caregiver Burden |
| `assessments.savePressureUlcer` | ADMIN, CM, CG | บันทึกผลความเสี่ยงแผลกดทับ (trigger risk check) |
| `assessments.listByPatient` | ADMIN, CM, CG, VIEWER | ประวัติแบบประเมินทั้งหมดของผู้ป่วยคนหนึ่ง |
| `files.upload` | ADMIN, CM, CG | อัปโหลดไฟล์ภาพ (base64) → คืน fileId/url |
| `users.updateLineId` | ทุกคน (เฉพาะของตนเอง), ADMIN (ของทุกคน) | ผูก/แก้ไข LineUserId |
| `admin.users.list` | ADMIN | รายชื่อผู้ใช้ทั้งหมด |
| `admin.users.create` | ADMIN | สร้างผู้ใช้ใหม่ |
| `admin.users.update` | ADMIN | แก้ไข role/สถานะผู้ใช้ |
| `admin.auditLog.list` | ADMIN | ดู audit log (มี pagination) |
| `admin.config.get` / `admin.config.set` | ADMIN | อ่าน/แก้ไขค่า config ที่ไม่ใช่ secret |
| `admin.notifications.test` | ADMIN | ทดสอบส่ง LINE push ไปยัง LineUserId ที่ระบุ |

---

## 10. Request/Response JSON

### 10.1 `auth.login` (CG)

Request:
```json
{
  "action": "auth.login",
  "token": null,
  "payload": { "mode": "cg", "cid": "1234567890123" }
}
```
Response (สำเร็จ):
```json
{
  "ok": true,
  "data": {
    "token": "b6e2b6b0-....",
    "expiresAt": "2026-07-13T02:00:00.000Z",
    "user": { "userId": "U-001", "name": "นางสาวมณี รักงาน", "role": "CG" }
  }
}
```

### 10.2 `auth.login` (Staff)

Request:
```json
{
  "action": "auth.login",
  "token": null,
  "payload": { "mode": "staff", "username": "cm001", "password": "plain-text-over-https", "rememberMe": true }
}
```
Response (ผิดพลาด):
```json
{ "ok": false, "code": "ERR_AUTH_INVALID", "message": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }
```

### 10.3 `patients.list`

Request:
```json
{
  "action": "patients.list",
  "token": "b6e2b6b0-....",
  "payload": { "search": "สมศรี", "status": "นัดวันนี้", "page": 1, "pageSize": 20 }
}
```
Response:
```json
{
  "ok": true,
  "data": {
    "total": 1,
    "items": [
      {
        "patientId": "P-001", "hn": "HN00123", "name": "นางสมศรี ใจดี",
        "age": 78, "village": "บ้านดง ต.เมือง", "adlGroup": "ติดสังคม",
        "riskLevel": "ปานกลาง", "status": "นัดวันนี้"
      }
    ]
  }
}
```

### 10.4 `visits.submit`

Request:
```json
{
  "action": "visits.submit",
  "token": "b6e2b6b0-....",
  "payload": {
    "clientTempId": "tmp-9f1c",
    "patientId": "P-001",
    "gps": { "lat": 16.4419, "lng": 102.8360 },
    "caregiverName": "นางสาวทดสอบ", "relation": "บุตรสาว",
    "bp": "120/80", "hr": "78", "temp": "36.8", "spo2": "98",
    "hasWound": true,
    "wound": { "location": "ก้นกบ", "stage": "2", "size": "3x2 ซม.", "care": "ทำแผลวันเว้นวัน" },
    "symptoms": ["ไข้", "บวม"],
    "medication": "ครบถ้วนตามแผน", "nutrition": "ปกติ", "excretion": "ปกติ", "sleep": "หลับปกติ",
    "fallRisk": "ปานกลาง", "caregiverBurden": "น้อย",
    "servicesGiven": ["ทำแผล", "ตรวจวัดสัญญาณชีพ"],
    "notes": "แนะนำพลิกตะแคงตัวทุก 2 ชม.",
    "nextVisitDate": "2026-07-26",
    "woundPhotoFileIds": { "before": "1AbC...", "after": "1XyZ..." },
    "signatureFileId": "1SigN..."
  }
}
```
Response:
```json
{
  "ok": true,
  "data": {
    "visitId": "V-00042",
    "visitNumber": 4,
    "patientStatus": "เยี่ยมแล้ว",
    "riskAlertTriggered": false
  }
}
```

### 10.5 `assessments.saveDepression` (กรณี trigger alert)

Request (บางส่วน):
```json
{
  "action": "assessments.saveDepression",
  "token": "b6e2b6b0-....",
  "payload": {
    "patientId": "P-003", "visitId": "V-00051",
    "twoQAnswers": { "q1": true, "q2": true },
    "nineQAnswers": { "q1":2,"q2":1,"q3":2,"q4":1,"q5":0,"q6":1,"q7":0,"q8":0,"q9":1 }
  }
}
```
Response:
```json
{
  "ok": true,
  "data": {
    "assessmentId": "A-DEP-0007",
    "nineQTotal": 8,
    "eightQRequired": true,
    "riskAlertTriggered": true,
    "notification": { "status": "sent", "recipient": "U-002" }
  }
}
```

### 10.6 `files.upload`

Request:
```json
{
  "action": "files.upload",
  "token": "b6e2b6b0-....",
  "payload": {
    "patientId": "P-001",
    "category": "wound_before",
    "mimeType": "image/jpeg",
    "fileName": "wound_20260712.jpg",
    "base64Data": "/9j/4AAQSkZJRgABAQAAAQABAAD..."
  }
}
```
Response:
```json
{
  "ok": true,
  "data": { "fileId": "1AbCDefGhIJK", "viewUrl": "https://drive.google.com/uc?id=1AbCDefGhIJK" }
}
```

### 10.7 Error ตัวอย่าง (session หมดอายุ)

```json
{ "ok": false, "code": "ERR_SESSION_EXPIRED", "message": "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" }
```

---

## 11. Error Codes

| Code | HTTP-equivalent | ความหมาย | Frontend ควรทำ |
|---|---|---|---|
| `ERR_AUTH_REQUIRED` | 401 | ไม่มี token แนบมา | เด้งไปหน้า login |
| `ERR_AUTH_INVALID` | 401 | credential ไม่ถูกต้อง | แสดงข้อความใต้ฟอร์ม login |
| `ERR_SESSION_EXPIRED` | 401 | token หมดอายุ/ไม่พบใน Sessions sheet | ลบ token ใน localStorage, เด้ง login |
| `ERR_FORBIDDEN` | 403 | role/ownership ไม่ผ่าน (เช่น CG พยายามแก้ผู้ป่วยที่ไม่ใช่ของตน) | แสดง toast "ไม่มีสิทธิ์" |
| `ERR_VALIDATION` | 422 | payload ไม่ผ่านการตรวจสอบ (มี `fields: {field: message}` แนบใน data) | แสดง error ใต้ฟิลด์ที่เกี่ยวข้อง |
| `ERR_NOT_FOUND` | 404 | ไม่พบ record (PatientId/VisitId ไม่มีจริงหรือถูกลบ) | แสดง toast, พากลับหน้าก่อนหน้า |
| `ERR_CONFLICT` | 409 | เช่น Username/CID ซ้ำตอนสร้างผู้ใช้ | แสดง toast แจ้งค่าซ้ำ |
| `ERR_LOCK_TIMEOUT` | 423 | `LockService` รอคิวเขียนนานเกินไป | ให้ retry อัตโนมัติ 1 ครั้ง แล้วแจ้งผู้ใช้ |
| `ERR_FILE_TOO_LARGE` | 413 | ไฟล์เกิน 5MB หลังบีบอัด | แจ้งผู้ใช้บีบอัด/ถ่ายใหม่ |
| `ERR_RATE_LIMIT` | 429 | เกิน quota การเรียก (Phase 2+ เมื่อเปิดใช้ throttle) | หน่วงแล้ว retry |
| `ERR_SERVER` | 500 | error ไม่คาดคิดฝั่ง backend (log ไว้ที่ Stackdriver) | แสดง toast ทั่วไป "เกิดข้อผิดพลาด กรุณาลองใหม่" |

> ทุก error message ที่ frontend แสดงต้องเป็นภาษาไทยที่ผู้ใช้เข้าใจได้ — backend log รายละเอียด technical เป็นภาษาอังกฤษเข้า Stackdriver เท่านั้น (แยกกันตาม `rules/logging-boundaries.md` ของ gas-best-practices)

---

## 12. Frontend/Backend Folder Structure

### Frontend (repo แยก หรือ branch `gh-pages`, deploy บน GitHub Pages)

```
/ (repo root = GitHub Pages root)
├── index.html                  # app shell, โหลด manifest + service worker
├── manifest.webmanifest        # PWA metadata, icons, theme color
├── service-worker.js           # cache app shell + assets สำหรับ offline load
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── icons/                  # PWA icons หลายขนาด
│   └── js/
│       ├── app.js              # bootstrap: mount root component, router init
│       ├── api.js              # fetch() wrapper: ยิง action, แนบ token, จัดการ error envelope
│       ├── auth.js             # login/logout, จัดการ token ใน localStorage
│       ├── router.js           # hash-based routing ผูกกับ sitemap ใน §4
│       ├── state/
│       │   └── store.js        # global state (user, patients cache, ฯลฯ)
│       ├── offline/
│       │   ├── db.js           # IndexedDB wrapper (queue เก็บ visits/assessments)
│       │   └── sync.js         # sync manager: online event + periodic retry
│       ├── screens/
│       │   ├── login.js
│       │   ├── dashboard.js
│       │   ├── patients-list.js
│       │   ├── patient-detail.js
│       │   ├── visit-form.js
│       │   ├── assessments-hub.js
│       │   └── assessments/
│       │       ├── depression.js
│       │       ├── barthel.js
│       │       ├── fallrisk.js
│       │       ├── pressureulcer.js
│       │       └── caregiverburden.js
│       └── admin/
│           ├── users.js
│           ├── audit-log.js
│           └── config.js
└── BLUEPRINT.md                # เอกสารนี้ (หรือเก็บใน /docs)
```

### Backend (clasp project แยกจาก frontend repo)

```
backend/
├── .clasp.json
├── appsscript.json              # webapp.access = ANYONE_ANONYMOUS, executeAs = USER_DEPLOYING
├── Main.js                      # doGet (health check) / doPost (action router) + CORS-safe response helper
├── Auth.js                      # auth.login / auth.logout / auth.me, requireUser_, requireRole_
├── Patients.js                  # patients.* handlers
├── Visits.js                    # visits.* handlers + evaluateRiskFlags_
├── Assessments.js                # assessments.* handlers (ทั้ง 5 ชุด)
├── Files.js                      # files.upload, Drive folder lazy-create ต่อ patient
├── Notifications.js              # ยิง LINE Messaging API + เขียน Notifications sheet
├── AdminUsers.js                  # admin.users.*
├── AdminAuditLog.js               # admin.auditLog.*
├── AdminConfig.js                  # admin.config.*
├── SheetRepo.js                  # helper อ่าน/เขียน Sheets แบบรวมศูนย์ (getSheet_, appendRow_, findRowById_)
├── Config.js                     # getConfig_, getSecret_ (Script Properties), lazy folder creation
├── AuditLog.js                    # logAudit_ ใช้ร่วมทุก handler
└── Utils.js                      # ok_(data) / err_(code, message), uuid_(), validators
```

> โครงสร้างนี้ยึดตาม `rules/project-structure.md` ของ gas-best-practices — แยกไฟล์ตาม domain ไม่ใช่ตาม type, ทุกไฟล์ `.js` ชื่อ PascalCase ไม่มีเว้นวรรค

---

## 13. Authentication และ Session Flow

### หลักการ

Frontend อยู่คนละ origin กับ backend และ CG ไม่ได้ login ด้วย Google Account ⇒ **ห้ามพึ่ง `Session.getActiveUser()`** ต้องทำระบบ token เอง (อ้างอิง `rules/web-app-rpc.md` §3 ของ gas-best-practices)

### ขั้นตอน

```
1. Client → auth.login { mode, cid | (username+password) }
2. Backend ตรวจสอบ:
   - mode=cg: หา Users row ที่ Role=CG และ CID ตรงกัน และ Active=true
   - mode=staff: หา Users row ที่ Username ตรงกัน (case-insensitive), ตรวจ PasswordHash, Active=true
3. ถ้าผ่าน: สร้างแถวใหม่ใน Sessions
   - Token = Utilities.getUuid()
   - ExpiresAt = now + 12h (ปกติ) หรือ now + 30d (rememberMe=true)
4. ตอบ { token, expiresAt, user } กลับไป
5. Client เก็บ token + user profile ใน localStorage (key: "ltc_session")
6. ทุก request ถัดไปแนบ token ใน payload envelope (§9)
7. Backend ทุก handler ที่ต้อง auth เรียก requireUser_(token) ก่อนเสมอ:
   - หา Sessions row ตาม Token
   - ถ้าไม่พบ หรือ ExpiresAt < now → คืน ERR_SESSION_EXPIRED
   - ถ้าพบ → อัปเดต LastActiveAt, คืน user object (จาก Users sheet)
8. requireRole_(user, allowedRoles) ตรวจสิทธิ์ต่อจาก requireUser_
9. Logout: auth.logout { token } → ลบแถวใน Sessions (ฝั่ง client ลบ localStorage ด้วย)
```

### กติกาเสริม

- Password ของ Staff เก็บเป็น hash (SHA-256 + per-user salt เป็นขั้นต่ำ Phase 1; พิจารณา bcrypt ผ่าน external library หรือย้ายไป Phase 2 ถ้า Apps Script native crypto ไม่พอ)
- CG ไม่มี "password" — ความปลอดภัยของโหมดนี้ต่ำกว่า staff โดยเจตนา (ใช้ CID เป็น identifier ในบริบทเดียวกับ prototype) — ต้อง**จำกัดสิทธิ์ CG ให้แคบที่สุด**เพื่อลดความเสี่ยง (ดู [§17](#17-security-pdpa-และ-audit-trail))
- Session ต่อ device ไม่ต่อ concurrent-session limit ใน Phase 1 (เพิ่มใน Phase 2 ถ้าจำเป็น)
- Frontend ต้องดักทุก response ที่ `code === "ERR_SESSION_EXPIRED"` แล้วเคลียร์ state พา user กลับหน้า login พร้อมข้อความอธิบาย

---

## 14. Offline/Sync Strategy

### เป้าหมาย

CG ทำงานในพื้นที่สัญญาณไม่ดี ต้องกรอกฟอร์มและถ่ายรูปได้แม้ไม่มีเน็ต แล้ว sync อัตโนมัติภายหลัง

### กลไก

1. **App shell caching:** Service Worker cache-first สำหรับ HTML/CSS/JS/icons (ทำให้เปิดแอปได้แม้ไม่มีเน็ต) — ไม่ cache API response
2. **Local queue:** ใช้ **IndexedDB** (ไม่ใช้ localStorage เพราะรูปภาพ base64 มีขนาดใหญ่เกิน localStorage quota ~5-10MB) สอง object store:
   - `pendingVisits` — key: `clientTempId`
   - `pendingAssessments` — key: `clientTempId`
   แต่ละ record มี field `status`: `pending` \| `syncing` \| `synced` \| `error`
3. **Save Draft** (ทุกปุ่ม "บันทึก Draft" ในฟอร์ม): เขียนลง IndexedDB เสมอ ไม่ยิง API (ลด round-trip) — sync เฉพาะตอน "บันทึกและส่ง"
4. **Submit ตอนออนไลน์:** ยิง API ทันที ถ้าสำเร็จไม่ต้องเข้าคิว
5. **Submit ตอนออฟไลน์:** ใส่คิวด้วย `status:"pending"` + toast แจ้งผู้ใช้ทันที (ต้องรู้สึกว่า "บันทึกแล้ว" แม้ยังไม่ sync จริง)
6. **Sync Manager** (`offline/sync.js`):
   - ผูกกับ `window.addEventListener('online', trySync)`
   - Interval สำรอง (ทุก 60 วินาทีขณะแอปเปิดอยู่หน้าจอ) เพราะ `online` event เชื่อถือได้ไม่ 100% บนมือถือ
   - วนส่งทีละรายการตามลำดับเวลาเข้าคิว (กัน visit ผิดลำดับ VisitNumber)
   - สำเร็จ → ลบออกจากคิว, บันทึก mapping `clientTempId → serverId` ไว้แสดงผลอ้างอิง
   - ผิดพลาดแบบ validation (`ERR_VALIDATION`, `ERR_FORBIDDEN`) → เปลี่ยน status เป็น `error` ค้างไว้ให้ผู้ใช้แก้ไขเอง ไม่ retry อัตโนมัติ
   - ผิดพลาดแบบ network/5xx → คง `pending` ไว้ retry รอบถัดไป
7. **Conflict resolution:** Phase 1 ใช้ **append-only** (แต่ละการเยี่ยม/แบบประเมินคือแถวใหม่เสมอ ไม่มีการ "แก้ไขทับ" ของเดิม) จึงไม่มี conflict ระดับข้อมูลจริง ๆ — สิ่งที่ต้องระวังคือ ส่งซ้ำ (duplicate) เมื่อ retry: backend ต้อง **idempotent ด้วย `clientTempId`** (ถ้าเคยมี VisitId ที่ผูกกับ clientTempId นี้แล้ว ให้คืนของเดิมแทนสร้างใหม่)
8. **แสดงสถานะ sync ให้ผู้ใช้เห็น:** badge เล็ก ๆ ที่มุมแอป (จำนวนรายการค้าง sync) + banner "ออฟไลน์ — ข้อมูลจะถูกส่งเมื่อกลับมามีสัญญาณ"

### ขอบเขตที่ยังไม่ทำใน Phase 1

- ไม่ใช้ Web Background Sync API (browser support ไม่ทั่วถึงในมือถือ Android WebView บางรุ่น) — ใช้ manual/interval แทนไปก่อน (ยกระดับใน Phase 7)
- ไม่รองรับแก้ไขข้อมูลที่ sync ไปแล้วแบบออฟไลน์ (ต้องออนไลน์เท่านั้นถึงจะแก้ visit ที่ submit แล้ว)

---

## 15. File Upload Flow

### ประเภทไฟล์ที่ต้องรองรับ

- รูปแผลกดทับ (1 รูป)
- รูปก่อน/หลังการดูแล (2 รูป)
- ลายเซ็น (วาดบน canvas → export เป็นรูป)

### ขั้นตอน

```
1. [Client] ผู้ใช้ถ่ายรูป/เลือกไฟล์ (input type=file capture หรือ canvas.toDataURL สำหรับลายเซ็น)
2. [Client] บีบอัดด้วย <canvas> ก่อนเสมอ:
   - resize ให้ด้านยาวสุดไม่เกิน 1200px
   - แปลงเป็น JPEG quality 0.8
   - เป้าหมายขนาดสุดท้าย < 800KB (บังคับ, ถ้ายังใหญ่ให้ลด quality ซ้ำจนต่ำกว่า)
3. [Client] ถ้าออนไลน์: เรียก files.upload ทันที (payload มี base64Data) → เก็บ fileId ที่ได้ไว้ใน state ของฟอร์ม
   ถ้าออฟไลน์: เก็บ base64 ไว้ใน IndexedDB ผูกกับ draft, upload พร้อม sync ตอน submit (upload ก่อน แล้วค่อยส่ง visits.submit ด้วย fileId ที่ได้)
4. [Backend] files.upload handler:
   a. requireUser_ + requireRole_(['ADMIN','CM','CG'])
   b. ตรวจขนาด base64 decode แล้วไม่เกิน 5MB → ถ้าเกิน คืน ERR_FILE_TOO_LARGE
   c. หาโฟลเดอร์ Drive ของผู้ป่วย (Patients.DriveFolderId) — ถ้ายังไม่มี ให้สร้างใต้ root folder (Config.DRIVE_ROOT_FOLDER_ID) แล้วอัปเดตกลับเข้า Patients sheet (lazy creation)
   d. decode Base64 → Blob → DriveApp.createFile ในโฟลเดอร์นั้น ตั้งชื่อไฟล์ `{category}_{patientId}_{timestamp}.jpg`
   e. ตั้งสิทธิ์ไฟล์: จำกัดเฉพาะบัญชีที่ deploy สคริปต์ (ไม่ share สาธารณะ) — ฝั่ง frontend ที่ต้องแสดงรูปให้ขอ URL ผ่าน backend endpoint ที่ตรวจสิทธิ์ก่อน stream ไฟล์ (ไม่ใช้ direct public link เพื่อรักษาความลับข้อมูลสุขภาพ)
   f. เขียน AuditLog
   g. ตอบ { fileId, viewUrl }
5. [Client] เก็บ fileId ใน payload ของ visits.submit / assessments.save*
```

### ข้อควรระวัง

- Payload รวมของ 1 request (รวม base64 ของรูป) ต้องไม่เกิน limit ของ Apps Script (~50MB) — แนะนำอัปโหลดทีละไฟล์แยก action `files.upload` แทนการฝังไฟล์ไปกับ `visits.submit` โดยตรง เพื่อไม่ให้ 1 request ใหญ่เกินไปและ retry ง่ายกว่า
- ลายเซ็น: ให้ export เป็น PNG พื้นหลังโปร่งใสหรือขาว ขนาดเล็ก (ไม่ต้องบีบอัดแบบ JPEG)

---

## 16. LINE Notification Flow

> **หมายเหตุสำคัญ:** ใช้ **LINE Messaging API (Push Message)** ไม่ใช่ LINE Notify — LINE Notify ถูกยกเลิกบริการไปแล้ว (สิ้นสุดบริการ 31 มี.ค. 2568/2025) จึงต้องสร้าง **LINE Official Account + Messaging API Channel** และใช้ Channel Access Token แทน

### การตั้งค่าเบื้องต้น (ทำครั้งเดียวตอน deploy)

1. สร้าง LINE Official Account ผ่าน LINE Developers Console
2. เปิดใช้งาน Messaging API ได้ Channel Access Token (long-lived)
3. เก็บ Channel Access Token ไว้ใน **Script Properties** (`LINE_CHANNEL_ACCESS_TOKEN`) — ห้ามเก็บใน Sheet
4. ผู้ใช้ (CM/Admin) ต้อง**เพิ่มเพื่อน**บัญชี Official Account นี้ แล้วนำ LINE User Id ของตนมากรอกใน `/settings` → บันทึกผ่าน `users.updateLineId` (Phase 1 ผูกด้วยมือ เพราะยังไม่มี LINE Login — ดู Phase 2)

### เงื่อนไขการแจ้งเตือน (red-flag rules)

| เงื่อนไข | เกิดขึ้นตอนบันทึก action ไหน |
|---|---|
| 9Q ข้อ 9 (คิดทำร้ายตัวเอง) มีคะแนน > 0 | `assessments.saveDepression` |
| 8Q verdict = "ความเสี่ยงสูง — ควรส่งต่อทันที" | `assessments.saveDepression` (เมื่อมี eightQAnswers แนบมา) |
| แผลกดทับ stage 3 หรือ 4 | `visits.submit`, `assessments.savePressureUlcer` |
| ความเสี่ยงหกล้ม = "สูง" | `assessments.saveFallRisk` |

### ขั้นตอนการยิงแจ้งเตือน

```
1. Handler ที่เกี่ยวข้อง เรียก evaluateRiskFlags_(payload) หลังเขียนข้อมูลสำเร็จ
2. ถ้า true อย่างน้อย 1 เงื่อนไข:
   a. หา Patients.ResponsibleCmUserId
   b. หา Users.LineUserId ของ CM คนนั้น
   c. ถ้ามี LineUserId:
      - สร้างข้อความสรุป (ชื่อผู้ป่วย, เงื่อนไขที่ trigger, เวลา, ลิงก์เปิดแอปตรงไปหน้าผู้ป่วย)
      - UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
          method: 'post',
          headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
          contentType: 'application/json',
          payload: JSON.stringify({ to: lineUserId, messages: [{ type:'text', text: message }] })
        })
      - บันทึกผลลง Notifications sheet (status: sent/failed ตาม HTTP status ที่ได้กลับ)
   d. ถ้าไม่มี LineUserId: บันทึก Notifications สถานะ `skipped_no_line_id` (ไม่ throw error, ไม่กระทบผลลัพธ์หลักของ request)
3. Response ของ action หลักแนบ `riskAlertTriggered: true/false` และ (ถ้ามี) `notification.status` ให้ frontend แสดงผล
```

### Fallback (Phase 1)

- ถ้ายิง LINE ล้มเหลว (network/token หมดอายุ) → log ไว้เฉย ๆ ไม่ retry อัตโนมัติ (เพิ่ม retry queue ใน Phase 2)
- ยังไม่มีช่องทางสำรอง (SMS/email) ใน Phase 1

---

## 17. Security, PDPA และ Audit Trail

### Security

- **Google Sheet (DB) ต้องไม่แชร์กับใครนอกจากบัญชีที่ deploy Apps Script** — การเข้าถึงข้อมูลทั้งหมดต้องผ่าน API layer ที่มี role check เท่านั้น ห้ามให้ผู้ใช้ปลายทางมีสิทธิ์เปิดไฟล์ Sheet ตรง ๆ เด็ดขาด
- Secret ทั้งหมด (LINE Channel Access Token, salt สำหรับ hash) เก็บใน **Script Properties** ไม่เก็บใน Sheet หรือใน โค้ด/`appsscript.json`
- Password ของ Staff เก็บเป็น hash เท่านั้น ไม่เก็บ plain text แม้แต่ใน log
- ทุก endpoint ที่ mutate ข้อมูลต้องผ่าน `requireUser_` + `requireRole_` + ตรวจ ownership (CG ทำได้เฉพาะผู้ป่วยของตน)
- ใช้ `LockService` ครอบทุก append เพื่อกัน race condition
- HTTPS บังคับทั้งสองฝั่ง (GitHub Pages และ Apps Script `/exec` เป็น HTTPS โดย default)
- Rate limiting เบื้องต้น (Phase 2): ใช้ `CacheService` นับจำนวน request ต่อ token ต่อนาที

### PDPA (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล)

ระบบเก็บ**ข้อมูลสุขภาพและเลขบัตรประชาชน** ซึ่งเป็นข้อมูลอ่อนไหว (Sensitive Personal Data) ตาม พ.ร.บ. PDPA ต้องมี:

1. **Consent notice** หน้าจอ login ครั้งแรก: แจ้งวัตถุประสงค์การเก็บข้อมูล (เพื่อการดูแลผู้มีภาวะพึ่งพิงในชุมชน), ขอบเขตผู้เข้าถึง (CG/CM/Admin ที่เกี่ยวข้องเท่านั้น), สิทธิของเจ้าของข้อมูล
2. **Data minimization ในการแสดงผล:** เลขบัตรประชาชนแสดงแบบ mask (`1-XXXX-XXXXX-012-X`) ในทุกหน้าจอ ยกเว้น Admin ที่ต้องจัดการบัญชีจริง
3. **Data retention:** กำหนดนโยบาย (เช่น เก็บ 5 ปีหลังผู้ป่วยพ้นทะเบียน) — Phase 1 บันทึกไว้เป็นนโยบาย ยังไม่ implement auto-purge (Phase 9)
4. **สิทธิขอลบ/แก้ไขข้อมูล:** ผ่าน soft-delete โดย Admin + มี audit log บันทึกการลบ/แก้ไขทุกครั้ง
5. **จำกัดผู้เข้าถึงตามหน้าที่ (need-to-know):** enforce ด้วย Permission Matrix ใน [§3](#3-user-roles-และ-permission-matrix)
6. **แจ้งเหตุข้อมูลรั่วไหล:** มี AuditLog เป็นหลักฐานประกอบการสอบสวนหากเกิดเหตุ

### Audit Trail

ทุก action ต่อไปนี้ต้องเขียนลง `AuditLog` เสมอ (ไม่ใช่แค่ mutation):

- `auth.login` (สำเร็จ/ล้มเหลว), `auth.logout`
- `patients.create`, `patients.update`, `patients.delete`
- `visits.submit`
- `assessments.save*` (ทุกชนิด)
- `files.upload`
- `admin.users.create`, `admin.users.update`
- `admin.config.set`

รูปแบบ Detail (JSON) ควรมีอย่างน้อย: ฟิลด์ที่เปลี่ยน (ถ้าเป็น update), ผลลัพธ์ (success/fail), เหตุผลถ้า fail

---

## 18. Deployment Checklist

- [ ] สร้าง Google Sheet ชื่อ `LTC_SmartCare_DB` พร้อมทุก tab ตาม [§7](#7-google-sheets-schema) (ใส่ header row ให้ตรง column ทุกตัว)
- [ ] ตั้งค่าการแชร์ Sheet ให้ private เฉพาะบัญชีที่ใช้ deploy Apps Script
- [ ] สร้าง Apps Script project (แนบกับ Sheet หรือ standalone ก็ได้ แต่ standalone ยืดหยุ่นกว่า) ตามโครงสร้าง [§12](#12-frontendbackend-folder-structure)
- [ ] ตั้งค่า Script Properties: `LINE_CHANNEL_ACCESS_TOKEN`, `PASSWORD_SALT` (หรือค่าที่ใช้ hash)
- [ ] สร้างโฟลเดอร์ Drive root สำหรับเก็บไฟล์ผู้ป่วย → บันทึก FolderId ลง `Config.DRIVE_ROOT_FOLDER_ID`
- [ ] ตั้งค่า `appsscript.json`: `webapp.executeAs = USER_DEPLOYING`, `webapp.access = ANYONE_ANONYMOUS`, `timeZone = Asia/Bangkok`, `runtimeVersion = V8`
- [ ] Deploy เป็น Web App → คัดลอก URL `/exec` (deployment ใหม่ทุกครั้งที่แก้ backend ต้อง deploy version ใหม่ ไม่ใช่แค่ push — HEAD deployment ใช้ได้เฉพาะช่วง dev/test)
- [ ] สร้างบัญชี Admin คนแรกด้วยมือโดยตรงใน `Users` sheet (PasswordHash ต้องคำนวณด้วยฟังก์ชัน hash เดียวกับที่ backend ใช้ตรวจ)
- [ ] อัปเดต `assets/js/api.js` ฝั่ง frontend ให้ชี้ไปที่ URL `/exec` ที่ deploy จริง
- [ ] Push โค้ด frontend ขึ้น GitHub repo, เปิดใช้ GitHub Pages (branch/โฟลเดอร์ที่ถูกต้อง)
- [ ] ทดสอบ CORS จริงจาก origin ของ GitHub Pages (ไม่ใช่จาก `file://` หรือ localhost เพราะพฤติกรรม CORS ต่างกัน)
- [ ] ทดสอบ login ทั้ง 2 โหมด (CG ด้วย CID, Staff ด้วย username/password)
- [ ] ทดสอบ flow บันทึกการเยี่ยมครบ 3 ขั้นตอน + อัปโหลดไฟล์จริง
- [ ] ทดสอบแบบประเมินที่มีเงื่อนไข risk-alert อย่างน้อย 1 ชุด แล้วตรวจว่าข้อความ LINE ไปถึงจริง
- [ ] ทดสอบ offline: ปิดเน็ต → กรอกฟอร์ม → submit → เปิดเน็ต → ตรวจว่า sync สำเร็จและไม่มี duplicate
- [ ] เปิด Stackdriver Logging ตรวจสอบว่า error ถูก log ครบ
- [ ] ตรวจสอบ quota ที่เกี่ยวข้อง: UrlFetchApp calls/day, execution time/run, Drive storage
- [ ] ตั้งค่า custom domain (ถ้ามี) + ยืนยัน HTTPS ทำงานถูกต้องบน GitHub Pages
- [ ] วางแผน backup: เปิด Google Drive version history ของ Sheet + ตั้ง trigger export สำเนา (Phase 2 อัตโนมัติ, Phase 1 อย่างน้อย manual รายสัปดาห์)

---

## 19. Acceptance Criteria

### Authentication

- [ ] CG กรอก CID 13 หลักที่ตรงกับ Users sheet (Role=CG, Active=true) → login สำเร็จ ได้ token และเห็นเฉพาะผู้ป่วยของตน
- [ ] CG กรอก CID ที่ไม่มีในระบบ หรือไม่ครบ 13 หลัก → ได้ error message ภาษาไทยที่เข้าใจได้ ไม่ login ผ่าน
- [ ] Staff login ด้วย username/password ผิด → ได้ `ERR_AUTH_INVALID` ไม่เปิดเผยว่า username หรือ password ผิด (ป้องกัน enumeration)
- [ ] Token หมดอายุ → request ถัดไปได้ `ERR_SESSION_EXPIRED` และ frontend เด้งกลับ login อัตโนมัติ

### Patients & Permission

- [ ] CG เห็นเฉพาะผู้ป่วยที่ `PrimaryCgUserId` ตรงกับตนเอง ไม่เห็นผู้ป่วยของ CG คนอื่น
- [ ] CG ที่พยายามเรียก `visits.submit` ให้ผู้ป่วยที่ไม่ใช่ของตน → ได้ `ERR_FORBIDDEN`
- [ ] CM เห็นผู้ป่วยทุกคนที่ `ResponsibleCmUserId` ตรงกับตนเอง
- [ ] Admin เห็นและแก้ไขได้ทุกอย่าง

### Visits

- [ ] บันทึกการเยี่ยมครบ 3 ขั้นตอน + submit → มีแถวใหม่ใน `Visits` sheet ด้วยข้อมูลครบตาม schema
- [ ] `Patients.Status` ของผู้ป่วยที่ถูกเยี่ยมเปลี่ยนจาก "นัดวันนี้"/"เลยนัด" เป็น "เยี่ยมแล้ว" หลัง submit สำเร็จ
- [ ] ส่ง `visits.submit` ซ้ำด้วย `clientTempId` เดิม (จำลอง retry) → ไม่เกิดแถวซ้ำใน Sheet (idempotent)

### Assessments

- [ ] 2Q ตอบ "ไม่มี" ทั้ง 2 ข้อ → ระบบไม่บังคับให้ทำ 9Q ต่อ และแสดงผล "ไม่พบความเสี่ยง"
- [ ] 9Q ข้อ 9 มีคะแนน > 0 → ระบบ trigger การแจ้งเตือนไปยัง CM ที่รับผิดชอบผู้ป่วยคนนั้นทันที และบังคับต้องทำ 8Q ต่อ
- [ ] Barthel ADL รวมคะแนนถูกต้องตามสูตร (feeding+bathing+...) และจัดกลุ่ม ติดสังคม/ติดบ้าน/ติดเตียง ตรงกับเกณฑ์ที่กำหนด

### Files

- [ ] อัปโหลดรูปขนาดเกิน 5MB (หลังบีบอัดแล้วยังเกิน) → ได้ `ERR_FILE_TOO_LARGE` ไม่ทำให้ request หลักล้มเหลวทั้งหมด
- [ ] ไฟล์ที่อัปโหลดสำเร็จเก็บอยู่ในโฟลเดอร์ Drive ที่ถูกต้องตาม PatientId และเรียกดูได้จากหน้ารายละเอียดผู้ป่วย

### Offline

- [ ] ปิดสัญญาณเน็ต → กรอกและ submit ฟอร์มเยี่ยมบ้าน → ข้อมูลอยู่ใน IndexedDB สถานะ `pending` และ UI แสดง toast "บันทึกออฟไลน์"
- [ ] เปิดสัญญาณเน็ตกลับมา → ภายใน 60 วินาที ข้อมูลถูกส่งขึ้น backend สำเร็จ และสถานะเปลี่ยนเป็น synced โดยไม่ต้องรีเฟรชแอปเอง

### Notification

- [ ] CM ที่ผูก LineUserId ไว้แล้ว ได้รับข้อความ LINE ภายใน ~5 วินาทีหลังเงื่อนไข red-flag ถูกบันทึก
- [ ] CM ที่ยังไม่ผูก LineUserId → ระบบไม่ error แต่บันทึก `skipped_no_line_id` ใน Notifications sheet

### Security/Audit

- [ ] ทุก login (สำเร็จและล้มเหลว) มีแถวใน `AuditLog`
- [ ] ผู้ใช้ที่ไม่มี token หรือ token invalid เรียก action ที่ต้อง auth ใด ๆ → ไม่ได้รับข้อมูลกลับมาเลย (ปิด fail-open)

---

## 20. Roadmap Phase 2–10

| Phase | หัวข้อหลัก | รายละเอียดย่อ |
|---|---|---|
| **2** | LINE Login + Retry Queue | ผูก LineUserId อัตโนมัติผ่าน LINE Login (แทนกรอกมือ), เพิ่ม retry queue สำหรับ notification ที่ยิงไม่สำเร็จ, เพิ่ม rate limiting ด้วย CacheService |
| **3** | Reporting & Export | Dashboard เชิงสถิติระดับทีม/พื้นที่, export รายงานเป็น PDF/Excel (ใช้ time-based trigger สำหรับงานหนักเกิน 6 นาที) |
| **4** | Referral Workflow | ระบบส่งต่อผู้ป่วยไป รพ.สต./รพช. แบบมี state machine (ส่งต่อ → รับทราบ → นัดติดตาม), แจ้งเตือนสถานะผ่าน LINE |
| **5** | Multi-tenant | รองรับหลายหน่วยงาน/อำเภอ/จังหวัดในระบบเดียว แยกข้อมูลด้วย OrganizationId, permission matrix เพิ่มมิติ organization scoping |
| **6** | แบบประเมิน INHOMESSS + ชุดประเมินเพิ่มเติม | ทำแบบประเมินสิ่งแวดล้อมและบริบทที่บ้านให้เสร็จสมบูรณ์ (ปัจจุบันเป็น placeholder), เพิ่มแบบประเมินอื่นตามความต้องการ อสม./รพ.สต. |
| **7** | Offline เต็มรูปแบบ | ย้ายจาก manual/interval sync ไปใช้ Background Sync API + Periodic Sync (บน browser ที่รองรับ), ปรับปรุง conflict resolution ให้รองรับแก้ไขออฟไลน์ |
| **8** | Population Health Analytics | Dashboard วิเคราะห์เชิงประชากร (แนวโน้มความเสี่ยงในพื้นที่, heatmap หมู่บ้าน, แจ้งเตือนเชิงรุกจาก pattern) |
| **9** | Data Protection ขั้นสูง | เข้ารหัสข้อมูลอ่อนไหวระดับ field (encryption at rest สำหรับ CID เต็มและข้อมูลสุขภาพ), ระบบจัดการ consent/สิทธิ PDPA เต็มรูปแบบ (ขอลบ/ขอสำเนาข้อมูลได้เองผ่าน UI), auto-purge ตาม data retention policy |
| **10** | Scale-out / Migration Path | ประเมินย้ายฐานข้อมูลจาก Google Sheets ไปสู่ฐานข้อมูลจริง (เช่น Firestore/Cloud SQL) เมื่อข้อมูลเกิน practical limit ของ Sheets (~เกินหลักแสนแถวต่อ sheet หรือ concurrent write สูง), ออกแบบ API gateway ทดแทน Apps Script เพื่อรองรับ traffic/security ระดับ production เต็มรูปแบบ |

---

*เอกสารเวอร์ชัน 1.0 — จัดทำสำหรับ Phase 1 ของ LTC Smart Care ห้ามลบ/แก้ไข schema หรือ API contract ที่มีอยู่แล้วโดยไม่เพิ่มเวอร์ชันใหม่ (v1.1, v2.0, ...) พร้อมระบุ changelog ต่อท้ายไฟล์นี้*
