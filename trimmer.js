/**
 * trimmer.js — browser-side video trimmer via FFmpeg.wasm stream copy
 * Uses shared FFmpeg singleton. Stream copy = no re-encode = near-instant.
 */

import { getFFmpeg, resetFFmpeg } from './ffmpeg-shared.js';

// Containers we can stream-copy back into (match input ext where possible)
const SUPPORTED_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'm4v']);
const UNSUPPORTED_EXTS = new Set(['mxf', 'mts', 'm2ts', 'prores', 'dnxhd']);

export function initTrimmer() {
  const dropzone    = document.getElementById('trm-dropzone');
  const fileInput   = document.getElementById('trm-file-input');
  const playerWrap  = document.getElementById('trm-player-wrap');
  const video       = document.getElementById('trm-video');
  const formatWarn  = document.getElementById('trm-format-warn');
  const sizeWarn    = document.getElementById('trm-size-warn');
  const rangeIn     = document.getElementById('trm-range-in');
  const rangeOut    = document.getElementById('trm-range-out');
  const inLabel     = document.getElementById('trm-in-label');
  const outLabel    = document.getElementById('trm-out-label');
  const clipLabel   = document.getElementById('trm-clip-label');
  const setInBtn    = document.getElementById('trm-set-in');
  const setOutBtn   = document.getElementById('trm-set-out');
  const trimBtn     = document.getElementById('trm-trim-btn');
  const progressWrap = document.getElementById('trm-progress-wrap');
  const progressBar  = document.getElementById('trm-progress-bar');
  const progressLabel = document.getElementById('trm-progress-label');

  let currentFile  = null;
  let videoBlobUrl = null;
  let inPoint  = 0;
  let outPoint = 0;
  let duration = 0;

  // ── Drop zone ─────────────────────────────────────────────────────────────
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('video/'));
    if (f) loadFile(f);
  });

  // ── Load file ─────────────────────────────────────────────────────────────
  function loadFile(file) {
    currentFile = file;
    if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
    videoBlobUrl = URL.createObjectURL(file);

    // Format check
    const ext = file.name.split('.').pop().toLowerCase();
    formatWarn.style.display = UNSUPPORTED_EXTS.has(ext) ? '' : 'none';

    // Size warning
    const mb = file.size / 1048576;
    sizeWarn.style.display = mb > 300 ? '' : 'none';
    sizeWarn.textContent = mb > 800
      ? `⚠ Large file (${mb.toFixed0()} MB) — may fail on this device due to memory limits`
      : `⚠ Large file (${mb.toFixed(0)} MB) — processing may be slow`;

    video.src = videoBlobUrl;
    video.load();

    video.addEventListener('loadedmetadata', () => {
      duration = video.duration;
      inPoint  = 0;
      outPoint = duration;

      // Configure range inputs
      [rangeIn, rangeOut].forEach(r => {
        r.min  = '0';
        r.max  = String(duration);
        r.step = '0.1';
      });
      rangeIn.value  = '0';
      rangeOut.value = String(duration);

      updateLabels();
      playerWrap.style.display = '';
      dropzone.querySelector('.trm-drop-text').textContent = file.name;
      dropzone.classList.add('has-file');
      trimBtn.disabled = false;
      progressWrap.style.display = 'none';
    }, { once: true });

    // Warm up the shared FFmpeg instance in the background
    getFFmpeg().catch(() => {});
  }

  // ── Timeline scrubber ─────────────────────────────────────────────────────
  rangeIn.addEventListener('input', () => {
    inPoint = Math.min(Number(rangeIn.value), outPoint - 0.1);
    rangeIn.value = String(inPoint);
    video.currentTime = inPoint;
    updateLabels();
  });

  rangeOut.addEventListener('input', () => {
    outPoint = Math.max(Number(rangeOut.value), inPoint + 0.1);
    rangeOut.value = String(outPoint);
    video.currentTime = outPoint;
    updateLabels();
  });

  setInBtn.addEventListener('click', () => {
    inPoint = Math.min(video.currentTime, outPoint - 0.1);
    rangeIn.value = String(inPoint);
    updateLabels();
  });

  setOutBtn.addEventListener('click', () => {
    outPoint = Math.max(video.currentTime, inPoint + 0.1);
    rangeOut.value = String(outPoint);
    updateLabels();
  });

  function updateLabels() {
    inLabel.textContent  = 'In: '  + fmt(inPoint);
    outLabel.textContent = 'Out: ' + fmt(outPoint);
    clipLabel.textContent = 'Clip: ' + fmt(outPoint - inPoint);

    // Visual track highlight
    const pctIn  = (inPoint  / duration) * 100;
    const pctOut = (outPoint / duration) * 100;
    const track = document.getElementById('trm-track-fill');
    if (track) {
      track.style.left  = pctIn  + '%';
      track.style.width = (pctOut - pctIn) + '%';
    }
  }

  // ── Trim ──────────────────────────────────────────────────────────────────
  trimBtn.addEventListener('click', runTrim);

  async function runTrim() {
    if (!currentFile) return;
    trimBtn.disabled = true;
    progressWrap.style.display = '';
    setProgress(5, 'Loading encoder…');

    const ext     = currentFile.name.split('.').pop().toLowerCase();
    const outExt  = SUPPORTED_EXTS.has(ext) ? ext : 'mp4';
    const outName = currentFile.name.replace(/\.[^.]+$/, '') + '_trimmed.' + outExt;

    // Input filename — always use .mp4 alias for FFmpeg (it handles by content, not name)
    const inName  = 'input.' + (SUPPORTED_EXTS.has(ext) ? ext : 'mp4');
    const outFile = 'output.' + outExt;

    try {
      setProgress(10, 'Reading file… (large files may take a moment)');
      const { ff, fetchFile } = await getFFmpeg(({ progress }) => {
        const pct = Math.min(Math.max(progress, 0), 1);
        setProgress(10 + Math.round(pct * 85), 'Trimming… ' + Math.round(pct * 100) + '%');
      });

      await ff.writeFile(inName, await fetchFile(currentFile));

      setProgress(15, 'Trimming…');
      const ret = await ff.exec([
        '-y',
        '-ss', String(inPoint),
        '-to', String(outPoint),
        '-i', inName,
        '-c', 'copy',          // stream copy — no re-encode
        outFile,
      ]);

      if (ret !== 0) throw new Error('FFmpeg exited with code ' + ret);

      const data = await ff.readFile(outFile);
      if (!data || data.length === 0) throw new Error('Output is empty');

      const blob = new Blob([data], { type: 'video/' + outExt });

      // Clean up WASM FS
      try { await ff.deleteFile(inName);  } catch (_) {}
      try { await ff.deleteFile(outFile); } catch (_) {}

      setProgress(100, 'Done — ' + (blob.size / 1048576).toFixed(1) + ' MB');

      await saveFile(blob, outName);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 2500);

    } catch (err) {
      setProgress(0, 'Error: ' + (err.message || err));
      resetFFmpeg();
      console.error('[trimmer]', err);
      setTimeout(() => { progressWrap.style.display = 'none'; }, 4000);
    } finally {
      trimBtn.disabled = false;
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function saveFile(blob, name) {
    if ('showSaveFilePicker' in window) {
      try {
        const ext = name.split('.').pop();
        const fh = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Video file', accept: { ['video/' + ext]: ['.' + ext] } }],
        });
        const w = await fh.createWritable();
        await w.write(blob); await w.close();
        return;
      } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    }
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setProgress(pct, label) {
    progressBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    progressLabel.textContent = label;
  }

  function fmt(s) {
    s = Math.max(0, s);
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(1);
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(5, '0')
      : m + ':' + String(sec).padStart(4, '0');
  }
}
