import { createHandler } from '../_lib/handler.js';
import { getDb, getAdminAuth, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema, otpCodeSchema } from '../_lib/validate.js';
import { sha256, safeCompare } from '../_lib/crypto.js';
import { ApiError, badRequest, notFound } from '../_lib/errors.js';
import { getFlags } from '../_lib/flags.js';
import { issueTicket } from '../_lib/verifyTicket.js';
import { recordNumber } from '../_lib/admissionNumber.js';
import { setUserClaims } from '../_lib/claims.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Student phone verification, step 2 — Phase 02 D4.
 *
 * On success, mints a Firebase custom token carrying `role: 'student'` and
 * `phone: <E.164>`. That claim is what finally lets `firestore.rules` express
 * object-level permission:
 *
 *     allow get: if request.auth.token.phone == phone;
 *
 * which is the rule that replaced `allow read: if true`.
 *
 * Anti-brute-force: 5 attempts per issued code, then the code is burned. A
 * 6-digit code has a million values, so 5 guesses is a 1-in-200,000 chance —
 * and a fresh code requires passing the request-side limiter again.
 *
 * 008Fixes / 01: with `checkin.admissionNumbers` on, success returns a
 * short-lived verified-phone TICKET (api/_lib/verifyTicket.js) and what comes
 * next ('chooseNumber' or 'checkin'), and no Firebase identity is minted:
 * student pages load no Firebase, so the custom token was never usable there,
 * and minting costs several Identity Toolkit round trips per student at class
 * start. The code must have been issued for this session. The record is
 * stamped with an update, never a merge, so a deleted record is not recreated.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    code: otpCodeSchema,
    // 009Fixes / 01: a registration code (asked for before the record exists).
    purpose: z.enum(['register']).optional(),
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist and be shown to students.
  sessions: 'active',
  method: 'POST',
  schema,
  // 008Fixes / 01: 20 → 240 an hour — a class behind one carrier address.
  // The 5-attempt cap per code is the brute-force bound.
  rateLimit: { bucket: 'otp_verify_ip', limit: 240, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log }) => {
    const { session, phone, code } = body;
    const db = getDb();
    const ref = db.collection('otp').doc(sha256(phone));
    const studentRef = db.doc(`sessions/${session}/students/${phone}`);
    const flags = await getFlags();
    const numbersOn = flags['checkin.admissionNumbers'] === true;
    const forRegistration = body.purpose === 'register' && numbersOn && flags['student.fixNumber'] === true;

    const verified = await db.runTransaction(async (tx) => {
      // Both in one batchGet (the shim coalesces reads in the same tick).
      const [snap, studentSnap] = await Promise.all([tx.get(ref), tx.get(studentRef)]);

      // One generic failure for every rejection reason — no code, wrong code,
      // expired code, already used. Distinguishing them tells an attacker which
      // numbers have live codes.
      const reject = () => {
        throw badRequest('That code is not valid or has expired.', 'invalid_code');
      };

      if (!snap.exists) reject();

      const data = snap.data();
      const expiresAt = data.expiresAt?.toMillis?.() ?? 0;

      if (data.consumedAt) reject();
      if (expiresAt < Date.now()) reject();
      if ((data.attempts ?? 0) >= (data.maxAttempts ?? 5)) reject();
      if (data.phone !== phone) reject();
      // 008Fixes / 01: a code is for the registration it was asked for.
      if (numbersOn && data.session !== session) reject();
      // 009Fixes / 01: a registration code only registers, and a record's code
      // only confirms that record - the same generic answer either way.
      if (body.purpose === 'register' && !forRegistration) reject();
      if ((data.purpose === 'register') !== forRegistration) reject();

      const matches = safeCompare(sha256(`${phone}:${code}`), data.codeHash);

      if (!matches) {
        tx.update(ref, { attempts: FieldValue.increment(1) });
        // Committing the increment requires letting the transaction resolve, so
        // signal failure by value rather than by throwing here.
        return { ok: false };
      }

      // Single-use. Burned on success so a replayed request cannot mint a
      // second token.
      tx.update(ref, {
        consumedAt: FieldValue.serverTimestamp(),
        attempts: FieldValue.increment(1),
      });

      return { ok: true, record: studentSnap.exists ? studentSnap.data() : null };
    });

    if (!verified.ok) {
      throw badRequest('That code is not valid or has expired.', 'invalid_code');
    }

    if (forRegistration) {
      // 009Fixes / 01: confirmed before registering - a ticket for this number
      // in this session, which registration requires. Nothing is saved here.
      if (verified.record) throw new ApiError(409, 'already_registered', 'That number is already registered for this class. Check in instead.');
      await tryWriteAudit(
        { action: AuditAction.OTP_VERIFIED, actor: 'student', target: `${session}/${phone}`,
          after: { purpose: 'register' }, context: { requestId: log.requestId } },
        log
      );
      log.info('Phone confirmed for registration', { session });
      return { ok: true, ticket: issueTicket({ session, phone }), next: 'register' };
    }

    if (numbersOn) {
      if (!verified.record) throw notFound('No registration found for that number.');
      try {
        await studentRef.update({ phoneVerifiedAt: FieldValue.serverTimestamp() });
      } catch (err) {
        if (err?.code === 5 || err?.code === 'not-found') throw notFound('No registration found for that number.');
        throw err;
      }
      await tryWriteAudit(
        { action: AuditAction.OTP_VERIFIED, actor: 'student', target: `${session}/${phone}`,
          context: { requestId: log.requestId } },
        log
      );
      log.info('Student phone verified', { session });
      const record = verified.record;
      return {
        ok: true,
        ticket: issueTicket({ session, phone }),
        next: recordNumber(record) ? 'checkin' : 'chooseNumber',
        numberKind: record.staff === true ? 'staff' : 'student',
      };
    }

    // --- Mint the identity.
    const auth = getAdminAuth();
    // The phone is the stable identifier, so it is the uid. Deterministic, so a
    // student who verifies twice keeps one account rather than accumulating
    // orphans.
    const uid = `student_${sha256(phone).slice(0, 32)}`;

    try {
      await auth.getUser(uid);
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        await auth.createUser({ uid, displayName: 'Student' });
      } else {
        throw err;
      }
    }

    await setUserClaims(uid, { role: 'student', phone, tier: null });

    const customToken = await auth.createCustomToken(uid, { role: 'student', phone });

    // Stamp the student document so the teacher can see who has verified, and
    // so the legacy read path can eventually be switched off with confidence.
    await db.doc(`sessions/${session}/students/${phone}`).set(
      { studentUid: uid, phoneVerifiedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    await tryWriteAudit(
      { action: AuditAction.OTP_VERIFIED, actor: uid, target: `${session}/${phone}`,
        context: { requestId: log.requestId } },
      log
    );

    log.info('Student phone verified', { session });

    return { ok: true, customToken, uid };
  },
});
