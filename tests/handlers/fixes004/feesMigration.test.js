import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 004Fixes / 10 — the migration of legacy per-number fee accounts
 * (`fees/accounts/items/{phone}`) into per-session ones
 * (`{session}__{phone}`), on a fixture shaped like production.
 */

const N = (n) => `+2547110100${String(n).padStart(2, '0')}`;
const A = N(1); const B = N(2); const C = N(3); const D = N(4); const E = N(5); const F = N(6); const G = N(7); const H = N(8); const K = N(11);
const thisMonth = new Date();
const old = new Date('2026-09-10T08:00:00Z');
let db; let teacher; let lib;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx004-migrate-teacher', teacherClaims.gold, { email: 'migrate.teacher@school.example' });
  lib = await import('../../../scripts/lib/feesMigration.mjs');
});

const student = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: 'Kid', parentPhone: phone, class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed',
  registeredAt: old, session, blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const entry = (path, id, e) => db.doc(`fees/accounts/items/${path}/ledger/${id}`).set({
  method: null, reference: null, note: null, recordedBy: 'seed', reversesEntryId: null, sourceReceiptId: null,
  occurredAt: old, recordedAt: old, magnitude: Math.abs(e.amount), ...e,
});

async function fixture() {
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true });
  // A: one session only.
  await student('morning', A, { blocked: true, feeBalance: 1500 });
  await db.doc(`fees/accounts/items/${A}`).set({ phone: A, session: 'morning', balance: 1500 });
  await entry(A, 'a1', { type: 'adjustment', amount: 1500, session: 'morning', phone: A });
  // B: the "61" shape — a morning block undone (adjustment + reversal) and an evening block.
  await student('morning', B, { feeBalance: 5500 });
  await student('evening', B, { blocked: true, feeBalance: 2750 });
  await db.doc(`fees/accounts/items/${B}`).set({ phone: B, session: 'evening', balance: 2750 });
  await entry(B, 'm1', { type: 'adjustment', amount: 2750, session: 'morning', phone: B, reversedByEntryId: 'm2' });
  await entry(B, 'm2', { type: 'reversal', amount: -2750, session: 'morning', phone: B, reversesEntryId: 'm1' });
  await entry(B, 'e1', { type: 'adjustment', amount: 2750, session: 'evening', phone: B });
  // C: payments in both sessions, this month.
  await student('morning', C, { feeBalance: 600 });
  await student('evening', C, { feeBalance: 600 });
  await db.doc(`fees/accounts/items/${C}`).set({ phone: C, session: 'evening', balance: 600, feeAmount: 1000 });
  await entry(C, 'c1', { type: 'invoice', amount: 1000, session: 'morning', phone: C });
  await entry(C, 'c2', { type: 'payment', amount: -1000, method: 'cash', session: 'morning', phone: C, recordedAt: thisMonth, occurredAt: thisMonth });
  await entry(C, 'c3', { type: 'invoice', amount: 1000, session: 'evening', phone: C });
  await entry(C, 'c4', { type: 'payment', amount: -400, method: 'mpesa', session: 'evening', phone: C, recordedAt: thisMonth, occurredAt: thisMonth });
  // D: an entry with no session, on an account with none.
  await db.doc(`fees/accounts/items/${D}`).set({ phone: D, balance: 300 });
  await entry(D, 'd1', { type: 'invoice', amount: 300, phone: D, session: null });
  // E: the new code already posted to the per-session account before the migration.
  await student('morning', E, { feeBalance: 500 });
  await db.doc(`fees/accounts/items/morning__${E}`).set({ key: `morning__${E}`, phone: E, session: 'morning', balance: 500 });
  await entry(`morning__${E}`, 'n1', { type: 'invoice', amount: 500, session: 'morning', phone: E });
  await db.doc(`fees/accounts/items/${E}`).set({ phone: E, session: 'morning', balance: 200 });
  await entry(E, 'o1', { type: 'invoice', amount: 200, session: 'morning', phone: E });
  // F: a change-of-number forwarding marker (no ledger).
  await db.doc(`fees/accounts/items/${F}`).set({ phoneChanged: N(9), session: 'morning', movedAt: old });
  // G: a deleted morning registration, its balance closed on deletion.
  await db.doc(`fees/accounts/items/${G}`).set({ phone: G, session: 'morning', balance: 0, studentDeletedAt: old, status: 'closed' });
  await entry(G, 'g1', { type: 'invoice', amount: 800, session: 'morning', phone: G });
  await entry(G, 'g2', { type: 'adjustment', amount: -800, session: 'morning', phone: G, note: 'Balance closed: student deleted' });
  // H: a reversal posted on the morning row against an evening entry.
  await student('morning', H);
  await student('evening', H, { blocked: true, feeBalance: 0 });
  await db.doc(`fees/accounts/items/${H}`).set({ phone: H, session: 'morning', balance: 0 });
  await entry(H, 'h1', { type: 'adjustment', amount: 500, session: 'evening', phone: H, reversedByEntryId: 'h2' });
  await entry(H, 'h2', { type: 'reversal', amount: -500, session: 'morning', phone: H, reversesEntryId: 'h1' });
  // K: production's shape (5 found by the 4 Nov dry run): the morning record was
  // deleted while the SHARED account held both sessions' debt, so the close
  // (-5,500) took the evening 2,750 too. Split by session, the closed morning
  // account is left in credit; evening is live and owes its 2,750.
  await student('evening', K, { feeBalance: 2750 });
  await db.doc(`fees/accounts/items/${K}`).set({ phone: K, session: 'morning', balance: 0, studentDeletedAt: old, status: 'closed' });
  await entry(K, 'k1', { type: 'invoice', amount: 2750, session: 'morning', phone: K });
  await entry(K, 'k2', { type: 'invoice', amount: 2750, session: 'morning', phone: K });
  await entry(K, 'k3', { type: 'adjustment', amount: -5500, session: 'morning', phone: K, note: 'Balance closed: student deleted' });
  await entry(K, 'k4', { type: 'reversal', amount: -2750, session: 'morning', phone: K });
  await entry(K, 'k5', { type: 'invoice', amount: 2750, session: 'evening', phone: K });
  await db.doc('aggregates/dashboard').set({ totalOutstanding: 5850, collectedThisMonth: 1400, overdueCount: 2 });
}

/** Every document the migration can touch, JSON-comparable. */
async function snapshot() {
  const out = {};
  const put = (d) => { out[d.ref.path] = lib.serialize(d.data()); };
  for (const acc of (await db.collection('fees/accounts/items').get()).docs) {
    put(acc);
    for (const e of (await acc.ref.collection('ledger').get()).docs) put(e);
  }
  for (const s of ['morning', 'evening']) for (const d of (await db.collection(`sessions/${s}/students`).get()).docs) put(d);
  const agg = await db.doc('aggregates/dashboard').get();
  if (agg.exists) put(agg);
  return out;
}
const account = async (id) => (await db.doc(`fees/accounts/items/${id}`).get()).data() ?? null;
const studentDoc = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const ledgerIds = async (id) => (await db.collection(`fees/accounts/items/${id}/ledger`).get()).docs.map((d) => d.id).sort();
const backupPath = () => join(mkdtempSync(join(tmpdir(), 'fees-mig-')), 'backup.json');

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await fixture();
});

describe('dry run', () => {
  it('writes nothing, and counts what it would do', async () => {
    const before = await snapshot();
    const { report, writes } = await lib.planMigration(db);
    expect(await snapshot()).toEqual(before);
    expect(writes.length).toBeGreaterThan(0);
    // Legacy A–H and K = 9; single-session A, E, G; split B, C, H, K; marker F; D has no session.
    // Entries in legacy ledgers: A1 + B3 + C4 + D1 + E1 + G2 + H2 + K5 = 19.
    expect(report).toMatchObject({ legacyAccounts: 9, alreadyPerSession: 1, singleSession: 3, split: 4, markers: 1, entriesSeen: 19 });
    expect(report.closedOnMigration).toEqual([expect.objectContaining({ balance: -2750 })]);
    expect(report.review.unassignedEntries).toHaveLength(1);
    expect(report.review.crossSessionReversals).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('+2547');
  });
});

describe('apply', () => {
  it('splits each account by entry session, with the same entry ids, and recomputes every balance and record', async () => {
    const report = await lib.applyMigration(db, { backupFile: backupPath() });
    expect(report.applied).toBe(true);
    // A
    expect(await account(`morning__${A}`)).toMatchObject({ key: `morning__${A}`, session: 'morning', phone: A, balance: 1500 });
    expect(await ledgerIds(`morning__${A}`)).toEqual(['a1']);
    expect((await db.doc(`fees/accounts/items/morning__${A}/ledger/a1`).get()).data().migratedFrom).toBe(`fees/accounts/items/${A}/ledger/a1`);
    expect(await account(A)).toMatchObject({ migratedTo: [`morning__${A}`] });
    expect((await account(A)).migratedAt).toBeTruthy();
    expect(await ledgerIds(A)).toEqual(['a1']); // the legacy history stays
    // B: morning nets 0, evening owes 2,750 — the 61 corrected.
    expect((await account(`morning__${B}`)).balance).toBe(0);
    expect((await account(`evening__${B}`)).balance).toBe(2750);
    expect((await studentDoc('morning', B)).feeBalance).toBe(0);
    expect(await studentDoc('evening', B)).toMatchObject({ feeBalance: 2750, blocked: true });
    expect((await db.doc(`fees/accounts/items/morning__${B}/ledger/m1`).get()).data().reversedByEntryId).toBe('m2');
    // C: each session's payment, and the per-number fee override on both.
    expect(await account(`morning__${C}`)).toMatchObject({ balance: 0, lastPaymentAmount: 1000, feeAmount: 1000 });
    expect(await account(`evening__${C}`)).toMatchObject({ balance: 600, lastPaymentAmount: 400, feeAmount: 1000 });
    // D: not moved.
    expect(await account(`morning__${D}`)).toBeNull();
    expect((await account(D)).migratedTo).toBeUndefined();
    // E: the new account keeps its own entry and gains the legacy one.
    expect(await ledgerIds(`morning__${E}`)).toEqual(['n1', 'o1']);
    expect((await account(`morning__${E}`)).balance).toBe(700);
    expect((await studentDoc('morning', E)).feeBalance).toBe(700);
    // F: the marker is left alone.
    expect(await account(`morning__${F}`)).toBeNull();
    // G: the deleted registration's account is closed history.
    expect(await account(`morning__${G}`)).toMatchObject({ balance: 0, status: 'closed' });
    expect((await account(`morning__${G}`)).studentDeletedAt).toBeTruthy();
    // K: the deleted morning account is closed to exactly 0 (as a delete does),
    // with the same entry shape as closeDeletedStudentAccount; evening still owes.
    expect(await account(`morning__${K}`)).toMatchObject({ balance: 0, status: 'closed' });
    expect((await db.doc(`fees/accounts/items/morning__${K}/ledger/closed_004fixes`).get()).data()).toMatchObject({
      type: 'adjustment', amount: 2750, magnitude: 2750, balanceAfter: 0, session: 'morning', phone: K, recordedBy: 'system:fees-migration',
    });
    expect((await account(`evening__${K}`)).balance).toBe(2750);
    expect(await studentDoc('evening', K)).toMatchObject({ feeBalance: 2750 });
    // H: split by each entry's own session (and reported for review).
    expect((await account(`evening__${H}`)).balance).toBe(500);
    expect((await account(`morning__${H}`)).balance).toBe(-500);
    // Blocked flags never change.
    expect((await studentDoc('morning', A)).blocked).toBe(true);
    expect((await studentDoc('evening', H)).blocked).toBe(true);
    // Reported for the owner, never changed: nobody fee-blocked owes nothing;
    // three registrations owe but are not blocked (C evening 600, E morning 700, K evening 2,750).
    expect(report.review.blockedOwingNothing).toEqual([]);
    expect(report.review.owingNotBlocked.map((r) => r.balance).sort((x, y) => x - y)).toEqual([600, 700, 2750]);
  });

  it('rebuilds the aggregates: the school total and each session\'s, with this month\'s payments', async () => {
    await lib.applyMigration(db, { backupFile: backupPath() });
    const agg = (await db.doc('aggregates/dashboard').get()).data();
    // morning: A 1500 + B 0 + C 0 + E 700 + G 0 + H -500 + K 0 = 1700;
    // evening: B 2750 + C 600 + H 500 + K 2750 = 6600; D's 300 stays in the school total.
    expect(agg.bySession.morning).toMatchObject({ totalOutstanding: 1700, collectedThisMonth: 1000 });
    expect(agg.bySession.evening).toMatchObject({ totalOutstanding: 6600, collectedThisMonth: 400 });
    expect(agg.totalOutstanding).toBe(8600);
    expect(agg.overdueCount).toBe(2);
  });

  it('a second run writes nothing and changes nothing', async () => {
    await lib.applyMigration(db, { backupFile: backupPath() });
    const after = await snapshot();
    const second = await lib.applyMigration(db, { backupFile: backupPath() });
    expect(second.writes).toBe(0);
    expect(await snapshot()).toEqual(after);
  });

  it('the backup restores everything exactly as it was', async () => {
    const before = await snapshot();
    const file = backupPath();
    await lib.applyMigration(db, { backupFile: file });
    expect(await snapshot()).not.toEqual(before);
    await lib.restoreBackup(db, file);
    expect(await snapshot()).toEqual(before);
  });

  it('after the migration the app works on the split accounts: a morning payment clears morning only', async () => {
    await lib.applyMigration(db, { backupFile: backupPath() });
    await call('/api/fees/post', { token: teacher, body: { session: 'evening', phone: B, type: 'payment', amount: 2750, method: 'cash', autoUnblock: true } });
    expect(await studentDoc('evening', B)).toMatchObject({ feeBalance: 0, blocked: false });
    expect((await account(`morning__${B}`)).balance).toBe(0);
    // evening 6,600 before (see the aggregates test), less the 2,750 paid.
    expect((await db.doc('aggregates/dashboard').get()).data().bySession.evening.totalOutstanding).toBe(3850);
  });
});
