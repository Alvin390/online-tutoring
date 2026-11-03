import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';
import { collectedMonthKey } from '../../../api/_lib/ledger.js';

/**
 * 004Fixes / 09 — "Total outstanding" and "Collected this month" per session,
 * kept in `aggregates/dashboard.bySession.{slug}` by the same transaction that
 * posts each entry (no extra read), with the same month reset as the school
 * total. The school total stays the sum of the sessions.
 */

const P = '+254711009001';
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx004-totals-teacher', teacherClaims.gold, { email: 'totals.teacher@school.example' });
});
beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  for (const s of ['morning', 'evening', 'after-school']) {
    await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true });
    await db.doc(`sessions/${s}/students/${P}`).set({
      studentName: `Kid ${s}`, parentPhone: P, class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed',
      registeredAt: new Date('2026-10-01T06:00:00Z'), session: s, blocked: false, blockReason: '',
      approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    });
  }
});

const totals = async () => (await db.doc('aggregates/dashboard').get()).data() ?? {};
const blockFees = (session, amount) => call('/api/students/bulk', { token: teacher, body: { action: 'block', kind: 'fees', amount, items: [{ session, phone: P }] } });
const pay = (session, amount) => call('/api/fees/post', { token: teacher, body: { session, phone: P, type: 'payment', amount, method: 'cash' } });

describe('per-session totals', () => {
  it('blocks and payments move their own session\'s totals; the school total is the sum', async () => {
    await blockFees('morning', 2750);
    await blockFees('evening', 1500);
    await blockFees('after-school', 500);
    expect((await pay('evening', 1000)).status).toBe(200);
    const t = await totals();
    expect(t.bySession.morning).toMatchObject({ totalOutstanding: 2750 });
    expect(t.bySession.morning.collectedThisMonth ?? 0).toBe(0);
    expect(t.bySession.evening).toMatchObject({ totalOutstanding: 500, collectedThisMonth: 1000, collectedMonth: collectedMonthKey() });
    expect(t.bySession['after-school']).toMatchObject({ totalOutstanding: 500 });
    expect(t.totalOutstanding).toBe(3750);
    expect(t.collectedThisMonth).toBe(1000);
    const sum = Object.values(t.bySession).reduce((a, s) => a + (s.totalOutstanding ?? 0), 0);
    expect(sum).toBe(t.totalOutstanding);
  });

  it('a session\'s collected total starts again in a new month, on its own', async () => {
    await db.doc('aggregates/dashboard').set({
      collectedThisMonth: 50, collectedMonth: collectedMonthKey(),
      bySession: { morning: { collectedThisMonth: 999, collectedMonth: '2000-01' }, evening: { collectedThisMonth: 50, collectedMonth: collectedMonthKey() } },
    });
    await pay('morning', 400);
    await pay('evening', 100);
    const t = await totals();
    expect(t.bySession.morning.collectedThisMonth).toBe(400);
    expect(t.bySession.evening.collectedThisMonth).toBe(150);
    expect(t.collectedThisMonth).toBe(550);
  });

  it('a single posting (record payment) and a reversal move the session total back', async () => {
    const res = await call('/api/fees/post', { token: teacher, body: { session: 'morning', phone: P, type: 'invoice', amount: 800 } });
    expect((await totals()).bySession.morning.totalOutstanding).toBe(800);
    await call('/api/fees/post', { token: teacher, body: { session: 'morning', phone: P, type: 'reversal', reversesEntryId: res.body.entryId, note: 'wrong' } });
    expect((await totals()).bySession.morning.totalOutstanding).toBe(0);
  });

  it('the invoice run moves each session\'s outstanding', async () => {
    await db.doc('fees/config').set({ defaultFeeByClass: { 'Form 3': 1200 }, billingDayOfMonth: 1, gracePeriodDays: 7, invoicePrefix: 'INV' });
    const res = await call('/api/fees/generateInvoices', { token: teacher, body: { period: '2026-11', sessions: ['morning', 'evening'] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = await totals();
    expect(t.bySession.morning.totalOutstanding).toBe(1200);
    expect(t.bySession.evening.totalOutstanding).toBe(1200);
    expect(t.totalOutstanding).toBe(2400);
  });
});
