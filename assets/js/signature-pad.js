/**
 * signature-pad.js
 * ลายเซ็นแบบวาดบน canvas ด้วยนิ้ว/เมาส์ — เบา ไม่พึ่ง library ภายนอก (ใช้ Pointer Events รองรับทั้ง touch/mouse/stylus)
 */

/**
 * ผูก event การวาดลายเซ็นเข้ากับ canvas ที่ให้มา
 * @param {HTMLCanvasElement} canvas
 * @return {{isEmpty: () => boolean, clear: () => void, toDataUrl: () => string|null, destroy: () => void}}
 */
export function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1e293b';

  let drawing = false;
  let hasStrokes = false;
  let lastPoint = null;

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function handlePointerDown(event) {
    event.preventDefault();
    drawing = true;
    lastPoint = getPoint(event);
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!drawing) return;
    event.preventDefault();
    const point = getPoint(event);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint = point;
    hasStrokes = true;
  }

  function handlePointerUp(event) {
    drawing = false;
    lastPoint = null;
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.style.touchAction = 'none';

  return {
    isEmpty: () => !hasStrokes,
    clear: () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasStrokes = false;
    },
    toDataUrl: () => (hasStrokes ? canvas.toDataURL('image/png') : null),
    destroy: () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
    }
  };
}
