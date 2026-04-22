# Visuals Toolset — CLAUDE.md

## What this is

A privacy-first collection of browser-based media tools. Every operation runs
entirely in the user's browser — nothing is uploaded to any server. Built as a
single-page app using vanilla ES modules, no bundler, no build step.

Deployed on Cloudflare Pages: **https://visuals-toolset.pages.dev**
Source: **https://github.com/patrickdell/visuals-toolset**

---

## Running locally

Open `index.html` directly in a browser, or serve with any static file server:

```
npx serve .
# or
python -m http.server
```

There is no build step, no install step, and no `node_modules`. The `package.json`
exists only to name the project.

---

## Git

Single remote — `visuals-toolset`:

```
git push visuals-toolset master
```

Do **not** push to `origin` (the old `aspect-ratio-calculator` repo has been
decoupled; the remote has been removed).

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Modules | Native ES modules (`type="module"`) |
| Bundler | None |
| Video encoding | FFmpeg.wasm (loaded from local `lib/ffmpeg/`) |
| Speech-to-text | Transformers.js via web worker (`transcriber.worker.js`) |
| OCR | Tesseract.js (CDN `<script>` tag, not an ES module) |
| ZIP | JSZip (CDN `<script>` tag) |
| CSS | Single `style.css`, custom properties, no framework |
| Favicon | `favicon.svg` — SVG linked from `<head>` |

---

## File structure

```
index.html              Single HTML file; all panels live here as <section> elements
style.css               All styles; CSS custom properties define the design system
app.js                  Tab routing, chip state, nav drawer, About modal
favicon.svg             SVG favicon — crop frame with rule-of-thirds + corner handles

── Tool modules (each exports one init* function called from app.js) ──
embed.js                Responsive embed code generator (iframes, social platforms)
calculator.js           Aspect ratio calculator; exports PRESETS used across modules
cropper.js              Image crop & export (canvas-based)
exporter.js             Exports cropped images from the cropper
compressor.js           H.264 video compression via FFmpeg.wasm; batch queue
trimmer.js              Video/audio trimmer with In/Out point selection
thumbnail.js            Crop & export a short video clip from within the Trimmer panel
extractor.js            Extract audio from video (MP3, AAC, WAV) via FFmpeg.wasm
palette.js              Dominant colour palette extractor (median-cut, canvas pixels)
labeller.js             Overlay a disclosure label on a photo; drag, resize, export
waveform-renderer.js    Animated waveform over image/video, export as WebM
transcriber.js          Local speech-to-text using Whisper via web worker
transcriber.worker.js   Web worker that loads Transformers.js and runs Whisper
ocr.js                  Local OCR using Tesseract.js

── Shared utilities ──
utils.js                saveFile (File System Access API + fallback), setupDropzone
ffmpeg-shared.js        FFmpeg.wasm singleton — imported by compressor.js & trimmer.js
                        so the 30 MB WASM loads only once

── FFmpeg.wasm (vendored) ──
lib/ffmpeg/             Local copy of ffmpeg.wasm + worker glue code

── Cloudflare Pages routing ──
_redirects              /v2/ → index.html (legacy URL support)
```

---

## Design system

All colours are CSS custom properties on `:root`. Light/dark modes swap them
automatically via `prefers-color-scheme`. Key tokens:

| Property | Role |
|----------|------|
| `--bg` | Page background |
| `--card` | Panel / card surface |
| `--card2` | Hover state / inset surface |
| `--ink` | Primary text |
| `--muted` | Secondary text, labels, hints |
| `--accent` | Interactive highlight (indigo) |
| `--line` | Borders and dividers |
| `--radius` | Large border-radius (panels) |
| `--radius-sm` | Small border-radius (inputs, chips) |

---

## Adding a new tool

1. Create `mytool.js` exporting `export function initMyTool() { … }`.
2. Add the panel `<section id="panel-mytool">…</section>` in `index.html`.
3. Add a tab button `<button class="tab-btn" data-tab="mytool">…</button>` in the nav.
4. Register the panel in `app.js` `panels` map: `mytool: 'panel-mytool'`.
5. Import and call `initMyTool()` from `app.js`.
6. Add a matching item to the mobile nav drawer (happens automatically — the drawer
   iterates `tabBtns`).

---

## Key patterns

### File saves
`saveFile(blob, filename, mimeType)` in `utils.js` — tries the File System Access
API first (shows a native save dialog), falls back to a hidden `<a download>` click.

### Dropzones
`setupDropzone(el, onFile)` in `utils.js` — handles drag-and-drop and
`<input type="file">` for a given drop target element.

### FFmpeg.wasm
`ffmpeg-shared.js` exports a lazy-loaded singleton:
```js
import { getFFmpeg } from './ffmpeg-shared.js';
const ffmpeg = await getFFmpeg();
```
Always import from the shared module rather than creating a new `FFmpeg` instance —
the WASM binary is 30 MB and must load only once.

### trm:loaded event
`trimmer.js` fires `document.dispatchEvent(new CustomEvent('trm:loaded', { detail: { file, isVideo } }))` 
inside its `loadedmetadata` handler. `thumbnail.js` listens for this event to know
when `videoEl.videoWidth` / `videoEl.videoHeight` are safe to read.

### Thumbnail canvas handles
`thumbnail.js` draws corner resize handles directly on the canvas. Hit-testing uses
`canvasPos()` to convert pointer coordinates from CSS pixels to video pixels before
comparing against handle positions. `applyResize()` implements aspect-ratio-locked
resize: the dragged corner moves, the opposite corner stays fixed, and the larger of
the horizontal or vertical drag distance determines the new size.

---

## Licence

Copyright © 2026 Patrick Dell. Free for personal, educational, and non-commercial
use. See the About modal in the app for the full licence terms.
