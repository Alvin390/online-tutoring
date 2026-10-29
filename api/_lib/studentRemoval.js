import { deleteRecursively } from './sessions.js';
import { closeDeletedStudentAccount } from './ledger.js';

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
export async function removeStudentRecord({ db, session, phone, user, closeKey }) {
  const ref = db.doc(`sessions/${session}/students/${phone}`);
  const { byCollection } = await deleteRecursively(db, ref);
  const noteCount = byCollection?.notes ?? 0;

  const account = db.doc(`fees/accounts/items/${phone}`);
  const accountSnap = await account.get();
  let balanceClosed = 0;
  if (accountSnap.exists) {
    const deletedAt = new Date();
    await account.set({ studentDeletedAt: deletedAt, studentDeletedBy: user.uid }, { merge: true });
    ({ closed: balanceClosed } = await closeDeletedStudentAccount({
      phone,
      recordedBy: user.uid,
      closeKey: closeKey ?? String(deletedAt.getTime()),
    }));
  }
  return { noteCount, feeRecordRetained: accountSnap.exists, balanceClosed };
}
