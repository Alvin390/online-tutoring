/**
 * The words for bulk actions — 003Fixes / 05. Shared by the dashboard (toast),
 * the bulk modal and Recent actions; kept tiny so the dashboard can use it
 * without loading either lazy chunk.
 */
export const BULK_TEXT = {
  block: { verb: 'Block', ing: 'Blocking', past: 'blocked' },
  unblock: { verb: 'Unblock', ing: 'Unblocking', past: 'unblocked' },
  approveReceipts: { verb: 'Approve', ing: 'Approving', past: 'approved' },
  cancelSchedule: { verb: 'Cancel the scheduled block for', ing: 'Cancelling', past: 'taken out of their scheduled block' },
};

const SKIP_TEXT = {
  awaitingApproval: (n) => `${n} waiting for approval`,
  alreadyBlocked: (n) => `${n} already blocked`,
  notBlocked: (n) => `${n} not blocked`,
  noReceipt: (n) => `${n} with no receipt to review`,
  missing: (n) => `${n} no longer registered`,
  notScheduled: (n) => `${n} no longer scheduled`,
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Who made a schedule or bulk action — 004Fixes / 03. Every staff account
 * sees everyone's; records from before 004Fixes carry no email.
 */
export function byWho(email, myEmail) {
  if (!email) return 'by another staff account';
  if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) return 'by you';
  return `by ${email}`;
}

export const describeSkipped = (skipped = {}) =>
  Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => (SKIP_TEXT[key] ?? ((k) => `${k} ${key}`))(n));

/** "127 students blocked. 12 skipped: 8 waiting for approval, 4 already blocked." */
export function describeResult(action, result) {
  const text = BULK_TEXT[action] ?? BULK_TEXT.block;
  const skipped = describeSkipped(result.skipped);
  const failed = result.failed?.length ?? 0;
  const skippedTotal = Object.values(result.skipped ?? {}).reduce((s, n) => s + n, 0);
  return [
    `${plural(result.done, 'student')} ${text.past}.`,
    skippedTotal ? `${skippedTotal} skipped: ${skipped.join(', ')}.` : '',
    failed ? `${failed} could not be ${text.past} — try them again.` : '',
  ].filter(Boolean).join(' ');
}
