import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
  setFlags, phoneN, externalCalls, SAFARICOM_IP,
} from '../_worker.js';

/**
 * Deleting a student closes their fee balance (it no longer counts towards
 * "Total outstanding"); the nightly sweep never treats a deleted student as
 * overdue and heals accounts deleted before this; and a paid-up student is
 * unblocked BEFORE the payment shows as successful.
 */

let db;
let gold;
const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('p13-cleanup-gold', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/daraja.js')).__resetCallbackSecretCache?.();
  await setFlags(db, { 'payments.daraja': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
});

async function seedStudent(phone, extra = {}) {
  await db.doc(`sessions/morning/students/${phone}`).set({
    studentName: 'Cleanup Test', parentPhone: phone, class: 'Form Two', subjects: 'Maths',
    receiptMessage: 'QAB123XYZ9 x', registeredAt: new Date(), session: 'morning',
    blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
  });
}

async function post(phone, type, amount, extra = {}) {
  const { postEntry } = await import('../../../api/_lib/ledger.js');
  await postEntry({ phone, session: 'morning', type, amount, recordedBy: 'test', ...extra });
}

const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;
const account = async (phone) => (await db.doc(`fees/accounts/items/${phone}`).get()).data();
const ledger = async (phone) => (await db.collection(`fees/accounts/items/${phone}/ledger`).get()).docs.map((d) => d.data());
const remove = (phone) => call('/api/student/remove', { token: gold, body: { session: 'morning', phone } });

describe('deleting a student closes their balance', () => {
  it('the debt leaves "Total outstanding"; the ledger keeps the history plus a closing entry', async () => {
    await seedStudent(phoneN(1));
    await seedStudent(phoneN(2));
    await post(phoneN(1), 'invoice', 3000);
    await post(phoneN(2), 'invoice', 1500);
    expect(await outstanding()).toBe(4500);

    const res = await remove(phoneN(1));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await outstanding()).toBe(1500);

    expect(await account(phoneN(1))).toMatchObject({ balance: 0, status: 'closed', nextDueDate: null });
    const entries = await ledger(phoneN(1));
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.type === 'adjustment'))
      .toMatchObject({ amount: -3000, balanceAfter: 0, note: 'Balance closed: student deleted' });
    // The closing entry does not recreate the deleted student's document.
    expect((await db.doc(`sessions/morning/students/${phoneN(1)}`).get()).exists).toBe(false);
  });

  it('a credit (overpayment) is closed too', async () => {
    await seedStudent(phoneN(3));
    await post(phoneN(3), 'payment', 500, { method: 'cash' });
    expect(await outstanding()).toBe(-500);
    await remove(phoneN(3));
    expect(await outstanding()).toBe(0);
    expect((await account(phoneN(3))).balance).toBe(0);
  });

  it('a student with no fee account deletes as before', async () => {
    await seedStudent(phoneN(4));
    expect((await remove(phoneN(4))).status).toBe(200);
    expect((await db.doc(`fees/accounts/items/${phoneN(4)}`).get()).exists).toBe(false);
  });

  it('the same number registering again gets a live account at zero', async () => {
    await seedStudent(phoneN(5));
    await post(phoneN(5), 'invoice', 2000);
    await remove(phoneN(5));
    const reg = await call('/api/student/register', {
      body: {
        session: 'morning', phone: phoneN(5), studentName: 'Back Again', class: 'Form One',
        subjects: 'Maths', receiptMessage: 'QAB123XYZ9 Confirmed',
      },
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const acc = await account(phoneN(5));
    expect(acc.balance).toBe(0);
    expect(acc.studentDeletedAt).toBeUndefined();
    expect(acc.status).toBeUndefined();
  });
});

describe('the nightly fees sweep and deleted students', () => {
  const sweep = () => call('/api/cron/feesSweep', { headers: CRON(), body: {} });
  const past = new Date(Date.now() - 3 * 86_400_000);

  it('heals an account deleted before balances were closed: closed, never flagged overdue', async () => {
    await db.doc(`fees/accounts/items/${phoneN(10)}`).set({
      phone: phoneN(10), session: 'morning', balance: 6001, nextDueDate: past, studentDeletedAt: past,
    });
    await db.doc('aggregates/dashboard').set({ totalOutstanding: 6001 });

    const res = await sweep();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deletedClosed).toBe(1);
    expect(await outstanding()).toBe(0);
    expect((await account(phoneN(10))).balance).toBe(0);
    // The old sweep wrote `overdue: true` to the deleted student's path.
    expect((await db.doc(`sessions/morning/students/${phoneN(10)}`).get()).exists).toBe(false);
    expect((await db.doc('aggregates/dashboard').get()).data().overdueCount ?? 0).toBe(0);

    // Idempotent: a second run posts nothing more.
    await sweep();
    expect(await ledger(phoneN(10))).toHaveLength(1);
  });

  it('a deleted number that has registered again is live: marker cleared, balance kept, overdue as normal', async () => {
    await seedStudent(phoneN(11));
    await db.doc(`fees/accounts/items/${phoneN(11)}`).set({
      phone: phoneN(11), session: 'morning', balance: 800, nextDueDate: past, studentDeletedAt: past,
    });
    await sweep();
    const acc = await account(phoneN(11));
    expect(acc.balance).toBe(800);
    expect(acc.studentDeletedAt).toBeUndefined();
    expect((await db.doc(`sessions/morning/students/${phoneN(11)}`).get()).data().overdue).toBe(true);
  });
});

describe('M-Pesa: the student is unblocked before the payment reads "success"', () => {
  it('the unblock is written before the transaction is marked success', async () => {
    const phone = phoneN(20);
    await seedStudent(phone, { blocked: true, feeBalance: 700 });
    await db.doc(`fees/accounts/items/${phone}`).set({ phone, session: 'morning', balance: 700 });
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone } });
    expect(init.status, JSON.stringify(init.body)).toBe(200);
    const stk = externalCalls.filter((c) => /stkpush\/v1\/processrequest/.test(c.url)).at(-1);
    await call(new URL(stk.body.CallBackURL).pathname, {
      ip: SAFARICOM_IP,
      body: { Body: { stkCallback: {
        MerchantRequestID: 'm', CheckoutRequestID: init.body.checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
        CallbackMetadata: { Item: [{ Name: 'Amount', Value: 700 }, { Name: 'MpesaReceiptNumber', Value: 'ORD3R1NG0K' }] },
      } } },
    });

    const student = await db.doc(`sessions/morning/students/${phone}`).get();
    const tx = await db.doc(`mpesa/transactions/items/${init.body.checkoutRequestId}`).get();
    expect(student.data().blocked).toBe(false);
    expect(tx.data().status).toBe('success');
    expect(student.updateTime.toMillis()).toBeLessThan(tx.updateTime.toMillis());
  });
});
