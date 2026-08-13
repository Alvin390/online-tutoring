import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { randomNumericCode, sha256 } from '../_lib/crypto.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { notFound } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Student phone verification, step 1 — Phase 02 D4.
 *
 * Phone + OTP, no password. Chosen over Firebase Phone Auth because Phone Auth
 * bills per SMS and you have been explicit about cost.
 *
 * DELIVERY IS THE HARD PART, and the honest answer is that there is no
 * zero-cost automatic channel:
 *
 *   - WhatsApp click-to-chat cannot deliver an OTP. `wa.me` requires the SENDER
 *     to press send, and the sender here would be the teacher. A code the
 *     teacher must forward by hand is not an OTP.
 *   - SMS costs money (Africa's Talking, ~KES 0.80/message). Implemented behind
 *     the same interface but disabled by default.
 *
 * So the default channel is the dashboard: the teacher sees pending codes and
 * reads them to the student. That is workable at one-teacher scale and costs
 * nothing, which is the trade you asked for.
 *
 * The code is stored ONLY as a SHA-256 hash with a 10-minute TTL. A leaked
 * database read must not yield live codes.
 */

const CODE_TTL_SECONDS = 10 * 60;
const MAX_VERIFY_ATTEMPTS = 5;

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
  })
  .strict();

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'otp_request_ip', limit: 10, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log }) => {
    const { session, phone } = body;

    // Second limiter on the phone itself: 3 per hour. Without it, an attacker
    // rotating IPs could pump codes at one number until a collision.
    await enforceRateLimit({
      key: phone,
      bucket: 'otp_request_phone',
      limit: 3,
      windowSeconds: 3600,
    });

    const db = getDb();
    const studentSnap = await db.doc(`sessions/${session}/students/${phone}`).get();

    if (!studentSnap.exists) {
      // Same shape and cost as the success path — this must not become a
      // registration oracle.
      throw notFound('No registration found for that number.');
    }

    const code = randomNumericCode(6);
    const now = Date.now();

    await db.collection('otp').doc(sha256(phone)).set({
      // The code itself is never stored. Salted with the phone so two students
      // who happen to draw the same code do not produce the same hash.
      codeHash: sha256(`${phone}:${code}`),
      phone,
      session,
      attempts: 0,
      maxAttempts: MAX_VERIFY_ATTEMPTS,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now + CODE_TTL_SECONDS * 1000),
      consumedAt: null,
    });

    await tryWriteAudit(
      { action: AuditAction.OTP_ISSUED, actor: 'student', target: `${session}/${phone}`,
        context: { requestId: log.requestId } },
      log
    );

    log.info('OTP issued', { session, ttlSeconds: CODE_TTL_SECONDS });

    // The code is returned to the caller ONLY when explicitly opted in, so the
    // flow is testable end to end without an SMS provider. Normally it reaches
    // the student through the teacher's dashboard.
    //
    // FAIL CLOSED — Phase 12. This used to read `VERCEL_ENV === 'production'`,
    // which was safe on Vercel but would have been a live vulnerability on
    // Cloudflare: VERCEL_ENV does not exist there, so the check would evaluate
    // false in production and hand the one-time code straight back to whoever
    // requested it — defeating phone verification entirely. Requiring an
    // explicit opt-in means an unset or misspelt variable withholds the code
    // rather than exposing it.
    const exposeCode = process.env.EXPOSE_DEV_OTP === 'true';

    return {
      ok: true,
      expiresInSeconds: CODE_TTL_SECONDS,
      deliveryChannel: 'teacher_dashboard',
      ...(exposeCode ? { devCode: code } : {}),
    };
  },
});
