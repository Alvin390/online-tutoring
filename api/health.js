import { createHandler } from './_lib/handler.js';
import { getDb } from './_lib/firebaseAdmin.js';
import { loadServiceAccount } from './_lib/googleAuth.js';

/**
 * Liveness probe — Phase 01 D4.
 *
 * Deliberately unauthenticated so uptime monitoring can reach it, and
 * deliberately uninformative: it reports whether the process can reach
 * Firestore and nothing else. No version, no project ID, no config echo — a
 * health endpoint is the most-scanned path on any deployment.
 *
 * The `warm` flag distinguishes a reused container from a cold start, which is
 * how we verify the Admin SDK singleton is doing its job.
 *
 * `credentials` was added in Phase 12, after a Cloudflare deployment whose
 * secrets had not been uploaded reported nothing but `firestore: unreachable`.
 * That single word covers three very different situations — no credential, a
 * malformed one, and a genuine network or permission failure — and the first
 * two are overwhelmingly the likely answer on a fresh deploy. Distinguishing
 * them is the difference between one curl and an afternoon.
 *
 * It stays COARSE on purpose: three fixed words, never the names of the
 * variables involved and never any part of a value. "The operator forgot to
 * upload their secrets" is not a fact worth hiding from a scanner — the
 * endpoint already announces that Firestore is unreachable — but an enumerable
 * list of what this deployment expects to be configured would be.
 */

let firstInvocationAt = null;

/**
 * Whether a usable service account is present, without making a network call.
 *
 * `missing` and `invalid` are separated because they have different fixes: one
 * is an unset variable, the other is a value that arrived mangled (truncated
 * on paste, base64 of the wrong thing, newlines eaten by a dashboard field).
 */
function credentialState() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return 'emulator';
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return 'missing';
  try {
    loadServiceAccount();
    return 'ok';
  } catch {
    return 'invalid';
  }
}

export default createHandler({
  method: 'GET',
  handle: async () => {
    const wasWarm = firstInvocationAt !== null;
    if (!firstInvocationAt) firstInvocationAt = Date.now();

    const credentials = credentialState();

    let firestore = 'unknown';
    try {
      // Cheapest possible round trip that proves credentials and connectivity.
      await getDb().collection('config').doc('flags').get();
      firestore = 'ok';
    } catch {
      firestore = 'unreachable';
    }

    return {
      status: firestore === 'ok' ? 'ok' : 'degraded',
      firestore,
      credentials,
      warm: wasWarm,
      uptimeMs: Date.now() - firstInvocationAt,
    };
  },
});
