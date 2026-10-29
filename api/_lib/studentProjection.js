import { effectiveApprovalStatus, dueScheduledBlock } from './studentState.js';

// 003Fixes / 07: a fee block that is due but not yet recorded has no balance
// to show yet ("KES 0" would read as a mistake).
const FEES_DUE_REASON = 'Fees are due. Your teacher is recording the amount — please check again in a minute.';

function blockState(data) {
  if (data.blocked === true) return { blocked: true, blockReason: data.blockReason ?? '' };
  const due = dueScheduledBlock(data);
  if (due) return { blocked: true, blockReason: due.kind === 'fees' ? FEES_DUE_REASON : (due.reason ?? '') };
  return { blocked: false, blockReason: '' };
}

/** Only these fields ever cross the wire. Everything else stays server-side. */
export function projectStudent(data) {
  const block = blockState(data);
  return {
    studentName: data.studentName ?? null,
    class: data.class ?? null,
    subjects: data.subjects ?? null,
    session: data.session ?? null,
    // Explicit coercion: a legacy document written before Phase 01 has no
    // `blocked` field at all, and `undefined` is falsy — which is precisely the
    // bug that let unapproved registrations walk into class. Default to the
    // SAFE value, not the convenient one.
    blocked: block.blocked,
    blockReason: block.blockReason,
    // Phase 13 / 03 D3: missing means approved (pre-approval registrations).
    approvalStatus: effectiveApprovalStatus(data),
    rejectionReason: data.approvalStatus === 'rejected' ? (data.rejectionReason ?? '') : null,
    receiptStatus: data.receiptStatus ?? 'pending',
    hasPendingReceipt: Boolean(data.pendingReceipt),
    feeBalance: typeof data.feeBalance === 'number' ? data.feeBalance : 0,
    // 003Fixes / 11: held as a possible duplicate (who it matched stays server-side).
    duplicateHold: data.duplicateHold === true,
    registeredAt: data.registeredAt?.toDate?.()?.toISOString() ?? null,
  };
}
