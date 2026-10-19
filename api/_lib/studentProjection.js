import { effectiveApprovalStatus } from './studentState.js';

/** Only these fields ever cross the wire. Everything else stays server-side. */
export function projectStudent(data) {
  return {
    studentName: data.studentName ?? null,
    class: data.class ?? null,
    subjects: data.subjects ?? null,
    session: data.session ?? null,
    // Explicit coercion: a legacy document written before Phase 01 has no
    // `blocked` field at all, and `undefined` is falsy — which is precisely the
    // bug that let unapproved registrations walk into class. Default to the
    // SAFE value, not the convenient one.
    blocked: data.blocked === true,
    blockReason: data.blocked === true ? (data.blockReason ?? '') : '',
    // Phase 13 / 03 D3: missing means approved (pre-approval registrations).
    approvalStatus: effectiveApprovalStatus(data),
    rejectionReason: data.approvalStatus === 'rejected' ? (data.rejectionReason ?? '') : null,
    receiptStatus: data.receiptStatus ?? 'pending',
    hasPendingReceipt: Boolean(data.pendingReceipt),
    feeBalance: typeof data.feeBalance === 'number' ? data.feeBalance : 0,
    registeredAt: data.registeredAt?.toDate?.()?.toISOString() ?? null,
  };
}
