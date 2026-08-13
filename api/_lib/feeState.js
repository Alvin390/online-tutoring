/**
 * Fee state helpers — server copy. Phase 06 D5.
 *
 * Duplicated from src/shared/utils/blockReason.js for the usual reason (`/api`
 * is a separate build target with no Vite alias resolution). A parity test
 * asserts the two agree on the same corpus, because a server that computes a
 * different block reason from the one the student is shown is worse than no
 * message at all.
 */

export function formatKes(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

export function resolveBlockReason(student, { feesEnabled = false } = {}) {
  const blocked = student?.blocked === true;

  const rawBalance = Number(student?.feeBalance);
  const balance = Number.isFinite(rawBalance) ? rawBalance : 0;
  const owes = feesEnabled && balance > 0;

  const custom =
    typeof student?.blockReason === 'string' && student.blockReason.trim() !== ''
      ? student.blockReason.trim()
      : null;

  if (!blocked) {
    return { blocked: false, balanceLine: null, customReason: null, lines: [], balance };
  }

  const balanceLine = owes ? `Balance of ${formatKes(balance)} not paid` : null;

  const lines = [];
  if (balanceLine) lines.push(balanceLine);
  if (custom) lines.push(custom);
  if (lines.length === 0) {
    lines.push('Your access is currently on hold. Please contact your teacher.');
  }

  return { blocked: true, balanceLine, customReason: custom, lines, balance };
}

/**
 * A partial payment does NOT clear a block. The block lifts only at a zero (or
 * credit) balance, or by the teacher's explicit unblock.
 */
export function shouldAutoUnblock(balanceAfter) {
  return Number(balanceAfter) <= 0;
}

/**
 * The fee due for a student: their per-student override if set, otherwise the
 * default for their class, otherwise nothing.
 *
 * Returns null rather than 0 when no fee is configured. Zero is a real amount —
 * a scholarship — and inventing an invoice for KES 0 because a class was never
 * priced would be a silent data error rather than a visible gap.
 */
export function resolveFeeAmount({ student, account, config }) {
  const override = account?.feeAmount;
  if (typeof override === 'number' && Number.isInteger(override)) return override;

  const byClass = config?.defaultFeeByClass ?? {};
  const forClass = byClass[student?.class];
  if (typeof forClass === 'number' && Number.isInteger(forClass)) return forClass;

  return null;
}

/**
 * Next due date from the billing day and grace period.
 *
 * `billingDayOfMonth` is capped at 28 by the config schema, so this never has
 * to reason about February or 31-day months — the cap is what makes the date
 * maths trivial instead of a source of skipped billing cycles.
 */
export function computeNextDueDate({ billingDayOfMonth, gracePeriodDays }, from = new Date()) {
  const day = Math.min(Math.max(Number(billingDayOfMonth) || 1, 1), 28);
  const grace = Math.max(Number(gracePeriodDays) || 0, 0);

  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day, 0, 0, 0));
  if (next.getTime() <= from.getTime()) {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }

  next.setUTCDate(next.getUTCDate() + grace);
  return next;
}
