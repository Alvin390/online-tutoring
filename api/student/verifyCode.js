import { createHandler } from '../_lib/handler.js';
import { getDb, getAdminAuth, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema, otpCodeSchema } from '../_lib/validate.js';
import { sha256, safeCompare } from '../_lib/crypto.js';
import { badRequest } from '../_lib/errors.js';
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
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    code: otpCodeSchema,
  })
  .strict();

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'otp_verify_ip', limit: 20, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log }) => {
    const { session, phone, code } = body;
    const db = getDb();
    const ref = db.collection('otp').doc(sha256(phone));

    const verified = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

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

      return { ok: true };
    });

    if (!verified.ok) {
      throw badRequest('That code is not valid or has expired.', 'invalid_code');
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
