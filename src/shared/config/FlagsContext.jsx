import { useEffect, useSyncExternalStore } from 'react';
import { getPublicBootstrap } from '@services/api/public';
import { DEFAULT_FLAGS, resolveFlags } from './flags';
import logger from '@utils/logger';

/**
 * Feature flags — Phase 01 D6, reworked in Phase 13 / 08 (A1, B4).
 *
 * WHERE THEY COME FROM. Every page reads them from /api/public/bootstrap —
 * no Firebase on public pages (A1). Staff pages additionally mount
 * <FlagsLiveSync> (in the staff shell), which keeps them live from Firestore.
 * Flags render against the defaults until the first answer: every default is
 * the conservative (off) value, so the worst case is a feature appearing a
 * beat late.
 *
 * HOW THEY ARE READ. A tiny external store and `useSyncExternalStore` (B4):
 * `useFlag(key)` re-renders a component only when THAT flag changes. The old
 * context re-rendered every consumer whenever any flag document changed.
 */

let flags = DEFAULT_FLAGS;
// 007Fixes / 06: true once the first real answer (or a failure to get one) is
// in. Until then a flag that reads "off" may only be the default, so a page
// must not act on it in a way it cannot undo (the dashboard redirected away
// from a flag-gated tab on a refresh).
let loaded = false;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

export const flagsStore = {
  get: () => flags,
  isLoaded: () => loaded,
  /** @param {object|null} raw a config/flags document (or the bootstrap's flags) */
  setFromRemote(raw) {
    const first = !loaded;
    loaded = true;
    const next = resolveFlags(raw ?? null);
    const changed = Object.keys(next).some((k) => next[k] !== flags[k]);
    if (changed) flags = next;
    if (changed || first) notify();
  },
  /** No answer is coming (the request failed): the defaults are final. */
  markLoaded() {
    if (loaded) return;
    loaded = true;
    notify();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** For tests. */
  __reset() {
    flags = DEFAULT_FLAGS;
    loaded = false;
  },
};

export function FlagsProvider({ children }) {
  useEffect(() => {
    getPublicBootstrap()
      .then((data) => flagsStore.setFromRemote(data?.flags))
      .catch((error) => {
        // Non-fatal: the app runs on defaults.
        logger.warn('Flags unavailable; using defaults', { code: error?.code });
        flagsStore.markLoaded();
      });
  }, []);
  return children;
}

/** Returns the whole flag map. */
export function useFlags() {
  return useSyncExternalStore(flagsStore.subscribe, flagsStore.get, flagsStore.get);
}

/** Returns one boolean; re-renders only when that flag changes. */
export function useFlag(key) {
  const read = () => flagsStore.get()[key] === true;
  return useSyncExternalStore(flagsStore.subscribe, read, read);
}

/** Whether the flags have arrived (or are known to be unavailable). */
export function useFlagsLoaded() {
  return useSyncExternalStore(flagsStore.subscribe, flagsStore.isLoaded, flagsStore.isLoaded);
}
