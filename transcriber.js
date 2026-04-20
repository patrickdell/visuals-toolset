/**
 * transcriber.js — local audio transcription using Whisper (via Web Worker)
 */
import { setupDropzone, saveFile } from './utils.js';

const MODELS = [
  { label: 'Tiny', id: 'tiny', hint: '39 MB — downloads once, then cached. Fast transcription, works well for clear speech.' },
  { label: 'Base', id: 'base', hint: '74 MB — downloads once, then cached. More accurate, handles accents and background noise better.' },
];

export function initTranscriber() {
  const dropzone      = document.getElementById('tr-dropzone');
  const fileInput     = document.getElementById('tr-file-input');
  const dropText      = document.getElementById('tr-drop-text');
  const modelChipsEl  = document.getElementById('tr-model-chips');
  const transcribeBtn = document.getElementById('tr-transcribe-btn');
  const progressWrap  = document.getElementById('tr-progress-wrap');
  const progressBar   = document.getElementById('tr-progress-bar');
  const progressLabel = document.getElementById('tr-progress-label');
  const output        = document.getElementById('tr-output');
  const segmentsEl    = document.getElementById('tr-segments');
  const exportSrt     = document.getElementById('tr-export-srt');
  const exportVtt     = document.getElementById('tr-export-vtt');
  const exportTxt     = document.getElementById('tr-export-txt');

  let audioFile    = null;
  let selectedModel = MODELS[0].id;
  let segments     = [];
  let worker       = null;

  // ── Model chips ────────────────────────────────────────────────────────────
  const modelHint = document.getElementById('tr-model-hint');

  function selectModel(m, btn) {
    modelChipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    selectedModel = m.id;
    if (modelHint) modelHint.textContent = m.hint;
  }

  MODELS.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (i === 0 ? ' active' : '');
    btn.textContent = m.label;
    btn.addEventListener('click', () => selectModel(m, btn));
    modelChipsEl.appendChild(btn);
    if (i === 0) { selectedModel = m.id; if (modelHint) modelHint.textContent = m.hint; }
  });

  // ── File drop / pick ───────────────────────────────────────────────────────
  setupDropzone(dropzone, f => f.type.startsWith('audio/') || f.type.startsWith('video/'), loadFile);
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  function loadFile(file) {
    audioFile = file;
    dropText.textContent = file.name;
    dropzone.classList.add('has-file');
    transcribeBtn.disabled = false;
    output.style.display = 'none';
    segmentsEl.innerHTML = '';
    segments = [];
  }

  // ── Transcribe ─────────────────────────────────────────────────────────────
  transcribeBtn.addEventListener('click', () => {
    if (!audioFile) return;
    runTranscription();
  });

  async function runTranscription() {
    transcribeBtn.disabled = true;
    output.style.display   = 'none';
    segmentsEl.innerHTML   = '';
    segments = [];
    progressWrap.style.display = '';
    progressBar.style.width    = '0%';
    progressLabel.textContent  = 'Decoding audio…';

    // Decode + resample to 16 kHz Float32Array
    let audioData;
    try {
      audioData = await decodeAudioTo16k(audioFile);
    } catch (e) {
      showError('Could not decode audio: ' + e.message);
      return;
    }

    progressLabel.textContent = 'Loading model…';
    progressBar.style.width   = '10%';

    // Spawn (or reuse) worker
    if (!worker) {
      worker = new Worker(new URL('./transcriber.worker.js', import.meta.url), { type: 'module' });
    }

    worker.onmessage = ({ data }) => {
      if (data.type === 'status') {
        progressLabel.textContent = data.text;
      }
      if (data.type === 'download') {
        const pct = data.total ? Math.round((data.loaded / data.total) * 40) + 10 : 10;
        progressBar.style.width  = pct + '%';
        const mb = data.total ? ' (' + Math.round(data.total / 1e6) + ' MB)' : '';
        progressLabel.textContent = 'Downloading model' + mb + '…';
      }
      if (data.type === 'ready') {
        progressBar.style.width   = '55%';
        progressLabel.textContent = 'Transcribing…';
        // Transfer audio data to worker (zero-copy)
        worker.postMessage({ type: 'transcribe', audio: audioData }, [audioData.buffer]);
      }
      if (data.type === 'chunk') {
        // Append streaming chunks to UI
        data.chunks.forEach(c => {
          if (!c.text.trim()) return;
          segments.push(c);
          renderSegment(c);
        });
        const pct = Math.min(95, 55 + segments.length);
        progressBar.style.width = pct + '%';
      }
      if (data.type === 'done') {
        // Final result — replace streaming segments with canonical output
        if (data.result.chunks) {
          segmentsEl.innerHTML = '';
          segments = data.result.chunks.filter(c => c.text.trim());
          segments.forEach(renderSegment);
        }
        progressBar.style.width   = '100%';
        progressLabel.textContent = 'Done';
        setTimeout(() => { progressWrap.style.display = 'none'; }, 800);
        output.style.display   = '';
        transcribeBtn.disabled = false;
      }
      if (data.type === 'error') {
        showError(data.message);
      }
    };

    worker.postMessage({ type: 'load', model: selectedModel });
  }

  function renderSegment(chunk) {
    const el = document.createElement('div');
    el.className = 'tr-segment';
    const ts = chunk.timestamp;
    const timeStr = ts ? formatTime(ts[0]) + ' – ' + formatTime(ts[1]) : '';
    el.innerHTML = `<span class="tr-ts">${timeStr}</span><span class="tr-text">${escHtml(chunk.text.trim())}</span>`;
    segmentsEl.appendChild(el);
    el.scrollIntoView({ block: 'nearest' });
  }

  function showError(msg) {
    progressLabel.textContent = '⚠ ' + msg;
    progressBar.style.width   = '0%';
    transcribeBtn.disabled    = false;
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  exportSrt.addEventListener('click', () => {
    const text = segments.map((c, i) => {
      const ts = c.timestamp || [0, 0];
      return `${i + 1}\n${srtTime(ts[0])} --> ${srtTime(ts[1])}\n${c.text.trim()}\n`;
    }).join('\n');
    saveFile(new Blob([text], { type: 'text/plain' }), baseName() + '.srt', 'text/plain');
  });

  exportVtt.addEventListener('click', () => {
    const lines = segments.map(c => {
      const ts = c.timestamp || [0, 0];
      return `${vttTime(ts[0])} --> ${vttTime(ts[1])}\n${c.text.trim()}`;
    });
    saveFile(new Blob(['WEBVTT\n\n' + lines.join('\n\n')], { type: 'text/vtt' }), baseName() + '.vtt', 'text/vtt');
  });

  exportTxt.addEventListener('click', () => {
    const text = segments.map(c => c.text.trim()).join('\n');
    saveFile(new Blob([text], { type: 'text/plain' }), baseName() + '.txt', 'text/plain');
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function decodeAudioTo16k(file) {
    const arrayBuffer = await file.arrayBuffer();
    const tmpCtx  = new AudioContext();
    const decoded = await tmpCtx.decodeAudioData(arrayBuffer);
    await tmpCtx.close();

    const targetRate = 16000;
    const offCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
    const src = offCtx.createBufferSource();
    src.buffer = decoded;
    src.connect(offCtx.destination);
    src.start(0);
    const resampled = await offCtx.startRendering();
    return resampled.getChannelData(0); // Float32Array at 16 kHz
  }

  function formatTime(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function srtTime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(3).replace('.', ',');
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec}`;
  }
  function vttTime(s) {
    return srtTime(s).replace(',', '.');
  }
  function baseName() {
    return audioFile ? audioFile.name.replace(/\.[^.]+$/, '') : 'transcript';
  }
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
