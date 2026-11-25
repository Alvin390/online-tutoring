import { FieldValue } from './firebaseAdmin.js';
import { randomNumericCode, sha256, encrypt, decrypt } from './crypto.js';
import { ApiError, tooManyRequests } from './errors.js';
import { tryWriteAudit, AuditAction } from './audit.js';
import { sendSms, smsAvailable, smsFake, recordSmsBalance } from './sms.js';

/**
 * Issuing a one-time code — shared by POST /api/student/requestCode and
 * (009Fixes / 02) POST /api/student/fixNumber. Moved here unchanged from
 * requestCode (008Fixes / 01):
 *   - a NEW code each time, replacing the old one; 60 s between requests for
 *     one number (the callers enforce the 6-an-hour limit beside their reads);
 *   - stored as a salted hash, plus ONE copy encrypted for the teacher's
 *     "Codes waiting" (both expire in 10 minutes);
 *   - sent by SMS through HashBack; if SMS can't go, the teacher reads it;
 *   - the reply says which channel was used and never contains the code
 *     (except EXPOSE_DEV_OTP=true, for local end-to-end tests only).
 * 010Fixes / 02 (owner, 2026-11-16): ONE code at a time. While a code is still
 * good (unused, under 5 wrong tries, more than 2 minutes left, same kind,
 * session and — for a move — same record), "Send again" or reopening the code
 * step sends THAT code again, so every SMS the student has works. A new code
 * only when there is none to reuse. It keeps its first expiry.
 * `purpose` says which kind of code it is: null (confirm a record),
 * 'register' (009Fixes / 01) or 'move' (009Fixes / 02); the kinds are not
 * interchangeable. `extra` adds fields to the stored code (e.g. fromPhone).
 */

export const CODE_TTL_SECONDS = 10 * 60;
export const RESEND_WAIT_SECONDS = 60;
export const CODES_PER_HOUR = 6;
export const MAX_VERIFY_ATTEMPTS = 5;
export const MIN_REUSE_MS = 2 * 60 * 1000;

/** 010Fixes / 03: the hourly cap per number, in words the student can act on. */
export const tooManyCodes = (retryAfter) => {
  const err = new ApiError(429, 'too_many_codes', 'Too many codes for this number this hour. Ask your teacher to read you your code.');
  err.retryAfter = retryAfter;
  return err;
};
/** 010Fixes / 03: a code locked by wrong tries. */
export const tooManyTries = () => new ApiError(400, 'too_many_tries',
  'Too many wrong tries. Tap Send again for a new code, or ask your teacher to read you your code.');

/** The live code to send again, or null (010Fixes / 02). */
function reusableCode(previous, { session, phone, purpose, extra, now }) {
  if (!previous || previous.consumedAt || !previous.codeForStaff) return null;
  if (previous.phone !== phone || previous.session !== session) return null;
  if ((previous.purpose ?? null) !== (purpose ?? null)) return null;
  if (extra.fromPhone !== undefined && previous.fromPhone !== extra.fromPhone) return null;
  if ((previous.attempts ?? 0) >= (previous.maxAttempts ?? MAX_VERIFY_ATTEMPTS)) return null;
  const expiresMs = previous.expiresAt?.toMillis?.() ?? 0;
  if (expiresMs - now < MIN_REUSE_MS) return null;
  try { return decrypt(previous.codeForStaff); } catch { return null; }
}

export const codeMessage = (code) => `Your code is ${code}. It expires in 10 minutes. Do not share it.`;

export async function issueCode({ otpRef, otpSnap, session, phone, purpose = null, extra = {}, log, waitUntil }) {
  const now = Date.now();
  const previous = otpSnap?.exists ? otpSnap.data() : null;
  const lastMs = previous?.sentAt?.toMillis?.() ?? previous?.createdAt?.toMillis?.() ?? 0;
  if (previous && !previous.consumedAt && now - lastMs < RESEND_WAIT_SECONDS * 1000) {
    const wait = Math.max(1, Math.ceil((lastMs + RESEND_WAIT_SECONDS * 1000 - now) / 1000));
    throw tooManyRequests(`Please wait ${wait} seconds before asking for another code.`, wait);
  }

  const reused = reusableCode(previous, { session, phone, purpose, extra, now });
  const code = reused ?? randomNumericCode(6);
  if (reused) {
    await otpRef.set({ sentAt: new Date(now), resends: FieldValue.increment(1) }, { merge: true });
  } else {
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
      purpose,
      ...extra,
    });
  }

  // Delivery. A failure never loses the code: the teacher can read it.
  let deliveryChannel = 'teacher';
  // 013Fixes / 33b: on fake SMS a real student would wait for a code that
  // never comes — the teacher reads it out, as when SMS is unavailable.
  if (smsAvailable() && !smsFake()) {
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
      after: { channel: deliveryChannel, ...(purpose ? { purpose } : {}), ...(reused ? { resent: true } : {}) }, context: { requestId: log.requestId } },
    log
  ));
  log.info('OTP issued', { session, ttlSeconds: CODE_TTL_SECONDS, channel: deliveryChannel, purpose, resent: Boolean(reused) });

  // FAIL CLOSED — Phase 12: the code comes back only with an explicit
  // opt-in, for local end-to-end tests. An unset or misspelt variable
  // withholds it.
  // eslint-disable-next-line no-undef
  const exposeCode = process.env.EXPOSE_DEV_OTP === 'true';

  return {
    ok: true,
    expiresInSeconds: CODE_TTL_SECONDS,
    retryAfterSeconds: RESEND_WAIT_SECONDS,
    deliveryChannel,
    ...(exposeCode ? { devCode: code } : {}),
  };
}
