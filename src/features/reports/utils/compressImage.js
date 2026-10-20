import {
  ACCEPTED_TYPES,
  MAX_FULL_BYTES,
  MAX_SOURCE_BYTES,
  MAX_THUMB_BYTES,
} from '../constants';

/**
 * Screenshot compression — Phase 13 / 06 D2.
 *
 * A phone screenshot is 1–4 MB of PNG; the server takes at most 185 KB per
 * image (what fits a 256 KB JSON body as base64). So in the browser:
 *
 *   decode (createImageBitmap) → long edge ≤ 1600 px → WebP q0.8
 *   still too big → q0.65 → then shrink 25% at a time down to 480 px
 *
 * Ruling: the plan said "re-encode at 0.65 if over 240 KB". 240 KB cannot fit
 * the body cap, so the ladder targets the server's real limit and keeps
 * shrinking rather than giving up after one retry.
 *
 * Browsers that cannot ENCODE WebP (older Safari) silently hand back a PNG;
 * that is detected from the blob's type and the ladder switches to JPEG.
 * The type declared to the server is always the blob's real type, because
 * the server refuses a declared/actual mismatch.
 *
 * Decode and encode are injectable so the ladder is testable without a canvas.
 */

export class CompressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompressError';
  }
}

const FULL_EDGE = 1600;
const MIN_EDGE = 480;
const THUMB_EDGE = 320;

async function defaultDecode(file) {
  return createImageBitmap(file);
}

async function defaultEncode(bitmap, width, height, type, quality) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new CompressError('This browser could not encode the image.'))), type, quality);
  });
}

const fit = (width, height, edge) => {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** Encodes under `maxBytes`, trying quality first, then size. */
async function encodeUnder(bitmap, { edge, maxBytes, qualities, minEdge }, encode) {
  let type = 'image/webp';
  let currentEdge = edge;

  for (;;) {
    const { width, height } = fit(bitmap.width, bitmap.height, currentEdge);
    for (const quality of qualities) {
      const blob = await encode(bitmap, width, height, type, quality);
      if (type === 'image/webp' && blob.type !== 'image/webp') {
        // No WebP encoder: PNG came back. JPEG compresses screenshots well
        // enough and every browser can write it.
        type = 'image/jpeg';
        const jpeg = await encode(bitmap, width, height, type, quality);
        if (jpeg.size <= maxBytes) return { blob: jpeg, width, height, type };
        continue;
      }
      if (blob.size <= maxBytes) return { blob, width, height, type: blob.type || type };
    }
    if (Math.max(width, height) <= minEdge) return null;
    currentEdge = Math.max(minEdge, Math.floor(Math.max(width, height) * 0.75));
  }
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{full: {blob, width, height, type}, thumb: {blob, width, height, type}|null}>}
 */
export async function compressImage(file, { decode = defaultDecode, encode = defaultEncode } = {}) {
  if (!file || !ACCEPTED_TYPES.includes(file.type)) {
    throw new CompressError('Only PNG, JPEG or WebP images can be attached.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new CompressError('That image is over 10 MB. Please take a smaller screenshot.');
  }

  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new CompressError('That image could not be read. Try saving it again as PNG or JPEG.');
  }

  try {
    const full = await encodeUnder(
      bitmap,
      { edge: FULL_EDGE, maxBytes: MAX_FULL_BYTES, qualities: [0.8, 0.65], minEdge: MIN_EDGE },
      encode
    );
    if (!full) throw new CompressError('That image is too detailed to attach. Try cropping it.');

    const thumb = await encodeUnder(
      bitmap,
      { edge: THUMB_EDGE, maxBytes: MAX_THUMB_BYTES, qualities: [0.7, 0.5], minEdge: THUMB_EDGE },
      encode
    );
    return { full, thumb };
  } finally {
    // Decoded bitmaps hold the full-resolution pixels (tens of MB for a
    // phone screenshot) until closed.
    bitmap?.close?.();
  }
}

/**
 * Runs `compressImage` in a Web Worker where the browser can (OffscreenCanvas
 * in workers), so a large decode never freezes the form; otherwise on the
 * main thread. A worker failure falls back rather than failing the upload.
 */
export async function compressInBackground(file) {
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  if (canWorker) {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./compressImage.worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          worker.terminate();
          if (data?.error) reject(new CompressError(data.error));
          else resolve(data);
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(event);
        };
        worker.postMessage({ file });
      });
    } catch (err) {
      if (err instanceof CompressError) throw err;
      // Worker could not start or crashed: fall through to the main thread.
    }
  }
  return compressImage(file);
}

/** Blob → bare base64 (no data: prefix), for the JSON upload body. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Blob → data: URL, for previews that must survive a sessionStorage draft. */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
