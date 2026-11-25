import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  phoneN, externalCalls, fakes, SAFARICOM_IP,
} from '../_worker.js';

/**
 * 013Fixes / 30 — the STK switch and the KES 1 test push (owner answer 5):
 *   off → hidden everywhere and refused; on → a KES 1 test to a phone you
 *   type; Safaricom confirms → online (Gold only); any change to the keys or
 *   the switch → offline until a new test passes. The test never touches a
 *   ledger: it lives in its own collection (mpesa/tests), never in
 *   mpesa/transactions. Callbacks are verified as today.
 */

const TEST_PHONE = '+254700000123'; // placeholder
let db; let admin; let gold;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-stk-admin', teacherClaims.superadmin);
  gold = await userWithClaims('fx013-stk-gold', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/daraja.js')).__resetCallbackSecretCache?.();
  (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
  (await import('../../../api/_lib/darajaKeys.js')).__resetDarajaKeys();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  await setFlags(db, { 'payments.daraja': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
});

const daraja = (body, token = admin) => call('/api/admin/daraja', { token, body });
const status = async () => (await db.doc('config/mpesaStatus').get()).data() ?? {};
const lastStk = () => externalCalls.filter((c) => /stkpush\/v1\/processrequest/.test(c.url)).at(-1);
const stkCount = () => externalCalls.filter((c) => /processrequest/.test(c.url)).length;
const bootstrap = async () => {
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
  return (await call('/api/public/bootstrap', { method: 'GET' })).body;
};
async function seedPayer(phone, balance) {
  await db.doc(`sessions/morning/students/${phone}`).set({
    studentName: 'Payer', parentPhone: phone, class: 'G8', subjects: 'Maths', receiptMessage: 'QAB123XYZ9 x',
    registeredAt: new Date(), session: 'morning', blocked: true, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: balance,
  });
  await db.doc(`fees/accounts/items/morning__${phone}`).set({ phone, session: 'morning', balance });
}
function callback(checkoutRequestId, resultCode = 0, resultDesc = 'ok') {
  return { Body: { stkCallback: {
    MerchantRequestID: 'm', CheckoutRequestID: checkoutRequestId, ResultCode: resultCode, ResultDesc: resultDesc,
    ...(resultCode === 0 ? { CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1 }, { Name: 'MpesaReceiptNumber', Value: 'TST1RCPT23' }, { Name: 'PhoneNumber', Value: 254700000123 }] } } : {}),
  } } };
}
async function startTest() {
  expect((await daraja({ action: 'setEnabled', enabled: true })).status).toBe(200);
  const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: res.body.checkoutRequestId, path: new URL(lastStk().body.CallBackURL).pathname };
}

describe('off: hidden everywhere and refused', () => {
  it('never switched on: not offered, and a payment can\'t start', async () => {
    expect((await bootstrap()).payments).toEqual({ mpesa: false });
    await seedPayer(phoneN(70), 500);
    const res = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(70) } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('mpesa_off');
    expect(stkCount()).toBe(0);
  });

  it('on but not tested yet (offline): still not offered, still refused', async () => {
    await daraja({ action: 'setEnabled', enabled: true });
    expect((await bootstrap()).payments).toEqual({ mpesa: false });
    await seedPayer(phoneN(71), 500);
    const res = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(71) } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('mpesa_offline');
  });
});

describe('the KES 1 test push', () => {
  it('KES 1 to the typed phone; kept apart from payments; the phone masked', async () => {
    const { id } = await startTest();
    expect(lastStk().body).toMatchObject({ Amount: 1, AccountReference: 'TEST', PhoneNumber: '254700000123' });
    const test = (await db.doc(`mpesa/tests/items/${id}`).get()).data();
    expect(test).toMatchObject({ status: 'pending', amount: 1, phoneMasked: '+2547••••0123' });
    expect(JSON.stringify(test)).not.toContain('700000123');
    expect((await db.collection('mpesa/transactions/items').get()).size).toBe(0);
    expect((await daraja({ action: 'status' })).body.mpesa).toMatchObject({ enabled: true, online: false, testPending: true });
  });

  it('Safaricom confirms → online; offered to students; nothing posted to any ledger', async () => {
    const { id, path } = await startTest();
    const cb = await call(path, { ip: SAFARICOM_IP, body: callback(id) });
    expect(cb.status).toBe(200);
    expect(await status()).toMatchObject({ enabled: true, online: true, testPhoneMasked: '+2547••••0123' });
    expect((await db.doc(`mpesa/tests/items/${id}`).get()).data().status).toBe('success');
    expect((await db.collection('mpesa/transactions/items').get()).size).toBe(0);
    expect((await db.collection('mpesa/unmatched/items').get()).size).toBe(0);
    expect((await db.collection('fees/accounts/items').get()).size).toBe(0);
    expect((await bootstrap()).payments).toEqual({ mpesa: true });
    await seedPayer(phoneN(72), 500);
    expect((await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(72) } })).status).toBe(200);
  });

  it('a failure leaves it offline, with Safaricom\'s reason', async () => {
    const { id, path } = await startTest();
    await call(path, { ip: SAFARICOM_IP, body: callback(id, 1032, 'Request cancelled by user') });
    expect(await status()).toMatchObject({ online: false, lastError: 'You cancelled the payment request.' });
    expect((await daraja({ action: 'status' })).body.mpesa.testPending).toBe(false);
  });

  it('a key change while the test is pending wins: success arrives, still offline', async () => {
    const { id, path } = await startTest();
    await daraja({ action: 'save', consumerKey: 'CK-placeholder-1', consumerSecret: 'CS-placeholder-2', passkey: 'PK-placeholder-3', shortCode: '600999', shortCodeType: 'till' });
    await call(path, { ip: SAFARICOM_IP, body: callback(id) });
    expect((await status()).online).toBe(false);
  });

  it('online, then a key change or the switch → offline until a new test passes', async () => {
    const first = await startTest();
    await call(first.path, { ip: SAFARICOM_IP, body: callback(first.id) });
    expect((await status()).online).toBe(true);
    await daraja({ action: 'clear' });
    expect((await status()).online).toBe(false);
    const second = await startTest();
    await call(second.path, { ip: SAFARICOM_IP, body: callback(second.id) });
    expect((await status()).online).toBe(true);
    await daraja({ action: 'setEnabled', enabled: false });
    await daraja({ action: 'setEnabled', enabled: true });
    expect((await status()).online).toBe(false);
  });

  it('a callback with a bad path secret changes nothing (verified as today)', async () => {
    const { id } = await startTest();
    const bad = await call('/api/daraja/callback/not-the-secret-0123456789', { ip: SAFARICOM_IP, body: callback(id) });
    expect(bad.status).toBe(403);
    expect((await status()).online).toBe(false);
  });

  it('switched off: no test push', async () => {
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('mpesa_off');
    expect(stkCount()).toBe(0);
  });
});

describe('the result, when Safaricom\'s callback doesn\'t come (the sandbox often doesn\'t)', () => {
  it('after 20 seconds the check asks Safaricom; a confirmed payment → online', async () => {
    await startTest();
    await db.doc('config/mpesaStatus').update({ testStartedAt: new Date(Date.now() - 30_000) });
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    fakes.daraja.queryResultCode = '0';
    const res = await daraja({ action: 'testResult' });
    expect(res.body.mpesa).toMatchObject({ online: true, testPending: false });
  });

  it('no answer within 2 minutes: timed out, offline, said so', async () => {
    await startTest();
    await db.doc('config/mpesaStatus').update({ testStartedAt: new Date(Date.now() - 3 * 60_000) });
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    fakes.daraja.queryResultCode = null;
    const res = await daraja({ action: 'testResult' });
    expect(res.body.mpesa).toMatchObject({ online: false, testPending: false, lastError: 'No answer from M-Pesa within 2 minutes. Try again.' });
  });
});

describe('Gold only, superadmin only', () => {
  it('Silver is refused even when online', async () => {
    const { id, path } = await startTest();
    await call(path, { ip: SAFARICOM_IP, body: callback(id) });
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active' });
    (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
    expect((await bootstrap()).payments).toEqual({ mpesa: false });
    await seedPayer(phoneN(73), 500);
    expect((await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(73) } })).body.error.code).toBe('payments_unavailable');
  });

  it('only the superadmin switches and tests', async () => {
    expect((await daraja({ action: 'setEnabled', enabled: true }, gold)).status).toBe(403);
    expect((await daraja({ action: 'testPush', phone: TEST_PHONE }, gold)).status).toBe(403);
    expect((await daraja({ action: 'testResult' }, gold)).status).toBe(403);
  });
});

// 013Fixes / 31: Pay now back on — the Phase 09 money path, unchanged.
describe('a real payment once online: posted once, even when Safaricom repeats the callback', () => {
  it('one ledger entry, the balance lowered once, the student unblocked', async () => {
    const t = await startTest();
    await call(t.path, { ip: SAFARICOM_IP, body: callback(t.id) });
    expect((await status()).online).toBe(true);
    await seedPayer(phoneN(74), 500);
    const init = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(74) } });
    expect(init.status, JSON.stringify(init.body)).toBe(200);
    const paid = { Body: { stkCallback: {
      MerchantRequestID: 'm', CheckoutRequestID: init.body.checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }, { Name: 'MpesaReceiptNumber', Value: 'PAY1RCPT23' }, { Name: 'PhoneNumber', Value: 254700000074 }] },
    } } };
    const path = new URL(lastStk().body.CallBackURL).pathname;
    expect((await call(path, { ip: SAFARICOM_IP, body: paid })).status).toBe(200);
    expect((await call(path, { ip: SAFARICOM_IP, body: paid })).status).toBe(200);
    const ledger = await db.collection(`fees/accounts/items/morning__${phoneN(74)}/ledger`).get();
    expect(ledger.size).toBe(1);
    expect((await db.doc(`fees/accounts/items/morning__${phoneN(74)}`).get()).data().balance).toBe(0);
    expect((await db.doc(`sessions/morning/students/${phoneN(74)}`).get()).data().blocked).toBe(false);
    // The test push never became a payment.
    expect((await db.collection('mpesa/transactions/items').get()).size).toBe(1);
  });
});

// 013Fixes / 32 (release review): the card's polling never floods Safaricom.
describe('asking Safaricom about the test is throttled', () => {
  it('two checks a few seconds apart, past 20 s: one status query', async () => {
    await startTest();
    await db.doc('config/mpesaStatus').update({ testStartedAt: new Date(Date.now() - 30_000) });
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    fakes.daraja.queryResultCode = null; // not final yet
    const queries = () => externalCalls.filter((c) => /stkpushquery/.test(c.url)).length;
    await daraja({ action: 'testResult' });
    await daraja({ action: 'testResult' });
    expect(queries()).toBe(1);
  });
});
