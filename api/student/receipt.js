import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema, receiptSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';

/**
 * Payment receipt resubmission by a blocked student — Phase 01 D4.
 *
 * Moved off the client for the same reason as check-in: the old rule allowed an
 * unauthenticated write of three fields to any student document whose phone
 * number you could guess. Anyone could overwrite any blocked student's pending
 * receipt.
 *
 * Three invariants enforced here that a rule alone could not:
 *   - the target document must exist (a rule cannot cheaply require this on a
 *     merge write)
 *   - only a genuinely blocked student may submit
 *   - receiptStatus can only ever be set to 'pending' — a student cannot
 *     approve their own payment
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    receiptMessage: receiptSchema,
  })
  .strict();

export default createHandler({
  method: 'POST',
  rateLimit: {
    bucket: 'student_receipt',
    limit: 5,
    windowSeconds: 3600,
    keyBy: 'ip',
  },
  schema,
  handle: async ({ body, req, log }) => {
    const { session, phone, receiptMessage } = body;

    let authorized = false;
    try {
      const user = await authenticate(req);
      if (user.role === 'student' && user.phone === phone) authorized = true;
    } catch {
      // Fall through to the legacy path.
    }

    if (!authorized && !(await isEnabled('auth.legacyStudentRead'))) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
    }

    if (!authorized) {
      const { enforceRateLimit } = await import('../_lib/rateLimit.js');
      await enforceRateLimit({
        key: phone,
        bucket: 'student_receipt_phone',
        limit: 5,
        windowSeconds: 3600,
      });
    }

    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw notFound('No registration found for that number.');

      const data = snap.data();
      if (data.blocked !== true) {
        // Nothing to resubmit against. Refusing keeps the receipt queue from
        // filling with submissions the teacher has no reason to review.
        throw forbidden('You are not currently blocked, so no receipt is needed.', 'not_blocked');
      }

      tx.set(
        ref,
        {
          pendingReceipt: receiptMessage,
          receiptStatus: 'pending',
          receiptSubmittedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { ok: true };
    });

    log.info('Receipt resubmitted', { session });
    return { ...result, receiptStatus: 'pending' };
  },
});
