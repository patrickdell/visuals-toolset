/**
 * utils.js — shared utilities used across all tool modules
 */

/**
 * Wire drag-and-drop on a dropzone element.
 * @param {HTMLElement} el       - the dropzone container
 * @param {Function}    filter   - (File) => boolean — true if the file is accepted
 * @param {Function}    handler  - (File) => void    — called with the accepted file
 */
export function setupDropzone(el, filter, handler) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const f = [...e.dataTransfer.files].find(filter);
    if (f) handler(f);
  });
}

/**
 * Multi-file variant — calls handler with an array of matching files.
 */
export function setupDropzoneMulti(el, filter, handler) {
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter(filter);
    if (files.length) handler(files);
  });
}

/**
 * Set exactly one chip active inside a container.
 * @param {HTMLElement} container
 * @param {HTMLElement} activeBtn
 */
export function setActiveChip(container, activeBtn) {
  container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  activeBtn.classList.add('active');
}

/**
 * Save a Blob as a file. Priority:
 *   1. dirHandle.getFileHandle (batch output folder, desktop)
 *   2. Web Share API (mobile)
 *   3. showSaveFilePicker
 *   4. <a download> fallback
 *
 * @param {Blob}                      blob
 * @param {string}                    name        - suggested filename
 * @param {string}                    mime        - MIME type string
 * @param {FileSystemDirectoryHandle} [dirHandle] - optional output folder
 */
export async function saveFile(blob, name, mime, dirHandle) {
  // 1. Output folder
  if (dirHandle) {
    try {
      const fh = await dirHandle.getFileHandle(name, { create: true });
      const w  = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch { /* fall through */ }
  }
  // 2. Mobile Web Share
  if (navigator.canShare?.({ files: [new File([blob], name, { type: mime })] })) {
    try {
      await navigator.share({ files: [new File([blob], name, { type: mime })] });
      return;
    } catch { /* fall through */ }
  }
  // 3. File System Access API
  if (window.showSaveFilePicker) {
    try {
      const ext = name.split('.').pop();
      const fh  = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: mime, accept: { [mime]: ['.' + ext] } }],
      });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch { /* fall through */ }
  }
  // 4. <a download> fallback
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Update a progress bar element and optional label.
 * @param {HTMLElement}      barEl
 * @param {HTMLElement|null} labelEl
 * @param {number}           pct   - 0–100
 * @param {string}           [text]
 */
export function setProgress(barEl, labelEl, pct, text) {
  barEl.style.width = Math.round(pct) + '%';
  if (labelEl && text !== undefined) labelEl.textContent = text;
}
