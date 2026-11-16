import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { sha256 } from '../_lib/crypto.js';
import { enforceRateLimit, clientIp } from '../_lib/rateLimit.js';
import { ApiError, notFound } from '../_lib/errors.js';
import { recordNumber } from '../_lib/admissionNumber.js';
import { issueCode, CODE_TTL_SECONDS, RESEND_WAIT_SECONDS, CODES_PER_HOUR, codeMessage } from '../_lib/otpIssue.js';
import { getFlags } from '../_lib/flags.js';
import { retiredMessage } from '../_lib/duplicates.js';

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
 *
 * 009Fixes / 01 - code-first registration (owner, 2026-11-16): with admission
 * numbers and `student.fixNumber` on, `purpose: 'register'` asks for a code
 * for a number with NO record yet, so the phone is confirmed before the
 * registration is saved. A number already registered (or retired by the
 * teacher) is refused before any SMS. With the flag off that kind does not
 * exist: the answer is the usual "No registration found".
 */

// 009Fixes / 02: issuing moved to api/_lib/otpIssue.js (shared with fixNumber).
export { CODE_TTL_SECONDS, RESEND_WAIT_SECONDS, CODES_PER_HOUR, codeMessage };

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    purpose: z.enum(['register']).optional(),
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist and be shown to students.
  sessions: 'active',
  method: 'POST',
  schema,
  // 008Fixes / 01: 10 → 120 an hour. A class behind one carrier address.
  rateLimit: { bucket: 'otp_request_ip', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, req, log, waitUntil }) => {
    const { session, phone } = body;
    const db = getDb();
    const otpRef = db.collection('otp').doc(sha256(phone));
    const studentRef = db.doc(`sessions/${session}/students/${phone}`);
    const flags = body.purpose ? await getFlags() : null;
    const forRegistration = body.purpose === 'register'
      && flags['checkin.admissionNumbers'] === true && flags['student.fixNumber'] === true;

    // The record and the live code in one round trip, beside the limiter.
    const [[studentSnap, otpSnap, retiredSnap]] = await Promise.all([
      db.getAll(studentRef, otpRef, ...(forRegistration ? [db.doc(`sessions/${session}/retiredNumbers/${phone}`)] : [])),
      // Second limiter on the phone itself: the SMS cost bound, whatever the
      // address. Rotating addresses cannot pump codes at one number.
      enforceRateLimit({ key: phone, bucket: 'otp_request_phone', limit: CODES_PER_HOUR, windowSeconds: 3600 }),
    ]);

    if (forRegistration) {
      // 009Fixes / 01: a register-kind code goes to a number with no record,
      // so it gets registration's own address limit (30 an hour), not the
      // 120 a class at check-in time needs: SMS can't be pumped at strangers.
      // Its own bucket, so the code and the save don't share registration's 30.
      await enforceRateLimit({ key: clientIp(req), bucket: 'otp_register_ip', limit: 30, windowSeconds: 3600 });
      // 009Fixes / 01: registering - the number must be new here. The same
      // answers registration itself gives, so nothing new is revealed.
      if (studentSnap.exists) throw new ApiError(409, 'already_registered', 'That number is already registered for this class. Check in instead.');
      if (retiredSnap?.exists) {
        const retired = retiredSnap.data();
        throw new ApiError(409, 'retired_number', retiredMessage(retired.reason, retired.keptSuffix));
      }
    } else {
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
    }

    return issueCode({ otpRef, otpSnap, session, phone, purpose: forRegistration ? 'register' : null, log, waitUntil });
  },
});
