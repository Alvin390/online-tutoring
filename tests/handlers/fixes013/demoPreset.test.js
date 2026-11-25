import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  drainWaitUntil,
} from '../_worker.js';

/**
 * 013Fixes / 35 — the demo preset (owner answer 4): one click sets payments
 * to test and SMS to fake and shows a "DEMO" banner to teachers and students;
 * one click off puts the two switches back exactly as they were (a switch
 * that was unset goes back to unset, so the environment decides again).
 * The M-Pesa STK setting is NOT touched (Demo there would show Pay now to
 * real blocked students). In a paid period on live payments, it needs TEST
 * typed, like the payments switch. Audited; superadmin only.
 */

let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-demo-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-demo-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await setFlags(db, { 'billing.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: true, renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 100 * 86_400_000) });
  await db.doc('config/mpesaStatus').set({ mode: 'off' });
});

const modes = (body, token = admin) => call('/api/admin/modes', { token, body });
const stored = async () => (await db.doc('config/mode').get()).data() ?? {};
const bootstrap = async () => (await call('/api/public/bootstrap', { method: 'GET' })).body.modes;

describe('the demo preset', () => {
  it('on: payments test, SMS fake, DEMO shown; STK untouched; audited', async () => {
    const res = await modes({ action: 'setDemo', on: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ demo: { on: true }, payments: { mode: 'test' }, sms: { mode: 'fake' } });
    expect(await bootstrap()).toMatchObject({ demo: true, paymentsTest: true, smsFake: true });
    expect((await db.doc('config/mpesaStatus').get()).data().mode).toBe('off');
    await drainWaitUntil();
    const [a] = (await db.collection('audit').where('action', '==', 'mode.demo_changed').get()).docs.map((d) => d.data());
    expect(a).toMatchObject({ after: { on: true } });
  });

  it('off: unset switches go back to unset (the environment decides again)', async () => {
    await modes({ action: 'setDemo', on: true });
    const res = await modes({ action: 'setDemo', on: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const doc = await stored();
    expect(doc.payments ?? null).toBeNull();
    expect(doc.sms ?? null).toBeNull();
    expect(res.body).toMatchObject({ demo: { on: false }, payments: { mode: 'test', source: 'env' }, sms: { mode: 'real', source: 'env' } });
    expect(await bootstrap()).toMatchObject({ demo: false, smsFake: false });
  });

  it('off: chosen switches come back as they were', async () => {
    await modes({ action: 'setPayments', mode: 'live' });
    await modes({ action: 'setSms', mode: 'real' });
    await modes({ action: 'setDemo', on: true });
    expect((await stored()).payments).toBe('test');
    await modes({ action: 'setDemo', on: false });
    const doc = await stored();
    expect(doc).toMatchObject({ payments: 'live', sms: 'real' });
  });

  it('on twice keeps the first "before" (no lost settings)', async () => {
    await modes({ action: 'setPayments', mode: 'live' });
    await modes({ action: 'setDemo', on: true });
    await modes({ action: 'setDemo', on: true });
    await modes({ action: 'setDemo', on: false });
    expect((await stored()).payments).toBe('live');
  });

  it('in a paid period on live payments: needs TEST typed', async () => {
    await modes({ action: 'setPayments', mode: 'live' });
    await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: false, renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) });
    let res = await modes({ action: 'setDemo', on: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('confirm_required');
    res = await modes({ action: 'setDemo', on: true, confirm: 'TEST' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('superadmin only', async () => {
    expect((await modes({ action: 'setDemo', on: true }, teacher)).status).toBe(403);
  });
});
