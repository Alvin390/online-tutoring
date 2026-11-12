import { apiGet, apiPost } from './client';

/**
 * Public, unauthenticated calls — Phase 13 / 08 A1. Nothing here imports
 * Firebase; these are what the homepage and class pages use.
 */

let bootstrapPromise = null;
let bootstrapAt = 0;
const BOOTSTRAP_TTL_MS = 60_000;

/**
 * The last good bootstrap, saved on this device — 007Fixes / 02.
 *
 * On 10 Nov a student's phone waited 15 s for this call at class start and got
 * nothing; a custom session would then have shown "not found", and the flags
 * (approval on) would have read as the defaults. Now, when the network fails,
 * the copy from the last visit is used instead.
 *
 * Public data only — the same flags and active sessions the endpoint serves to
 * anyone. Never a token (the client's token policy). Storage can throw
 * (private windows, a full disk, Sentry ONLINE-TUTORING-1-D): every access is
 * wrapped, and failing simply means there is no copy.
 */
const COPY_KEY = 'ot.bootstrap.v1';
const COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function saveCopy(data) {
  try {
    if (!data || typeof data !== 'object') return;
    const copy = {
      savedAt: Date.now(),
      flags: data.flags && typeof data.flags === 'object' ? data.flags : {},
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
    };
    localStorage.setItem(COPY_KEY, JSON.stringify(copy));
  } catch {
    // No copy this time.
  }
}

function readCopy() {
  try {
    const copy = JSON.parse(localStorage.getItem(COPY_KEY) ?? 'null');
    if (!copy || typeof copy.savedAt !== 'number' || Date.now() - copy.savedAt > COPY_MAX_AGE_MS) return null;
    return {
      flags: copy.flags && typeof copy.flags === 'object' ? copy.flags : {},
      sessions: Array.isArray(copy.sessions) ? copy.sessions : [],
      fromCache: true,
    };
  } catch {
    return null;
  }
}

/**
 * Flags + active sessions, shared by every caller on the page. The server
 * sends `Cache-Control: max-age=60`; this de-duplicates the in-flight request
 * as well, so the flags provider and the session list cost one round trip.
 *
 * 007Fixes / 02: one quiet retry (a GET, safe to repeat), then the saved copy.
 */
export function getPublicBootstrap({ force = false } = {}) {
  if (force || !bootstrapPromise || Date.now() - bootstrapAt > BOOTSTRAP_TTL_MS) {
    bootstrapAt = Date.now();
    bootstrapPromise = apiGet('/api/public/bootstrap', { retry: 1 })
      .then((data) => {
        saveCopy(data);
        return data;
      })
      .catch((err) => {
        bootstrapPromise = null; // a failure is not cached: the next caller asks again
        const copy = readCopy();
        if (copy) return copy;
        throw err;
      });
  }
  return bootstrapPromise;
}

/** For tests. */
export function __resetPublicBootstrap() {
  bootstrapPromise = null;
  bootstrapAt = 0;
  try { localStorage.removeItem(COPY_KEY); } catch { /* none */ }
}

/** Student registration (server-side since A1). Returns { ok, student }. */
export const registerStudentApi = ({ session, phone, studentName, class: className, subjects, receiptMessage }) =>
  apiPost('/api/student/register', { session, phone, studentName, class: className, subjects, receiptMessage });
