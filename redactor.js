/**
 * redactor.js — Auto-Redactor for source protection
 *
 * Runs Xenova/yolos-tiny (Transformers.js) in a Web Worker to detect
 * persons and vehicles, renders adjustable bounding boxes on a canvas,
 * then exports:
 *   images – canvas-based blur / pixelate / solid black
 *   video  – FFmpeg.wasm filter (avgblur or drawbox)
 */

import { setupDropzone, saveFile, setActiveChip } from './utils.js';
import { getFFmpeg } from './ffmpeg-shared.js';

// ── Module state ───────────────────────────────────────────────────────────────

const S = {
  file:    null,       // File
  isVideo: false,
  bitmap:  null,       // ImageBitmap (image or first video frame)
  natW:    0,
  natH:    0,
  boxes:   [],         // [{ id, x, y, w, h, label, score }]
  nextId:  1,
  selId:   null,
  style:   'blur',     // 'blur' | 'pixelate' | 'black'
  target:  'people',   // 'people' | 'vehicles' | 'all'
  drag:    null,       // active drag/resize op
};

let inDrawMode   = false;
let worker       = null;
let pendingBlob  = null;   // blob URL waiting to be revoked after detection
let canvas, ctx, displayScale;

// ── Init ───────────────────────────────────────────────────────────────────────

export function initRedactor() {
  canvas = document.getElementById('rd-canvas');
  ctx    = canvas.getContext('2d', { willReadFrequently: true });
  displayScale = 1;

  setupDropzone(
    document.getElementById('rd-dropzone'),
    f => f.type.startsWith('image/') || f.type.startsWith('video/'),
    loadFile
  );
  document.getElementById('rd-file-input').addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });
  document.getElementById('rd-load-different').addEventListener('click', resetToDropzone);

  document.getElementById('rd-style-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-style]');
    if (!chip) return;
    S.style = chip.dataset.style;
    setActiveChip(document.getElementById('rd-style-chips'), chip);
  });

  document.getElementById('rd-target-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-target]');
    if (!chip) return;
    S.target = chip.dataset.target;
    setActiveChip(document.getElementById('rd-target-chips'), chip);
  });

  document.getElementById('rd-detect-btn').addEventListener('click', startDetection);
  document.getElementById('rd-add-btn').addEventListener('click', enterDrawMode);
  document.getElementById('rd-clear-btn').addEventListener('click', clearBoxes);
  document.getElementById('rd-export-btn').addEventListener('click', exportResult);

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup',   onUp);
  canvas.addEventListener('mouseleave', () => {
    // Cancel move/resize if mouse leaves; preserve draw mode
    if (S.drag && S.drag.type !== 'drawing') { S.drag = null; }
  });

  document.addEventListener('keydown', e => {
    if (!document.getElementById('panel-redact')?.classList.contains('visible')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selId !== null) {
      e.preventDefault();
      S.boxes = S.boxes.filter(b => b.id !== S.selId);
      S.selId = null;
      redraw();
    }
    if (e.key === 'Escape' && inDrawMode) {
      inDrawMode = false;
      S.drag = null;
      canvas.style.cursor = 'default';
      setStatus('');
      redraw();
    }
  });
}

// ── File loading ───────────────────────────────────────────────────────────────

async function loadFile(file) {
  S.file    = file;
  S.isVideo = file.type.startsWith('video/');
  S.boxes   = [];
  S.selId   = null;
  inDrawMode = false;
  S.drag    = null;
  setStatus('');
  setExportStatus('');

  const url = URL.createObjectURL(file);
  try {
    if (S.isVideo) {
      await extractVideoFrame(url);
    } else {
      S.bitmap = await createImageBitmap(file);
      S.natW   = S.bitmap.width;
      S.natH   = S.bitmap.height;
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  setupCanvas();
  redraw();
  showLoaded(file.name);
}

async function extractVideoFrame(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.src         = url;
    v.muted       = true;
    v.playsInline = true;
    v.addEventListener('loadeddata', () => { v.currentTime = 0.5; });
    v.addEventListener('seeked', async () => {
      S.bitmap = await createImageBitmap(v);
      S.natW   = v.videoWidth;
      S.natH   = v.videoHeight;
      resolve();
    });
    v.addEventListener('error', reject);
    v.load();
  });
}

function resetToDropzone() {
  S.file = S.bitmap = null;
  S.boxes = []; S.selId = null;
  inDrawMode = false; S.drag = null;
  document.getElementById('rd-dropzone-wrap').style.display = '';
  document.getElementById('rd-loaded-bar').style.display = 'none';
  document.getElementById('rd-canvas-wrap').style.display = 'none';
  document.getElementById('rd-bottom-card').style.display = 'none';
  document.getElementById('rd-file-input').value = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus(''); setExportStatus('');
}

function showLoaded(name) {
  document.getElementById('rd-dropzone-wrap').style.display = 'none';
  document.getElementById('rd-loaded-bar').style.display = '';
  document.getElementById('rd-file-name').textContent = name;
  document.getElementById('rd-canvas-wrap').style.display = 'block';
  document.getElementById('rd-bottom-card').style.display = 'block';
  document.getElementById('rd-detect-btn').disabled = false;
  if (S.isVideo) {
    document.getElementById('rd-video-note').style.display = '';
  } else {
    document.getElementById('rd-video-note').style.display = 'none';
  }
}

// ── Canvas setup ───────────────────────────────────────────────────────────────

function setupCanvas() {
  const MAX  = 860;
  const wrap = document.getElementById('rd-canvas-wrap');
  const cw   = Math.min(wrap.clientWidth || MAX, MAX);
  const ch   = Math.round(cw * S.natH / S.natW);
  canvas.width       = S.natW;
  canvas.height      = S.natH;
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  displayScale = S.natW / cw;
}

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * displayScale,
    y: (e.clientY - r.top)  * displayScale,
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────────

const HR = 6; // handle hit-radius in CSS pixels

function redraw() {
  if (!S.bitmap) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(S.bitmap, 0, 0);
  for (const box of S.boxes) drawBox(box, box.id === S.selId);
}

function drawBox(box, sel) {
  const lw = Math.max(1.5, displayScale * 1.5);
  ctx.save();

  // Box fill + stroke
  ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255, 70, 70, 0.95)';
  ctx.fillStyle   = 'rgba(255, 70, 70, 0.12)';
  ctx.lineWidth   = lw;
  ctx.setLineDash(sel ? [] : [Math.round(6 * displayScale), Math.round(4 * displayScale)]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.setLineDash([]);

  // Label badge
  const label = (box.label || 'region') + (box.score ? ` ${Math.round(box.score * 100)}%` : '');
  const fs    = Math.max(11, Math.round(13 * displayScale));
  ctx.font    = `500 ${fs}px system-ui, sans-serif`;
  const tw    = ctx.measureText(label).width + 8 * displayScale;
  const bh    = fs + 6 * displayScale;
  const badgeY = Math.max(0, box.y - bh);
  ctx.fillStyle = sel ? 'rgba(255,255,255,0.95)' : 'rgba(255,70,70,0.95)';
  ctx.fillRect(box.x, badgeY, tw, bh);
  ctx.fillStyle = sel ? '#111' : '#fff';
  ctx.fillText(label, box.x + 4 * displayScale, badgeY + bh - 4 * displayScale);

  // Corner handles when selected
  if (sel) {
    for (const h of getHandles(box)) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, HR * displayScale, 0, Math.PI * 2);
      ctx.fillStyle   = '#fff';
      ctx.strokeStyle = 'rgba(255,70,70,0.95)';
      ctx.lineWidth   = Math.max(1, displayScale);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function getHandles(box) {
  return [
    { n: 'tl', x: box.x,         y: box.y          },
    { n: 'tr', x: box.x + box.w, y: box.y          },
    { n: 'bl', x: box.x,         y: box.y + box.h  },
    { n: 'br', x: box.x + box.w, y: box.y + box.h  },
  ];
}

function hitHandle(pos, box) {
  const r = HR * displayScale * 1.8;
  for (const h of getHandles(box)) {
    if (Math.abs(pos.x - h.x) < r && Math.abs(pos.y - h.y) < r) return h.n;
  }
  return null;
}

function hitBox(pos, box) {
  return pos.x >= box.x && pos.x <= box.x + box.w
      && pos.y >= box.y && pos.y <= box.y + box.h;
}

function cursorFor(handle) {
  return { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' }[handle] || 'default';
}

function updateCursor(pos) {
  if (inDrawMode) { canvas.style.cursor = 'crosshair'; return; }
  if (S.selId !== null) {
    const sel = S.boxes.find(b => b.id === S.selId);
    if (sel) { const h = hitHandle(pos, sel); if (h) { canvas.style.cursor = cursorFor(h); return; } }
  }
  for (let i = S.boxes.length - 1; i >= 0; i--) {
    if (hitBox(pos, S.boxes[i])) { canvas.style.cursor = 'move'; return; }
  }
  canvas.style.cursor = 'default';
}

// ── Mouse interaction ──────────────────────────────────────────────────────────

function onDown(e) {
  if (!S.bitmap) return;
  const pos = canvasPos(e);

  if (inDrawMode) {
    S.drag = { type: 'drawing', x0: pos.x, y0: pos.y };
    return;
  }

  // Resize handle of selected box
  if (S.selId !== null) {
    const sel = S.boxes.find(b => b.id === S.selId);
    if (sel) {
      const h = hitHandle(pos, sel);
      if (h) {
        S.drag = { type: 'resize', id: S.selId, handle: h, x0: pos.x, y0: pos.y, orig: { ...sel } };
        canvas.style.cursor = cursorFor(h);
        return;
      }
    }
  }

  // Move any box (reverse order so topmost wins)
  for (let i = S.boxes.length - 1; i >= 0; i--) {
    if (hitBox(pos, S.boxes[i])) {
      S.selId = S.boxes[i].id;
      S.drag  = { type: 'move', id: S.boxes[i].id, x0: pos.x, y0: pos.y, orig: { ...S.boxes[i] } };
      canvas.style.cursor = 'move';
      redraw();
      return;
    }
  }

  S.selId = null;
  redraw();
}

function onMove(e) {
  if (!S.bitmap) return;
  const pos = canvasPos(e);

  if (!S.drag) { updateCursor(pos); return; }

  const dx = pos.x - S.drag.x0;
  const dy = pos.y - S.drag.y0;

  if (S.drag.type === 'drawing') {
    redraw();
    const x = Math.min(S.drag.x0, pos.x), y = Math.min(S.drag.y0, pos.y);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = Math.max(1.5, displayScale * 1.5);
    ctx.setLineDash([6 * displayScale, 4 * displayScale]);
    ctx.strokeRect(x, y, Math.abs(dx), Math.abs(dy));
    ctx.restore();
    return;
  }

  const box = S.boxes.find(b => b.id === S.drag.id);
  if (!box) return;

  if (S.drag.type === 'move') {
    box.x = clamp(S.drag.orig.x + dx, 0, S.natW - box.w);
    box.y = clamp(S.drag.orig.y + dy, 0, S.natH - box.h);
  } else {
    applyResize(box, S.drag.handle, dx, dy, S.drag.orig);
  }
  redraw();
}

function onUp(e) {
  if (!S.bitmap || !S.drag) return;
  const raw = canvasPos(e);
  const pos = { x: clamp(raw.x, 0, S.natW), y: clamp(raw.y, 0, S.natH) };

  if (S.drag.type === 'drawing') {
    const dx = pos.x - S.drag.x0, dy = pos.y - S.drag.y0;
    if (Math.abs(dx) > 8 * displayScale && Math.abs(dy) > 8 * displayScale) {
      const nb = {
        id:    S.nextId++,
        x:     Math.min(S.drag.x0, pos.x),
        y:     Math.min(S.drag.y0, pos.y),
        w:     Math.abs(dx),
        h:     Math.abs(dy),
        label: 'manual',
        score: null,
      };
      S.boxes.push(nb);
      S.selId = nb.id;
    }
    inDrawMode = false;
    S.drag = null;
    canvas.style.cursor = 'default';
    setStatus('');
    redraw();
    return;
  }

  S.drag = null;
}

const MIN_BOX = 20;
function applyResize(box, handle, dx, dy, o) {
  if (handle === 'tl') {
    box.x = clamp(o.x + dx, 0, o.x + o.w - MIN_BOX); box.w = o.w - (box.x - o.x);
    box.y = clamp(o.y + dy, 0, o.y + o.h - MIN_BOX); box.h = o.h - (box.y - o.y);
  } else if (handle === 'tr') {
    box.y = clamp(o.y + dy, 0, o.y + o.h - MIN_BOX); box.h = o.h - (box.y - o.y);
    box.w = Math.max(MIN_BOX, o.w + dx);
  } else if (handle === 'bl') {
    box.x = clamp(o.x + dx, 0, o.x + o.w - MIN_BOX); box.w = o.w - (box.x - o.x);
    box.h = Math.max(MIN_BOX, o.h + dy);
  } else if (handle === 'br') {
    box.w = Math.max(MIN_BOX, o.w + dx);
    box.h = Math.max(MIN_BOX, o.h + dy);
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function enterDrawMode() {
  inDrawMode = true;
  canvas.style.cursor = 'crosshair';
  setStatus('Click and drag on the image to draw a redaction region. Press Esc to cancel.');
}

function clearBoxes() {
  S.boxes = []; S.selId = null;
  redraw();
  setStatus('');
}

// ── Detection worker ───────────────────────────────────────────────────────────

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./redactor.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', onWorkerMsg);
  }
  return worker;
}

function onWorkerMsg({ data }) {
  if (data.type === 'status')     { setStatus(data.text); }
  if (data.type === 'download')   { setStatus(`Downloading model… ${data.total ? Math.round(data.loaded / data.total * 100) : 0}%`); }
  if (data.type === 'ready')      { runInference(); }
  if (data.type === 'detections') { applyDetections(data.boxes); }
  if (data.type === 'error') {
    setStatus('Detection failed: ' + data.message);
    document.getElementById('rd-detect-btn').disabled = false;
  }
}

function startDetection() {
  if (!S.bitmap) return;
  document.getElementById('rd-detect-btn').disabled = true;
  setStatus('Loading model… (~30 MB on first run, then cached)');
  getWorker().postMessage({ type: 'load' });
}

function runInference() {
  const off = document.createElement('canvas');
  off.width = S.natW; off.height = S.natH;
  off.getContext('2d').drawImage(S.bitmap, 0, 0);
  off.toBlob(blob => {
    pendingBlob = URL.createObjectURL(blob);
    getWorker().postMessage({ type: 'detect', imageUrl: pendingBlob, target: S.target, threshold: 0.3 });
  }, 'image/jpeg', 0.85);
}

function applyDetections(rawBoxes) {
  if (pendingBlob) { URL.revokeObjectURL(pendingBlob); pendingBlob = null; }

  const manual   = S.boxes.filter(b => b.label === 'manual');
  const detected = rawBoxes.map(b => ({ ...b, id: S.nextId++ }));
  S.boxes = [...manual, ...detected];
  S.selId = null;

  const n = detected.length;
  setStatus(n
    ? `Found ${n} region${n !== 1 ? 's' : ''}. Click to select and adjust, then export.`
    : 'No regions detected. Try a different target or add regions manually.'
  );
  document.getElementById('rd-detect-btn').disabled = false;
  redraw();
}

function setStatus(text) {
  const el = document.getElementById('rd-detect-status');
  if (!el) return;
  el.textContent  = text;
  el.style.display = text ? '' : 'none';
}

function setExportStatus(text) {
  const el = document.getElementById('rd-export-status');
  if (!el) return;
  el.textContent  = text;
  el.style.display = text ? '' : 'none';
}

// ── Export ─────────────────────────────────────────────────────────────────────

async function exportResult() {
  if (!S.file) return;
  if (S.boxes.length === 0) { setExportStatus('Add at least one redaction region first.'); return; }
  document.getElementById('rd-export-btn').disabled = true;
  setExportStatus('');
  try {
    if (S.isVideo) await exportVideo();
    else exportImage();
  } finally {
    document.getElementById('rd-export-btn').disabled = false;
  }
}

// Image: canvas-based redaction
function exportImage() {
  const off = document.createElement('canvas');
  off.width = S.natW; off.height = S.natH;
  const c = off.getContext('2d');
  c.drawImage(S.bitmap, 0, 0);
  for (const box of S.boxes) applyRedaction(c, box);
  off.toBlob(blob => {
    saveFile(blob, S.file.name.replace(/\.[^.]+$/, '') + '_redacted.png', 'image/png');
  }, 'image/png');
}

function applyRedaction(c, box) {
  const bx = Math.max(0, Math.round(box.x));
  const by = Math.max(0, Math.round(box.y));
  const bw = Math.min(Math.round(box.w), S.natW - bx);
  const bh = Math.min(Math.round(box.h), S.natH - by);
  if (bw <= 0 || bh <= 0) return;

  if (S.style === 'black') {
    c.fillStyle = '#000';
    c.fillRect(bx, by, bw, bh);
    return;
  }

  if (S.style === 'blur') {
    const sigma = Math.max(8, Math.round(Math.min(bw, bh) / 6));
    const pad   = sigma * 2;
    const ex    = Math.max(0, bx - pad);
    const ey    = Math.max(0, by - pad);
    const ew    = Math.min(S.natW, bx + bw + pad) - ex;
    const eh    = Math.min(S.natH, by + bh + pad) - ey;
    c.save();
    c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
    c.filter = `blur(${sigma}px)`;
    c.drawImage(S.bitmap, ex, ey, ew, eh, ex, ey, ew, eh);
    c.restore();
    return;
  }

  // Pixelate
  const ps  = Math.max(6, Math.round(Math.min(bw, bh) / 12));
  const tw  = Math.max(1, Math.round(bw / ps));
  const th  = Math.max(1, Math.round(bh / ps));
  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  tmp.getContext('2d').drawImage(S.bitmap, bx, by, bw, bh, 0, 0, tw, th);
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(tmp, 0, 0, tw, th, bx, by, bw, bh);
  c.restore();
}

// Video: FFmpeg.wasm filter
async function exportVideo() {
  setExportStatus('Loading FFmpeg…');
  try {
    const ff    = await getFFmpeg();
    const ext   = S.file.name.split('.').pop();
    const inFile  = `rd_in.${ext}`;
    const outFile = 'rd_out.mp4';

    setExportStatus('Writing input…');
    ff.FS('writeFile', inFile, new Uint8Array(await S.file.arrayBuffer()));

    setExportStatus('Processing video…');
    await ff.run(...buildVideoArgs(S.boxes, S.style, inFile, outFile));

    setExportStatus('Saving…');
    const data = ff.FS('readFile', outFile);
    ff.FS('unlink', inFile);
    ff.FS('unlink', outFile);

    saveFile(
      new Blob([data.buffer], { type: 'video/mp4' }),
      S.file.name.replace(/\.[^.]+$/, '') + '_redacted.mp4',
      'video/mp4'
    );
    setExportStatus('');
  } catch (err) {
    setExportStatus('Export failed: ' + err.message);
    console.error('Redactor export error:', err);
  }
}

function buildVideoArgs(boxes, style, inFile, outFile) {
  const cl = b => ({
    x: Math.max(0, Math.round(b.x)),
    y: Math.max(0, Math.round(b.y)),
    w: Math.max(2, Math.round(b.w)),
    h: Math.max(2, Math.round(b.h)),
  });

  if (boxes.length === 0) return ['-i', inFile, '-c', 'copy', outFile];

  // Solid black: simple drawbox chain
  if (style === 'black') {
    const vf = boxes.map(b => {
      const { x, y, w, h } = cl(b);
      return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black@1:t=fill`;
    }).join(',');
    return ['-i', inFile, '-vf', vf, '-c:a', 'copy', '-preset', 'fast', outFile];
  }

  // Blur / pixelate: filter_complex with per-region crop+filter+overlay chain
  const n  = boxes.length;
  const fc = [];
  fc.push(`[0:v]split=${n + 1}[vb]${boxes.map((_, i) => `[vs${i}]`).join('')}`);

  boxes.forEach((b, i) => {
    const { x, y, w, h } = cl(b);
    const sz = Math.max(10, Math.round(Math.min(w, h) / 4));
    const fx = style === 'blur'
      ? `avgblur=sizeX=${sz}:sizeY=${sz}`
      : `scale=${Math.max(1, Math.round(w / 12))}:${Math.max(1, Math.round(h / 12))}:flags=neighbor,scale=${w}:${h}:flags=neighbor`;
    fc.push(`[vs${i}]crop=${w}:${h}:${x}:${y},${fx}[vblr${i}]`);
  });

  let prev = 'vb';
  boxes.forEach((b, i) => {
    const { x, y } = cl(b);
    const out = i === n - 1 ? 'vo' : `vov${i}`;
    fc.push(`[${prev}][vblr${i}]overlay=${x}:${y}[${out}]`);
    prev = out;
  });

  return [
    '-i', inFile,
    '-filter_complex', fc.join(';'),
    '-map', '[vo]',
    '-map', '0:a?',
    '-c:a', 'copy',
    '-preset', 'fast',
    outFile,
  ];
}
