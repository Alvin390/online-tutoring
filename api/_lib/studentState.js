/**
 * Student state rules shared by every handler — Phase 13 / 03 D3.
 *
 * Server copy. The client copy is src/shared/utils/studentState.js; a parity
 * test keeps the two identical (the logger/redact convention).
 */

/**
 * The approval status a student is TREATED as having.
 *
 * A document with NO `approvalStatus` predates the approval feature (Phase 04):
 * that student registered before approval existed and was already attending.
 * They are approved — not pending. Before Phase 13 the check-in projection and
 * /api/class/link defaulted the other way, so switching
 * `registration.requireApproval` on would have locked every such student out
 * (validated: 403 approval_pending), while the client gate, calendar, invoices
 * and WhatsApp all said "approved".
 *
 * New registrations are unaffected: the rules REQUIRE an explicit
 * `approvalStatus: 'pending'` on create.
 *
 * @param {{approvalStatus?: string}|null|undefined} data
 * @returns {'approved'|'pending'|'rejected'|string}
 */
/**
 * 003Fixes / 07: a student's scheduled block whose time has come, or null.
 * Check-in and the class link enforce it from that minute; the per-minute
 * sweep then records the block properly (fee charge, fields, Undo).
 */
export function dueScheduledBlock(data, nowMs = Date.now()) {
  const scheduled = data?.scheduledBlock;
  const atMs = scheduled?.atMs ?? scheduled?.at?.toMillis?.() ?? null;
  return atMs != null && atMs <= nowMs ? scheduled : null;
}

/** Blocked — explicitly, or by a scheduled block that is now due. */
export function isBlockedNow(data, nowMs = Date.now()) {
  return data?.blocked === true || dueScheduledBlock(data, nowMs) !== null;
}

export function effectiveApprovalStatus(data) {
  const status = data?.approvalStatus;
  return typeof status === 'string' && status.length > 0 ? status : 'approved';
}
