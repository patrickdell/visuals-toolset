/**
 * ffmpeg-shared.js — shared FFmpeg.wasm singleton
 * Imported by both compressor.js and trimmer.js so the 30 MB WASM loads once.
 */

const LIB = new URL('./lib/ffmpeg/', import.meta.url).href;

let ffInstance    = null;
let fetchFileUtil = null;
let loadPromise   = null;

/**
 * Returns { ff, fetchFile } — loads once, subsequent calls return cached instance.
 * Caller is responsible for calling ff.terminate() only if it truly wants to reset;
 * in that case also call resetFFmpeg() so the next call re-loads.
 */
export async function getFFmpeg(onProgress) {
  if (loadPromise) {
    const result = await loadPromise;
    // Re-attach progress listener if provided
    if (onProgress && result.ff) result.ff.on('progress', onProgress);
    return result;
  }

  loadPromise = (async () => {
    const [{ FFmpeg }, { fetchFile }] = await Promise.all([
      import(LIB + 'index.js'),
      import(LIB + 'util.js'),
    ]);
    fetchFileUtil = fetchFile;
    ffInstance = new FFmpeg();
    if (onProgress) ffInstance.on('progress', onProgress);
    await ffInstance.load({
      coreURL: LIB + 'ffmpeg-core.js',
      wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    });
    return { ff: ffInstance, fetchFile: fetchFileUtil };
  })();

  return loadPromise;
}

/**
 * Call after terminate() to allow the next getFFmpeg() to reload.
 */
export function resetFFmpeg() {
  ffInstance    = null;
  fetchFileUtil = null;
  loadPromise   = null;
}
