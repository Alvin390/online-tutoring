import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 006Fixes / 05 — bulk "Approve receipts" asks Complete or Partial too (owner,
 * 4 Nov 2026). Partial carries each student's own amount. The same rule and
 * writes as the single approval (receiptApproval.paymentChoice); Undo puts
 * back the balances, blocks, receipts and the partial marker.
 */

const phoneN = (n) => `+2547110${String(70000 + n).padStart(5, '0')}`;
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx006-bappr-teacher', teacherClaims.gold, { email: 'bulk.approve@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: 'QX12345678 Confirmed. Ksh2,750.00 sent', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const bulk = (body) => call('/api/students/bulk', { token: teacher, body });
const student = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const payments = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data()).filter((e) => e.type === 'payment');
const agg = async () => (await db.doc('aggregates/dashboard').get()).data() ?? {};

async function blockedWithReceipts(session, phones) {
  for (const p of phones) await seed(session, p);
  const res = await bulk({ action: 'block', kind: 'fees', amount: 2750, items: phones.map((phone) => ({ session, phone })) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  for (const [i, p] of phones.entries()) {
    await db.doc(`sessions/${session}/students/${p}`).set({
      pendingReceipt: `QAB${String(i).padStart(3, '0')}XYZ9 Confirmed. Ksh1,000.00 paid`, receiptStatus: 'pending', receiptSubmittedAt: new Date(),
    }, { merge: true });
  }
}

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
});

describe('bulk approve: complete', () => {
  it('records each whole balance (as before), unblocks, no markers', async () => {
    const ps = [phoneN(1), phoneN(2), phoneN(3)];
    await blockedWithReceipts('evening', ps);
    const res = await bulk({ action: 'approveReceipts', payment: 'full', items: ps.map((phone) => ({ session: 'evening', phone })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.done).toBe(3);
    for (const p of ps) {
      expect(await student('evening', p)).toMatchObject({ feeBalance: 0, blocked: false, receiptStatus: 'approved' });
      expect((await student('evening', p)).partialPayment).toBeUndefined();
      expect((await payments('evening', p))[0]).toMatchObject({ magnitude: 2750, method: 'mpesa' });
    }
    expect((await agg()).totalOutstanding).toBe(0);
  });
});

describe('bulk approve: partial', () => {
  it('1,000 / 1,500 / 2,000 of 2,750: balances 1,750 / 1,250 / 750, all unblocked, marked, totals right', async () => {
    const ps = [phoneN(11), phoneN(12), phoneN(13)];
    await blockedWithReceipts('evening', ps);
    const amounts = [1000, 1500, 2000];
    const res = await bulk({ action: 'approveReceipts', payment: 'partial', items: ps.map((phone, i) => ({ session: 'evening', phone, amount: amounts[i] })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ done: 3, skipped: {} });
    for (const [i, p] of ps.entries()) {
      const s = await student('evening', p);
      expect(s).toMatchObject({ feeBalance: 2750 - amounts[i], blocked: false, receiptStatus: 'approved' });
      expect(s.partialPayment).toMatchObject({ paid: amounts[i], owedBefore: 2750, owedAfter: 2750 - amounts[i] });
      const pay = (await payments('evening', p))[0];
      expect(pay).toMatchObject({ magnitude: amounts[i], reference: `QAB${String(i).padStart(3, '0')}XYZ9` });
      expect(pay.note).toMatch(/partial/);
    }
    expect((await agg()).totalOutstanding).toBe(3750);
    expect((await agg()).bySession.evening.totalOutstanding).toBe(3750);
    const list = await bulk({ action: 'list' });
    expect(list.body.actions[0]).toMatchObject({ action: 'approveReceipts', payment: 'partial' });
  });

  it('an amount of the whole balance, zero or missing is skipped as amountInvalid; the others are done', async () => {
    const ps = [phoneN(21), phoneN(22), phoneN(23), phoneN(24)];
    await blockedWithReceipts('evening', ps);
    const res = await bulk({
      action: 'approveReceipts',
      payment: 'partial',
      items: [
        { session: 'evening', phone: ps[0], amount: 2750 },
        { session: 'evening', phone: ps[1], amount: 1200 },
        { session: 'evening', phone: ps[2] },
        { session: 'evening', phone: ps[3], amount: 3000 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ done: 1, skipped: { amountInvalid: 3 } });
    expect(await student('evening', ps[0])).toMatchObject({ blocked: true, receiptStatus: 'pending', feeBalance: 2750 });
    expect(await student('evening', ps[1])).toMatchObject({ blocked: false, feeBalance: 1550 });
  });

  it('Undo puts back balances, blocks, receipts and markers, and reverses the payments', async () => {
    const ps = [phoneN(31), phoneN(32)];
    await blockedWithReceipts('evening', ps);
    // ps[1] already carries a marker from an earlier partial approval.
    await db.doc(`sessions/evening/students/${ps[1]}`).set({ partialPayment: { paid: 100, owedBefore: 2850, owedAfter: 2750 } }, { merge: true });
    const res = await bulk({ action: 'approveReceipts', payment: 'partial', items: ps.map((phone) => ({ session: 'evening', phone, amount: 1000 })) });
    expect(res.body.done).toBe(2);
    const undo = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body.undone).toBe(2);
    const a = await student('evening', ps[0]);
    expect(a).toMatchObject({ feeBalance: 2750, blocked: true, receiptStatus: 'pending' });
    expect(a.partialPayment ?? null).toBeNull();
    const b = await student('evening', ps[1]);
    expect(b).toMatchObject({ feeBalance: 2750, blocked: true });
    expect(b.partialPayment).toMatchObject({ paid: 100, owedAfter: 2750 });
    expect((await agg()).totalOutstanding).toBe(5500);
  });

  it('a number in both sessions: only the row\'s session is paid', async () => {
    const p = phoneN(41);
    await blockedWithReceipts('morning', [p]);
    await blockedWithReceipts('evening', [p]);
    await bulk({ action: 'approveReceipts', payment: 'partial', items: [{ session: 'evening', phone: p, amount: 1000 }] });
    expect(await student('morning', p)).toMatchObject({ feeBalance: 2750, blocked: true, receiptStatus: 'pending' });
    expect((await student('morning', p)).partialPayment).toBeUndefined();
    expect(await student('evening', p)).toMatchObject({ feeBalance: 1750, blocked: false });
  });
});
