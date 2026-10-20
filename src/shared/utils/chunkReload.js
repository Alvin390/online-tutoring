/**
 * Recovering from a missing chunk after a deploy — Phase 13 / 08 C6b.
 *
 * Every deploy replaces the hashed chunk files. A tab opened before the deploy
 * still references the old names, so its next lazy import (opening the
 * billing page, the calendar, the Help & feedback form…) 404s and the user
 * gets a blank screen. Vite reports exactly that case with a
 * `vite:preloadError` event; the fix is to load the new version once.
 *
 * A sessionStorage stamp prevents a reload loop: if the chunk is still
 * missing straight after reloading (a genuinely broken deploy), the error is
 * let through to the error boundary instead.
 */

const KEY = 'tutoring.chunkReloadAt';
const LOOP_WINDOW_MS = 30_000;

export function installChunkReload(win = window) {
  const onPreloadError = (event) => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(KEY)) || 0;
    } catch {
      // Storage blocked: without a loop guard, do not auto-reload.
      return;
    }
    if (Date.now() - last < LOOP_WINDOW_MS) return; // already tried: surface the error

    try {
      win.sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault(); // Vite: do not throw; we are reloading
    win.location.reload();
  };

  win.addEventListener('vite:preloadError', onPreloadError);
  return () => win.removeEventListener('vite:preloadError', onPreloadError);
}
