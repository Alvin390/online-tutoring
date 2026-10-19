import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
  setFlags, phoneN, externalCalls, fakes, SAFARICOM_IP,
} from '../_worker.js';

/**
 * Phase 13 / 04 — payments, live ledger and Daraja (server side).
 * Ports B8a/b, I2 and B12 (server) to assert the FIX; adds fees/annotate,
 * late-callback receipt fill, and credential status for env-sourced keys.
 */

let db;
let gold;
let silver;
let bronze;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('p13-pay-gold', teacherClaims.gold);
  silver = await userWithClaims('p13-pay-silver', teacherClaims.silver);
  bronze = await userWithClaims('p13-pay-bronze', teacherClaims.bronze);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/daraja.js')).__resetCallbackSecretCache?.();
  await setFlags(db, { 'payments.daraja': true, 'fees.enabled': true });
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
});

afterEach(() => {
  delete process.env.DARAJA_CALLBACK_SECRET;
});

async function seedPayer(phone, balance) {
  await db.doc(`sessions/morning/students/${phone}`).set({
    studentName: 'Payer', parentPhone: phone, class: 'G8', subjects: 'Maths', receiptMessage: 'QAB123XYZ9 x',
    registeredAt: new Date(), session: 'morning', blocked: true, approvalStatus: 'approved',
    receiptStatus: 'approved', feeBalance: balance,
  });
  await db.doc(`fees/accounts/items/${phone}`).set({ phone, session: 'morning', balance });
}

const lastStk = () => externalCalls.filter((c) => /stkpush\/v1\/processrequest/.test(c.url)).at(-1);

function callbackBody(checkoutRequestId, amount, receipt) {
  return { Body: { stkCallback: {
    MerchantRequestID: 'm', CheckoutRequestID: checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
    CallbackMetadata: { Item: [
      { Name: 'Amount', Value: amount },
      ...(receipt ? [{ Name: 'MpesaReceiptNumber', Value: receipt }] : []),
      { Name: 'PhoneNumber', Value: 254700000000 },
    ] },
  } } };
}

// ---------------------------------------------------------------------------
describe('D1 a callback secret always exists (B8a/b)', () => {
  it('env-only credentials still produce a secret in the CallBackURL (16 random bytes, base64url)', async () => {
    await seedPayer(phoneN(1), 1500);
    const res = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(1) } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(lastStk().body.CallBackURL).toMatch(/^https:\/\/validation\.example\/api\/daraja\/callback\/[A-Za-z0-9_-]{22}$/);
    const stored = (await db.doc('integrations/daraja').get()).data().callbackSecret;
    expect(lastStk().body.CallBackURL.endsWith(stored)).toBe(true);
  });

  it('five concurrent first payments agree on ONE secret', async () => {
    for (let i = 0; i < 5; i += 1) await seedPayer(phoneN(10 + i), 500);
    const before = externalCalls.length;
    await Promise.all([0, 1, 2, 3, 4].map((i) => call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(10 + i) } })));
    const urls = new Set(externalCalls.slice(before).filter((c) => /processrequest/.test(c.url)).map((c) => c.body.CallBackURL));
    expect(urls.size).toBe(1);
  });

  it('DARAJA_CALLBACK_SECRET overrides the stored secret', async () => {
    process.env.DARAJA_CALLBACK_SECRET = 'operatorchosensecret0123';
    await seedPayer(phoneN(2), 900);
    await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(2) } });
    expect(lastStk().body.CallBackURL).toBe('https://validation.example/api/daraja/callback/operatorchosensecret0123');
  });

  it("Safaricom's callback is processed and the receipt lands in the ledger", async () => {
    await seedPayer(phoneN(3), 700);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(3) } });
    const cb = await call(new URL(lastStk().body.CallBackURL).pathname, {
      ip: SAFARICOM_IP, body: callbackBody(init.body.checkoutRequestId, 700, 'TJK9XYZ8QP'),
    });
    expect(cb.status).toBe(200);
    const tx = (await db.doc(`mpesa/transactions/items/${init.body.checkoutRequestId}`).get()).data();
    expect(tx).toMatchObject({ status: 'success', mpesaReceipt: 'TJK9XYZ8QP' });
    const entry = (await db.doc(`fees/accounts/items/${phoneN(3)}/ledger/mpesa_${init.body.checkoutRequestId}`).get()).data();
    expect(entry.reference).toBe('TJK9XYZ8QP');
    expect(entry.receiptPending).toBeFalsy();
  });

  it('the payment status the student polls carries the receipt', async () => {
    await seedPayer(phoneN(4), 300);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(4) } });
    await call(new URL(lastStk().body.CallBackURL).pathname, { ip: SAFARICOM_IP, body: callbackBody(init.body.checkoutRequestId, 300, 'QWE1RTY2UI') });
    const status = await call('/api/payments/status', { body: { checkoutRequestId: init.body.checkoutRequestId, phone: phoneN(4) } });
    expect(status.body).toMatchObject({ status: 'success', mpesaReceipt: 'QWE1RTY2UI' });
  });
});

// ---------------------------------------------------------------------------
describe('D3 reconciled payments and late callbacks (I2)', () => {
  async function reconciled(phone, amount) {
    await seedPayer(phone, amount);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone } });
    const id = init.body.checkoutRequestId;
    await db.doc(`mpesa/transactions/items/${id}`).set({ initiatedAt: new Date(Date.now() - 10 * 60_000) }, { merge: true });
    fakes.daraja.queryResultCode = '0';
    const sweep = await call('/api/cron/mpesaReconcile', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
    expect(sweep.status).toBe(200);
    return id;
  }

  it('a payment recovered by reconciliation is flagged receiptPending', async () => {
    const id = await reconciled(phoneN(20), 1500);
    const entry = (await db.doc(`fees/accounts/items/${phoneN(20)}/ledger/mpesa_${id}`).get()).data();
    expect(entry).toMatchObject({ reference: null, receiptPending: true, method: 'mpesa' });
  });

  it('a callback arriving after reconciliation fills in the receipt, exactly once', async () => {
    const id = await reconciled(phoneN(21), 800);
    const path = new URL(lastStk().body.CallBackURL).pathname;
    const late = await call(path, { ip: SAFARICOM_IP, body: callbackBody(id, 800, 'LATE1RCPT2') });
    expect(late.status).toBe(200);
    const again = await call(path, { ip: SAFARICOM_IP, body: callbackBody(id, 800, 'OTHER1RCPT') });
    expect(again.status).toBe(200);

    const entry = (await db.doc(`fees/accounts/items/${phoneN(21)}/ledger/mpesa_${id}`).get()).data();
    expect(entry).toMatchObject({ reference: 'LATE1RCPT2', receiptPending: false, amount: -800 });
    const ledger = await db.collection(`fees/accounts/items/${phoneN(21)}/ledger`).get();
    expect(ledger.docs.filter((d) => d.data().type === 'payment')).toHaveLength(1);
    expect((await db.doc(`mpesa/transactions/items/${id}`).get()).data().mpesaReceipt).toBe('LATE1RCPT2');
  });

  it('fees/annotate fills a missing receipt, once, without touching money', async () => {
    const id = await reconciled(phoneN(22), 600);
    const body = { session: 'morning', phone: phoneN(22), entryId: `mpesa_${id}`, reference: 'TEACH1ER23' };

    const ok = await call('/api/fees/annotate', { token: silver, body });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const entry = (await db.doc(`fees/accounts/items/${phoneN(22)}/ledger/mpesa_${id}`).get()).data();
    expect(entry).toMatchObject({ reference: 'TEACH1ER23', receiptPending: false, amount: -600, referenceAddedBy: 'p13-pay-silver' });

    const twice = await call('/api/fees/annotate', { token: silver, body: { ...body, reference: 'TEACH9ER99' } });
    expect(twice.status).toBe(409);

    const audit = await db.collection('audit').where('action', '==', 'fees.reference_added').get();
    expect(audit.size).toBe(1);
  });

  it('fees/annotate validates and gates', async () => {
    const id = await reconciled(phoneN(23), 600);
    const base = { session: 'morning', phone: phoneN(23), entryId: `mpesa_${id}` };
    expect((await call('/api/fees/annotate', { token: bronze, body: { ...base, reference: 'TEACH1ER23' } })).status).toBe(403);
    expect((await call('/api/fees/annotate', { token: silver, body: { ...base, reference: 'bad ref!' } })).status).toBe(400);
    expect((await call('/api/fees/annotate', { token: silver, body: { ...base, reference: 'TEACH1ER23', amount: 1 } })).status).toBe(400);
    // Not an M-Pesa receipt (e.g. paid in cash): free text up to 40, flagged.
    const cash = await call('/api/fees/annotate', { token: silver, body: { ...base, reference: 'Cash at school 12 Oct', notMpesa: true } });
    expect(cash.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('D4 credentials status for env-sourced keys (B8d server)', () => {
  it('reports env as the source with the real callback URL, and refuses a save', async () => {
    const status = await call('/api/daraja/credentials', { token: gold, body: { action: 'status' } });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ configured: true, source: 'env', environment: 'sandbox' });
    expect(status.body.callbackUrl).toMatch(/\/api\/daraja\/callback\/[A-Za-z0-9_-]{22}$/);

    const save = await call('/api/daraja/credentials', {
      token: gold,
      body: { action: 'save', shortCode: '174379', shortCodeType: 'paybill', consumerKey: 'k'.repeat(12), consumerSecret: 's'.repeat(12), passkey: 'p'.repeat(12) },
    });
    expect(save.status).toBe(409);
    expect(save.body.error.code).toBe('managed_by_environment');
  });
});

// ---------------------------------------------------------------------------
describe('D5 fee charges respect the fees flag (B12 server)', () => {
  it('fees/post is refused with fees.enabled off, even for Silver', async () => {
    await setFlags(db, { 'payments.daraja': true, 'fees.enabled': false });
    await seedPayer(phoneN(30), 0);
    const res = await call('/api/fees/post', { token: silver, body: { session: 'morning', phone: phoneN(30), type: 'invoice', amount: 500 } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('feature_disabled');
  });

  it('works for Silver with fees on, and stays refused for Bronze', async () => {
    await seedPayer(phoneN(31), 0);
    const body = { session: 'morning', phone: phoneN(31), type: 'invoice', amount: 500 };
    expect((await call('/api/fees/post', { token: silver, body })).status).toBe(200);
    expect((await call('/api/fees/post', { token: bronze, body })).status).toBe(403);
  });
});
