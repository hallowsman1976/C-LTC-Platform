# TEST_PLAN — LTC Smart Care

แผนทดสอบและผลการตรวจสอบระบบทั้งหมด (Phase 10) ครอบคลุม 12 มิติที่ตรวจสอบจริง พร้อมวิธีทดสอบแต่ละบทบาท (Role)
สำหรับใช้ทั้งตอนตรวจรับก่อนขึ้นระบบจริง และเป็น regression checklist ทุกครั้งที่แก้โค้ดในอนาคต

---

## สรุปผลการตรวจสอบ 12 มิติ

| # | มิติ | ผล | หมายเหตุ |
|---|---|---|---|
| 1 | API Integration | ✅ ผ่าน | ทุก action ผ่าน `routeAction_()` จุดเดียว, envelope `{ok,data}`/`{ok,code,message}` สม่ำเสมอทุก endpoint |
| 2 | Authentication | ✅ ผ่าน | Token UUID สุ่มจริง, หมดอายุตรวจทุก request, CacheService fast-path invalidate ถูกต้องตอน logout/resetPassword/ปิดบัญชี |
| 3 | RBAC | ✅ ผ่าน | Router.gs บังคับ role ทุก action ที่ต้อง auth ตรงตาม Permission Matrix ของ BLUEPRINT.md §3 |
| 4 | Validation | ✅ ผ่าน | ตรวจ required fields/enum/CID checksum/ISO date ทั้งฝั่ง backend (บังคับจริง) และ frontend (UX ล่วงหน้า) |
| 5 | CORS | ✅ ผ่าน | POST + `text/plain;charset=utf-8` เสมอ ไม่ trigger preflight — ยืนยันด้วย curl/browser จริงไม่มี CORS error |
| 6 | Offline/Sync | ✅ ผ่าน | IndexedDB draft + resume prompt, Sync Queue ยิงซ้ำอัตโนมัติเมื่อกลับมาออนไลน์ — ทดสอบจำลอง network error แล้วเห็นคิว/sync จริง |
| 7 | Duplicate Submission | ✅ ผ่าน | `clientTempId`/`requestId` idempotent ทุก endpoint ที่เขียนข้อมูล, ปุ่ม submit disable ทันทีหลังกดครั้งแรก |
| 8 | Upload | 🔧 พบช่องว่าง → แก้แล้ว | ไม่มี `files.upload` เลยตั้งแต่ Phase 1-9 (ฟอร์มเยี่ยมส่ง fileId ว่างเปล่ามาตลอด) — เพิ่ม `Files.gs` ใหม่ + ผูกเข้าฟอร์มบันทึกการเยี่ยมแล้ว ทดสอบอัปโหลดจริงสำเร็จ พร้อม idempotent (fileName ซ้ำ = คืน fileId เดิม ไม่สร้างไฟล์ซ้ำ) |
| 9 | Audit Log | 🔧 พบช่องว่าง → แก้แล้ว | เขียน log ครบทุก mutation อยู่แล้ว แต่ไม่มีทางอ่านย้อนหลังผ่าน API เลย (`admin.auditLog.list` ไม่เคยถูกเพิ่มใน Router.gs ทั้งที่ `queryAuditLogs_()` เตรียมไว้ตั้งแต่ Phase 2) — เพิ่ม route แล้ว ทดสอบดึงประวัติจริงสำเร็จ |
| 10 | Responsive | ✅ ผ่าน | Sidebar (desktop ≥768px) / Bottom Nav (มือถือ) สลับถูกต้อง, ทดสอบ viewport 375×812 จริง |
| 11 | Security | ✅ ผ่าน (พบช่องว่าง 1 จุด → แก้แล้ว) | Password hash แบบ salted+stretched SHA-256, rate limit login, LockService ป้องกัน race condition, Formula Injection sanitize ครบทุกจุดเขียนข้อมูล (ยืนยันโดยอ่านโค้ด `recordToRow_`) — **ช่องว่างที่พบ:** ไม่มีทางผูก `LineUserId` ของตัวเองได้เลย (`users.updateLineId` ไม่เคยมี) ทำให้ระบบแจ้งเตือน LINE ทั้งหมดใช้งานจริงไม่ได้ → เพิ่ม action แล้ว |
| 12 | PDPA | ✅ ผ่าน | CID mask ทุก response ที่ไม่ใช่ ADMIN/CM/CG เจ้าของเคส, ไฟล์ที่อัปโหลดเป็น private เสมอ (ไม่มีการเปิด public sharing ใด ๆ ในโค้ด), Spreadsheet ไม่ถูกแชร์ให้ผู้ใช้ปลายทาง |

รายละเอียดการแก้ไขแต่ละจุด (โค้ดเต็ม) ดูใน [CHANGELOG.md](./CHANGELOG.md) หัวข้อ Phase 10

---

## วิธีทดสอบแต่ละมิติโดยละเอียด

### 1. API Integration

```bash
# health check
curl -s "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
# ต้องได้ {"ok":true,"data":{"service":"LTC Smart Care API",...}}

# action ไม่มีอยู่จริง ต้องได้ ERR_NOT_FOUND ไม่ใช่ 500/HTML error page
curl -s -X POST "..." -H "Content-Type: text/plain;charset=utf-8" \
  --data-raw '{"action":"foo.bar","token":null,"payload":{}}'
```

### 2. Authentication

- Login สำเร็จ → ต้องได้ `token`+`expiresAt`+`user` กลับมา, `Sessions` sheet มีแถวใหม่
- เรียก action ที่ต้อง auth ด้วย token หมดอายุ/ไม่มีอยู่จริง → ต้องได้ `ERR_SESSION_EXPIRED` และ frontend ต้องเด้งไปหน้า login อัตโนมัติ (ทดสอบผ่านแล้วใน Phase 6-8)
- Logout แล้วใช้ token เดิมซ้ำ → ต้องถูกปฏิเสธ

### 3. RBAC — ดู [วิธีทดสอบแต่ละ Role](#วิธีทดสอบแต่ละ-role) ด้านล่าง

### 4. Validation

- ส่ง `patients.create` โดยไม่กรอก `name` → ต้องได้ `ERR_VALIDATION` พร้อม `fields.name`
- ส่ง CID ผิด checksum (เช่น `1234567890123`) → ต้องถูกปฏิเสธทั้ง frontend (ก่อนยิง network) และ backend (ถ้า bypass frontend มา)

### 5. CORS

เปิด browser DevTools → Network tab → เรียกใช้งานแอปปกติ → ต้อง**ไม่มี** request ไหนเป็น `OPTIONS` ไปยัง `script.google.com` และไม่มี CORS error สีแดงใน Console

### 6. Offline/Sync

1. เปิดฟอร์มบันทึกการเยี่ยม กรอกจนถึงขั้นตอนสุดท้าย
2. เปิด DevTools → Network → ตั้งเป็น **Offline**
3. กด "บันทึกและส่ง" → ต้องขึ้น toast "บันทึกไว้ในเครื่องแล้ว รอซิงค์" ไม่ใช่ error ทั่วไป
4. ตั้ง Network กลับเป็น **Online** → รอไม่เกิน 60 วินาที (หรือ trigger `online` event เอง) → ข้อมูลต้องถูกส่งขึ้นจริงอัตโนมัติ (ตรวจที่ Visits sheet)

### 7. Duplicate Submission

- กดปุ่ม "บันทึกและส่ง" รัว ๆ หลายครั้งติดกัน → ต้องสร้าง Visit **แค่แถวเดียว** ใน sheet (ตรวจ `ClientTempId` ไม่ซ้ำ)
- เรียก `visits.submit` ซ้ำด้วย `clientTempId` เดิมผ่าน curl 2 ครั้ง → ครั้งที่สองต้องคืน `visitId` เดิม ไม่ใช่สร้างแถวใหม่

### 8. Upload

```bash
curl -s -X POST "..." -H "Content-Type: text/plain;charset=utf-8" --data-raw \
  '{"action":"files.upload","token":"<TOKEN>","payload":{"patientId":"<ID>","category":"wound_before","mimeType":"image/jpeg","fileName":"test.jpg","base64Data":"<base64>"}}'
```
- ไฟล์เกิน 5MB → ต้องได้ `ERR_FILE_TOO_LARGE`
- mimeType ไม่ใช่ jpeg/png/webp → ต้องได้ `ERR_VALIDATION`
- เรียกซ้ำด้วย `fileName` เดิม → ต้องได้ `fileId` เดิม (ไม่สร้างไฟล์ซ้ำใน Drive)

### 9. Audit Log

```bash
curl -s -X POST "..." --data-raw '{"action":"admin.auditLog.list","token":"<ADMIN_TOKEN>","payload":{"pageSize":10}}'
```
ต้องเห็นประวัติ action ล่าสุดทั้งหมด (login, สร้าง/แก้ไขข้อมูล ฯลฯ) เรียงใหม่สุดก่อน

### 10. Responsive

เปิดแอปที่ viewport 375×812 (มือถือ) → ต้องเห็น Bottom Nav 4 ปุ่ม, ไม่เห็น Sidebar
เปิดที่ viewport ≥768px (desktop) → ต้องเห็น Sidebar ซ้าย, ไม่เห็น Bottom Nav

### 11. Security

- ลองเดารหัสผ่านผิด 6 ครั้งติดกันภายใน 5 นาที → ครั้งที่ 6 ต้องถูกบล็อกด้วย `ERR_RATE_LIMIT` ทันทีโดยไม่ตรวจรหัสผ่านจริง
- กรอกชื่อผู้ป่วยเป็น `=1+1` (formula injection) → เปิด Google Sheets ดูที่ cell ต้องเห็น**ข้อความ** `=1+1` ไม่ใช่คำนวณเป็นเลข `2`

### 12. PDPA

- Login เป็น VIEWER → เรียก `patients.get`/`patients.list` → เลขบัตรประชาชนต้องถูก mask เสมอ (`cidMasked`, ไม่มี field `cid` เต็ม)
- ตรวจไฟล์ที่อัปโหลดใน Drive → คลิกขวา "แชร์" → ต้องเป็น **Private** (จำกัดเฉพาะบัญชี deploy) ไม่มีลิงก์สาธารณะ

---

## วิธีทดสอบแต่ละ Role

สร้างบัญชีทดสอบอย่างน้อย 1 บัญชีต่อ role ผ่าน `admin.users.create` (หรือหน้า UI จัดการผู้ใช้ ถ้ามีในเฟสถัดไป) ก่อนเริ่ม

### ADMIN

1. Login ด้วย username/password
2. `patients.list` → ต้องเห็น**ผู้ป่วยทุกคน** ไม่ว่าใครรับผิดชอบ
3. สร้างผู้ป่วยใหม่ (`patients.create`) → ต้องสำเร็จ
4. เก็บผู้ป่วยเข้าคลัง (`patients.archive`) → ต้องสำเร็จ (role อื่นทำไม่ได้)
5. มอบหมายทีมดูแล (`patients.assignCareTeam`) ทั้ง CG และ CM ของผู้ป่วยใดก็ได้ → ต้องสำเร็จทั้งคู่
6. `admin.users.list` / `admin.notifications.list` / `admin.auditLog.list` → ต้องเรียกได้ (role อื่นต้องโดน `ERR_FORBIDDEN`)
7. อนุมัติ/ปฏิเสธ Care Plan → ต้องสำเร็จ

### CM (Case Manager)

1. Login ด้วย username/password
2. `patients.list` → ต้องเห็น**เฉพาะผู้ป่วยที่ `ResponsibleCmUserId` = ตนเอง**
3. พยายามเปิดผู้ป่วยของ CM คนอื่น (ทราบ `patientId` ตรง ๆ) ผ่าน `patients.get` → ต้องได้ `ERR_FORBIDDEN`
4. มอบหมาย CG ให้ผู้ป่วยของตนเอง → ต้องสำเร็จ
5. พยายามมอบหมาย **CM คนอื่น** ให้ผู้ป่วยของตนเอง (`responsibleCmUserId`) → ต้องถูกปฏิเสธ (`ERR_FORBIDDEN`, ต้องผ่าน ADMIN เท่านั้น)
6. อนุมัติ/ปฏิเสธ Care Plan ของผู้ป่วยที่ตนรับผิดชอบ → ต้องสำเร็จ
7. `admin.users.list`/`admin.auditLog.list` → ต้องได้ `ERR_FORBIDDEN`
8. บันทึกการเยี่ยม/แบบประเมินของผู้ป่วยที่ตนรับผิดชอบ → ต้องสำเร็จ

### CG (Caregiver)

1. Login ด้วยเลขบัตรประชาชน (CID) 13 หลัก — **ไม่มีรหัสผ่าน**
2. `patients.list` → ต้องเห็น**เฉพาะผู้ป่วยที่ `PrimaryCgUserId` = ตนเอง**
3. บันทึกฟอร์มเยี่ยมบ้าน 10 ขั้นตอนของผู้ป่วยที่ตนรับผิดชอบ → ต้องสำเร็จครบทุก assessment
4. พยายามอนุมัติ Care Plan (`careplans.approve`) → ต้องได้ `ERR_FORBIDDEN` (แยกหน้าที่ ห้ามอนุมัติแผนตัวเอง)
5. พยายามเก็บผู้ป่วยเข้าคลัง (`patients.archive`) → ต้องได้ `ERR_FORBIDDEN`
6. พยายามแก้ไขข้อมูลผู้ป่วย master data (`patients.update`) → ต้องได้ `ERR_FORBIDDEN`
7. ผูก LINE User ID ของตัวเอง (`users.updateLineId` ไม่ระบุ `userId`) → ต้องสำเร็จ
8. พยายามผูก LINE User ID ของคนอื่น (ระบุ `userId` ของ user อื่น) → ต้องได้ `ERR_FORBIDDEN`

### VIEWER

1. Login ด้วย username/password
2. `patients.list` → ต้องเห็น**ผู้ป่วยทุกคน**แต่ CID mask เสมอ
3. พยายามบันทึกการเยี่ยม/แบบประเมิน/แก้ไขข้อมูลใด ๆ → ทุก action ต้องถูกปฏิเสธด้วย `ERR_FORBIDDEN`
4. อ่าน Care Plan/ประวัติการเยี่ยม → ต้องเปิดดูได้ (read-only)

---

## Regression Smoke Test (รันหลังแก้โค้ดทุกครั้งก่อน deploy)

- [ ] Login ครบ 4 role ไม่มี error
- [ ] สร้าง + แก้ไข + ดูรายละเอียดผู้ป่วย 1 ราย
- [ ] บันทึกฟอร์มเยี่ยม 10 ขั้นตอนจบครบ 1 ชุด (รวมแนบรูป 1 ใบ + ลายเซ็น)
- [ ] สร้าง Care Plan → ส่งขออนุมัติ → อนุมัติ
- [ ] Dashboard/Reports/Map แสดงผลไม่มี error ใน Console
- [ ] Export CSV จากหน้ารายงานได้ไฟล์จริง เปิดใน Excel ภาษาไทยไม่เพี้ยน
- [ ] พิมพ์รายงาน (Print Preview) ไม่เห็น sidebar/bottom nav
