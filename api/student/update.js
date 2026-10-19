import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { z, phoneSchema, sessionSchema, studentNameSchema } from '../_lib/validate.js';
import { ApiError, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';

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

const BATCH_LIMIT = 450; // under Firestore's 500 writes per commit

const changesSchema = z
  .object({
    studentName: studentNameSchema.optional(),
    class: z.string().trim().min(1).max(60).optional(),
    subjects: z.string().trim().min(3).max(200).optional(),
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

const conflict = (message) => new ApiError(409, 'phone_in_use', message, { expose: true });

/** Commits `ops` (functions taking a batch) in batches of BATCH_LIMIT. */
async function commitInBatches(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

async function moveStudent({ db, session, oldPhone, newPhone, changes, user, log }) {
  const oldRef = db.doc(`sessions/${session}/students/${oldPhone}`);
  const newRef = db.doc(`sessions/${session}/students/${newPhone}`);
  const oldAccount = db.doc(`fees/accounts/items/${oldPhone}`);
  const newAccount = db.doc(`fees/accounts/items/${newPhone}`);

  const [oldSnap, targetSnap] = await Promise.all([oldRef.get(), newRef.get()]);

  let resuming = false;
  if (targetSnap.exists) {
    const t = targetSnap.data();
    if (t.moveInProgress === true && t.movedFrom === oldPhone) resuming = true;
    else throw conflict('Another student already uses that number.');
  }
  if (!oldSnap.exists && !resuming) throw notFound('That student no longer exists.');

  // 1. The new record, created first and marked in progress. `create()` means
  //    two simultaneous requests cannot both claim the number: the loser sees
  //    the marker and joins as a resume.
  if (!resuming) {
    const data = oldSnap.data();
    try {
      await newRef.create({
        ...data,
        ...changes,
        parentPhone: newPhone,
        moveInProgress: true,
        movedFrom: oldPhone,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      });
    } catch (err) {
      if (err?.code !== 6 && err?.code !== 'already-exists') throw err;
      const raced = (await newRef.get()).data();
      if (!(raced?.moveInProgress === true && raced?.movedFrom === oldPhone)) {
        throw conflict('Another student already uses that number.');
      }
    }
  }

  // 2. Notes — copy every one that is still under the old number.
  const notes = await oldRef.collection('notes').get();
  await commitInBatches(
    db,
    notes.docs.map((n) => (batch) => batch.set(newRef.collection('notes').doc(n.id), n.data()))
  );

  // 3. Fee account + ledger, copied verbatim.
  const [accountSnap, ledger] = await Promise.all([
    oldAccount.get(),
    oldAccount.collection('ledger').get(),
  ]);
  const hasMoneyToMove = accountSnap.exists && accountSnap.data().phoneChanged !== newPhone;
  if (hasMoneyToMove || ledger.size > 0) {
    await commitInBatches(db, [
      ...(hasMoneyToMove
        ? [(batch) => batch.set(newAccount, { ...accountSnap.data(), phone: newPhone, phoneChangedFrom: oldPhone }, { merge: true })]
        : []),
      ...ledger.docs.map((e) => (batch) => batch.set(newAccount.collection('ledger').doc(e.id), e.data())),
    ]);
  }

  // 4. Delete old copies LAST — ledger, then notes, then the student; the old
  //    account document is replaced by a forwarding marker.
  await commitInBatches(db, [
    ...ledger.docs.map((e) => (batch) => batch.delete(e.ref)),
    ...(accountSnap.exists
      ? [(batch) => batch.set(oldAccount, { phoneChanged: newPhone, movedAt: new Date(), session })]
      : []),
    ...notes.docs.map((n) => (batch) => batch.delete(n.ref)),
    // The old number's "last seen" marker (Phase 13 / 08 B3); the new number
    // starts its own on the next check-in.
    (batch) => batch.delete(oldRef.collection('meta').doc('activity')),
    (batch) => batch.delete(oldRef),
  ]);

  // 5. Done: clear the in-progress marker.
  await newRef.update({
    moveInProgress: FieldValue.delete(),
    movedFrom: FieldValue.delete(),
  });

  await tryWriteAudit(
    {
      action: 'student.phone_changed',
      actor: user.uid,
      actorRole: user.role,
      target: `${session}/${newPhone}`,
      before: { phone: oldPhone },
      after: { phone: newPhone, notes: notes.size, ledgerEntries: ledger.size, changed: Object.keys(changes) },
      context: { requestId: log.requestId, resumed: resuming },
    },
    log
  );

  log.info('Student phone changed', { session, notes: notes.size, ledgerEntries: ledger.size, resumed: resuming });
  return { ok: true, phone: newPhone, moved: { notes: notes.size, ledgerEntries: ledger.size } };
}

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
