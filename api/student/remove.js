import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { notFound } from '../_lib/errors.js';
import { deleteRecursively } from '../_lib/sessions.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

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

    // Batched since Phase 13 / 03. Counted by collection: the student also
    // has a meta/activity marker since Phase 13 / 08 B3.
    const { byCollection } = await deleteRecursively(db, ref);
    const noteCount = byCollection?.notes ?? 0;

    // The fee record is RETAINED (Phase 13 / 03 D2): the ledger is a financial
    // record, append-only by design. It is marked so fee views can tell the
    // student is gone.
    const account = db.doc(`fees/accounts/items/${phone}`);
    const accountSnap = await account.get();
    if (accountSnap.exists) {
      await account.set({ studentDeletedAt: new Date(), studentDeletedBy: user.uid }, { merge: true });
    }

    log.info('Student deleted', { session, notesRemoved: noteCount, feeRecordRetained: accountSnap.exists });

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
          feeRecordRetained: accountSnap.exists,
        },
        context: { requestId: log.requestId },
      },
      log
    );

    return { ok: true, notesRemoved: noteCount };
  },
});
