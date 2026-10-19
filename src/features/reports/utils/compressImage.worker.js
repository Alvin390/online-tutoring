import { compressImage } from './compressImage';

/**
 * Off-main-thread screenshot compression — Phase 13 / 06 D2.
 * One message in ({ file }), one out ({ full, thumb } or { error }). Blobs are
 * structured-cloneable, so nothing is re-encoded crossing back.
 */
self.onmessage = async ({ data }) => {
  try {
    self.postMessage(await compressImage(data.file));
  } catch (err) {
    self.postMessage({ error: err?.message ?? 'The image could not be compressed.' });
  }
};
