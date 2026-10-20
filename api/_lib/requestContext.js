import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-invocation context — Phase 13 / 08 C3.
 *
 * Carries the Worker's `ctx.waitUntil` to code that has no `req` in hand —
 * above all `tryWriteAudit`, called from ~60 places, many inside helpers. With
 * it, an audit write no longer sits on the response path (one Google round
 * trip on every mutation) yet is still guaranteed to finish: the runtime keeps
 * the invocation alive until every waitUntil promise settles.
 *
 * Outside a Worker invocation (scripts, direct unit tests) there is no
 * context and callers simply await as before.
 */

const store = new AsyncLocalStorage();

export function runInRequestContext(context, fn) {
  return store.run(context, fn);
}

/**
 * Hands `promise` to the invocation's waitUntil when there is one.
 * @returns {boolean} true if deferred; false = no context, caller should await
 */
export function deferToBackground(promise) {
  const ctx = store.getStore();
  if (typeof ctx?.waitUntil !== 'function') return false;
  ctx.waitUntil(promise);
  return true;
}
