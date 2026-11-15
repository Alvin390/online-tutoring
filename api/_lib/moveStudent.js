import { FieldValue } from './firebaseAdmin.js';
import { ApiError, notFound } from './errors.js';
import { tryWriteAudit } from './audit.js';
import { accountRef } from './ledger.js';
import { recordNumber, reservationId } from './admissionNumber.js';

/**
 * Moving a student to another phone number — shared by the teacher's edit
 * (POST /api/student/update, Phase 13 / 03) and the student's one-time number
 * fix (POST /api/student/fixNumber, 009Fixes / 02). Moved here unchanged:
 * the record with all its state, every note, and the fee account with its
 * whole ledger, old copies deleted LAST; resumable (the new record carries
 * `moveInProgress` + `movedFrom`); the admission number's reservation follows;
 * the old number's lock and "last seen" are dropped; the new number is not
 * confirmed unless `extra` says so.
 *   extra        fields set on the new record when it is created
 *                (009Fixes / 02: phoneVerifiedAt, numberFixedAt, numberFixedFrom)
 *   auditAction  'student.phone_changed' (teacher) or
 *                'student.number_fixed_by_student'
 */

const BATCH_LIMIT = 450; // under Firestore's 500 writes per commit

const conflict = (message) => new ApiError(409, 'phone_in_use', message, { expose: true });

/** Commits `ops` (functions taking a batch) in batches of BATCH_LIMIT. */
export async function commitInBatches(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

export async function moveStudent({ db, session, oldPhone, newPhone, changes = {}, extra = {}, user, log, auditAction = 'student.phone_changed' }) {
  const oldRef = db.doc(`sessions/${session}/students/${oldPhone}`);
  const newRef = db.doc(`sessions/${session}/students/${newPhone}`);
  // 004Fixes / 06: this session's account only — the same number in the other
  // session is a different registration, with its own money, and stays put.
  const oldAccount = accountRef(db, session, oldPhone);
  const newAccount = accountRef(db, session, newPhone);

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
    // 008Fixes / 01: a new phone has not been confirmed — its first check-in
    // sends it a code. The admission number moves with the record.
    const { phoneVerifiedAt, studentUid, ...data } = oldSnap.data(); // eslint-disable-line no-unused-vars
    try {
      await newRef.create({
        ...data,
        ...changes,
        ...extra,
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
        ? [(batch) => batch.set(newAccount, { ...accountSnap.data(), key: newAccount.id, phone: newPhone, phoneChangedFrom: oldPhone }, { merge: true })]
        : []),
      ...ledger.docs.map((e) => (batch) => batch.set(newAccount.collection('ledger').doc(e.id), e.data())),
    ]);
  }

  // The number the record holds (from the old copy, or the new one on a resume).
  const held = recordNumber(oldSnap.exists ? oldSnap.data() : (await newRef.get()).data());

  // 4. Delete old copies LAST — ledger, then notes, then the student; the old
  //    account document is replaced by a forwarding marker.
  await commitInBatches(db, [
    ...ledger.docs.map((e) => (batch) => batch.delete(e.ref)),
    ...(accountSnap.exists
      // 004Fixes / 07: the marker keeps `key` and `phone`, so the sweep reads it
      // as a per-session account (with no balance to chase), not a legacy one.
      ? [(batch) => batch.set(oldAccount, { key: oldAccount.id, phone: oldPhone, phoneChanged: newPhone, movedAt: new Date(), session })]
      : []),
    ...notes.docs.map((n) => (batch) => batch.delete(n.ref)),
    // The old number's "last seen" marker (Phase 13 / 08 B3); the new number
    // starts its own on the next check-in.
    (batch) => batch.delete(oldRef.collection('meta').doc('activity')),
    // 008Fixes / 03: and its one-device lock.
    (batch) => batch.delete(oldRef.collection('meta').doc('checkinLock')),
    // 008Fixes / 02: the number's reservation now names the new phone.
    ...(held ? [(batch) => batch.set(
      db.doc(`sessions/${session}/numbers/${reservationId(held.kind, held.digits)}`),
      { phone: newPhone, kind: held.kind, number: held.digits },
      { merge: true },
    )] : []),
    (batch) => batch.delete(oldRef),
  ]);

  // 5. Done: clear the in-progress marker.
  await newRef.update({
    moveInProgress: FieldValue.delete(),
    movedFrom: FieldValue.delete(),
  });

  await tryWriteAudit(
    {
      action: auditAction,
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

