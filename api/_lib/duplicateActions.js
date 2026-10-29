import { FieldValue } from './firebaseAdmin.js';
import { badRequest, notFound } from './errors.js';
import { postEntry } from './ledger.js';
import { removeStudentRecord } from './studentRemoval.js';

/**
 * Settling a duplicate registration — 003Fixes / 12.
 *
 *   decline     remove the record (as a deleted student), retire the number
 *   merge       notes and money move to the kept record; the removed number
 *               is retired and told the kept number's last 3 digits
 *   keepBoth    each record lists the other in `duplicateKeep`; never flagged again
 *   allowNumber lift a retired number
 *
 * A retired number lives at sessions/{session}/retiredNumbers/{phone}
 * (server-only). Check-in reads it in its existing batchGet; registration
 * refuses it. Nothing here returns a student's name.
 */

/** Notes copied per call; a larger set continues with a cursor. */
export const NOTES_PER_CALL = 200;

export const retiredRef = (db, session, phone) => db.doc(`sessions/${session}/retiredNumbers/${phone}`);
const studentRef = (db, session, phone) => db.doc(`sessions/${session}/students/${phone}`);
const suffix = (phone) => String(phone).replace(/\D/g, '').slice(-3);
const digits = (phone) => String(phone).replace(/\D/g, '');
const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : null);

export async function declineDuplicate({ db, session, phone, user }) {
  const snap = await studentRef(db, session, phone).get();
  if (!snap.exists) throw notFound('That registration no longer exists.');
  const removed = await removeStudentRecord({ db, session, phone, user });
  await retiredRef(db, session, phone).set({ reason: 'duplicate', at: FieldValue.serverTimestamp(), by: user.uid });
  return { notesRemoved: removed.noteCount, balanceClosed: removed.balanceClosed };
}

/** Retired numbers in these sessions, newest first (one query each; the teacher's own data). */
export async function listRetired({ db, sessions }) {
  const out = [];
  for (const session of sessions) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await db.collection(`sessions/${session}/retiredNumbers`).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      out.push({
        session,
        phone: doc.id,
        reason: data.reason === 'merged' ? 'merged' : 'duplicate',
        keptSuffix: data.keptSuffix ?? null,
        atMs: data.at?.toMillis?.() ?? null,
      });
    }
  }
  return out.sort((x, y) => (y.atMs ?? 0) - (x.atMs ?? 0));
}

export async function allowNumber({ db, session, phone }) {
  const ref = retiredRef(db, session, phone);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return { allowed: snap.exists };
}

export async function keepBoth({ db, session, a, b }) {
  if (a === b) throw badRequest('Choose two different registrations.', 'same_student');
  const [snapA, snapB] = await db.getAll(studentRef(db, session, a), studentRef(db, session, b));
  if (!snapA.exists || !snapB.exists) throw notFound('That registration no longer exists.');
  const update = (other, data) => ({
    duplicateKeep: FieldValue.arrayUnion(other),
    // The link between these two is settled; a hold on either is lifted.
    ...(data.duplicateOf === other ? { duplicateOf: FieldValue.delete(), duplicateHold: FieldValue.delete() } : {}),
  });
  const batch = db.batch();
  batch.set(snapA.ref, update(b, snapA.data()), { merge: true });
  batch.set(snapB.ref, update(a, snapB.data()), { merge: true });
  await batch.commit();
  return { kept: 2 };
}

/**
 * Merge `remove` into `keep`. Safe to repeat: copies keep their ids, money
 * moves under idempotency keys, and a merge already done answers the same.
 * Money: rather than copying ledger entries (which would leave "Total
 * outstanding" and both running balances wrong), the removed account's
 * balance is TRANSFERRED with a pair of adjustments, in to the kept account
 * first, then out of the removed one. The removed account keeps its own
 * history, closed, as for any deleted student.
 */
export async function mergeDuplicate({ db, session, keep, remove, cursor = null, user }) {
  if (keep === remove) throw badRequest('Choose which registration to keep.', 'same_student');
  const [keepSnap, removeSnap, retiredSnap] = await db.getAll(
    studentRef(db, session, keep), studentRef(db, session, remove), retiredRef(db, session, remove),
  );
  if (!keepSnap.exists) throw notFound('That registration no longer exists.');
  if (!removeSnap.exists) {
    const retired = retiredSnap.exists ? retiredSnap.data() : null;
    if (retired?.reason === 'merged' && retired.keptSuffix === suffix(keep)) {
      return { done: true, alreadyMerged: true, notesMoved: 0, balanceMoved: 0 };
    }
    throw notFound('That registration no longer exists.');
  }

  // 1. Notes, in id order, NOTES_PER_CALL at a time.
  const all = (await removeSnap.ref.collection('notes').get()).docs
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .filter((doc) => cursor === null || doc.id > cursor);
  const slice = all.slice(0, NOTES_PER_CALL);
  const more = all.length > NOTES_PER_CALL;
  const batch = db.batch();
  for (const doc of slice) batch.set(keepSnap.ref.collection('notes').doc(doc.id), doc.data());
  if (more) {
    await batch.commit();
    return { done: false, cursor: slice[slice.length - 1].id, notesMoved: slice.length };
  }

  // 2. The kept record wins; only what it lacks is filled in.
  const kept = keepSnap.data();
  const gone = removeSnap.data();
  const fill = {
    duplicateHold: FieldValue.delete(),
    ...(kept.duplicateOf === remove ? { duplicateOf: FieldValue.delete() } : {}),
  };
  if (!kept.pendingReceipt && gone.pendingReceipt) fill.pendingReceipt = gone.pendingReceipt;
  if ((millis(gone.lastAccessed) ?? 0) > (millis(kept.lastAccessed) ?? 0)) fill.lastAccessed = gone.lastAccessed;
  batch.set(keepSnap.ref, fill, { merge: true });
  batch.set(retiredRef(db, session, remove), {
    reason: 'merged', keptSuffix: suffix(keep), at: FieldValue.serverTimestamp(), by: user.uid,
  });
  await batch.commit();

  // 3. Money: in to the kept account, then out of the removed one.
  const accountSnap = await db.doc(`fees/accounts/items/${remove}`).get();
  const balance = accountSnap.exists ? (accountSnap.data().balance ?? 0) : 0;
  if (balance !== 0) {
    const common = { session, type: 'adjustment', amount: Math.abs(balance), recordedBy: user.uid };
    await postEntry({
      ...common, phone: keep, deltaOverride: balance,
      note: `Moved from …${suffix(remove)} (merged registration)`,
      idempotencyKey: `merged_in_${digits(remove)}`,
    });
    await postEntry({
      ...common, phone: remove, deltaOverride: -balance,
      note: `Moved to …${suffix(keep)} (merged registration)`,
      idempotencyKey: `merged_out_${digits(keep)}`,
    });
  }

  // 4. The removed record goes, as a deleted student does (its account is
  //    already at zero, so closing it only marks it closed).
  await removeStudentRecord({ db, session, phone: remove, user });
  return { done: true, notesMoved: slice.length, balanceMoved: balance };
}
