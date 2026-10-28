import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
  externalCalls, fakes, SAFARICOM_IP,
} from '../_worker.js';

/**
 * 003Fixes / 06 — approve a stack of receipts at once (each balance recorded
 * as paid, with the M-Pesa code from the receipt), undo it, and M-Pesa's own
 * auto-unblock proven for students blocked by a bulk fee block.
 */

let db;
let gold;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('fx003-approve-gold', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'payments.daraja': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
});

afterEach(() => { delete process.env.DARAJA_CALLBACK_SECRET; });

const seed = (phone, extra = {}) => db.doc(`sessions/morning/students/${phone}`).set({
  studentName: 'Student', parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'OLD1RECPT0 Confirmed', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'morning',
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'pending', feeBalance: 0, ...extra,
});
const owe = async (phone, amount) => {
  const res = await call('/api/fees/post', { token: gold, body: { session: 'morning', phone, type: 'invoice', amount } });
  expect(res.status).toBe(200);
};
const student = async (phone) => (await db.doc(`sessions/morning/students/${phone}`).get()).data();
const ledger = async (phone) => (await db.collection(`fees/accounts/items/${phone}/ledger`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const bulk = (body) => call('/api/students/bulk', { body, token: gold });
const items = (...phones) => phones.map((phone) => ({ session: 'morning', phone }));

describe('approveReceipts', () => {
  it('owes 1500 with code QAB123XYZ9 → paid 1500, referenced, unblocked; owes nothing → approved, unblocked; no receipt → skipped', async () => {
    await seed(phoneN(1), { blocked: true, receiptStatus: 'expired', pendingReceipt: 'QAB123XYZ9 Confirmed. Ksh1,500.00 sent to TUTOR' });
    await owe(phoneN(1), 1500);
    await seed(phoneN(2), { blocked: true, blockReason: 'See me', receiptStatus: 'expired', pendingReceipt: 'QZZ9988776 Confirmed' });
    await seed(phoneN(3));

    const res = await bulk({ action: 'approveReceipts', items: items(phoneN(1), phoneN(2), phoneN(3)) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ done: 2, skipped: { noReceipt: 1 }, failed: [] });

    const paid = (await ledger(phoneN(1))).find((e) => e.type === 'payment');
    expect(paid).toMatchObject({ amount: -1500, method: 'mpesa', reference: 'QAB123XYZ9' });
    expect(await student(phoneN(1))).toMatchObject({
      blocked: false, feeBalance: 0, pendingReceipt: null, receiptStatus: 'approved',
      receiptMessage: 'QAB123XYZ9 Confirmed. Ksh1,500.00 sent to TUTOR',
    });
    expect(await student(phoneN(2))).toMatchObject({ blocked: false, receiptStatus: 'approved', receiptMessage: 'QZZ9988776 Confirmed' });
    expect(await ledger(phoneN(2))).toEqual([]);
  });

  it('a receipt with no M-Pesa code: the payment is recorded without a reference', async () => {
    await seed(phoneN(10), { pendingReceipt: 'paid cash to the teacher on monday' });
    await owe(phoneN(10), 700);
    await bulk({ action: 'approveReceipts', items: items(phoneN(10)) });
    expect((await ledger(phoneN(10))).find((e) => e.type === 'payment')).toMatchObject({ amount: -700, reference: null });
  });

  it('with fees switched off: approved and let in, no money recorded', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': false });
    await seed(phoneN(11), { blocked: true, pendingReceipt: 'QAB123XYZ9 Confirmed', feeBalance: 900 });
    const res = await bulk({ action: 'approveReceipts', items: items(phoneN(11)) });
    expect(res.body.done).toBe(1);
    expect(await student(phoneN(11))).toMatchObject({ blocked: false, receiptStatus: 'approved' });
    expect(await ledger(phoneN(11))).toEqual([]);
  });

  it('undo: payments reversed, balances back, the receipt back in review, blocked again', async () => {
    await seed(phoneN(20), { blocked: true, receiptStatus: 'expired', pendingReceipt: 'QAB123XYZ9 Confirmed' });
    await owe(phoneN(20), 1500);
    const res = await bulk({ action: 'approveReceipts', items: items(phoneN(20)) });
    const undo = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(undo.body).toMatchObject({ undone: 1, status: 'undone' });
    expect(await student(phoneN(20))).toMatchObject({
      blocked: true, feeBalance: 1500, pendingReceipt: 'QAB123XYZ9 Confirmed', receiptStatus: 'expired', receiptMessage: 'OLD1RECPT0 Confirmed',
    });
    expect((await ledger(phoneN(20))).map((e) => e.type).sort()).toEqual(['invoice', 'payment', 'reversal']);

    // Approving the same receipt again afterwards records the payment again.
    const again = await call('/api/fees/approveReceipt', { token: gold, body: { session: 'morning', phone: phoneN(20), amount: 1500, reference: 'QAB123XYZ9' } });
    expect(again.body).toMatchObject({ posted: true, balance: 0, stillBlocked: false });
  });

  it('the single approval is unchanged (same fields through the shared helper)', async () => {
    await seed(phoneN(30), { blocked: true, pendingReceipt: 'QAB123XYZ9 Confirmed' });
    await owe(phoneN(30), 800);
    const res = await call('/api/fees/approveReceipt', { token: gold, body: { session: 'morning', phone: phoneN(30), amount: 500 } });
    expect(res.body).toMatchObject({ posted: true, balance: 300, stillBlocked: true });
    expect(await student(phoneN(30))).toMatchObject({ blocked: true, pendingReceipt: null, receiptStatus: 'approved' });
  });

  it('8 per call, within the Worker budget', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const subreq = (r) => Number(/subreq;desc="(\d+)"/.exec(r.headers.get('server-timing'))[1]);
      const phones = [];
      for (let i = 0; i < 8; i += 1) {
        phones.push(phoneN(40 + i));
        await seed(phoneN(40 + i), { blocked: true, pendingReceipt: `QAB12${i}XYZ9 Confirmed` });
        await owe(phoneN(40 + i), 500);
      }
      const res = await bulk({ action: 'approveReceipts', items: items(...phones) });
      expect(res.body.done).toBe(8);
      // Measured 2026-10-28: 29 for 8 approvals with payments (budget 45).
      expect(subreq(res)).toBeLessThanOrEqual(40);
      // 25 a call since 003Fixes / 07; 26 is refused.
      const many = Array.from({ length: 26 }, (_, i) => phoneN(500 + i));
      expect((await bulk({ action: 'approveReceipts', items: items(...many) })).status).toBe(400);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });
});

// ---------------------------------------------------------------------------
describe('M-Pesa auto-unblock for students blocked by a bulk fee block (STK screen stays off)', () => {
  const lastStk = () => externalCalls.filter((c) => /stkpush\/v1\/processrequest/.test(c.url)).at(-1);
  const callbackBody = (id, amount, receipt) => ({ Body: { stkCallback: {
    MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: 0, ResultDesc: 'ok',
    CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receipt }, { Name: 'PhoneNumber', Value: 254700000000 }] },
  } } });

  async function bulkFeeBlocked(phone, amount) {
    await seed(phone);
    const res = await bulk({ action: 'block', kind: 'fees', amount, items: items(phone) });
    expect(res.body.done).toBe(1);
    return res.body.batchId;
  }

  it('paid in full by M-Pesa → unblocked, balance 0; the bulk Undo then leaves them alone', async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
    const batchId = await bulkFeeBlocked(phoneN(60), 700);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(60) } });
    expect(init.status, JSON.stringify(init.body)).toBe(200);
    await call(new URL(lastStk().body.CallBackURL).pathname, { ip: SAFARICOM_IP, body: callbackBody(init.body.checkoutRequestId, 700, 'TJK9XYZ8QP') });
    expect(await student(phoneN(60))).toMatchObject({ blocked: false, feeBalance: 0 });
    const undo = await bulk({ action: 'undo', batchId });
    expect(undo.body).toMatchObject({ undone: 0, changedSince: 1 });
    expect((await student(phoneN(60))).blocked).toBe(false);
  });

  it('a part payment lowers the balance and leaves the block', async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
    await bulkFeeBlocked(phoneN(61), 1000);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(61), payAmount: 400 } });
    expect(init.status, JSON.stringify(init.body)).toBe(200);
    await call(new URL(lastStk().body.CallBackURL).pathname, { ip: SAFARICOM_IP, body: callbackBody(init.body.checkoutRequestId, 400, 'PART1PAY00') });
    expect(await student(phoneN(61))).toMatchObject({ blocked: true, feeBalance: 600 });
  });

  it('recovered by the reconcile sweep (no callback) → unblocked too', async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
    await bulkFeeBlocked(phoneN(62), 500);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(62) } });
    await db.doc(`mpesa/transactions/items/${init.body.checkoutRequestId}`).set({ initiatedAt: new Date(Date.now() - 10 * 60_000) }, { merge: true });
    fakes.daraja.queryResultCode = '0';
    const sweep = await call('/api/cron/mpesaReconcile', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
    expect(sweep.status).toBe(200);
    expect(await student(phoneN(62))).toMatchObject({ blocked: false, feeBalance: 0 });
  });

  it('the STK push screen is still commented out for the pilot, markers intact', () => {
    const screen = readFileSync(path.join(process.cwd(), 'src/features/registration/components/BlockedStudentScreen.jsx'), 'utf8');
    for (const marker of ['STK (1/3)', 'STK (2/3)', 'STK (3/3)']) expect(screen).toContain(marker);
    // Still commented out: no live import of the panel or the availability hook.
    expect(screen).not.toMatch(/^import .*useMpesaAvailable/m);
    expect(screen).not.toMatch(/^const PayNowPanel = lazy/m);
    expect(readFileSync(path.join(process.cwd(), 'docs/STK_PUSH_PILOT.md'), 'utf8')).toMatch(/STK \(1\/3\)/);
  });
});
