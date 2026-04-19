/**
 * ocr.js — local OCR using Tesseract.js (loaded via CDN script tag)
 */
import { setupDropzone, saveFile } from './utils.js';

const LANGUAGES = [
  { label: 'English',    id: 'eng' },
  { label: 'French',     id: 'fra' },
  { label: 'German',     id: 'deu' },
  { label: 'Spanish',    id: 'spa' },
  { label: 'Portuguese', id: 'por' },
  { label: 'Chinese',    id: 'chi_sim' },
  { label: 'Arabic',     id: 'ara' },
];

export function initOcr() {
  const dropzone    = document.getElementById('ocr-dropzone');
  const fileInput   = document.getElementById('ocr-file-input');
  const dropText    = document.getElementById('ocr-drop-text');
  const langChipsEl = document.getElementById('ocr-lang-chips');
  const ocrBtn      = document.getElementById('ocr-btn');
  const progressWrap  = document.getElementById('ocr-progress-wrap');
  const progressBar   = document.getElementById('ocr-progress-bar');
  const progressLabel = document.getElementById('ocr-progress-label');
  const output      = document.getElementById('ocr-output');
  const resultEl    = document.getElementById('ocr-result');
  const copyBtn     = document.getElementById('ocr-copy');
  const downloadBtn = document.getElementById('ocr-download');
  const preview     = document.getElementById('ocr-preview');

  let imageFile = null;
  let selectedLang = 'eng';

  // ── Language chips ─────────────────────────────────────────────────────────
  LANGUAGES.forEach((lang, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (i === 0 ? ' active' : '');
    btn.textContent = lang.label;
    btn.addEventListener('click', () => {
      langChipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      selectedLang = lang.id;
    });
    langChipsEl.appendChild(btn);
  });

  // ── File drop / pick ───────────────────────────────────────────────────────
  setupDropzone(dropzone, f => f.type.startsWith('image/'), loadFile);
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  function loadFile(file) {
    imageFile = file;
    dropText.textContent = file.name;
    dropzone.classList.add('has-file');
    ocrBtn.disabled = false;
    output.style.display = 'none';
    resultEl.value = '';

    // Show image preview
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.style.display = '';
    preview.onload = () => URL.revokeObjectURL(url);
  }

  // ── OCR ────────────────────────────────────────────────────────────────────
  ocrBtn.addEventListener('click', () => {
    if (!imageFile || typeof Tesseract === 'undefined') {
      if (typeof Tesseract === 'undefined') alert('Tesseract.js failed to load. Check your connection and reload.');
      return;
    }
    runOcr();
  });

  async function runOcr() {
    ocrBtn.disabled = true;
    output.style.display = 'none';
    progressWrap.style.display = '';
    progressBar.style.width    = '0%';
    progressLabel.textContent  = 'Starting…';

    try {
      const result = await Tesseract.recognize(imageFile, selectedLang, {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round(m.progress * 100);
            progressBar.style.width   = pct + '%';
            progressLabel.textContent = 'Recognising… ' + pct + '%';
          } else if (m.status === 'loading tesseract core') {
            progressLabel.textContent = 'Loading OCR engine…';
          } else if (m.status === 'loading language traineddata') {
            progressLabel.textContent = 'Downloading language data…';
          } else if (m.status === 'initializing api') {
            progressLabel.textContent = 'Initialising…';
          }
        }
      });

      progressBar.style.width   = '100%';
      progressLabel.textContent = 'Done';
      setTimeout(() => { progressWrap.style.display = 'none'; }, 600);

      resultEl.value = result.data.text;
      output.style.display = '';
    } catch (e) {
      progressLabel.textContent = '⚠ ' + e.message;
      progressBar.style.width   = '0%';
    }

    ocrBtn.disabled = false;
  }

  // ── Copy / Download ────────────────────────────────────────────────────────
  copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(resultEl.value).catch(() => {});
    const orig = copyBtn.textContent;
    copyBtn.textContent = '✓ Copied';
    setTimeout(() => { copyBtn.textContent = orig; }, 2000);
  });

  downloadBtn.addEventListener('click', () => {
    const name = imageFile ? imageFile.name.replace(/\.[^.]+$/, '') + '.txt' : 'ocr.txt';
    saveFile(new Blob([resultEl.value], { type: 'text/plain' }), name, 'text/plain');
  });
}
