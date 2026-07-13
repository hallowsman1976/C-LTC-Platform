/**
 * image-utils.js
 * ย่อขนาด/บีบอัดรูปภาพก่อนเก็บ/ส่ง — กันไฟล์ภาพจากกล้องมือถือ (มักหลาย MB) ทำให้ IndexedDB/การอัปโหลดช้าหรือเกินโควตา
 */

const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_JPEG_QUALITY = 0.72;

/**
 * ย่อขนาดไฟล์ภาพ (จาก <input type="file"> หรือกล้อง) ให้ด้านยาวสุดไม่เกิน maxDimension แล้วบีบอัดเป็น JPEG
 * @param {File|Blob} file
 * @param {{maxDimension?: number, quality?: number}=} options
 * @return {Promise<{dataUrl: string, blob: Blob, width: number, height: number}>}
 */
export function resizeImageFile(file, options = {}) {
  const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;
  const quality = options.quality || DEFAULT_JPEG_QUALITY;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ภาพได้'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์นี้ไม่ใช่ภาพที่รองรับ'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('บีบอัดภาพไม่สำเร็จ'));
              return;
            }
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve({ dataUrl, blob, width, height });
          },
          'image/jpeg',
          quality
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * ประมาณขนาดไฟล์ (ไบต์) จาก data URL — ใช้แสดงผลให้ผู้ใช้เห็นว่าย่อขนาดแล้วเหลือเท่าไร
 * @param {string} dataUrl
 * @return {number}
 */
export function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}

/** @param {number} bytes @return {string} เช่น "245 KB" */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
