import { deleteRecursively } from './sessions.js';
import { closeDeletedStudentAccount, accountRef } from './ledger.js';
import { FieldValue } from './firebaseAdmin.js';

const memberPath = (batchId, session, phone) => `scheduledBlocks/${batchId}/members/${session}__${String(phone).replace(/\D/g, '')}`;

/**
 * 006Fixes / 01: a deleted student leaves the WAITING scheduled block they
 * were in — their member is marked removed and the schedule's count drops, as
 * "Cancel schedule" does. Before this the record went but the count stayed
 * (the sweep skipped the missing student; the panel over-counted for ever).
 * Adds to `writes`; `schedules` maps batchId -> that schedule's data (or null).
 */
export function leaveSchedulesOnDelete({ db, writes, user, members, schedules }) {
  const perBatch = new Map();
  for (const m of members) {
    const schedule = schedules.get(m.batchId);
    if (!schedule || schedule.status !== 'scheduled') continue;
    writes.set(db.doc(memberPath(m.batchId, m.session, m.phone)), { status: 'removed', removedBecause: 'deleted' }, { merge: true });
    perBatch.set(m.batchId, (perBatch.get(m.batchId) ?? 0) + 1);
  }
  for (const [id, n] of perBatch) {
    writes.update(db.doc(`scheduledBlocks/${id}`), {
      count: FieldValue.increment(-n),
      lastChangedBy: { uid: user.uid, email: user.email ?? null, device: user.device ?? null },
    });
  }
  return perBatch.size;
}

/**
 * Removing a student record — shared by /api/student/remove and the duplicate
 * actions (003Fixes / 12), so a declined or merged duplicate is removed exactly
 * as a deleted student is.
 *
 * The record and everything under it (notes, activity) are deleted in batched
 * commits. The fee account is KEPT — the ledger is append-only history — but
 * marked as belonging to a deleted student, and any balance is closed so
 * "Total outstanding" stays right.
 *
 * @returns {Promise<{ noteCount: number, feeRecordRetained: boolean, balanceClosed: number }>}
 */
export async function removeStudentRecord({ db, session, phone, user, closeKey, data }) {
  const ref = db.doc(`sessions/${session}/students/${phone}`);
  // 006Fixes / 01: out of a waiting scheduled block first (callers that have
  // the record pass it; the others cost one read).
  const record = data ?? (await ref.get()).data();
  const batchId = record?.scheduledBlock?.batchId;
  if (batchId) {
    const scheduleSnap = await db.doc(`scheduledBlocks/${batchId}`).get();
    const writes = db.batch();
    const touched = leaveSchedulesOnDelete({
      db, writes, user, members: [{ batchId, session, phone }],
      schedules: new Map([[batchId, scheduleSnap.exists ? scheduleSnap.data() : null]]),
    });
    if (touched) await writes.commit();
  }
  const { byCollection } = await deleteRecursively(db, ref);
  const noteCount = byCollection?.notes ?? 0;

  // 004Fixes / 06: only this registration's account. The same number in the
  // other session keeps its balance (a delete never writes off its debt).
  const account = accountRef(db, session, phone);
  const accountSnap = await account.get();
  let balanceClosed = 0;
  if (accountSnap.exists) {
    const deletedAt = new Date();
    await account.set({ studentDeletedAt: deletedAt, studentDeletedBy: user.uid }, { merge: true });
    ({ closed: balanceClosed } = await closeDeletedStudentAccount({
      session,
      phone,
      recordedBy: user.uid,
      closeKey: closeKey ?? String(deletedAt.getTime()),
    }));
  }
  return { noteCount, feeRecordRetained: accountSnap.exists, balanceClosed };
}
