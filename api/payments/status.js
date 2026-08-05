import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { interpretResultCode } from '../_lib/daraja.js';

/**
 * Payment status poll — Phase 09 D3/D5.
 *
 * The student's screen polls this while waiting for the M-Pesa prompt to be
 * answered. It reads OUR record rather than querying Daraja on every poll:
 * a status query costs an API call and an OAuth token, and a student tapping
 * refresh should not be able to drive Safaricom traffic.
 *
 * The active status query lives in the reconciliation sweep, which runs on a
 * schedule against transactions that have gone quiet — not on the hot path.
 */

const schema = z
  .object({
    checkoutRequestId: z.string().trim().min(5).max(120),
    phone: phoneSchema,
  })
  .strict();

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'payments_status', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, req }) => {
    if (!(await isEnabled('payments.daraja'))) {
      return { ok: true, status: 'unavailable' };
    }

    const db = getDb();
    const snap = await db.doc(`mpesa/transactions/items/${body.checkoutRequestId}`).get();

    if (!snap.exists) throw notFound('That payment could not be found.');

    const tx = snap.data();

    // Object-level check: a student may only poll their OWN payment. Without
    // it, a CheckoutRequestID would be a lookup key for anyone else's payment
    // amount and balance.
    if (tx.phone !== body.phone) {
      throw forbidden('That payment does not belong to this number.', 'not_yours');
    }

    let verified = false;
    try {
      const user = await authenticate(req);
      if (user.role === 'student' && user.phone === body.phone) verified = true;
      if (user.role === 'teacher' || user.role === 'superadmin') verified = true;
    } catch {
      // Legacy path.
    }

    if (!verified && !(await isEnabled('auth.legacyStudentRead'))) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
    }

    const interpreted = tx.resultCode !== null && tx.resultCode !== undefined
      ? interpretResultCode(tx.resultCode)
      : null;

    return {
      ok: true,
      status: tx.status,
      amount: tx.expectedAmount ?? null,
      receivedAmount: tx.receivedAmount ?? null,
      mpesaReceipt: tx.mpesaReceipt ?? null,
      balanceAfter: tx.balanceAfter ?? null,
      // The user-facing wording comes from the code table, so a cancelled
      // prompt reads as cancelled rather than as an error.
      message: interpreted?.userFacing ?? null,
      environment: tx.environment ?? 'sandbox',
    };
  },
});
