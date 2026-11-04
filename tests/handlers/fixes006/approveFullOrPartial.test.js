import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 006Fixes / 04 — approving a receipt as a COMPLETE or PARTIAL payment (owner,
 * 4 Nov 2026). Complete records everything owed; partial records the typed
 * amount and leaves the rest owing (still in Total outstanding, and marked so
 * the "Partial payment" filter can find them). BOTH approve and unblock — the
 * old "a partial payment keeps the block" rule no longer applies to approval.
 */

const P = '+254711006401';
const Q = '+254711006402';
const CODE = 'UK2PK0FF1R';
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx006-appr-teacher', teacherClaims.gold, { email: 'approve.teacher@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${session}`, parentPhone: phone, class: 'Form 3', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: 'QX12345678 Confirmed. Ksh2,750.00 sent', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const bulk = (body) => call('/api/students/bulk', { token: teacher, body });
const approve = (body) => call('/api/fees/approveReceipt', { token: teacher, body });
const student = async (s, p = P) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const ledger = async (s, p = P) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());
const agg = async () => (await db.doc('aggregates/dashboard').get()).data() ?? {};

/** Blocked for 2,750 with a pending receipt — the case the owner described. */
async function blockedWithReceipt(session = 'evening', phone = P, receipt = `1,200: ${CODE} Confirmed. Ksh1,200.00 paid to FOCUS ONLINE`) {
  await seed(session, phone);
  const res = await bulk({ action: 'block', kind: 'fees', amount: 2750, items: [{ session, phone }] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await db.doc(`sessions/${session}/students/${phone}`).set({
    pendingReceipt: receipt, receiptStatus: 'pending', receiptSubmittedAt: new Date(),
  }, { merge: true });
}

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
});

describe('complete payment', () => {
  it('records the whole 2,750 with the receipt\'s M-Pesa code; approved, unblocked, nothing owed, no marker', async () => {
    await blockedWithReceipt();
    const before = await agg();
    const res = await approve({ session: 'evening', phone: P, payment: 'full' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ posted: true, paid: 2750, balance: 0, partial: false, stillOwes: false, stillBlocked: false });
    const pay = (await ledger('evening')).find((e) => e.type === 'payment');
    expect(pay).toMatchObject({ magnitude: 2750, method: 'mpesa', reference: CODE, balanceAfter: 0 });
    expect(pay.note).toMatch(/complete/i);
    expect(await student('evening')).toMatchObject({ feeBalance: 0, blocked: false, receiptStatus: 'approved', pendingReceipt: null });
    expect((await student('evening')).partialPayment).toBeUndefined();
    const after = await agg();
    expect(after.totalOutstanding - before.totalOutstanding).toBe(-2750);
    expect(after.bySession.evening.totalOutstanding).toBe(0);
    expect(after.bySession.evening.collectedThisMonth - (before.bySession?.evening?.collectedThisMonth ?? 0)).toBe(2750);
  });
});

describe('partial payment', () => {
  it('records 1,200 of 2,750: owes 1,550, UNBLOCKED and approved, marked, still in Total outstanding', async () => {
    await blockedWithReceipt();
    const res = await approve({ session: 'evening', phone: P, payment: 'partial', amount: 1200 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ posted: true, paid: 1200, balance: 1550, partial: true, stillOwes: true, stillBlocked: false });
    const pay = (await ledger('evening')).find((e) => e.type === 'payment');
    expect(pay).toMatchObject({ magnitude: 1200, reference: CODE, balanceAfter: 1550 });
    expect(pay.note).toBe('Recorded on receipt approval (partial: KES 1,200 of 2,750)');
    const s = await student('evening');
    expect(s).toMatchObject({ feeBalance: 1550, blocked: false, receiptStatus: 'approved' });
    expect(s.partialPayment).toMatchObject({ paid: 1200, owedBefore: 2750, owedAfter: 1550, by: 'fx006-appr-teacher' });
    expect((await agg()).totalOutstanding).toBe(1550);
    expect((await agg()).bySession.evening.totalOutstanding).toBe(1550);
  });

  it('refuses 0, the full amount, more than owed and fractions — and writes nothing', async () => {
    await blockedWithReceipt();
    for (const amount of [0, 2750, 3000, 1.5]) {
      const res = await approve({ session: 'evening', phone: P, payment: 'partial', amount });
      expect(res.status, String(amount)).toBe(400);
    }
    expect(await approve({ session: 'evening', phone: P, payment: 'partial' })).toMatchObject({ status: 400 });
    expect((await ledger('evening')).filter((e) => e.type === 'payment')).toHaveLength(0);
    expect(await student('evening')).toMatchObject({ blocked: true, receiptStatus: 'pending', feeBalance: 2750 });
  });

  it('paying off the rest later clears the marker', async () => {
    await blockedWithReceipt();
    await approve({ session: 'evening', phone: P, payment: 'partial', amount: 1200 });
    const rest = await call('/api/fees/post', { token: teacher, body: { session: 'evening', phone: P, type: 'payment', amount: 1550, method: 'cash' } });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    const s = await student('evening');
    expect(s.feeBalance).toBe(0);
    expect(s.partialPayment).toBeUndefined();
  });

  it('a later partial replaces the marker with the new figures', async () => {
    await blockedWithReceipt();
    await approve({ session: 'evening', phone: P, payment: 'partial', amount: 1000 });
    await db.doc(`sessions/evening/students/${P}`).set({ pendingReceipt: 'second QAB9876543 Ksh500', receiptStatus: 'pending', receiptSubmittedAt: new Date(Date.now() + 1000) }, { merge: true });
    await approve({ session: 'evening', phone: P, payment: 'partial', amount: 500 });
    expect((await student('evening')).partialPayment).toMatchObject({ paid: 500, owedBefore: 1750, owedAfter: 1250 });
  });
});

describe('the rest of the approval rules', () => {
  it('approving the same receipt twice posts once', async () => {
    await blockedWithReceipt();
    await approve({ session: 'evening', phone: P, payment: 'partial', amount: 1200 });
    // A double-click: the receipt is already approved, the same id comes again.
    await db.doc(`sessions/evening/students/${P}`).set({ pendingReceipt: `1,200: ${CODE} Confirmed. Ksh1,200.00 paid to FOCUS ONLINE` }, { merge: true });
    await approve({ session: 'evening', phone: P, payment: 'partial', amount: 1200 });
    expect((await ledger('evening')).filter((e) => e.type === 'payment')).toHaveLength(1);
  });

  it('per session: a partial approval on evening leaves the morning record of the same number alone', async () => {
    await blockedWithReceipt('morning', P, 'QAB1234567 Confirmed. Ksh2,750.00');
    await blockedWithReceipt('evening', P);
    await approve({ session: 'evening', phone: P, payment: 'partial', amount: 1200 });
    expect(await student('morning')).toMatchObject({ feeBalance: 2750, blocked: true, receiptStatus: 'pending' });
    expect((await student('morning')).partialPayment).toBeUndefined();
  });

  it('an old call with no payment choice behaves exactly as before (approve, no money)', async () => {
    await blockedWithReceipt();
    const res = await approve({ session: 'evening', phone: P });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ posted: false, balance: 2750 });
    expect((await ledger('evening')).filter((e) => e.type === 'payment')).toHaveLength(0);
    expect(await student('evening')).toMatchObject({ blocked: false, receiptStatus: 'approved', feeBalance: 2750 });
  });

  it('nothing owed: a payment choice records no money and just approves', async () => {
    await seed('evening', Q, { pendingReceipt: 'QAB1111111 Ksh100', receiptStatus: 'pending', receiptSubmittedAt: new Date(), blocked: true, blockReason: 'x' });
    const res = await approve({ session: 'evening', phone: Q, payment: 'full' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ posted: false, paid: 0, balance: 0 });
    expect(await student('evening', Q)).toMatchObject({ blocked: false, receiptStatus: 'approved' });
  });

  it('either choice takes the student out of a waiting scheduled block', async () => {
    await seed('evening', Q, { feeBalance: 0 });
    const sched = await call('/api/students/scheduled', { token: teacher, body: { action: 'create', atMs: Date.now() + 10 * 60_000, kind: 'fees', amount: 2750, items: [{ session: 'evening', phone: Q }] } });
    expect(sched.status).toBe(200);
    // Owes from an earlier charge and has sent a receipt.
    await call('/api/fees/post', { token: teacher, body: { session: 'evening', phone: Q, type: 'invoice', amount: 2750 } });
    await db.doc(`sessions/evening/students/${Q}`).set({ pendingReceipt: 'QAB2222222 Ksh1000', receiptStatus: 'pending', receiptSubmittedAt: new Date() }, { merge: true });
    await approve({ session: 'evening', phone: Q, payment: 'partial', amount: 1000 });
    expect((await student('evening', Q)).scheduledBlock).toBeUndefined();
  });
});
