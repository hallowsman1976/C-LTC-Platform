/**
 * screens/visit-form.js
 * ฟอร์มบันทึกการเยี่ยมบ้านแบบ 10 ขั้นตอน (Multi-step) ตาม BLUEPRINT.md §5.1, §6.1, §14
 * ควบคุม state ทั้งหมด, Auto Save Draft (IndexedDB + best-effort visits.saveDraft), GPS, รูปภาพ, และ Offline Queue
 * การเรนเดอร์เนื้อหาแต่ละขั้นตอนอยู่ใน visit-form-steps.js (แยกไฟล์กันยาวเกินไป)
 */
import { apiCall, ApiError, NetworkError } from '../api.js';
import { getCurrentUser } from '../auth.js';
import { setLoading, showToast, confirmDialog, renderCardSkeleton, escapeHtml } from '../ui.js';
import { resizeImageFile, estimateDataUrlBytes } from '../image-utils.js';
import { createSignaturePad } from '../signature-pad.js';
import { saveDraftLocal, getDraftLocal, findActiveDraftByPatient, deleteDraftLocal, enqueueSync } from '../offline/db.js';
import { submitVisitBundle } from '../offline/visit-submit.js';
import { renderVisitFormStep, validateVisitFormStep, STEP_TITLES, TOTAL_STEPS } from './visit-form-steps.js';
import { BARTHEL_ITEMS } from '../constants.js';

const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * @param {HTMLElement} content
 * @param {{id: string}} params
 */
export async function renderVisitForm(content, params) {
  const patientId = params.id;

  content.innerHTML = `<div class="px-4 py-5"><div id="vf-init-skeleton"></div></div>`;
  renderCardSkeleton(content.querySelector('#vf-init-skeleton'));

  const patientData = await apiCall('patients.get', { patientId });
  const patient = patientData.patient;

  const state = await resolveInitialState(patientId);
  if (!state) {
    location.hash = `/patients/${encodeURIComponent(patientId)}`;
    return;
  }

  mountWizard(content, patient, state);
}

/**
 * ตรวจร่างที่ยัง active ของผู้ป่วยรายนี้ ถามผู้ใช้ว่าจะกู้คืนหรือเริ่มใหม่ — คืน null ถ้าผู้ใช้เลือกยกเลิกกลับหน้ารายละเอียดผู้ป่วย
 * @param {string} patientId
 * @return {Promise<Object|null>}
 */
async function resolveInitialState(patientId) {
  const existingDraft = await findActiveDraftByPatient(patientId);
  if (existingDraft) {
    const resume = await confirmDialog(
      `พบร่างการเยี่ยมที่ยังไม่เสร็จของผู้ป่วยรายนี้ (บันทึกล่าสุด ${formatThaiDateTime(existingDraft.updatedAt)}) ต้องการทำต่อจากร่างเดิมหรือไม่?`,
      { confirmLabel: 'ทำต่อจากร่างเดิม', cancelLabel: 'เริ่มบันทึกใหม่' }
    );
    if (resume) return existingDraft;
    await deleteDraftLocal(existingDraft.clientTempId);
  }
  return createFreshState(patientId);
}

/** @param {string} patientId @return {Object} */
function createFreshState(patientId) {
  const clientTempId = 'tmp-' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2)));
  const barthel = {};
  BARTHEL_ITEMS.forEach((item) => { barthel[item.key] = null; });
  // ไม่ต้อง pre-populate ต่อมิติเหมือน barthel/fallRisk — INHOMESSS แต่ละมิติมีฟิลด์ไม่เท่ากัน (ดู DOMAIN_FIELDS
  // ใน inhomesss-form.js) ปล่อยว่างแล้วให้ตัว render/wire สร้างเข้าไปเองตอนผู้ใช้กรอกจริง (answers[domain] || {})
  const inhomesss = {};
  const fallRisk = { q1: null, q2: null, q3: null, q4: null, q5: null };
  const caregiverBurden = { q1: null, q2: null, q3: null, q4: null, q5: null };
  const nineQ = {};
  for (let i = 1; i <= 9; i++) nineQ[`q${i}`] = null;
  const eightQ = {};
  for (let i = 1; i <= 8; i++) eightQ[`q${i}`] = null;

  return {
    clientTempId,
    patientId,
    currentStep: 1,
    gps: { lat: null, lng: null, error: null, requesting: false },
    visit: {
      caregiverName: '', relation: '', bp: '', hr: '', temp: '', spo2: '',
      symptoms: [], medication: '', nutrition: '', excretion: '', sleep: '',
      fallRiskNote: '', caregiverBurdenNote: '', servicesGiven: [], notes: '', nextVisitDate: ''
    },
    wound: { hasWound: null, location: '', stage: '', size: '', care: '' },
    barthel,
    inhomesss,
    fallRisk,
    depression: { twoQ: { q1: null, q2: null }, nineQ, eightQ },
    caregiverBurden,
    photos: { before: null, after: null, woundPhoto: null },
    signatureDataUrl: null,
    signatureFileId: null,
    requestIds: {
      barthel: clientTempId + '-barthel',
      inhomesss: clientTempId + '-inhomesss',
      fallRisk: clientTempId + '-fallrisk',
      pressureUlcer: clientTempId + '-pressureulcer',
      depression: clientTempId + '-depression',
      caregiverBurden: clientTempId + '-caregiverburden'
    }
  };
}

/**
 * @param {HTMLElement} content
 * @param {Object} patient
 * @param {Object} state
 */
function mountWizard(content, patient, state) {
  let autosaveTimer = null;
  let submitting = false;
  let signaturePad = null;

  content.innerHTML = `
    <div class="fixed inset-0 z-[35] bg-slate-50 flex flex-col">
      <div class="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
        <button id="vf-exit-btn" type="button" class="text-slate-400 text-lg leading-none">✕</button>
        <div class="text-center min-w-0">
          <p id="vf-step-counter" class="text-xs text-slate-400">ขั้นตอน ${state.currentStep}/${TOTAL_STEPS} · ${escapeHtml(patient.name)} (HN ${escapeHtml(patient.hn)})</p>
          <p id="vf-step-title" class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(STEP_TITLES[state.currentStep - 1])}</p>
        </div>
        <div class="w-5"></div>
      </div>
      <div class="h-1 bg-slate-100">
        <div id="vf-progress-bar" class="h-1 bg-sky-600 transition-all" style="width:${(state.currentStep / TOTAL_STEPS) * 100}%"></div>
      </div>

      <div id="vf-step-content" class="flex-1 overflow-y-auto px-4 py-4"></div>

      <p id="vf-step-error" class="hidden text-xs text-rose-600 bg-rose-50 px-4 py-2"></p>

      <div class="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-2">
        <button id="vf-prev-btn" type="button" class="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">ก่อนหน้า</button>
        <button id="vf-save-draft-btn" type="button" class="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium">บันทึกร่างไว้ก่อน</button>
        <button id="vf-next-btn" type="button" class="flex-1 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium">ถัดไป</button>
      </div>
    </div>
  `;

  const stepContentEl = content.querySelector('#vf-step-content');
  const stepCounterEl = content.querySelector('#vf-step-counter');
  const stepTitleEl = content.querySelector('#vf-step-title');
  const progressBarEl = content.querySelector('#vf-progress-bar');
  const stepErrorEl = content.querySelector('#vf-step-error');
  const prevBtn = content.querySelector('#vf-prev-btn');
  const nextBtn = content.querySelector('#vf-next-btn');
  const saveDraftBtn = content.querySelector('#vf-save-draft-btn');
  const exitBtn = content.querySelector('#vf-exit-btn');

  function persistLocal() {
    saveDraftLocal(state).catch(() => {});
  }

  function scheduleAutosave() {
    persistLocal();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      apiCall('visits.saveDraft', buildDraftPayload(state)).catch(() => {
        // best-effort — offline หรือ backend มีปัญหาไม่เป็นไร ข้อมูลปลอดภัยอยู่ใน IndexedDB แล้ว
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function rerenderStep() {
    renderVisitFormStep(state.currentStep, stepContentEl, state, ctx);
  }

  function updateChrome() {
    stepCounterEl.textContent = `ขั้นตอน ${state.currentStep}/${TOTAL_STEPS} · ${patient.name} (HN ${patient.hn})`;
    stepTitleEl.textContent = STEP_TITLES[state.currentStep - 1];
    progressBarEl.style.width = `${(state.currentStep / TOTAL_STEPS) * 100}%`;
    prevBtn.classList.toggle('invisible', state.currentStep === 1);
    nextBtn.textContent = state.currentStep === TOTAL_STEPS ? 'บันทึกและส่ง' : 'ถัดไป';
    saveDraftBtn.classList.toggle('hidden', state.currentStep === TOTAL_STEPS);
    stepErrorEl.classList.add('hidden');
  }

  const ctx = {
    setState(patch) {
      Object.assign(state, patch);
      scheduleAutosave();
    },
    setNested(section, patch) {
      Object.assign(state[section], patch);
      scheduleAutosave();
    },
    setDeepValue(section, key, value) {
      state[section][key] = value;
      scheduleAutosave();
    },
    rerenderStep,
    async requestGps() {
      state.gps.requesting = true;
      rerenderStep();
      requestGpsPosition(
        (lat, lng) => {
          state.gps = { lat, lng, error: null, requesting: false };
          scheduleAutosave();
          rerenderStep();
        },
        (errorMessage) => {
          state.gps.requesting = false;
          state.gps.error = errorMessage;
          rerenderStep();
        }
      );
    },
    async addPhoto(kind, file) {
      try {
        const resized = await resizeImageFile(file);
        state.photos[kind] = { dataUrl: resized.dataUrl, bytes: estimateDataUrlBytes(resized.dataUrl), fileId: null, uploading: true, uploadFailed: false };
        rerenderStep();

        try {
          const uploadResult = await apiCall('files.upload', {
            patientId: state.patientId,
            category: kind,
            mimeType: 'image/jpeg',
            fileName: `${state.clientTempId}_${kind}.jpg`,
            base64Data: resized.dataUrl.split(',')[1]
          });
          state.photos[kind] = { ...state.photos[kind], fileId: uploadResult.fileId, uploading: false };
        } catch (uploadErr) {
          state.photos[kind] = { ...state.photos[kind], uploading: false, uploadFailed: true };
          showToast('อัปโหลดรูปไม่สำเร็จ (อาจออฟไลน์อยู่) — แตะรูปนี้อีกครั้งเพื่อลองใหม่ตอนออนไลน์', 'warning');
        }
        scheduleAutosave();
        rerenderStep();
      } catch (err) {
        showToast(err && err.message ? err.message : 'ไม่สามารถประมวลผลรูปภาพนี้ได้', 'error');
      }
    },
    removePhoto(kind) {
      state.photos[kind] = null;
      scheduleAutosave();
      rerenderStep();
    },
    getOrCreateSignaturePad(canvas) {
      signaturePad = createSignaturePad(canvas);
      return signaturePad;
    },
    async confirmSignature(dataUrl) {
      state.signatureDataUrl = dataUrl;
      state.signatureFileId = null;
      rerenderStep();
      try {
        const uploadResult = await apiCall('files.upload', {
          patientId: state.patientId,
          category: 'signature',
          mimeType: 'image/png',
          fileName: `${state.clientTempId}_signature.png`,
          base64Data: dataUrl.split(',')[1]
        });
        state.signatureFileId = uploadResult.fileId;
      } catch (err) {
        showToast('อัปโหลดลายเซ็นไม่สำเร็จ (อาจออฟไลน์อยู่) — ลายเซ็นจะไม่ถูกแนบไปกับการเยี่ยมนี้', 'warning');
      }
      scheduleAutosave();
      rerenderStep();
    }
  };

  function goToStep(nextStep) {
    state.currentStep = nextStep;
    persistLocal();
    updateChrome();
    rerenderStep();
    stepContentEl.scrollTop = 0;
  }

  prevBtn.addEventListener('click', () => {
    if (state.currentStep > 1) goToStep(state.currentStep - 1);
  });

  nextBtn.addEventListener('click', async () => {
    const validationError = validateVisitFormStep(state.currentStep, state);
    if (validationError) {
      stepErrorEl.textContent = validationError;
      stepErrorEl.classList.remove('hidden');
      return;
    }
    if (state.currentStep < TOTAL_STEPS) {
      goToStep(state.currentStep + 1);
      return;
    }
    await handleFinalSubmit();
  });

  saveDraftBtn.addEventListener('click', async () => {
    persistLocal();
    setLoading(true);
    try {
      await apiCall('visits.saveDraft', buildDraftPayload(state));
      showToast('บันทึกร่างการเยี่ยมไว้แล้ว ทำต่อภายหลังได้', 'success');
    } catch (err) {
      showToast('บันทึกร่างไว้ในเครื่องนี้แล้ว (จะซิงค์ขึ้นระบบเมื่อออนไลน์)', 'info');
    } finally {
      setLoading(false);
      location.hash = `/patients/${encodeURIComponent(state.patientId)}`;
    }
  });

  exitBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog('ออกจากฟอร์มนี้หรือไม่? ระบบได้บันทึกร่างไว้ในเครื่องนี้แล้ว สามารถกลับมาทำต่อได้');
    if (confirmed) {
      persistLocal();
      location.hash = `/patients/${encodeURIComponent(state.patientId)}`;
    }
  });

  async function handleFinalSubmit() {
    if (submitting) return;
    submitting = true;
    nextBtn.disabled = true;
    nextBtn.textContent = 'กำลังบันทึก...';

    const bundle = buildSubmitBundle(state);

    try {
      const result = await submitVisitBundle(bundle);
      await deleteDraftLocal(state.clientTempId);
      showToast(
        result.riskAlertTriggered
          ? `บันทึกการเยี่ยมสำเร็จ (ครั้งที่ ${result.visitNumber}) — ระบบแจ้งเตือนความเสี่ยงไปยัง CM แล้ว`
          : `บันทึกการเยี่ยมสำเร็จ (ครั้งที่ ${result.visitNumber})`,
        'success'
      );
      location.hash = `/patients/${encodeURIComponent(state.patientId)}`;
    } catch (err) {
      if (err instanceof NetworkError) {
        await enqueueSync({
          clientTempId: state.clientTempId, patientId: state.patientId, bundle,
          status: 'pending', createdAt: new Date().toISOString()
        });
        await deleteDraftLocal(state.clientTempId);
        showToast('คุณออฟไลน์อยู่ — บันทึกข้อมูลไว้ในเครื่องแล้ว ระบบจะซิงค์ให้อัตโนมัติเมื่อกลับมาออนไลน์', 'warning');
        location.hash = `/patients/${encodeURIComponent(state.patientId)}`;
      } else if (err instanceof ApiError) {
        stepErrorEl.textContent = err.message;
        stepErrorEl.classList.remove('hidden');
        submitting = false;
        nextBtn.disabled = false;
        nextBtn.textContent = 'บันทึกและส่ง';
      } else {
        showToast('เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง', 'error');
        submitting = false;
        nextBtn.disabled = false;
        nextBtn.textContent = 'บันทึกและส่ง';
      }
    }
  }

  updateChrome();
  rerenderStep();
}

/**
 * ขอตำแหน่ง GPS จริง — ต้องเรียกหลังจากอธิบายเหตุผลให้ผู้ใช้เห็นแล้วเท่านั้น (เรียกจาก step 1)
 * @param {(lat:number, lng:number)=>void} onSuccess
 * @param {(message:string)=>void} onError
 */
function requestGpsPosition(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => onSuccess(position.coords.latitude, position.coords.longitude),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError('ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กรุณาเปิดสิทธิ์ตำแหน่งของเบราว์เซอร์ในการตั้งค่าอุปกรณ์แล้วลองใหม่');
      } else {
        onError('ไม่สามารถระบุตำแหน่งได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/**
 * payload สำหรับ visits.saveDraft (autosave แบบ best-effort ไปที่ backend) — ไม่รวมรูปภาพ/ลายเซ็น
 * เพราะ backend ยังไม่มี action files.upload ให้แปลงเป็น fileId (ดูหมายเหตุใน visit-form-steps.js ขั้นตอนที่ 9)
 * @param {Object} state
 * @return {Object}
 */
function buildDraftPayload(state) {
  return {
    patientId: state.patientId,
    clientTempId: state.clientTempId,
    caregiverName: state.visit.caregiverName,
    relation: state.visit.relation,
    bp: state.visit.bp, hr: state.visit.hr, temp: state.visit.temp, spo2: state.visit.spo2,
    hasWound: !!state.wound.hasWound,
    woundLocation: state.wound.location, woundStage: state.wound.stage, woundSize: state.wound.size, woundCare: state.wound.care,
    symptoms: state.visit.symptoms,
    medication: state.visit.medication, nutrition: state.visit.nutrition, excretion: state.visit.excretion, sleep: state.visit.sleep,
    fallRiskNote: state.visit.fallRiskNote, caregiverBurdenNote: state.visit.caregiverBurdenNote,
    servicesGiven: state.visit.servicesGiven, notes: state.visit.notes, nextVisitDate: state.visit.nextVisitDate,
    gps: { lat: state.gps.lat, lng: state.gps.lng }
  };
}

/**
 * bundle เต็มสำหรับ "บันทึกและส่ง" จริง — ใช้ทั้งตอน submit สด ๆ และตอน sync manager ส่งซ้ำจากคิว (offline/visit-submit.js)
 * @param {Object} state
 * @return {Object}
 */
function buildSubmitBundle(state) {
  const twoQBothNo = state.depression.twoQ.q1 === false && state.depression.twoQ.q2 === false;
  return {
    patientId: state.patientId,
    visitPayload: {
      ...buildDraftPayload(state),
      woundPhotoFileIds: buildPhotoFileIdsMap(state),
      signatureFileId: state.signatureFileId || ''
    },
    barthel: { requestId: state.requestIds.barthel, answers: state.barthel },
    inhomesss: { requestId: state.requestIds.inhomesss, answers: state.inhomesss },
    fallRisk: { requestId: state.requestIds.fallRisk, answers: state.fallRisk },
    pressureUlcer: {
      requestId: state.requestIds.pressureUlcer, hasWound: !!state.wound.hasWound,
      location: state.wound.location, size: state.wound.size, stage: state.wound.stage
    },
    depression: {
      requestId: state.requestIds.depression,
      twoQAnswers: state.depression.twoQ,
      nineQAnswers: twoQBothNo ? undefined : state.depression.nineQ,
      eightQAnswers: (!twoQBothNo && Number(state.depression.nineQ.q9) > 0) ? state.depression.eightQ : undefined
    },
    caregiverBurden: { requestId: state.requestIds.caregiverBurden, answers: state.caregiverBurden }
  };
}

/**
 * เอาเฉพาะรูปที่อัปโหลดขึ้น Drive สำเร็จแล้ว (มี fileId จริง) — รูปที่ยัง uploading/ล้มเหลวจะไม่ถูกแนบไป
 * (ผู้ใช้ต้องอยู่ในสถานะออนไลน์ตอนแนบรูปแต่ละใบ ตามสถาปัตยกรรม "อัปโหลดทันทีตอนเลือกรูป" ของฟอร์มนี้)
 * @param {Object} state
 * @return {Object}
 */
function buildPhotoFileIdsMap(state) {
  const map = {};
  ['before', 'after', 'woundPhoto'].forEach((kind) => {
    if (state.photos[kind] && state.photos[kind].fileId) {
      map[kind] = state.photos[kind].fileId;
    }
  });
  return map;
}

/** @param {string} isoString @return {string} */
function formatThaiDateTime(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}
