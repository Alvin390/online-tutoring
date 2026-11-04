import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { postEntry } from '../_lib/ledger.js';
import { notFound, badRequest } from '../_lib/errors.js';
import { approvalFields, receiptIdFor, mpesaCodeFrom, paymentChoice } from '../_lib/receiptApproval.js';
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
    // 006Fixes / 04 (owner): approving asks Complete or Partial. Complete
    // records everything owed; partial records `amount` (1 .. owed - 1).
    payment: z.enum(['full', 'partial']).optional(),
    // Omit (with no `payment`) to approve access without posting money.
    amount: z.number().int().min(1).max(10_000_000).optional(),
    method: z.enum(['cash', 'mpesa', 'bank']).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist.
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'fees_approve_receipt', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, phone, method, reference } = body;
    const db = getDb();
    const studentRef = db.doc(`sessions/${session}/students/${phone}`);

    const snap = await studentRef.get();
    if (!snap.exists) throw notFound('That student no longer exists.');

    const data = snap.data();
    // A stable ID for this specific receipt, so the ledger entry can point back
    // at exactly the text the teacher approved.
    const receiptId = receiptIdFor(phone, data);

    // What is owed: the student's feeBalance, which the ledger keeps equal to
    // the account in the same transaction (no extra read).
    const owed = Number(data.feeBalance) || 0;
    let choice;
    try {
      choice = paymentChoice({ payment: body.payment, amount: body.amount, owed });
    } catch (err) {
      throw badRequest(err.message, err.code);
    }

    let posted = null;
    if (choice.amount > 0) {
      posted = await postEntry({
        phone,
        session,
        type: 'payment',
        amount: choice.amount,
        method: method ?? 'mpesa',
        reference: reference ?? mpesaCodeFrom(data.pendingReceipt || data.receiptMessage),
        note: choice.note,
        recordedBy: user.uid,
        sourceReceiptId: receiptId,
        // Approving the same receipt twice must not post the payment twice.
        idempotencyKey: receiptId,
        ...(choice.partial ? {
          partialPayment: {
            paid: choice.amount, owedBefore: owed, owedAfter: owed - choice.amount, at: new Date(), by: user.uid, receiptId,
          },
        } : {}),
      });
    }

    // 006Fixes / 04 (owner): approving lets the student in, whether the
    // payment was complete or partial — what is still owed stays on the ledger,
    // in Total outstanding, and under the "Partial payment" filter. (Before,
    // a partial payment kept the block; a recorded payment or an M-Pesa
    // receipt still unblocks only once nothing is owed.)
    const balanceAfter = posted ? posted.balance : owed;
    const clearBlock = true;

    // The same fields as a bulk approval (api/_lib/receiptApproval.js).
    await studentRef.set(approvalFields(data, { clearBlock, approvedAt: FieldValue.serverTimestamp() }), { merge: true });

    log.info('Receipt approved', {
      session,
      payment: choice.kind,
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
        context: { requestId: log.requestId, payment: choice.kind, amountPosted: posted ? choice.amount : null },
      },
      log
    );

    return {
      ok: true,
      posted: Boolean(posted),
      entryId: posted?.entryId ?? null,
      paid: posted ? choice.amount : 0,
      partial: Boolean(posted) && choice.partial && balanceAfter > 0,
      balance: balanceAfter,
      stillBlocked: !clearBlock,
      stillOwes: balanceAfter > 0,
    };
  },
});
