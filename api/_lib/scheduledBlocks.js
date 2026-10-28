import { FieldValue, Timestamp } from './firebaseAdmin.js';
import { badRequest, forbidden, notFound } from './errors.js';
import { openBatch, applyStudents, MAX_ITEMS } from './bulkStudents.js';
import { subrequestsRemaining } from './firestoreRest.js';

/**
 * Scheduled blocks — 003Fixes / 07.
 *
 * A schedule is `scheduledBlocks/{id}`: when, and what kind of block (unpaid
 * fees with an amount, or a reason). A single student's schedule is a batch
 * of one. Each member student carries `scheduledBlock: { at, atMs, batchId,
 * kind, reason }` — THE source of truth for "is this student scheduled":
 *
 *   - check-in and the class link enforce it from the minute it is due
 *     (studentState.isBlockedNow), with no timer and no extra read;
 *   - the dashboard shows the tag from the roster it already listens to;
 *   - paying before the time deletes it (ledger payments, receipt approval).
 *
 * `members/{session}__{digits}` only lists who to visit when the time comes;
 * the sweep re-checks each student's own field before blocking anyone.
 *
 * While a schedule is waiting it carries `dueAtMs` (removed once applied or
 * cancelled), so the per-minute sweep finds due ones with a single-field
 * range query and no composite index.
 */

export const MIN_LEAD_MS = 5 * 60_000;
export const MAX_LEAD_MS = 60 * 24 * 60 * 60_000;
export const MAX_CREATE_ITEMS = 25;

const memberId = (session, phone) => `${session}__${String(phone).replace(/\D/g, '')}`;
const scheduleRef = (db, id) => db.doc(`scheduledBlocks/${id}`);
const memberRef = (db, id, session, phone) => db.doc(`scheduledBlocks/${id}/members/${memberId(session, phone)}`);
const studentRef = (db, session, phone) => db.doc(`sessions/${session}/students/${phone}`);

export function assertWhen(atMs, nowMs) {
  if (!Number.isFinite(atMs)) throw badRequest('Choose when the block should start.', 'bad_time');
  if (atMs < nowMs + MIN_LEAD_MS) throw badRequest('Choose a time at least 5 minutes from now.', 'too_soon');
  if (atMs > nowMs + MAX_LEAD_MS) throw badRequest('Choose a time within the next 60 days.', 'too_far');
}

async function ownSchedule(db, user, id) {
  const ref = scheduleRef(db, id);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('That scheduled block was not found.', 'schedule_not_found');
  const data = snap.data();
  if (data.uid !== user.uid && user.role !== 'superadmin') throw forbidden('That schedule belongs to someone else.', 'schedule_forbidden');
  if (data.status !== 'scheduled') throw badRequest('That block has already started or was cancelled.', 'schedule_closed');
  return { ref, data };
}

/** Creates a schedule, or adds students to one (same teacher, still waiting). */
export async function createSchedule({ db, user, batchId = null, items, atMs, kind, amount = null, reason = null, nowMs }) {
  let ref;
  let data;
  if (batchId) {
    ({ ref, data } = await ownSchedule(db, user, batchId));
  } else {
    assertWhen(atMs, nowMs);
    ref = db.collection('scheduledBlocks').doc();
    data = {
      uid: user.uid,
      at: Timestamp.fromMillis(atMs),
      atMs,
      dueAtMs: atMs,
      kind,
      amount: kind === 'fees' ? amount : null,
      reason: kind === 'fees' ? null : (reason ?? ''),
      status: 'scheduled',
      createdAtMs: nowMs,
    };
  }

  const seen = new Set();
  const list = items.filter((i) => !seen.has(memberId(i.session, i.phone)) && seen.add(memberId(i.session, i.phone)));
  const snaps = await db.getAll(...list.map((i) => studentRef(db, i.session, i.phone)));
  const field = {
    at: data.at, atMs: data.atMs, batchId: ref.id, kind: data.kind, reason: data.reason ?? null,
  };

  const writes = db.batch();
  let added = 0;
  let missing = 0;
  list.forEach((item, i) => {
    if (!snaps[i].exists) { missing += 1; return; }
    const previous = snaps[i].data().scheduledBlock;
    // One schedule per student: an earlier one gives way to this one.
    if (previous?.batchId && previous.batchId !== ref.id) {
      writes.set(memberRef(db, previous.batchId, item.session, item.phone), { status: 'removed', removedBecause: 'rescheduled' }, { merge: true });
    }
    writes.set(memberRef(db, ref.id, item.session, item.phone), { session: item.session, phone: item.phone, status: 'scheduled' });
    writes.set(studentRef(db, item.session, item.phone), { scheduledBlock: field }, { merge: true });
    added += 1;
  });
  if (batchId) writes.update(ref, { count: FieldValue.increment(added) });
  else writes.set(ref, { ...data, count: added });
  await writes.commit();

  return { batchId: ref.id, added, skipped: missing ? { missing } : {}, atMs: data.atMs };
}

/** This teacher's waiting schedules, soonest first. */
export async function listSchedules({ db, user }) {
  const snap = await db.collection('scheduledBlocks').where('dueAtMs', '>=', 0).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.uid === user.uid && s.status === 'scheduled')
    .sort((a, b) => a.atMs - b.atMs)
    .map((s) => ({ id: s.id, atMs: s.atMs, kind: s.kind, amount: s.amount ?? null, reason: s.reason ?? null, count: s.count ?? 0 }));
}

/**
 * Visits a schedule's waiting members, and for each student still carrying
 * this schedule writes `studentFields(field)` (or deletes the field).
 */
async function forEachMember(db, id, onStudent, memberUpdate) {
  const members = await scheduleRef(db, id).collection('members').where('status', '==', 'scheduled').get();
  const docs = members.docs.map((d) => ({ ref: d.ref, ...d.data() }));
  for (let start = 0; start < docs.length; start += 200) {
    const chunk = docs.slice(start, start + 200);
    const snaps = await db.getAll(...chunk.map((m) => studentRef(db, m.session, m.phone)));
    const writes = db.batch();
    chunk.forEach((m, i) => {
      const current = snaps[i].exists ? snaps[i].data().scheduledBlock : null;
      if (current?.batchId === id) onStudent(writes, studentRef(db, m.session, m.phone), current);
      if (memberUpdate) writes.set(m.ref, memberUpdate, { merge: true });
    });
    await writes.commit();
  }
  return docs.length;
}

export async function rescheduleSchedule({ db, user, batchId, atMs, nowMs }) {
  const { ref } = await ownSchedule(db, user, batchId);
  assertWhen(atMs, nowMs);
  const at = Timestamp.fromMillis(atMs);
  await ref.update({ at, atMs, dueAtMs: atMs });
  await forEachMember(db, batchId, (writes, sRef, current) => {
    writes.set(sRef, { scheduledBlock: { ...current, at, atMs } }, { merge: true });
  });
  return { batchId, atMs };
}

export async function cancelSchedule({ db, user, batchId }) {
  const { ref } = await ownSchedule(db, user, batchId);
  const visited = await forEachMember(db, batchId, (writes, sRef) => {
    writes.set(sRef, { scheduledBlock: FieldValue.delete() }, { merge: true });
  }, { status: 'removed', removedBecause: 'cancelled' });
  await ref.update({ status: 'cancelled', dueAtMs: FieldValue.delete(), count: 0 });
  return { batchId, cancelled: visited };
}

export async function removeMember({ db, user, batchId, session, phone }) {
  const { ref } = await ownSchedule(db, user, batchId);
  const sRef = studentRef(db, session, phone);
  const snap = await sRef.get();
  const writes = db.batch();
  if (snap.exists && snap.data().scheduledBlock?.batchId === batchId) {
    writes.set(sRef, { scheduledBlock: FieldValue.delete() }, { merge: true });
  }
  writes.set(memberRef(db, batchId, session, phone), { status: 'removed', removedBecause: 'removed' }, { merge: true });
  writes.update(ref, { count: FieldValue.increment(-1) });
  await writes.commit();
  return { batchId, removed: 1 };
}

/**
 * The per-minute sweep: applies due schedules as ordinary bulk blocks (same
 * skip rules, fees posted at THIS moment, an Undo record in the teacher's
 * Recent actions), a chunk at a time while the budget lasts.
 */
export async function applyDueSchedules({ db, nowMs, log }) {
  const out = { schedules: 0, blocked: 0, skipped: 0, notScheduled: 0, failed: 0, finished: 0 };
  const due = await db.collection('scheduledBlocks').where('dueAtMs', '<=', nowMs).limit(3).get();

  for (const doc of due.docs) {
    const schedule = doc.data();
    out.schedules += 1;
    for (;;) {
      if (subrequestsRemaining() < 12) return out;
      const chunkSize = schedule.kind === 'fees' ? MAX_ITEMS.blockFees : MAX_ITEMS.block;
      const members = await doc.ref.collection('members').where('status', '==', 'scheduled').limit(chunkSize).get();
      if (members.empty) {
        await doc.ref.update({ status: 'applied', dueAtMs: FieldValue.delete(), appliedAtMs: nowMs });
        out.finished += 1;
        break;
      }
      const list = members.docs.map((d) => ({ ref: d.ref, ...d.data() }));
      const snaps = await db.getAll(...list.map((m) => studentRef(db, m.session, m.phone)));
      // Only students still carrying THIS schedule (not paid, moved or cancelled since).
      const ours = list.filter((m, i) => snaps[i].exists && snaps[i].data().scheduledBlock?.batchId === doc.id);
      const owner = { uid: schedule.uid, role: 'teacher' };

      let bulkId = schedule.bulkActionId ?? null;
      let result = { outcomes: {} };
      if (ours.length) {
        let batch;
        try {
          batch = await openBatch({
            db, user: owner, batchId: bulkId, action: 'block', kind: schedule.kind, amount: schedule.amount,
            reason: schedule.reason, nowMs, source: 'scheduled',
          });
        } catch {
          // The first chunk's undo window has closed (a very long schedule): a new record.
          batch = await openBatch({ db, user: owner, action: 'block', kind: schedule.kind, amount: schedule.amount, reason: schedule.reason, nowMs, source: 'scheduled' });
        }
        bulkId = batch.id;
        result = await applyStudents({
          db, user: owner, batch, action: 'block', kind: schedule.kind, amount: schedule.amount, reason: schedule.reason,
          items: ours.map((m) => ({ session: m.session, phone: m.phone })), nowMs, recordedBy: 'system:scheduledBlocks',
        });
      }

      const writes = db.batch();
      list.forEach((m, i) => {
        const key = `${m.session}__${String(m.phone).replace(/\D/g, '')}`;
        const isOurs = snaps[i].exists && snaps[i].data().scheduledBlock?.batchId === doc.id;
        const outcome = isOurs ? (result.outcomes[key] ?? 'failed') : 'notScheduled';
        writes.set(m.ref, { status: outcome === 'done' ? 'applied' : outcome === 'failed' ? 'scheduled' : 'skipped', outcome }, { merge: true });
        // The schedule is spent for this student either way (blocked, or skipped by the rules).
        if (isOurs && outcome !== 'failed') writes.set(studentRef(db, m.session, m.phone), { scheduledBlock: FieldValue.delete() }, { merge: true });
        if (outcome === 'done') out.blocked += 1;
        else if (outcome === 'notScheduled') out.notScheduled += 1;
        else if (outcome === 'failed') out.failed += 1;
        else out.skipped += 1;
      });
      if (bulkId && bulkId !== schedule.bulkActionId) {
        writes.update(doc.ref, { bulkActionId: bulkId });
        schedule.bulkActionId = bulkId;
      }
      await writes.commit();
      // Students whose charge failed stay scheduled; try them on the next run.
      if (list.every((m, i) => {
        const key = `${m.session}__${String(m.phone).replace(/\D/g, '')}`;
        return snaps[i].exists && snaps[i].data().scheduledBlock?.batchId === doc.id && (result.outcomes[key] ?? 'failed') === 'failed';
      })) {
        log?.warn('Scheduled block chunk failed entirely; will retry', { schedule: doc.id });
        break;
      }
    }
  }
  return out;
}
