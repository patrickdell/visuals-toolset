/**
 * redactor.worker.js — Object detection worker for Auto-Redactor
 * Uses Xenova/yolos-tiny via Transformers.js to detect persons and vehicles.
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache  = true;

// Constants
const MODEL_ID = 'Xenova/yolos-tiny';
const DEFAULT_THRESHOLD = 0.3;
const MSG_TYPES = { LOAD: 'load', DETECT: 'detect', STATUS: 'status', DOWNLOAD: 'download', READY: 'ready', DETECTIONS: 'detections', ERROR: 'error' };

let detector     = null;
let loadedModel  = null;

const PEOPLE_CLASSES   = new Set(['person']);
const VEHICLE_CLASSES  = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);

self.addEventListener('message', async ({ data }) => {

  // ── Load model ──────────────────────────────────────────────────────────────
  if (data.type === MSG_TYPES.LOAD) {
    if (detector) { self.postMessage({ type: MSG_TYPES.READY }); return; }
    try {
      self.postMessage({ type: MSG_TYPES.STATUS, text: 'Loading detection model…' });
      detector = await pipeline('object-detection', MODEL_ID, {
        progress_callback: p => {
          if (p.status === 'downloading') {
            self.postMessage({ type: MSG_TYPES.DOWNLOAD, loaded: p.loaded, total: p.total, file: p.file });
          }
        },
      });
      loadedModel = MODEL_ID;
      self.postMessage({ type: MSG_TYPES.READY });
    } catch (e) {
      self.postMessage({ type: MSG_TYPES.ERROR, message: e.message });
    }
  }

  // ── Detect ──────────────────────────────────────────────────────────────────
  if (data.type === MSG_TYPES.DETECT) {
    if (!detector) { self.postMessage({ type: MSG_TYPES.ERROR, message: 'Model not loaded' }); return; }
    try {
      self.postMessage({ type: MSG_TYPES.STATUS, text: 'Detecting…' });
      const output = await detector(data.imageUrl, { threshold: data.threshold ?? DEFAULT_THRESHOLD });

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

      self.postMessage({ type: MSG_TYPES.DETECTIONS, boxes });
    } catch (e) {
      self.postMessage({ type: MSG_TYPES.ERROR, message: e.message });
    }
  }
});

function matchesTarget(label, target) {
  if (target === 'people')   return PEOPLE_CLASSES.has(label);
  if (target === 'vehicles') return VEHICLE_CLASSES.has(label);
  return true; // 'all'
}
