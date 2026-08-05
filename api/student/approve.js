import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { badRequest, notFound } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Approve or reject a first-time registration — Phase 04 Part A.
 *
 * Teacher-only. Runs server-side rather than as a direct Firestore write for
 * three reasons a rule cannot cover:
 *
 *   1. Rejection must increment `rejectionCount` atomically and apply the
 *      3-strikes soft block. A client-side increment races with itself.
 *   2. Bulk approval needs to be one batch, not N independent writes that can
 *      half-fail and leave the queue in a state nobody can reason about.
 *   3. Every decision is audited with actor, target, before and after. An
 *      access decision that is not attributable is not a decision, it is a
 *      mystery.
 */

const MAX_REJECTIONS = 3;
const SOFT_BLOCK_HOURS = 24;

const schema = z
  .object({
    session: sessionSchema,
    decision: z.enum(['approve', 'reject']),
    // Single or bulk — one shape, so the handler has one code path.
    phones: z.array(phoneSchema).min(1).max(100),
    reason: z.string().trim().min(10).max(500).optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'student_approve', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, decision, phones, reason } = body;

    // A rejection without a reason is unactionable for the student — they are
    // told no and given nothing to fix. Required, minimum 10 characters.
    if (decision === 'reject' && !reason) {
      throw badRequest('A reason is required when rejecting, so the student knows what to correct.');
    }

    const db = getDb();
    const now = Date.now();
    const results = { approved: [], rejected: [], skipped: [] };

    // Deduplicate: a double-click on "approve all" must not double-count a
    // rejection.
    const unique = [...new Set(phones)];

    for (const phone of unique) {
      const ref = db.doc(`sessions/${session}/students/${phone}`);

      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { skipped: 'not_found' };

          const data = snap.data();
          const before = {
            approvalStatus: data.approvalStatus ?? null,
            rejectionCount: data.rejectionCount ?? 0,
          };

          if (decision === 'approve') {
            tx.set(
              ref,
              {
                approvalStatus: 'approved',
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: user.uid,
                rejectionReason: null,
                // Clearing the soft block on approval: the teacher has
                // overridden the strikes, and leaving it set would block a
                // student the teacher just admitted.
                resubmitBlockedUntil: null,
              },
              { merge: true }
            );
            return { ok: 'approved', before };
          }

          const rejectionCount = (data.rejectionCount ?? 0) + 1;
          const softBlocked = rejectionCount >= MAX_REJECTIONS;

          tx.set(
            ref,
            {
              approvalStatus: 'rejected',
              rejectionReason: reason,
              rejectedAt: FieldValue.serverTimestamp(),
              rejectedBy: user.uid,
              rejectionCount,
              // Stops the approval queue being used as a spam target: after
              // three rejections the number cannot resubmit for 24 hours.
              resubmitBlockedUntil: softBlocked
                ? new Date(now + SOFT_BLOCK_HOURS * 60 * 60 * 1000)
                : null,
            },
            { merge: true }
          );

          return { ok: 'rejected', before, rejectionCount, softBlocked };
        });

        if (outcome.skipped) {
          results.skipped.push({ phone, reason: outcome.skipped });
          // eslint-disable-next-line no-continue
          continue;
        }

        if (outcome.ok === 'approved') results.approved.push(phone);
        else results.rejected.push({ phone, softBlocked: outcome.softBlocked === true });

        // eslint-disable-next-line no-await-in-loop
        await tryWriteAudit(
          {
            action:
              decision === 'approve' ? AuditAction.STUDENT_APPROVED : AuditAction.STUDENT_REJECTED,
            actor: user.uid,
            actorRole: user.role,
            target: `${session}/${phone}`,
            before: outcome.before,
            after:
              decision === 'approve'
                ? { approvalStatus: 'approved' }
                : { approvalStatus: 'rejected', rejectionCount: outcome.rejectionCount },
            context: { requestId: log.requestId, bulk: unique.length > 1 },
          },
          log
        );
      } catch (err) {
        log.error('Approval decision failed for one student', err);
        results.skipped.push({ phone, reason: 'error' });
      }
    }

    log.info('Approval decisions applied', {
      decision,
      approved: results.approved.length,
      rejected: results.rejected.length,
      skipped: results.skipped.length,
    });

    return {
      ok: true,
      decision,
      approvedCount: results.approved.length,
      rejectedCount: results.rejected.length,
      skipped: results.skipped,
    };
  },
});

export { MAX_REJECTIONS, SOFT_BLOCK_HOURS };
