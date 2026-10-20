import { apiGet, apiPost } from './client';

/**
 * Public, unauthenticated calls — Phase 13 / 08 A1. Nothing here imports
 * Firebase; these are what the homepage and class pages use.
 */

let bootstrapPromise = null;
let bootstrapAt = 0;
const BOOTSTRAP_TTL_MS = 60_000;

/**
 * Flags + active sessions, shared by every caller on the page. The server
 * sends `Cache-Control: max-age=60`; this de-duplicates the in-flight request
 * as well, so the flags provider and the session list cost one round trip.
 */
export function getPublicBootstrap({ force = false } = {}) {
  if (force || !bootstrapPromise || Date.now() - bootstrapAt > BOOTSTRAP_TTL_MS) {
    bootstrapAt = Date.now();
    bootstrapPromise = apiGet('/api/public/bootstrap').catch((err) => {
      bootstrapPromise = null; // a failure is not cached
      throw err;
    });
  }
  return bootstrapPromise;
}

/** For tests. */
export function __resetPublicBootstrap() {
  bootstrapPromise = null;
  bootstrapAt = 0;
}

/** Student registration (server-side since A1). Returns { ok, student }. */
export const registerStudentApi = ({ session, phone, studentName, class: className, subjects, receiptMessage }) =>
  apiPost('/api/student/register', { session, phone, studentName, class: className, subjects, receiptMessage });
