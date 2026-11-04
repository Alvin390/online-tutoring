import { FieldValue } from './firebaseAdmin.js';

/**
 * Approving a student's pasted M-Pesa receipt — shared by the single approval
 * (api/fees/approveReceipt.js) and the bulk one (api/_lib/bulkStudents.js,
 * 003Fixes / 06), so the two can never write different things.
 */

/** A stable id for the receipt being approved (the ledger entry points at it). */
export const receiptIdFor = (phone, data, nowMs = Date.now()) =>
  `receipt_${phone}_${data.receiptSubmittedAt?.toMillis?.() ?? nowMs}`;

/**
 * The M-Pesa transaction code in a pasted confirmation: ten capital letters
 * and digits with at least one of each (e.g. "QAB123XYZ9"). Null if none —
 * "CONFIRMED." and amounts like "1,500.00" never match.
 */
export function mpesaCodeFrom(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/);
  return match ? match[0] : null;
}

const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

/**
 * What an approval records — 006Fixes / 04 (owner). Shared by the single and
 * bulk approvals so they can't disagree.
 *   - 'full': everything owed (nothing when nothing is owed).
 *   - 'partial': `amount`, which must be 1 .. owed - 1 (whole KES).
 *   - neither (an old caller): `amount` if sent — partial when below what is
 *     owed — else no money at all, as before.
 * Throws { code, message } for a partial amount out of range.
 * @returns {{ kind, amount, partial, note }}
 */
export function paymentChoice({ payment = null, amount = null, owed }) {
  const due = Math.max(0, Number(owed) || 0);
  if (payment === 'full') {
    return { kind: 'full', amount: due, partial: false, note: 'Recorded on receipt approval (complete)' };
  }
  if (payment === 'partial') {
    const err = (code, message) => Object.assign(new Error(message), { code });
    if (due <= 0) throw err('nothing_owed', 'Nothing is owed, so there is no partial payment to record.');
    if (!Number.isInteger(amount) || amount < 1) throw err('amount_required', 'Enter the amount paid, in whole shillings.');
    if (amount >= due) throw err('amount_not_partial', `That is the full ${kes(due)}: choose Complete payment.`);
    return { kind: 'partial', amount, partial: true, note: `Recorded on receipt approval (partial: ${kes(amount)} of ${kes(due).slice(4)})` };
  }
  if (Number.isInteger(amount) && amount > 0) {
    return { kind: amount < due ? 'partial' : 'full', amount, partial: amount < due, note: 'Recorded on receipt approval' };
  }
  return { kind: 'none', amount: 0, partial: false, note: null };
}

/**
 * The student fields an approval writes. `clearBlock` lifts the block (always
 * when no payment was recorded; otherwise only once nothing is owed — the
 * partial-payment rule). `approvedAt` is a server timestamp for the single
 * path and the action's exact time for a bulk action (so Undo can recognise it).
 */
export function approvalFields(data, { clearBlock, approvedAt }) {
  return {
    receiptMessage: data.pendingReceipt || data.receiptMessage,
    pendingReceipt: null,
    receiptStatus: 'approved',
    receiptApprovedAt: approvedAt,
    ...(clearBlock ? { blocked: false, blockReason: '', blockedAt: null } : {}),
    // 003Fixes / 07: an approved receipt counts as paid — out of any schedule.
    ...(data.scheduledBlock ? { scheduledBlock: FieldValue.delete() } : {}),
  };
}
