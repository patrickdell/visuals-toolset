/**
 * thumbnail.js — capture a video frame from the trimmer, crop to aspect ratio,
 * drag to reposition, and export as JPEG / PNG / WebP.
 *
 * Listens for the custom 'trm:loaded' event dispatched by trimmer.js.
 */
import { PRESETS } from './calculator.js';
import { saveFile } from './utils.js';

export function initThumbnail() {
  const videoEl      = document.getElementById('trm-video');
  const section      = document.getElementById('thumb-section');
  const captureBtn   = document.getElementById('thumb-capture-btn');
  const editor       = document.getElementById('thumb-editor');
  const ratioChipsEl = document.getElementById('thumb-ratio-chips');
  const canvas       = document.getElementById('thumb-canvas');
  const exportJpeg   = document.getElementById('thumb-export-jpeg');
  const exportPng    = document.getElementById('thumb-export-png');
  const exportWebp   = document.getElementById('thumb-export-webp');

  if (!canvas) return; // guard if panel not in DOM
  const ctx = canvas.getContext('2d');

  let frame     = null;          // ImageBitmap of captured frame
  let ratio     = PRESETS[0];   // active aspect ratio
  let cropX = 0, cropY = 0, cropW = 0, cropH = 0; // frame-pixel coords
  let fileName  = 'thumbnail';
  let dragging  = false;
  let dragStartX = 0, dragStartY = 0, cropStartX = 0, cropStartY = 0;

  // ── Show/hide when trimmer loads a file ────────────────────────────────────
  document.addEventListener('trm:loaded', e => {
    const { isVideo, file } = e.detail;
    section.style.display = isVideo ? '' : 'none';
    if (isVideo) fileName = file.name.replace(/\.[^.]+$/, '');
    // Reset editor whenever a new file loads
    editor.style.display = 'none';
    frame = null;
  });

  // ── Aspect ratio chips ─────────────────────────────────────────────────────
  PRESETS.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (i === 0 ? ' active' : '');
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      ratioChipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      ratio = p;
      if (frame) { fitCrop(); draw(); }
    });
    ratioChipsEl.appendChild(btn);
  });

  // ── Capture frame at current playhead ─────────────────────────────────────
  captureBtn.addEventListener('click', async () => {
    if (!videoEl || !videoEl.videoWidth) return;
    videoEl.pause(); // freeze so createImageBitmap gets a stable frame
    try {
      frame = await createImageBitmap(videoEl);
    } catch {
      alert('Could not capture frame — try stepping to a different position first.');
      return;
    }
    canvas.width  = frame.width;
    canvas.height = frame.height;
    fitCrop();
    draw();
    editor.style.display = '';
    canvas.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // ── Fit crop box to the selected aspect ratio (centred) ───────────────────
  function fitCrop() {
    const fw = frame.width, fh = frame.height;
    const ar = ratio.w / ratio.h;
    if (fw / fh > ar) {
      // frame is wider → constrain by height
      cropH = fh;
      cropW = cropH * ar;
    } else {
      // frame is taller → constrain by width
      cropW = fw;
      cropH = cropW / ar;
    }
    cropX = (fw - cropW) / 2;
    cropY = (fh - cropH) / 2;
  }

  // ── Draw frame + overlay ───────────────────────────────────────────────────
  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(frame, 0, 0);

    // Darken outside crop
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, cropY);                              // top
    ctx.fillRect(0, cropY + cropH, W, H - cropY - cropH);     // bottom
    ctx.fillRect(0, cropY, cropX, cropH);                      // left
    ctx.fillRect(cropX + cropW, cropY, W - cropX - cropW, cropH); // right

    // Crop border
    const lw = Math.max(2, W / 600);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = lw;
    ctx.strokeRect(cropX, cropY, cropW, cropH);

    // Rule-of-thirds grid
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, W / 1200);
    for (let i = 1; i < 3; i++) {
      line(cropX + cropW * i / 3, cropY,        cropX + cropW * i / 3, cropY + cropH);
      line(cropX,                 cropY + cropH * i / 3, cropX + cropW, cropY + cropH * i / 3);
    }
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  // ── Convert mouse/touch CSS coords → canvas logical coords ────────────────
  function canvasPos(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (canvas.width  / r.width),
      y: (clientY - r.top)  * (canvas.height / r.height),
    };
  }

  function insideCrop(x, y) {
    return x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropH;
  }

  function clampCrop(dx, dy) {
    cropX = Math.max(0, Math.min(frame.width  - cropW, cropStartX + dx));
    cropY = Math.max(0, Math.min(frame.height - cropH, cropStartY + dy));
  }

  // ── Mouse drag ────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', e => {
    const p = canvasPos(e.clientX, e.clientY);
    if (!insideCrop(p.x, p.y)) return;
    dragging = true;
    dragStartX = p.x; dragStartY = p.y;
    cropStartX = cropX; cropStartY = cropY;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const p = canvasPos(e.clientX, e.clientY);
    clampCrop(p.x - dragStartX, p.y - dragStartY);
    draw();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = '';
  });

  canvas.addEventListener('mousemove', e => {
    if (dragging) return;
    const p = canvasPos(e.clientX, e.clientY);
    canvas.style.cursor = insideCrop(p.x, p.y) ? 'grab' : 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    if (!dragging) canvas.style.cursor = '';
  });

  // ── Touch drag ────────────────────────────────────────────────────────────
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    const p = canvasPos(t.clientX, t.clientY);
    if (!insideCrop(p.x, p.y)) return;
    e.preventDefault();
    dragging = true;
    dragStartX = p.x; dragStartY = p.y;
    cropStartX = cropX; cropStartY = cropY;
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (!dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    const p = canvasPos(t.clientX, t.clientY);
    clampCrop(p.x - dragStartX, p.y - dragStartY);
    draw();
  }, { passive: false });

  canvas.addEventListener('touchend', () => { dragging = false; });

  // ── Export ────────────────────────────────────────────────────────────────
  function doExport(format) {
    if (!frame) return;
    const mime    = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format];
    const ext     = format === 'jpeg' ? 'jpg' : format;
    const quality = format === 'jpeg' ? 0.93 : format === 'webp' ? 0.92 : undefined;

    const out = document.createElement('canvas');
    out.width  = Math.round(cropW);
    out.height = Math.round(cropH);
    out.getContext('2d').drawImage(frame, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);

    out.toBlob(blob => {
      if (!blob) {
        alert(`${format.toUpperCase()} export is not supported in this browser. Try JPEG or PNG instead.`);
        return;
      }
      saveFile(blob, `${fileName}-thumbnail.${ext}`, mime);
    }, mime, quality);
  }

  exportJpeg?.addEventListener('click', () => doExport('jpeg'));
  exportPng?.addEventListener('click',  () => doExport('png'));
  exportWebp?.addEventListener('click', () => doExport('webp'));
}
