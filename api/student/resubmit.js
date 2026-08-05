import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema, receiptSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

/**
 * Resubmission after a rejection — Phase 04 Part A.
 *
 * A rejected student corrects their details and re-enters the queue. Handled
 * server-side because the 3-strikes soft block has to be enforced somewhere the
 * student cannot reach, and because `firestore.rules` deliberately does not let
 * a student write `approvalStatus` at all — including back to 'pending', which
 * would otherwise be a way to spam the queue.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    studentName: z.string().trim().min(2).max(100),
    class: z.string().trim().min(1).max(60),
    subjects: z.string().trim().min(3).max(200),
    receiptMessage: receiptSchema,
  })
  .strict();

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'student_resubmit_ip', limit: 10, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, req, log }) => {
    const { session, phone, ...details } = body;

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

    await enforceRateLimit({
      key: phone,
      bucket: 'student_resubmit_phone',
      limit: 5,
      windowSeconds: 3600,
    });

    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw notFound('No registration found for that number.');

      const data = snap.data();

      if ((data.approvalStatus ?? 'approved') !== 'rejected') {
        throw forbidden(
          'There is nothing to resubmit — your registration is not in a rejected state.',
          'not_rejected'
        );
      }

      const blockedUntil = data.resubmitBlockedUntil?.toMillis?.() ?? 0;
      if (blockedUntil > Date.now()) {
        const hours = Math.ceil((blockedUntil - Date.now()) / (60 * 60 * 1000));
        throw forbidden(
          `Too many rejected submissions. You can try again in about ${hours} hour(s), or contact your teacher directly.`,
          'resubmit_blocked'
        );
      }

      tx.set(
        ref,
        {
          ...details,
          approvalStatus: 'pending',
          rejectionReason: null,
          resubmittedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { ok: true };
    });

    log.info('Registration resubmitted', { session });
    return { ...result, approvalStatus: 'pending' };
  },
});
