/**
 * 004Fixes / 10 — split legacy per-number fee accounts into per-session ones.
 *
 * Before 004Fixes one account per phone, `fees/accounts/items/{phone}`, was
 * shared by the same number's registrations in both sessions (a morning
 * payment cleared the evening debt; a second fee block showed 5,500). The
 * owner's rule since: each session's registration is its own student for
 * money. The code now keys accounts `{session}__{phone}`; this moves the data.
 *
 * For every legacy account (an id without `__`):
 *   1. its entries are grouped by each entry's own `session` (falling back to
 *      the account's); an entry with neither is reported and NOT moved;
 *   2. each group is copied to `{session}__{phone}/ledger/` with the SAME entry
 *      ids (`migratedFrom` added), so a re-run never duplicates;
 *   3. each new account's balance is recomputed as the sum of every entry now
 *      in its ledger — including anything the new code posted before this ran
 *      — and written to the account and to that session's student record;
 *   4. the legacy account is kept as history, marked `migratedAt`/`migratedTo`;
 *   5. blocked flags are never touched: mismatches are REPORTED for the owner;
 *      a DELETED registration's split balance is closed to 0, as a delete does;
 *   6. `aggregates/dashboard` gets `totalOutstanding` and `bySession` rebuilt.
 *
 * Writes only what differs, so a second run writes nothing. `apply` first
 * saves the before-image of every document it will write (`restoreBackup`
 * puts them back exactly: a document that did not exist is deleted again).
 * The report carries counts and 6-character hashes only — no names or numbers.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { Timestamp } from '../../api/_lib/firestoreRest.js';
import { accountKey, collectedMonthKey } from '../../api/_lib/ledger.js';

const ACCOUNTS = 'fees/accounts/items';
const AGGREGATES = 'aggregates/dashboard';
const tag = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 6);
const millis = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : null);

/** JSON-safe copy with Timestamps marked, for the backup and for comparisons. */
export function serialize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp || typeof value?.toMillis === 'function') return { __ts: value.toMillis() };
  if (value instanceof Date) return { __ts: value.getTime() };
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  return value;
}
export function deserialize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(deserialize);
  if (typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.__ts === 'number') return Timestamp.fromMillis(value.__ts);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deserialize(v)]));
  }
  return value;
}
const same = (a, b) => JSON.stringify(serialize(a)) === JSON.stringify(serialize(b));

function validKey(session, phone) {
  try { return accountKey(session, phone); } catch { return null; }
}

/**
 * Reads everything and works out the writes. Never writes.
 * @returns {Promise<{ writes: Array<{path: string, data: object}>, report: object }>}
 */
export async function planMigration(db, { nowMs = Date.now() } = {}) {
  const accounts = (await db.collection(ACCOUNTS).get()).docs;
  const legacy = accounts.filter((d) => !d.id.includes('__'));
  const existingNew = new Map(accounts.filter((d) => d.id.includes('__')).map((d) => [d.id, d.data()]));

  const writes = [];
  // `merge`: only the named fields (a student record), never a whole-record
  // rewrite that could undo a check-in landing while this runs.
  const write = (path, data, merge = false) => writes.push({ path, data, merge });
  const report = {
    legacyAccounts: legacy.length,
    alreadyPerSession: existingNew.size,
    singleSession: 0,
    split: 0,
    markers: 0,
    empty: 0,
    entriesSeen: 0,
    entriesCopied: 0,
    entriesAlreadyThere: 0,
    accountsWritten: 0,
    recordsFeeBalanceChanged: [],
    // Deleted registrations whose split balance was closed to 0 (see below).
    closedOnMigration: [],
    review: { unassignedEntries: [], balanceWithoutEntries: [], crossSessionReversals: [], blockedOwingNothing: [], owingNotBlocked: [] },
  };

  // Final per-session account state: key → { session, balance, ledger: entry data[] }.
  const finals = new Map();
  let unassignedTotal = 0;

  for (const acc of legacy) {
    const phone = acc.id;
    const data = acc.data();
    const entries = (await acc.ref.collection('ledger').get()).docs;
    report.entriesSeen += entries.length;

    if (!entries.length) {
      if (data.phoneChanged) report.markers += 1;
      else if ((data.balance ?? 0) !== 0) report.review.balanceWithoutEntries.push({ account: tag(phone), balance: data.balance });
      else report.empty += 1;
      continue;
    }

    const groups = new Map();
    for (const e of entries) {
      const s = e.data().session ?? data.session ?? null;
      const key = s ? validKey(s, phone) : null;
      if (!key) {
        report.review.unassignedEntries.push({ account: tag(phone), entry: tag(e.id), amount: e.data().amount ?? 0 });
        unassignedTotal += e.data().amount ?? 0;
        continue;
      }
      if (!groups.has(key)) groups.set(key, { session: s, entries: [] });
      groups.get(key).entries.push(e);
    }
    if (groups.size === 1) report.singleSession += 1;
    if (groups.size > 1) report.split += 1;

    // Reversals whose original sits in another session (reported, not fixed).
    const sessionOfEntry = new Map(entries.map((e) => [e.id, e.data().session ?? data.session ?? null]));
    for (const e of entries) {
      const r = e.data().reversesEntryId;
      if (r && sessionOfEntry.has(r) && sessionOfEntry.get(r) !== sessionOfEntry.get(e.id)) {
        report.review.crossSessionReversals.push({ account: tag(phone), entry: tag(e.id) });
      }
    }

    for (const [key, { session, entries: list }] of groups) {
      const targetRef = db.doc(`${ACCOUNTS}/${key}`);
      const existingLedger = (await targetRef.collection('ledger').get()).docs;
      const have = new Map(existingLedger.map((d) => [d.id, d.data()]));
      for (const e of list) {
        if (have.has(e.id)) { report.entriesAlreadyThere += 1; continue; }
        const copy = { ...e.data(), migratedFrom: `${ACCOUNTS}/${phone}/ledger/${e.id}` };
        write(`${ACCOUNTS}/${key}/ledger/${e.id}`, copy);
        have.set(e.id, copy);
        report.entriesCopied += 1;
      }
      const studentRef = db.doc(`sessions/${session}/students/${phone}`);
      const studentSnap = await studentRef.get();
      let balance = [...have.values()].reduce((sum, e) => sum + (e.amount ?? 0), 0);

      // A deleted registration's balance is closed to exactly 0, as a delete
      // does (closeDeletedStudentAccount, same entry shape). Before 004Fixes
      // the close ran on the SHARED account and could take the other session's
      // balance with it (4 Nov dry run: 5 such accounts); split by session that
      // left a closed account in credit or still owing.
      if (!studentSnap.exists && balance !== 0) {
        const close = {
          type: 'adjustment', amount: -balance, magnitude: Math.abs(balance), method: null, reference: null,
          note: balance > 0
            ? 'Balance closed: student deleted (per-session correction, 004Fixes)'
            : 'Credit closed: student deleted (per-session correction, 004Fixes)',
          occurredAt: Timestamp.fromMillis(nowMs), recordedAt: Timestamp.fromMillis(nowMs), recordedBy: 'system:fees-migration',
          balanceAfter: 0, reversesEntryId: null, sourceReceiptId: null, session, phone,
        };
        write(`${ACCOUNTS}/${key}/ledger/closed_004fixes`, close);
        have.set('closed_004fixes', close);
        report.closedOnMigration.push({ account: tag(key), balance });
        balance = 0;
      }
      const ledger = [...have.values()];
      const payments = ledger.filter((e) => e.type === 'payment').sort((a, b) => (millis(b.occurredAt) ?? 0) - (millis(a.occurredAt) ?? 0));

      const before = existingNew.get(key) ?? null;
      const next = {
        ...(before ?? {}),
        key, phone, session, balance,
        ...(payments[0] ? { lastPaymentAt: payments[0].occurredAt, lastPaymentAmount: payments[0].magnitude ?? Math.abs(payments[0].amount) } : {}),
        // A teacher's fee override was per number: it applies to each registration.
        ...(data.feeAmount !== undefined && before?.feeAmount === undefined ? { feeAmount: data.feeAmount } : {}),
        // Billing state belonged to the session the shared account last wrote.
        ...(session === data.session && before === null
          ? Object.fromEntries(['nextDueDate', 'status', 'lastInvoiceId'].filter((f) => data[f] !== undefined).map((f) => [f, data[f]]))
          : {}),
      };
      if (!studentSnap.exists) {
        // This registration was deleted: its account is closed history.
        next.studentDeletedAt = before?.studentDeletedAt ?? data.studentDeletedAt ?? Timestamp.fromMillis(nowMs);
        next.status = 'closed';
      }
      // (A live registration's new account never inherits the shared
      // account's `studentDeletedAt`: that was the OTHER session's delete.)
      if (!same(before, next)) { write(`${ACCOUNTS}/${key}`, next); report.accountsWritten += 1; }

      if (studentSnap.exists) {
        const student = studentSnap.data();
        if ((student.feeBalance ?? 0) !== balance) {
          write(studentRef.path, { feeBalance: balance }, true);
          report.recordsFeeBalanceChanged.push({ from: student.feeBalance ?? 0, to: balance });
        }
        const feeBlocked = student.blocked === true && !student.blockReason;
        if (feeBlocked && balance <= 0) report.review.blockedOwingNothing.push({ record: tag(key), balance });
        if (student.blocked !== true && balance > 0) report.review.owingNotBlocked.push({ record: tag(key), balance });
      }
      finals.set(key, { session, balance, ledger });
    }

    const migratedTo = [...groups.keys()].sort();
    if (migratedTo.length) {
      const marked = { ...data, migratedTo, migratedAt: data.migratedAt ?? Timestamp.fromMillis(nowMs) };
      if (!same(data, marked)) write(acc.ref.path, marked);
    }
  }

  // Per-session accounts the legacy data did not touch still count.
  for (const [key, data] of existingNew) {
    if (finals.has(key) || !data.session) continue;
    const ledger = (await db.collection(`${ACCOUNTS}/${key}/ledger`).get()).docs.map((d) => d.data());
    finals.set(key, { session: data.session, balance: data.balance ?? 0, ledger });
  }

  // ---- Aggregates, rebuilt.
  const month = collectedMonthKey(new Date(nowMs));
  const bySession = {};
  let totalOutstanding = unassignedTotal;
  for (const { session, balance, ledger } of finals.values()) {
    const s = bySession[session] ?? (bySession[session] = { totalOutstanding: 0, collectedThisMonth: 0, collectedMonth: month });
    s.totalOutstanding += balance;
    totalOutstanding += balance;
    for (const e of ledger) {
      const at = millis(e.recordedAt) ?? millis(e.occurredAt);
      if (e.type === 'payment' && at !== null && collectedMonthKey(new Date(at)) === month) s.collectedThisMonth += e.magnitude ?? Math.abs(e.amount ?? 0);
    }
  }
  const aggSnap = await db.doc(AGGREGATES).get();
  const aggBefore = aggSnap.exists ? aggSnap.data() : {};
  const aggNext = { ...aggBefore, totalOutstanding, bySession };
  report.aggregates = {
    before: { totalOutstanding: aggBefore.totalOutstanding ?? 0, bySession: serialize(aggBefore.bySession ?? {}) },
    after: { totalOutstanding, bySession },
  };
  if (!same(aggBefore, aggNext)) write(AGGREGATES, aggNext);

  report.writes = writes.length;
  return { writes, report };
}

const BATCH = 400;

/** Saves the before-image of every target, then writes. Returns the report. */
export async function applyMigration(db, { backupFile, nowMs = Date.now() } = {}) {
  if (!backupFile) throw new Error('applyMigration: a backup file is required');
  const { writes, report } = await planMigration(db, { nowMs });
  const before = [];
  for (let i = 0; i < writes.length; i += 100) {
    const refs = writes.slice(i, i + 100).map((w) => db.doc(w.path));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, k) => before.push({ path: refs[k].path, existed: snap.exists, data: snap.exists ? serialize(snap.data()) : null }));
  }
  writeFileSync(backupFile, JSON.stringify({ createdAt: new Date(nowMs).toISOString(), documents: before }, null, 1));
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH)) batch.set(db.doc(w.path), w.data, w.merge ? { merge: true } : undefined);
    await batch.commit();
  }
  return { ...report, applied: true, backupFile };
}

/** Puts every backed-up document back exactly as it was. */
export async function restoreBackup(db, backupFile) {
  const { documents } = JSON.parse(readFileSync(backupFile, 'utf8'));
  for (let i = 0; i < documents.length; i += BATCH) {
    const batch = db.batch();
    for (const d of documents.slice(i, i + BATCH)) {
      if (d.existed) batch.set(db.doc(d.path), deserialize(d.data));
      else batch.delete(db.doc(d.path));
    }
    await batch.commit();
  }
  return { restored: documents.length };
}
