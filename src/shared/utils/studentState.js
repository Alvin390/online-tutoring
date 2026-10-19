/**
 * Student state rules — client copy. Phase 13 / 03 D3.
 *
 * Mirror of api/_lib/studentState.js (a parity test keeps them identical).
 * See there for why a missing approvalStatus means APPROVED.
 *
 * @param {{approvalStatus?: string}|null|undefined} data
 * @returns {'approved'|'pending'|'rejected'|string}
 */
export function effectiveApprovalStatus(data) {
  const status = data?.approvalStatus;
  return typeof status === 'string' && status.length > 0 ? status : 'approved';
}
