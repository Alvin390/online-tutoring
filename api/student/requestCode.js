import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { randomNumericCode, sha256, encrypt } from '../_lib/crypto.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { ApiError, notFound, tooManyRequests } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { recordNumber } from '../_lib/admissionNumber.js';
import { sendSms, smsAvailable, recordSmsBalance } from '../_lib/sms.js';

/**
 * Student phone verification, step 1 — Phase 02 D4, delivered by SMS since
 * 008Fixes / 01 (owner, 2026-11-14).
 *
 * The code goes to the registration's phone by SMS through HashBack (KES 0.35).
 * When SMS can't be sent — no key, no credit, the provider down — the code is
 * still issued, and the teacher reads it out from her dashboard
 * (POST /api/students/admission `codes`, owner answer 3). The reply says which
 * channel was used and never contains the code.
 *
 * Every request issues a NEW code and replaces the old one, so a code that
 * arrives late after "Send again" no longer works (owner answer 3). Requests
 * for one number are 60 seconds apart, and at most CODES_PER_HOUR an hour —
 * the cost bound. The per-address limit is sized for a whole class behind one
 * carrier address (one address sent 34 check-ins in an hour on 26 Oct).
 *
 * The code is stored as a salted SHA-256 hash, plus ONE copy encrypted with
 * APP_ENCRYPTION_KEY that only the teacher's endpoint decrypts. Both expire in
 * 10 minutes; the student endpoints never return either.
 */

export const CODE_TTL_SECONDS = 10 * 60;
export const RESEND_WAIT_SECONDS = 60;
export const CODES_PER_HOUR = 6;
const MAX_VERIFY_ATTEMPTS = 5;

export const codeMessage = (code) => `Your code is ${code}. It expires in 10 minutes. Do not share it.`;

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist and be shown to students.
  sessions: 'active',
  method: 'POST',
  schema,
  // 008Fixes / 01: 10 → 120 an hour. A class behind one carrier address.
  rateLimit: { bucket: 'otp_request_ip', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log, waitUntil }) => {
    const { session, phone } = body;
    const db = getDb();
    const otpRef = db.collection('otp').doc(sha256(phone));
    const studentRef = db.doc(`sessions/${session}/students/${phone}`);

    // The record and the live code in one round trip, beside the limiter.
    const [[studentSnap, otpSnap]] = await Promise.all([
      db.getAll(studentRef, otpRef),
      // Second limiter on the phone itself: the SMS cost bound, whatever the
      // address. Rotating addresses cannot pump codes at one number.
      enforceRateLimit({ key: phone, bucket: 'otp_request_phone', limit: CODES_PER_HOUR, windowSeconds: 3600 }),
    ]);

    if (!studentSnap.exists) {
      // Same shape as before — this must not become a registration oracle.
      throw notFound('No registration found for that number.');
    }
    // Confirmed once is enough: no repeated SMS cost. A confirmed record that
    // has not chosen its number yet (the page was closed in between) may ask
    // again — choosing needs the ticket a confirmed code gives.
    const record = studentSnap.data();
    if (record.phoneVerifiedAt && recordNumber(record)) {
      throw new ApiError(409, 'already_verified', 'Your phone is already confirmed. Check in with your admission number and phone.');
    }

    const now = Date.now();
    const previous = otpSnap.exists ? otpSnap.data() : null;
    const lastMs = previous?.sentAt?.toMillis?.() ?? previous?.createdAt?.toMillis?.() ?? 0;
    if (previous && !previous.consumedAt && now - lastMs < RESEND_WAIT_SECONDS * 1000) {
      const wait = Math.max(1, Math.ceil((lastMs + RESEND_WAIT_SECONDS * 1000 - now) / 1000));
      throw tooManyRequests(`Please wait ${wait} seconds before asking for another code.`, wait);
    }

    const code = randomNumericCode(6);
    await otpRef.set({
      // Salted with the phone so two students who draw the same code do not
      // produce the same hash.
      codeHash: sha256(`${phone}:${code}`),
      // 008Fixes / 01: the teacher's copy (answer 3). Only her endpoint decrypts it.
      codeForStaff: encrypt(code),
      phone,
      session,
      attempts: 0,
      maxAttempts: MAX_VERIFY_ATTEMPTS,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: new Date(now),
      expiresAt: new Date(now + CODE_TTL_SECONDS * 1000),
      consumedAt: null,
    });

    // Delivery. A failure never loses the code: the teacher can read it.
    let deliveryChannel = 'teacher';
    if (smsAvailable()) {
      try {
        const sent = await sendSms({ to: phone, message: codeMessage(code) });
        deliveryChannel = 'sms';
        // Off the response path: the cost tracker's figure, never the student's wait.
        waitUntil(recordSmsBalance(sent.balance, { log }));
      } catch (err) {
        log.warn('Code SMS not sent; the teacher can read it', { code: err?.code, status: err?.status });
      }
    }
    waitUntil(tryWriteAudit(
      { action: AuditAction.OTP_ISSUED, actor: 'student', target: `${session}/${phone}`,
        after: { channel: deliveryChannel }, context: { requestId: log.requestId } },
      log
    ));
    log.info('OTP issued', { session, ttlSeconds: CODE_TTL_SECONDS, channel: deliveryChannel });

    // FAIL CLOSED — Phase 12: the code comes back only with an explicit
    // opt-in, for local end-to-end tests. An unset or misspelt variable
    // withholds it.
    const exposeCode = process.env.EXPOSE_DEV_OTP === 'true';

    return {
      ok: true,
      expiresInSeconds: CODE_TTL_SECONDS,
      retryAfterSeconds: RESEND_WAIT_SECONDS,
      deliveryChannel,
      ...(exposeCode ? { devCode: code } : {}),
    };
  },
});
