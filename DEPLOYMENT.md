# DEPLOYMENT — LTC Smart Care

คู่มือ deploy ระบบขึ้นใช้งานจริงตั้งแต่ศูนย์ ครอบคลุมทั้ง Backend (Google Apps Script Web App) และ Frontend (GitHub Pages)
อ้างอิงสถาปัตยกรรมจาก [BLUEPRINT.md](./BLUEPRINT.md) — เอกสารนี้เป็นขั้นตอนปฏิบัติจริงเท่านั้น

## สารบัญ

1. [เตรียมเครื่องมือ](#1-เตรียมเครื่องมือ)
2. [ตั้งค่า Script Properties](#2-ตั้งค่า-script-properties)
3. [Deploy Backend (Google Apps Script Web App)](#3-deploy-backend-google-apps-script-web-app)
4. [ติดตั้ง Time-driven Triggers](#4-ติดตั้ง-time-driven-triggers)
5. [Deploy Frontend (GitHub Pages)](#5-deploy-frontend-github-pages)
6. [วิธีเปลี่ยน API URL หลัง deploy ใหม่](#6-วิธีเปลี่ยน-api-url-หลัง-deploy-ใหม่)
7. [Checklist ก่อนใช้งานจริง](#7-checklist-ก่อนใช้งานจริง)

---

## 1. เตรียมเครื่องมือ

```bash
npm install -g @google/clasp
clasp login
```

ต้องมี Google Account ที่จะใช้เป็น "บัญชี deploy" (เจ้าของ Spreadsheet/Drive folder/Web App ทั้งหมด — ดู [§7 ข้อ Security](#7-checklist-ก่อนใช้งานจริง) เรื่องสิทธิ์เข้าถึง)

---

## 2. ตั้งค่า Script Properties

เปิด Apps Script Editor (`clasp open-script` หรือเปิดจาก [script.google.com](https://script.google.com)) → ไอคอนเฟือง **"การตั้งค่าโครงการ" (Project Settings)** → เลื่อนลงหา **"Script Properties"** → **"เพิ่ม Script Property"**

**ห้าม hardcode ค่าเหล่านี้ในโค้ด `.gs` ใด ๆ เด็ดขาด** — ทุกจุดที่ต้องใช้ค่าพวกนี้อ่านผ่าน `PropertiesService.getScriptProperties()` เท่านั้น (`Config.gs`)

### ตัวอย่าง Script Properties ที่ต้องตั้ง

| คีย์ | บังคับ/ไม่บังคับ | ตัวอย่างค่า | หมายเหตุ |
|---|---|---|---|
| `SPREADSHEET_ID` | ไม่บังคับตั้งเอง | `1Ffk_KFr7xEDQMAbOxi7ON1ASUOcSQwKWxc2HRMgcZKw` | ถ้าไม่ตั้งไว้ก่อน `setupSystem()` จะสร้าง Spreadsheet ใหม่อัตโนมัติแล้วบันทึกค่านี้กลับมาให้เอง — ตั้งเองเฉพาะกรณีต้องการผูกกับ Spreadsheet ที่มีอยู่แล้ว |
| `LINE_CHANNEL_ACCESS_TOKEN` | บังคับ (ถ้าต้องการแจ้งเตือน LINE) | `Ab12Cd34...` (ยาวหลายร้อยตัวอักษร) | คัดลอกจาก [LINE Developers Console](https://developers.line.biz/console/) → เลือก Provider/Channel (Messaging API) → แท็บ "Messaging API" → "Channel access token" → Issue — ถ้าไม่ตั้งค่านี้ ระบบยังทำงานได้ปกติทุกอย่าง แค่การแจ้งเตือนจะขึ้นสถานะ `failed` ใน Notifications sheet เสมอ (ดู [TEST_PLAN.md](./TEST_PLAN.md)) |
| `PASSWORD_SALT` | สร้างอัตโนมัติ | `a1b2c3d4-...` | `setupSystem()` สุ่มด้วย `Utilities.getUuid()` ให้เองถ้ายังไม่มี — **ไม่ต้องตั้งเอง** (การตั้งเองแล้วเปลี่ยนภายหลังจะทำให้รหัสผ่านเดิมทั้งหมด login ไม่ได้ เพราะ hash เปลี่ยนสูตร) |

> Google Apps Script ไม่มีไฟล์ `.env` — Script Properties คือกลไกเก็บ secret ของแพลตฟอร์มเอง ปลอดภัยเพราะไม่ได้อยู่ในซอร์สโค้ดที่ push/commit และไม่มีใครอ่านได้นอกจากเจ้าของโครงการ

---

## 3. Deploy Backend (Google Apps Script Web App)

### 3.1 เชื่อม clasp กับโครงการ

ถ้ายังไม่มี `.clasp.json`:

```bash
clasp create --type standalone --title "C-LTC-Platform" --rootDir ./src
```

ถ้ามีโครงการ Apps Script อยู่แล้ว ให้แก้ `.clasp.json` ให้ตรงกับ `scriptId` ของโครงการนั้น:

```json
{
  "scriptId": "<SCRIPT_ID_ของคุณ>",
  "rootDir": "./src"
}
```

### 3.2 Push โค้ด

```bash
clasp push --force
```

### 3.3 รัน `setupSystem()` ครั้งแรก (bootstrap ฐานข้อมูล)

เปิด Apps Script Editor → ไฟล์ `Setup.gs` → เลือกฟังก์ชัน **`setupSystem`** จาก dropdown บนแถบเครื่องมือ → กด **▶ เรียกใช้ (Run)** → อนุญาต OAuth (Sheets, Drive) ตอนรันครั้งแรก

ผลลัพธ์ที่ควรเห็นใน "บันทึกการดำเนินการ" (Execution log) ครั้งแรก:

```json
{
  "spreadsheetId": "...",
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/.../edit",
  "sheetsCreated": ["Users", "Patients", "Visits", "..."],
  "sheetsExisting": [],
  "driveFolderId": "...",
  "configSeeded": ["APP_VERSION", "DRIVE_ROOT_FOLDER_ID", "SETUP_LAST_RUN_AT"],
  "passwordSaltGenerated": true,
  "durationMs": 18000
}
```

`setupSystem()` **รันซ้ำได้เสมอโดยปลอดภัย (idempotent)** — ใช้รันซ้ำได้ทุกครั้งที่ pull โค้ดเวอร์ชันใหม่ที่มีคอลัมน์/ชีตเพิ่ม (append-only migration ไม่ลบข้อมูลเดิม)

### 3.4 สร้างบัญชี ADMIN คนแรก

เปิด Apps Script Editor → ไฟล์ `Setup.gs` → แก้ไขบรรทัดท้ายไฟล์ชั่วคราว เพิ่มฟังก์ชันทดสอบ:

```js
function _tempBootstrapAdmin() {
  return bootstrapFirstAdmin_('admin', 'รหัสผ่านที่ปลอดภัย12', 'ชื่อผู้ดูแลระบบ');
}
```

เลือกฟังก์ชัน `_tempBootstrapAdmin` จาก dropdown → กด Run → ตรวจ log ว่าได้ `UserId` กลับมา → **ลบฟังก์ชันนี้ทิ้งแล้ว `clasp push --force` อีกครั้ง** (ห้ามปล่อยโค้ด bootstrap ทิ้งไว้ในโปรดักชัน)

`bootstrapFirstAdmin_()` ทำงานเฉพาะตอนที่ยังไม่มีผู้ใช้ Role=ADMIN อยู่เลยเท่านั้น — เรียกซ้ำครั้งที่สองจะถูกปฏิเสธด้วย `ERR_CONFLICT` โดยอัตโนมัติ (ป้องกันสร้าง ADMIN เพิ่มโดยไม่ผ่าน `admin.users.create`)

### 3.5 Deploy เป็น Web App

**การทำให้ใช้งานได้ (Deploy)** (มุมขวาบน) → **"ทำให้ใช้งานได้แบบใหม่"** → เลือกประเภท **"เว็บแอป (Web app)"** → ตั้งค่า:

| ช่อง | ค่าที่ต้องเลือก |
|---|---|
| ดำเนินการเป็น (Execute as) | **ฉันเอง (บัญชีที่ deploy)** — `USER_DEPLOYING` |
| ใครมีสิทธิ์เข้าถึง (Who has access) | **ทุกคน (Anyone)** — `ANYONE_ANONYMOUS` (จำเป็น เพราะ frontend เรียกแบบไม่ผูก Google Account) |

กด **Deploy** → คัดลอก **Web app URL** ที่ได้ (รูปแบบ `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`) ไว้ใช้ในขั้นตอนที่ 6

> **สำคัญ:** deployment แบบนี้เป็น "เวอร์ชันคงที่" ไม่ใช่ `@HEAD` — ทุกครั้งที่ `clasp push` โค้ดใหม่ ต้องรัน `clasp deploy --deploymentId <ID เดิม>` ซ้ำด้วย ไม่งั้น URL เดิมจะยังรันโค้ดเวอร์ชันเก่าอยู่:
>
> ```bash
> clasp deploy --deploymentId <DEPLOYMENT_ID> --description "อธิบายการเปลี่ยนแปลงสั้น ๆ"
> ```

### 3.6 ทดสอบว่า deploy สำเร็จ

```bash
curl -s "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
```

ควรได้ JSON กลับมา (health check จาก `doGet`):

```json
{"ok":true,"data":{"service":"LTC Smart Care API","version":"1.0.0","time":"..."}}
```

---

## 4. ติดตั้ง Time-driven Triggers

ระบบแจ้งเตือนอัตโนมัติ (นัดวันนี้/ก่อนนัด/เลยนัด/ADL ลดลง/ขาดยา + Retry Queue) ต้องอาศัย Trigger ตามเวลา ซึ่ง **ต้องติดตั้งเองครั้งเดียวผ่าน Apps Script Editor** เพราะ `ScriptApp.newTrigger()` ต้องขอสิทธิ์ (`script.scriptapp` scope) ที่ automation ทั่วไปกดผ่านหน้าจอขออนุมัติสิทธิ์แทนผู้ใช้จริงไม่ได้

### วิธีติดตั้งแบบเร็ว (ผ่านหน้า UI ของ Triggers)

1. เปิด Apps Script Editor → ไอคอน **นาฬิกา "ทริกเกอร์" (Triggers)** ที่แถบด้านซ้าย
2. กด **"+ เพิ่มทริกเกอร์"**
3. ตั้งค่าตัวที่ 1 — แจ้งเตือนประจำวัน:
   - เลือกฟังก์ชันที่จะเรียกใช้: **`runDailyNotificationChecks`**
   - เลือกแหล่งที่มาของกิจกรรม: **"ตามเวลา"**
   - เลือกประเภทของทริกเกอร์ตามเวลา: **"เครื่องมือจับเวลาเป็นวัน"**
   - เลือกเวลาของวัน: **7.00 น. ถึง 8.00 น.** (หรือช่วงเวลาที่เหมาะกับหน่วยงาน)
   - กด **บันทึก** → อนุมัติสิทธิ์ที่ขึ้นมา (ครั้งแรกเท่านั้น)
4. กด **"+ เพิ่มทริกเกอร์"** อีกครั้ง ตั้งค่าตัวที่ 2 — Retry Queue:
   - เลือกฟังก์ชันที่จะเรียกใช้: **`runRetryQueueTrigger`**
   - เลือกแหล่งที่มาของกิจกรรม: **"ตามเวลา"**
   - เลือกประเภทของทริกเกอร์ตามเวลา: **"เครื่องมือจับเวลาเป็นชั่วโมง"** (หรือ "เครื่องมือจับเวลาเป็นนาที" → ทุก 30 นาที ถ้าต้องการถี่กว่า)
   - กด **บันทึก**

### วิธีติดตั้งแบบรันฟังก์ชัน (ทางเลือก)

เปิดไฟล์ `Triggers.gs` → เลือกฟังก์ชัน `installTimeDrivenTriggers` จาก dropdown → กด Run → อนุมัติสิทธิ์ที่ขึ้นมา (ฟังก์ชันนี้ลบ trigger เดิมของทั้ง 2 ฟังก์ชันก่อนสร้างใหม่เสมอ ปลอดภัยต่อการรันซ้ำ)

### ตรวจสอบว่าติดตั้งสำเร็จ

กลับไปที่หน้า "ทริกเกอร์" ต้องเห็น 2 รายการ (`runDailyNotificationChecks` ตามเวลา, `runRetryQueueTrigger` ตามเวลา) พร้อมคอลัมน์ "เรียกใช้ครั้งล่าสุด" ที่จะเริ่มมีค่าหลังถึงรอบแรก

---

## 5. Deploy Frontend (GitHub Pages)

### 5.1 ตั้งค่า config.js ให้ชี้ไปยัง Web App URL จริง

คัดลอก `frontend/assets/js/config.example.js` เป็น `frontend/assets/js/config.js` (ถ้ายังไม่มี) แล้วแก้:

```js
export const API_BASE_URL = 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec';
```

ไฟล์นี้เก็บเฉพาะ URL สาธารณะ **ไม่มี secret ใด ๆ** ปลอดภัยที่จะ commit ขึ้น GitHub

### 5.2 Push ขึ้น GitHub repository

```bash
git init                          # ถ้ายังไม่เคย init
git add frontend
git commit -m "Deploy frontend"
git remote add origin <URL ของ repo GitHub>
git push -u origin main
```

> โครงสร้างที่ต้องอยู่ที่ repo root สำหรับ GitHub Pages คือเนื้อหาข้างใน `frontend/` (ย้ายทั้งโฟลเดอร์ขึ้นไปเป็น root ของ repo แยก หรือใช้ GitHub Pages "custom source directory" ก็ได้ ตาม BLUEPRINT.md §12)

### 5.3 เปิดใช้งาน GitHub Pages

ที่ repo บน GitHub → **Settings** → **Pages** → **Build and deployment**:
- Source: **Deploy from a branch**
- Branch: **main** / โฟลเดอร์ **`/ (root)`** (หรือ `/frontend` ถ้าเลือก custom source directory ได้)
- กด **Save**

รอ 1-2 นาที แล้วเปิด URL ที่ GitHub แสดง (รูปแบบ `https://<username>.github.io/<repo>/`)

### 5.4 ทดสอบ

เปิด URL ของ GitHub Pages → ควรเจอหน้า Login → ลอง login ด้วยบัญชี ADMIN ที่สร้างไว้ในขั้นตอน 3.4

---

## 6. วิธีเปลี่ยน API URL หลัง deploy ใหม่

เมื่อใดก็ตามที่สร้าง deployment ใหม่ (deployment ID เปลี่ยน) หรือย้ายไป Apps Script project อื่น ต้องอัปเดตฝั่ง frontend:

1. เปิด `frontend/assets/js/config.js`
2. แก้บรรทัดเดียว:
   ```js
   export const API_BASE_URL = 'https://script.google.com/macros/s/<DEPLOYMENT_ID ใหม่>/exec';
   ```
3. Commit + push ขึ้น GitHub — GitHub Pages จะ build ใหม่อัตโนมัติภายในไม่กี่นาที

**ไม่ต้องแก้ไฟล์อื่นใดเลย** — ทุกโมดูล frontend เรียก `API_BASE_URL` จากไฟล์นี้ไฟล์เดียว (`assets/js/api.js` import มาใช้)

> ถ้าแก้ไข URL แล้วผู้ใช้ยังเจอปัญหาเดิม ให้เช็ค Service Worker cache ก่อน — `service-worker.js` แคช `config.js` ไว้ (`STORE ltc-smart-care-v1`) ผู้ใช้อาจต้อง reload แบบ hard refresh (Ctrl+Shift+R) หรือรอ Service Worker คิว update รอบถัดไป

---

## 7. Checklist ก่อนใช้งานจริง

ตรวจครบทุกข้อก่อนเปิดให้ผู้ใช้จริงเข้าใช้งาน (อ้างอิงผลตรวจสอบเต็มที่ [TEST_PLAN.md](./TEST_PLAN.md))

### Backend

- [ ] `setupSystem()` รันสำเร็จ ครบทั้ง 14 ชีต (`Users`, `Patients`, `Visits`, `Assessments_*` ×6, `CarePlans`, `Sessions`, `Config`, `AuditLog`, `Notifications`)
- [ ] Deploy Web App แบบ **Execute as: Me**, **Access: Anyone** แล้ว และเป็น deployment ID ล่าสุด (ตรงกับที่ตั้งใน `config.js`)
- [ ] สร้างบัญชี ADMIN จริงแล้ว (ไม่ใช่บัญชีทดสอบ) ผ่าน `bootstrapFirstAdmin_` แล้วลบฟังก์ชัน bootstrap ทิ้ง + push ใหม่
- [ ] ตั้ง `LINE_CHANNEL_ACCESS_TOKEN` ใน Script Properties แล้ว (ถ้าต้องการแจ้งเตือน LINE) — ทดสอบส่งจริง 1 ครั้ง
- [ ] ติดตั้ง Time-driven Triggers ทั้ง 2 ตัวแล้ว (`runDailyNotificationChecks`, `runRetryQueueTrigger`) — ดู [§4](#4-ติดตั้ง-time-driven-triggers)
- [ ] ลบข้อมูลทดสอบทั้งหมดออกจากทุกชีตแล้ว (Users/Patients/Visits/Assessments ที่ไม่ใช่ของจริง)

### Frontend

- [ ] `config.js` ชี้ไปยัง deployment URL ที่ใช้งานจริง (ไม่ใช่ URL ทดสอบ)
- [ ] เปิด GitHub Pages แล้วเข้าถึงได้จริงจากอินเทอร์เน็ตภายนอก
- [ ] ทดสอบ login ครบทุก mode (CID สำหรับ CG, username/password สำหรับ ADMIN/CM/VIEWER)

### สิทธิ์และผู้ใช้

- [ ] สร้างบัญชี CM/CG จริงผ่าน `admin.users.create` ครบตามจำนวนเจ้าหน้าที่จริง (ไม่ใช้บัญชีทดสอบต่อ)
- [ ] ผูก LINE User ID ให้ ADMIN/CM/CG อย่างน้อยคนที่ต้องรับการแจ้งเตือน (หน้า "ตั้งค่า" ในแอป → ผูก LINE User ID)
- [ ] มอบหมาย `PrimaryCgUserId`/`ResponsibleCmUserId` ให้ผู้ป่วยจริงครบทุกคนก่อนเริ่มใช้งาน

### ความปลอดภัย/PDPA

- [ ] Spreadsheet หลัก **ไม่ได้แชร์** ให้ใครนอกจากบัญชีที่ deploy (ตรวจที่ปุ่ม "แชร์" ของ Google Sheets)
- [ ] ไม่มีใครอื่นมีสิทธิ์แก้ไข Apps Script project นอกจากผู้ดูแลระบบที่ไว้ใจได้
- [ ] ทดสอบว่า CG/CM มองเห็นเฉพาะผู้ป่วยที่ตนรับผิดชอบจริง (ไม่เห็นของคนอื่น) — ดูวิธีทดสอบใน [TEST_PLAN.md](./TEST_PLAN.md)
- [ ] สำรอง (backup) Spreadsheet เป็นระยะ (Google Sheets มีเวอร์ชันประวัติในตัวอยู่แล้ว แต่แนะนำ export สำรองเพิ่มเติมตามรอบที่หน่วยงานกำหนด)
