import { writeFileSync, readFileSync } from 'node:fs';
import { FieldValue } from '../../api/_lib/firebaseAdmin.js';
import { markStaff, MAX_STAFF_ITEMS } from '../../api/_lib/staff.js';
import { accountRef, reverseEntries } from '../../api/_lib/ledger.js';
import { writeAudit } from '../../api/_lib/audit.js';
import { serialize, deserialize } from './feesMigration.mjs';

/**
 * 007Fixes / 11 — mark the teachers the owner confirmed (2026-11-12: 21
 * people, 29 records; #1 left as a student).
 *
 * Marks through the SAME library as the dashboard (api/_lib/staff.js), so a
 * record marked here is exactly like one marked in the browser: approved,
 * unblocked, off any waiting schedule, any debt closed as "Staff, no fee".
 *
 *   plan      what would happen, counts only; writes nothing.
 *   apply     re-checks each record (still there, not already staff), writes a
 *             backup of each record FIRST, then marks. Idempotent: a second
 *             run finds them all already staff.
 *   restore   reverses each closure through the ledger (append-only: a
 *             reversal entry, so the totals stay right whatever happened in
 *             between), puts each record back exactly, and rejoins any
 *             waiting schedule it left.
 *
 * Nothing returned or logged carries a name or a number.
 */

export const SCRIPT_ACTOR = 'system:script:007Fixes';
const recordKey = (session, phone) => `${session}__${String(phone).replace(/\D/g, '')}`;
const studentRef = (db, session, phone) => db.doc(`sessions/${session}/students/${phone}`);
const memberRef = (db, batchId, session, phone) => db.doc(`scheduledBlocks/${batchId}/members/${recordKey(session, phone)}`);

async function readTargets(db, targets) {
  const refs = targets.flatMap((t) => [studentRef(db, t.session, t.phone), accountRef(db, t.session, t.phone)]);
  const snaps = [];
  for (let i = 0; i < refs.length; i += 100) snaps.push(...(await db.getAll(...refs.slice(i, i + 100))));
  return targets.map((t, i) => {
    const student = snaps[2 * i];
    const account = snaps[2 * i + 1];
    const data = student.exists ? student.data() : null;
    const balance = account.exists ? (Number(account.data().balance) || 0) : (Number(data?.feeBalance) || 0);
    return { ...t, exists: student.exists, staff: data?.staff === true, data, balance };
  });
}

function reportOf(rows) {
  const toMark = rows.filter((r) => r.exists && !r.staff);
  const bySession = {};
  for (const r of toMark) {
    const s = (bySession[r.session] ??= { toMark: 0, totalToClose: 0 });
    s.toMark += 1;
    s.totalToClose += Math.max(0, r.balance);
  }
  return {
    targets: rows.length,
    toMark: toMark.length,
    alreadyStaff: rows.filter((r) => r.exists && r.staff).length,
    missing: rows.filter((r) => !r.exists).length,
    balancesToClose: toMark.filter((r) => r.balance > 0).length,
    totalToClose: toMark.reduce((sum, r) => sum + Math.max(0, r.balance), 0),
    bySession,
  };
}

/** Dry run: counts only, nothing written. */
export async function planMarkStaff(db, targets) {
  return reportOf(await readTargets(db, targets));
}

export async function applyMarkStaff(db, targets, { backupFile } = {}) {
  if (!backupFile) throw new Error('applyMarkStaff: a backup file is required');
  const rows = await readTargets(db, targets);
  const report = reportOf(rows);
  const toMark = rows.filter((r) => r.exists && !r.staff);
  const opId = `script${Date.now().toString(36)}`;

  // The backup first: if marking fails half way, restore still knows everyone.
  writeFileSync(backupFile, JSON.stringify({
    createdAt: new Date().toISOString(),
    opId,
    records: toMark.map((r) => ({ session: r.session, phone: r.phone, data: serialize(r.data) })),
  }, null, 1));

  let marked = 0;
  let closedTotal = 0;
  const sessions = new Set();
  for (let i = 0; i < toMark.length; i += MAX_STAFF_ITEMS) {
    const chunk = toMark.slice(i, i + MAX_STAFF_ITEMS).map((r) => ({ session: r.session, phone: r.phone }));
    const res = await markStaff({ db, user: { uid: SCRIPT_ACTOR }, items: chunk, alsoOtherSession: false, opId });
    marked += res.marked;
    closedTotal += res.closedTotal;
    res.sessions.forEach((s) => sessions.add(s));
  }
  if (marked) {
    await writeAudit({
      action: 'students.staff_marked',
      actor: SCRIPT_ACTOR,
      actorRole: 'system',
      target: 'students',
      after: { count: marked, sessions: [...sessions].sort(), closedTotal, source: '007Fixes Phase 11 (owner-confirmed list)' },
    });
  }
  return { ...report, marked, closedTotal, backupFile };
}

export async function restoreMarkStaff(db, backupFile) {
  const { opId, records } = JSON.parse(readFileSync(backupFile, 'utf8'));
  // 1. Each closure reversed through the ledger (a missing one: nothing was owed).
  const results = records.length
    ? await reverseEntries(
      records.map((r) => ({ session: r.session, phone: r.phone, entryId: `staff_${opId}_${recordKey(r.session, r.phone)}` })),
      { reason: 'Staff marking undone (007Fixes restore)', recordedBy: SCRIPT_ACTOR },
    )
    : [];
  const reversed = results.filter((r) => !r?.skipped).length;

  // 2. Each record exactly as it was (block, approval, receipt, schedule field).
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    for (const r of records.slice(i, i + 400)) batch.set(studentRef(db, r.session, r.phone), deserialize(r.data));
    await batch.commit();
  }

  // 3. Back on any schedule that is still waiting.
  let schedulesRejoined = 0;
  for (const r of records) {
    const batchId = r.data?.scheduledBlock?.batchId;
    if (!batchId) continue;
    const schedule = await db.doc(`scheduledBlocks/${batchId}`).get();
    if (!schedule.exists || schedule.data().status !== 'scheduled') continue;
    const writes = db.batch();
    writes.set(memberRef(db, batchId, r.session, r.phone), { status: 'scheduled', removedBecause: FieldValue.delete() }, { merge: true });
    writes.update(schedule.ref, { count: FieldValue.increment(1) });
    await writes.commit();
    schedulesRejoined += 1;
  }
  if (records.length) {
    await writeAudit({
      action: 'students.staff_unmarked',
      actor: SCRIPT_ACTOR,
      actorRole: 'system',
      target: 'students',
      after: { count: records.length, reversed, source: '007Fixes Phase 11 restore' },
    });
  }
  return { records: records.length, reversed, schedulesRejoined };
}
