import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { sha256 } from '../_lib/crypto.js';
import { tooManyRequests } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Login brute-force protection — Phase 02 D3.
 *
 * Firebase Auth has its own throttling, but it is not tunable and not
 * observable: we cannot see the counter, set the threshold, or audit a lockout.
 * This adds a counter we control on top of it.
 *
 * Policy: 5 failures in 15 minutes locks for 15 minutes, doubling on each
 * subsequent lockout to a 4-hour ceiling. Counted per email AND per IP, so
 * neither a single account nor a single source can be ground down.
 *
 * The email is stored only as a SHA-256 hash. A lockout table keyed by
 * plaintext email is an account-enumeration oracle for anyone who gains read
 * access to it — and the whole point of this phase is to stop trusting that
 * nobody will.
 *
 * Called by the client around its own sign-in attempt. That is not a security
 * boundary — a scripted attacker will not call `record` — which is why the
 * `check` half is enforced server-side at every endpoint that matters, and why
 * Firebase's own throttling stays in place underneath.
 */

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;
const BASE_LOCKOUT_SECONDS = 15 * 60;
const MAX_LOCKOUT_SECONDS = 4 * 60 * 60;

const schema = z
  .object({
    email: z.string().trim().email().max(320),
    outcome: z.enum(['failure', 'success']),
  })
  .strict();

function lockoutSeconds(lockoutCount) {
  return Math.min(BASE_LOCKOUT_SECONDS * 2 ** Math.max(0, lockoutCount - 1), MAX_LOCKOUT_SECONDS);
}

async function readState(db, docId) {
  const snap = await db.collection('loginAttempts').doc(docId).get();
  return snap.exists ? snap.data() : null;
}

/** Shared by this handler and by any endpoint that wants to refuse a locked account. */
export async function assertNotLocked(db, keys) {
  const now = Date.now();

  for (const key of keys) {
    const state = await readState(db, key);
    const lockedUntil = state?.lockedUntil?.toMillis?.() ?? 0;

    if (lockedUntil > now) {
      const retryAfter = Math.ceil((lockedUntil - now) / 1000);
      throw tooManyRequests(
        `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        retryAfter
      );
    }
  }
}

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'login_attempt', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, ip, log }) => {
    const db = getDb();
    const emailKey = `email_${sha256(body.email.toLowerCase())}`;
    const ipKey = `ip_${sha256(ip)}`;

    // A successful sign-in clears the counters — the account is demonstrably
    // not under a successful attack from this source.
    if (body.outcome === 'success') {
      await Promise.all([
        db.collection('loginAttempts').doc(emailKey).delete(),
        db.collection('loginAttempts').doc(ipKey).delete(),
      ]);
      return { ok: true, locked: false };
    }

    const now = Date.now();
    const windowMs = WINDOW_SECONDS * 1000;
    let lockedResult = null;

    for (const key of [emailKey, ipKey]) {
      const ref = db.collection('loginAttempts').doc(key);

      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const state = snap.exists ? snap.data() : {};

        const windowStart = state.windowStart?.toMillis?.() ?? 0;
        const withinWindow = now - windowStart < windowMs;

        const failures = withinWindow ? (state.failures ?? 0) + 1 : 1;
        const lockoutCount = state.lockoutCount ?? 0;

        if (failures >= MAX_FAILURES) {
          const nextLockoutCount = lockoutCount + 1;
          const seconds = lockoutSeconds(nextLockoutCount);

          tx.set(ref, {
            failures: 0,
            windowStart: new Date(now),
            lockoutCount: nextLockoutCount,
            lockedUntil: new Date(now + seconds * 1000),
            expiresAt: new Date(now + Math.max(seconds, WINDOW_SECONDS) * 1000 + windowMs),
            updatedAt: FieldValue.serverTimestamp(),
          });

          return { locked: true, retryAfter: seconds };
        }

        tx.set(ref, {
          failures,
          windowStart: withinWindow ? state.windowStart ?? new Date(now) : new Date(now),
          lockoutCount,
          lockedUntil: null,
          expiresAt: new Date(now + windowMs * 2),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { locked: false, remaining: MAX_FAILURES - failures };
      });

      if (outcome.locked) lockedResult = outcome;
    }

    if (lockedResult) {
      log.warn('Account locked after repeated failures', { retryAfter: lockedResult.retryAfter });

      await tryWriteAudit(
        {
          action: AuditAction.LOGIN_LOCKED,
          actor: 'anonymous',
          target: emailKey,
          context: { retryAfterSeconds: lockedResult.retryAfter, requestId: log.requestId },
        },
        log
      );

      // Deliberately does NOT say whether the address exists. The message is
      // the same for a locked real account and a locked nonexistent one.
      throw tooManyRequests(
        `Too many failed sign-in attempts. Try again in ${Math.ceil(lockedResult.retryAfter / 60)} minute(s).`,
        lockedResult.retryAfter
      );
    }

    return { ok: true, locked: false };
  },
});
