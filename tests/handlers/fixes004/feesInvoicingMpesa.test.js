import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
  setFlags, externalCalls, fakes, SAFARICOM_IP,
} from '../_worker.js';

/**
 * 004Fixes / 08 — invoicing, the nightly fees sweep and M-Pesa per session
 * (owner: each session's registration pays its own fees; a payment pays the
 * row's session). One number registered in morning AND evening throughout.
 */

const P = '+254711008008';
const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
let db; let gold;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('fx004-pay-gold', teacherClaims.gold, { email: 'pay.teacher@school.example' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/daraja.js')).__resetCallbackSecretCache?.();
  await setFlags(db, { 'payments.daraja': true, 'fees.enabled': true, 'auth.legacyStudentRead': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
  fakes.daraja.queryResultCode = '0';
});
afterEach(() => { delete process.env.DARAJA_CALLBACK_SECRET; });

const seed = (session, extra = {}) => db.doc(`sessions/${session}/students/${P}`).set({
  studentName: `Kid ${session}`, parentPhone: P, class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 x',
  registeredAt: new Date('2026-10-01T06:00:00Z'), session, blocked: false, blockReason: '', approvalStatus: 'approved',
  receiptStatus: 'approved', feeBalance: 0, ...extra,
});
/** A registration that owes `balance` and is blocked for it. */
const owing = async (session, balance) => {
  await seed(session, { blocked: true, feeBalance: balance });
  await db.doc(`fees/accounts/items/${session}__${P}`).set({ key: `${session}__${P}`, phone: P, session, balance });
};
const student = async (s) => (await db.doc(`sessions/${s}/students/${P}`).get()).data();
const account = async (s) => (await db.doc(`fees/accounts/items/${s}__${P}`).get()).data() ?? null;
const ledger = async (s) => (await db.collection(`fees/accounts/items/${s}__${P}/ledger`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const lastStk = () => externalCalls.filter((c) => /stkpush\/v1\/processrequest/.test(c.url)).at(-1);
const callbackBody = (id, amount, receipt) => ({ Body: { stkCallback: {
  MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: 0, ResultDesc: 'ok',
  CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, ...(receipt ? [{ Name: 'MpesaReceiptNumber', Value: receipt }] : [])] },
} } });

describe('the invoice run', () => {
  beforeEach(async () => {
    await seed('morning');
    await seed('evening');
    await db.doc('fees/config').set({ defaultFeeByClass: { 'Form 3': 1200 }, billingDayOfMonth: 5, gracePeriodDays: 7, invoicePrefix: 'INV' });
  });
  const run = () => call('/api/fees/generateInvoices', { token: gold, body: { period: '2026-11' } });

  it('each session account gets its own invoice, due date and status; a second run invoices nothing twice', async () => {
    const res = await run();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const s of ['morning', 'evening']) {
      const acc = await account(s);
      expect(acc).toMatchObject({ key: `${s}__${P}`, session: s, balance: 1200, status: 'due', lastInvoiceId: `2026-11_${s}__${P}` });
      expect(acc.nextDueDate).toBeTruthy();
      expect(await student(s)).toMatchObject({ feeBalance: 1200 });
      expect((await ledger(s)).map((e) => e.id)).toEqual(['invoice_2026-11']);
    }
    const again = await run();
    expect(again.body.issued).toHaveLength(0);
    expect((await account('morning')).balance).toBe(1200);
    expect((await account('evening')).balance).toBe(1200);
  });

  it('a fee set on one session\'s account applies to that session only', async () => {
    await db.doc(`fees/accounts/items/morning__${P}`).set({ key: `morning__${P}`, phone: P, session: 'morning', balance: 0, feeAmount: 900 });
    await run();
    expect((await account('morning')).balance).toBe(900);
    expect((await account('evening')).balance).toBe(1200);
  });
});

describe('the nightly sweep', () => {
  it('flags and auto-blocks only the session that is overdue', async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    await db.doc('fees/config').set({ autoBlockOnOverdue: true }, { merge: true });
    await seed('morning');
    await seed('evening');
    await db.doc(`fees/accounts/items/morning__${P}`).set({ key: `morning__${P}`, phone: P, session: 'morning', balance: 1200, nextDueDate: past });
    await db.doc(`fees/accounts/items/evening__${P}`).set({ key: `evening__${P}`, phone: P, session: 'evening', balance: 0, nextDueDate: past });
    const res = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ overdueFlagged: 1, legacySkipped: 0 });
    expect(await student('morning')).toMatchObject({ overdue: true, blocked: true });
    expect(await student('evening')).toMatchObject({ blocked: false });
    expect((await student('evening')).overdue).toBeUndefined();
    expect((await account('morning')).status).toBe('overdue');
    expect((await account('evening')).status).toBeUndefined();
    expect((await db.doc('aggregates/dashboard').get()).data().overdueCount).toBe(1);
  });
});

describe('M-Pesa pays the row\'s session', () => {
  it('initiate reads that session\'s balance: nothing owed on morning, the 700 owed on evening', async () => {
    await seed('morning');
    await owing('evening', 700);
    const morning = await call('/api/payments/initiate', { body: { session: 'morning', phone: P } });
    expect(morning.status).toBe(400);
    expect(morning.body.error.code).toBe('nothing_owed');
    const evening = await call('/api/payments/initiate', { body: { session: 'evening', phone: P } });
    expect(evening.status, JSON.stringify(evening.body)).toBe(200);
    expect(lastStk().body.Amount).toBe(700);
  });

  it('a callback for an evening payment pays and unblocks evening only', async () => {
    await owing('morning', 2750);
    await owing('evening', 700);
    const init = await call('/api/payments/initiate', { body: { session: 'evening', phone: P } });
    const cb = await call(new URL(lastStk().body.CallBackURL).pathname, { ip: SAFARICOM_IP, body: callbackBody(init.body.checkoutRequestId, 700, 'TJK9XYZ8QP') });
    expect(cb.status).toBe(200);
    expect((await account('evening')).balance).toBe(0);
    expect(await student('evening')).toMatchObject({ blocked: false, feeBalance: 0 });
    expect((await ledger('evening')).find((e) => e.type === 'payment')).toMatchObject({ reference: 'TJK9XYZ8QP', session: 'evening' });
    expect((await account('morning')).balance).toBe(2750);
    expect(await student('morning')).toMatchObject({ blocked: true, feeBalance: 2750 });
    expect(await ledger('morning')).toHaveLength(0);
  });

  it('reconcile pays evening only, and a late callback fills the receipt in the evening ledger', async () => {
    await owing('morning', 2750);
    await owing('evening', 800);
    const init = await call('/api/payments/initiate', { body: { session: 'evening', phone: P } });
    const id = init.body.checkoutRequestId;
    await db.doc(`mpesa/transactions/items/${id}`).set({ initiatedAt: new Date(Date.now() - 10 * 60_000) }, { merge: true });
    const sweep = await call('/api/cron/mpesaReconcile', { headers: CRON(), body: {} });
    expect(sweep.status, JSON.stringify(sweep.body)).toBe(200);
    expect((await account('evening')).balance).toBe(0);
    expect(await student('evening')).toMatchObject({ blocked: false });
    expect((await account('morning')).balance).toBe(2750);
    expect((await student('morning')).blocked).toBe(true);
    const entry = (await ledger('evening')).find((e) => e.id === `mpesa_${id}`);
    expect(entry).toMatchObject({ receiptPending: true, reference: null });

    const late = await call(new URL(lastStk().body.CallBackURL).pathname, { ip: SAFARICOM_IP, body: callbackBody(id, 800, 'LATE1RCPT2') });
    expect(late.status).toBe(200);
    expect((await ledger('evening')).find((e) => e.id === `mpesa_${id}`)).toMatchObject({ reference: 'LATE1RCPT2', receiptPending: false });
    expect((await account('evening')).balance).toBe(0);
  });
});
