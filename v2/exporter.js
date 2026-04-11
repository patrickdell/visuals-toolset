/**
 * exporter.js — resolution picker and PNG/JPEG export
 */

export function initExporter({ getCropState }) {
  const exportPngBtn  = document.getElementById('exportPng');
  const exportJpgBtn  = document.getElementById('exportJpg');
  const resRadios     = document.querySelectorAll('input[name="resolution"]');
  const customResInput = document.getElementById('customRes');

  function getTargetLongEdge() {
    let val = null;
    resRadios.forEach(r => { if (r.checked) val = r.value; });
    if (val === 'custom') {
      val = Number(customResInput.value);
      return (val > 0) ? val : null;
    }
    return Number(val);
  }

  function doExport(format) {
    const { bitmap, naturalW, naturalH, crop } = getCropState();
    if (!bitmap || !crop.w || !crop.h) return;

    const longEdge = getTargetLongEdge();
    if (!longEdge) { alert('Enter a custom resolution first.'); return; }

    const cropAR = crop.w / crop.h;
    let outW, outH;
    if (crop.w >= crop.h) {
      outW = longEdge;
      outH = Math.round(longEdge / cropAR);
    } else {
      outH = longEdge;
      outW = Math.round(longEdge * cropAR);
    }

    const offscreen = document.createElement('canvas');
    offscreen.width  = outW;
    offscreen.height = outH;
    const ctx = offscreen.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // For JPEG, composite over white to handle any transparency
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
    }

    ctx.drawImage(
      bitmap,
      crop.x, crop.y, crop.w, crop.h,
      0,      0,      outW,   outH
    );

    const ext = format === 'image/jpeg' ? 'jpg' : 'png';
    const quality = format === 'image/jpeg' ? 0.92 : undefined;

    offscreen.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'crop_' + outW + 'x' + outH + '.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, format, quality);
  }

  exportPngBtn.addEventListener('click', () => doExport('image/png'));
  exportJpgBtn.addEventListener('click', () => doExport('image/jpeg'));

  // Show/hide custom input
  resRadios.forEach(r => {
    r.addEventListener('change', () => {
      customResInput.parentElement.style.display =
        r.value === 'custom' && r.checked ? 'flex' : 'none';
    });
  });
  // Initially hide custom input (it's hidden via CSS default)

  function setEnabled(enabled) {
    exportPngBtn.disabled = !enabled;
    exportJpgBtn.disabled = !enabled;
  }

  return { setEnabled };
}
