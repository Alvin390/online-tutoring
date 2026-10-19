import { getDb, FieldValue } from './firebaseAdmin.js';
import { deferToBackground } from './requestContext.js';

/**
 * Append-only audit trail — Phase 01 D4.
 *
 * Records every decision that affects access or money: block/unblock,
 * approval/rejection, fee adjustment, tier change, superadmin override,
 * credential update.
 *
 * `audit/` is `allow write: if false` for every client and readable only by the
 * superadmin claim. Entries are never updated and never deleted; a correction
 * is a new entry that references the original. The audit trail IS the record —
 * not a convenience copy of one that can drift from the truth.
 */

export const AuditAction = {
  // Access
  STUDENT_BLOCKED: 'student.blocked',
  STUDENT_UNBLOCKED: 'student.unblocked',
  STUDENT_APPROVED: 'student.approved',
  STUDENT_REJECTED: 'student.rejected',
  STUDENT_DELETED: 'student.deleted',
  RECEIPT_APPROVED: 'receipt.approved',
  RECEIPT_DECLINED: 'receipt.declined',
  CLASS_LINK_ISSUED: 'class.link_issued',
  CLASS_LINK_UPDATED: 'class.link_updated',

  // Identity
  ROLE_GRANTED: 'auth.role_granted',
  LOGIN_LOCKED: 'auth.login_locked',
  OTP_ISSUED: 'auth.otp_issued',
  OTP_VERIFIED: 'auth.otp_verified',

  // Money
  SUBSCRIPTION_CREATED: 'billing.subscription_created',
  SUBSCRIPTION_CHANGED: 'billing.subscription_changed',
  SUBSCRIPTION_CANCELLED: 'billing.subscription_cancelled',
  SUBSCRIPTION_STATE_CHANGED: 'billing.state_changed',
  TIER_GRANTED_BY_SUPERADMIN: 'billing.tier_granted',
  WEBHOOK_RECEIVED: 'billing.webhook_received',
  WEBHOOK_REJECTED: 'billing.webhook_rejected',
  DATA_PURGED: 'data.purged',
};

/**
 * @param {object} entry
 * @param {string} entry.action    one of AuditAction
 * @param {string} [entry.actor]   uid of whoever performed it, or 'system:<job>'
 * @param {string} [entry.actorRole]
 * @param {string} [entry.target]  what it was done to
 * @param {object} [entry.before]  prior state, for reversibility
 * @param {object} [entry.after]   resulting state
 * @param {object} [entry.context] request id, ip, anything else useful
 */
export async function writeAudit(entry) {
  const db = getDb();
  await db.collection('audit').add({
    action: entry.action,
    actor: entry.actor ?? 'system',
    actorRole: entry.actorRole ?? null,
    target: entry.target ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    context: entry.context ?? null,
    at: FieldValue.serverTimestamp(),
  });
}

/**
 * Audit writes must never fail the operation they describe. If the trail write
 * throws, the caller's work still stands — losing an audit line is bad, but
 * rolling back a completed payment because we could not log it is worse.
 */
export async function tryWriteAudit(entry, log) {
  const write = writeAudit(entry).catch((err) => {
    log?.error('Audit write failed', err);
  });
  // Phase 13 / 08 C3: inside a Worker invocation the write is handed to
  // waitUntil and this returns at once — the response no longer waits a
  // Google round trip for the audit line, and the runtime still finishes it.
  // (Audit entries that ARE the guarantee — the ledger's — are written inside
  // their transaction by ledger.js, not through here.)
  if (deferToBackground(write)) return;
  await write;
}
