import { useSyncExternalStore } from 'react';

/**
 * The superadmin's mode switches as the screens see them — 013Fixes / 33-35.
 * Filled from the same /api/public/bootstrap answer as the flags (no request
 * of its own): { paymentsTest, smsFake, maintenance, demo }. Until it
 * arrives, nothing is shown (no banner flashes on a normal school).
 */

const EMPTY = Object.freeze({});
let modes = EMPTY;
const listeners = new Set();

export const modesStore = {
  get: () => modes,
  setFromRemote(raw) {
    const next = raw && typeof raw === 'object' ? raw : EMPTY;
    if (JSON.stringify(next) === JSON.stringify(modes)) return;
    modes = next;
    listeners.forEach((l) => l());
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** For tests. */
  __reset() { modes = EMPTY; },
};

export function useModes() {
  return useSyncExternalStore(modesStore.subscribe, modesStore.get, modesStore.get);
}
