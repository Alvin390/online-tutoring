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
  };
}
