import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  phoneN, externalCalls, fakes, SAFARICOM_IP,
} from '../_worker.js';

/**
 * 013Fixes / 30b — M-Pesa (STK) has one setting with three positions
 * (owner, 2026-11-25):
 *   Off   hidden everywhere, refused.
 *   Demo  Pay now shown to every blocked student, through Safaricom's SANDBOX
 *         (the server's sandbox keys, whatever DARAJA_MODE says). A demo
 *         payment runs the whole flow but never touches fees or blocks: it
 *         lives in mpesa/demo, never mpesa/transactions.
 *   Live  the school's LIVE keys (saved on the card, or the server's live
 *         keys). Untested → hidden; tested (the KES 1 test confirmed) →
 *         shown. "Tested" belongs to the keys: changing them (or the server's
 *         live keys) makes it untested again; switching Off/Demo and back
 *         doesn't. Gold only. The test lives in mpesa/tests.
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

const ENV_KEEP = ['DARAJA_MODE', 'DARAJA_LIVE_PASSKEY', 'DARAJA_LIVE_CONSUMER_KEY'];
const saved = {};
beforeEach(async () => {
  for (const k of ENV_KEEP) saved[k] = process.env[k];
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/daraja.js')).__resetCallbackSecretCache?.();
  (await import('../../../api/_lib/daraja.js'))._resetTokenCache();
  (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
  (await import('../../../api/_lib/darajaKeys.js')).__resetDarajaKeys();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  await setFlags(db, { 'payments.daraja': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const daraja = (body, token = admin) => call('/api/admin/daraja', { token, body });
const setMode = async (mode) => expect((await daraja({ action: 'setMode', mode })).status).toBe(200);
const card = async () => (await daraja({ action: 'status' })).body;
const lastStk = () => externalCalls.filter((c) => /stkpush\/v1\/processrequest/.test(c.url)).at(-1);
const stkCount = () => externalCalls.filter((c) => /processrequest/.test(c.url)).length;
const bootstrap = async () => {
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
  return (await call('/api/public/bootstrap', { method: 'GET' })).body;
};
const cron = () => call('/api/cron/mpesaReconcile', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
async function seedPayer(phone, balance) {
  await db.doc(`sessions/morning/students/${phone}`).set({
    studentName: 'Payer', parentPhone: phone, class: 'G8', subjects: 'Maths', receiptMessage: 'QAB123XYZ9 x',
    registeredAt: new Date(), session: 'morning', blocked: true, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: balance,
  });
  await db.doc(`fees/accounts/items/morning__${phone}`).set({ phone, session: 'morning', balance });
}
function callback(checkoutRequestId, { resultCode = 0, amount = 1, receipt = 'TST1RCPT23' } = {}) {
  return { Body: { stkCallback: {
    MerchantRequestID: 'm', CheckoutRequestID: checkoutRequestId, ResultCode: resultCode, ResultDesc: resultCode === 0 ? 'ok' : 'Request cancelled by user',
    ...(resultCode === 0 ? { CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receipt }, { Name: 'PhoneNumber', Value: 254700000123 }] } } : {}),
  } } };
}
const cbPath = () => new URL(lastStk().body.CallBackURL).pathname;
async function liveTested() {
  await setMode('live');
  const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await call(cbPath(), { ip: SAFARICOM_IP, body: callback(res.body.checkoutRequestId) });
  expect((await card()).mpesa).toMatchObject({ mode: 'live', liveTested: true });
}
async function pay(phone) {
  const init = await call('/api/payments/initiate', { body: { session: 'morning', phone } });
  expect(init.status, JSON.stringify(init.body)).toBe(200);
  return init.body;
}

describe('Off', () => {
  it('not offered, and a payment can\'t start', async () => {
    expect((await bootstrap()).payments).toEqual({ mpesa: false, demo: false });
    await seedPayer(phoneN(70), 500);
    const res = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(70) } });
    expect(res.body.error.code).toBe('mpesa_off');
    expect(stkCount()).toBe(0);
  });
});

describe('Demo', () => {
  it('offered to every blocked student, through the sandbox; no test needed', async () => {
    await setMode('demo');
    expect((await bootstrap()).payments).toEqual({ mpesa: true, demo: true });
    await seedPayer(phoneN(71), 500);
    const init = await pay(phoneN(71));
    expect(init).toMatchObject({ demo: true, environment: 'sandbox' });
    expect(lastStk().url).toMatch(/^https:\/\/sandbox\.safaricom\.co\.ke\//);
    expect(lastStk().body.BusinessShortCode).toBe(174379);
    expect((await db.doc(`mpesa/demo/items/${init.checkoutRequestId}`).get()).exists).toBe(true);
    expect((await db.collection('mpesa/transactions/items').get()).size).toBe(0);
  });

  it('the sandbox even when the server says live and live keys exist', async () => {
    process.env.DARAJA_MODE = 'live';
    await setMode('demo');
    await seedPayer(phoneN(72), 500);
    await pay(phoneN(72));
    expect(lastStk().url).toMatch(/^https:\/\/sandbox\.safaricom\.co\.ke\//);
    expect(lastStk().body.BusinessShortCode).toBe(174379);
  });

  it('a demo payment: success for the student, but no ledger entry, the balance and the block unchanged', async () => {
    await setMode('demo');
    await seedPayer(phoneN(73), 500);
    const init = await pay(phoneN(73));
    expect((await call(cbPath(), { ip: SAFARICOM_IP, body: callback(init.checkoutRequestId, { amount: 500, receipt: 'DEM1RCPT23' }) })).status).toBe(200);
    expect((await db.doc(`mpesa/demo/items/${init.checkoutRequestId}`).get()).data().status).toBe('success');
    expect((await db.collection(`fees/accounts/items/morning__${phoneN(73)}/ledger`).get()).size).toBe(0);
    expect((await db.doc(`fees/accounts/items/morning__${phoneN(73)}`).get()).data().balance).toBe(500);
    expect((await db.doc(`sessions/morning/students/${phoneN(73)}`).get()).data().blocked).toBe(true);
    expect((await db.collection('mpesa/transactions/items').get()).size).toBe(0);
    const st = await call('/api/payments/status', { body: { checkoutRequestId: init.checkoutRequestId, phone: phoneN(73) } });
    expect(st.body).toMatchObject({ status: 'success', demo: true, balanceAfter: 500 });
    // Another phone can't read it.
    const other = await call('/api/payments/status', { body: { checkoutRequestId: init.checkoutRequestId, phone: phoneN(74) } });
    expect(other.status).toBe(403);
  });

  it('no test push in Demo (it\'s for live keys)', async () => {
    await setMode('demo');
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('live_only');
  });
});

describe('Live', () => {
  it('untested: hidden and refused', async () => {
    await setMode('live');
    expect((await bootstrap()).payments).toEqual({ mpesa: false, demo: false });
    expect((await card()).mpesa).toMatchObject({ mode: 'live', liveTested: false });
    await seedPayer(phoneN(75), 500);
    const res = await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(75) } });
    expect(res.body.error.code).toBe('mpesa_offline');
  });

  it('the KES 1 test goes to the live keys (production), kept apart; confirmed → tested and shown', async () => {
    await setMode('live');
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    expect(lastStk().url).toMatch(/^https:\/\/api\.safaricom\.co\.ke\//);
    expect(lastStk().body).toMatchObject({ Amount: 1, AccountReference: 'TEST', BusinessShortCode: 600123 });
    const test = (await db.doc(`mpesa/tests/items/${res.body.checkoutRequestId}`).get()).data();
    expect(test).toMatchObject({ status: 'pending', phoneMasked: '+2547••••0123' });
    await call(cbPath(), { ip: SAFARICOM_IP, body: callback(res.body.checkoutRequestId) });
    expect((await card()).mpesa).toMatchObject({ liveTested: true, testPhoneMasked: '+2547••••0123' });
    expect((await bootstrap()).payments).toEqual({ mpesa: true, demo: false });
    expect((await db.collection('mpesa/transactions/items').get()).size).toBe(0);
  });

  it('tested: a real payment is posted once, even when Safaricom repeats the callback; the student unblocked', async () => {
    await liveTested();
    await seedPayer(phoneN(76), 500);
    const init = await pay(phoneN(76));
    expect(init).toMatchObject({ demo: false, environment: 'production' });
    const body = callback(init.checkoutRequestId, { amount: 500, receipt: 'PAY1RCPT23' });
    await call(cbPath(), { ip: SAFARICOM_IP, body });
    await call(cbPath(), { ip: SAFARICOM_IP, body });
    expect((await db.collection(`fees/accounts/items/morning__${phoneN(76)}/ledger`).get()).size).toBe(1);
    expect((await db.doc(`fees/accounts/items/morning__${phoneN(76)}`).get()).data().balance).toBe(0);
    expect((await db.doc(`sessions/morning/students/${phoneN(76)}`).get()).data().blocked).toBe(false);
  });

  it('a failed test: untested, with M-Pesa\'s reason', async () => {
    await setMode('live');
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    await call(cbPath(), { ip: SAFARICOM_IP, body: callback(res.body.checkoutRequestId, { resultCode: 1032 }) });
    expect((await card()).mpesa).toMatchObject({ liveTested: false, testPending: false, lastError: 'You cancelled the payment request.' });
  });

  it('keys saved while the test is pending: the confirmation doesn\'t count', async () => {
    await setMode('live');
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    await daraja({ action: 'save', consumerKey: 'CK-placeholder-1', consumerSecret: 'CS-placeholder-2', passkey: 'PK-placeholder-3', shortCode: '600999', shortCodeType: 'till' });
    await call(cbPath(), { ip: SAFARICOM_IP, body: callback(res.body.checkoutRequestId) });
    expect((await card()).mpesa.liveTested).toBe(false);
  });

  it('changing the keys makes it untested; a new test makes it tested again', async () => {
    await liveTested();
    await daraja({ action: 'save', consumerKey: 'CK-placeholder-1', consumerSecret: 'CS-placeholder-2', passkey: 'PK-placeholder-3', shortCode: '600999', shortCodeType: 'till' });
    expect((await card()).mpesa.liveTested).toBe(false);
    expect((await bootstrap()).payments.mpesa).toBe(false);
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    expect(lastStk().body.BusinessShortCode).toBe(600999);
    await call(cbPath(), { ip: SAFARICOM_IP, body: callback(res.body.checkoutRequestId) });
    expect((await card()).mpesa.liveTested).toBe(true);
    await daraja({ action: 'clear' });
    expect((await card()).mpesa.liveTested).toBe(false);
  });

  it('the server\'s live keys changing (a Worker secret) makes it untested too', async () => {
    await liveTested();
    process.env.DARAJA_LIVE_PASSKEY = 'pk-live-changed';
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    expect((await card()).mpesa.liveTested).toBe(false);
  });

  it('Demo or Off and back to Live: still tested (the keys didn\'t change)', async () => {
    await liveTested();
    await setMode('demo');
    await setMode('off');
    await setMode('live');
    expect((await card()).mpesa.liveTested).toBe(true);
    expect((await bootstrap()).payments).toEqual({ mpesa: true, demo: false });
  });

  it('a callback with a bad path secret changes nothing', async () => {
    await setMode('live');
    const res = await daraja({ action: 'testPush', phone: TEST_PHONE });
    expect((await call('/api/daraja/callback/not-the-secret-0123456789', { ip: SAFARICOM_IP, body: callback(res.body.checkoutRequestId) })).status).toBe(403);
    expect((await card()).mpesa.liveTested).toBe(false);
  });
});

describe('the test\'s result when the callback doesn\'t come', () => {
  it('after 20 s the check asks Safaricom (at most every 25 s); confirmed → tested', async () => {
    await setMode('live');
    await daraja({ action: 'testPush', phone: TEST_PHONE });
    await db.doc('config/mpesaStatus').update({ testStartedAt: new Date(Date.now() - 30_000) });
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    fakes.daraja.queryResultCode = null;
    const queries = () => externalCalls.filter((c) => /stkpushquery/.test(c.url)).length;
    await daraja({ action: 'testResult' });
    await daraja({ action: 'testResult' });
    expect(queries()).toBe(1);
    await db.doc('config/mpesaStatus').update({ testLastQueriedAt: new Date(Date.now() - 60_000) });
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    fakes.daraja.queryResultCode = '0';
    expect((await daraja({ action: 'testResult' })).body.mpesa).toMatchObject({ liveTested: true, testPending: false });
  });

  it('no answer within 2 minutes: timed out, untested', async () => {
    await setMode('live');
    await daraja({ action: 'testPush', phone: TEST_PHONE });
    await db.doc('config/mpesaStatus').update({ testStartedAt: new Date(Date.now() - 3 * 60_000) });
    (await import('../../../api/_lib/mpesaStatus.js')).__resetMpesaStatus();
    fakes.daraja.queryResultCode = null;
    expect((await daraja({ action: 'testResult' })).body.mpesa).toMatchObject({ liveTested: false, testPending: false, lastError: 'No answer from M-Pesa within 2 minutes. Try again.' });
  });
});

describe('money is never stranded', () => {
  it('a pending LIVE payment is still recovered by the reconcile sweep with the card on Demo', async () => {
    await liveTested();
    await seedPayer(phoneN(77), 500);
    const init = await pay(phoneN(77));
    await setMode('demo');
    await db.doc(`mpesa/transactions/items/${init.checkoutRequestId}`).set({ initiatedAt: new Date(Date.now() - 10 * 60_000) }, { merge: true });
    fakes.daraja.queryResultCode = '0';
    const before = externalCalls.length;
    expect((await cron()).status).toBe(200);
    const query = externalCalls.slice(before).find((c) => /stkpushquery/.test(c.url));
    expect(query.url).toMatch(/^https:\/\/api\.safaricom\.co\.ke\//);
    expect((await db.doc(`fees/accounts/items/morning__${phoneN(77)}`).get()).data().balance).toBe(0);
  });
});

describe('Gold only, superadmin only', () => {
  it('Silver is refused even when tested', async () => {
    await liveTested();
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active' });
    (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
    expect((await bootstrap()).payments).toEqual({ mpesa: false, demo: false });
    await seedPayer(phoneN(78), 500);
    expect((await call('/api/payments/initiate', { body: { session: 'morning', phone: phoneN(78) } })).body.error.code).toBe('payments_unavailable');
  });

  it('only the superadmin sets the mode and tests', async () => {
    expect((await daraja({ action: 'setMode', mode: 'demo' }, gold)).status).toBe(403);
    expect((await daraja({ action: 'testPush', phone: TEST_PHONE }, gold)).status).toBe(403);
    expect((await daraja({ action: 'testResult' }, gold)).status).toBe(403);
  });
});
