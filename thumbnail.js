/**
 * thumbnail.js — crop a video clip to a chosen aspect ratio and export it.
 *
 * Lives inside the Trimmer panel. Preview canvas updates live as the user
 * scrubs the timeline — no "capture frame" step needed.
 * Clip duration comes from the trimmer's In / Out points.
 * Listens for the 'trm:loaded' custom event dispatched by trimmer.js.
 */
import { PRESETS } from './calculator.js';
import { saveFile } from './utils.js';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function initThumbnail() {
  const videoEl      = document.getElementById('trm-video');
  const section      = document.getElementById('thumb-section');
  const ratioChipsEl = document.getElementById('thumb-ratio-chips');
  const canvas       = document.getElementById('thumb-canvas');
  const exportBtn    = document.getElementById('thumb-export-btn');
  const progressWrap = document.getElementById('thumb-progress-wrap');
  const progressBar  = document.getElementById('thumb-progress-bar');
  const progressLabel= document.getElementById('thumb-progress-label');

  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let ratio      = PRESETS[0];
  let cropX = 0, cropY = 0, cropW = 0, cropH = 0;
  let fileName   = 'thumbnail';
  let videoReady = false;
  let recording  = false;
  let dragging   = false;
  let dragStartX = 0, dragStartY = 0, cropStartX = 0, cropStartY = 0;

  // ── Show section when a video file loads ───────────────────────────────────
  document.addEventListener('trm:loaded', e => {
    const { isVideo, file } = e.detail;
    section.style.display = isVideo ? '' : 'none';
    videoReady = false;
    if (!isVideo) return;
    fileName = file.name.replace(/\.[^.]+$/, '');
    // videoWidth/Height are already set (event fires inside loadedmetadata)
    canvas.width  = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    fitCrop();
    videoReady = true;
    drawPreview();
    if (progressWrap) progressWrap.style.display = 'none';
  });

  // ── Live preview — updates whenever the video frame changes ────────────────
  videoEl.addEventListener('timeupdate', drawPreview);
  videoEl.addEventListener('seeked',     drawPreview);

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
      fitCrop();
      drawPreview();
    });
    ratioChipsEl.appendChild(btn);
  });

  // ── Fit crop box to chosen ratio, centred in frame ─────────────────────────
  function fitCrop() {
    const fw = videoEl.videoWidth, fh = videoEl.videoHeight;
    if (!fw || !fh) return;
    const ar = ratio.w / ratio.h;
    if (fw / fh > ar) { cropH = fh; cropW = cropH * ar; }
    else               { cropW = fw; cropH = cropW / ar; }
    cropX = (fw - cropW) / 2;
    cropY = (fh - cropH) / 2;
  }

  // ── Draw current video frame + crop overlay ────────────────────────────────
  function drawPreview() {
    if (!videoReady || !videoEl.videoWidth) return;
    const W = canvas.width, H = canvas.height;
    ctx.drawImage(videoEl, 0, 0, W, H);

    // Darken outside crop
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, cropY);
    ctx.fillRect(0, cropY + cropH, W, H - cropY - cropH);
    ctx.fillRect(0, cropY, cropX, cropH);
    ctx.fillRect(cropX + cropW, cropY, W - cropX - cropW, cropH);

    // Crop border
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(2, W / 600);
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

  // ── Canvas coordinate helpers ──────────────────────────────────────────────
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
    cropX = Math.max(0, Math.min(videoEl.videoWidth  - cropW, cropStartX + dx));
    cropY = Math.max(0, Math.min(videoEl.videoHeight - cropH, cropStartY + dy));
  }

  // ── Mouse drag ────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', e => {
    if (!videoReady) return;
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
    drawPreview();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = '';
  });
  canvas.addEventListener('mousemove', e => {
    if (dragging || !videoReady) return;
    const p = canvasPos(e.clientX, e.clientY);
    canvas.style.cursor = insideCrop(p.x, p.y) ? 'grab' : 'default';
  });
  canvas.addEventListener('mouseleave', () => { if (!dragging) canvas.style.cursor = ''; });

  // ── Touch drag ────────────────────────────────────────────────────────────
  canvas.addEventListener('touchstart', e => {
    if (!videoReady) return;
    const t = e.touches[0], p = canvasPos(t.clientX, t.clientY);
    if (!insideCrop(p.x, p.y)) return;
    e.preventDefault();
    dragging = true;
    dragStartX = p.x; dragStartY = p.y;
    cropStartX = cropX; cropStartY = cropY;
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (!dragging) return;
    e.preventDefault();
    const t = e.touches[0], p = canvasPos(t.clientX, t.clientY);
    clampCrop(p.x - dragStartX, p.y - dragStartY);
    drawPreview();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { dragging = false; });

  // ── Export cropped clip ───────────────────────────────────────────────────
  exportBtn?.addEventListener('click', () => {
    if (!videoReady || recording) return;
    const inPt  = parseFloat(document.getElementById('trm-range-in')?.value)  ?? 0;
    const outPt = parseFloat(document.getElementById('trm-range-out')?.value) ?? (videoEl.duration ?? 0);
    if (outPt <= inPt) {
      alert('Set In and Out points in the trimmer above to define the clip length.');
      return;
    }
    recordClip(inPt, outPt);
  });

  async function recordClip(inPt, outPt) {
    recording = true;
    exportBtn.disabled = true;
    progressWrap.style.display = '';
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Starting…';

    const duration = outPt - inPt;
    const maxW = 1280;
    const scale = Math.min(1, maxW / cropW);
    const outW  = Math.round(cropW * scale);
    const outH  = Math.round(cropH * scale);

    const offCanvas = document.createElement('canvas');
    offCanvas.width  = outW;
    offCanvas.height = outH;
    const offCtx = offCanvas.getContext('2d', { alpha: false });

    const mime = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const ext  = mime.startsWith('video/mp4') ? 'mp4' : 'webm';

    const stream   = offCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    const wasMuted = videoEl.muted;
    videoEl.muted = true;
    videoEl.currentTime = inPt;
    await new Promise(r => videoEl.addEventListener('seeked', r, { once: true }));

    progressLabel.textContent = 'Recording…';
    recorder.start(100);
    videoEl.play();

    await new Promise(resolve => {
      let rafId;
      function tick() {
        const elapsed = videoEl.currentTime - inPt;
        if (elapsed < 0 || videoEl.currentTime >= outPt - 0.033) {
          videoEl.pause();
          cancelAnimationFrame(rafId);
          resolve();
          return;
        }
        progressBar.style.width = Math.round(Math.min(95, (elapsed / duration) * 100)) + '%';
        progressLabel.textContent = `Recording… ${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s`;
        offCtx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    });

    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    videoEl.muted = wasMuted;
    videoEl.currentTime = inPt;

    progressBar.style.width = '100%';
    progressLabel.textContent = 'Saving…';
    await saveFile(new Blob(chunks, { type: mime }), `${fileName}-thumbnail.${ext}`, mime);
    setTimeout(() => { progressWrap.style.display = 'none'; }, 800);

    recording = false;
    exportBtn.disabled = false;
  }
}
