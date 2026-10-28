import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * What this tab knows about recent bulk actions — 003Fixes / 05.
 *
 * Feeds the "Recent actions" badge without a request on page load: an action
 * done here is remembered here; opening the panel fetches the full list from
 * the server (it survives a reload and other devices) and replaces this.
 */
let actions = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function rememberBulk(action) {
  actions = [action, ...actions.filter((a) => a.id !== action.id)].slice(0, 20);
  emit();
}

export function replaceRecent(list) {
  actions = list.slice(0, 20);
  emit();
}

export function markUndone(id) {
  actions = actions.map((a) => (a.id === id ? { ...a, status: 'undone' } : a));
  emit();
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const undoable = (now) => actions.filter((a) => a.status === 'done' && a.undoUntilMs > now).length;

/** How many actions can still be undone (re-checked each minute). */
export function useUndoableCount() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return useSyncExternalStore(subscribe, () => undoable(now));
}

export function __resetRecentBulk() {
  actions = [];
  emit();
}
