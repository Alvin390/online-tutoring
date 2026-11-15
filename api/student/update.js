import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { z, phoneSchema, sessionSchema, studentNameSchema } from '../_lib/validate.js';
import { notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { moveStudent } from '../_lib/moveStudent.js';

/**
 * Edit a student — Phase 13 / 03 D1.
 *
 * WHY SERVER-SIDE. The dashboard used to "edit" by re-running the open
 * registration create (`registerStudent`): a full setDoc with a fresh
 * `registeredAt` and `feeBalance: 0`. The rules (correctly) refuse a teacher
 * write to server-owned fields, so EVERY edit failed (validated:
 * PERMISSION_DENIED). Changing the phone number "worked" by deleting the record
 * and registering a new one — resetting it to pending/unblocked with balance 0,
 * leaving the private notes and the fee ledger behind under the old number.
 *
 * Here:
 *  - `changes` is a strict allowlist of the four presentation fields. Approval,
 *    block state, balance and registration time cannot be touched — they have
 *    their own endpoints and their own audit trails.
 *  - A phone change MOVES the record: the student document with all its state,
 *    every note, and the fee account with its whole ledger, then deletes the
 *    old copies LAST (copy-before-delete, as sessions/manage does for a session
 *    delete). Ledger entries are copied verbatim — the ledger is append-only and
 *    keeps the phone each entry was recorded against.
 *  - It is RESUMABLE. Writes go in batches of up to 500 (one subrequest each);
 *    if the per-invocation subrequest budget runs out, the response is
 *    `{ partial: true }` and repeating the same request finishes the move. The
 *    new record is created first with `moveInProgress` + `movedFrom`, which is
 *    how a retry — or a concurrent duplicate request — recognises its own work
 *    instead of answering 409.
 *  - M-Pesa transaction records (`mpesa/transactions`) are NOT moved: they are
 *    the history of what was sent to Safaricom, against the number used then.
 */


const changesSchema = z
  .object({
    studentName: studentNameSchema.optional(),
    class: z.string().trim().min(1).max(60).optional(),
    // Phase 14: room for every subject of a class (checkboxes, joined).
    subjects: z.string().trim().min(3).max(500).optional(),
    receiptMessage: z.string().trim().min(10).max(500).optional(),
  })
  .strict();

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    newPhone: phoneSchema.optional(),
    changes: changesSchema.default({}),
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist.
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'student_update', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, phone, newPhone, changes } = body;
    const db = getDb();

    try {
      if (newPhone && newPhone !== phone) {
        return await moveStudent({ db, session, oldPhone: phone, newPhone, changes, user, log });
      }

      const ref = db.doc(`sessions/${session}/students/${phone}`);
      const snap = await ref.get();
      if (!snap.exists) throw notFound('That student no longer exists.');

      const current = snap.data();
      const changed = Object.keys(changes).filter((k) => changes[k] !== current[k]);
      if (changed.length === 0) return { ok: true, phone, changed: [] };

      await ref.update({
        ...Object.fromEntries(changed.map((k) => [k, changes[k]])),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      });

      await tryWriteAudit(
        {
          action: 'student.updated',
          actor: user.uid,
          actorRole: user.role,
          target: `${session}/${phone}`,
          before: Object.fromEntries(changed.map((k) => [k, current[k] ?? null])),
          after: Object.fromEntries(changed.map((k) => [k, changes[k]])),
          context: { requestId: log.requestId },
        },
        log
      );

      return { ok: true, phone, changed };
    } catch (err) {
      if (err instanceof SubrequestBudgetExceeded) {
        // Everything written so far is idempotent; the same request resumes.
        log.warn('Student update stopped at the subrequest budget; resumable', { session });
        return { ok: true, partial: true, resume: 'Repeat the same request to finish.' };
      }
      throw err;
    }
  },
});
