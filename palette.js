/**
 * palette.js — dominant colour palette extractor
 * Uses median-cut quantisation on canvas pixel data. No external deps.
 */

export function initPalette() {
  const dropzone  = document.getElementById('pal-dropzone');
  const fileInput = document.getElementById('pal-file-input');
  const preview   = document.getElementById('pal-preview');
  const swatches  = document.getElementById('pal-swatches');
  const copyAllBtn    = document.getElementById('pal-copy-all');
  const copyAllWrap   = document.getElementById('pal-copy-all-wrap');
  const canvas    = document.createElement('canvas');
  const ctx       = canvas.getContext('2d', { willReadFrequently: true });

  // ── Drop zone ─────────────────────────────────────────────────────────────
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadImage(fileInput.files[0]);
  });
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (f) loadImage(f);
  });

  // ── Load & analyse ────────────────────────────────────────────────────────
  async function loadImage(file) {
    const bmp = await createImageBitmap(file);
    // Downscale for analysis (fast, consistent)
    const MAX = 200;
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    canvas.width  = Math.round(bmp.width  * scale);
    canvas.height = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();

    // Show image preview
    const url = URL.createObjectURL(file);
    preview.style.backgroundImage = `url(${url})`;
    preview.style.display = '';

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette   = medianCut(imageData.data, 8);
    renderSwatches(palette);
    copyAllWrap.style.display = '';
  }

  // ── Median-cut quantisation ───────────────────────────────────────────────
  function medianCut(data, numColors) {
    // Collect pixels (skip transparent)
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip transparent
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    if (!pixels.length) return [];

    // Recursive split
    function split(bucket, depth) {
      if (depth === 0 || bucket.length < 2) return [averageColor(bucket)];
      // Find channel with greatest range
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (const [r, g, b] of bucket) {
        if (r < rMin) rMin = r; if (r > rMax) rMax = r;
        if (g < gMin) gMin = g; if (g > gMax) gMax = g;
        if (b < bMin) bMin = b; if (b > bMax) bMax = b;
      }
      const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
      const maxRange = Math.max(rRange, gRange, bRange);
      const ch = maxRange === rRange ? 0 : maxRange === gRange ? 1 : 2;
      bucket.sort((a, b) => a[ch] - b[ch]);
      const mid = Math.floor(bucket.length / 2);
      return [
        ...split(bucket.slice(0, mid), depth - 1),
        ...split(bucket.slice(mid),     depth - 1),
      ];
    }

    const depth = Math.ceil(Math.log2(numColors));
    return split(pixels, depth).slice(0, numColors);
  }

  function averageColor(pixels) {
    if (!pixels.length) return [0, 0, 0];
    let r = 0, g = 0, b = 0;
    for (const [pr, pg, pb] of pixels) { r += pr; g += pg; b += pb; }
    return [
      Math.round(r / pixels.length),
      Math.round(g / pixels.length),
      Math.round(b / pixels.length),
    ];
  }

  // ── Render swatches ───────────────────────────────────────────────────────
  function renderSwatches(palette) {
    swatches.innerHTML = '';
    swatches.style.display = '';

    palette.forEach(([r, g, b]) => {
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const textColor = lum > 0.55 ? '#111' : '#fff';
      const hsl = rgbToHsl(r, g, b);

      const swatch = document.createElement('div');
      swatch.className = 'pal-swatch';
      swatch.style.background = hex;
      swatch.innerHTML = `
        <span class="pal-hex" style="color:${textColor}">${hex}</span>
        <span class="pal-rgb" style="color:${textColor}">rgb(${r}, ${g}, ${b})</span>
        <span class="pal-hsl" style="color:${textColor}">${hsl}</span>
        <span class="pal-copy-badge" style="color:${textColor}">click to copy</span>`;
      swatch.addEventListener('click', () => copyHex(hex, swatch));
      swatches.appendChild(swatch);
    });
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        default: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }

  function copyHex(hex, swatchEl) {
    navigator.clipboard?.writeText(hex).catch(() => {});
    const badge = swatchEl.querySelector('.pal-copy-badge');
    const orig  = badge.textContent;
    badge.textContent = 'copied!';
    setTimeout(() => { badge.textContent = orig; }, 1500);
  }

  // ── Copy all as CSS variables ─────────────────────────────────────────────
  copyAllBtn.addEventListener('click', () => {
    const hexes = [...swatches.querySelectorAll('.pal-hex')].map(el => el.textContent);
    const css   = hexes.map((h, i) => `  --color-${i + 1}: ${h};`).join('\n');
    const text  = `:root {\n${css}\n}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    copyAllBtn.textContent = 'Copied!';
    setTimeout(() => { copyAllBtn.textContent = 'Copy all as CSS variables'; }, 2000);
  });
}
