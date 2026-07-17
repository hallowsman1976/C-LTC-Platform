/**
 * screens/map.js
 * Map Module — ปักหมุดผู้ป่วยบนแผนที่ (Leaflet + OpenStreetMap, ฟรี ไม่ต้องใช้ API key)
 *
 * หมายเหตุสำคัญ: Patients sheet ไม่มีคอลัมน์ละติจูด/ลองจิจูดของบ้านผู้ป่วยโดยตรง (มีแค่ Village/Tambon/Amphoe/Changwat
 * เป็นข้อความ) — พิกัดที่ใช้ปักหมุดจึงดึงจาก "การเยี่ยมบ้านครั้งล่าสุด" ของผู้ป่วยแต่ละคน (Visits.GpsLat/GpsLng ที่บันทึก
 * ไว้ตอนบันทึกการเยี่ยม) ผ่าน visits.listByPatient — ผู้ป่วยที่ยังไม่เคยถูกเยี่ยมพร้อมเปิด GPS เลยจะยังไม่ขึ้นบนแผนที่
 * (แสดงเป็นรายชื่อแยกไว้ด้านล่างแทน) เป็นข้อจำกัดตามข้อมูลจริงที่มี ไม่ใช่ backend action ใหม่ในเฟสนี้
 */
import { apiCall } from '../api.js';
import { renderCardSkeleton, escapeHtml } from '../ui.js';

const MAP_PAGE_SIZE = 100;
const DEFAULT_CENTER = [13.7563, 100.5018];

let mapInstance = null;

/** @param {HTMLElement} content */
export async function renderMap(content) {
  content.innerHTML = `
    <div class="px-4 py-5 max-w-4xl mx-auto">
      <h1 class="text-lg font-bold text-slate-800 mb-1">แผนที่ผู้ป่วย</h1>
      <p class="text-xs text-slate-400 mb-4">ตำแหน่งจากการเยี่ยมบ้านครั้งล่าสุดของผู้ป่วยแต่ละราย</p>
      <div id="map-container" class="rounded-2xl overflow-hidden shadow-sm mb-4" style="height:420px"></div>
      <div id="map-missing-list"></div>
    </div>
  `;

  const mapContainerEl = content.querySelector('#map-container');
  const missingListEl = content.querySelector('#map-missing-list');
  renderCardSkeleton(mapContainerEl);

  const patientsData = await apiCall('patients.list', { page: 1, pageSize: MAP_PAGE_SIZE });
  const patients = patientsData.items;

  const visitResults = await Promise.all(
    patients.map((p) => apiCall('visits.listByPatient', { patientId: p.patientId, pageSize: 1 }).catch(() => ({ items: [] })))
  );

  const withLocation = [];
  const withoutLocation = [];
  patients.forEach((p, i) => {
    const latestVisit = visitResults[i].items[0];
    const gps = latestVisit && latestVisit.gps;
    if (gps && gps.lat !== null && gps.lat !== undefined && gps.lng !== null && gps.lng !== undefined) {
      withLocation.push({ patient: p, gps });
    } else {
      withoutLocation.push(p);
    }
  });

  mapContainerEl.innerHTML = '';
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  mapInstance = L.map(mapContainerEl).setView(
    withLocation.length > 0 ? [withLocation[0].gps.lat, withLocation[0].gps.lng] : DEFAULT_CENTER,
    withLocation.length > 0 ? 12 : 6
  );
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mapInstance);

  const bounds = [];
  withLocation.forEach(({ patient, gps }) => {
    const marker = L.marker([gps.lat, gps.lng]).addTo(mapInstance);
    marker.bindPopup(`
      <div style="font-size:13px;line-height:1.5">
        <b>${escapeHtml(patient.name)}</b><br/>
        HN ${escapeHtml(patient.hn)} · ${escapeHtml(patient.status)}<br/>
        ${patient.riskLevel ? 'ความเสี่ยง ' + escapeHtml(patient.riskLevel) + '<br/>' : ''}
        <a href="#/patients/${encodeURIComponent(patient.patientId)}">ดูรายละเอียด →</a>
      </div>
    `);
    bounds.push([gps.lat, gps.lng]);
  });

  if (bounds.length > 1) {
    mapInstance.fitBounds(bounds, { padding: [30, 30] });
  }

  renderMissingList(missingListEl, withoutLocation);
}

/**
 * @param {HTMLElement} container
 * @param {Array<Object>} patients
 */
function renderMissingList(container, patients) {
  if (patients.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm p-4">
      <p class="text-sm font-semibold text-slate-700 mb-1">ผู้ป่วยที่ยังไม่มีพิกัดบนแผนที่ (${patients.length} ราย)</p>
      <p class="text-xs text-slate-400 mb-3">จะขึ้นแผนที่อัตโนมัติหลังบันทึกการเยี่ยมบ้านพร้อมเปิด GPS อย่างน้อย 1 ครั้ง</p>
      <div class="divide-y divide-slate-50">
        ${patients.map((p) => `
          <a href="#/patients/${encodeURIComponent(p.patientId)}" class="flex items-center justify-between text-sm py-2">
            <span class="text-slate-700">${escapeHtml(p.name)}</span>
            <span class="text-xs text-slate-400">HN ${escapeHtml(p.hn)}</span>
          </a>
        `).join('')}
      </div>
    </div>
  `;
}
