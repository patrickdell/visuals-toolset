/**
 * c2pa-reader.js — C2PA / Content Credentials manifest reader
 * Uses @contentauth/c2pa from jsDelivr CDN, lazy-loaded on first use.
 */

const C2PA_VERSION = '0.18.2';
const CDN = `https://cdn.jsdelivr.net/npm/@contentauth/c2pa@${C2PA_VERSION}/dist`;

let c2paPromise = null;

async function getC2pa() {
  if (c2paPromise) return c2paPromise;
  c2paPromise = (async () => {
    // Fetch worker as Blob URL to avoid cross-origin Worker restrictions
    const workerResp = await fetch(`${CDN}/c2pa.worker.min.js`);
    const workerBlob = await workerResp.blob();
    const workerSrc  = URL.createObjectURL(workerBlob);

    const { createC2pa } = await import(`${CDN}/c2pa.esm.min.js`);
    return createC2pa({
      wasmSrc: `${CDN}/assets/wasm/toolkit_bg.wasm`,
      workerSrc,
    });
  })();
  return c2paPromise;
}

// ── Label maps ────────────────────────────────────────────────────────────────

const ASSERTION_LABELS = {
  'c2pa.actions':              'Actions',
  'c2pa.hash.data':            'Data Hash',
  'c2pa.ingredient':           'Ingredient',
  'stds.exif':                 'EXIF Metadata',
  'c2pa.created':              'Created',
  'c2pa.thumbnail.claim.jpeg': 'Thumbnail',
  'c2pa.thumbnail.claim.png':  'Thumbnail',
  'c2pa.training-mining':      'AI Training / Mining',
};

const ACTION_LABELS = {
  'c2pa.created':               'File created',
  'c2pa.edited':                'File edited',
  'c2pa.cropped':               'Cropped',
  'c2pa.filtered':              'Filtered',
  'c2pa.color_adjustments':     'Colour adjusted',
  'c2pa.ai_generative_trained': 'AI generative (trained)',
  'c2pa.placed':                'Content placed',
  'c2pa.repackaged':            'Repackaged',
  'c2pa.transcoded':            'Transcoded',
  'c2pa.published':             'Published',
  'c2pa.drawing':               'Drawing',
  'c2pa.unknown':               'Unknown action',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatExifKey(key) {
  return key.replace(/^[^:]+:/, '').replace(/([A-Z])/g, ' $1').trim();
}

function sectionEl(label, content) {
  return `<div class="card sidebar-section c2pa-section">
    <p class="chips-label">${escapeHtml(label)}</p>
    ${content}
  </div>`;
}

function rowEl(key, value) {
  return `<div class="c2pa-assertion-row">
    <span class="c2pa-key">${escapeHtml(key)}</span>
    <span class="c2pa-val">${value}</span>
  </div>`;
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderAssertions(assertions) {
  if (!assertions) return '';
  let out = '';
  for (const [label, assertion] of assertions.entries()) {
    // Skip binary / hash / thumbnail assertions — not useful as text
    if (label.startsWith('c2pa.hash') || label.startsWith('c2pa.thumbnail')) continue;

    const friendly = ASSERTION_LABELS[label] ?? label;

    if (label === 'c2pa.actions' && assertion.data?.actions) {
      const items = assertion.data.actions.map(a => {
        const name = ACTION_LABELS[a.action] ?? a.action;
        const agent = a.softwareAgent ? ` <span class="c2pa-muted">via ${escapeHtml(a.softwareAgent)}</span>` : '';
        const when  = a.when ? ` <span class="c2pa-muted">${escapeHtml(new Date(a.when).toLocaleString())}</span>` : '';
        return `<li>${escapeHtml(name)}${agent}${when}</li>`;
      }).join('');
      out += rowEl(friendly, `<ul class="c2pa-action-list">${items}</ul>`);

    } else if (label === 'stds.exif' && assertion.data) {
      const exifRows = Object.entries(assertion.data)
        .filter(([, v]) => v != null && typeof v !== 'object')
        .slice(0, 12)
        .map(([k, v]) => rowEl(formatExifKey(k), escapeHtml(String(v))))
        .join('');
      if (exifRows) out += rowEl(friendly, `<div class="c2pa-rows c2pa-rows--nested">${exifRows}</div>`);

    } else if (label === 'c2pa.training-mining' && assertion.data) {
      const entries = Object.entries(assertion.data)
        .map(([k, v]) => rowEl(escapeHtml(k), escapeHtml(String(v))))
        .join('');
      out += rowEl(friendly, `<div class="c2pa-rows c2pa-rows--nested">${entries}</div>`);

    } else {
      const val = assertion.data != null
        ? JSON.stringify(assertion.data, null, 2)
        : '—';
      const truncated = val.length > 400 ? val.slice(0, 400) + '…' : val;
      out += rowEl(friendly, `<code class="c2pa-code">${escapeHtml(truncated)}</code>`);
    }
  }
  return out;
}

function renderIngredients(ingredients) {
  return ingredients.map(ing => {
    const title = ing.title ?? 'Untitled';
    const rel   = ing.relationship ?? '';
    return `<div class="c2pa-ingredient">
      <span class="c2pa-ingredient-title">${escapeHtml(title)}</span>
      ${rel ? `<span class="c2pa-badge c2pa-badge--rel">${escapeHtml(rel)}</span>` : ''}
    </div>`;
  }).join('');
}

function renderManifest(manifest, store) {
  const sections = [];

  if (manifest.claimGenerator) {
    sections.push(sectionEl('Claim Generator',
      `<span class="c2pa-value">${escapeHtml(manifest.claimGenerator)}</span>`));
  }

  if (manifest.signatureInfo) {
    const { issuer, time } = manifest.signatureInfo;
    let rows = '';
    if (issuer) rows += rowEl('Issuer', escapeHtml(issuer));
    if (time)   rows += rowEl('Signed', escapeHtml(new Date(time).toLocaleString()));
    if (rows) sections.push(sectionEl('Signature', `<div class="c2pa-rows">${rows}</div>`));
  }

  if (manifest.title) {
    sections.push(sectionEl('Title',
      `<span class="c2pa-value">${escapeHtml(manifest.title)}</span>`));
  }

  const assertionRows = renderAssertions(manifest.assertions);
  if (assertionRows) {
    sections.push(sectionEl('Assertions', `<div class="c2pa-rows">${assertionRows}</div>`));
  }

  if (manifest.ingredients?.length) {
    sections.push(sectionEl('Ingredients', renderIngredients(manifest.ingredients)));
  }

  const totalManifests = store.manifests?.size ?? 0;
  if (totalManifests > 1) {
    sections.push(sectionEl('Manifest Chain',
      `<span class="c2pa-value">${totalManifests} manifests in provenance chain</span>`));
  }

  return sections.join('');
}

// ── Module init ───────────────────────────────────────────────────────────────

export function initC2paReader() {
  const dropzone   = document.getElementById('c2pa-dropzone');
  const fileInput  = document.getElementById('c2pa-file-input');
  const resultEl   = document.getElementById('c2pa-result');
  const statusEl   = document.getElementById('c2pa-status');
  const manifestEl = document.getElementById('c2pa-manifest');

  // Drop zone wiring
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
  });
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  });

  async function processFile(file) {
    resultEl.style.display  = '';
    manifestEl.style.display = 'none';
    manifestEl.innerHTML    = '';
    statusEl.innerHTML = `<span class="c2pa-loading">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="c2pa-spin"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>
      Reading C2PA data&hellip;
    </span>`;

    try {
      const c2pa = await getC2pa();
      const { manifestStore } = await c2pa.read(file);

      if (!manifestStore) {
        statusEl.innerHTML = `
          <span class="c2pa-badge c2pa-badge--none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            No Content Credentials found
          </span>
          <p class="c2pa-hint">This file contains no C2PA data. It may have been stripped during export, sharing, or conversion &mdash; or the creating tool does not embed Content Credentials.</p>`;
        return;
      }

      statusEl.innerHTML = `
        <span class="c2pa-badge c2pa-badge--signed">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Content Credentials present
        </span>`;

      manifestEl.innerHTML  = renderManifest(manifestStore.activeManifest, manifestStore);
      manifestEl.style.display = '';

    } catch (err) {
      // Reset singleton on failure so the next file triggers a fresh load attempt
      c2paPromise = null;
      statusEl.innerHTML = `
        <span class="c2pa-badge c2pa-badge--error">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          Error reading C2PA data
        </span>
        <p class="c2pa-hint">${escapeHtml(String(err?.message ?? err))}</p>`;
    }
  }
}
