import { getDb } from './firebaseAdmin.js';

/**
 * Server-side flag reader — Phase 01 D6.
 *
 * Memoised for the lifetime of a warm container with a short TTL. A flag flip
 * therefore takes effect within TTL_MS on already-warm instances instead of
 * costing a Firestore read on every single request. Flags change by hand, a few
 * times a release; 30 seconds of staleness is not a risk, and one read per
 * request across every endpoint would be.
 *
 * Duplicated defaults rather than an import from src/: `/api` is a separate
 * build target with no Vite alias resolution. Keep the two in step.
 */

const DEFAULT_FLAGS = {
  'auth.roles': false,
  'auth.studentIdentity': false,
  'auth.legacyStudentRead': true,
  'billing.enabled': false,
  'registration.requireApproval': false,
  'links.googleMeet': false,
  'sessions.teacherDefined': false,
  'notes.enabled': false,
  'fees.enabled': false,
  'calendar.enabled': false,
  'whatsapp.broadcast': false,
  'whatsapp.advanced': false,
  'payments.daraja': false,
};

const TTL_MS = 30_000;

let cache = null;
let cachedAt = 0;

export async function getFlags() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;

  try {
    const snap = await getDb().collection('config').doc('flags').get();
    const remote = snap.exists ? snap.data() : {};
    const resolved = { ...DEFAULT_FLAGS };

    for (const key of Object.keys(DEFAULT_FLAGS)) {
      if (typeof remote[key] === 'boolean') resolved[key] = remote[key];
    }

    cache = resolved;
    cachedAt = now;
    return resolved;
  } catch {
    // Fall back to defaults (all gated features off) rather than failing the
    // request. Defaults are the conservative direction in every case.
    return cache ?? { ...DEFAULT_FLAGS };
  }
}

export async function isEnabled(key) {
  const flags = await getFlags();
  return flags[key] === true;
}

export { DEFAULT_FLAGS };
