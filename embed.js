/**
 * embed.js — responsive embed code generator
 * Ported from tgamembed.netlify.app (embed-responsively.html)
 */

const RATIOS = [
  { label: '16:9 — Widescreen', value: '56.25%'  },
  { label: '4:3 — Standard',    value: '75%'      },
  { label: '4:5 — Portrait',    value: '125%'     },
  { label: '1:1 — Square',      value: '100%'     },
  { label: '9:16 — Vertical',   value: '177.78%'  },
];

const SERVICES = [
  { id:'youtube',    label:'YouTube',        inputType:'url',   placeholder:'https://www.youtube.com/watch?v=dQw4w9WgXcQ', hint:'Paste a YouTube video URL',                                                                        defaultRatio:'56.25%',  parse:parseYouTube   },
  { id:'ytshorts',   label:'YouTube Shorts', inputType:'url',   placeholder:'https://www.youtube.com/shorts/dQw4w9WgXcQ',  hint:'Paste a YouTube Shorts URL',                                                                       defaultRatio:'177.78%', parse:parseYTShorts  },
  { id:'tiktok',     label:'TikTok',         inputType:'url',   placeholder:'https://www.tiktok.com/@user/video/123',      hint:'Paste a TikTok video URL. For more control and styling options, use TikTok\'s own embed code.',    defaultRatio:'177.78%', parse:parseTikTok    },
  { id:'vimeo',      label:'Vimeo',          inputType:'url',   placeholder:'https://vimeo.com/123456789',                 hint:'Paste a Vimeo video URL',                                                                          defaultRatio:'56.25%',  parse:parseVimeo     },
  { id:'instagram',  label:'Instagram',      inputType:'url',   placeholder:'https://www.instagram.com/p/ABCdef123/',     hint:'Paste an Instagram post URL',                                                                      defaultRatio:'100%',    parse:parseInstagram },
  { id:'twitter',    label:'X',              inputType:'url',   placeholder:'https://x.com/user/status/1234567890123',    hint:'Paste an X post URL',                                                                              special:'twitter',      parse:parseTwitter   },
  { id:'generic',    label:'Generic iframe', inputType:'url',   placeholder:'https://example.com/embed/123',              hint:'Paste the embed URL — it will be wrapped in a responsive container',                               defaultRatio:'56.25%',  parse:parseGeneric   },
];

// ── Parsers ───────────────────────────────────────────────────────────────

function extractIframeSrc(code) {
  const m = code.match(/src="([^"]+)"/i) || code.match(/src='([^']+)'/i);
  return m ? m[1] : null;
}

function parseYouTube(input) {
  input = input.trim();
  if (input.startsWith('<')) {
    const s = extractIframeSrc(input);
    return s?.includes('youtube') ? cleanYouTubeEmbedUrl(s) : null;
  }
  try {
    const url = new URL(input);
    if (url.hostname === 'youtu.be') return 'https://www.youtube.com/embed/' + url.pathname.slice(1).split('/')[0];
    const shorts = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
    if (shorts) return 'https://www.youtube.com/embed/' + shorts[1];
    const live = url.pathname.match(/\/live\/([A-Za-z0-9_-]+)/);
    if (live) return 'https://www.youtube.com/embed/' + live[1];
    const v = url.searchParams.get('v');
    if (v) return 'https://www.youtube.com/embed/' + v;
    if (url.pathname.includes('/embed/')) return cleanYouTubeEmbedUrl(input);
  } catch (_) {}
  const m = input.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  const raw = m ? 'https://www.youtube.com/embed/' + m[1] : null;
  return raw ? cleanYouTubeEmbedUrl(raw) : null;
}

function parseYTShorts(input) {
  const m = input.trim().match(/\/shorts\/([A-Za-z0-9_-]+)/);
  return m ? 'https://www.youtube.com/embed/' + m[1] : parseYouTube(input);
}

function parseTikTok(input) {
  const m = input.trim().match(/\/video\/(\d+)/);
  return m ? 'https://www.tiktok.com/embed/v2/' + m[1] : null;
}

function parseVimeo(input) {
  input = input.trim();
  if (input.startsWith('<')) { const s = extractIframeSrc(input); return s?.includes('vimeo') ? s : null; }
  try {
    const url = new URL(input);
    if (url.hostname.includes('vimeo')) {
      const id = url.pathname.split('/').filter(Boolean).reverse().find(s => /^\d+$/.test(s));
      if (id) return 'https://player.vimeo.com/video/' + id;
    }
  } catch (_) {}
  const m = input.match(/vimeo\.com\/(?:.*\/)?(\d+)/);
  return m ? 'https://player.vimeo.com/video/' + m[1] : null;
}

function parseInstagram(input) {
  input = input.trim();
  if (input.startsWith('<')) return extractIframeSrc(input);
  const m = input.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/);
  return m ? 'https://www.instagram.com/p/' + m[1] + '/embed/' : null;
}

function parseGeneric(input) {
  input = input.trim();
  if (!/^https?:\/\//i.test(input) && !input.startsWith('<')) return null;
  if (input.startsWith('<')) return extractIframeSrc(input);
  return input;
}

// ── URL helpers ───────────────────────────────────────────────────────────

function cleanYouTubeEmbedUrl(url) {
  try {
    const u = new URL(url);
    ['si', 'feature', 'app', 'pp', 'list'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}

// ── New service parsers ────────────────────────────────────────────────────

function parseTwitter(input) {
  input = input.trim();
  if (input.startsWith('<')) {
    const m = input.match(/status\/(\d+)/);
    return m ? m[1] : null;
  }
  const m = input.match(/(?:twitter|x)\.com\/[^/?#]+\/status\/(\d+)/);
  return m ? m[1] : null; // returns tweet ID string
}

// ── Output builders ───────────────────────────────────────────────────────

function timeToSeconds(val) {
  val = val.trim();
  if (!val) return 0;
  const parts = val.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return isNaN(parts[0]) ? 0 : parts[0];
}

function buildOutput(src, paddingBottom, bgColor, floatRight) {
  bgColor = bgColor || '#000000';
  const embedBlock =
`<style>
.embed-container {
  position: relative;
  padding-bottom: ${paddingBottom};
  height: 0;
  overflow: hidden;
  max-width: 100%;
  background: ${bgColor};
}
.embed-container iframe {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
}
</style>
<div class="embed-container">
  <iframe src="${src}"
          frameborder="0"
          allowfullscreen
          loading="lazy"
          title="Embedded content">
  </iframe>
</div>`;

  if (!floatRight) return embedBlock;
  return `<style>
@media (min-width: 700px) {
  .gi-mm-slider {
    max-width: 18.75rem;
    margin: 0px 0px 0.625rem 1.25rem !important;
    float: right;
    clear: both;
  }
}
</style>
<div class="gi-mm-slider">
${embedBlock}
</div>`;
}

function renderPreview(container, src, paddingBottom, bgColor) {
  bgColor = bgColor || '#000000';
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;padding-bottom:${paddingBottom};height:0;overflow:hidden;max-width:100%;background:${bgColor}`;
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
  iframe.setAttribute('title', 'Embedded content');
  iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0';
  wrap.appendChild(iframe);
  container.appendChild(wrap);
}

// ── Clipboard ─────────────────────────────────────────────────────────────

function copyText(text, btn) {
  function showFeedback() {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy code'; btn.classList.remove('copied'); }, 2000);
  }
  navigator.clipboard?.writeText(text).then(showFeedback).catch(fallback) ?? fallback();
  function fallback() {
    try {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showFeedback();
    } catch (_) {}
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────

function esc(str)     { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(str) { return str.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function buildRatioOptions(defaultValue) {
  return RATIOS.map(r =>
    `<option value="${r.value}"${r.value === defaultValue ? ' selected' : ''}>${r.label}</option>`
  ).join('');
}

// ── Panel HTML per service ────────────────────────────────────────────────

function buildOptionsRow(svc) {
  if (svc.special === 'twitter') {
    return `<div class="e-row">
  <div class="e-field">
    <label for="ew-twitter">Max width</label>
    <select id="ew-twitter">
      <option value="auto">Full width</option>
      <option value="550" selected>550px — Standard</option>
      <option value="325">325px — Narrow</option>
    </select>
  </div>
  <button class="e-btn e-btn-primary" data-gen="twitter">Generate</button>
  <button class="e-btn-clear" data-clear="twitter">Clear</button>
</div>
<p class="e-hint" style="margin-top:6px">Standard works for article column width. Narrow can be floated right as a sidebar embed.</p>`;
  }
  // Standard
  return `<div class="e-row">
  <div class="e-field">
    <label for="er-${svc.id}">Aspect ratio</label>
    <select id="er-${svc.id}">${buildRatioOptions(svc.defaultRatio)}</select>
  </div>
  <button class="e-btn e-btn-primary" data-gen="${svc.id}">Generate</button>
  <button class="e-btn-clear" data-clear="${svc.id}">Clear</button>
</div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initEmbed() {
  const tabBar = document.getElementById('embedTabBar');
  const panels = document.getElementById('embedPanels');

  SERVICES.forEach((svc, i) => {
    // Tab button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'svc-btn' + (i === 0 ? ' active' : '');
    btn.dataset.svc = svc.id;
    btn.textContent = svc.label;
    tabBar.appendChild(btn);

    const inputEl = svc.inputType === 'embed'
      ? `<textarea id="ei-${svc.id}" placeholder="${escAttr(svc.placeholder)}" spellcheck="false" autocomplete="off"></textarea>`
      : `<input type="url" id="ei-${svc.id}" placeholder="${escAttr(svc.placeholder)}" spellcheck="false" autocomplete="off">`;

    const youtubeExtras = svc.id === 'youtube' ? `
  <div class="e-row" style="margin-top:.75rem">
    <div class="e-field" style="flex:0 0 140px">
      <label for="est-youtube">Start time (optional)</label>
      <input type="text" id="est-youtube" placeholder="0:00" style="font-family:monospace" autocomplete="off" spellcheck="false">
    </div>
  </div>` : '';

    const swatchesHtml = '';

    // Float-right option: hide for twitter (blockquote doesn't float cleanly)
    const floatHtml = svc.special !== 'twitter' ? `
  <div class="e-float-row">
    <input type="checkbox" id="ef-${svc.id}">
    <label for="ef-${svc.id}" style="text-transform:none;letter-spacing:0;font-weight:400;font-size:.88rem;color:var(--muted);cursor:pointer;margin:0">Float right</label>
  </div>` : '';

    const panel = document.createElement('div');
    panel.className = 'svc-panel' + (i === 0 ? ' active' : '');
    panel.id = 'ep-' + svc.id;
    panel.innerHTML = `
<div class="e-card">
  <label for="ei-${svc.id}">${svc.label}</label>
  ${inputEl}
  <p class="e-hint">${esc(svc.hint)}</p>
  ${buildOptionsRow(svc)}
  ${swatchesHtml}
  ${youtubeExtras}
  ${floatHtml}
  <div class="e-error" id="ee-${svc.id}"></div>
  <div class="e-output" id="eo-${svc.id}">
    <div class="e-output-header">
      <span>Generated code</span>
      <button class="e-btn e-btn-copy" data-ecopy="${svc.id}">Copy code</button>
    </div>
    <textarea class="e-code" id="ec-${svc.id}" readonly spellcheck="false"></textarea>
    <p class="e-preview-label">Live preview</p>
    <div class="e-preview-wrap" id="epv-${svc.id}"></div>
  </div>
</div>`;
    panels.appendChild(panel);
  });

  // Service tab switching
  tabBar.addEventListener('click', e => {
    const btn = e.target.closest('.svc-btn');
    if (!btn) return;
    const id = btn.dataset.svc;
    tabBar.querySelectorAll('.svc-btn').forEach(b => b.classList.remove('active'));
    panels.querySelectorAll('.svc-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('ep-' + id).classList.add('active');
  });

  // Generate + copy + clear + swatches + Enter key
  panels.addEventListener('click', e => {
    const gen = e.target.closest('[data-gen]');
    if (gen) { handleGenerate(gen.dataset.gen); return; }
    const copy = e.target.closest('[data-ecopy]');
    if (copy) { copyText(document.getElementById('ec-' + copy.dataset.ecopy).value, copy); return; }
    const clr = e.target.closest('[data-clear]');
    if (clr) {
      const id = clr.dataset.clear;
      document.getElementById('ei-' + id).value = '';
      const ee = document.getElementById('ee-' + id);
      ee.textContent = ''; ee.classList.remove('visible');
      document.getElementById('eo-' + id).classList.remove('visible');
      return;
    }
    const swatch = e.target.closest('.e-swatch');
    if (swatch) {
      const swatchGroup = swatch.closest('.e-swatches');
      swatchGroup.querySelectorAll('.e-swatch').forEach(s => s.classList.remove('e-swatch--active'));
      swatch.classList.add('e-swatch--active');
      const picker = document.getElementById(swatchGroup.dataset.target);
      if (picker) picker.value = swatch.dataset.color;
      return;
    }
    if (e.target.classList.contains('e-code')) e.target.select();
  });

  panels.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      const panel = e.target.closest('.svc-panel');
      if (panel) handleGenerate(panel.id.replace('ep-', ''));
    }
  });

  // Auto-generate on paste into the embed panel area
  panels.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text').trim();
    if (!text) return;
    const activePanel = panels.querySelector('.svc-panel.active');
    if (!activePanel) return;
    const input = activePanel.querySelector('input[type="url"], textarea');
    if (!input || document.activeElement === input) return; // don't double-fire if already focused
    input.value = text;
    const svcId = activePanel.id.replace('ep-', '');
    setTimeout(() => handleGenerate(svcId), 100);
  });

  function showError(svcId, msg) {
    const errorEl  = document.getElementById('ee-' + svcId);
    const outputEl = document.getElementById('eo-' + svcId);
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
    outputEl.classList.remove('visible');
  }

  function handleGenerate(svcId) {
    const svc = SERVICES.find(s => s.id === svcId);
    if (!svc) return;

    const inputEl   = document.getElementById('ei-' + svcId);
    const errorEl   = document.getElementById('ee-' + svcId);
    const outputEl  = document.getElementById('eo-' + svcId);
    const codeEl    = document.getElementById('ec-' + svcId);
    const previewEl = document.getElementById('epv-' + svcId);

    const input = inputEl.value.trim();
    errorEl.textContent = '';
    errorEl.classList.remove('visible');

    if (!input) {
      showError(svcId, 'Please paste a URL or embed code above.');
      return;
    }

    let src;
    try { src = svc.parse(input); } catch (_) { src = null; }

    if (!src) {
      showError(svcId, 'Could not extract an embed URL. Double-check it and try again.');
      return;
    }

    // ── X / Twitter ───────────────────────────────────────────────────────
    if (svcId === 'twitter') {
      const tweetId  = src; // tweet ID string
      let   tweetUrl = input;
      if (!tweetUrl.startsWith('http')) tweetUrl = 'https://' + tweetUrl;
      const width     = document.getElementById('ew-twitter')?.value ?? '550';
      const widthAttr = width === 'auto' ? '' : ` data-width="${width}"`;
      codeEl.value = `<blockquote class="twitter-tweet"${widthAttr}>\n  <a href="${tweetUrl}"></a>\n</blockquote>\n<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"><\/script>`;
      previewEl.innerHTML = `<iframe src="https://platform.twitter.com/embed/Tweet.html?id=${tweetId}" style="width:100%;border:0;height:300px" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`;
      outputEl.classList.add('visible');
      codeEl.select();
      return;
    }

    // ── Standard responsive embed ─────────────────────────────────────────
    const ratioEl       = document.getElementById('er-' + svcId);
    const paddingBottom = ratioEl.value;

    if (svcId === 'youtube') {
      const secs = timeToSeconds(document.getElementById('est-youtube').value);
      if (secs > 0) src += (src.includes('?') ? '&' : '?') + 'start=' + secs;
    }

    const floatRight = document.getElementById('ef-' + svcId).checked;

    codeEl.value = buildOutput(src, paddingBottom, null, floatRight);
    renderPreview(previewEl, src, paddingBottom, null);
    outputEl.classList.add('visible');
    codeEl.select();
  }
}
