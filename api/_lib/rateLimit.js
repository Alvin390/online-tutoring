import { createHash } from 'node:crypto';
import { getDb, FieldValue } from './firebaseAdmin.js';
import { tooManyRequests } from './errors.js';

/**
 * Firestore-backed fixed-window rate limiter — Phase 01 D4.
 *
 * Fixed window rather than sliding: a sliding window needs either a sorted set
 * or a per-hit document, and both cost more reads than the abuse they prevent
 * on a single-tenant deployment. The worst case of a fixed window is 2x the
 * limit across a window boundary, which is acceptable for every endpoint here.
 *
 * The counter document ID is a SHA-256 of the caller key, because the key is
 * usually a phone number or an IP address and document IDs are visible in
 * console listings, index entries and error messages. The limiter must not
 * itself become the PII leak.
 *
 * Counters live under `rateLimits/`, which is `allow read, write: if false` —
 * a client that could write there could erase its own limit.
 */

const COLLECTION = 'rateLimits';

function hashKey(key) {
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 40);
}

/**
 * @param {object}  opts
 * @param {string}  opts.key            caller identity (ip, phone, uid, email)
 * @param {string}  opts.bucket         endpoint name, keeps buckets independent
 * @param {number}  opts.limit          max requests per window
 * @param {number}  opts.windowSeconds  window length
 * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number}>}
 */
export async function checkRateLimit({ key, bucket, limit, windowSeconds }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;

  try {
    // INSIDE the try, deliberately. `getDb()` is not just a getter: it resolves
    // the project id, which reads and parses FIREBASE_SERVICE_ACCOUNT and
    // throws if that variable is absent or malformed. Constructed outside, a
    // credential misconfiguration escaped this function entirely and surfaced
    // as an opaque 500 on every rate-limited endpoint — defeating the
    // fail-open contract below in exactly the case it is most needed, and
    // making a missing secret look like a code fault. Phase 12.
    const db = getDb();

    // The window start is part of the document ID, so a new window is a new
    // document and there is nothing to reset. Old windows are swept by TTL.
    const docId = `${bucket}_${hashKey(key)}_${windowStart}`;
    const ref = db.collection(COLLECTION).doc(docId);

    const count = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data().count ?? 0) : 0;
      const next = current + 1;

      if (next > limit) return next;

      tx.set(
        ref,
        {
          count: FieldValue.increment(1),
          bucket,
          windowStart: new Date(windowStart),
          // Firestore TTL policy on `expiresAt` reaps these. Configure the
          // policy once per project — see appendix C.
          expiresAt: new Date(windowStart + windowMs * 2),
        },
        { merge: true }
      );

      return next;
    });

    const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter,
    };
  } catch {
    // Fail OPEN on limiter infrastructure failure. A Firestore outage must not
    // take down login and check-in; the limiter is a mitigation, not the
    // primary control (auth and rules are). Fail-closed here would convert a
    // partial outage into a total one.
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

/** Throwing wrapper, for use inside the handler middleware chain. */
export async function enforceRateLimit(opts) {
  const result = await checkRateLimit(opts);
  if (!result.allowed) {
    throw tooManyRequests(
      'Too many requests. Please wait a moment and try again.',
      result.retryAfter
    );
  }
  return result;
}

/**
 * The caller's IP address.
 *
 * `CF-Connecting-IP` comes FIRST, and that ordering is the security-relevant
 * part — Phase 12.
 *
 * Cloudflare sets this header at the edge and strips any client-supplied copy,
 * so it cannot be spoofed. `X-Forwarded-For` can be: a client may send one, and
 * on Cloudflare the value is *appended to*, so trusting its leftmost entry
 * hands the caller control of what we record. Preferring the platform header
 * turns a best-effort signal into a trustworthy one.
 *
 * This is not merely about rate limiting. Two allowlists depend on it:
 *
 *   - api/daraja/callback/[secret].js — M-Pesa callbacks are UNSIGNED, so the
 *     IP allowlist is the primary control on an endpoint that credits real
 *     money to a student's account.
 *   - api/billing/webhook.js — the Paystack IP check behind the HMAC.
 *
 * Reading `x-forwarded-for` alone would return 'unknown' in a Worker (there is
 * no `req.socket`), which both allowlists would then reject — failing closed,
 * but breaking every real payment callback.
 *
 * The `x-forwarded-for` and socket fallbacks are kept so the function still
 * behaves under `wrangler dev`, in the emulator suites, and if this ever runs
 * behind a different proxy.
 */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'] ?? req.headers['CF-Connecting-IP'];
  if (typeof cf === 'string' && cf.length > 0) return cf.trim();

  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]).trim();

  return req.socket?.remoteAddress ?? 'unknown';
}

export { hashKey };
