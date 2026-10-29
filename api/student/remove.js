import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { notFound } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { removeStudentRecord } from '../_lib/studentRemoval.js';

/**
 * Delete a student, and everything beneath them — Phase 05 Part B.
 *
 * This endpoint exists for one reason: **Firestore does not cascade.**
 *
 * `deleteDoc(sessions/x/students/y)` removes that document and leaves
 * `sessions/x/students/y/notes/*` completely intact. The notes remain readable
 * by anyone with the path and still appear in collection-group queries, but the
 * console shows nothing, because a parent document is not required for a
 * subcollection to exist.
 *
 * For private teacher notes about a student who has just been removed — notes
 * that may say "parent requested a meeting about bullying" — silently retaining
 * them is a data-protection failure, not an inconvenience. It is also, per the
 * plan, a commonly missed case, which is why it gets its own endpoint and its
 * own audit entry rather than a comment on the client call.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist.
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'student_remove', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, phone } = body;
    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);

    const snap = await ref.get();
    if (!snap.exists) throw notFound('That student no longer exists.');

    const data = snap.data();

    // Batched since Phase 13 / 03; the fee record is RETAINED and any balance
    // closed (Phase 13 / 03 D2). Shared with the duplicate actions (003Fixes / 12).
    const { noteCount, feeRecordRetained, balanceClosed } = await removeStudentRecord({ db, session, phone, user });

    log.info('Student deleted', { session, notesRemoved: noteCount, feeRecordRetained, balanceClosed });

    await tryWriteAudit(
      {
        action: AuditAction.STUDENT_DELETED,
        actor: user.uid,
        actorRole: user.role,
        target: `${session}/${phone}`,
        before: {
          class: data.class ?? null,
          approvalStatus: data.approvalStatus ?? null,
          notesRemoved: noteCount,
          feeRecordRetained,
          balanceClosed,
        },
        context: { requestId: log.requestId },
      },
      log
    );

    return { ok: true, notesRemoved: noteCount, balanceClosed };
  },
});
