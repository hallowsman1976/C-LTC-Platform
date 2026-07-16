/**
 * constants.js
 * ค่าคงที่/enum ที่ต้องตรงกับฝั่ง backend เป๊ะ (Setup.gs SHEET_DEFINITIONS_/ENUM_*) + ตัวช่วยจัดสี badge
 * รวมไว้ที่เดียวกันไม่ให้แต่ละหน้าพิมพ์ enum ซ้ำแล้วพลาดสะกดผิด
 */

export const GENDER_OPTIONS = ['ชาย', 'หญิง'];
export const ADL_GROUP_OPTIONS = ['ติดสังคม', 'ติดบ้าน', 'ติดเตียง'];
export const RISK_LEVEL_OPTIONS = ['ต่ำ', 'ปานกลาง', 'สูง', 'สูงมาก'];
export const PATIENT_STATUS_OPTIONS = ['นัดวันนี้', 'เยี่ยมแล้ว', 'เลยนัด', 'ยังไม่นัด'];

export const ROLE_LABELS = {
  ADMIN: 'ผู้ดูแลระบบ',
  CM: 'Case Manager',
  CG: 'ผู้ดูแล/อสม.',
  VIEWER: 'ผู้เยี่ยมชม'
};

const RISK_BADGE_CLASS = {
  'ต่ำ': 'bg-emerald-100 text-emerald-700',
  'ปานกลาง': 'bg-amber-100 text-amber-700',
  'สูง': 'bg-orange-100 text-orange-700',
  'สูงมาก': 'bg-rose-100 text-rose-700'
};

const STATUS_BADGE_CLASS = {
  'นัดวันนี้': 'bg-sky-100 text-sky-700',
  'เยี่ยมแล้ว': 'bg-emerald-100 text-emerald-700',
  'เลยนัด': 'bg-rose-100 text-rose-700',
  'ยังไม่นัด': 'bg-slate-100 text-slate-600'
};

export const CARE_PLAN_STATUS_LABELS = {
  draft: 'ฉบับร่าง',
  pendingApproval: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ถูกปฏิเสธ'
};

const CARE_PLAN_STATUS_BADGE_CLASS = {
  draft: 'bg-slate-100 text-slate-600',
  pendingApproval: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700'
};

/** @param {string} riskLevel @return {string} Tailwind class คู่สีพื้นหลัง/ตัวอักษรของ badge */
export function riskBadgeClass(riskLevel) {
  return RISK_BADGE_CLASS[riskLevel] || 'bg-slate-100 text-slate-600';
}

/** @param {string} status @return {string} */
export function statusBadgeClass(status) {
  return STATUS_BADGE_CLASS[status] || 'bg-slate-100 text-slate-600';
}

/** @param {string} role @return {string} */
export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '-';
}

/** @param {string} status @return {string} */
export function carePlanStatusLabel(status) {
  return CARE_PLAN_STATUS_LABELS[status] || status || '-';
}

/** @param {string} status @return {string} */
export function carePlanStatusBadgeClass(status) {
  return CARE_PLAN_STATUS_BADGE_CLASS[status] || 'bg-slate-100 text-slate-600';
}

/* ============================================================
 * Visit Form (Phase 8) — ค่าคงที่ของแบบประเมินและ dropdown ต่าง ๆ
 * ต้องตรงกับ key/max/item count ฝั่ง backend เป๊ะ (Assessments.gs, DepressionAssessment.gs)
 * ============================================================ */

export const WOUND_STAGE_OPTIONS = ['1', '2', '3', '4'];

/**
 * นิยาม Barthel ADL Index 10 ข้อ — key/max ต้องตรงกับ BARTHEL_DEFS_ ใน Assessments.gs เป๊ะ
 * max ต่อข้อและคำบรรยายตัวเลือกยึดตามแบบฟอร์มมาตรฐาน (แบบบันทึกติดตามดูแลผู้ป่วยต่อเนื่องที่บ้าน รพ.สต.)
 */
export const BARTHEL_ITEMS = [
  { key: 'feeding', label: 'การรับประทานอาหาร', max: 2, options: [{ v: 0, l: 'ทำเองไม่ได้ ต้องป้อน' }, { v: 1, l: 'ช่วยเหลือบางส่วน' }, { v: 2, l: 'ทำเองได้' }] },
  { key: 'bathing', label: 'การอาบน้ำ', max: 1, options: [{ v: 0, l: 'ต้องช่วยเหลือ' }, { v: 1, l: 'ทำเองได้' }] },
  { key: 'grooming', label: 'การล้างหน้า หวีผม แปรงฟัน โกนหนวด', max: 1, options: [{ v: 0, l: 'ต้องการความช่วยเหลือ' }, { v: 1, l: 'ทำได้เอง (รวมถึงเตรียมอุปกรณ์ให้)' }] },
  { key: 'dressing', label: 'การสวมใส่เสื้อผ้า', max: 2, options: [{ v: 0, l: 'ทำเองไม่ได้' }, { v: 1, l: 'ช่วยเหลือบางส่วน' }, { v: 2, l: 'ทำเองได้' }] },
  { key: 'bowel', label: 'การกลั้นการถ่ายอุจจาระ', max: 2, options: [{ v: 0, l: 'กลั้นไม่ได้' }, { v: 1, l: 'เป็นบางครั้ง' }, { v: 2, l: 'กลั้นได้ปกติ' }] },
  { key: 'bladder', label: 'การกลั้นปัสสาวะ', max: 2, options: [{ v: 0, l: 'กลั้นไม่ได้' }, { v: 1, l: 'เป็นบางครั้ง' }, { v: 2, l: 'กลั้นได้ปกติ' }] },
  { key: 'toilet', label: 'การใช้ห้องน้ำ', max: 2, options: [{ v: 0, l: 'ช่วยตัวเองไม่ได้' }, { v: 1, l: 'ทำเองได้บ้าง ต้องช่วยบางสิ่ง' }, { v: 2, l: 'ช่วยเหลือตัวเองได้ดี' }] },
  { key: 'transfer', label: 'การเคลื่อนย้ายตัว (เตียง-เก้าอี้)', max: 3, options: [{ v: 0, l: 'ทำเองไม่ได้' }, { v: 1, l: 'ช่วยเหลือมาก' }, { v: 2, l: 'ช่วยเหลือเล็กน้อย' }, { v: 3, l: 'ทำเองได้' }] },
  { key: 'mobility', label: 'การเคลื่อนที่ภายในห้องหรือบ้าน', max: 3, options: [{ v: 0, l: 'เคลื่อนที่ไปไหนไม่ได้' }, { v: 1, l: 'ใช้รถเข็นได้เอง' }, { v: 2, l: 'เดินโดยมีคนช่วยพยุง' }, { v: 3, l: 'เดินหรือเคลื่อนที่เองได้' }] },
  { key: 'stairs', label: 'การขึ้นลงบันได', max: 2, options: [{ v: 0, l: 'ไม่สามารถทำได้' }, { v: 1, l: 'ต้องให้คนช่วย' }, { v: 2, l: 'ขึ้นลงเองได้' }] }
];

/** ลำดับ/ป้ายชื่อ 9 มิติของ INHOMESSS — ต้องตรงกับ INHOMESSS_DOMAINS_ ใน Assessments.gs เป๊ะ (S สามตัว = Safety/Spiritual/Service) */
export const INHOMESSS_DOMAIN_ORDER = ['immobility', 'nutrition', 'homeEnvironment', 'otherPeople', 'medications', 'examination', 'safety', 'spiritualHealth', 'service'];
export const INHOMESSS_DOMAIN_LABELS = {
  immobility: 'Immobility — ข้อจำกัดการเคลื่อนไหว',
  nutrition: 'Nutrition — โภชนาการ',
  homeEnvironment: 'Home environment — สภาพแวดล้อมที่อยู่อาศัย',
  otherPeople: 'Other people — ผู้ดูแล/คนในบ้าน',
  medications: 'Medications — การใช้ยา',
  examination: 'Examination — การตรวจร่างกาย',
  safety: 'Safety — ความปลอดภัย',
  spiritualHealth: 'Spiritual health — สุขภาวะทางจิตวิญญาณ',
  service: 'Service — แหล่งบริการสุขภาพใกล้บ้าน'
};

/** ข้อความแบบประเมิน 9Q/8Q/ความเสี่ยงหกล้ม/ภาระผู้ดูแล — ต้องมีจำนวนข้อตรงกับ backend เป๊ะ (9/8/5/5 ข้อตามลำดับ) */
export const NINE_Q_TEXTS = [
  'เบื่อ ไม่สนใจอยากทำอะไร', 'ไม่สบายใจ ซึมเศร้า ท้อแท้', 'หลับยากหรือหลับๆ ตื่นๆ หรือหลับมากไป',
  'เหนื่อยง่ายหรือไม่ค่อยมีแรง', 'เบื่ออาหาร หรือกินมากเกินไป', 'รู้สึกไม่ดีกับตัวเอง คิดว่าตัวเองล้มเหลว',
  'สมาธิไม่ดีเวลาทำอะไร', 'พูดหรือทำช้าลง หรือกระสับกระส่ายมากกว่าปกติ', 'คิดทำร้ายตัวเอง หรือคิดว่าตายไปจะดีกว่า'
];
export const EIGHT_Q_TEXTS = [
  'รู้สึกอยากตายหรือคิดอยากตาย', 'อยากทำร้ายตนเองหรือทำให้ตนเองบาดเจ็บ', 'คิดเกี่ยวกับการฆ่าตัวตาย',
  'มีแผนการที่จะฆ่าตัวตาย', 'สามารถควบคุมความอยากฆ่าตัวตายได้', 'เคยพยายามฆ่าตัวตายมาก่อน',
  'เคยพยายามฆ่าตัวตายในช่วง 1 ปีที่ผ่านมา', 'มีคนในครอบครัวเคยฆ่าตัวตาย'
];
export const FALL_RISK_TEXTS = [
  'เคยหกล้มในช่วง 6 เดือนที่ผ่านมา', 'มีปัญหาการทรงตัวหรือเดินเซ', 'ใช้ยาที่มีผลต่อความง่วงหรือมึนงง',
  'สายตาหรือการมองเห็นไม่ดี', 'สิ่งแวดล้อมในบ้านมีความเสี่ยง (พื้นลื่น/แสงน้อย)'
];
export const CAREGIVER_BURDEN_TEXTS = [
  'รู้สึกเหนื่อยล้าจากการดูแล', 'ไม่มีเวลาให้ตัวเอง', 'มีปัญหาด้านการเงินจากการดูแล',
  'รู้สึกโดดเดี่ยวไม่มีคนช่วยเหลือ', 'มีความเครียดหรือวิตกกังวล'
];

export const SYMPTOM_OPTIONS = ['ไข้', 'ไอ', 'หายใจลำบาก', 'ปวดข้อ', 'บวม', 'แผลใหม่'];
export const SERVICE_OPTIONS = ['ทำแผล', 'กายภาพเบื้องต้น', 'ให้คำปรึกษา', 'ตรวจวัดสัญญาณชีพ', 'ส่งต่อ รพ.สต.'];
export const MEDICATION_OPTIONS = ['ครบถ้วนตามแผน', 'ขาดยาบางมื้อ', 'ขาดยาต่อเนื่อง'];
export const NUTRITION_OPTIONS = ['ปกติ', 'รับประทานได้น้อย', 'ให้อาหารทางสาย'];
export const EXCRETION_OPTIONS = ['ปกติ', 'ท้องผูก', 'ใช้สายสวน/ผ้าอ้อม'];
export const SLEEP_OPTIONS = ['หลับปกติ', 'นอนไม่หลับ', 'ต้องใช้ยานอนหลับ'];
export const SHORT_RISK_OPTIONS = ['ต่ำ', 'ปานกลาง', 'สูง'];
