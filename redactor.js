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

// ── Constants ──────────────────────────────────────────────────────────────────
const STYLES = { BLUR: 'blur', PIXELATE: 'pixelate', BLACK: 'black' };
const TARGETS = { PEOPLE: 'people', VEHICLES: 'vehicles', ALL: 'all' };
const MSG_TYPES = { STATUS: 'status', DOWNLOAD: 'download', READY: 'ready', DETECTIONS: 'detections', ERROR: 'error', LOAD: 'load', DETECT: 'detect' };
const DEFAULT_THRESHOLD = 0.3;

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
  style:   STYLES.BLUR,
  target:  TARGETS.PEOPLE,
  drag:    null,       // active drag/resize op: { type, x0, y0, id?, handle?, orig?, boxRef? }
  fileExt: null,
  radius:  0,          // global corner radius for redaction boxes (natural-pixel units)
};

let worker       = null;
let pendingBlob  = null;   // blob URL waiting to be revoked after detection
let canvas, ctx, displayScale;

// Cached DOM elements
const ui = {};

// ── Init ───────────────────────────────────────────────────────────────────────

export function initRedactor() {
  // Cache DOM elements
  ui.canvas = document.getElementById('rd-canvas');
  ui.dropzoneWrap = document.getElementById('rd-dropzone-wrap');
  ui.dropzone = document.getElementById('rd-dropzone');
  ui.fileInput = document.getElementById('rd-file-input');
  ui.loadDifferent = document.getElementById('rd-load-different');
  ui.loadedBar = document.getElementById('rd-loaded-bar');
  ui.fileName = document.getElementById('rd-file-name');
  ui.canvasWrap = document.getElementById('rd-canvas-wrap');
  ui.bottomCard = document.getElementById('rd-bottom-card');
  ui.videoNote = document.getElementById('rd-video-note');
  ui.styleChips = document.getElementById('rd-style-chips');
  ui.targetChips = document.getElementById('rd-target-chips');
  ui.detectBtn = document.getElementById('rd-detect-btn');
  ui.clearBtn = document.getElementById('rd-clear-btn');
  ui.exportBtn = document.getElementById('rd-export-btn');
  ui.detectStatus  = document.getElementById('rd-detect-status');
  ui.exportStatus  = document.getElementById('rd-export-status');
  ui.radiusSlider  = document.getElementById('rd-radius');
  ui.radiusVal     = document.getElementById('rd-radius-val');

  canvas = ui.canvas;
  ctx    = canvas.getContext('2d', { willReadFrequently: true });
  displayScale = 1;

  setupDropzone(
    ui.dropzone,
    f => f.type.startsWith('image/') || f.type.startsWith('video/'),
    loadFile
  );
  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') ui.fileInput.click(); });
  ui.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });
  ui.loadDifferent.addEventListener('click', resetToDropzone);

  ui.styleChips.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-style]');
    if (!chip) return;
    S.style = chip.dataset.style;
    setActiveChip(ui.styleChips, chip);
    redraw();
  });

  ui.radiusSlider.addEventListener('input', () => {
    S.radius = Number(ui.radiusSlider.value);
    ui.radiusVal.textContent = S.radius + '%';
    redraw();
  });

  ui.targetChips.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-target]');
    if (!chip) return;
    S.target = chip.dataset.target;
    setActiveChip(ui.targetChips, chip);
  });

  ui.detectBtn.addEventListener('click', startDetection);
  ui.clearBtn.addEventListener('click', clearBoxes);
  ui.exportBtn.addEventListener('click', exportResult);

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
    if (e.key === 'Escape' && S.drag?.type === 'drawing') {
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
  S.fileExt = file.name.split('.').pop();
  S.boxes   = [];
  S.selId   = null;
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
      try {
        S.bitmap = await createImageBitmap(v);
        S.natW   = v.videoWidth;
        S.natH   = v.videoHeight;
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        // Clean up: remove video element and clear src to release resources
        v.src = '';
        v.remove();
      }
    });
    v.addEventListener('error', e => {
      v.src = '';
      v.remove();
      reject(e);
    });
    v.load();
  });
}

function resetToDropzone() {
  S.file = S.bitmap = null;
  S.boxes = []; S.selId = null;
  S.drag = null;
  ui.dropzoneWrap.style.display = '';
  ui.loadedBar.style.display = 'none';
  ui.canvasWrap.style.display = 'none';
  ui.bottomCard.style.display = 'none';
  ui.fileInput.value = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus('');
  setExportStatus('');
}

function showLoaded(name) {
  ui.dropzoneWrap.style.display = 'none';
  ui.loadedBar.style.display = '';
  ui.fileName.textContent = name;
  ui.canvasWrap.style.display = 'block';
  ui.bottomCard.style.display = 'block';
  ui.detectBtn.disabled = false;
  ui.videoNote.style.display = S.isVideo ? '' : 'none';
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

/** Build a rounded-rectangle path on ctx (does not stroke/fill). */
function roundedRectPath(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y,     x + w, y + h, r);
  c.arcTo(x + w, y + h, x,     y + h, r);
  c.arcTo(x,     y + h, x,     y,     r);
  c.arcTo(x,     y,     x + w, y,     r);
  c.closePath();
}

function redraw() {
  if (!S.bitmap) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(S.bitmap, 0, 0);

  // Apply live redaction effects under the overlay
  for (const box of S.boxes) applyRedaction(ctx, box, S.radius);

  // Set font once, then draw selection overlays on top
  const fs = Math.max(11, Math.round(13 * displayScale));
  ctx.font = `500 ${fs}px system-ui, sans-serif`;

  for (const box of S.boxes) drawBox(box, box.id === S.selId, fs);
}

function drawBox(box, sel, fs) {
  const lw = Math.max(1.5, displayScale * 1.5);
  const r  = (S.radius / 100) * Math.min(box.w, box.h) / 2;
  ctx.save();

  // Outline only — no fill; the live preview already fills the region
  ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth   = lw;
  ctx.setLineDash(sel ? [] : [Math.round(6 * displayScale), Math.round(4 * displayScale)]);
  roundedRectPath(ctx, box.x, box.y, box.w, box.h, r);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label badge
  const label = (box.label || 'region') + (box.score ? ` ${Math.round(box.score * 100)}%` : '');
  const tw    = ctx.measureText(label).width + 8 * displayScale;
  const bh    = fs + 6 * displayScale;
  const badgeY = Math.max(0, box.y - bh);
  ctx.fillStyle = sel ? 'rgba(255,255,255,0.95)' : 'rgba(80,80,80,0.85)';
  ctx.fillRect(box.x, badgeY, tw, bh);
  ctx.fillStyle = sel ? '#111' : '#eee';
  ctx.fillText(label, box.x + 4 * displayScale, badgeY + bh - 4 * displayScale);

  // Corner handles when selected
  if (sel) drawHandles(box);
  ctx.restore();
}

function drawHandles(box) {
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
  if (S.drag?.type === 'drawing') {
    canvas.style.cursor = 'crosshair';
    return;
  }

  // Check selected box handles
  if (S.selId !== null && S.drag?.boxRef) {
    const handle = hitHandle(pos, S.drag.boxRef);
    if (handle) {
      canvas.style.cursor = cursorFor(handle);
      return;
    }
  }

  // Check any box (reverse order for topmost)
  for (let i = S.boxes.length - 1; i >= 0; i--) {
    if (hitBox(pos, S.boxes[i])) {
      canvas.style.cursor = 'move';
      return;
    }
  }

  canvas.style.cursor = 'crosshair'; // default: drawing is always available
}

// ── Mouse interaction ──────────────────────────────────────────────────────────

function onDown(e) {
  if (!S.bitmap) return;
  const pos = canvasPos(e);

  if (S.drag?.type === 'drawing') {
    S.drag = { type: 'drawing', x0: pos.x, y0: pos.y };
    return;
  }

  // Resize handle of selected box
  if (S.selId !== null) {
    const sel = S.boxes.find(b => b.id === S.selId);
    const handle = sel ? hitHandle(pos, sel) : null;
    if (handle) {
      S.drag = { type: 'resize', id: S.selId, handle, x0: pos.x, y0: pos.y, orig: { ...sel }, boxRef: sel };
      canvas.style.cursor = cursorFor(handle);
      return;
    }
  }

  // Move any box (reverse order so topmost wins)
  for (let i = S.boxes.length - 1; i >= 0; i--) {
    const box = S.boxes[i];
    if (hitBox(pos, box)) {
      S.selId = box.id;
      S.drag  = { type: 'move', id: box.id, x0: pos.x, y0: pos.y, orig: { ...box }, boxRef: box };
      canvas.style.cursor = 'move';
      redraw();
      return;
    }
  }

  // Nothing hit — deselect and start a new draw on drag
  S.selId = null;
  S.drag  = { type: 'drawing', x0: pos.x, y0: pos.y };
  redraw();
}

function onMove(e) {
  if (!S.bitmap) return;
  const pos = canvasPos(e);

  if (!S.drag) {
    updateCursor(pos);
    return;
  }

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

  const box = S.drag.boxRef;
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
    S.drag = null;
    canvas.style.cursor = 'crosshair';
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
  const handlers = {
    [MSG_TYPES.STATUS]: (d) => setStatus(d.text),
    [MSG_TYPES.DOWNLOAD]: (d) => setStatus(`Downloading model… ${d.total ? Math.round(d.loaded / d.total * 100) : 0}%`),
    [MSG_TYPES.READY]: () => runInference(),
    [MSG_TYPES.DETECTIONS]: (d) => applyDetections(d.boxes),
    [MSG_TYPES.ERROR]: (d) => {
      setStatus('Detection failed: ' + d.message);
      ui.detectBtn.disabled = false;
    },
  };

  (handlers[data.type] || (() => {}))(data);
}

function startDetection() {
  if (!S.bitmap) return;
  ui.detectBtn.disabled = true;
  setStatus('Loading model… (~30 MB on first run, then cached)');
  getWorker().postMessage({ type: MSG_TYPES.LOAD });
}

function runInference() {
  const off = createOffscreenCanvas(S.natW, S.natH);
  off.getContext('2d').drawImage(S.bitmap, 0, 0);
  off.toBlob(blob => {
    // Revoke old pending blob if any
    if (pendingBlob) URL.revokeObjectURL(pendingBlob);
    pendingBlob = URL.createObjectURL(blob);
    getWorker().postMessage({ type: MSG_TYPES.DETECT, imageUrl: pendingBlob, target: S.target, threshold: DEFAULT_THRESHOLD });
  }, 'image/jpeg', 0.85);
}

function applyDetections(rawBoxes) {
  if (pendingBlob) { URL.revokeObjectURL(pendingBlob); pendingBlob = null; }

  const manual   = S.boxes.filter(b => b.label === 'manual');
  const detected = rawBoxes.length > 0 ? rawBoxes.map(b => ({ ...b, id: S.nextId++ })) : [];
  S.boxes = [...manual, ...detected];
  S.selId = null;

  const n = detected.length;
  setStatus(n
    ? `Found ${n} region${n !== 1 ? 's' : ''}. Click to select and adjust, then export.`
    : 'No regions detected. Try a different target or add regions manually.'
  );
  ui.detectBtn.disabled = false;
  redraw();
}

function setStatus(text) {
  if (!ui.detectStatus) return;
  ui.detectStatus.textContent = text;
  ui.detectStatus.style.display = text ? '' : 'none';
}

function setExportStatus(text) {
  if (!ui.exportStatus) return;
  ui.exportStatus.textContent = text;
  ui.exportStatus.style.display = text ? '' : 'none';
}

// ── Export ─────────────────────────────────────────────────────────────────────

async function exportResult() {
  if (!S.file) return;
  if (S.boxes.length === 0) { setExportStatus('Add at least one redaction region first.'); return; }
  ui.exportBtn.disabled = true;
  setExportStatus('');
  try {
    if (S.isVideo) await exportVideo();
    else exportImage();
  } finally {
    ui.exportBtn.disabled = false;
  }
}

// Image: canvas-based redaction
function exportImage() {
  const off = createOffscreenCanvas(S.natW, S.natH);
  const c = off.getContext('2d');
  c.drawImage(S.bitmap, 0, 0);
  for (const box of S.boxes) applyRedaction(c, box, S.radius);
  off.toBlob(blob => {
    saveFile(blob, S.file.name.replace(/\.[^.]+$/, '') + '_redacted.png', 'image/png', null, { direct: true });
  }, 'image/png');
}

function createOffscreenCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function getClampedBounds(box) {
  const bx = Math.max(0, Math.round(box.x));
  const by = Math.max(0, Math.round(box.y));
  const bw = Math.min(Math.round(box.w), S.natW - bx);
  const bh = Math.min(Math.round(box.h), S.natH - by);
  return { bx, by, bw, bh };
}

function applyRedaction(c, box, radiusPct = 0) {
  const { bx, by, bw, bh } = getClampedBounds(box);
  if (bw <= 0 || bh <= 0) return;
  const r = (radiusPct / 100) * Math.min(bw, bh) / 2;

  const styles = {
    [STYLES.BLACK]:    () => applyBlack(c, bx, by, bw, bh, r),
    [STYLES.BLUR]:     () => applyBlur(c, bx, by, bw, bh, r),
    [STYLES.PIXELATE]: () => applyPixelate(c, bx, by, bw, bh, r),
  };

  (styles[S.style] || (() => {}))();
}

function applyBlack(c, bx, by, bw, bh, r = 0) {
  c.save();
  roundedRectPath(c, bx, by, bw, bh, r);
  c.clip();
  c.fillStyle = '#000';
  c.fillRect(bx, by, bw, bh);
  c.restore();
}

function applyBlur(c, bx, by, bw, bh, r = 0) {
  const sigma = Math.max(8, Math.round(Math.min(bw, bh) / 6));
  const pad   = sigma * 2;
  const ex    = Math.max(0, bx - pad);
  const ey    = Math.max(0, by - pad);
  const ew    = Math.min(S.natW, bx + bw + pad) - ex;
  const eh    = Math.min(S.natH, by + bh + pad) - ey;
  c.save();
  roundedRectPath(c, bx, by, bw, bh, r);
  c.clip();
  c.filter = `blur(${sigma}px)`;
  c.drawImage(S.bitmap, ex, ey, ew, eh, ex, ey, ew, eh);
  c.restore();
}

function applyPixelate(c, bx, by, bw, bh, r = 0) {
  const ps = Math.max(6, Math.round(Math.min(bw, bh) / 12));
  const tw = Math.max(1, Math.round(bw / ps));
  const th = Math.max(1, Math.round(bh / ps));
  const tmp = createOffscreenCanvas(tw, th);
  tmp.getContext('2d').drawImage(S.bitmap, bx, by, bw, bh, 0, 0, tw, th);
  c.save();
  roundedRectPath(c, bx, by, bw, bh, r);
  c.clip();
  c.imageSmoothingEnabled = false;
  c.drawImage(tmp, 0, 0, tw, th, bx, by, bw, bh);
  c.restore();
}

// Video: FFmpeg.wasm filter
async function exportVideo() {
  setExportStatus('Loading FFmpeg…');
  try {
    const ff    = await getFFmpeg();
    const inFile  = `rd_in.${S.fileExt}`;
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
      'video/mp4',
      null,
      { direct: true }
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
  if (style === STYLES.BLACK) {
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
    const fx = style === STYLES.BLUR
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
