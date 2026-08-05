import { createHandler } from './_lib/handler.js';
import { getDb } from './_lib/firebaseAdmin.js';

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
 */

let firstInvocationAt = null;

export default createHandler({
  method: 'GET',
  handle: async () => {
    const wasWarm = firstInvocationAt !== null;
    if (!firstInvocationAt) firstInvocationAt = Date.now();

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
      warm: wasWarm,
      uptimeMs: Date.now() - firstInvocationAt,
    };
  },
});
