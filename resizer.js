/**
 * resizer.js — batch image resizer / optimizer
 * Canvas-based: no FFmpeg, no external deps.
 */

const SCALE_PRESETS = [
  { label: 'Instagram (1080px)', value: 1080 },
  { label: 'X / Twitter (1200px)', value: 1200 },
  { label: 'LinkedIn (1200px)',  value: 1200 },
  { label: 'Email (600px)',      value: 600  },
  { label: 'Web (800px)',        value: 800  },
  { label: 'Original size',     value: null },
];

const FORMAT_MAP = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png:  { mime: 'image/png',  ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

export function initResizer() {
  const dropzone    = document.getElementById('rsz-dropzone');
  const fileInput   = document.getElementById('rsz-file-input');
  const queueEl     = document.getElementById('rsz-queue');
  const scaleChips  = document.getElementById('rsz-scale-chips');
  const customWrap  = document.getElementById('rsz-custom-wrap');
  const customInput = document.getElementById('rsz-custom-px');
  const fmtChips    = document.getElementById('rsz-format-chips');
  const qualityWrap = document.getElementById('rsz-quality-wrap');
  const qualityInput = document.getElementById('rsz-quality');
  const qualityLabel = document.getElementById('rsz-quality-label');
  const pickFolderBtn = document.getElementById('rsz-pick-folder');
  const folderLabel   = document.getElementById('rsz-folder-label');
  const resizeBtn     = document.getElementById('rsz-resize-btn');

  // ── State ─────────────────────────────────────────────────────────────────
  let queue           = [];     // [{ file, status, statusText }]
  let selectedScale   = SCALE_PRESETS[0].value; // 1080 default
  let selectedFormat  = 'jpeg';
  let quality         = 0.85;
  let outputDirHandle = null;
  let running         = false;
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');

  // ── Scale chips ───────────────────────────────────────────────────────────
  SCALE_PRESETS.forEach(({ label, value }, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (i === 0 ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      customWrap.style.display = 'none';
      setChip(scaleChips, btn);
      selectedScale = value;
    });
    scaleChips.appendChild(btn);
  });
  const customScaleChip = document.createElement('button');
  customScaleChip.type = 'button';
  customScaleChip.className = 'chip';
  customScaleChip.textContent = 'Custom…';
  customScaleChip.addEventListener('click', () => {
    setChip(scaleChips, customScaleChip);
    customWrap.style.display = 'flex';
    customInput.focus();
  });
  scaleChips.appendChild(customScaleChip);
  customInput.addEventListener('input', () => {
    const v = Number(customInput.value);
    if (v >= 10) selectedScale = v;
  });

  // ── Format chips ──────────────────────────────────────────────────────────
  [['JPEG', 'jpeg'], ['PNG', 'png'], ['WebP', 'webp']].forEach(([label, key], i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (i === 0 ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      setChip(fmtChips, btn);
      selectedFormat = key;
      qualityWrap.style.display = key === 'png' ? 'none' : '';
    });
    fmtChips.appendChild(btn);
  });

  // ── Quality slider ────────────────────────────────────────────────────────
  qualityInput.addEventListener('input', () => {
    quality = Number(qualityInput.value) / 100;
    qualityLabel.textContent = qualityInput.value + '%';
  });

  // ── Drop zone ─────────────────────────────────────────────────────────────
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => addFiles([...fileInput.files]));
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) addFiles(files);
  });

  // ── Queue ─────────────────────────────────────────────────────────────────
  function addFiles(files) {
    files.forEach(f => queue.push({ file: f, status: 'waiting', statusText: 'Waiting' }));
    renderQueue();
    resizeBtn.disabled = false;
    dropzone.querySelector('.rsz-drop-text').textContent =
      queue.length === 1 ? queue[0].file.name : queue.length + ' images queued';
    dropzone.classList.add('has-file');
  }

  function renderQueue() {
    if (!queue.length) { queueEl.style.display = 'none'; return; }
    queueEl.style.display = '';
    queueEl.innerHTML = queue.map((item, i) => {
      const sizeMB = (item.file.size / 1048576).toFixed(1);
      const rm = item.status === 'waiting'
        ? `<button class="cmp-q-remove" data-i="${i}" title="Remove">×</button>` : '';
      return `<div class="cmp-queue-item cmp-queue-item--${item.status}">
        <span class="cmp-q-name">${esc(item.file.name)}</span>
        <span class="cmp-q-size">${sizeMB} MB</span>
        <span class="cmp-q-status">${item.statusText}</span>
        ${rm}
      </div>`;
    }).join('');
    queueEl.querySelectorAll('.cmp-q-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        queue.splice(Number(btn.dataset.i), 1);
        if (!queue.length) { resizeBtn.disabled = true; dropzone.classList.remove('has-file'); dropzone.querySelector('.rsz-drop-text').textContent = 'Drop images here, or click to browse'; }
        renderQueue();
      });
    });
  }

  // ── Output folder ─────────────────────────────────────────────────────────
  pickFolderBtn.addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) { alert('Folder picking not supported — files will download individually.'); return; }
    try {
      outputDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      folderLabel.textContent = 'Output: ' + outputDirHandle.name + '/';
      folderLabel.style.display = '';
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
  });

  // ── Resize all ────────────────────────────────────────────────────────────
  resizeBtn.addEventListener('click', async () => {
    if (running) return;
    running = true;
    resizeBtn.disabled = true;

    const { mime, ext } = FORMAT_MAP[selectedFormat];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.status === 'done') continue;
      item.status = 'encoding';
      item.statusText = 'Resizing…';
      renderQueue();

      try {
        const bmp   = await createImageBitmap(item.file);
        let   w = bmp.width, h = bmp.height;

        if (selectedScale) {
          // Scale longest side to selectedScale, never upscale
          const longest = Math.max(w, h);
          if (longest > selectedScale) {
            const ratio = selectedScale / longest;
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
        }

        canvas.width  = w;
        canvas.height = h;
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close();

        const blob = await new Promise(res =>
          canvas.toBlob(res, mime, selectedFormat === 'png' ? undefined : quality)
        );
        if (!blob) throw new Error('Canvas toBlob failed');

        const baseName = item.file.name.replace(/\.[^.]+$/, '') + '_resized.' + ext;
        await saveFile(blob, baseName);

        item.status = 'done';
        item.statusText = '✓ Done — ' + (blob.size / 1048576).toFixed(1) + ' MB';
      } catch (err) {
        item.status = 'error';
        item.statusText = 'Error: ' + (err.message || err);
        console.error('[resizer]', err);
      }
      renderQueue();
    }

    running = false;
    resizeBtn.disabled = queue.every(q => q.status === 'done');
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function saveFile(blob, name) {
    if (outputDirHandle) {
      try {
        const fh = await outputDirHandle.getFileHandle(name, { create: true });
        const w  = await fh.createWritable();
        await w.write(blob); await w.close(); return;
      } catch (e) { console.warn('Dir write failed:', e); }
    }
    if ('showSaveFilePicker' in window) {
      try {
        const fh = await window.showSaveFilePicker({ suggestedName: name });
        const w  = await fh.createWritable();
        await w.write(blob); await w.close(); return;
      } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    }
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function setChip(container, active) {
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    active.classList.add('active');
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
