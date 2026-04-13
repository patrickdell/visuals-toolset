/**
 * labeller.js — overlay a disclosure label on a photo, drag/resize, save.
 * Labels are drawn on canvas (no external PNG needed) to match the supplied design.
 */

const LABELS = [
  { text: 'AI-GENERATED',  bg: '#CC0000' },
  { text: 'FAKE',          bg: '#CC0000' },
  { text: 'DEEPFAKE',      bg: '#CC0000' },
  { text: 'DECEPTIVE',     bg: '#CC0000' },
  { text: 'MISLEADING',    bg: '#CC0000' },
  { text: 'EDITED',        bg: '#CC0000' },
  { text: 'MANIPULATED',   bg: '#CC0000' },
  { text: 'SATIRE',        bg: '#CC0000' },
  { text: 'FALSE CONTEXT', bg: '#CC0000' },
  { text: 'HOAX',          bg: '#CC0000' },
  { text: 'PHOTOSHOPPED',  bg: '#CC0000' },
  { text: 'CLONED VOICE',  bg: '#CC0000' },
  { text: 'VERIFIED',      bg: '#4472C4' },
  { text: 'TRUE',          bg: '#4472C4' },
];

const HANDLE_R  = 7;   // px radius of corner handle circles
const MIN_W     = 60;
const MIN_H     = 16;

export function initLabeller() {
  const dropzone   = document.getElementById('lbl-dropzone');
  const fileInput  = document.getElementById('lbl-file-input');
  const chipsEl    = document.getElementById('lbl-chips');
  const canvasWrap = document.getElementById('lbl-canvas-wrap');
  const canvas     = document.getElementById('lbl-canvas');
  const ctx        = canvas.getContext('2d');
  const saveRow    = document.getElementById('lbl-save-row');
  const saveJpgBtn = document.getElementById('lbl-save-jpg');
  const savePngBtn = document.getElementById('lbl-save-png');

  // ── State ──────────────────────────────────────────────────────────────────
  let photo       = null;   // ImageBitmap
  let photoW      = 0;
  let photoH      = 0;
  let fileName    = '';
  let lbl         = null;   // { text, bg, x, y, w, h } in canvas-display coords
  let drag        = null;   // { mode, handle?, startX, startY, origLbl }
  let selectedIdx = 0;

  // ── Build label chips ──────────────────────────────────────────────────────
  LABELS.forEach((def, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const colorClass = def.bg === '#CC0000' ? 'lbl-chip-red' : 'lbl-chip-blue';
    btn.className = 'chip ' + colorClass + (i === 0 ? ' active' : '');
    btn.textContent = def.text;
    btn.addEventListener('click', () => {
      selectedIdx = i;
      syncChips();
      if (lbl) {
        lbl.text = LABELS[i].text;
        lbl.bg   = LABELS[i].bg;
        draw();
      }
    });
    chipsEl.appendChild(btn);
  });

  function syncChips() {
    chipsEl.querySelectorAll('.chip').forEach((btn, i) => {
      btn.classList.toggle('active', i === selectedIdx);
    });
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (f) loadFile(f);
  });

  // ── Load photo ─────────────────────────────────────────────────────────────
  async function loadFile(file) {
    fileName = file.name;
    if (photo) photo.close();
    photo = await createImageBitmap(file);
    photoW = photo.width;
    photoH = photo.height;
    sizeCanvas();
    placeLabelDefault();
    canvasWrap.style.display = '';
    saveRow.style.display    = '';
    dropzone.querySelector('.lbl-drop-text').textContent = file.name;
    dropzone.classList.add('has-file');
    draw();
  }

  function sizeCanvas() {
    const maxW = Math.min(canvasWrap.parentElement.clientWidth || 860, 860);
    canvas.width  = maxW;
    canvas.height = Math.round(maxW * photoH / photoW);
  }

  function placeLabelDefault() {
    const lw = canvas.width * 0.40;
    const lh = lw / 3.8;
    lbl = {
      text: LABELS[selectedIdx].text,
      bg:   LABELS[selectedIdx].bg,
      x:    (canvas.width  - lw) / 2,
      y:    canvas.height * 0.80 - lh / 2,
      w:    lw,
      h:    lh,
    };
  }

  // Re-size canvas if window resizes (keeps label in proportional position)
  window.addEventListener('resize', () => {
    if (!photo) return;
    const oldW = canvas.width;
    sizeCanvas();
    if (lbl && oldW > 0) {
      const ratio = canvas.width / oldW;
      lbl.x *= ratio; lbl.y *= ratio;
      lbl.w *= ratio; lbl.h *= ratio;
    }
    draw();
  });

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Photo
    if (photo) ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);

    if (!lbl) return;

    // Label rectangle
    ctx.fillStyle = lbl.bg;
    ctx.fillRect(lbl.x, lbl.y, lbl.w, lbl.h);

    // Label text — bold, centred, white, all-caps (text is already upper)
    const fontSize = Math.max(8, Math.round(lbl.h * 0.52));
    ctx.font         = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#fff';
    ctx.fillText(lbl.text, lbl.x + lbl.w / 2, lbl.y + lbl.h / 2, lbl.w * 0.92);

    // Corner handles
    drawHandles();
  }

  function drawHandles() {
    for (const [hx, hy] of Object.values(getCorners())) {
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle   = '#fff';
      ctx.strokeStyle = '#222';
      ctx.lineWidth   = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  }

  function getCorners() {
    return {
      tl: [lbl.x,          lbl.y],
      tr: [lbl.x + lbl.w,  lbl.y],
      bl: [lbl.x,          lbl.y + lbl.h],
      br: [lbl.x + lbl.w,  lbl.y + lbl.h],
    };
  }

  // ── Pointer interaction ────────────────────────────────────────────────────
  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top)  * scaleY,
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  canvas.addEventListener('pointerdown', e => {
    if (!lbl) return;
    const { cx, cy } = canvasXY(e);

    // 1. Check corner handles first (slightly enlarged hit area)
    const corners = getCorners();
    for (const [name, [hx, hy]] of Object.entries(corners)) {
      if (Math.hypot(cx - hx, cy - hy) <= HANDLE_R + 5) {
        drag = { mode: 'resize', handle: name, startX: cx, startY: cy, origLbl: { ...lbl } };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    // 2. Check label body
    if (cx >= lbl.x && cx <= lbl.x + lbl.w && cy >= lbl.y && cy <= lbl.y + lbl.h) {
      drag = { mode: 'move', startX: cx, startY: cy, origLbl: { ...lbl } };
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const { cx, cy } = canvasXY(e);
    const o = drag.origLbl;

    if (drag.mode === 'move') {
      lbl.x = clamp(o.x + (cx - drag.startX), 0, canvas.width  - lbl.w);
      lbl.y = clamp(o.y + (cy - drag.startY), 0, canvas.height - lbl.h);
    } else {
      resizeFromHandle(drag.handle, cx, cy, o);
    }
    draw();
  });

  canvas.addEventListener('pointerup',     () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  function resizeFromHandle(handle, cx, cy, o) {
    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;

    if (handle === 'br') {
      nw = Math.max(MIN_W, cx - o.x);
      nh = Math.max(MIN_H, cy - o.y);
      nx = o.x; ny = o.y;
    } else if (handle === 'tl') {
      nw = Math.max(MIN_W, o.x + o.w - cx);
      nh = Math.max(MIN_H, o.y + o.h - cy);
      nx = o.x + o.w - nw;
      ny = o.y + o.h - nh;
    } else if (handle === 'tr') {
      nw = Math.max(MIN_W, cx - o.x);
      nh = Math.max(MIN_H, o.y + o.h - cy);
      nx = o.x;
      ny = o.y + o.h - nh;
    } else if (handle === 'bl') {
      nw = Math.max(MIN_W, o.x + o.w - cx);
      nh = Math.max(MIN_H, cy - o.y);
      nx = o.x + o.w - nw;
      ny = o.y;
    }

    lbl.x = nx; lbl.y = ny; lbl.w = nw; lbl.h = nh;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  saveJpgBtn.addEventListener('click', () => saveAs('image/jpeg'));
  savePngBtn.addEventListener('click', () => saveAs('image/png'));

  async function saveAs(mime) {
    if (!photo) return;
    const ext  = mime === 'image/jpeg' ? 'jpg' : 'png';
    const qual = mime === 'image/jpeg' ? 0.92  : undefined;

    // Render at the photo's native resolution
    const off = document.createElement('canvas');
    off.width  = photoW;
    off.height = photoH;
    const octx  = off.getContext('2d');
    const scale = photoW / canvas.width;

    octx.drawImage(photo, 0, 0, photoW, photoH);

    if (lbl) {
      const sl = {
        x: lbl.x * scale,
        y: lbl.y * scale,
        w: lbl.w * scale,
        h: lbl.h * scale,
      };
      octx.fillStyle = lbl.bg;
      octx.fillRect(sl.x, sl.y, sl.w, sl.h);

      const fs = Math.max(8, Math.round(sl.h * 0.52));
      octx.font         = `900 ${fs}px 'Arial Black', Arial, sans-serif`;
      octx.textAlign    = 'center';
      octx.textBaseline = 'middle';
      octx.fillStyle    = '#fff';
      octx.fillText(lbl.text, sl.x + sl.w / 2, sl.y + sl.h / 2, sl.w * 0.92);
    }

    const blob = await new Promise(res => off.toBlob(res, mime, qual));
    const name = (fileName.replace(/\.[^.]+$/, '') || 'photo') + '_labelled.' + ext;

    if ('showSaveFilePicker' in window) {
      try {
        const mimeMap = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] };
        const fh = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Image', accept: { [mime]: mimeMap[mime] } }],
        });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn(e);
      }
    }

    // Fallback: anchor download
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
