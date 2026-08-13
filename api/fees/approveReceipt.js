import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { postEntry } from '../_lib/ledger.js';
import { shouldAutoUnblock } from '../_lib/feeState.js';
import { notFound } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Receipt approval that also posts a payment — Phase 06 D4.
 *
 * The pre-existing `approveReceipt` copied `pendingReceipt` into
 * `receiptMessage`, cleared the block and set `receiptStatus: 'approved'`. It
 * recorded no amount, because before this phase there was nowhere to put one.
 *
 * Now approving can post a `payment` entry linked back to the receipt via
 * `sourceReceiptId`.
 *
 * THE TWO ACTIONS STAY SEPARABLE. `amount` is optional: a teacher can approve
 * access without recording money, because sometimes they just want to let
 * someone in — a student whose parent paid in cash last week, a hardship case,
 * a mistake being corrected. Forcing an amount would make them invent one, and
 * an invented number in a ledger is worse than an absent one.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    // Omit to approve access without posting money.
    amount: z.number().int().min(1).max(10_000_000).optional(),
    method: z.enum(['cash', 'mpesa', 'bank']).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'fees_approve_receipt', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, phone, amount, method, reference } = body;
    const db = getDb();
    const studentRef = db.doc(`sessions/${session}/students/${phone}`);

    const snap = await studentRef.get();
    if (!snap.exists) throw notFound('That student no longer exists.');

    const data = snap.data();
    // A stable ID for this specific receipt, so the ledger entry can point back
    // at exactly the text the teacher approved.
    const receiptId = `receipt_${phone}_${data.receiptSubmittedAt?.toMillis?.() ?? Date.now()}`;

    let posted = null;
    if (amount) {
      posted = await postEntry({
        phone,
        session,
        type: 'payment',
        amount,
        method: method ?? 'mpesa',
        reference: reference ?? null,
        note: 'Recorded on receipt approval',
        recordedBy: user.uid,
        sourceReceiptId: receiptId,
        // Approving the same receipt twice must not post the payment twice.
        idempotencyKey: receiptId,
      });
    }

    // Clearing the block on approval is the existing behaviour and is kept.
    // But when fees are being tracked AND a balance survives the payment, the
    // partial-payment rule wins: the student stays blocked and the derived
    // reason updates to the new, smaller balance.
    const balanceAfter = posted ? posted.balance : (data.feeBalance ?? 0);
    const clearBlock = !posted || shouldAutoUnblock(balanceAfter);

    await studentRef.set(
      {
        receiptMessage: data.pendingReceipt || data.receiptMessage,
        pendingReceipt: null,
        receiptStatus: 'approved',
        receiptApprovedAt: FieldValue.serverTimestamp(),
        ...(clearBlock ? { blocked: false, blockReason: '', blockedAt: null } : {}),
      },
      { merge: true }
    );

    log.info('Receipt approved', {
      session,
      posted: Boolean(posted),
      balance: balanceAfter,
      clearedBlock: clearBlock,
    });

    await tryWriteAudit(
      {
        action: AuditAction.RECEIPT_APPROVED,
        actor: user.uid,
        actorRole: user.role,
        target: `${session}/${phone}`,
        before: { balance: posted?.previousBalance ?? null, blocked: data.blocked === true },
        after: { balance: balanceAfter, blocked: !clearBlock, entryId: posted?.entryId ?? null },
        context: { requestId: log.requestId, amountPosted: amount ?? null },
      },
      log
    );

    return {
      ok: true,
      posted: Boolean(posted),
      entryId: posted?.entryId ?? null,
      balance: balanceAfter,
      stillBlocked: !clearBlock,
      stillOwes: balanceAfter > 0,
    };
  },
});
