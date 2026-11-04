import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims } from '../_worker.js';

/**
 * 006Fixes / 10 — the one-off correction of the 20 records approved with no
 * money recorded (owner, 4 Nov 2026): staff closed as "Staff, no fee",
 * partial payers recorded at what they paid (and marked), full payers at
 * 2,750. Each target is re-checked first: still unblocked, receipt approved,
 * the original block charge still there and NO payment/adjustment/reversal
 * since — a later charge is kept. Dry run, apply with backup, idempotent,
 * exact restore.
 */

const P = (n) => `+2547110${String(90000 + n).padStart(5, '0')}`;
let db; let teacher; let lib; let dir;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx006-corr-teacher', teacherClaims.gold, { email: 'correction@school.example' });
  lib = await import('../../../scripts/lib/approvedOwingCorrection.mjs');
  dir = mkdtempSync(path.join(tmpdir(), 'fx006-corr-'));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'x', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const student = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const ledger = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());
const agg = async () => (await db.doc('aggregates/dashboard').get()).data() ?? {};

/** Production's shape: blocked for 2,750, then approved from the row with no money. */
async function approvedOwing(session, phone) {
  await seed(session, phone);
  const block = await call('/api/students/bulk', { token: teacher, body: { action: 'block', kind: 'fees', amount: 2750, items: [{ session, phone }] } });
  expect(block.status, JSON.stringify(block.body)).toBe(200);
  await db.doc(`sessions/${session}/students/${phone}`).set({ pendingReceipt: 'r', receiptStatus: 'pending', receiptSubmittedAt: new Date() }, { merge: true });
  const ok = await call('/api/fees/approveReceipt', { token: teacher, body: { session, phone } }); // no money, as the row did
  expect(ok.status).toBe(200);
}

const TARGETS = () => [
  { group: 'staff', session: 'evening', phone: P(1) },
  { group: 'staff', session: 'evening', phone: P(2) },
  { group: 'partial', session: 'evening', phone: P(3), amount: 1200, code: 'UK2PK0FF1R', paidOn: '2026-11-02' },
  { group: 'partial', session: 'morning', phone: P(4), amount: 1100, code: 'UK1GBBUHOJ', paidOn: '2026-11-01' },
  { group: 'full', session: 'evening', phone: P(5), amount: 2750, code: 'UJQNX003HK', paidOn: '2026-10-26' },
  { group: 'full', session: 'evening', phone: P(6), amount: 2750, code: 'UK2LD04OM8', paidOn: null },
];

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
  for (const t of TARGETS()) await approvedOwing(t.session, t.phone);
});

describe('the correction of the approved-but-owing records', () => {
  it('a dry run writes nothing and reports the groups and totals', async () => {
    const before = await agg();
    const { report } = await lib.planCorrection(db, TARGETS(), { snapshotMs: Date.now() });
    expect(report).toMatchObject({
      targets: 6, toApply: 6, alreadyDone: 0, skipped: {},
      byGroup: { staff: 2, partial: 2, full: 2 },
      closedStaff: 5500, paidPartial: 2300, paidFull: 5500,
      outstandingAfter: 1550 + 1650,
    });
    expect(JSON.stringify(report)).not.toMatch(/\+2547/);
    expect(await agg()).toEqual(before);
    expect((await ledger('evening', P(1))).filter((e) => e.type !== 'invoice')).toHaveLength(0);
  });

  it('apply writes exactly the entries, sets the partial markers, and the totals are right per session', async () => {
    const backup = path.join(dir, 'b1.json');
    const out = await lib.applyCorrection(db, TARGETS(), { backupFile: backup, snapshotMs: Date.now() });
    expect(out).toMatchObject({ applied: 6 });

    const staff = (await ledger('evening', P(1))).find((e) => e.type === 'adjustment');
    expect(staff).toMatchObject({ amount: -2750, note: 'Staff, no fee (006Fixes correction)', recordedBy: 'system:006fixes' });
    expect(await student('evening', P(1))).toMatchObject({ feeBalance: 0, blocked: false });

    const part = (await ledger('evening', P(3))).find((e) => e.type === 'payment');
    expect(part).toMatchObject({ magnitude: 1200, method: 'mpesa', reference: 'UK2PK0FF1R', balanceAfter: 1550, recordedBy: 'system:006fixes' });
    expect(part.occurredAt.toDate().toISOString().slice(0, 10)).toBe('2026-11-02');
    expect((await student('evening', P(3))).partialPayment).toMatchObject({ paid: 1200, owedBefore: 2750, owedAfter: 1550 });
    expect((await student('morning', P(4))).partialPayment).toMatchObject({ paid: 1100, owedAfter: 1650 });

    const full = (await ledger('evening', P(5))).find((e) => e.type === 'payment');
    expect(full).toMatchObject({ magnitude: 2750, reference: 'UJQNX003HK', balanceAfter: 0 });
    expect((await student('evening', P(5))).partialPayment).toBeUndefined();

    const a = await agg();
    expect(a.totalOutstanding).toBe(3200);
    expect(a.bySession.evening.totalOutstanding).toBe(1550);
    expect(a.bySession.morning.totalOutstanding).toBe(1650);
  });

  it('a second run writes nothing', async () => {
    await lib.applyCorrection(db, TARGETS(), { backupFile: path.join(dir, 'b2.json'), snapshotMs: Date.now() });
    const after = await agg();
    const again = await lib.planCorrection(db, TARGETS(), { snapshotMs: Date.now() - 60_000 });
    expect(again.report).toMatchObject({ toApply: 0, alreadyDone: 6 });
    const out = await lib.applyCorrection(db, TARGETS(), { backupFile: path.join(dir, 'b3.json'), snapshotMs: Date.now() - 60_000 });
    expect(out.applied).toBe(0);
    expect(await agg()).toEqual(after);
  });

  it('skips and reports a target paid or blocked since; keeps a later charge and still corrects', async () => {
    const snapshotMs = Date.now();
    // Paid since the snapshot.
    await call('/api/fees/post', { token: teacher, body: { session: 'evening', phone: P(3), type: 'payment', amount: 100, method: 'cash' } });
    // Blocked again since.
    await db.doc(`sessions/evening/students/${P(5)}`).set({ blocked: true }, { merge: true });
    // A later charge (a monthly run): kept, the correction still applies.
    await call('/api/fees/post', { token: teacher, body: { session: 'evening', phone: P(6), type: 'invoice', amount: 500 } });
    const { report } = await lib.planCorrection(db, TARGETS(), { snapshotMs });
    expect(report.skipped).toEqual({ changedSince: 1, blocked: 1 });
    expect(report.toApply).toBe(4);
    await lib.applyCorrection(db, TARGETS(), { backupFile: path.join(dir, 'b4.json'), snapshotMs });
    expect((await student('evening', P(6))).feeBalance).toBe(500); // 2,750 + 500 - 2,750
    expect((await ledger('evening', P(3))).filter((e) => e.type === 'payment')).toHaveLength(1); // only the teacher's 100
  });

  it('restore puts every document back exactly', async () => {
    const snapshot = async () => {
      const out = {};
      for (const t of TARGETS()) {
        out[`${t.session}/${t.phone}`] = { student: await student(t.session, t.phone), ledger: (await ledger(t.session, t.phone)).length };
      }
      out.agg = await agg();
      return JSON.parse(JSON.stringify(out));
    };
    const before = await snapshot();
    const backup = path.join(dir, 'b5.json');
    await lib.applyCorrection(db, TARGETS(), { backupFile: backup, snapshotMs: Date.now() });
    expect(await snapshot()).not.toEqual(before);
    await lib.restoreCorrection(db, backup);
    expect(await snapshot()).toEqual(before);
  });
});
