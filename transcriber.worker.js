/**
 * transcriber.worker.js — Whisper ASR worker
 * Runs in a Web Worker so UI stays responsive during model load + inference.
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

env.allowLocalModels = false;
// Cache models in the browser (Cache API via transformers.js internals)
env.useBrowserCache = true;

let transcriber = null;
let currentModel = null;

self.addEventListener('message', async ({ data }) => {

  // ── Load model ────────────────────────────────────────────────────────────
  if (data.type === 'load') {
    const modelId = 'Xenova/whisper-' + (data.model || 'tiny') + '.en';
    if (transcriber && currentModel === modelId) {
      self.postMessage({ type: 'ready' }); return;
    }
    try {
      transcriber = await pipeline(
        'automatic-speech-recognition',
        modelId,
        {
          progress_callback: p => {
            if (p.status === 'downloading') {
              self.postMessage({ type: 'download', loaded: p.loaded, total: p.total, file: p.file });
            }
            if (p.status === 'initiate') {
              self.postMessage({ type: 'status', text: 'Loading model…' });
            }
          }
        }
      );
      currentModel = modelId;
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message });
    }
  }

  // ── Transcribe ────────────────────────────────────────────────────────────
  if (data.type === 'transcribe') {
    if (!transcriber) { self.postMessage({ type: 'error', message: 'Model not loaded' }); return; }
    try {
      self.postMessage({ type: 'status', text: 'Transcribing…' });
      const result = await transcriber(data.audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        callback_function: beams => {
          // Stream completed chunks back as they arrive
          const chunks = beams[0]?.chunks;
          if (chunks?.length) self.postMessage({ type: 'chunk', chunks });
        },
      });
      self.postMessage({ type: 'done', result });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message });
    }
  }
});
