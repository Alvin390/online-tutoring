/**
 * Block reason resolution — Phase 06 D5.
 *
 * THE PAYWALL REASON IS DERIVED, NEVER STORED.
 *
 * Whenever a blocked student has an outstanding balance, the screen reads
 * "Balance of KES 1,500 not paid" — computed at render from the live balance,
 * not from a string written when the block happened.
 *
 * Everything below follows from that one decision:
 *
 *   - Unblock by agreement, then re-block later, and the same balance message
 *     appears again. It was never a stored string that could go stale.
 *   - A student who pays 500 of a 1,500 balance while blocked sees the message
 *     change to KES 1,000 with no teacher action at all.
 *   - A custom reason and a balance coexist: the balance line first (it is the
 *     actionable one), the teacher's reason beneath.
 *   - A zero balance suppresses the balance line entirely, so nobody ever sees
 *     "Balance of KES 0 not paid".
 *
 * Shared by BlockedStudentScreen and the dashboard's blocked badge, so the
 * teacher sees exactly what the student sees.
 */

function formatKes(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

/**
 * @param {object|null} student   needs `blocked`, `blockReason`, `feeBalance`
 * @param {object} [options]
 * @param {boolean} [options.feesEnabled]  the fees.enabled flag
 * @returns {{blocked: boolean, balanceLine: string|null,
 *            customReason: string|null, lines: string[], balance: number}}
 */
export function resolveBlockReason(student, { feesEnabled = false } = {}) {
  const blocked = student?.blocked === true;

  // Only a positive balance is owed. A negative balance is a credit — the
  // student is in advance — and must never be rendered as a debt.
  const rawBalance = Number(student?.feeBalance);
  const balance = Number.isFinite(rawBalance) ? rawBalance : 0;
  const owes = feesEnabled && balance > 0;

  const custom = typeof student?.blockReason === 'string' && student.blockReason.trim() !== ''
    ? student.blockReason.trim()
    : null;

  if (!blocked) {
    return { blocked: false, balanceLine: null, customReason: null, lines: [], balance };
  }

  const balanceLine = owes ? `Balance of ${formatKes(balance)} not paid` : null;

  const lines = [];
  if (balanceLine) lines.push(balanceLine);
  if (custom) lines.push(custom);

  // A block with no balance and no stated reason still needs to say something
  // the student can act on.
  if (lines.length === 0) {
    lines.push('Your access is currently on hold. Please contact your teacher.');
  }

  return { blocked: true, balanceLine, customReason: custom, lines, balance };
}

/**
 * Whether a payment clears a block — Phase 06 D5, the partial-payment rule.
 *
 * A PARTIAL PAYMENT DOES NOT CLEAR A BLOCK. Owing 3,000 and paying 1,500
 * leaves a balance of 1,500 and the student stays blocked. The block lifts only
 * when the balance reaches zero, or when the teacher explicitly unblocks by
 * customary agreement — which stays available precisely because tutors make
 * that call all the time.
 */
export function shouldAutoUnblock(balanceAfter) {
  return Number(balanceAfter) <= 0;
}

export { formatKes };
