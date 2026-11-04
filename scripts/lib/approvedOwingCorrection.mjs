/**
 * 006Fixes / 10 — the one-off correction of the records approved with no money
 * recorded (owner, 4 Nov 2026; issues/006Fixes/ISSUES.md "The 20").
 *
 * Before 006Fixes, Approve on a student's row approved the receipt and lifted
 * the block but recorded no payment, so 20 students showed as owing 2,750
 * (the whole KES 55,000 outstanding). The owner ruled:
 *   - staff   ("Focus online staff"): close the balance — an adjustment,
 *             "Staff, no fee (006Fixes correction)";
 *   - partial: record what the receipt shows was paid, and mark it (the
 *             "Partial payment" filter then lists them, owing the rest);
 *   - full:    record 2,750 paid.
 *
 * Every write goes through the app's own ledger (postEntry): the entry, the
 * account balance, the student's feeBalance and the per-session aggregates in
 * one transaction, under a fixed idempotency key, so a second run writes
 * nothing. Each target is re-checked first and SKIPPED (reported, untouched)
 * if the teacher has acted since the snapshot:
 *   - the record is gone, blocked again, or its receipt is no longer approved;
 *   - its ledger no longer holds the original block charge;
 *   - a payment, adjustment or reversal was posted after the snapshot.
 * A later CHARGE (a monthly invoice, a new block) is kept: the correction
 * still posts only the owner's amounts.
 *
 * Targets come from a local, untracked file (full numbers); the report has
 * counts and 6-character hashes only.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { postEntry } from '../../api/_lib/ledger.js';
import { serialize, deserialize } from './feesMigration.mjs';

export const RECORDED_BY = 'system:006fixes';
const BLOCK_CHARGE_NOTE = 'Fees due — recorded when blocking';
const GROUPS = ['staff', 'partial', 'full'];
const tag = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 6);
const keyFor = (t) => `006fix_${t.group}_${t.session}__${t.phone}`;
const ms = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v ?? ''));

function assertTarget(t) {
  if (!GROUPS.includes(t.group)) throw new Error(`Unknown group ${t.group}`);
  if (!t.session || !/^\+\d{6,15}$/.test(t.phone ?? '')) throw new Error('Each target needs a session and an E.164 phone');
  if (t.group !== 'staff' && !(Number.isInteger(t.amount) && t.amount > 0)) throw new Error(`A ${t.group} target needs a whole-KES amount`);
}

/**
 * The ledger entry (postEntry options) for a target: `amount` is what it
 * records (staff: the balance closed), `owed` what the student owed before.
 */
function entryFor(t, amount, owed) {
  const base = { phone: t.phone, session: t.session, recordedBy: RECORDED_BY, idempotencyKey: keyFor(t) };
  if (t.group === 'staff') {
    return { ...base, type: 'adjustment', amount, deltaOverride: -amount, note: 'Staff, no fee (006Fixes correction)' };
  }
  const occurredAt = t.paidOn ? new Date(`${t.paidOn}T12:00:00+03:00`) : null;
  const partial = t.group === 'partial';
  return {
    ...base,
    type: 'payment',
    amount,
    method: 'mpesa',
    reference: t.code ?? null,
    ...(occurredAt ? { occurredAt } : {}),
    note: partial
      ? 'Recorded from the approved receipt (006Fixes correction, partial)'
      : 'Recorded from the approved receipt (006Fixes correction)',
    ...(partial ? {
      partialPayment: { paid: amount, owedBefore: owed, owedAfter: owed - amount, at: occurredAt ?? new Date(), by: RECORDED_BY, receiptId: null },
    } : {}),
  };
}

/**
 * Reads every target and decides. Never writes.
 * @param {number} opts.snapshotMs  the evidence snapshot: entries posted after it count as "changed since"
 */
export async function planCorrection(db, targets, { snapshotMs }) {
  const plans = [];
  const report = {
    targets: targets.length, toApply: 0, alreadyDone: 0, skipped: {},
    byGroup: { staff: 0, partial: 0, full: 0 }, closedStaff: 0, paidPartial: 0, paidFull: 0, outstandingAfter: 0,
    skippedSamples: [],
  };
  const skip = (t, why) => {
    report.skipped[why] = (report.skipped[why] ?? 0) + 1;
    report.skippedSamples.push({ record: tag(`${t.session}/${t.phone}`), group: t.group, why });
  };

  for (const t of targets) {
    assertTarget(t);
    const studentSnap = await db.doc(`sessions/${t.session}/students/${t.phone}`).get();
    const entries = (await db.collection(`fees/accounts/items/${t.session}__${t.phone}/ledger`).get()).docs;
    if (entries.some((d) => d.id === keyFor(t))) { report.alreadyDone += 1; continue; }
    if (!studentSnap.exists) { skip(t, 'missing'); continue; }
    const s = studentSnap.data();
    if (s.blocked === true) { skip(t, 'blocked'); continue; }
    if (s.receiptStatus !== 'approved') { skip(t, 'receiptNotApproved'); continue; }
    const data = entries.map((d) => d.data());
    if (!data.some((e) => e.type === 'invoice' && e.note === BLOCK_CHARGE_NOTE)) { skip(t, 'noBlockCharge'); continue; }
    const changed = data.some((e) => ['payment', 'adjustment', 'reversal'].includes(e.type) && ms(e.recordedAt ?? e.occurredAt) > snapshotMs);
    if (changed) { skip(t, 'changedSince'); continue; }

    const owed = Number(s.feeBalance) || 0;
    if (owed <= 0) { skip(t, 'nothingOwed'); continue; }
    if (t.group === 'partial' && t.amount >= owed) { skip(t, 'amountNotPartial'); continue; }
    // Staff close the 2,750 block charge; payments are the owner's amounts.
    // A later charge (kept) stays owing either way.
    const amount = t.group === 'staff' ? Math.min(owed, 2750) : t.amount;
    const entry = entryFor(t, amount, owed);
    plans.push({ target: t, entry, owedBefore: owed });
    report.toApply += 1;
    report.byGroup[t.group] += 1;
    if (t.group === 'staff') report.closedStaff += amount;
    if (t.group === 'partial') report.paidPartial += amount;
    if (t.group === 'full') report.paidFull += amount;
    report.outstandingAfter += owed - amount;
  }
  if (!report.skippedSamples.length) delete report.skippedSamples;
  return { plans, report };
}

/** Saves a before-image of every document it will touch, then posts. */
export async function applyCorrection(db, targets, { backupFile, snapshotMs }) {
  if (!backupFile) throw new Error('applyCorrection: a backup file is required');
  const { plans, report } = await planCorrection(db, targets, { snapshotMs });
  const paths = new Set(['aggregates/dashboard']);
  for (const { target: t } of plans) {
    paths.add(`sessions/${t.session}/students/${t.phone}`);
    paths.add(`fees/accounts/items/${t.session}__${t.phone}`);
    paths.add(`fees/accounts/items/${t.session}__${t.phone}/ledger/${keyFor(t)}`);
  }
  const refs = [...paths].map((p) => db.doc(p));
  const before = [];
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    snaps.forEach((snap, k) => before.push({ path: refs[i + k].path, existed: snap.exists, data: snap.exists ? serialize(snap.data()) : null }));
  }
  writeFileSync(backupFile, JSON.stringify({ createdAt: new Date().toISOString(), documents: before }, null, 1));

  let applied = 0;
  for (const p of plans) {
    const res = await postEntry(p.entry);
    if (!res.duplicate) applied += 1;
  }
  return { ...report, applied, backupFile };
}

/** Puts every backed-up document back exactly (the entries it posted are deleted). */
export async function restoreCorrection(db, backupFile) {
  const { documents } = JSON.parse(readFileSync(backupFile, 'utf8'));
  for (let i = 0; i < documents.length; i += 400) {
    const batch = db.batch();
    for (const d of documents.slice(i, i + 400)) {
      if (d.existed) batch.set(db.doc(d.path), deserialize(d.data));
      else batch.delete(db.doc(d.path));
    }
    await batch.commit();
  }
  return { restored: documents.length };
}
