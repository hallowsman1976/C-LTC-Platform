/**
 * offline/visit-submit.js
 * ตรรกะ "ส่งชุดข้อมูลการเยี่ยมบ้านทั้งหมด" ที่ใช้ร่วมกันทั้งตอนกดส่งสด ๆ (online) และตอน sync manager
 * ส่งซ้ำจากคิวออฟไลน์ (offline/sync.js) — เขียนแยกไว้ที่เดียวเพื่อไม่ให้ตรรกะสองที่ไม่ตรงกัน
 *
 * ทุก sub-request (visits.submit + assessments.save*) ใช้ requestId/clientTempId เดิมเสมอไม่ว่าจะเรียกกี่ครั้ง
 * (backend การันตี idempotency ตาม requestId อยู่แล้ว) ทำให้ฟังก์ชันนี้เรียกซ้ำได้อย่างปลอดภัย 100%
 * แม้จะเรียกสำเร็จไปแล้วบางส่วนก่อนหน้าขาดการเชื่อมต่อ
 */
import { apiCall } from '../api.js';

/**
 * @param {Object} bundle ดูโครงสร้างเต็มใน screens/visit-form.js (buildSubmitBundle_)
 * @return {Promise<{visitId: string, visitNumber: number, riskAlertTriggered: boolean}>}
 */
export async function submitVisitBundle(bundle) {
  const visitResult = await apiCall('visits.submit', bundle.visitPayload);
  const visitId = visitResult.visit.visitId;
  let anyRiskAlert = !!visitResult.riskAlertTriggered;

  const assessmentCalls = [
    bundle.barthel && apiCall('assessments.saveBarthel', {
      patientId: bundle.patientId, visitId, requestId: bundle.barthel.requestId, answers: bundle.barthel.answers
    }),
    bundle.inhomesss && apiCall('assessments.saveInhomesss', {
      patientId: bundle.patientId, visitId, requestId: bundle.inhomesss.requestId, answers: bundle.inhomesss.answers
    }),
    bundle.fallRisk && apiCall('assessments.saveFallRisk', {
      patientId: bundle.patientId, visitId, requestId: bundle.fallRisk.requestId, answers: bundle.fallRisk.answers
    }),
    bundle.pressureUlcer && apiCall('assessments.savePressureUlcer', {
      patientId: bundle.patientId, visitId, requestId: bundle.pressureUlcer.requestId,
      hasWound: bundle.pressureUlcer.hasWound, location: bundle.pressureUlcer.location,
      size: bundle.pressureUlcer.size, stage: bundle.pressureUlcer.stage
    }),
    bundle.depression && apiCall('assessments.saveDepression', {
      patientId: bundle.patientId, visitId, requestId: bundle.depression.requestId,
      twoQAnswers: bundle.depression.twoQAnswers, nineQAnswers: bundle.depression.nineQAnswers,
      eightQAnswers: bundle.depression.eightQAnswers
    }),
    bundle.caregiverBurden && apiCall('assessments.saveCaregiverBurden', {
      patientId: bundle.patientId, visitId, requestId: bundle.caregiverBurden.requestId, answers: bundle.caregiverBurden.answers
    })
  ].filter(Boolean);

  const results = await Promise.all(assessmentCalls);
  results.forEach((r) => {
    if (r && r.riskAlertTriggered) anyRiskAlert = true;
  });

  return { visitId, visitNumber: visitResult.visitNumber, riskAlertTriggered: anyRiskAlert };
}
