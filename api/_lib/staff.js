import { FieldValue } from './firebaseAdmin.js';
import { postEntries, accountRef } from './ledger.js';
import { leaveSchedulesOnDelete } from './studentRemoval.js';
import { effectiveApprovalStatus } from './studentState.js';
import { reservationId } from './admissionNumber.js';

/**
 * 008Fixes / 02 (owner answer 10): a number changes kind with the marker.
 * Marking turns admission number N into staff number S-N (unmarking, the
 * reverse); the old number is freed either way. When the new one is already
 * taken the record is left without a number, and they choose one at their
 * next check-in. `from`/`to` are the record fields. Adds to `writes`, and
 * returns the record fields to merge. One getAll for the whole chunk.
 */
async function convertNumbers(db, writes, records, { from, to }) {
  const fromKind = from === 'admissionNumber' ? 'student' : 'staff';
  const toKind = fromKind === 'student' ? 'staff' : 'student';
  const holding = records.filter((r) => r.data[from]);
  const fields = new Map(records.map((r) => [r, {}]));
  if (!holding.length) return fields;
  const ref = (r, kind) => db.doc(`sessions/${r.session}/numbers/${reservationId(kind, r.data[from])}`);
  const snaps = await db.getAll(...holding.map((r) => ref(r, fromKind)), ...holding.map((r) => ref(r, toKind)));
  holding.forEach((r, i) => {
    const old = snaps[i];
    const target = snaps[holding.length + i];
    if (old.exists && old.data().phone === r.phone) writes.delete(ref(r, fromKind));
    const f = { [from]: FieldValue.delete() };
    if (!target.exists) {
      // create(): if another registration takes it at the same instant, the
      // whole commit fails untouched and the retry sees it taken.
      writes.create(ref(r, toKind), { phone: r.phone, kind: toKind, number: r.data[from], at: FieldValue.serverTimestamp() });
      f[to] = r.data[from];
    }
    fields.set(r, f);
  });
  return fields;
}

/**
 * Staff registrations — 007Fixes / 07 (owner, 2026-11-11).
 *
 * Teachers join the class through the session page, so they are registrations
 * like any student. A registration marked `staff` is a teacher: let in for
 * good, never charged, blocked, held or counted as a student (Phase 08/09),
 * but still given the class link. Marking is per registration; the same number
 * in another session is marked only when asked (`alsoOtherSession`).
 *
 * MARK, per chunk: one read of every record and its fee account, one ledger
 * transaction closing every debt ("Staff, no fee", the entry the 2026-11-04
 * correction used), then one commit for the records and any schedule they
 * leave. If the ledger fails, nobody is marked. UNMARK removes the marker
 * only: a closed balance stays closed, and a later block charges as usual.
 *
 * Shared by POST /api/students/staff and the Phase 11 script, so both mark
 * exactly the same way. Nothing here returns or logs a phone number: skips are
 * reported by the caller's index, closed balances by session and amount.
 */

/** Records per call (before `alsoOtherSession` adds the other registrations). */
export const MAX_STAFF_ITEMS = 25;
export const STAFF_CLOSE_NOTE = 'Staff, no fee';

const digits = (phone) => String(phone).replace(/\D/g, '');
const recordKey = (session, phone) => `${session}__${digits(phone)}`;
const studentRef = (db, session, phone) => db.doc(`sessions/${session}/students/${phone}`);

/** The caller's items, indexed, then (if asked) the same numbers in every other active session. */
async function recordsFor(db, items, alsoOtherSession) {
  const seen = new Map();
  items.forEach((item, index) => {
    const k = recordKey(item.session, item.phone);
    if (!seen.has(k)) seen.set(k, { session: item.session, phone: item.phone, index, named: true });
  });
  if (alsoOtherSession) {
    const active = (await db.collection('sessions').where('active', '==', true).get()).docs.map((d) => d.id);
    items.forEach((item, index) => {
      for (const session of active) {
        const k = recordKey(session, item.phone);
        if (!seen.has(k)) seen.set(k, { session, phone: item.phone, index, named: false });
      }
    });
  }
  return [...seen.values()];
}

/**
 * @returns {{ marked: number, closedBalances: Array<{session, amount}>, closedTotal: number,
 *   skipped: Array<{index, reason}>, sessions: string[] }}
 */
export async function markStaff({ db, user, items, alsoOtherSession = false, opId }) {
  const records = await recordsFor(db, items, alsoOtherSession);
  const snaps = await db.getAll(
    ...records.map((r) => studentRef(db, r.session, r.phone)),
    ...records.map((r) => accountRef(db, r.session, r.phone)),
  );
  const skipped = [];
  const toMark = [];
  records.forEach((r, i) => {
    const snap = snaps[i];
    // A number with no registration in another session is simply not there.
    if (!snap.exists) { if (r.named) skipped.push({ index: r.index, reason: 'missing' }); return; }
    const data = snap.data();
    if (data.staff === true) { if (r.named) skipped.push({ index: r.index, reason: 'alreadyStaff' }); return; }
    const account = snaps[records.length + i];
    // The account is the ledger's truth (004Fixes / 06); feeBalance mirrors it.
    const balance = account.exists ? (Number(account.data().balance) || 0) : (Number(data.feeBalance) || 0);
    toMark.push({ ...r, data, balance });
  });

  // Every debt closed in ONE transaction, before anyone is marked: if it
  // fails, the whole chunk fails untouched. Keyed by the operation, so a retry
  // of the same call never closes twice, and a later marking closes afresh.
  const closing = toMark.filter((r) => r.balance > 0);
  if (closing.length) {
    await postEntries(closing.map((r) => ({
      phone: r.phone,
      session: r.session,
      type: 'adjustment',
      amount: r.balance,
      deltaOverride: -r.balance,
      note: STAFF_CLOSE_NOTE,
      recordedBy: user.uid,
      idempotencyKey: `staff_${opId}_${recordKey(r.session, r.phone)}`,
    })));
  }

  // Out of any waiting scheduled block, as a deleted student is (each schedule read once).
  const members = toMark
    .filter((r) => r.data.scheduledBlock?.batchId)
    .map((r) => ({ batchId: r.data.scheduledBlock.batchId, session: r.session, phone: r.phone }));
  const writes = db.batch();
  if (members.length) {
    const ids = [...new Set(members.map((m) => m.batchId))];
    const scheduleSnaps = await db.getAll(...ids.map((id) => db.doc(`scheduledBlocks/${id}`)));
    const schedules = new Map(ids.map((id, k) => [id, scheduleSnaps[k].exists ? scheduleSnaps[k].data() : null]));
    leaveSchedulesOnDelete({ db, writes, user, members, schedules, because: 'staff' });
  }

  const numbers = await convertNumbers(db, writes, toMark, { from: 'admissionNumber', to: 'staffNumber' });
  const now = FieldValue.serverTimestamp();
  for (const r of toMark) {
    const wasBlocked = r.data.blocked === true;
    writes.set(studentRef(db, r.session, r.phone), {
      ...numbers.get(r),
      staff: true,
      staffAt: now,
      staffBy: user.uid,
      // Let in for good.
      blocked: false,
      blockReason: '',
      blockedAt: null,
      ...(wasBlocked ? { unblockedAt: now } : {}),
      receiptStatus: 'approved',
      pendingReceipt: null,
      scheduledBlock: FieldValue.delete(),
      duplicateHold: FieldValue.delete(),
      duplicateOf: FieldValue.delete(),
      partialPayment: FieldValue.delete(),
      // Pending or rejected: the teacher has decided this is staff (ruling).
      ...(effectiveApprovalStatus(r.data) !== 'approved'
        ? { approvalStatus: 'approved', approvedAt: now, approvedBy: user.uid }
        : {}),
    }, { merge: true });
  }
  if (toMark.length || members.length) await writes.commit();

  const closedBalances = closing.map((r) => ({ session: r.session, amount: r.balance }));
  return {
    marked: toMark.length,
    closedBalances,
    closedTotal: closedBalances.reduce((sum, c) => sum + c.amount, 0),
    skipped,
    sessions: [...new Set(toMark.map((r) => r.session))].sort(),
  };
}

/** Removes the marker only. @returns {{ unmarked, skipped, sessions }} */
export async function unmarkStaff({ db, items }) {
  const records = items.map((item, index) => ({ ...item, index }));
  const snaps = await db.getAll(...records.map((r) => studentRef(db, r.session, r.phone)));
  const skipped = [];
  const writes = db.batch();
  const done = [];
  records.forEach((r, i) => {
    if (!snaps[i].exists) { skipped.push({ index: r.index, reason: 'missing' }); return; }
    if (snaps[i].data().staff !== true) { skipped.push({ index: r.index, reason: 'notStaff' }); return; }
    done.push({ ...r, data: snaps[i].data() });
  });
  const numbers = await convertNumbers(db, writes, done, { from: 'staffNumber', to: 'admissionNumber' });
  for (const r of done) {
    writes.set(studentRef(db, r.session, r.phone), {
      ...numbers.get(r),
      staff: FieldValue.delete(), staffAt: FieldValue.delete(), staffBy: FieldValue.delete(),
    }, { merge: true });
  }
  if (done.length) await writes.commit();
  return { unmarked: done.length, skipped, sessions: [...new Set(done.map((r) => r.session))].sort() };
}
