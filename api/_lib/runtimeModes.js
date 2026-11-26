/**
 * The superadmin's mode switches — 013Fixes / 33-35 (owner answer 4).
 *
 * config/mode (server-only; closed in firestore.rules):
 *   payments     'live' | 'test'   Paystack keys and plans (M-Pesa STK has its
 *                                  own Off/Demo/Live setting, 013Fixes / 30b)
 *   sms          'real' | 'fake'   (33b)
 *   maintenance  { on, message, until }   (34)
 *   demo         { on, previous }  (35)
 *
 * Read once per isolate every 30 s, by the Worker before each API request and
 * cron run (refreshRuntimeModes), so the many synchronous callers
 * (paystackMode(), …) see it without a read of their own. The isolate that
 * writes a change updates its copy at once; others pick it up within 30 s.
 *
 * A failed read keeps the last good value; with none, it stays empty, which
 * means the environment decides — never "live" by accident.
 */

const DOC = 'config/mode';
export const MODES_CACHE_MS = 30_000;

let state = { at: null, value: {} };

/** The current switches ({} when none are set or none could be read). */
export const runtimeModes = () => state.value;

export function __resetRuntimeModes() {
  state = { at: null, value: {} };
}

/** Re-reads config/mode when the copy is older than 30 s. Never throws. */
export async function refreshRuntimeModes(db = null, { now = Date.now(), force = false } = {}) {
  if (!force && state.at != null && now - state.at < MODES_CACHE_MS) return state.value;
  try {
    const store = db ?? (await import('./firebaseAdmin.js')).getDb();
    const snap = await store.doc(DOC).get();
    state = { at: now, value: snap.exists ? (snap.data() ?? {}) : {} };
  } catch {
    // Keep the last good value; try again on the next request.
    state = { at: now, value: state.value };
  }
  return state.value;
}

/**
 * 013Fixes / 34: maintenance, from the cached switches.
 * @returns {{ on: boolean, message: string|null, until: number|null }}
 */
export function maintenanceState() {
  const m = state.value.maintenance;
  if (!m || m.on !== true) return { on: false, message: null, until: null };
  const until = m.until?.toMillis?.() ?? (m.until instanceof Date ? m.until.getTime() : (typeof m.until === 'number' ? m.until : null));
  return { on: true, message: typeof m.message === 'string' && m.message ? m.message : null, until };
}

/** Writes switches (merge) and updates this isolate's copy at once. */
export async function writeRuntimeModes(db, patch, { now = Date.now() } = {}) {
  await db.doc(DOC).set({ ...patch, updatedAt: new Date(now) }, { merge: true });
  state = { at: null, value: state.value };
  return refreshRuntimeModes(db, { now, force: true });
}
