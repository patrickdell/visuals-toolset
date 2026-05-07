/**
 * redactor.worker.js — Object detection worker for Auto-Redactor
 * Uses Xenova/yolos-tiny via Transformers.js to detect persons and vehicles.
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache  = true;

let detector     = null;
let loadedModel  = null;

const PEOPLE_CLASSES   = new Set(['person']);
const VEHICLE_CLASSES  = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);

self.addEventListener('message', async ({ data }) => {

  // ── Load model ──────────────────────────────────────────────────────────────
  if (data.type === 'load') {
    const modelId = 'Xenova/yolos-tiny';
    if (detector && loadedModel === modelId) { self.postMessage({ type: 'ready' }); return; }
    try {
      self.postMessage({ type: 'status', text: 'Loading detection model…' });
      detector = await pipeline('object-detection', modelId, {
        progress_callback: p => {
          if (p.status === 'downloading') {
            self.postMessage({ type: 'download', loaded: p.loaded, total: p.total, file: p.file });
          }
        },
      });
      loadedModel = modelId;
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message });
    }
  }

  // ── Detect ──────────────────────────────────────────────────────────────────
  if (data.type === 'detect') {
    if (!detector) { self.postMessage({ type: 'error', message: 'Model not loaded' }); return; }
    try {
      self.postMessage({ type: 'status', text: 'Detecting…' });
      const output = await detector(data.imageUrl, { threshold: data.threshold ?? 0.3 });

      const boxes = output
        .filter(d => matchesTarget(d.label.toLowerCase(), data.target))
        .map(d => ({
          x:     Math.round(d.box.xmin),
          y:     Math.round(d.box.ymin),
          w:     Math.round(d.box.xmax - d.box.xmin),
          h:     Math.round(d.box.ymax - d.box.ymin),
          label: d.label,
          score: d.score,
        }));

      self.postMessage({ type: 'detections', boxes });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message });
    }
  }
});

function matchesTarget(label, target) {
  if (target === 'people')   return PEOPLE_CLASSES.has(label);
  if (target === 'vehicles') return VEHICLE_CLASSES.has(label);
  return true; // 'all'
}
